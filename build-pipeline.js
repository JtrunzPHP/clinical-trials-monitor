// build-pipeline.js - Public-company clinical pipeline data builder (v1)
//
// Runs daily in GitHub Actions. Pulls every industry-led study on ClinicalTrials.gov
// that is ongoing, plus completed/terminated/withdrawn/suspended studies updated in the
// last 12 months, maps each lead sponsor to a ticker via tickers.js, classifies the
// therapeutic area from the MeSH condition tree, scores company-importance, tracks
// field-level changes run over run, and writes JSON that pipeline.html renders.
//
// Outputs (all under data/pipeline/):
//   index.json            company list with counts, next readouts, recent terminations, candidates
//   tickers/<TICKER>.json every trial for that company
//   candidates.csv        industry lead sponsors with no ticker mapping, by trial count (grow tickers.js from this)
//   history-cache.json    original-record lookups (see ORIGINAL RECORD below)
//
// Optional env: MAX_HISTORY_LOOKUPS (default 150), SKIP_HISTORY=true

"use strict";

const fs = require("fs");
const path = require("path");
const T = require("./tickers.js");

const CT_API = "https://clinicaltrials.gov/api/v2/studies";
const OUT_DIR = path.join(__dirname, "data", "pipeline");
const TICKER_DIR = path.join(OUT_DIR, "tickers");
const HISTORY_CACHE = path.join(OUT_DIR, "history-cache.json");

const PAGE_SIZE = 1000;
const MAX_PAGES_ONGOING = 80;       // up to 80,000 studies
const MAX_PAGES_CLOSED = 40;
const CLOSED_LOOKBACK_MONTHS = 12;
const READOUT_WINDOW_DAYS = 90;
const MAX_CHANGES_PER_TRIAL = 25;
const MAX_HISTORY_LOOKUPS = parseInt(process.env.MAX_HISTORY_LOOKUPS || "150", 10);
const SKIP_HISTORY = String(process.env.SKIP_HISTORY || "").toLowerCase() === "true";
const REQUEST_DELAY_MS = 250;

const ONGOING = "RECRUITING,ACTIVE_NOT_RECRUITING,NOT_YET_RECRUITING,ENROLLING_BY_INVITATION";
const CLOSED = "COMPLETED,TERMINATED,WITHDRAWN,SUSPENDED";

const API_FIELDS = [
  "NCTId", "BriefTitle", "OverallStatus", "WhyStopped", "LastUpdatePostDate", "StudyFirstPostDate", "StartDate",
  "PrimaryCompletionDate", "CompletionDate", "Phase", "EnrollmentCount", "EnrollmentType", "StudyType",
  "DesignAllocation", "DesignMasking", "DesignPrimaryPurpose", "LeadSponsorName", "LeadSponsorClass",
  "CollaboratorName", "CollaboratorClass", "Condition", "ConditionMeshTerm", "ConditionAncestorTerm",
  "InterventionName", "InterventionType", "HasResults", "ResultsFirstPostDate",
].join(",");

