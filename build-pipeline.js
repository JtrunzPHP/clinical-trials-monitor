// build-pipeline.js - Public-company clinical pipeline data builder (v2: plan vs actual)
//
// v2 joins the record history collected by collect-history.js and rebuilds every trial around
// the gap between what the sponsor originally registered and what the record says today:
//   - primary completion date vs original (months slipped or pulled forward, number of moves)
//   - start date vs original, planned duration vs current duration
//   - enrollment vs original target (target raised or cut; actual delivered vs original plan)
//   - primary endpoint changed after registration (date, original vs current wording)
//   - status timeline with dates (recruiting opened, enrollment closed, completed, terminated)
//   - results posting overdue vs primary completion
//   - termination / suspension reason classified
// Each trial gets a deviation score and plain-English signal lines, separate from the
// company-importance score. index.json carries a global deviations list for the email.
//
// Trials whose history has not been collected yet fall back to "since first seen" tracking
// and are flagged historyPending.
//
// Outputs (data/pipeline/): index.json, tickers/<TICKER>.json, candidates.csv

"use strict";

const fs = require("fs");
const path = require("path");
const T = require("./tickers.js");

const CT_API = "https://clinicaltrials.gov/api/v2/studies";
const OUT_DIR = path.join(__dirname, "data", "pipeline");
const TICKER_DIR = path.join(OUT_DIR, "tickers");
const HIST_DIR = path.join(OUT_DIR, "history");

const PAGE_SIZE = 1000;
const MAX_PAGES_ONGOING = 80;
const MAX_PAGES_CLOSED = 40;
const CLOSED_LOOKBACK_MONTHS = 12;
const READOUT_WINDOW_DAYS = 90;
const MAX_CHANGES_PER_TRIAL = 25;
const MAX_DEVIATIONS_IN_INDEX = 1500;
const RESULTS_OVERDUE_MONTHS = 12;     // FDAAA window after primary completion
const REQUEST_DELAY_MS = 250;

const ONGOING = "RECRUITING,ACTIVE_NOT_RECRUITING,NOT_YET_RECRUITING,ENROLLING_BY_INVITATION";
const CLOSED = "COMPLETED,TERMINATED,WITHDRAWN,SUSPENDED";

