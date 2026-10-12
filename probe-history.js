// probe-history.js - one-off probe of ClinicalTrials.gov's record-history endpoint.
// Fetches the version history for two trials and prints the JSON structure
// (keys, types, and a trimmed sample) so the parser in build-pipeline.js can be
// written against the real response shape. Safe to run repeatedly; writes nothing.

"use strict";

const NCTS = (process.env.PROBE_NCTS || "NCT05556512,NCT04623541").split(",").map(function (s) { return s.trim(); }).filter(Boolean);

async function get(url) {
  var resp = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "clinical-trials-monitor/probe" } });
  var text = await resp.text();
  var json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: resp.status, ctype: resp.headers.get("content-type"), text: text, json: json };
}

// Print the shape of an object: keys and types, recursing a few levels, arrays sampled.
function shape(v, depth, indent) {
  depth = depth || 0; indent = indent || "";
  if (depth > 5) return indent + "...\n";
  if (Array.isArray(v)) {
    var out = indent + "[array len=" + v.length + "]\n";
    if (v.length) out += shape(v[0], depth + 1, indent + "  ");
    return out;
  }
  if (v && typeof v === "object") {
    var o = "";
    Object.keys(v).forEach(function (k) {
      var val = v[k];
      if (val && typeof val === "object") { o += indent + k + ":\n" + shape(val, depth + 1, indent + "  "); }
      else { var s = String(val); o += indent + k + ": " + (typeof val) + " = " + (s.length > 60 ? s.substring(0, 60) + "..." : s) + "\n"; }
    });
    return o;
  }
  return indent + typeof v + "\n";
}

async function main() {
  for (var i = 0; i < NCTS.length; i++) {
    var nct = NCTS[i];
    console.log("\n==================== " + nct + " ====================");

    var u1 = "https://clinicaltrials.gov/api/int/studies/" + nct + "?history=true";
    console.log("GET " + u1);
    var r1 = await get(u1);
    console.log("status " + r1.status + " type " + r1.ctype + " bytes " + r1.text.length);
    if (r1.json) {
      console.log("--- top-level keys: " + Object.keys(r1.json).join(", "));
      var hist = r1.json.history || r1.json.historyInfo || null;
      if (hist) {
        console.log("--- history object shape:");
        console.log(shape(hist));
        var changes = hist.changes || hist.versions || null;
        if (Array.isArray(changes)) {
          console.log("--- first 3 and last 2 change entries (raw):");
          console.log(JSON.stringify(changes.slice(0, 3), null, 1));
          console.log(JSON.stringify(changes.slice(-2), null, 1));
        }
      } else {
        console.log("--- no 'history' key; full shape:");
        console.log(shape(r1.json));
      }
    } else {
      console.log("--- not JSON. First 600 chars:");
      console.log(r1.text.substring(0, 600));
    }

    var u2 = "https://clinicaltrials.gov/api/int/studies/" + nct + "/history/0";
    console.log("\nGET " + u2);
    var r2 = await get(u2);
    console.log("status " + r2.status + " type " + r2.ctype + " bytes " + r2.text.length);
    if (r2.json) {
      console.log("--- top-level keys: " + Object.keys(r2.json).join(", "));
      console.log("--- shape (first 2 levels of each top-level key):");
      Object.keys(r2.json).forEach(function (k) {
        var v = r2.json[k];
        console.log(k + ":");
        if (v && typeof v === "object" && !Array.isArray(v)) {
          Object.keys(v).forEach(function (k2) { console.log("  " + k2 + ": " + (Array.isArray(v[k2]) ? "[array len=" + v[k2].length + "]" : typeof v[k2])); });
        } else { console.log("  " + (Array.isArray(v) ? "[array len=" + v.length + "]" : typeof v)); }
      });
      // Try to locate the status and design modules wherever they sit
      var found = findKey(r2.json, "statusModule", 0);
      console.log("--- statusModule found: " + (found ? JSON.stringify(found).substring(0, 700) : "no"));
      var found2 = findKey(r2.json, "enrollmentInfo", 0);
      console.log("--- enrollmentInfo found: " + (found2 ? JSON.stringify(found2) : "no"));
      var found3 = findKey(r2.json, "primaryOutcomes", 0);
      console.log("--- primaryOutcomes found: " + (found3 ? JSON.stringify(found3).substring(0, 500) : "no"));
    } else {
      console.log("--- not JSON. First 600 chars:");
      console.log(r2.text.substring(0, 600));
    }
    await new Promise(function (r) { setTimeout(r, 500); });
  }
  console.log("\n=== PROBE DONE ===");
}

function findKey(obj, key, depth) {
  if (!obj || typeof obj !== "object" || depth > 10) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  var ks = Object.keys(obj);
  for (var i = 0; i < ks.length; i++) { var v = findKey(obj[ks[i]], key, depth + 1); if (v !== undefined) return v; }
  return undefined;
}

main().catch(function (e) { console.error("FATAL:", e.message || e); process.exit(1); });