// ------------------------------------------------------------
//  THERAPEUTIC AREA from MeSH tree. Order matters: first match wins.
// ------------------------------------------------------------
const AREA_RULES = [
  { area: "Oncology",                 terms: ["Neoplasms"] },
  { area: "Hematology",               terms: ["Hemic and Lymphatic Diseases", "Blood Coagulation Disorders", "Anemia", "Hemoglobinopathies"] },
  { area: "Immunology / Inflammation", terms: ["Immune System Diseases", "Autoimmune Diseases", "Rheumatic Diseases", "Arthritis, Rheumatoid", "Psoriasis", "Lupus", "Inflammatory Bowel Diseases", "Dermatitis, Atopic", "Hypersensitivity"] },
  { area: "Metabolic / Endocrine",    terms: ["Nutritional and Metabolic Diseases", "Endocrine System Diseases", "Obesity", "Diabetes Mellitus", "Metabolic Diseases"] },
  { area: "Cardiovascular",           terms: ["Cardiovascular Diseases", "Heart Diseases", "Vascular Diseases", "Hypertension"] },
  { area: "Neurology",                terms: ["Nervous System Diseases", "Neurodegenerative Diseases", "Alzheimer Disease", "Parkinson Disease", "Epilepsy", "Migraine Disorders", "Multiple Sclerosis"] },
  { area: "Psychiatry",               terms: ["Mental Disorders", "Behavior and Behavior Mechanisms", "Depressive Disorder", "Schizophrenia", "Substance-Related Disorders"] },
  { area: "Infectious Disease / Vaccines", terms: ["Infections", "Bacterial Infections and Mycoses", "Virus Diseases", "Parasitic Diseases", "Communicable Diseases", "COVID-19", "Influenza, Human", "HIV Infections"] },
  { area: "Respiratory",              terms: ["Respiratory Tract Diseases", "Lung Diseases", "Asthma", "Pulmonary Disease, Chronic Obstructive"] },
  { area: "Gastro / Hepatology",      terms: ["Digestive System Diseases", "Liver Diseases", "Gastrointestinal Diseases", "Fatty Liver"] },
  { area: "Nephrology / Urology",     terms: ["Urologic Diseases", "Kidney Diseases", "Male Urogenital Diseases", "Urogenital Diseases", "Renal Insufficiency"] },
  { area: "Women's Health",           terms: ["Female Urogenital Diseases and Pregnancy Complications", "Genital Diseases, Female", "Pregnancy Complications"] },
  { area: "Dermatology",              terms: ["Skin and Connective Tissue Diseases", "Skin Diseases"] },
  { area: "Ophthalmology",            terms: ["Eye Diseases"] },
  { area: "Musculoskeletal",          terms: ["Musculoskeletal Diseases", "Bone Diseases", "Osteoarthritis", "Osteoporosis"] },
  { area: "Rare / Genetic",           terms: ["Congenital, Hereditary, and Neonatal Diseases and Abnormalities", "Genetic Diseases, Inborn", "Rare Diseases"] },
  { area: "ENT / Dental",             terms: ["Otorhinolaryngologic Diseases", "Stomatognathic Diseases", "Mouth Diseases", "Tooth Diseases"] },
  { area: "Trauma / Surgery",         terms: ["Wounds and Injuries", "Postoperative Complications"] },
];

// ------------------------------------------------------------
//  HELPERS
// ------------------------------------------------------------
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function isoDate(d) { return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
function addMonths(d, n) { var x = new Date(d.getTime()); x.setUTCMonth(x.getUTCMonth() + n); return x; }
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
function parseCtDate(s) {
  if (!s) return null;
  var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1)) : null;
}
function fmtMonth(s) { var d = parseCtDate(s); return d ? d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : (s || "n/a"); }
function monthsBetween(a, b) {
  var da = parseCtDate(a), db = parseCtDate(b);
  if (!da || !db) return null;
  return Math.round(((db - da) / (30.44 * 86400000)) * 10) / 10;
}
function fmtNum(n) { return n == null ? "n/a" : Number(n).toLocaleString("en-US"); }
function statusLabel(s) {
  return ({ TERMINATED: "Terminated", WITHDRAWN: "Withdrawn", SUSPENDED: "Suspended", COMPLETED: "Completed", ACTIVE_NOT_RECRUITING: "Active, not recruiting",
    ENROLLING_BY_INVITATION: "Enrolling by invitation", RECRUITING: "Recruiting", NOT_YET_RECRUITING: "Not yet recruiting" })[s] || String(s || "Unknown").replace(/_/g, " ");
}
function phaseLabel(phases) {
  if (!phases || !phases.length) return "";
  return phases.map(function (p) { return p === "NA" ? "N/A" : p.replace("EARLY_PHASE1", "Early Ph 1").replace("PHASE", "Ph "); }).join("/");
}
function csvCell(v) { var s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ------------------------------------------------------------
//  API
// ------------------------------------------------------------
var FIELDS_SUPPORTED = true;

async function fetchJson(url) {
  var lastErr = null;
  for (var attempt = 1; attempt <= 4; attempt++) {
    try {
      var resp = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "clinical-trials-monitor/pipeline-1.0" } });
      if (resp.ok) return { ok: true, data: await resp.json() };
      var body = await resp.text().catch(function () { return ""; });
      lastErr = new Error("API " + resp.status + ": " + body.substring(0, 300));
      if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) return { ok: false, status: resp.status, error: lastErr };
    } catch (e) { lastErr = e; }
    await sleep(2000 * attempt);
  }
  return { ok: false, status: 0, error: lastErr };
}

function buildUrl(term, statuses, token, useFields) {
  var url = CT_API + "?format=json&pageSize=" + PAGE_SIZE + "&countTotal=true&query.term=" + encodeURIComponent(term);
  if (statuses) url += "&filter.overallStatus=" + encodeURIComponent(statuses);
  if (useFields) url += "&fields=" + encodeURIComponent(API_FIELDS);
  if (token) url += "&pageToken=" + encodeURIComponent(token);
  return url;
}

