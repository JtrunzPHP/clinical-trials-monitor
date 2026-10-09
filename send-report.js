// send-report.js - Clinical Trials Daily Digest v4.1
// v4.1: company map moved to tickers.js (shared with build-pipeline.js)
//
// What v4 adds on top of v3:
//   1. Industry-sponsor focus. Every study is classified by sponsor class (CT.gov tags
//      each sponsor as INDUSTRY, NIH, FED, OTHER etc). Only studies with an industry lead
//      sponsor or industry collaborator make it into the email. Academic and hospital
//      noise is dropped, which also fixes the false "UNH" hits.
//   2. Public-company ticker map. A large sponsor-name-to-ticker map tags every public
//      company it recognizes. Your original watchlist (with investment context) is kept
//      as the "coverage" tier and gets the premium treatment. Industry sponsors that are
//      not in the map are listed at the bottom so you can add them over time.
//   3. Field-level change tracking. A snapshot of key fields per study is kept in
//      study-state.json and diffed on each run: status changes, primary completion
//      date slips, enrollment cuts, enrollment finalized, results posted. The email
//      says what changed, not just that something changed. (Diffs start on run 2.)
//   4. Materiality score. Each study gets a score from phase, status, enrollment,
//      sponsor, ticker tier and the size of the change. A "Top signals" section leads.
//   5. Readout calendar. Live query of Phase 3 industry studies with a primary
//      completion date in the next 90 days, plus studies whose primary completion
//      passed 6+ months ago with no results posted.
//   6. Therapeutic-area watchlist. Condition and intervention keyword themes
//      (GLP-1/obesity, Alzheimer's, T1D, dialysis, etc) tag competitor activity
//      regardless of sponsor.
//   7. CSV attachment with the full hit list for sorting in Excel.
//   8. Separate "CT ALERT" email for urgent items (Phase 2/3 industry terminations,
//      suspensions, withdrawals, or any coverage-ticker termination). Set ALERT_ONLY=true
//      in a second, more frequent workflow to get these intraday.
//   9. Pagination fixed (pageSize 1000, correct totals, no 500-row cap).
//
// Files this script reads and writes in the repo:
//   last-sent.json    dedup keys (NCT ID + LastUpdatePostDate), 72h expiry
//   study-state.json  per-study field snapshot for change tracking, plus alert log
//
// GitHub Secrets used: RESEND_API_KEY, RECIPIENT_EMAILS (comma separated), FROM_EMAIL (optional)
// Optional env: ALERT_ONLY=true (alerts only, no digest), DRY_RUN=true (write HTML to disk, do not send)

"use strict";

const fs = require("fs");
const path = require("path");

// ============================================================
//  CONFIGURATION
// ============================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "Clinical Trials Monitor <onboarding@resend.dev>";
const RECIPIENT_EMAILS = (process.env.RECIPIENT_EMAILS || process.env.RECIPIENT_EMAIL || "")
  .split(",").map(function (e) { return e.trim(); }).filter(Boolean);
const ALERT_ONLY = String(process.env.ALERT_ONLY || "").toLowerCase() === "true";
const DRY_RUN = String(process.env.DRY_RUN || "").toLowerCase() === "true";

const DASHBOARD_URL = "https://jtrunzphp.github.io/clinical-trials-monitor/";

const CT_API = "https://clinicaltrials.gov/api/v2/studies";
const SENT_FILE = path.join(__dirname, "last-sent.json");
const STATE_FILE = path.join(__dirname, "study-state.json");

const LOOKBACK_DAYS = 2;                         // calendar days, handles date-only granularity
const DEDUP_EXPIRY_MS = 72 * 60 * 60 * 1000;     // 72h
const STATE_RETENTION_DAYS = 400;                // drop studies not seen in this many days
const PAGE_SIZE = 1000;                          // CT.gov v2 max page size
const MAX_PAGES = 5;                             // 5,000 studies per category, plenty for a 2-day window
const CALENDAR_DAYS_AHEAD = 90;                  // readout calendar window
const OVERDUE_MIN_MONTHS = 6;                    // primary completion passed at least this long ago
const OVERDUE_MAX_MONTHS = 18;                   // and no more than this long ago

const TOP_SIGNALS = 8;
const TOP_MIN_SCORE = 70;                        // top signals shows non-coverage studies at or above this score
const MAX_COVERAGE_ROWS = 40;
const MAX_CHANGE_ROWS = 25;
const MAX_PUBLIC_ROWS = 40;
const MAX_THEME_ROWS = 15;
const MAX_CALENDAR_ROWS = 30;
const MAX_OVERDUE_ROWS = 15;
const MAX_UNMAPPED = 15;

// ------------------------------------------------------------
//  COVERAGE TIER - your names, with investment context.
//  These get the premium row treatment and the biggest score boost.
//  Matching is whole-word, case-insensitive, and only against sponsors
//  CT.gov classifies as INDUSTRY, so "Abbott Northwestern Hospital" will
//  no longer match ABT.
// ------------------------------------------------------------

// Company map and themes live in tickers.js so the digest and the website share one list.
const T = require("./tickers.js");
const COVERAGE = T.COVERAGE, PUBLIC_SPONSORS = T.PUBLIC_SPONSORS, THEMES = T.THEMES;

// ------------------------------------------------------------
//  STATUS GROUPS
// ------------------------------------------------------------

const CATEGORIES = [
  { key: "terminated", label: "Terminated / Withdrawn / Suspended", statuses: "TERMINATED,WITHDRAWN,SUSPENDED", color: "#ef4444", icon: "&#x26D4;", shortLabel: "Terminated" },
  { key: "progressed", label: "Progressed", statuses: "ACTIVE_NOT_RECRUITING,COMPLETED,ENROLLING_BY_INVITATION", color: "#22c55e", icon: "&#x1F680;", shortLabel: "Progressed" },
  { key: "released",   label: "Newly Posted", statuses: "NOT_YET_RECRUITING,RECRUITING", color: "#3b82f6", icon: "&#x1F195;", shortLabel: "New" },
];

const STATUS_LABELS = {
  TERMINATED: "Terminated", WITHDRAWN: "Withdrawn", SUSPENDED: "Suspended", COMPLETED: "Completed",
  ACTIVE_NOT_RECRUITING: "Active, not recruiting", ENROLLING_BY_INVITATION: "Enrolling by invitation",
  RECRUITING: "Recruiting", NOT_YET_RECRUITING: "Not yet recruiting", UNKNOWN: "Unknown",
};

const STATUS_SCORE = { TERMINATED: 30, WITHDRAWN: 25, SUSPENDED: 30, COMPLETED: 15, ACTIVE_NOT_RECRUITING: 15, ENROLLING_BY_INVITATION: 5, RECRUITING: 5, NOT_YET_RECRUITING: 3 };
const PHASE_SCORE = { "PHASE3": 40, "PHASE2|PHASE3": 35, "PHASE2": 25, "PHASE1|PHASE2": 15, "PHASE1": 10, "PHASE4": 15, "EARLY_PHASE1": 5, "NA": 10, "": 5 };

