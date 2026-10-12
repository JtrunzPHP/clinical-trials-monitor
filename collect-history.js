// collect-history.js - Pull ClinicalTrials.gov record history for mapped public-company trials.
//
// Why: the current CT.gov record only shows today's dates and enrollment. The record history
// shows what the sponsor originally said. Investment signal lives in the gap between the two.
//
// How: CT.gov's history endpoint sits behind bot protection that blocks plain server requests,
// so this script drives headless Chrome, opens a study page, and makes the calls from inside it.
//
// For each trial it stores (sharded under data/pipeline/history/):
//   original      start / primary completion / completion dates, enrollment, phases, primary endpoints (version 0)
//   timeline      every status change with its date (from the history changes list)
//   samples       the record's dates and enrollment at version 0, at roughly yearly intervals, and at the
//                 latest version (so slips can be counted without fetching every one of 40+ versions)
//   endpoint      whether the primary outcome was ever changed and at which version/date
//   amendments    how many versions exist and which modules were touched how often
//
// Runs incrementally: HISTORY_BUDGET trials per run (default 1500), highest importance first,
// skipping trials already collected unless CT.gov has a newer version than we have.
// Later runs refresh only what changed, which is cheap.
//
// Inputs: data/pipeline/tickers/*.json from build-pipeline.js (for the trial list and importance).
// Env:    HISTORY_BUDGET, SAMPLE_INTERVAL_MONTHS (default 12), MAX_SAMPLES (default 6)

"use strict";

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "data", "pipeline");
const TICKER_DIR = path.join(OUT_DIR, "tickers");
const HIST_DIR = path.join(OUT_DIR, "history");
const PROGRESS_FILE = path.join(HIST_DIR, "_progress.json");

const BUDGET = parseInt(process.env.HISTORY_BUDGET || "1500", 10);
const SAMPLE_INTERVAL_MONTHS = parseInt(process.env.SAMPLE_INTERVAL_MONTHS || "12", 10);
const MAX_SAMPLES = parseInt(process.env.MAX_SAMPLES || "6", 10);
const BATCH = 8;                       // fetches per in-page batch
const PAUSE_MS = 350;                  // between fetches inside the page
const MAX_RUN_MINUTES = parseInt(process.env.MAX_RUN_MINUTES || "300", 10);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

function shardOf(nct) { return nct.substring(0, 7); }   // NCT0455 -> one file per ~10,000 ids
function loadShard(nct) { try { return JSON.parse(fs.readFileSync(path.join(HIST_DIR, shardOf(nct) + ".json"), "utf8")); } catch (e) { return {}; } }
var shardCache = {};
function getShard(nct) { var k = shardOf(nct); if (!shardCache[k]) shardCache[k] = loadShard(nct); return shardCache[k]; }
function flushShards() { Object.keys(shardCache).forEach(function (k) { fs.writeFileSync(path.join(HIST_DIR, k + ".json"), JSON.stringify(shardCache[k])); }); }

function parseCtDate(s) { if (!s) return null; var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1)) : null; }
function monthsBetween(a, b) { var da = parseCtDate(a), db = parseCtDate(b); if (!da || !db) return null; return (db - da) / (30.44 * 86400000); }

// Pull the fields we keep from a full version record
function snapshotFrom(versionJson) {
  var st = (versionJson && versionJson.study) || {};
  var p = st.protocolSection || {};
  var sm = p.statusModule || {};
  var dm = p.designModule || {};
  var om = p.outcomesModule || {};
  var ai = p.armsInterventionsModule || {};
  return {
    v: versionJson.studyVersion,
    status: sm.overallStatus || null,
    start: sm.startDateStruct ? sm.startDateStruct.date : null,
    startType: sm.startDateStruct ? sm.startDateStruct.type : null,
    pcd: sm.primaryCompletionDateStruct ? sm.primaryCompletionDateStruct.date : null,
    pcdType: sm.primaryCompletionDateStruct ? sm.primaryCompletionDateStruct.type : null,
    completion: sm.completionDateStruct ? sm.completionDateStruct.date : null,
    posted: sm.lastUpdatePostDateStruct ? sm.lastUpdatePostDateStruct.date : null,
    enroll: dm.enrollmentInfo ? dm.enrollmentInfo.count : null,
    enrollType: dm.enrollmentInfo ? dm.enrollmentInfo.type : null,
    phases: dm.phases || [],
    arms: (ai.armGroups || []).length || null,
    primaryOutcomes: (om.primaryOutcomes || []).map(function (o) { return { measure: o.measure || "", timeFrame: o.timeFrame || "" }; }).slice(0, 6),
    results: !!st.hasResults,
  };
}