async function sweep(term, statuses, maxPages, label) {
  var all = [], token = null, total = 0;
  console.log("Sweep: " + label);
  for (var pg = 0; pg < maxPages; pg++) {
    var r = await fetchJson(buildUrl(term, statuses, token, FIELDS_SUPPORTED));
    if (!r.ok && FIELDS_SUPPORTED && r.status === 400 && pg === 0) {
      console.log("  fields parameter rejected, retrying with full records");
      FIELDS_SUPPORTED = false;
      r = await fetchJson(buildUrl(term, statuses, token, false));
    }
    if (!r.ok) throw r.error || new Error("sweep failed");
    if (pg === 0) total = r.data.totalCount || 0;
    all = all.concat(r.data.studies || []);
    console.log("  page " + (pg + 1) + ": " + all.length + " / " + total);
    token = r.data.nextPageToken;
    if (!token) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return all;
}

// ------------------------------------------------------------
//  ORIGINAL RECORD (best effort)
//  CT.gov keeps every version of a study record. The public v2 API does not
//  expose versions, but the site's internal endpoint does. This tries that
//  endpoint for the highest-importance trials, caches whatever it finds, and
//  stops quietly if the endpoint is unavailable. Nothing else depends on it.
// ------------------------------------------------------------
var historyAvailable = true;
var historyFailures = 0;

function deepFind(obj, key, depth) {
  if (!obj || typeof obj !== "object" || depth > 12) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var v = deepFind(obj[keys[i]], key, depth + 1);
    if (v !== undefined) return v;
  }
  return undefined;
}

async function fetchOriginal(nct) {
  if (!historyAvailable) return null;
  var listUrl = "https://clinicaltrials.gov/api/int/studies/" + nct + "/history";
  var r = await fetchJson(listUrl);
  if (!r.ok) { if (++historyFailures >= 5) { historyAvailable = false; console.log("  history endpoint unavailable, stopping lookups"); } return null; }
  var versions = deepFind(r.data, "changes", 0) || deepFind(r.data, "versions", 0) || deepFind(r.data, "history", 0);
  if (!Array.isArray(versions) || versions.length === 0) { if (++historyFailures >= 5) historyAvailable = false; return null; }
  var first = versions[0];
  var ver = first.version != null ? first.version : (first.versionNumber != null ? first.versionNumber : 0);
  var verDate = first.date || first.versionDate || first.postDate || null;
  var r2 = await fetchJson("https://clinicaltrials.gov/api/int/studies/" + nct + "/history/" + ver);
  if (!r2.ok) return { version: ver, date: verDate, source: "history-list-only" };
  var sm = deepFind(r2.data, "statusModule", 0) || {};
  var dm = deepFind(r2.data, "designModule", 0) || {};
  return {
    version: ver, date: verDate, source: "ct.gov record history",
    status: sm.overallStatus || null,
    start: sm.startDateStruct ? sm.startDateStruct.date : null,
    pcd: sm.primaryCompletionDateStruct ? sm.primaryCompletionDateStruct.date : null,
    completion: sm.completionDateStruct ? sm.completionDateStruct.date : null,
    enroll: dm.enrollmentInfo ? dm.enrollmentInfo.count : null,
    phase: (dm.phases || []).join("|") || null,
  };
}