const API_FIELDS = [
  "NCTId", "BriefTitle", "OverallStatus", "WhyStopped", "LastUpdatePostDate", "StudyFirstPostDate", "StartDate",
  "PrimaryCompletionDate", "CompletionDate", "Phase", "EnrollmentCount", "EnrollmentType", "StudyType",
  "DesignAllocation", "DesignMasking", "DesignPrimaryPurpose", "LeadSponsorName", "LeadSponsorClass",
  "CollaboratorName", "CollaboratorClass", "Condition", "ConditionMeshTerm", "ConditionAncestorTerm",
  "InterventionName", "InterventionType", "HasResults", "ResultsFirstPostDate", "PrimaryOutcomeMeasure",
].join(",");

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
function parseCtDate(s) { if (!s) return null; var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1)) : null; }
function fmtMonth(s) { var d = parseCtDate(s); return d ? d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : (s || "n/a"); }
function monthsBetween(a, b) { var da = parseCtDate(a), db = parseCtDate(b); if (!da || !db) return null; return Math.round(((db - da) / (30.44 * 86400000)) * 10) / 10; }
function fmtNum(n) { return n == null ? "n/a" : Number(n).toLocaleString("en-US"); }
function pct(a, b) { return (b == null || b === 0 || a == null) ? null : Math.round((a - b) / b * 100); }
function statusLabel(s) {
  return ({ TERMINATED: "Terminated", WITHDRAWN: "Withdrawn", SUSPENDED: "Suspended", COMPLETED: "Completed", ACTIVE_NOT_RECRUITING: "Active, not recruiting",
    ENROLLING_BY_INVITATION: "Enrolling by invitation", RECRUITING: "Recruiting", NOT_YET_RECRUITING: "Not yet recruiting" })[s] || String(s || "Unknown").replace(/_/g, " ");
}
function phaseLabel(phases) { if (!phases || !phases.length) return ""; return phases.map(function (p) { return p === "NA" ? "N/A" : p.replace("EARLY_PHASE1", "Early Ph 1").replace("PHASE", "Ph "); }).join("/"); }
function csvCell(v) { var s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function isOngoing(status) { return ONGOING.indexOf(status) !== -1; }
function isStopped(status) { return /TERMINATED|SUSPENDED|WITHDRAWN/.test(status); }

// ------------------------------------------------------------
//  API
// ------------------------------------------------------------
var FIELDS_SUPPORTED = true;
async function fetchJson(url) {
  var lastErr = null;
  for (var attempt = 1; attempt <= 4; attempt++) {
    try {
      var resp = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "clinical-trials-monitor/pipeline-2.0" } });
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
    if (!r.ok && FIELDS_SUPPORTED && r.status === 400 && pg === 0) { console.log("  fields parameter rejected, retrying with full records"); FIELDS_SUPPORTED = false; r = await fetchJson(buildUrl(term, statuses, token, false)); }
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
//  HISTORY STORE (written by collect-history.js)
// ------------------------------------------------------------
function loadHistory() {
  var map = {}, files = [];
  try { files = fs.readdirSync(HIST_DIR).filter(function (f) { return /^NCT\d+\.json$/.test(f); }); } catch (e) { return map; }
  files.forEach(function (f) {
    try { var shard = JSON.parse(fs.readFileSync(path.join(HIST_DIR, f), "utf8")); Object.keys(shard).forEach(function (k) { map[k] = shard[k]; }); } catch (e) { /* skip */ }
  });
  return map;
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
  var om = p.outcomesModule || {};
  var cb = ((study.derivedSection || {}).conditionBrowseModule) || {};
  var lead = sp.leadSponsor || {};
  var phases = dm.phases || [];
  var interventions = ai.interventions || [];
  return {
    nct: id.nctId || "", title: id.briefTitle || "Untitled",
    status: sm.overallStatus || "UNKNOWN", why: sm.whyStopped || "",
    lastUpdate: sm.lastUpdatePostDateStruct ? sm.lastUpdatePostDateStruct.date : null,
    firstPost: sm.studyFirstPostDateStruct ? sm.studyFirstPostDateStruct.date : null,
    start: sm.startDateStruct ? sm.startDateStruct.date : null, startType: sm.startDateStruct ? sm.startDateStruct.type : null,
    pcd: sm.primaryCompletionDateStruct ? sm.primaryCompletionDateStruct.date : null, pcdType: sm.primaryCompletionDateStruct ? sm.primaryCompletionDateStruct.type : null,
    completion: sm.completionDateStruct ? sm.completionDateStruct.date : null,
    results: !!study.hasResults, resultsDate: sm.resultsFirstPostDateStruct ? sm.resultsFirstPostDateStruct.date : null,
    phases: phases, phase: phaseLabel(phases), type: dm.studyType || "",
    allocation: di.allocation || "", masking: di.maskingInfo ? (di.maskingInfo.masking || "") : "", purpose: di.primaryPurpose || "",
    enroll: dm.enrollmentInfo ? dm.enrollmentInfo.count : null, enrollType: dm.enrollmentInfo ? dm.enrollmentInfo.type : null,
    sponsor: lead.name || "Unknown", sponsorClass: lead.class || "",
    collaborators: (sp.collaborators || []).map(function (c) { return c.name || ""; }).filter(Boolean).slice(0, 5),
    conditions: ((p.conditionsModule || {}).conditions || []).slice(0, 6),
    mesh: (cb.meshes || []).map(function (m) { return m.term; }), ancestors: (cb.ancestors || []).map(function (m) { return m.term; }),
    interventions: interventions.map(function (i) { return i.name || ""; }).filter(Boolean).slice(0, 6),
    intervTypes: interventions.map(function (i) { return i.type || ""; }).filter(Boolean),
    primaryOutcomes: (om.primaryOutcomes || []).map(function (o) { return { measure: o.measure || "", timeFrame: o.timeFrame || "" }; }).slice(0, 6),
  };
}
function classifyArea(f) {
  var pool = f.ancestors.concat(f.mesh), hits = [];
  for (var i = 0; i < AREA_RULES.length; i++) for (var j = 0; j < AREA_RULES[i].terms.length; j++) if (pool.indexOf(AREA_RULES[i].terms[j]) !== -1) { hits.push(AREA_RULES[i].area); break; }
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
  var hay = (f.conditions.join(" | ") + " | " + f.interventions.join(" | ") + " | " + f.title).toLowerCase(), out = [];
  for (var i = 0; i < T.THEMES.length; i++) for (var j = 0; j < T.THEMES[i].terms.length; j++) {
    var t = T.THEMES[i].terms[j].toLowerCase();
    var ok = t.length <= 5 ? new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(hay) : hay.indexOf(t) !== -1;
    if (ok) { out.push(T.THEMES[i].label); break; }
  }
  return out;
}
function classifyWhyStopped(why) {
  var w = (why || "").toLowerCase();
  if (!w) return "unstated";
  // strip negated safety/efficacy mentions ("not due to safety concerns", "no efficacy issues")
  w = w.replace(/\b(not|no|without|unrelated to|independent of)\s+(due to |related to |because of |any |a )?(safety|efficacy|tolerability)[^,.;]*/g, " ");
  if (/safety|adverse|toxicit|death|tolerab|serious/.test(w)) return "safety";
  if (/futilit|efficacy|lack of (efficacy|benefit)|did not (meet|demonstrate|show)|not (met|meet)|interim analysis|benefit/.test(w)) return "efficacy / futility";
  if (/enrol|recruit|accrual|slow|insufficient (number|patients|participants)|low (number|rate)/.test(w)) return "enrollment";
  if (/fund|financ|budget|resourc|capital/.test(w)) return "funding";
  if (/regulat|fda|ema|clinical hold|hold|agency/.test(w)) return "regulatory";
  if (/business|strateg|sponsor decision|portfolio|priorit|commercial|company decision|reprioritiz/.test(w)) return "business / strategic";
  if (/covid|pandemic/.test(w)) return "covid";
  if (/manufactur|supply|drug supply|cmc/.test(w)) return "supply / manufacturing";
  if (/design|protocol|amend|redesign|replaced|superseded|new study/.test(w)) return "study redesign";
  return "other";
}

// ------------------------------------------------------------
//  PLAN VS ACTUAL
// ------------------------------------------------------------
// Returns { signals: [{kind, severity, text, read, date}], score, plan: {...} }
function planVsActual(f, hist, prev, today, now) {
  var signals = [], plan = {};
  var orig = hist && hist.original ? hist.original : null;
  var origEnroll = hist ? (hist.originalEnroll != null ? hist.originalEnroll : (orig ? orig.enroll : null)) : null;
  var baseline = orig ? "original registration (" + fmtMonth(orig.posted || hist.firstDate) + ")" : (prev && prev.tracked ? "first seen " + fmtMonth(prev.tracked.since) : null);
  var basePcd = orig ? orig.pcd : (prev && prev.tracked ? prev.tracked.pcd : null);
  var baseStart = orig ? orig.start : (prev && prev.tracked ? prev.tracked.start : null);
  var baseEnroll = orig ? origEnroll : (prev && prev.tracked ? prev.tracked.enroll : null);
  plan.baseline = baseline; plan.historyPending = !hist;
  plan.origStart = baseStart; plan.origPcd = basePcd; plan.origCompletion = orig ? orig.completion : null; plan.origEnroll = baseEnroll;
  plan.origPrimaryOutcomes = hist && hist.originalPrimaryOutcomes ? hist.originalPrimaryOutcomes : null;
  plan.versions = hist ? hist.versions : null;
  plan.timeline = hist ? hist.timeline : null;

  // Primary completion date vs plan (skipped for stopped trials: a termination truncates the date)
  if (basePcd && f.pcd && !isStopped(f.status)) {
    var slip = monthsBetween(basePcd, f.pcd);
    plan.pcdSlipMonths = slip;
    // count distinct PCD values across history samples plus current
    var seen = {}, moves = 0, last = null;
    if (hist && hist.samples) hist.samples.forEach(function (s) { if (s.pcd && s.pcd !== last) { if (last !== null) moves++; last = s.pcd; } });
    if (f.pcd && last && f.pcd !== last) moves++;
    plan.pcdMoves = hist ? moves : null;
    var eventDriven = /outcome|event|mortality|morbidity|mace|survival|time to first/i.test(f.primaryOutcomes.map(function (o) { return o.measure; }).join(" ") + " " + f.title);
    if (slip != null && slip >= 3) {
      signals.push({ kind: "pcd_slip", severity: slip >= 12 ? "high" : "medium", date: f.lastUpdate,
        text: "Primary completion pushed out " + Math.round(slip) + " months vs " + baseline + ": " + fmtMonth(basePcd) + " to " + fmtMonth(f.pcd) + (plan.pcdMoves ? " (" + plan.pcdMoves + " move" + (plan.pcdMoves === 1 ? "" : "s") + " on record)" : ""),
        read: slip >= 12 ? "Large cumulative delay. Usually slow enrollment or a protocol change; check for an amendment and whether guidance moved with it." : "Moderate delay. One slip is common; repeated slips are the signal." });
    } else if (slip != null && slip <= -3) {
      signals.push({ kind: "pcd_pull", severity: "medium", date: f.lastUpdate,
        text: "Primary completion pulled forward " + Math.abs(Math.round(slip)) + " months vs " + baseline + ": " + fmtMonth(basePcd) + " to " + fmtMonth(f.pcd),
        read: eventDriven ? "Event-driven design: events accrued faster than modeled, which can be good or bad for the drug, or an interim stop. Read the amendment before assuming either." : "Enrollment ran ahead of plan. Generally a demand and execution positive." });
    }
  }
  // Start date vs plan
  if (baseStart && f.start) {
    var ss = monthsBetween(baseStart, f.start);
    plan.startSlipMonths = ss;
    if (ss != null && ss >= 6) signals.push({ kind: "start_slip", severity: "low", date: f.lastUpdate, text: "Start date slipped " + Math.round(ss) + " months vs " + baseline + " (" + fmtMonth(baseStart) + " to " + fmtMonth(f.start) + ")", read: "Late start. Often site activation or supply; not itself predictive but it compounds a PCD slip." });
  }
  if (f.status === "NOT_YET_RECRUITING" && f.start && monthsBetween(f.start, today) >= 6) {
    signals.push({ kind: "not_started", severity: "medium", date: f.lastUpdate, text: "Still 'not yet recruiting' " + Math.round(monthsBetween(f.start, today)) + " months after its planned start (" + fmtMonth(f.start) + ")", read: "Registered but not opened. Watch for quiet withdrawal." });
  }
  // Planned vs current duration
  if (baseStart && basePcd && f.start && f.pcd) {
    var pd = monthsBetween(baseStart, basePcd), cd = monthsBetween(f.start, f.pcd);
    if (pd > 0 && cd > 0) { plan.plannedDurationMonths = pd; plan.currentDurationMonths = cd; }
  }
  // Enrollment vs plan
  if (baseEnroll != null && f.enroll != null && baseEnroll > 0) {
    var ep = pct(f.enroll, baseEnroll);
    plan.enrollDeltaPct = ep;
    if (f.enrollType === "ACTUAL" && (hist ? hist.originalEnrollType !== "ACTUAL" : true)) {
      if (ep >= 20) signals.push({ kind: "enroll_over", severity: "medium", date: f.lastUpdate, text: "Enrolled " + fmtNum(f.enroll) + " vs original target " + fmtNum(baseEnroll) + " (+" + ep + "%)", read: "Over-delivered on enrollment. Strong investigator and patient demand, or cohorts were expanded after an early signal." });
      else if (ep <= -20) signals.push({ kind: "enroll_under", severity: isStopped(f.status) ? "low" : (ep <= -40 ? "high" : "medium"), date: f.lastUpdate, text: "Enrolled " + fmtNum(f.enroll) + " vs original target " + fmtNum(baseEnroll) + " (" + ep + "%)", read: "Closed well short of plan. Either enrollment stalled or the sponsor cut the study; powering may be compromised." });
      else signals.push({ kind: "enroll_final", severity: "info", date: f.lastUpdate, text: "Enrollment finalized at " + fmtNum(f.enroll) + " vs original target " + fmtNum(baseEnroll) + " (" + (ep > 0 ? "+" : "") + ep + "%)", read: "Delivered roughly to plan." });
    } else if (f.enrollType !== "ACTUAL") {
      if (ep >= 25) signals.push({ kind: "target_up", severity: "medium", date: f.lastUpdate, text: "Target enrollment raised from " + fmtNum(baseEnroll) + " to " + fmtNum(f.enroll) + " (+" + ep + "%)", read: isOngoing(f.status) && f.status === "ACTIVE_NOT_RECRUITING" ? "Raised after enrollment closed is unusual; check for a sample-size re-estimation." : "Sample size increased. After an interim it usually means the effect size came in below the powering assumption; before enrollment it can mean new cohorts or geographies." });
      else if (ep <= -25) signals.push({ kind: "target_cut", severity: "high", date: f.lastUpdate, text: "Target enrollment cut from " + fmtNum(baseEnroll) + " to " + fmtNum(f.enroll) + " (" + ep + "%)", read: "Study was shrunk. Slow enrollment, cost, or a design change; smaller studies are less likely to hit their endpoint." });
    }
  }
  // Primary endpoint changed
  if (hist && hist.endpointChanged) {
    var when = hist.endpointChangedDate;
    var afterStart = when && f.start && when > f.start;
    var o0 = (hist.originalPrimaryOutcomes || []).map(function (o) { return o.measure; }).join("; ");
    var o1 = f.primaryOutcomes.map(function (o) { return o.measure; }).join("; ");
    plan.endpointChangedDate = when;
    signals.push({ kind: "endpoint", severity: afterStart ? "high" : "low", date: when || f.lastUpdate,
      text: "Primary endpoint changed" + (when ? " on " + fmtMonth(when) : "") + (afterStart ? " after the study started" : " before the study started") + (hist.outcomesUpdateCount > 1 ? " (" + hist.outcomesUpdateCount + " outcome edits on record)" : ""),
      read: afterStart ? "Primary outcome re-specified mid-study. The most consistently negative amendment in the trial-outcome literature; compare original vs current wording." : "Endpoint edited before start; usually regulatory feedback and not a red flag.",
      detail: o0 && o1 && o0 !== o1 ? { original: o0.substring(0, 300), current: o1.substring(0, 300) } : null });
  }
  // Results overdue
  if (f.pcd && !f.results && (f.status === "COMPLETED" || f.status === "ACTIVE_NOT_RECRUITING" || isStopped(f.status))) {
    var since = monthsBetween(f.pcd, today);
    if (since != null && since >= RESULTS_OVERDUE_MONTHS && /PHASE2|PHASE3/.test(f.phases.join("|"))) {
      plan.resultsOverdueMonths = since;
      signals.push({ kind: "results_overdue", severity: since >= 24 ? "high" : "medium", date: f.lastUpdate, text: "No results posted " + Math.round(since) + " months after primary completion (" + fmtMonth(f.pcd) + ")", read: "Past the 12-month FDAAA window. Delayed posting skews toward negative or unflattering results." });
    }
  }
  // Termination / suspension
  if (isStopped(f.status)) {
    var cls = classifyWhyStopped(f.why);
    plan.stopReason = cls;
    var reads = { "safety": "Safety stop. Read-through to the whole program and to competitors on the same mechanism.", "efficacy / futility": "Stopped for lack of efficacy or futility. Treat as a failed readout.", "enrollment": "Could not enroll. Execution or market-size problem rather than a drug problem, but it still removes the asset.", "funding": "Stopped for lack of money. Going-concern flag for small caps.", "regulatory": "Regulatory stop or hold. Check for an 8-K.", "business / strategic": "Portfolio decision. Often follows disappointing data the sponsor has not published; check whether a competitor's data moved first.", "covid": "Pandemic-related.", "supply / manufacturing": "Supply or CMC problem. Often resolvable; watch for a restart.", "study redesign": "Replaced by a redesigned study. Check that the successor is registered.", "unstated": "No reason given. Treat as negative until explained.", "other": "Reason given but not classified; read it." };
    signals.push({ kind: "stopped", severity: (cls === "safety" || cls === "efficacy / futility" || cls === "unstated") ? "high" : "medium", date: f.lastUpdate,
      text: statusLabel(f.status) + (f.why ? ", reason: " + f.why : ", no reason given") + " [" + cls + "]", read: reads[cls] || reads.other });
  }
  // Status timeline derived facts
  if (hist && hist.timeline && hist.timeline.length) {
    var rec = hist.timeline.filter(function (t) { return t.status === "RECRUITING"; })[0];
    var anr = hist.timeline.filter(function (t) { return t.status === "ACTIVE_NOT_RECRUITING"; })[0];
    var comp = hist.timeline.filter(function (t) { return t.status === "COMPLETED"; })[0];
    plan.recruitingOpened = rec ? rec.date : null; plan.enrollmentClosed = anr ? anr.date : null; plan.completedOn = comp ? comp.date : null;
    if (rec && anr) plan.recruitingMonths = monthsBetween(rec.date, anr.date);
    if (anr && !comp && isOngoing(f.status)) plan.monthsSinceEnrollmentClosed = monthsBetween(anr.date, today);
  }
  // Amendment intensity
  if (hist && hist.versions && f.firstPost) {
    var yrs = Math.max(0.5, (monthsBetween(f.firstPost, today) || 6) / 12);
    plan.amendmentsPerYear = Math.round(hist.versions / yrs * 10) / 10;
  }

  // Score the deviation
  var sev = { high: 30, medium: 15, low: 5, info: 0 };
  var score = 0;
  signals.forEach(function (s) { score += sev[s.severity] || 0; });
  if (plan.pcdMoves >= 3) score += 10;
  if (/PHASE3/.test(f.phases.join("|"))) score = Math.round(score * 1.3);
  else if (/PHASE2/.test(f.phases.join("|"))) score = Math.round(score * 1.1);
  return { signals: signals, score: score, plan: plan };
}

// ------------------------------------------------------------
//  IMPORTANCE (unchanged from v1) + commentary
// ------------------------------------------------------------
const PHASE_PTS = { "PHASE3": 40, "PHASE2|PHASE3": 36, "PHASE2": 24, "PHASE1|PHASE2": 14, "PHASE1": 6, "EARLY_PHASE1": 3, "PHASE4": 10, "NA": 0, "": 0 };
function scoreImportance(f, companyTrialCount, now) {
  var pts = 0, reasons = [], pk = f.phases.join("|");
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
  if (f.enroll >= 2000) { pts += 22; reasons.push(fmtNum(f.enroll) + " patients (outcomes-scale)"); } else if (f.enroll >= 800) { pts += 16; reasons.push(fmtNum(f.enroll) + " patients"); } else if (f.enroll >= 300) { pts += 10; reasons.push(fmtNum(f.enroll) + " patients"); } else if (f.enroll >= 100) pts += 5;
  if (f.status === "ACTIVE_NOT_RECRUITING") { pts += 10; reasons.push("enrollment complete, awaiting data"); } else if (f.status === "RECRUITING") pts += 5; else if (f.status === "COMPLETED" && !f.results) { pts += 6; reasons.push("completed, results not yet posted"); } else if (isStopped(f.status)) { pts += 8; reasons.push(statusLabel(f.status).toLowerCase()); }
  var m = monthsBetween(isoDate(now), f.pcd);
  if (m != null && m >= -1 && m <= 6 && f.status !== "COMPLETED") { pts += 22; reasons.push("primary completion within 6 months"); } else if (m != null && m > 6 && m <= 12 && f.status !== "COMPLETED") { pts += 12; reasons.push("primary completion within 12 months"); }
  var share = companyTrialCount <= 3 ? 30 : companyTrialCount <= 10 ? 20 : companyTrialCount <= 30 ? 10 : companyTrialCount <= 100 ? 4 : 0;
  pts += share; if (share >= 20) reasons.push("one of only " + companyTrialCount + " trials at this company");
  return { score: Math.max(0, pts), reasons: reasons };
}
function commentary(f, plan) {
  var parts = [], design = [];
  if (f.phase) design.push(f.phase);
  if (f.type === "INTERVENTIONAL") { if (f.allocation === "RANDOMIZED") design.push("randomized"); if (/DOUBLE|TRIPLE|QUADRUPLE/.test(f.masking)) design.push("double-blind"); else if (f.masking === "NONE") design.push("open-label"); } else if (f.type) design.push(f.type.toLowerCase());
  if (design.length) parts.push(design.join(", ") + ".");
  if (f.enroll != null) {
    var e = f.enrollType === "ACTUAL" ? "Enrolled " + fmtNum(f.enroll) : "Targeting " + fmtNum(f.enroll) + " patients";
    if (plan.origEnroll != null && plan.origEnroll !== f.enroll) e += " vs " + fmtNum(plan.origEnroll) + " at " + (plan.historyPending ? "first seen" : "registration") + " (" + (plan.enrollDeltaPct > 0 ? "+" : "") + plan.enrollDeltaPct + "%)";
    parts.push(e + ".");
  }
  if (f.start) {
    var s = "Started " + fmtMonth(f.start) + (plan.origStart && plan.origStart !== f.start ? " (planned " + fmtMonth(plan.origStart) + ")" : "");
    if (f.pcd) {
      s += ", primary completion " + (f.pcdType === "ESTIMATED" ? "expected " : "") + fmtMonth(f.pcd);
      if (plan.origPcd && plan.origPcd !== f.pcd) s += " vs " + fmtMonth(plan.origPcd) + " at " + (plan.historyPending ? "first seen" : "registration") + " (" + (plan.pcdSlipMonths > 0 ? "+" : "") + Math.round(plan.pcdSlipMonths) + " mo" + (plan.pcdMoves ? ", " + plan.pcdMoves + " moves" : "") + ")";
      if (plan.plannedDurationMonths && plan.currentDurationMonths && Math.abs(plan.currentDurationMonths - plan.plannedDurationMonths) >= 3) s += "; planned " + (plan.plannedDurationMonths / 12).toFixed(1) + " yrs, now " + (plan.currentDurationMonths / 12).toFixed(1) + " yrs";
    }
    parts.push(s + ".");
  }
  if (plan.recruitingOpened) parts.push("Recruiting opened " + fmtMonth(plan.recruitingOpened) + (plan.enrollmentClosed ? ", enrollment closed " + fmtMonth(plan.enrollmentClosed) + " (" + Math.round(plan.recruitingMonths) + " mo recruiting)" : "") + (plan.completedOn ? ", completed " + fmtMonth(plan.completedOn) : "") + ".");
  if (plan.monthsSinceEnrollmentClosed != null) parts.push("Enrollment has been closed " + Math.round(plan.monthsSinceEnrollmentClosed) + " months; the next event is data.");
  if (f.why) parts.push("Stopped: " + f.why);
  if (f.results) parts.push("Results posted on CT.gov" + (f.resultsDate ? " " + fmtMonth(f.resultsDate) : "") + ".");
  if (plan.historyPending) parts.push("Record history not collected yet; comparisons are vs first seen.");
  return parts.join(" ");
}

// Run-over-run diff (kept from v1 so the daily email can see what moved today)
function diff(prev, f) {
  var out = [];
  if (!prev) return out;
  if (prev.status && prev.status !== f.status) out.push("Status: " + statusLabel(prev.status) + " to " + statusLabel(f.status));
  if (prev.pcd && f.pcd && prev.pcd !== f.pcd) { var m = monthsBetween(prev.pcd, f.pcd); if (m != null && Math.abs(m) >= 1) out.push("Primary completion " + (m > 0 ? "pushed from " : "pulled in from ") + fmtMonth(prev.pcd) + " to " + fmtMonth(f.pcd) + " (" + (m > 0 ? "+" : "") + Math.round(m) + " mo)"); }
  if (prev.enroll != null && f.enroll != null && prev.enroll !== f.enroll) { var p = pct(f.enroll, prev.enroll); if (prev.enrollType === "ESTIMATED" && f.enrollType === "ACTUAL") out.push("Enrollment finalized at " + fmtNum(f.enroll) + " vs " + fmtNum(prev.enroll) + " target (" + p + "%)"); else out.push("Target enrollment " + (p < 0 ? "cut" : "raised") + " from " + fmtNum(prev.enroll) + " to " + fmtNum(f.enroll) + " (" + (p > 0 ? "+" : "") + p + "%)"); }
  else if (prev.enrollType === "ESTIMATED" && f.enrollType === "ACTUAL") out.push("Enrollment finalized at " + fmtNum(f.enroll));
  if (!prev.results && f.results) out.push("Results posted");
  if (prev.phase && f.phase && prev.phase !== f.phase) out.push("Phase: " + prev.phase + " to " + f.phase);
  if (prev.start && f.start && prev.start !== f.start) { var ms = monthsBetween(prev.start, f.start); if (ms != null && Math.abs(ms) >= 2) out.push("Start date moved from " + fmtMonth(prev.start) + " to " + fmtMonth(f.start)); }
  var po = prev.primaryOutcomes ? prev.primaryOutcomes.map(function (o) { return o.measure; }).join("|") : null, co = f.primaryOutcomes.map(function (o) { return o.measure; }).join("|");
  if (po && co && po !== co) out.push("Primary outcome wording changed");
  return out;
}

// ------------------------------------------------------------
//  MAIN
// ------------------------------------------------------------
async function main() {
  var now = new Date(), today = isoDate(now);
  console.log("=== Pipeline data build v2 " + now.toISOString() + " ===");
  console.log("Ticker map: " + T.TICKER_MAP.length + " groups (" + T.COVERAGE.length + " coverage)");
  fs.mkdirSync(TICKER_DIR, { recursive: true });

  var history = loadHistory();
  console.log("Record history loaded for " + Object.keys(history).length + " trials");

  var ongoing = await sweep("AREA[LeadSponsorClass]INDUSTRY", ONGOING, MAX_PAGES_ONGOING, "industry-led ongoing");
  var closedSince = isoDate(addMonths(now, -CLOSED_LOOKBACK_MONTHS));
  var closed = await sweep("AREA[LeadSponsorClass]INDUSTRY AND AREA[LastUpdatePostDate]RANGE[" + closedSince + ",MAX]", CLOSED, MAX_PAGES_CLOSED, "industry-led closed, updated since " + closedSince);
  var studies = ongoing.concat(closed);
  console.log("Total studies: " + studies.length);

  var byTicker = {}, candidates = {}, seen = {};
  for (var i = 0; i < studies.length; i++) {
    var f = extract(studies[i]);
    if (!f.nct || seen[f.nct]) continue;
    seen[f.nct] = true;
    var tk = T.matchNames([{ name: f.sponsor, role: "lead" }]);
    if (!tk) { var c = candidates[f.sponsor] || (candidates[f.sponsor] = { name: f.sponsor, total: 0, ongoing: 0, p3: 0 }); c.total++; if (isOngoing(f.status)) c.ongoing++; if (f.phases.indexOf("PHASE3") !== -1) c.p3++; continue; }
    if (tk.ticker === "PRIVATE") continue;
    f.ticker = tk.ticker; f.sector = tk.sector; f.coverage = tk.coverage; f.context = tk.context;
    f.areas = classifyArea(f); f.area = f.areas[0]; f.themes = matchThemes(f);
    (byTicker[tk.ticker] = byTicker[tk.ticker] || []).push(f);
  }
  var tickers = Object.keys(byTicker).sort();
  console.log("Mapped tickers with trials: " + tickers.length + " | candidate sponsors: " + Object.keys(candidates).length);

  var index = { generated: now.toISOString(), companies: [], readouts: [], terminations: [], deviations: [], candidates: [] };
  var histCovered = 0, totalMapped = 0;
  var sigCounts = {};

  for (var t = 0; t < tickers.length; t++) {
    var ticker = tickers[t], list = byTicker[ticker], prevMap = {};
    try { var prevFile = JSON.parse(fs.readFileSync(path.join(TICKER_DIR, ticker + ".json"), "utf8")); (prevFile.trials || []).forEach(function (r) { prevMap[r.nct] = r; }); } catch (e) { /* first run */ }
    var ongoingCount = list.filter(function (x) { return isOngoing(x.status); }).length;
    var records = [];
    var exec = { slipped: 0, slipMonths: 0, withPlan: 0, pulled: 0, endpointChanged: 0, enrollUnder: 0, enrollOver: 0, stopped: 0, overdue: 0 };

    for (var k = 0; k < list.length; k++) {
      var g = list[k], prev = prevMap[g.nct], hist = history[g.nct] || null;
      totalMapped++; if (hist) histCovered++;
      var imp = scoreImportance(g, ongoingCount, now);
      var pva = planVsActual(g, hist, prev, today, now);
      var rec = {
        nct: g.nct, title: g.title, status: g.status, statusLabel: statusLabel(g.status), why: g.why, stopReason: pva.plan.stopReason || null,
        phase: g.phase, phaseKey: g.phases.join("|"), type: g.type, allocation: g.allocation, masking: g.masking, purpose: g.purpose,
        area: g.area, areas: g.areas, themes: g.themes, conditions: g.conditions, interventions: g.interventions, intervTypes: g.intervTypes,
        enroll: g.enroll, enrollType: g.enrollType, start: g.start, pcd: g.pcd, pcdType: g.pcdType, completion: g.completion,
        firstPost: g.firstPost, lastUpdate: g.lastUpdate, results: g.results, resultsDate: g.resultsDate,
        sponsor: g.sponsor, collaborators: g.collaborators, primaryOutcomes: g.primaryOutcomes,
        importance: imp.score, reasons: imp.reasons,
        deviation: pva.score, signals: pva.signals, plan: pva.plan,
        tracked: prev && prev.tracked ? prev.tracked : { since: today, status: g.status, pcd: g.pcd, enroll: g.enroll, enrollType: g.enrollType, start: g.start },
        changes: prev && prev.changes ? prev.changes.slice() : [],
      };
      var d = diff(prev, g);
      for (var x = 0; x < d.length; x++) rec.changes.unshift({ date: today, text: d[x] });
      if (rec.changes.length > MAX_CHANGES_PER_TRIAL) rec.changes = rec.changes.slice(0, MAX_CHANGES_PER_TRIAL);
      rec.commentary = commentary(g, pva.plan);
      records.push(rec);

      // execution stats (ongoing + closed 12m, history-backed only)
      if (hist && pva.plan.origPcd) {
        exec.withPlan++;
        if (pva.plan.pcdSlipMonths >= 3) { exec.slipped++; exec.slipMonths += pva.plan.pcdSlipMonths; }
        if (pva.plan.pcdSlipMonths <= -3) exec.pulled++;
      }
      pva.signals.forEach(function (s) {
        sigCounts[s.kind] = (sigCounts[s.kind] || 0) + 1;
        if (s.kind === "endpoint" && s.severity === "high") exec.endpointChanged++;
        if (s.kind === "enroll_under") exec.enrollUnder++; if (s.kind === "enroll_over") exec.enrollOver++;
        if (s.kind === "stopped") exec.stopped++; if (s.kind === "results_overdue") exec.overdue++;
      });

      if (pva.signals.length && pva.score > 0) {
        index.deviations.push({ ticker: ticker, coverage: g.coverage, sector: g.sector, nct: g.nct, title: g.title, phase: g.phase, phaseKey: g.phases.join("|"), status: g.statusLabel || statusLabel(g.status), area: g.area,
          enroll: g.enroll, pcd: g.pcd, lastUpdate: g.lastUpdate, importance: imp.score, deviation: pva.score, historyPending: !hist, isNew: !prev,
          intervention: g.interventions[0] || "", conditions: g.conditions.slice(0, 2), signals: pva.signals, plan: { origPcd: pva.plan.origPcd, origEnroll: pva.plan.origEnroll, pcdSlipMonths: pva.plan.pcdSlipMonths, pcdMoves: pva.plan.pcdMoves, enrollDeltaPct: pva.plan.enrollDeltaPct, baseline: pva.plan.baseline },
          changedToday: rec.changes.length && rec.changes[0].date === today ? rec.changes.filter(function (c) { return c.date === today; }).map(function (c) { return c.text; }) : [] });
      }
    }
    records.sort(function (a, b) { return b.deviation - a.deviation || b.importance - a.importance || (a.pcd || "9999").localeCompare(b.pcd || "9999"); });

    var areas = {}; records.forEach(function (r) { if (isOngoing(r.status)) areas[r.area] = (areas[r.area] || 0) + 1; });
    var p3 = records.filter(function (r) { return isOngoing(r.status) && /PHASE3/.test(r.phaseKey); }).length;
    var next = records.filter(function (r) { return isOngoing(r.status) && r.pcd && r.pcd >= today.substring(0, 7); }).sort(function (a, b) { return a.pcd.localeCompare(b.pcd); })[0];
    var changedToday = records.filter(function (r) { return r.changes.length && r.changes[0].date === today; }).length;
    var histN = records.filter(function (r) { return !r.plan.historyPending; }).length;
    index.companies.push({
      ticker: ticker, sector: list[0].sector, coverage: list[0].coverage, name: list[0].sponsor, context: list[0].context,
      total: records.length, ongoing: ongoingCount, phase3: p3, terminated12m: records.filter(function (r) { return isStopped(r.status); }).length, changedToday: changedToday,
      topImportance: records.length ? Math.max.apply(null, records.map(function (r) { return r.importance; })) : 0,
      topDeviation: records.length ? records[0].deviation : 0, deviationCount: records.filter(function (r) { return r.deviation >= 30; }).length,
      nextReadout: next ? next.pcd : null, areas: areas, historyCoverage: records.length ? Math.round(histN / records.length * 100) : 0,
      exec: { withPlan: exec.withPlan, slippedPct: exec.withPlan ? Math.round(exec.slipped / exec.withPlan * 100) : null, avgSlipMonths: exec.slipped ? Math.round(exec.slipMonths / exec.slipped * 10) / 10 : null, pulled: exec.pulled, endpointChanged: exec.endpointChanged, enrollUnder: exec.enrollUnder, enrollOver: exec.enrollOver, stopped: exec.stopped, overdue: exec.overdue },
    });
    fs.writeFileSync(path.join(TICKER_DIR, ticker + ".json"), JSON.stringify({ ticker: ticker, generated: now.toISOString(), trials: records }));

    var horizon = isoDate(addDays(now, READOUT_WINDOW_DAYS)).substring(0, 7);
    records.forEach(function (r) {
      if (isOngoing(r.status) && r.pcd && r.pcd >= today.substring(0, 7) && r.pcd <= horizon && /PHASE3|PHASE2/.test(r.phaseKey)) index.readouts.push({ ticker: ticker, coverage: list[0].coverage, nct: r.nct, title: r.title, phase: r.phase, pcd: r.pcd, origPcd: r.plan.origPcd || null, slip: r.plan.pcdSlipMonths != null ? Math.round(r.plan.pcdSlipMonths) : null, status: r.statusLabel, enroll: r.enroll, area: r.area, importance: r.importance, intervention: r.interventions[0] || "" });
      if (isStopped(r.status) && r.lastUpdate && r.lastUpdate >= closedSince) index.terminations.push({ ticker: ticker, coverage: list[0].coverage, nct: r.nct, title: r.title, phase: r.phase, status: r.statusLabel, why: r.why, reason: r.stopReason, lastUpdate: r.lastUpdate, enroll: r.enroll, origEnroll: r.plan.origEnroll || null, area: r.area, importance: r.importance });
    });
  }

  index.readouts.sort(function (a, b) { return a.pcd.localeCompare(b.pcd) || b.importance - a.importance; });
  index.terminations.sort(function (a, b) { return b.lastUpdate.localeCompare(a.lastUpdate) || b.importance - a.importance; }); index.terminations = index.terminations.slice(0, 500);
  index.deviations.sort(function (a, b) { return (b.lastUpdate || "").localeCompare(a.lastUpdate || "") || b.deviation - a.deviation; }); index.deviations = index.deviations.slice(0, MAX_DEVIATIONS_IN_INDEX);
  index.companies.sort(function (a, b) { return (a.coverage ? 0 : 1) - (b.coverage ? 0 : 1) || b.ongoing - a.ongoing; });

  var candList = Object.keys(candidates).map(function (k) { return candidates[k]; }).sort(function (a, b) { return b.ongoing - a.ongoing || b.total - a.total || a.name.localeCompare(b.name); });
  index.candidates = candList.slice(0, 300);
  fs.writeFileSync(path.join(OUT_DIR, "candidates.csv"), ["Sponsor,Ongoing trials,Phase 3 trials,Total trials in scope"].concat(candList.map(function (c) { return [c.name, c.ongoing, c.p3, c.total].map(csvCell).join(","); })).join("\r\n"));

  index.stats = { studiesInScope: studies.length, mappedTrials: totalMapped, mappedCompanies: index.companies.length, candidateSponsors: candList.length, historyCovered: histCovered, historyCoveragePct: totalMapped ? Math.round(histCovered / totalMapped * 100) : 0, signalCounts: sigCounts };
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index));

  console.log("");
  console.log("Companies: " + index.stats.mappedCompanies + " | mapped trials: " + totalMapped + " | history coverage: " + index.stats.historyCoveragePct + "%");
  console.log("Signals: " + JSON.stringify(sigCounts));
  console.log("Deviations in index: " + index.deviations.length + " | readouts 90d: " + index.readouts.length + " | terminations 12m: " + index.terminations.length);
  console.log("Candidate sponsors (unmapped): " + candList.length);
  console.log("=== DONE ===");
}

if (require.main === module) main().catch(function (e) { console.error("FATAL:", e.message || e); process.exit(1); });
module.exports = { extract, classifyArea, scoreImportance, planVsActual, commentary, diff, classifyWhyStopped };