// Fields requested from the API. Keeps payloads small. If CT.gov rejects the list,
// the fetch falls back to full records automatically.
const API_FIELDS = [
  "NCTId", "BriefTitle", "OverallStatus", "WhyStopped", "LastUpdatePostDate", "StartDate",
  "PrimaryCompletionDate", "CompletionDate", "Phase", "EnrollmentCount", "EnrollmentType",
  "LeadSponsorName", "LeadSponsorClass", "CollaboratorName", "CollaboratorClass",
  "Condition", "InterventionName", "StudyType", "HasResults", "ResultsFirstPostDate",
].join(",");

// ============================================================
//  SMALL HELPERS
// ============================================================

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function isoDate(d) { return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
function addMonths(d, n) { var x = new Date(d.getTime()); x.setUTCMonth(x.getUTCMonth() + n); return x; }

// CT.gov dates come as "2027-06" or "2027-06-15"
function parseCtDate(s) {
  if (!s) return null;
  var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1));
}
function fmtMonth(s) {
  var d = parseCtDate(s);
  if (!d) return s || "n/a";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
function fmtDate(s) {
  var d = parseCtDate(s);
  if (!d) return s || "n/a";
  if (/^\d{4}-\d{2}$/.test(s)) return fmtMonth(s);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function monthsBetween(a, b) {
  var da = parseCtDate(a), db = parseCtDate(b);
  if (!da || !db) return null;
  return Math.round(((db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth()) + (db.getUTCDate() - da.getUTCDate()) / 30) * 10) / 10;
}
function fmtNum(n) { return (n == null) ? "n/a" : Number(n).toLocaleString("en-US"); }
function statusLabel(s) { return STATUS_LABELS[s] || String(s || "UNKNOWN").replace(/_/g, " "); }
function phaseLabel(phases) {
  if (!phases || phases.length === 0) return "";
  return phases.map(function (p) { return p === "NA" ? "N/A" : p.replace("EARLY_PHASE1", "Early Ph 1").replace("PHASE", "Ph "); }).join("/");
}
function statusColor(s) {
  var map = { TERMINATED: "#ef4444", WITHDRAWN: "#ef4444", SUSPENDED: "#f59e0b", COMPLETED: "#22c55e",
    ACTIVE_NOT_RECRUITING: "#22c55e", ENROLLING_BY_INVITATION: "#3b82f6", RECRUITING: "#3b82f6", NOT_YET_RECRUITING: "#8b5cf6" };
  return map[s] || "#6b7280";
}
function csvCell(v) {
  var s = String(v == null ? "" : v);
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ============================================================
//  STUDY FIELD EXTRACTION
// ============================================================

function extractFields(study) {
  var p = study.protocolSection || {};
  var id = p.identificationModule || {};
  var sm = p.statusModule || {};
  var dm = p.designModule || {};
  var sp = p.sponsorCollaboratorsModule || {};
  var ai = p.armsInterventionsModule || {};
  var lead = sp.leadSponsor || {};
  var collabs = sp.collaborators || [];
  var phases = (dm.phases || []).slice();
  return {
    nct: id.nctId || "",
    title: id.briefTitle || "Untitled",
    status: sm.overallStatus || "UNKNOWN",
    statusLabel: statusLabel(sm.overallStatus),
    updated: sm.lastUpdatePostDateStruct ? sm.lastUpdatePostDateStruct.date : null,
    start: sm.startDateStruct ? sm.startDateStruct.date : null,
    pcd: sm.primaryCompletionDateStruct ? sm.primaryCompletionDateStruct.date : null,
    pcdType: sm.primaryCompletionDateStruct ? sm.primaryCompletionDateStruct.type : null,
    completion: sm.completionDateStruct ? sm.completionDateStruct.date : null,
    resultsPosted: !!study.hasResults,
    resultsDate: sm.resultsFirstPostDateStruct ? sm.resultsFirstPostDateStruct.date : null,
    phases: phases,
    phaseKey: phases.join("|"),
    phaseText: phaseLabel(phases),
    studyType: dm.studyType || "",
    enrollment: dm.enrollmentInfo ? dm.enrollmentInfo.count : null,
    enrollmentType: dm.enrollmentInfo ? dm.enrollmentInfo.type : null,
    sponsor: lead.name || "Unknown",
    sponsorClass: lead.class || "",
    collaborators: collabs.map(function (c) { return { name: c.name || "", cls: c.class || "" }; }),
    whyStopped: sm.whyStopped || "",
    conditions: ((p.conditionsModule || {}).conditions || []).slice(0, 4),
    interventions: (ai.interventions || []).map(function (i) { return i.name || ""; }).filter(Boolean).slice(0, 4),
  };
}

function isIndustry(f) {
  if (f.sponsorClass === "INDUSTRY") return true;
  for (var i = 0; i < f.collaborators.length; i++) if (f.collaborators[i].cls === "INDUSTRY") return true;
  return false;
}

// ============================================================
//  TICKER + THEME MATCHING
// ============================================================

function matchTicker(f) {
  // Only industry-class sponsor names are eligible. Lead sponsor first, then collaborators.
  var names = [];
  if (f.sponsorClass === "INDUSTRY") names.push({ name: f.sponsor, role: "lead" });
  for (var c = 0; c < f.collaborators.length; c++) {
    if (f.collaborators[c].cls === "INDUSTRY") names.push({ name: f.collaborators[c].name, role: "collaborator" });
  }
  return T.matchNames(names);
}

function matchThemes(f) {
  var hay = (f.conditions.join(" | ") + " | " + f.interventions.join(" | ") + " | " + f.title).toLowerCase();
  var hits = [];
  for (var i = 0; i < THEMES.length; i++) {
    for (var j = 0; j < THEMES[i].terms.length; j++) {
      var t = THEMES[i].terms[j].toLowerCase();
      // short tokens get word boundaries so "bph" does not match inside other words
      var ok = t.length <= 5 ? new RegExp("\\b" + escRe(t) + "\\b").test(hay) : hay.indexOf(t) !== -1;
      if (ok) { hits.push(THEMES[i].label); break; }
    }
  }
  return hits;
}

// ============================================================
//  DEDUP (unchanged from v3: composite key NCT ID + LastUpdatePostDate)
// ============================================================

function dedupKey(f) { return (f.nct || "") + "|" + (f.updated || ""); }

function loadSentData() {
  try {
    var data = JSON.parse(fs.readFileSync(SENT_FILE, "utf8"));
    if (data.timestamp && data.timestamp < Date.now() - DEDUP_EXPIRY_MS) {
      console.log("  Sent data expired (>72h old), starting fresh");
      return { ids: {}, timestamp: 0 };
    }
    console.log("  Loaded " + Object.keys(data.ids || {}).length + " previously sent dedup keys");
    return data;
  } catch (e) {
    console.log("  No previous sent data found, starting fresh");
    return { ids: {}, timestamp: 0 };
  }
}

function saveSentData(newIds) {
  var existing = loadSentData();
  var merged = Object.assign({}, existing.ids || {}, newIds);
  var cutoff = Date.now() - DEDUP_EXPIRY_MS;
  var pruned = {};
  Object.keys(merged).forEach(function (k) { if (merged[k] > cutoff) pruned[k] = merged[k]; });
  fs.writeFileSync(SENT_FILE, JSON.stringify({ ids: pruned, timestamp: Date.now() }, null, 2));
  console.log("  Saved " + Object.keys(pruned).length + " dedup keys to last-sent.json");
}

// ============================================================
//  STUDY STATE (field snapshot for change tracking) + ALERT LOG
// ============================================================

function loadState() {
  try {
    var s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!s.studies) s.studies = {};
    if (!s.alerted) s.alerted = {};
    console.log("  Loaded state for " + Object.keys(s.studies).length + " studies, " + Object.keys(s.alerted).length + " alert keys");
    return s;
  } catch (e) {
    console.log("  No study-state.json found, change tracking starts with this run");
    return { studies: {}, alerted: {}, timestamp: 0 };
  }
}

function snapshotOf(f) {
  return {
    status: f.status, phase: f.phaseKey, enrollment: f.enrollment, enrollmentType: f.enrollmentType,
    pcd: f.pcd, completion: f.completion, results: f.resultsPosted, updated: f.updated,
    sponsor: f.sponsor, title: f.title.substring(0, 120), seen: Date.now(),
  };
}

function saveState(state) {
  var cutoff = Date.now() - STATE_RETENTION_DAYS * 86400000;
  var kept = {};
  Object.keys(state.studies).forEach(function (k) { if ((state.studies[k].seen || 0) > cutoff) kept[k] = state.studies[k]; });
  var alerts = {};
  var alertCutoff = Date.now() - 30 * 86400000;
  Object.keys(state.alerted).forEach(function (k) { if (state.alerted[k] > alertCutoff) alerts[k] = state.alerted[k]; });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ studies: kept, alerted: alerts, timestamp: Date.now() }, null, 1));
  console.log("  Saved state for " + Object.keys(kept).length + " studies to study-state.json");
}