// ------------------------------------------------------------
//  EXTRACT + CLASSIFY
// ------------------------------------------------------------
function extract(study) {
  var p = study.protocolSection || {};
  var id = p.identificationModule || {};
  var sm = p.statusModule || {};
  var dm = p.designModule || {};
  var di = dm.designInfo || {};
  var sp = p.sponsorCollaboratorsModule || {};
  var ai = p.armsInterventionsModule || {};
  var cb = ((study.derivedSection || {}).conditionBrowseModule) || {};
  var lead = sp.leadSponsor || {};
  var phases = dm.phases || [];
  var interventions = ai.interventions || [];
  return {
    nct: id.nctId || "",
    title: id.briefTitle || "Untitled",
    status: sm.overallStatus || "UNKNOWN",
    why: sm.whyStopped || "",
    lastUpdate: sm.lastUpdatePostDateStruct ? sm.lastUpdatePostDateStruct.date : null,
    firstPost: sm.studyFirstPostDateStruct ? sm.studyFirstPostDateStruct.date : null,
    start: sm.startDateStruct ? sm.startDateStruct.date : null,
    startType: sm.startDateStruct ? sm.startDateStruct.type : null,
    pcd: sm.primaryCompletionDateStruct ? sm.primaryCompletionDateStruct.date : null,
    pcdType: sm.primaryCompletionDateStruct ? sm.primaryCompletionDateStruct.type : null,
    completion: sm.completionDateStruct ? sm.completionDateStruct.date : null,
    results: !!study.hasResults,
    resultsDate: sm.resultsFirstPostDateStruct ? sm.resultsFirstPostDateStruct.date : null,
    phases: phases,
    phase: phaseLabel(phases),
    type: dm.studyType || "",
    allocation: di.allocation || "",
    masking: di.maskingInfo ? (di.maskingInfo.masking || "") : "",
    purpose: di.primaryPurpose || "",
    enroll: dm.enrollmentInfo ? dm.enrollmentInfo.count : null,
    enrollType: dm.enrollmentInfo ? dm.enrollmentInfo.type : null,
    sponsor: lead.name || "Unknown",
    sponsorClass: lead.class || "",
    collaborators: (sp.collaborators || []).map(function (c) { return c.name || ""; }).filter(Boolean).slice(0, 5),
    conditions: ((p.conditionsModule || {}).conditions || []).slice(0, 6),
    mesh: (cb.meshes || []).map(function (m) { return m.term; }),
    ancestors: (cb.ancestors || []).map(function (m) { return m.term; }),
    interventions: interventions.map(function (i) { return i.name || ""; }).filter(Boolean).slice(0, 6),
    intervTypes: interventions.map(function (i) { return i.type || ""; }).filter(Boolean),
  };
}

function classifyArea(f) {
  var pool = f.ancestors.concat(f.mesh);
  var hits = [];
  for (var i = 0; i < AREA_RULES.length; i++) {
    for (var j = 0; j < AREA_RULES[i].terms.length; j++) {
      if (pool.indexOf(AREA_RULES[i].terms[j]) !== -1) { hits.push(AREA_RULES[i].area); break; }
    }
  }
  if (!hits.length) {
    var txt = (f.conditions.join(" ") + " " + f.title).toLowerCase();
    if (/healthy (volunteer|participant|subject|adult)/.test(txt)) hits.push("Healthy Volunteers");
    else if (/cancer|carcinoma|tumou?r|lymphoma|leukemia|myeloma|melanoma|sarcoma/.test(txt)) hits.push("Oncology");
    else if (/obesity|overweight|diabet|weight/.test(txt)) hits.push("Metabolic / Endocrine");
    else hits.push("Other");
  }
  return hits;
}

function matchThemes(f) {
  var hay = (f.conditions.join(" | ") + " | " + f.interventions.join(" | ") + " | " + f.title).toLowerCase();
  var out = [];
  for (var i = 0; i < T.THEMES.length; i++) {
    for (var j = 0; j < T.THEMES[i].terms.length; j++) {
      var t = T.THEMES[i].terms[j].toLowerCase();
      var ok = t.length <= 5 ? new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(hay) : hay.indexOf(t) !== -1;
      if (ok) { out.push(T.THEMES[i].label); break; }
    }
  }
  return out;
}

// ------------------------------------------------------------
//  IMPORTANCE SCORE + PLAIN-ENGLISH COMMENTARY
// ------------------------------------------------------------
const PHASE_PTS = { "PHASE3": 40, "PHASE2|PHASE3": 36, "PHASE2": 24, "PHASE1|PHASE2": 14, "PHASE1": 6, "EARLY_PHASE1": 3, "PHASE4": 10, "NA": 0, "": 0 };

