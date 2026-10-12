// probe-history.js v2 - probe ClinicalTrials.gov's record-history endpoint two ways.
//   Method A: plain fetch with browser-like headers, after loading the study page to collect cookies.
//   Method B: headless Chrome (puppeteer) opens the study page, then calls the endpoint from inside the page.
// Prints status codes and, on success, the JSON structure so the parser can be written against it.
// Writes nothing to the repo.

"use strict";

const NCTS = (process.env.PROBE_NCTS || "NCT05556512,NCT04623541").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

function shape(v, depth, indent) {
  depth = depth || 0; indent = indent || "";
  if (depth > 5) return indent + "...\n";
  if (Array.isArray(v)) { var out = indent + "[array len=" + v.length + "]\n"; if (v.length) out += shape(v[0], depth + 1, indent + "  "); return out; }
  if (v && typeof v === "object") {
    var o = "";
    Object.keys(v).forEach(function (k) {
      var val = v[k];
      if (val && typeof val === "object") o += indent + k + ":\n" + shape(val, depth + 1, indent + "  ");
      else { var s = String(val); o += indent + k + ": " + (typeof val) + " = " + (s.length > 60 ? s.substring(0, 60) + "..." : s) + "\n"; }
    });
    return o;
  }
  return indent + typeof v + "\n";
}
function findKey(obj, key, depth) {
  if (!obj || typeof obj !== "object" || depth > 10) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  var ks = Object.keys(obj);
  for (var i = 0; i < ks.length; i++) { var v = findKey(obj[ks[i]], key, depth + 1); if (v !== undefined) return v; }
  return undefined;
}
function report(label, status, text) {
  console.log(label + " -> status " + status + ", bytes " + (text || "").length);
  var json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  if (!json) { console.log("  not JSON. first 300 chars: " + String(text || "").substring(0, 300).replace(/\s+/g, " ")); return null; }
  console.log("  top-level keys: " + Object.keys(json).join(", "));
  return json;
}
function describeHistory(json) {
  var hist = json.history || json.historyInfo || findKey(json, "changes", 0);
  if (!hist) { console.log("  (no history-like key found; full shape follows)"); console.log(shape(json)); return; }
  console.log("  history shape:"); console.log(shape(hist));
  var changes = Array.isArray(hist) ? hist : (hist.changes || hist.versions);
  if (Array.isArray(changes)) {
    console.log("  first 3 change entries (raw):"); console.log(JSON.stringify(changes.slice(0, 3), null, 1));
    console.log("  last 2 change entries (raw):"); console.log(JSON.stringify(changes.slice(-2), null, 1));
  }
  var od = findKey(json, "originalData", 0);
  if (od) { console.log("  originalData shape:"); console.log(shape(od)); }
}
function describeVersion(json) {
  Object.keys(json).forEach(function (k) {
    var v = json[k];
    console.log("  " + k + ": " + (Array.isArray(v) ? "[array len=" + v.length + "]" : typeof v));
    if (v && typeof v === "object" && !Array.isArray(v)) Object.keys(v).forEach(function (k2) { console.log("    " + k2 + ": " + (Array.isArray(v[k2]) ? "[array len=" + v[k2].length + "]" : typeof v[k2])); });
  });
  var sm = findKey(json, "statusModule", 0); console.log("  statusModule: " + (sm ? JSON.stringify(sm).substring(0, 600) : "not found"));
  var ei = findKey(json, "enrollmentInfo", 0); console.log("  enrollmentInfo: " + (ei ? JSON.stringify(ei) : "not found"));
  var po = findKey(json, "primaryOutcomes", 0); console.log("  primaryOutcomes: " + (po ? JSON.stringify(po).substring(0, 400) : "not found"));
}

// ---------------- Method A ----------------
async function methodA(nct) {
  console.log("\n--- Method A (browser-like headers + cookies) for " + nct);
  var pageUrl = "https://clinicaltrials.gov/study/" + nct;
  var cookie = "";
  try {
    var pr = await fetch(pageUrl, { headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" }, redirect: "follow" });
    var sc = typeof pr.headers.getSetCookie === "function" ? pr.headers.getSetCookie() : [];
    cookie = sc.map(function (c) { return c.split(";")[0]; }).join("; ");
    console.log("  study page -> status " + pr.status + ", cookies received: " + sc.length);
  } catch (e) { console.log("  study page fetch failed: " + e.message); }

  var headers = {
    "User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
    "Referer": pageUrl, "Origin": "https://clinicaltrials.gov",
    "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-origin",
  };
  if (cookie) headers["Cookie"] = cookie;
  var u1 = "https://clinicaltrials.gov/api/int/studies/" + nct + "?history=true";
  var r1 = await fetch(u1, { headers: headers });
  var j1 = report("  GET " + u1, r1.status, await r1.text());
  if (j1) describeHistory(j1);
  var u2 = "https://clinicaltrials.gov/api/int/studies/" + nct + "/history/0";
  var r2 = await fetch(u2, { headers: headers });
  var j2 = report("  GET " + u2, r2.status, await r2.text());
  if (j2) describeVersion(j2);
  return !!(j1 && j2);
}

// ---------------- Method B ----------------
async function methodB(nct) {
  console.log("\n--- Method B (headless Chrome) for " + nct);
  var puppeteer;
  try { puppeteer = require("puppeteer"); } catch (e) { console.log("  puppeteer not installed (" + e.message + ")"); return false; }
  var browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    var page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto("https://clinicaltrials.gov/study/" + nct, { waitUntil: "networkidle2", timeout: 60000 });
    console.log("  study page loaded, title: " + (await page.title()));
    var res = await page.evaluate(async function (id) {
      async function g(u) { var r = await fetch(u, { headers: { "Accept": "application/json" } }); return { status: r.status, text: await r.text() }; }
      return { a: await g("/api/int/studies/" + id + "?history=true"), b: await g("/api/int/studies/" + id + "/history/0") };
    }, nct);
    var j1 = report("  in-page GET ?history=true", res.a.status, res.a.text);
    if (j1) describeHistory(j1);
    var j2 = report("  in-page GET /history/0", res.b.status, res.b.text);
    if (j2) describeVersion(j2);
    return !!(j1 && j2);
  } catch (e) { console.log("  headless Chrome failed: " + e.message); return false; }
  finally { await browser.close(); }
}

async function main() {
  var aOk = false, bOk = false;
  for (var i = 0; i < NCTS.length; i++) {
    console.log("\n==================== " + NCTS[i] + " ====================");
    aOk = (await methodA(NCTS[i])) || aOk;
    if (!aOk) bOk = (await methodB(NCTS[i])) || bOk;
    await new Promise(function (r) { setTimeout(r, 800); });
  }
  console.log("\n=== RESULT: method A " + (aOk ? "WORKS" : "blocked") + " | method B " + (bOk ? "WORKS" : (aOk ? "not needed" : "blocked or unavailable")) + " ===");
  console.log("=== PROBE DONE ===");
}
main().catch(function (e) { console.error("FATAL:", e.message || e); process.exit(1); });