// Compare the prior snapshot with the current fields. Returns a list of
// { kind, text, weight } describing what changed.
function diffStudy(prev, f) {
  var changes = [];
  if (!prev) return changes;

  if (prev.status && prev.status !== f.status) {
    var w = (f.status === "TERMINATED" || f.status === "SUSPENDED" || f.status === "WITHDRAWN") ? 35 : (f.status === "ACTIVE_NOT_RECRUITING" || f.status === "COMPLETED") ? 20 : 12;
    changes.push({ kind: "status", weight: w, text: "Status changed from " + statusLabel(prev.status) + " to " + statusLabel(f.status) });
  }
  if (prev.pcd && f.pcd && prev.pcd !== f.pcd) {
    var m = monthsBetween(prev.pcd, f.pcd);
    if (m != null && m >= 1) {
      changes.push({ kind: "pcd_slip", weight: m >= 6 ? 28 : 16, text: "Primary completion pushed from " + fmtMonth(prev.pcd) + " to " + fmtMonth(f.pcd) + " (+" + Math.round(m) + " mo)" });
    } else if (m != null && m <= -1) {
      changes.push({ kind: "pcd_pull", weight: 12, text: "Primary completion pulled forward from " + fmtMonth(prev.pcd) + " to " + fmtMonth(f.pcd) + " (" + Math.round(m) + " mo)" });
    }
  }
  if (prev.completion && f.completion && prev.completion !== f.completion && !(prev.pcd !== f.pcd)) {
    var mc = monthsBetween(prev.completion, f.completion);
    if (mc != null && Math.abs(mc) >= 1) {
      changes.push({ kind: "completion", weight: 6, text: "Study completion moved from " + fmtMonth(prev.completion) + " to " + fmtMonth(f.completion) });
    }
  }
  if (prev.enrollment != null && f.enrollment != null && prev.enrollment !== f.enrollment && prev.enrollment > 0) {
    var pct = (f.enrollment - prev.enrollment) / prev.enrollment;
    if (prev.enrollmentType === "ESTIMATED" && f.enrollmentType === "ACTUAL") {
      changes.push({ kind: "enroll_final", weight: pct <= -0.2 ? 24 : 10, text: "Enrollment finalized at " + fmtNum(f.enrollment) + " (was estimated " + fmtNum(prev.enrollment) + ", " + Math.round(pct * 100) + "%)" });
    } else if (pct <= -0.1) {
      changes.push({ kind: "enroll_cut", weight: pct <= -0.25 ? 30 : 18, text: "Target enrollment cut from " + fmtNum(prev.enrollment) + " to " + fmtNum(f.enrollment) + " (" + Math.round(pct * 100) + "%)" });
    } else if (pct >= 0.25) {
      changes.push({ kind: "enroll_up", weight: 8, text: "Target enrollment raised from " + fmtNum(prev.enrollment) + " to " + fmtNum(f.enrollment) + " (+" + Math.round(pct * 100) + "%)" });
    }
  } else if (prev.enrollmentType === "ESTIMATED" && f.enrollmentType === "ACTUAL" && f.enrollment != null) {
    changes.push({ kind: "enroll_final", weight: 8, text: "Enrollment finalized at " + fmtNum(f.enrollment) });
  }
  if (!prev.results && f.resultsPosted) {
    changes.push({ kind: "results", weight: 26, text: "Results posted" + (f.resultsDate ? " (" + fmtDate(f.resultsDate) + ")" : "") });
  }
  if (prev.phase && prev.phase !== f.phaseKey) {
    changes.push({ kind: "phase", weight: 10, text: "Phase changed from " + phaseLabel(prev.phase.split("|")) + " to " + (f.phaseText || "n/a") });
  }
  return changes;
}

// ============================================================
//  MATERIALITY SCORE
// ============================================================

function scoreStudy(f, tk, themes, changes) {
  var s = 0;
  s += PHASE_SCORE[f.phaseKey] != null ? PHASE_SCORE[f.phaseKey] : 8;
  s += STATUS_SCORE[f.status] || 0;
  if (f.enrollment >= 1000) s += 20; else if (f.enrollment >= 500) s += 15; else if (f.enrollment >= 200) s += 10; else if (f.enrollment >= 50) s += 5;
  if (f.sponsorClass === "INDUSTRY") s += 10;
  if (f.studyType === "INTERVENTIONAL") s += 5;
  if (tk && tk.coverage) s += 25; else if (tk) s += 10;
  if (themes.length) s += 5;
  if (f.whyStopped) s += 5;
  var cw = 0;
  for (var i = 0; i < changes.length; i++) cw += changes[i].weight;
  s += Math.min(cw, 40);
  return s;
}

// ============================================================
//  API
// ============================================================

function buildUrl(term, statuses, pageToken, useFields) {
  var url = CT_API + "?format=json&pageSize=" + PAGE_SIZE + "&countTotal=true&sort=LastUpdatePostDate:desc"
    + "&query.term=" + encodeURIComponent(term);
  if (statuses) url += "&filter.overallStatus=" + encodeURIComponent(statuses);
  if (useFields) url += "&fields=" + encodeURIComponent(API_FIELDS);
  if (pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
  return url;
}

async function fetchJson(url) {
  var lastErr = null;
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var resp = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "clinical-trials-monitor/4.0" } });
      if (resp.ok) return { ok: true, data: await resp.json() };
      var body = await resp.text().catch(function () { return ""; });
      lastErr = new Error("API " + resp.status + ": " + body.substring(0, 300));
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) return { ok: false, status: resp.status, error: lastErr };
    } catch (e) { lastErr = e; }
    await new Promise(function (r) { setTimeout(r, 1500 * attempt); });
  }
  return { ok: false, status: 0, error: lastErr };
}