function scoreImportance(f, companyTrialCount, now) {
  var pts = 0, reasons = [];
  var pk = f.phases.join("|");
  var isDevice = f.intervTypes.indexOf("DEVICE") !== -1 || f.intervTypes.indexOf("DIAGNOSTIC_TEST") !== -1;
  var phasePts = PHASE_PTS[pk] != null ? PHASE_PTS[pk] : 10;
  if (pk === "NA" && isDevice && f.type === "INTERVENTIONAL") { phasePts = (f.enroll >= 150 ? 32 : 16); reasons.push(f.enroll >= 150 ? "device pivotal-scale study" : "device feasibility-scale study"); }
  else if (pk === "PHASE3" || pk === "PHASE2|PHASE3") reasons.push("late-stage (" + f.phase + ")");
  else if (pk === "PHASE2") reasons.push("Phase 2 proof-of-concept");
  else if (pk === "PHASE4") reasons.push("post-approval study");
  else if (pk === "PHASE1" || pk === "PHASE1|PHASE2" || pk === "EARLY_PHASE1") reasons.push("early-stage");
  pts += phasePts;

  if (f.type === "INTERVENTIONAL") pts += 6; else { pts -= 6; reasons.push("observational"); }
  if (f.allocation === "RANDOMIZED") { pts += 8; reasons.push("randomized"); }
  if (/DOUBLE|TRIPLE|QUADRUPLE/.test(f.masking)) { pts += 5; reasons.push("blinded"); }

  if (f.enroll >= 2000) { pts += 22; reasons.push(fmtNum(f.enroll) + " patients (outcomes-scale)"); }
  else if (f.enroll >= 800) { pts += 16; reasons.push(fmtNum(f.enroll) + " patients"); }
  else if (f.enroll >= 300) { pts += 10; reasons.push(fmtNum(f.enroll) + " patients"); }
  else if (f.enroll >= 100) pts += 5;

  if (f.status === "ACTIVE_NOT_RECRUITING") { pts += 10; reasons.push("enrollment complete, awaiting data"); }
  else if (f.status === "RECRUITING") pts += 5;
  else if (f.status === "COMPLETED" && !f.results) { pts += 6; reasons.push("completed, results not yet posted"); }
  else if (f.status === "TERMINATED" || f.status === "SUSPENDED" || f.status === "WITHDRAWN") { pts += 8; reasons.push(statusLabel(f.status).toLowerCase()); }

  var m = monthsBetween(isoDate(now), f.pcd);
  if (m != null && m >= -1 && m <= 6 && f.status !== "COMPLETED") { pts += 22; reasons.push("primary completion within 6 months"); }
  else if (m != null && m > 6 && m <= 12 && f.status !== "COMPLETED") { pts += 12; reasons.push("primary completion within 12 months"); }

  // pipeline share: the fewer trials a company runs, the more each one matters
  var share = companyTrialCount <= 3 ? 30 : companyTrialCount <= 10 ? 20 : companyTrialCount <= 30 ? 10 : companyTrialCount <= 100 ? 4 : 0;
  pts += share;
  if (share >= 20) reasons.push("one of only " + companyTrialCount + " trials at this company");

  return { score: Math.max(0, pts), reasons: reasons };
}

function commentary(f, rec) {
  var parts = [];
  var design = [];
  if (f.phase) design.push(f.phase);
  if (f.type === "INTERVENTIONAL") { if (f.allocation === "RANDOMIZED") design.push("randomized"); if (/DOUBLE|TRIPLE|QUADRUPLE/.test(f.masking)) design.push("double-blind"); else if (f.masking === "NONE") design.push("open-label"); }
  else if (f.type) design.push(f.type.toLowerCase());
  if (f.purpose) design.push(f.purpose.toLowerCase().replace(/_/g, " "));
  if (design.length) parts.push(design.join(", ") + ".");

  if (f.enroll != null) {
    if (f.enrollType === "ACTUAL") parts.push("Enrolled " + fmtNum(f.enroll) + (rec.original && rec.original.enroll && rec.original.enroll !== f.enroll ? " vs " + fmtNum(rec.original.enroll) + " originally planned" : rec.tracked && rec.tracked.enroll && rec.tracked.enroll !== f.enroll ? " vs " + fmtNum(rec.tracked.enroll) + " target when we started tracking" : "") + ".");
    else parts.push("Targeting " + fmtNum(f.enroll) + " patients" + (rec.original && rec.original.enroll && rec.original.enroll !== f.enroll ? " (originally " + fmtNum(rec.original.enroll) + ")" : rec.tracked && rec.tracked.enroll && rec.tracked.enroll !== f.enroll ? " (was " + fmtNum(rec.tracked.enroll) + " when tracking began)" : "") + ".");
  }

  if (f.start) {
    var dur = monthsBetween(f.start, f.pcd);
    var s = "Started " + fmtMonth(f.start) + (f.pcd ? ", primary completion " + (f.pcdType === "ESTIMATED" ? "expected " : "") + fmtMonth(f.pcd) : "");
    if (dur != null && dur > 0) s += " (" + (dur / 12).toFixed(1) + " yrs";
    var origPcd = rec.original && rec.original.pcd ? rec.original.pcd : (rec.tracked && rec.tracked.pcd ? rec.tracked.pcd : null);
    if (origPcd && f.pcd && origPcd !== f.pcd) {
      var odur = monthsBetween(f.start, origPcd);
      var slip = monthsBetween(origPcd, f.pcd);
      if (odur != null && odur > 0 && dur != null) s += ", originally planned " + (odur / 12).toFixed(1) + " yrs";
      if (slip != null) s += ", " + (slip > 0 ? "pushed out " : "pulled in ") + Math.abs(Math.round(slip)) + " mo from " + fmtMonth(origPcd);
    }
    if (dur != null && dur > 0) s += ")";
    parts.push(s + ".");
  }
  if (f.status === "ACTIVE_NOT_RECRUITING") parts.push("Enrollment is closed; the next event is data.");
  if (f.why) parts.push("Stopped: " + f.why);
  if (f.results) parts.push("Results are posted on CT.gov" + (f.resultsDate ? " (" + fmtMonth(f.resultsDate) + ")" : "") + ".");
  return parts.join(" ");
}