// Choose which versions to sample: v0, the first version at least SAMPLE_INTERVAL_MONTHS after the
// previous sample, and the latest version, capped at MAX_SAMPLES (always keeping first and last).
function pickSampleVersions(changes) {
  if (!changes.length) return [];
  var picks = [changes[0]];
  var lastDate = changes[0].date;
  for (var i = 1; i < changes.length - 1; i++) {
    var m = monthsBetween(lastDate, changes[i].date);
    if (m != null && m >= SAMPLE_INTERVAL_MONTHS && changes[i].moduleLabels && changes[i].moduleLabels.indexOf("Study Status") !== -1) { picks.push(changes[i]); lastDate = changes[i].date; }
  }
  if (changes.length > 1) picks.push(changes[changes.length - 1]);
  while (picks.length > MAX_SAMPLES) picks.splice(Math.floor(picks.length / 2), 1);
  return picks.map(function (c) { return c.version; });
}

function buildRecord(nct, histJson, versionJsons, prev) {
  var h = (histJson && histJson.history) || {};
  var changes = (h.changes || []).slice().sort(function (a, b) { return a.version - b.version; });
  var od = h.originalData || {};
  var luv = h.lastUpdateVersions || {};
  var byVersion = {};
  versionJsons.forEach(function (vj) { if (vj && vj.studyVersion != null) byVersion[vj.studyVersion] = snapshotFrom(vj); });
  var samples = (prev && prev.samples ? prev.samples : []).filter(function (s) { return !(s.v in byVersion); }).concat(Object.keys(byVersion).map(function (k) { return byVersion[k]; }));
  samples.sort(function (a, b) { return a.v - b.v; });
  var original = samples.length && samples[0].v === 0 ? samples[0] : (prev && prev.original) || null;

  var timeline = [], lastStatus = null;
  var labels = {};
  changes.forEach(function (c) {
    if (c.status !== lastStatus) { timeline.push({ v: c.version, date: c.date, status: c.status }); lastStatus = c.status; }
    (c.moduleLabels || []).forEach(function (l) { labels[l] = (labels[l] || 0) + 1; });
  });
  var endpointChangedV = (od.primaryOutcomesSame === false && luv.primaryOutcomes != null) ? luv.primaryOutcomes : null;
  var endpointChange = changes.filter(function (c) { return c.version === endpointChangedV; })[0];
  var enrollChangedV = luv.enrollmentInfo != null ? luv.enrollmentInfo : null;
  var enrollChange = changes.filter(function (c) { return c.version === enrollChangedV; })[0];

  return {
    nct: nct,
    fetched: new Date().toISOString().substring(0, 10),
    versions: changes.length,
    lastVersion: changes.length ? changes[changes.length - 1].version : null,
    lastVersionDate: changes.length ? changes[changes.length - 1].date : null,
    firstDate: changes.length ? changes[0].date : null,
    original: original,
    originalEnroll: od.enrollmentInfo ? od.enrollmentInfo.count : (original ? original.enroll : null),
    originalEnrollType: od.enrollmentInfo ? od.enrollmentInfo.type : null,
    originalPrimaryOutcomes: od.primaryOutcomesSame === false ? (od.primaryOutcomes || []).map(function (o) { return { measure: o.measure || "", timeFrame: o.timeFrame || "" }; }).slice(0, 6) : null,
    endpointChanged: od.primaryOutcomesSame === false,
    endpointChangedVersion: endpointChangedV,
    endpointChangedDate: endpointChange ? endpointChange.date : null,
    outcomesUpdateCount: h.outcomesUpdateCount || 0,
    enrollLastChangedVersion: enrollChangedV,
    enrollLastChangedDate: enrollChange ? enrollChange.date : null,
    sponsorChanged: od.leadSponsorSame === false,
    timeline: timeline,
    moduleLabels: labels,
    samples: samples,
  };
}

// ------------------------------------------------------------
//  Trial list from the last site build
// ------------------------------------------------------------
function loadTrialList() {
  var list = [];
  var files = [];
  try { files = fs.readdirSync(TICKER_DIR).filter(function (f) { return /\.json$/.test(f); }); } catch (e) { return list; }
  files.forEach(function (f) {
    try {
      var d = JSON.parse(fs.readFileSync(path.join(TICKER_DIR, f), "utf8"));
      (d.trials || []).forEach(function (t) { list.push({ nct: t.nct, ticker: d.ticker, importance: t.importance || 0, lastUpdate: t.lastUpdate || "", status: t.status }); });
    } catch (e) { /* skip bad file */ }
  });
  return list;
}

// ------------------------------------------------------------
//  Browser
// ------------------------------------------------------------
async function openBrowser() {
  var puppeteer = require("puppeteer");
  var browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  var page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.goto("https://clinicaltrials.gov/study/NCT05556512", { waitUntil: "networkidle2", timeout: 90000 });
  return { browser: browser, page: page };
}

// Fetch a list of relative URLs from inside the page. Returns [{status, json|null}].
async function pageFetch(page, urls) {
  return page.evaluate(async function (list, pause) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      try {
        var r = await fetch(list[i], { headers: { "Accept": "application/json" } });
        var t = await r.text();
        var j = null; try { j = JSON.parse(t); } catch (e) { /* not json */ }
        out.push({ status: r.status, json: j });
      } catch (e) { out.push({ status: 0, json: null, error: String(e) }); }
      await new Promise(function (res) { setTimeout(res, pause); });
    }
    return out;
  }, urls, PAUSE_MS);
}