var FIELDS_SUPPORTED = true;

async function fetchStudies(term, statuses, maxPages) {
  var all = [], token = null, total = 0;
  for (var pg = 0; pg < maxPages; pg++) {
    var url = buildUrl(term, statuses, token, FIELDS_SUPPORTED);
    if (pg === 0) console.log("    URL: " + url.substring(0, 160) + "...");
    var r = await fetchJson(url);
    if (!r.ok && FIELDS_SUPPORTED && r.status === 400 && pg === 0) {
      console.log("    fields parameter rejected, retrying with full records");
      FIELDS_SUPPORTED = false;
      url = buildUrl(term, statuses, token, false);
      r = await fetchJson(url);
    }
    if (!r.ok) throw r.error || new Error("API fetch failed");
    var data = r.data;
    if (pg === 0) total = data.totalCount || 0;   // v3 bug: later pages overwrote this with 0
    all = all.concat(data.studies || []);
    console.log("    page " + (pg + 1) + ": " + (data.studies || []).length + " studies (API total " + total + ")");
    token = data.nextPageToken;
    if (!token) break;
  }
  return { studies: all, totalCount: total };
}

// ============================================================
//  CORE: fetch, classify, diff, score
// ============================================================

function enrich(study, state) {
  var f = extractFields(study);
  f.industry = isIndustry(f);
  f.ticker = matchTicker(f);
  f.themes = matchThemes(f);
  f.changes = diffStudy(state.studies[f.nct], f);
  f.score = scoreStudy(f, f.ticker, f.themes, f.changes);
  f.link = "https://clinicaltrials.gov/study/" + f.nct;
  return f;
}

function isUrgent(f) {
  if (!f.industry) return false;
  if (!(f.status === "TERMINATED" || f.status === "SUSPENDED" || f.status === "WITHDRAWN")) return false;
  if (f.ticker && f.ticker.coverage) return true;
  return f.phases.indexOf("PHASE3") !== -1 || f.phases.indexOf("PHASE2") !== -1;
}

async function fetchCategories(sinceStr, prev, state, onlyTerminated) {
  var term = "AREA[LastUpdatePostDate]RANGE[" + sinceStr + ",MAX]";
  var results = { cats: {}, newIds: {}, rawTotal: 0, industryTotal: 0, all: [] };
  var cats = onlyTerminated ? CATEGORIES.slice(0, 1) : CATEGORIES;

  for (var i = 0; i < cats.length; i++) {
    var cat = cats[i];
    console.log("  Fetching " + cat.label + "...");
    var raw = await fetchStudies(term, cat.statuses, MAX_PAGES);
    var fresh = [], dupes = 0, nonIndustry = 0;
    for (var j = 0; j < raw.studies.length; j++) {
      var f = enrich(raw.studies[j], state);
      var key = dedupKey(f);
      if (key && prev[key]) { dupes++; continue; }
      results.newIds[key] = Date.now();
      if (!f.industry) { nonIndustry++; continue; }
      f.category = cat;
      fresh.push(f);
    }
    console.log("    API total " + raw.totalCount + ", fetched " + raw.studies.length + ", dupes " + dupes + ", non-industry " + nonIndustry + ", industry new " + fresh.length);
    results.rawTotal += raw.studies.length - dupes;
    results.industryTotal += fresh.length;
    results.cats[cat.key] = { studies: fresh, totalCount: fresh.length };
    results.all = results.all.concat(fresh);
  }
  return results;
}

// Readout calendar and overdue queries (live, independent of what changed today)
async function fetchCalendar(now) {
  var out = { upcoming: [], overdue: [] };
  try {
    var t0 = isoDate(now), t1 = isoDate(addDays(now, CALENDAR_DAYS_AHEAD));
    var term = "AREA[PrimaryCompletionDate]RANGE[" + t0 + "," + t1 + "] AND AREA[LeadSponsorClass]INDUSTRY AND AREA[Phase]PHASE3";
    console.log("  Fetching readout calendar (next " + CALENDAR_DAYS_AHEAD + " days)...");
    var r = await fetchStudies(term, "ACTIVE_NOT_RECRUITING,RECRUITING,ENROLLING_BY_INVITATION", 2);
    for (var i = 0; i < r.studies.length; i++) {
      var f = extractFields(r.studies[i]);
      f.ticker = matchTicker(f);
      if (!f.ticker || f.ticker.ticker === "PRIVATE") continue;
      f.link = "https://clinicaltrials.gov/study/" + f.nct;
      out.upcoming.push(f);
    }
    out.upcoming.sort(function (a, b) { return (a.pcd || "").localeCompare(b.pcd || "") || (a.ticker.coverage ? -1 : 1); });
  } catch (e) { console.log("  Calendar query failed (skipping): " + (e.message || e)); }

  try {
    var o0 = isoDate(addMonths(now, -OVERDUE_MAX_MONTHS)), o1 = isoDate(addMonths(now, -OVERDUE_MIN_MONTHS));
    var term2 = "AREA[PrimaryCompletionDate]RANGE[" + o0 + "," + o1 + "] AND AREA[LeadSponsorClass]INDUSTRY AND AREA[Phase]PHASE3 AND AREA[ResultsFirstPostDate]MISSING";
    console.log("  Fetching overdue readouts (" + OVERDUE_MIN_MONTHS + " to " + OVERDUE_MAX_MONTHS + " months past primary completion, no results)...");
    var r2 = await fetchStudies(term2, "COMPLETED,ACTIVE_NOT_RECRUITING", 2);
    for (var k = 0; k < r2.studies.length; k++) {
      var g = extractFields(r2.studies[k]);
      if (g.resultsPosted) continue;
      g.ticker = matchTicker(g);
      if (!g.ticker || g.ticker.ticker === "PRIVATE") continue;
      g.link = "https://clinicaltrials.gov/study/" + g.nct;
      out.overdue.push(g);
    }
    out.overdue.sort(function (a, b) { return (a.ticker.coverage ? 0 : 1) - (b.ticker.coverage ? 0 : 1) || (a.pcd || "").localeCompare(b.pcd || ""); });
  } catch (e) { console.log("  Overdue query failed (skipping): " + (e.message || e)); }
  return out;
}

// ============================================================
//  EMAIL BUILDING BLOCKS
// ============================================================