// ------------------------------------------------------------
//  CHANGE TRACKING (run over run)
// ------------------------------------------------------------
function diff(prev, f) {
  var out = [];
  if (!prev) return out;
  if (prev.status && prev.status !== f.status) out.push("Status: " + statusLabel(prev.status) + " to " + statusLabel(f.status));
  if (prev.pcd && f.pcd && prev.pcd !== f.pcd) {
    var m = monthsBetween(prev.pcd, f.pcd);
    if (m != null && Math.abs(m) >= 1) out.push("Primary completion " + (m > 0 ? "pushed from " : "pulled in from ") + fmtMonth(prev.pcd) + " to " + fmtMonth(f.pcd) + " (" + (m > 0 ? "+" : "") + Math.round(m) + " mo)");
  }
  if (prev.enroll != null && f.enroll != null && prev.enroll !== f.enroll) {
    var pct = prev.enroll > 0 ? Math.round((f.enroll - prev.enroll) / prev.enroll * 100) : 0;
    if (prev.enrollType === "ESTIMATED" && f.enrollType === "ACTUAL") out.push("Enrollment finalized at " + fmtNum(f.enroll) + " vs " + fmtNum(prev.enroll) + " target (" + pct + "%)");
    else out.push("Target enrollment " + (pct < 0 ? "cut" : "raised") + " from " + fmtNum(prev.enroll) + " to " + fmtNum(f.enroll) + " (" + (pct > 0 ? "+" : "") + pct + "%)");
  } else if (prev.enrollType === "ESTIMATED" && f.enrollType === "ACTUAL") out.push("Enrollment finalized at " + fmtNum(f.enroll));
  if (!prev.results && f.results) out.push("Results posted");
  if (prev.phase && f.phase && prev.phase !== f.phase) out.push("Phase: " + prev.phase + " to " + f.phase);
  if (prev.start && f.start && prev.start !== f.start) { var ms = monthsBetween(prev.start, f.start); if (ms != null && Math.abs(ms) >= 2) out.push("Start date moved from " + fmtMonth(prev.start) + " to " + fmtMonth(f.start)); }
  return out;
}