// ------------------------------------------------------------
//  Main
// ------------------------------------------------------------
async function main() {
  var started = Date.now();
  console.log("=== History collector " + new Date().toISOString() + " ===");
  fs.mkdirSync(HIST_DIR, { recursive: true });

  var trials = loadTrialList();
  if (!trials.length) { console.log("No trials found under data/pipeline/tickers. Run the site build first."); return; }
  console.log("Trials in site data: " + trials.length);

  // Decide what needs work: never collected, or CT.gov record updated after our last collected version date
  var todo = [], done = 0, fresh = 0;
  trials.forEach(function (t) {
    var rec = getShard(t.nct)[t.nct];
    if (!rec) { todo.push(Object.assign({ mode: "full" }, t)); return; }
    done++;
    if (t.lastUpdate && rec.lastVersionDate && t.lastUpdate > rec.lastVersionDate) todo.push(Object.assign({ mode: "refresh" }, t)); else fresh++;
  });
  todo.sort(function (a, b) { return (a.mode === "refresh" ? 0 : 1) - (b.mode === "refresh" ? 0 : 1) || b.importance - a.importance; });
  console.log("Already collected: " + done + " (" + fresh + " current) | to do: " + todo.length + " | budget this run: " + BUDGET);
  var work = todo.slice(0, BUDGET);
  if (!work.length) { console.log("Nothing to do."); return; }

  var env = await openBrowser();
  var page = env.page;
  var processed = 0, errors = 0, consecutive = 0, calls = 0;
  var progress = { lastRun: new Date().toISOString(), processed: 0, remainingAfterRun: todo.length - work.length };

  try {
    for (var i = 0; i < work.length; i++) {
      if ((Date.now() - started) / 60000 > MAX_RUN_MINUTES) { console.log("Time budget reached, stopping cleanly."); break; }
      var t = work[i];
      var prev = getShard(t.nct)[t.nct] || null;

      // 1. history list
      var r1 = (await pageFetch(page, ["/api/int/studies/" + t.nct + "?history=true"]))[0];
      calls++;
      if (r1.status !== 200 || !r1.json || !r1.json.history) {
        errors++; consecutive++;
        console.log("  " + t.nct + " history list failed (status " + r1.status + ")");
        if (consecutive >= 5) { console.log("  5 consecutive failures, pausing 90s and reloading page"); await new Promise(function (r) { setTimeout(r, 90000); }); try { await page.goto("https://clinicaltrials.gov/study/" + t.nct, { waitUntil: "networkidle2", timeout: 90000 }); } catch (e) { /* ignore */ } consecutive = 0; }
        continue;
      }
      consecutive = 0;
      var changes = (r1.json.history.changes || []).slice().sort(function (a, b) { return a.version - b.version; });

      // 2. which versions to fetch
      var want;
      if (t.mode === "refresh" && prev) {
        var have = {}; (prev.samples || []).forEach(function (s) { have[s.v] = 1; });
        want = changes.length ? [changes[changes.length - 1].version].filter(function (v) { return !have[v]; }) : [];
        if (!prev.original) want.unshift(0);
      } else {
        want = pickSampleVersions(changes);
      }
      var versionJsons = [];
      for (var b = 0; b < want.length; b += BATCH) {
        var urls = want.slice(b, b + BATCH).map(function (v) { return "/api/int/studies/" + t.nct + "/history/" + v; });
        var rs = await pageFetch(page, urls);
        calls += urls.length;
        rs.forEach(function (r) { if (r.status === 200 && r.json && r.json.study) versionJsons.push(r.json); });
      }

      var rec = buildRecord(t.nct, r1.json, versionJsons, prev);
      getShard(t.nct)[t.nct] = rec;
      processed++;
      if (processed % 25 === 0) { flushShards(); console.log("  " + processed + "/" + work.length + " done, " + calls + " calls, " + Math.round((Date.now() - started) / 60000) + " min"); }
    }
  } finally {
    flushShards();
    progress.processed = processed; progress.errors = errors; progress.calls = calls;
    progress.collected = trials.filter(function (t) { return !!getShard(t.nct)[t.nct]; }).length;
    progress.total = trials.length;
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
    await env.browser.close();
  }
  console.log("");
  console.log("Processed " + processed + " trials (" + errors + " errors, " + calls + " calls) in " + Math.round((Date.now() - started) / 60000) + " min");
  console.log("Collected so far: " + progress.collected + " of " + progress.total + " mapped trials. Remaining after this run: " + Math.max(0, todo.length - processed));
  console.log("=== DONE ===");
}

if (require.main === module) {
  main().catch(function (e) { console.error("FATAL:", e.message || e); process.exit(1); });
}
module.exports = { buildRecord, pickSampleVersions, snapshotFrom };