function pill(text, color, bg) {
  return '<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:' + (bg || (color + '18')) + ';color:' + color + ';font-weight:600;white-space:nowrap;">' + esc(text) + '</span>';
}
function tickerBadge(tk, big) {
  if (!tk) return "";
  var isCov = tk.coverage;
  var bg = isCov ? "#1e1b4b" : "#e5e7eb", fg = isCov ? "#a5b4fc" : "#374151";
  return '<span style="display:inline-block;padding:' + (big ? '3px 10px' : '1px 6px') + ';border-radius:6px;background:' + bg + ';color:' + fg + ';font-size:' + (big ? '12' : '10') + 'px;font-weight:800;font-family:monospace;letter-spacing:0.5px;">' + esc(tk.ticker) + '</span>';
}
function changesHTML(changes, size) {
  if (!changes || changes.length === 0) return "";
  var h = "";
  for (var i = 0; i < changes.length; i++) {
    var c = changes[i];
    var color = (c.kind === "pcd_slip" || c.kind === "enroll_cut" || (c.kind === "status" && /Terminated|Suspended|Withdrawn/.test(c.text))) ? "#b91c1c" : (c.kind === "results" || c.kind === "pcd_pull") ? "#047857" : "#92400e";
    h += '<div style="font-size:' + (size || 12) + 'px;color:' + color + ';font-weight:600;margin-top:3px;">&#x25B8; ' + esc(c.text) + '</div>';
  }
  return h;
}
function metaLine(f) {
  var parts = [esc(f.sponsor)];
  if (f.enrollment != null) parts.push(fmtNum(f.enrollment) + (f.enrollmentType === "ACTUAL" ? " enrolled" : " target"));
  if (f.pcd) parts.push("Primary completion " + esc(fmtMonth(f.pcd)));
  if (f.conditions.length) parts.push(esc(f.conditions.slice(0, 3).join(", ")));
  if (f.interventions.length) parts.push(esc(f.interventions.slice(0, 2).join(", ")));
  parts.push("Updated " + esc(fmtDate(f.updated)));
  return parts.join(" &middot; ");
}

function sectionHeader(icon, title, sub, color, bg) {
  return '<tr><td style="padding:10px 16px;background:' + bg + ';border-left:4px solid ' + color + ';">'
    + '<span style="font-size:15px;">' + icon + '</span> <span style="font-size:14px;font-weight:700;color:' + color + ';">' + esc(title) + '</span>'
    + (sub ? ' <span style="font-size:12px;color:#6b7280;">' + esc(sub) + '</span>' : '') + '</td></tr>';
}
function wrapSection(inner) {
  return '<tr><td style="padding:14px 28px 4px;"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">' + inner + '</table></td></tr>';
}
function moreRow(n, label) {
  if (n <= 0) return "";
  return '<tr><td style="padding:8px 16px;text-align:center;font-size:12px;color:#6b7280;">+ ' + n + ' more ' + esc(label || "") + ' in the attached CSV</td></tr>';
}

// Premium row (top signals + coverage)
function bigRow(f, showContext) {
  var c = statusColor(f.status);
  var title = f.title.length > 120 ? f.title.substring(0, 120) + "..." : f.title;
  var h = '<tr><td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;">';
  h += '<div style="margin-bottom:5px;">' + tickerBadge(f.ticker, true);
  if (f.ticker) h += ' <span style="font-size:11px;color:#9ca3af;">' + esc(f.ticker.sector) + (f.ticker.role === "collaborator" ? " (collaborator)" : "") + '</span>';
  if (f.themes.length) h += ' ' + pill(f.themes.join(" / "), "#7c3aed", "#f3e8ff");
  h += ' <span style="font-size:10px;color:#9ca3af;float:right;">score ' + f.score + '</span></div>';
  h += '<div style="border-left:3px solid ' + c + ';padding-left:12px;">';
  h += '<div style="margin-bottom:3px;"><a href="' + f.link + '" style="font-family:monospace;font-size:12px;color:' + c + ';font-weight:700;text-decoration:none;">' + esc(f.nct) + '</a> '
    + pill(f.statusLabel, c) + (f.phaseText ? ' ' + pill(f.phaseText, "#6b7280", "#f3f4f6") : '') + '</div>';
  h += '<div style="font-size:14px;font-weight:600;color:#111827;margin:3px 0;line-height:1.35;">' + esc(title) + '</div>';
  h += '<div style="font-size:12px;color:#9ca3af;">' + metaLine(f) + '</div>';
  if (f.whyStopped) h += '<div style="font-size:12px;color:#ef4444;font-weight:600;margin-top:3px;">&#x26A0;&#xFE0F; Why stopped: ' + esc(f.whyStopped) + '</div>';
  h += changesHTML(f.changes, 12);
  if (showContext && f.ticker && f.ticker.context) h += '<div style="font-size:11px;color:#6366f1;margin-top:4px;font-style:italic;">' + esc(f.ticker.context) + '</div>';
  h += '</div></td></tr>';
  return h;
}

// Compact row (public tier, themes, categories)
function smallRow(f, color) {
  var title = f.title.length > 100 ? f.title.substring(0, 100) + "..." : f.title;
  var h = '<tr><td style="padding:8px 16px;border-bottom:1px solid #f3f4f6;"><div style="border-left:3px solid ' + color + ';padding-left:12px;">';
  h += tickerBadge(f.ticker, false) + (f.ticker ? ' ' : '');
  h += '<a href="' + f.link + '" style="font-family:monospace;font-size:12px;color:' + color + ';font-weight:700;text-decoration:none;">' + esc(f.nct) + '</a> ' + pill(f.statusLabel, color);
  if (f.phaseText) h += ' <span style="font-size:10px;color:#9ca3af;">' + esc(f.phaseText) + '</span>';
  if (f.themes.length) h += ' ' + pill(f.themes[0], "#7c3aed", "#f3e8ff");
  h += '<div style="font-size:13px;font-weight:600;color:#111827;margin:2px 0;line-height:1.3;">' + esc(title) + '</div>';
  h += '<div style="font-size:11px;color:#9ca3af;">' + metaLine(f) + '</div>';
  if (f.whyStopped) h += '<div style="font-size:11px;color:#ef4444;margin-top:2px;">Why stopped: ' + esc(f.whyStopped) + '</div>';
  h += changesHTML(f.changes, 11);
  h += '</div></td></tr>';
  return h;
}

function calendarRow(f, overdue) {
  var h = '<tr><td style="padding:6px 16px;border-bottom:1px solid #f3f4f6;font-size:12px;">';
  h += '<span style="display:inline-block;min-width:68px;font-weight:700;color:' + (overdue ? "#b91c1c" : "#111827") + ';">' + esc(fmtMonth(f.pcd)) + '</span> ';
  h += tickerBadge(f.ticker, false) + ' <a href="' + f.link + '" style="font-family:monospace;color:#4f46e5;text-decoration:none;">' + esc(f.nct) + '</a> ';
  h += '<span style="color:#374151;">' + esc(f.title.length > 80 ? f.title.substring(0, 80) + "..." : f.title) + '</span>';
  h += '<div style="font-size:11px;color:#9ca3af;margin-left:72px;">' + esc(f.sponsor) + ' &middot; ' + esc(f.statusLabel) + (f.enrollment != null ? ' &middot; ' + fmtNum(f.enrollment) + ' pts' : '') + (f.interventions.length ? ' &middot; ' + esc(f.interventions[0]) : '') + (f.pcdType === "ESTIMATED" ? ' &middot; est.' : '') + '</div>';
  h += '</td></tr>';
  return h;
}

function summaryBox(num, label, color, bg) {
  return '<td style="text-align:center;padding:10px 6px;background:' + (bg || '#f9fafb') + ';border-radius:8px;">'
    + '<div style="font-size:20px;font-weight:700;color:' + color + ';">' + num + '</div><div style="font-size:10px;color:#9ca3af;">' + esc(label) + '</div></td>';
}