// ------------------------------------------------------------
//  MAIN
// ------------------------------------------------------------
async function main() {
  var now = new Date();
  var today = isoDate(now);
  console.log("=== Pipeline data build " + now.toISOString() + " ===");
  console.log("Ticker map: " + T.TICKER_MAP.length + " groups (" + T.COVERAGE.length + " coverage)");
  fs.mkdirSync(TICKER_DIR, { recursive: true });

  // 1. Sweep CT.gov
  var ongoing = await sweep("AREA[LeadSponsorClass]INDUSTRY", ONGOING, MAX_PAGES_ONGOING, "industry-led ongoing");
  var closedSince = isoDate(addMonths(now, -CLOSED_LOOKBACK_MONTHS));
  var closed = await sweep("AREA[LeadSponsorClass]INDUSTRY AND AREA[LastUpdatePostDate]RANGE[" + closedSince + ",MAX]", CLOSED, MAX_PAGES_CLOSED, "industry-led closed, updated since " + closedSince);
  var studies = ongoing.concat(closed);
  console.log("Total studies: " + studies.length);

  // 2. Classify by ticker
  var byTicker = {}, candidates = {}, seen = {};
  for (var i = 0; i < studies.length; i++) {
    var f = extract(studies[i]);
    if (!f.nct || seen[f.nct]) continue;
    seen[f.nct] = true;
    var tk = T.matchNames([{ name: f.sponsor, role: "lead" }]);
    if (!tk) {
      var c = candidates[f.sponsor] || (candidates[f.sponsor] = { name: f.sponsor, total: 0, ongoing: 0, p3: 0 });
      c.total++; if (ONGOING.indexOf(f.status) !== -1) c.ongoing++; if (f.phases.indexOf("PHASE3") !== -1) c.p3++;
      continue;
    }
    if (tk.ticker === "PRIVATE") continue;
    f.ticker = tk.ticker; f.sector = tk.sector; f.coverage = tk.coverage; f.context = tk.context;
    f.areas = classifyArea(f); f.area = f.areas[0];
    f.themes = matchThemes(f);
    (byTicker[tk.ticker] = byTicker[tk.ticker] || []).push(f);
  }
  var tickers = Object.keys(byTicker).sort();
  console.log("Mapped tickers with trials: " + tickers.length + " | candidate sponsors: " + Object.keys(candidates).length);

  // 3. Load prior data + history cache
  var histCache = {};
  try { histCache = JSON.parse(fs.readFileSync(HISTORY_CACHE, "utf8")); } catch (e) { histCache = {}; }

  var index = { generated: now.toISOString(), companies: [], readouts: [], terminations: [], candidates: [] };
  var historyLookups = 0;

  for (var t = 0; t < tickers.length; t++) {
    var ticker = tickers[t];
    var list = byTicker[ticker];
    var prevMap = {};
    try {
      var prevFile = JSON.parse(fs.readFileSync(path.join(TICKER_DIR, ticker + ".json"), "utf8"));
      (prevFile.trials || []).forEach(function (r) { prevMap[r.nct] = r; });
    } catch (e) { /* first run for this ticker */ }

    var ongoingCount = list.filter(function (f) { return ONGOING.indexOf(f.status) !== -1; }).length;
    var records = [];
    for (var k = 0; k < list.length; k++) {
      var g = list[k];
      var prev = prevMap[g.nct];
      var imp = scoreImportance(g, ongoingCount, now);
      var rec = {
        nct: g.nct, title: g.title, status: g.status, statusLabel: statusLabel(g.status), why: g.why,
        phase: g.phase, phaseKey: g.phases.join("|"), type: g.type, allocation: g.allocation, masking: g.masking, purpose: g.purpose,
        area: g.area, areas: g.areas, themes: g.themes, conditions: g.conditions, interventions: g.interventions, intervTypes: g.intervTypes,
        enroll: g.enroll, enrollType: g.enrollType, start: g.start, pcd: g.pcd, pcdType: g.pcdType, completion: g.completion,
        firstPost: g.firstPost, lastUpdate: g.lastUpdate, results: g.results, resultsDate: g.resultsDate,
        sponsor: g.sponsor, collaborators: g.collaborators,
        importance: imp.score, reasons: imp.reasons,
        tracked: prev && prev.tracked ? prev.tracked : { since: today, status: g.status, pcd: g.pcd, enroll: g.enroll, enrollType: g.enrollType, start: g.start },
        original: prev && prev.original ? prev.original : (histCache[g.nct] || null),
        changes: prev && prev.changes ? prev.changes.slice() : [],
      };
      var d = diff(prev, g);
      for (var x = 0; x < d.length; x++) rec.changes.unshift({ date: today, text: d[x] });
      if (rec.changes.length > MAX_CHANGES_PER_TRIAL) rec.changes = rec.changes.slice(0, MAX_CHANGES_PER_TRIAL);

      // original record lookup for the most important trials, once per NCT
      if (!SKIP_HISTORY && historyAvailable && !rec.original && !histCache[g.nct] && imp.score >= 70 && historyLookups < MAX_HISTORY_LOOKUPS) {
        historyLookups++;
        var orig = await fetchOriginal(g.nct);
        histCache[g.nct] = orig || { source: "lookup failed", date: today };
        if (orig && orig.source !== "history-list-only") rec.original = orig;
        await sleep(REQUEST_DELAY_MS);
      }
      rec.commentary = commentary(g, rec);
      records.push(rec);
    }
    records.sort(function (a, b) { return b.importance - a.importance || (a.pcd || "9999").localeCompare(b.pcd || "9999"); });

    // company summary
    var areas = {};
    records.forEach(function (r) { if (ONGOING.indexOf(r.status) !== -1) areas[r.area] = (areas[r.area] || 0) + 1; });
    var p3 = records.filter(function (r) { return ONGOING.indexOf(r.status) !== -1 && /PHASE3/.test(r.phaseKey); }).length;
    var next = records.filter(function (r) { return ONGOING.indexOf(r.status) !== -1 && r.pcd && r.pcd >= today.substring(0, 7); }).sort(function (a, b) { return a.pcd.localeCompare(b.pcd); })[0];
    var changedToday = records.filter(function (r) { return r.changes.length && r.changes[0].date === today; }).length;
    var closedRecent = records.filter(function (r) { return /TERMINATED|SUSPENDED|WITHDRAWN/.test(r.status); }).length;
    index.companies.push({
      ticker: ticker, sector: list[0].sector, coverage: list[0].coverage, name: list[0].sponsor, context: list[0].context,
      total: records.length, ongoing: ongoingCount, phase3: p3, terminated12m: closedRecent, changedToday: changedToday,
      topImportance: records.length ? records[0].importance : 0, nextReadout: next ? next.pcd : null, areas: areas,
    });

    fs.writeFileSync(path.join(TICKER_DIR, ticker + ".json"), JSON.stringify({ ticker: ticker, generated: now.toISOString(), trials: records }));

    // global lists
    var horizon = isoDate(addDays(now, READOUT_WINDOW_DAYS)).substring(0, 7);
    records.forEach(function (r) {
      if (ONGOING.indexOf(r.status) !== -1 && r.pcd && r.pcd >= today.substring(0, 7) && r.pcd <= horizon && /PHASE3|PHASE2/.test(r.phaseKey)) {
        index.readouts.push({ ticker: ticker, coverage: list[0].coverage, nct: r.nct, title: r.title, phase: r.phase, pcd: r.pcd, status: r.statusLabel, enroll: r.enroll, area: r.area, importance: r.importance, intervention: r.interventions[0] || "" });
      }
      if (/TERMINATED|SUSPENDED|WITHDRAWN/.test(r.status) && r.lastUpdate && r.lastUpdate >= closedSince) {
        index.terminations.push({ ticker: ticker, coverage: list[0].coverage, nct: r.nct, title: r.title, phase: r.phase, status: r.statusLabel, why: r.why, lastUpdate: r.lastUpdate, enroll: r.enroll, area: r.area, importance: r.importance });
      }
    });
  }

  index.readouts.sort(function (a, b) { return a.pcd.localeCompare(b.pcd) || b.importance - a.importance; });
  index.terminations.sort(function (a, b) { return b.lastUpdate.localeCompare(a.lastUpdate) || b.importance - a.importance; });
  index.terminations = index.terminations.slice(0, 500);
  index.companies.sort(function (a, b) { return (a.coverage ? 0 : 1) - (b.coverage ? 0 : 1) || b.ongoing - a.ongoing; });

  // candidates: unmapped industry lead sponsors, by trial count
  var candList = Object.keys(candidates).map(function (k) { return candidates[k]; }).sort(function (a, b) { return b.ongoing - a.ongoing || b.total - a.total || a.name.localeCompare(b.name); });
  index.candidates = candList.slice(0, 300);
  fs.writeFileSync(path.join(OUT_DIR, "candidates.csv"), ["Sponsor,Ongoing trials,Phase 3 trials,Total trials in scope"].concat(candList.map(function (c) { return [c.name, c.ongoing, c.p3, c.total].map(csvCell).join(","); })).join("\r\n"));

  index.stats = { studiesInScope: studies.length, mappedTrials: index.companies.reduce(function (s, c) { return s + c.total; }, 0), mappedCompanies: index.companies.length, candidateSponsors: candList.length, historyLookups: historyLookups, historyAvailable: historyAvailable };
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index));
  fs.writeFileSync(HISTORY_CACHE, JSON.stringify(histCache));

  console.log("");
  console.log("Companies: " + index.stats.mappedCompanies + " | mapped trials: " + index.stats.mappedTrials + " | readouts next " + READOUT_WINDOW_DAYS + "d: " + index.readouts.length + " | terminations 12m: " + index.terminations.length);
  console.log("Candidate sponsors (unmapped): " + candList.length + ". Top 15: " + candList.slice(0, 15).map(function (c) { return c.name + " (" + c.ongoing + ")"; }).join(", "));
  console.log("Original-record lookups this run: " + historyLookups + (historyAvailable ? "" : " (endpoint unavailable)"));
  console.log("=== DONE ===");
}

if (require.main === module) {
  main().catch(function (e) { console.error("FATAL:", e.message || e); process.exit(1); });
}
module.exports = { extract, classifyArea, scoreImportance, commentary, diff };