// ============================================================
//  DIGEST EMAIL
// ============================================================

function buildDigestHTML(R, cal, now) {
  var dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>';
  html += '<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">';
  html += '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 0;"><tr><td align="center">';
  html += '<table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';

  // Header
  html += '<tr><td style="background:#1e1b4b;padding:22px 28px;">';
  html += '<div style="font-size:20px;font-weight:700;color:#ffffff;">&#x1F52C; Clinical Trials Daily Digest</div>';
  html += '<div style="font-size:13px;color:#a5b4fc;margin-top:4px;">' + esc(dateStr) + ' &middot; industry-sponsored studies updated in the last ' + LOOKBACK_DAYS + ' days</div>';
  html += '</td></tr>';

  // Summary bar
  html += '<tr><td style="padding:18px 28px 6px;"><table width="100%" cellpadding="0" cellspacing="5" style="border-collapse:separate;"><tr>';
  html += summaryBox(R.industryTotal, "Industry updates", "#111827");
  html += summaryBox(R.coverage.length, "Coverage hits", R.coverage.length ? "#d97706" : "#9ca3af", R.coverage.length ? "#fef3c7" : null);
  html += summaryBox(R.changed.length, "Material changes", R.changed.length ? "#b91c1c" : "#9ca3af", R.changed.length ? "#fee2e2" : null);
  for (var ci = 0; ci < CATEGORIES.length; ci++) {
    var c = CATEGORIES[ci];
    html += summaryBox(R.cats[c.key] ? R.cats[c.key].totalCount : 0, c.shortLabel, c.color);
  }
  html += '</tr></table>';
  html += '<div style="font-size:11px;color:#9ca3af;margin-top:4px;">' + R.rawTotal + ' total CT.gov updates in window, ' + R.industryTotal + ' with an industry sponsor or collaborator, ' + R.publicTotal + ' tagged to a public company' + (R.firstRun ? '. Change tracking starts with this run, so field-level diffs appear from tomorrow.' : '.') + '</div>';
  html += '</td></tr>';

  // Top signals
  if (R.top.length) {
    var inner = sectionHeader("&#x1F3AF;", "TOP SIGNALS", "(" + R.top.length + " highest-scoring updates outside coverage names)", "#1e1b4b", "#eef2ff");
    for (var t = 0; t < R.top.length; t++) inner += bigRow(R.top[t], true);
    html += wrapSection(inner);
  }

  // Coverage hits
  if (R.coverage.length) {
    var shown = R.coverage.slice(0, MAX_COVERAGE_ROWS);
    var inner2 = sectionHeader("&#x26A1;", "COVERAGE WATCHLIST", "(" + R.coverage.length + " from your coverage universe)", "#92400e", "#fef3c7");
    for (var w = 0; w < shown.length; w++) inner2 += bigRow(shown[w], true);
    inner2 += moreRow(R.coverage.length - shown.length, "coverage hits");
    html += wrapSection(inner2);
  }

  // Material changes
  if (R.changed.length) {
    var shownC = R.changed.slice(0, MAX_CHANGE_ROWS);
    var inner3 = sectionHeader("&#x1F4C9;", "WHAT CHANGED", "(timeline slips, enrollment cuts, status moves, results posted)", "#b91c1c", "#fee2e2");
    for (var x = 0; x < shownC.length; x++) inner3 += smallRow(shownC[x], "#b91c1c");
    inner3 += moreRow(R.changed.length - shownC.length, "changes");
    html += wrapSection(inner3);
  }

  // Other public companies, grouped by ticker
  if (R.publicGroups.length) {
    var inner4 = sectionHeader("&#x1F3E2;", "OTHER PUBLIC COMPANIES", "(" + R.publicTotal + " studies across " + R.publicGroups.length + " tickers)", "#374151", "#f3f4f6");
    var rows = 0;
    for (var g = 0; g < R.publicGroups.length && rows < MAX_PUBLIC_ROWS; g++) {
      var grp = R.publicGroups[g];
      inner4 += '<tr><td style="padding:8px 16px 2px;font-size:12px;font-weight:700;color:#374151;">' + esc(grp.ticker) + ' <span style="font-weight:400;color:#9ca3af;">' + esc(grp.sector) + ' &middot; ' + grp.studies.length + ' stud' + (grp.studies.length === 1 ? 'y' : 'ies') + '</span></td></tr>';
      for (var s = 0; s < grp.studies.length && rows < MAX_PUBLIC_ROWS; s++, rows++) inner4 += smallRow(grp.studies[s], statusColor(grp.studies[s].status));
    }
    inner4 += moreRow(R.publicTotal - rows, "public-company studies");
    html += wrapSection(inner4);
  }

  // Therapeutic-area watch
  if (R.themeHits.length) {
    var shownT = R.themeHits.slice(0, MAX_THEME_ROWS);
    var inner5 = sectionHeader("&#x1F9EC;", "THERAPEUTIC AREA WATCH", "(competitor activity in tracked themes, outside coverage names)", "#7c3aed", "#f5f3ff");
    for (var th = 0; th < shownT.length; th++) inner5 += smallRow(shownT[th], "#7c3aed");
    inner5 += moreRow(R.themeHits.length - shownT.length, "theme hits");
    html += wrapSection(inner5);
  }

  // Readout calendar
  if (cal.upcoming.length) {
    var up = cal.upcoming.slice(0, MAX_CALENDAR_ROWS);
    var inner6 = sectionHeader("&#x1F4C5;", "READOUT CALENDAR", "(Phase 3, industry-led, primary completion in the next " + CALENDAR_DAYS_AHEAD + " days, mapped tickers only)", "#0f766e", "#ecfdf5");
    for (var u = 0; u < up.length; u++) inner6 += calendarRow(up[u], false);
    if (cal.upcoming.length > up.length) inner6 += '<tr><td style="padding:8px 16px;text-align:center;font-size:12px;color:#6b7280;">+ ' + (cal.upcoming.length - up.length) + ' more</td></tr>';
    html += wrapSection(inner6);
  }
  if (cal.overdue.length) {
    var od = cal.overdue.slice(0, MAX_OVERDUE_ROWS);
    var inner7 = sectionHeader("&#x23F3;", "PRIMARY COMPLETION PASSED, NO RESULTS POSTED", "(" + OVERDUE_MIN_MONTHS + " to " + OVERDUE_MAX_MONTHS + " months past primary completion, Phase 3, industry-led)", "#b45309", "#fffbeb");
    for (var o = 0; o < od.length; o++) inner7 += calendarRow(od[o], true);
    if (cal.overdue.length > od.length) inner7 += '<tr><td style="padding:8px 16px;text-align:center;font-size:12px;color:#6b7280;">+ ' + (cal.overdue.length - od.length) + ' more</td></tr>';
    html += wrapSection(inner7);
  }

  // Category sections
  for (var k = 0; k < CATEGORIES.length; k++) {
    var cat = CATEGORIES[k];
    var data = R.cats[cat.key];
    if (!data || data.totalCount === 0) continue;
    var limit = cat.key === "terminated" ? 20 : 10;
    var sortedCat = data.studies.slice().sort(function (a, b) { return b.score - a.score; });
    var shownK = sortedCat.slice(0, limit);
    var inner8 = sectionHeader(cat.icon, cat.label, "(" + data.totalCount + " industry-sponsored, top " + shownK.length + " by score)", cat.color, cat.color + "08");
    for (var q = 0; q < shownK.length; q++) inner8 += smallRow(shownK[q], cat.color);
    inner8 += moreRow(data.totalCount - shownK.length, "in this group");
    html += wrapSection(inner8);
  }

  if (R.industryTotal === 0) {
    html += '<tr><td style="text-align:center;padding:32px;color:#9ca3af;font-size:14px;">No new industry-sponsored changes in the last ' + LOOKBACK_DAYS + ' days.</td></tr>';
  }

  // Unmapped sponsors
  if (R.unmapped.length) {
    var inner9 = sectionHeader("&#x1F50D;", "UNMAPPED INDUSTRY SPONSORS", "(most active today, add tickers in send-report.js PUBLIC_SPONSORS)", "#6b7280", "#f9fafb");
    inner9 += '<tr><td style="padding:8px 16px;font-size:11px;color:#6b7280;line-height:1.7;">';
    inner9 += R.unmapped.map(function (u) { return esc(u.name) + ' <span style="color:#9ca3af;">(' + u.count + ')</span>'; }).join(' &middot; ');
    inner9 += '</td></tr>';
    html += wrapSection(inner9);
  }

  // Footer
  html += '<tr><td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;">';
  html += '<div style="text-align:center;"><a href="' + DASHBOARD_URL + '" style="display:inline-block;padding:10px 28px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Open Dashboard</a></div>';
  html += '<div style="text-align:center;margin-top:12px;font-size:11px;color:#9ca3af;">Source: ClinicalTrials.gov API v2 &middot; ' + LOOKBACK_DAYS + '-day lookback with composite dedup &middot; full hit list attached as CSV</div>';
  html += '<div style="text-align:center;margin-top:4px;font-size:10px;color:#d1d5db;">' + COVERAGE.length + ' coverage names, ' + PUBLIC_SPONSORS.length + ' public sponsor groups, ' + THEMES.length + ' themes &middot; v4</div>';
  html += '</td></tr></table></td></tr></table></body></html>';
  return html;
}

// ============================================================
//  ALERT EMAIL
// ============================================================

function buildAlertHTML(items, now) {
  var dateStr = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">';
  html += '<table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0;"><tr><td align="center"><table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">';
  html += '<tr><td style="background:#7f1d1d;padding:20px 28px;"><div style="font-size:19px;font-weight:700;color:#fff;">&#x1F6A8; Clinical Trials Alert</div><div style="font-size:13px;color:#fecaca;margin-top:4px;">' + esc(dateStr) + ' ET &middot; ' + items.length + ' urgent termination' + (items.length === 1 ? '' : 's') + ' / suspension' + (items.length === 1 ? '' : 's') + '</div></td></tr>';
  html += '<tr><td style="padding:8px 28px 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">';
  for (var i = 0; i < items.length; i++) html += bigRow(items[i], true);
  html += '</table></td></tr>';
  html += '<tr><td style="padding:12px 28px 20px;border-top:1px solid #f3f4f6;text-align:center;font-size:11px;color:#9ca3af;">Criteria: industry-sponsored Phase 2/3 or coverage-ticker study moved to Terminated, Suspended or Withdrawn. Full detail in the daily digest.</td></tr>';
  html += '</table></td></tr></table></body></html>';
  return html;
}

// ============================================================
//  CSV
// ============================================================

function buildCSV(studies) {
  var header = ["Ticker", "Tier", "Sector", "Group", "NCT", "Status", "Phase", "Study type", "Lead sponsor", "Lead class", "Matched name", "Title", "Conditions", "Interventions", "Enrollment", "Enrollment type", "Start", "Primary completion", "Completion", "Results posted", "Last update", "Why stopped", "Themes", "Changes", "Score", "Link"];
  var lines = [header.join(",")];
  for (var i = 0; i < studies.length; i++) {
    var f = studies[i];
    lines.push([
      f.ticker ? f.ticker.ticker : "", f.ticker ? (f.ticker.coverage ? "Coverage" : "Public") : "", f.ticker ? f.ticker.sector : "",
      f.category ? f.category.shortLabel : "", f.nct, f.statusLabel, f.phaseText, f.studyType, f.sponsor, f.sponsorClass,
      f.ticker ? f.ticker.matchedName : "", f.title, f.conditions.join("; "), f.interventions.join("; "), f.enrollment == null ? "" : f.enrollment,
      f.enrollmentType || "", f.start || "", f.pcd || "", f.completion || "", f.resultsPosted ? "Y" : "N", f.updated || "", f.whyStopped,
      f.themes.join("; "), f.changes.map(function (c) { return c.text; }).join("; "), f.score, f.link,
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

// ============================================================
//  SEND
// ============================================================

async function sendEmail(subject, html, attachments) {
  if (DRY_RUN) {
    var out = path.join(__dirname, "dry-run-" + subject.replace(/[^a-z0-9]+/gi, "-").substring(0, 60) + ".html");
    fs.writeFileSync(out, html);
    console.log("DRY RUN: wrote " + out + (attachments ? " (+" + attachments.length + " attachment)" : ""));
    return { id: "dry-run" };
  }
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set.");
  if (RECIPIENT_EMAILS.length === 0) throw new Error("No recipients configured. Set RECIPIENT_EMAILS secret.");
  var body = { from: FROM_EMAIL, to: RECIPIENT_EMAILS, subject: subject, html: html };
  if (attachments && attachments.length) body.attachments = attachments;
  var resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error("Resend API " + resp.status + ": " + await resp.text());
  var data = await resp.json();
  console.log("Email sent! ID: " + data.id + " | Recipients: " + RECIPIENT_EMAILS.join(", "));
  return data;
}

// ============================================================
//  ASSEMBLE RESULTS
// ============================================================

function assemble(R, firstRun) {
  var all = R.all;
  R.firstRun = firstRun;
  R.coverage = all.filter(function (f) { return f.ticker && f.ticker.coverage; })
    .sort(function (a, b) { return (a.category.key === "terminated" ? 0 : 1) - (b.category.key === "terminated" ? 0 : 1) || b.score - a.score || a.ticker.ticker.localeCompare(b.ticker.ticker); });
  R.changed = all.filter(function (f) { return f.changes.length > 0; }).sort(function (a, b) { return b.score - a.score; });
  var pub = all.filter(function (f) { return f.ticker && !f.ticker.coverage && f.ticker.ticker !== "PRIVATE"; });
  R.publicTotal = pub.length;
  var groups = {};
  pub.forEach(function (f) { (groups[f.ticker.ticker] = groups[f.ticker.ticker] || { ticker: f.ticker.ticker, sector: f.ticker.sector, studies: [], best: 0 }).studies.push(f); });
  R.publicGroups = Object.keys(groups).map(function (k) {
    var g = groups[k]; g.studies.sort(function (a, b) { return b.score - a.score; }); g.best = g.studies[0].score; return g;
  }).sort(function (a, b) { return b.best - a.best || a.ticker.localeCompare(b.ticker); });
  R.themeHits = all.filter(function (f) { return f.themes.length && !(f.ticker && f.ticker.coverage); }).sort(function (a, b) { return b.score - a.score; });
  // Coverage names have their own section right below, so Top Signals surfaces the rest of the market
  R.top = all.filter(function (f) { return !(f.ticker && f.ticker.coverage) && f.score >= TOP_MIN_SCORE; }).sort(function (a, b) { return b.score - a.score; }).slice(0, TOP_SIGNALS);
  var counts = {};
  all.forEach(function (f) { if (f.sponsorClass === "INDUSTRY" && !f.ticker) counts[f.sponsor] = (counts[f.sponsor] || 0) + 1; });
  R.unmapped = Object.keys(counts).map(function (n) { return { name: n, count: counts[n] }; }).sort(function (a, b) { return b.count - a.count || a.name.localeCompare(b.name); }).slice(0, MAX_UNMAPPED);
  return R;
}

function updateStateFrom(state, studies) {
  for (var i = 0; i < studies.length; i++) state.studies[studies[i].nct] = snapshotOf(studies[i]);
}

// ============================================================
//  MAIN
// ============================================================

async function main() {
  var now = new Date();
  console.log("=== Clinical Trials Daily Digest v4" + (ALERT_ONLY ? " (ALERT ONLY)" : "") + (DRY_RUN ? " (DRY RUN)" : "") + " ===");
  console.log("Time: " + now.toISOString());
  console.log("Recipients: " + RECIPIENT_EMAILS.join(", "));
  console.log("Coverage: " + COVERAGE.length + " names | Public map: " + PUBLIC_SPONSORS.length + " groups | Themes: " + THEMES.length);
  console.log("");

  console.log("Loading dedup data...");
  var sentData = loadSentData();
  var prev = sentData.ids || {};
  console.log("Loading study state...");
  var state = loadState();
  var firstRun = Object.keys(state.studies).length === 0;

  var since = addDays(now, -LOOKBACK_DAYS);
  var sinceStr = isoDate(since);
  console.log("Since: " + sinceStr + " (" + LOOKBACK_DAYS + "-day lookback)");
  console.log("");

  // ---------------- ALERT ONLY MODE ----------------
  if (ALERT_ONLY) {
    console.log("Fetching terminated/suspended/withdrawn only...");
    var ra = await fetchCategories(sinceStr, {}, state, true);   // ignore dedup here; alert log handles repeats
    var urgent = ra.all.filter(function (f) { return isUrgent(f) && !state.alerted[dedupKey(f)]; }).sort(function (a, b) { return b.score - a.score; });
    console.log("Urgent, not yet alerted: " + urgent.length);
    if (urgent.length) {
      var subj = "CT ALERT | " + urgent.length + " urgent termination" + (urgent.length === 1 ? "" : "s") + " | " + now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
      await sendEmail(subj, buildAlertHTML(urgent, now));
      urgent.forEach(function (f) { state.alerted[dedupKey(f)] = Date.now(); });
      updateStateFrom(state, ra.all);
      saveState(state);
    } else {
      console.log("Nothing to alert.");
    }
    console.log("=== DONE ===");
    return;
  }

  // ---------------- DAILY DIGEST MODE ----------------
  console.log("Fetching from ClinicalTrials.gov...");
  var R = await fetchCategories(sinceStr, prev, state, false);
  console.log("");
  console.log("Fetching calendar queries...");
  var cal = await fetchCalendar(now);
  console.log("");

  assemble(R, firstRun);

  console.log("=== RESULTS ===");
  console.log("  CT.gov updates in window (after dedup): " + R.rawTotal);
  console.log("  Industry-sponsored: " + R.industryTotal);
  console.log("  Coverage hits: " + R.coverage.length + " | Public-company hits: " + R.publicTotal + " | Theme hits: " + R.themeHits.length);
  console.log("  Material changes: " + R.changed.length + (firstRun ? " (first run, no prior snapshot)" : ""));
  console.log("  Readout calendar: " + cal.upcoming.length + " upcoming, " + cal.overdue.length + " past primary completion without results");
  for (var i = 0; i < CATEGORIES.length; i++) console.log("  " + CATEGORIES[i].label + ": " + R.cats[CATEGORIES[i].key].totalCount);
  if (R.coverage.length) {
    console.log("  --- Coverage detail ---");
    R.coverage.forEach(function (f) { console.log("  [" + f.ticker.ticker + "] " + f.nct + " | " + f.statusLabel + " | " + f.phaseText + " | " + f.title.substring(0, 60) + (f.changes.length ? " | " + f.changes.map(function (c) { return c.text; }).join("; ") : "")); });
  }
  if (R.top.length) {
    console.log("  --- Top signals ---");
    R.top.forEach(function (f) { console.log("  (" + f.score + ") " + (f.ticker ? "[" + f.ticker.ticker + "] " : "") + f.nct + " | " + f.statusLabel + " | " + f.phaseText + " | " + f.title.substring(0, 60)); });
  }
  if (R.unmapped.length) console.log("  Unmapped industry sponsors: " + R.unmapped.map(function (u) { return u.name + " (" + u.count + ")"; }).join(", "));
  console.log("");

  // Urgent alert (separate email) for anything not already alerted
  var urgentDaily = R.all.filter(function (f) { return isUrgent(f) && !state.alerted[dedupKey(f)]; }).sort(function (a, b) { return b.score - a.score; });
  if (urgentDaily.length) {
    console.log("Sending alert email for " + urgentDaily.length + " urgent item(s)...");
    var asubj = "CT ALERT | " + urgentDaily.length + " urgent termination" + (urgentDaily.length === 1 ? "" : "s") + " | " + now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
    await sendEmail(asubj, buildAlertHTML(urgentDaily, now));
    urgentDaily.forEach(function (f) { state.alerted[dedupKey(f)] = Date.now(); });
  }

  // Digest
  var dateTag = now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  var subject = "CT Daily | " + R.coverage.length + " coverage hit" + (R.coverage.length === 1 ? "" : "s") + " | " + R.changed.length + " change" + (R.changed.length === 1 ? "" : "s") + " | " + R.industryTotal + " industry | " + dateTag;
  console.log("Subject: " + subject);
  console.log("Sending digest...");
  var csv = buildCSV(R.all.slice().sort(function (a, b) { return b.score - a.score; }));
  var attachments = [{ filename: "ct-daily-" + isoDate(now) + ".csv", content: Buffer.from(csv, "utf8").toString("base64") }];
  await sendEmail(subject, buildDigestHTML(R, cal, now), attachments);
  if (DRY_RUN) fs.writeFileSync(path.join(__dirname, "dry-run-" + isoDate(now) + ".csv"), csv);

  console.log("");
  console.log("Saving tracking files...");
  saveSentData(R.newIds);
  updateStateFrom(state, R.all);
  saveState(state);
  console.log("");
  console.log("=== DONE ===");
}

if (require.main === module) {
  main().catch(function (err) {
    console.error("FATAL:", err.message || err);
    process.exit(1);
  });
}

module.exports = { extractFields, enrich, diffStudy, scoreStudy, matchTicker, matchThemes, assemble, buildDigestHTML, buildAlertHTML, buildCSV, isUrgent, CATEGORIES };
