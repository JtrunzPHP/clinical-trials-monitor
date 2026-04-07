// send-report.js — Clinical Trials Daily Digest v2
// Single 7am ET email with watchlist tagging, phase flags, and multi-recipient support.
// Deduplicates via last-sent.json committed back to repo.

const fs = require("fs");
const path = require("path");

// ============================================================
//  CONFIGURATION — Edit freely
// ============================================================

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "Clinical Trials Monitor <onboarding@resend.dev>";

// Multiple recipients: set RECIPIENT_EMAILS as comma-separated in GitHub Secrets
// e.g. "jack@firm.com,analyst2@firm.com,pm@firm.com"
// Falls back to RECIPIENT_EMAIL (single) for backward compat
const RECIPIENT_EMAILS = (process.env.RECIPIENT_EMAILS || process.env.RECIPIENT_EMAIL || "")
  .split(",").map(function(e) { return e.trim(); }).filter(Boolean);

const DASHBOARD_URL = "https://jtrunzphp.github.io/clinical-trials-monitor/";

// ────────────────────────────────────────────────────────────
//  WATCHLIST — Map sponsor names to tickers
//  Matching is case-insensitive substring ("Dexcom" matches "Dexcom, Inc.")
//  Add/remove rows freely. Sector + context show up in the email.
// ────────────────────────────────────────────────────────────

const WATCHLIST = [
  // ── Med Devices ──
  { ticker: "DXCM", sponsors: ["Dexcom"],              sector: "Med Devices",   context: "CGM competitive positioning — Stelo OTC, G7/G8 pipeline" },
  { ticker: "PODD", sponsors: ["Insulet"],              sector: "Med Devices",   context: "Omnipod 5/6 automated insulin delivery expansion" },
  { ticker: "TNDM", sponsors: ["Tandem Diabetes"],      sector: "Med Devices",   context: "Mobi pump, Control-IQ algorithm, competitive vs PODD" },
  { ticker: "ABT",  sponsors: ["Abbott"],               sector: "Med Devices",   context: "Libre CGM franchise, structural heart (MitraClip/TriClip), diagnostics" },
  { ticker: "MDT",  sponsors: ["Medtronic"],            sector: "Med Devices",   context: "780G insulin pump, Hugo surgical robot, cardiac rhythm" },
  { ticker: "PRCT", sponsors: ["PROCEPT BioRobotics"],  sector: "Med Devices",   context: "Aquablation therapy for BPH — WATER/WATERJETS data" },
  { ticker: "CVRX", sponsors: ["CVRx"],                 sector: "Med Devices",   context: "Barostim neo — heart failure neuromodulation, CMS coverage" },
  { ticker: "BBNX", sponsors: ["BrainBox"],             sector: "Med Devices",   context: "AI-powered EEG for brain injury assessment" },

  // ── Healthcare Services ──
  { ticker: "OPCH", sponsors: ["Option Care", "BioScrip"],  sector: "HC Services",    context: "Home/alternate-site infusion, biosimilar transition tailwind" },
  { ticker: "PACS", sponsors: ["PACS Group"],                sector: "HC Services",    context: "Post-acute/skilled nursing volumes, DOJ overhang" },
  { ticker: "WAY",  sponsors: ["Waystar"],                   sector: "HC Services",    context: "Revenue cycle management, claims automation" },
  { ticker: "OPRX", sponsors: ["OptimizeRx"],                sector: "HC Services",    context: "Digital health messaging, pharma channel" },

  // ── Dental ──
  { ticker: "PARK", sponsors: ["Park Dental"],           sector: "Dental",        context: "DSO rollup, VIE structure, Medicaid dental expansion" },

  // ── Specialty Pharma / LTC ──
  { ticker: "GRDN", sponsors: ["Guardian Pharmacy"],     sector: "Specialty Pharma", context: "LTC pharmacy — IRA/MFP Part D reimbursement headwind" },

  // ── Managed Care (tag collaborations, not direct sponsorship) ──
  { ticker: "UNH",  sponsors: ["UnitedHealth", "Optum", "UnitedHealthcare"],  sector: "Managed Care", context: "Optum clinical programs, value-based care pilots" },
  { ticker: "ELV",  sponsors: ["Elevance", "Anthem", "Carelon"],              sector: "Managed Care", context: "Carelon services, Medicaid managed care" },
  { ticker: "CNC",  sponsors: ["Centene", "WellCare"],                        sector: "Managed Care", context: "Medicaid MCO, rate adequacy exposure" },
  { ticker: "MOH",  sponsors: ["Molina"],                                     sector: "Managed Care", context: "Medicaid/Medicare dual-eligible focus" },
  { ticker: "CVS",  sponsors: ["CVS Health", "Aetna", "CVS Caremark"],        sector: "Managed Care", context: "Aetna MCO + Caremark PBM + Oak Street primary care" },

  // ── GLP-1 / Obesity (downstream impact on devices & services coverage) ──
  { ticker: "LLY",  sponsors: ["Eli Lilly", "Lilly"],   sector: "GLP-1 / Obesity", context: "Tirzepatide (Mounjaro/Zepbound), orforglipron oral pivot" },
  { ticker: "NVO",  sponsors: ["Novo Nordisk"],          sector: "GLP-1 / Obesity", context: "Semaglutide (Ozempic/Wegovy), oral sema, amycretin" },

  // ── Imaging / Diagnostics ──
  { ticker: "WAT",  sponsors: ["Waters Corporation"],    sector: "Diagnostics",  context: "LC/MS platforms, Wyatt Technology acquisition" },

  // ── CDMO / Contract Manufacturing ──
  { ticker: "OXB",  sponsors: ["Oxford Biomedica"],      sector: "CDMO",         context: "Gene therapy CDMO — backlog-to-revenue conversion, CMD June 2026" },
];

// ────────────────────────────────────────────────────────────
//  STATUS FLAGS — which statuses are "high signal" for investors
// ────────────────────────────────────────────────────────────

const STATUS_FLAGS = {
  TERMINATED:             { emoji: "🔴", severity: "high",   label: "Terminated" },
  WITHDRAWN:              { emoji: "🔴", severity: "high",   label: "Withdrawn" },
  SUSPENDED:              { emoji: "🟡", severity: "high",   label: "Suspended" },
  COMPLETED:              { emoji: "🟢", severity: "medium", label: "Completed" },
  ACTIVE_NOT_RECRUITING:  { emoji: "🟢", severity: "low",    label: "Active, not recruiting" },
  ENROLLING_BY_INVITATION:{ emoji: "🔵", severity: "low",    label: "Enrolling by invitation" },
  RECRUITING:             { emoji: "🔵", severity: "low",    label: "Recruiting" },
  NOT_YET_RECRUITING:     { emoji: "⚪", severity: "low",    label: "Not yet recruiting" },
};

const CATEGORIES = [
  { key: "terminated", label: "Terminated / Withdrawn / Suspended", statuses: "TERMINATED,WITHDRAWN,SUSPENDED", color: "#ef4444", icon: "&#x26D4;", shortLabel: "Terminated" },
  { key: "progressed", label: "Progressed", statuses: "ACTIVE_NOT_RECRUITING,COMPLETED,ENROLLING_BY_INVITATION", color: "#22c55e", icon: "&#x1F680;", shortLabel: "Progressed" },
  { key: "released",   label: "Newly Posted", statuses: "NOT_YET_RECRUITING,RECRUITING", color: "#3b82f6", icon: "&#x1F195;", shortLabel: "New" },
];

// ============================================================
//  CONSTANTS
// ============================================================

const CT_API = "https://clinicaltrials.gov/api/v2/studies";
const SENT_FILE = path.join(__dirname, "last-sent.json");
const LOOKBACK_DAYS = 2;       // 2 calendar days — handles date-only granularity in LastUpdatePostDate
const DEDUP_EXPIRY_MS = 72 * 60 * 60 * 1000;  // 72h
const MAX_PAGES = 5;
const PAGE_SIZE = 100;

// ============================================================
//  WATCHLIST MATCHING
// ============================================================

function matchWatchlist(study) {
  var p = study.protocolSection || {};
  var sp = p.sponsorCollaboratorsModule || {};
  var lead = sp.leadSponsor ? (sp.leadSponsor.name || "") : "";
  var collabs = (sp.collaborators || []).map(function(c) { return c.name || ""; });
  var allNames = [lead].concat(collabs).join(" ").toLowerCase();

  for (var i = 0; i < WATCHLIST.length; i++) {
    var w = WATCHLIST[i];
    for (var j = 0; j < w.sponsors.length; j++) {
      if (allNames.indexOf(w.sponsors[j].toLowerCase()) !== -1) {
        return { ticker: w.ticker, sector: w.sector, context: w.context };
      }
    }
  }
  return null;
}

// ============================================================
//  DEDUPLICATION
// ============================================================

function loadSentData() {
  try {
    var raw = fs.readFileSync(SENT_FILE, "utf8");
    var data = JSON.parse(raw);
    var cutoff = Date.now() - DEDUP_EXPIRY_MS;
    if (data.timestamp && data.timestamp < cutoff) {
      console.log("  Sent data expired (>72h old), starting fresh");
      return { ids: {}, timestamp: 0 };
    }
    console.log("  Loaded " + Object.keys(data.ids || {}).length + " previously sent NCT IDs");
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
  var keys = Object.keys(merged);
  for (var i = 0; i < keys.length; i++) {
    if (merged[keys[i]] > cutoff) pruned[keys[i]] = merged[keys[i]];
  }
  fs.writeFileSync(SENT_FILE, JSON.stringify({ ids: pruned, timestamp: Date.now() }, null, 2));
  console.log("  Saved " + Object.keys(pruned).length + " NCT IDs to last-sent.json");
}

function getNctId(study) {
  try { return study.protocolSection.identificationModule.nctId; }
  catch (e) { return null; }
}

function dedup(studies, prev) {
  var fresh = [], dupes = 0;
  for (var i = 0; i < studies.length; i++) {
    var nct = getNctId(studies[i]);
    if (nct && prev[nct]) dupes++;
    else fresh.push(studies[i]);
  }
  return { fresh: fresh, dupeCount: dupes };
}

// ============================================================
//  API HELPERS
// ============================================================

function buildUrl(statuses, sinceDate, pageToken) {
  var term = "AREA[LastUpdatePostDate]RANGE[" + sinceDate + ",MAX]";
  var url = CT_API + "?format=json&pageSize=" + PAGE_SIZE + "&countTotal=true&sort=LastUpdatePostDate:desc"
    + "&query.term=" + encodeURIComponent(term);
  if (statuses) url += "&filter.overallStatus=" + encodeURIComponent(statuses);
  if (pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
  return url;
}

async function fetchStudies(statuses, sinceDate) {
  var all = [], token = null, total = 0;
  for (var pg = 0; pg < MAX_PAGES; pg++) {
    var url = buildUrl(statuses, sinceDate, token);
    if (pg === 0) console.log("    URL: " + url.substring(0, 140) + "...");
    var resp = await fetch(url);
    if (!resp.ok) {
      var body = await resp.text().catch(function() { return ""; });
      throw new Error("API " + resp.status + ": " + body.substring(0, 200));
    }
    var data = await resp.json();
    total = data.totalCount || 0;
    all = all.concat(data.studies || []);
    if (pg === 0) console.log("    total=" + total + " returned=" + (data.studies || []).length);
    token = data.nextPageToken;
    if (!token) break;
  }
  return { studies: all, totalCount: total };
}

async function fetchAll(sinceDate, prev) {
  var results = {}, allNewIds = {};
  for (var i = 0; i < CATEGORIES.length; i++) {
    var cat = CATEGORIES[i];
    console.log("  Fetching " + cat.label + "...");
    var raw = await fetchStudies(cat.statuses, sinceDate);
    var dd = dedup(raw.studies, prev);
    console.log("    API total: " + raw.totalCount + ", new: " + dd.fresh.length + ", dupes: " + dd.dupeCount);

    // Attach watchlist match to each study
    for (var j = 0; j < dd.fresh.length; j++) {
      dd.fresh[j]._wl = matchWatchlist(dd.fresh[j]);
    }

    results[cat.key] = { studies: dd.fresh, totalCount: dd.fresh.length };
    for (var k = 0; k < dd.fresh.length; k++) {
      var nct = getNctId(dd.fresh[k]);
      if (nct) allNewIds[nct] = Date.now();
    }
  }

  // Aggregate watchlist hits across all categories
  var wlHits = [];
  for (var ci = 0; ci < CATEGORIES.length; ci++) {
    var studies = results[CATEGORIES[ci].key].studies;
    for (var si = 0; si < studies.length; si++) {
      if (studies[si]._wl) {
        studies[si]._category = CATEGORIES[ci];
        wlHits.push(studies[si]);
      }
    }
  }
  // Sort watchlist hits: terminated first, then by ticker
  wlHits.sort(function(a, b) {
    var sa = (a._category.key === "terminated") ? 0 : 1;
    var sb = (b._category.key === "terminated") ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return (a._wl.ticker || "").localeCompare(b._wl.ticker || "");
  });

  var allNew = 0;
  for (var m = 0; m < CATEGORIES.length; m++) allNew += results[CATEGORIES[m].key].totalCount;
  results.allCount = allNew;
  results.newIds = allNewIds;
  results.watchlistHits = wlHits;
  return results;
}

// ============================================================
//  EMAIL HTML
// ============================================================

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(d) {
  if (!d) return "n/a";
  try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch (e) { return d; }
}

function extractFields(study) {
  var p = study.protocolSection || {};
  var id = p.identificationModule || {};
  var sm = p.statusModule || {};
  var dm = p.designModule || {};
  var sp = p.sponsorCollaboratorsModule || {};
  return {
    nct: id.nctId || "",
    title: id.briefTitle || "Untitled",
    status: (sm.overallStatus || "UNKNOWN"),
    statusLabel: (sm.overallStatus || "UNKNOWN").replace(/_/g, " "),
    updated: sm.lastUpdatePostDateStruct ? sm.lastUpdatePostDateStruct.date : null,
    start: sm.startDateStruct ? sm.startDateStruct.date : null,
    phases: (dm.phases || []).map(function(p) { return p.replace(/_/g, " "); }),
    enrollment: dm.enrollmentInfo ? dm.enrollmentInfo.count : null,
    sponsor: (sp.leadSponsor ? sp.leadSponsor.name : null) || "Unknown",
    whyStopped: sm.whyStopped || "",
    conditions: ((p.conditionsModule || {}).conditions || []).slice(0, 3),
  };
}

function statusColor(s) {
  var map = { TERMINATED: "#ef4444", WITHDRAWN: "#ef4444", SUSPENDED: "#f59e0b", COMPLETED: "#22c55e",
    ACTIVE_NOT_RECRUITING: "#22c55e", ENROLLING_BY_INVITATION: "#3b82f6", RECRUITING: "#3b82f6", NOT_YET_RECRUITING: "#8b5cf6" };
  return map[s] || "#6b7280";
}

// — Watchlist hit row (premium treatment) —
function wlRowHTML(study) {
  var f = extractFields(study);
  var wl = study._wl;
  var cat = study._category;
  var c = statusColor(f.status);
  var flag = STATUS_FLAGS[f.status] || { emoji: "⚪", label: f.statusLabel };
  var titleTrunc = f.title.length > 120 ? f.title.substring(0, 120) + "..." : f.title;

  var h = '<tr><td style="padding:14px 16px;border-bottom:1px solid #f3f4f6;">';
  // Ticker badge
  h += '<div style="margin-bottom:6px;">';
  h += '<span style="display:inline-block;padding:3px 10px;border-radius:6px;background:#1e1b4b;color:#a5b4fc;font-size:12px;font-weight:800;font-family:monospace;letter-spacing:0.5px;">' + esc(wl.ticker) + '</span>';
  h += ' <span style="font-size:11px;color:#9ca3af;">' + esc(wl.sector) + '</span>';
  h += '</div>';
  // NCT + status
  h += '<div style="border-left:3px solid ' + c + ';padding-left:12px;">';
  h += '<div style="margin-bottom:3px;">';
  h += '<a href="https://clinicaltrials.gov/study/' + esc(f.nct) + '" style="font-family:monospace;font-size:12px;color:' + c + ';font-weight:700;text-decoration:none;">' + esc(f.nct) + '</a>';
  h += ' <span style="font-size:10px;padding:2px 6px;border-radius:10px;background:' + c + '18;color:' + c + ';font-weight:600;">' + flag.emoji + ' ' + esc(f.statusLabel) + '</span>';
  // Phase badges
  for (var pi = 0; pi < f.phases.length; pi++) {
    h += ' <span style="font-size:10px;padding:2px 6px;border-radius:10px;background:#f3f4f6;color:#6b7280;font-weight:600;">' + esc(f.phases[pi]) + '</span>';
  }
  h += '</div>';
  // Title
  h += '<div style="font-size:14px;font-weight:600;color:#111827;margin:3px 0;line-height:1.35;">' + esc(titleTrunc) + '</div>';
  // Meta line
  h += '<div style="font-size:12px;color:#9ca3af;">';
  h += esc(f.sponsor);
  if (f.enrollment) h += ' &middot; ' + f.enrollment.toLocaleString() + ' enrolled';
  if (f.conditions.length > 0) h += ' &middot; ' + esc(f.conditions.join(", "));
  h += ' &middot; Updated ' + fmtDate(f.updated);
  h += '</div>';
  // Why stopped (high signal)
  if (f.whyStopped) {
    h += '<div style="font-size:12px;color:#ef4444;font-weight:600;margin-top:3px;">&#x26A0;&#xFE0F; Why stopped: ' + esc(f.whyStopped) + '</div>';
  }
  // Investment context
  h += '<div style="font-size:11px;color:#6366f1;margin-top:4px;font-style:italic;">' + esc(wl.context) + '</div>';
  h += '</div>';
  h += '</td></tr>';
  return h;
}

// — Standard trial row (category sections) —
function stdRowHTML(study, color) {
  var f = extractFields(study);
  var wl = study._wl;
  var titleTrunc = f.title.length > 100 ? f.title.substring(0, 100) + "..." : f.title;

  var h = '<tr><td style="padding:10px 16px;border-bottom:1px solid #f3f4f6;">';
  h += '<div style="border-left:3px solid ' + color + ';padding-left:12px;">';
  // Ticker tag if watchlisted
  if (wl) {
    h += '<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#eef2ff;color:#4f46e5;font-size:10px;font-weight:700;font-family:monospace;margin-right:4px;">' + esc(wl.ticker) + '</span>';
  }
  h += '<a href="https://clinicaltrials.gov/study/' + esc(f.nct) + '" style="font-family:monospace;font-size:12px;color:' + color + ';font-weight:700;text-decoration:none;">' + esc(f.nct) + '</a>';
  h += ' <span style="font-size:10px;padding:2px 6px;border-radius:10px;background:' + color + '15;color:' + color + ';font-weight:600;">' + esc(f.statusLabel) + '</span>';
  for (var pi = 0; pi < f.phases.length; pi++) {
    h += ' <span style="font-size:10px;color:#9ca3af;">' + esc(f.phases[pi]) + '</span>';
  }
  h += '<div style="font-size:13px;font-weight:600;color:#111827;margin:2px 0;line-height:1.3;">' + esc(titleTrunc) + '</div>';
  h += '<div style="font-size:11px;color:#9ca3af;">' + esc(f.sponsor);
  if (f.enrollment) h += ' &middot; ' + f.enrollment.toLocaleString() + ' enrolled';
  h += ' &middot; Updated ' + fmtDate(f.updated) + '</div>';
  if (f.whyStopped) {
    h += '<div style="font-size:11px;color:#ef4444;margin-top:2px;">Why stopped: ' + esc(f.whyStopped) + '</div>';
  }
  h += '</div></td></tr>';
  return h;
}

// — Category section —
function catSectionHTML(cat, data, maxShow) {
  if (data.totalCount === 0) return "";
  maxShow = maxShow || 15;
  var shown = data.studies.slice(0, maxShow);
  var remaining = data.totalCount - shown.length;

  var h = '<div style="margin-bottom:24px;">';
  h += '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">';
  h += '<tr><td style="padding:10px 16px;background:' + cat.color + '08;border-left:4px solid ' + cat.color + ';">';
  h += '<span style="font-size:15px;">' + cat.icon + '</span>';
  h += ' <span style="font-size:14px;font-weight:700;color:' + cat.color + ';">' + esc(cat.label) + '</span>';
  h += ' <span style="font-size:12px;color:#9ca3af;">(' + data.totalCount + ')</span>';
  h += '</td></tr>';
  for (var i = 0; i < shown.length; i++) h += stdRowHTML(shown[i], cat.color);
  if (remaining > 0) {
    h += '<tr><td style="padding:8px 16px;text-align:center;font-size:12px;color:#6b7280;">';
    h += '+ ' + remaining + ' more &mdash; <a href="' + DASHBOARD_URL + '" style="color:#4f46e5;text-decoration:none;font-weight:600;">view on dashboard</a>';
    h += '</td></tr>';
  }
  h += '</table></div>';
  return h;
}

// — Full email —
function buildEmailHTML(results) {
  var now = new Date();
  var dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  var wlCount = results.watchlistHits.length;

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>';
  html += '<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">';
  html += '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 0;"><tr><td align="center">';
  html += '<table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';

  // ── Header ──
  html += '<tr><td style="background:#1e1b4b;padding:24px 28px;">';
  html += '<div style="font-size:20px;font-weight:700;color:#ffffff;">&#x1F52C; Clinical Trials Daily Digest</div>';
  html += '<div style="font-size:13px;color:#a5b4fc;margin-top:4px;">' + esc(dateStr) + ' &mdash; 7:00 AM ET</div>';
  html += '</td></tr>';

  // ── Summary bar ──
  html += '<tr><td style="padding:20px 28px 8px;">';
  html += '<table width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate;"><tr>';
  // Total
  html += '<td style="text-align:center;padding:12px 8px;background:#f9fafb;border-radius:8px;width:20%;">';
  html += '<div style="font-size:22px;font-weight:700;color:#111827;">' + results.allCount + '</div>';
  html += '<div style="font-size:10px;color:#9ca3af;">Total</div></td>';
  // Watchlist
  html += '<td style="text-align:center;padding:12px 8px;background:' + (wlCount > 0 ? '#fef3c7' : '#f9fafb') + ';border-radius:8px;width:20%;">';
  html += '<div style="font-size:22px;font-weight:700;color:' + (wlCount > 0 ? '#d97706' : '#9ca3af') + ';">' + wlCount + '</div>';
  html += '<div style="font-size:10px;color:#9ca3af;">Watchlist</div></td>';
  // Categories
  for (var ci = 0; ci < CATEGORIES.length; ci++) {
    var c = CATEGORIES[ci];
    html += '<td style="text-align:center;padding:12px 8px;background:#f9fafb;border-radius:8px;width:20%;">';
    html += '<div style="font-size:22px;font-weight:700;color:' + c.color + ';">' + results[c.key].totalCount + '</div>';
    html += '<div style="font-size:10px;color:#9ca3af;">' + esc(c.shortLabel) + '</div></td>';
  }
  html += '</tr></table></td></tr>';

  // ── Watchlist Hits (top priority) ──
  if (wlCount > 0) {
    html += '<tr><td style="padding:20px 28px 8px;">';
    html += '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">';
    html += '<tr><td style="padding:10px 16px;background:#fef3c7;border-left:4px solid #d97706;border-radius:4px 4px 0 0;">';
    html += '<span style="font-size:15px;">&#x26A1;</span>';
    html += ' <span style="font-size:14px;font-weight:700;color:#92400e;">WATCHLIST HITS</span>';
    html += ' <span style="font-size:12px;color:#b45309;">(' + wlCount + ' trial' + (wlCount !== 1 ? 's' : '') + ' from your coverage universe)</span>';
    html += '</td></tr>';
    for (var wi = 0; wi < results.watchlistHits.length; wi++) {
      html += wlRowHTML(results.watchlistHits[wi]);
    }
    html += '</table></td></tr>';
  }

  // ── Category sections ──
  html += '<tr><td style="padding:16px 28px;">';
  var hasContent = false;
  for (var ki = 0; ki < CATEGORIES.length; ki++) {
    var cat = CATEGORIES[ki];
    if (results[cat.key].totalCount > 0) hasContent = true;
    // Show more terminated (high signal), fewer others
    var limit = cat.key === "terminated" ? 20 : 10;
    html += catSectionHTML(cat, results[cat.key], limit);
  }
  if (!hasContent && wlCount === 0) {
    html += '<div style="text-align:center;padding:32px;color:#9ca3af;font-size:14px;">No new changes in the last 48 hours. All quiet.</div>';
  }
  html += '</td></tr>';

  // ── Footer ──
  html += '<tr><td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;">';
  html += '<div style="text-align:center;"><a href="' + DASHBOARD_URL + '" style="display:inline-block;padding:10px 28px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Open Dashboard</a></div>';
  html += '<div style="text-align:center;margin-top:12px;font-size:11px;color:#9ca3af;">Source: ClinicalTrials.gov API v2 &middot; Lookback: ' + LOOKBACK_DAYS + ' calendar days w/ dedup &middot; GitHub Actions</div>';
  html += '<div style="text-align:center;margin-top:4px;font-size:10px;color:#d1d5db;">Watchlist: ' + WATCHLIST.length + ' companies tracked &middot; Edit in send-report.js</div>';
  html += '</td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

// ============================================================
//  SEND VIA RESEND
// ============================================================

async function sendEmail(subject, html) {
  if (RECIPIENT_EMAILS.length === 0) throw new Error("No recipients configured. Set RECIPIENT_EMAILS secret.");

  var resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: RECIPIENT_EMAILS,
      subject: subject,
      html: html,
    }),
  });
  if (!resp.ok) {
    var errText = await resp.text();
    throw new Error("Resend API " + resp.status + ": " + errText);
  }
  var data = await resp.json();
  console.log("Email sent! ID: " + data.id + " | Recipients: " + RECIPIENT_EMAILS.join(", "));
  return data;
}

// ============================================================
//  MAIN
// ============================================================

async function main() {
  console.log("=== Clinical Trials Daily Digest ===");
  console.log("Time: " + new Date().toISOString());
  console.log("Recipients: " + RECIPIENT_EMAILS.join(", "));
  console.log("Watchlist: " + WATCHLIST.length + " companies");
  console.log("");

  // Dedup
  console.log("Loading dedup data...");
  var sentData = loadSentData();
  var prev = sentData.ids || {};

  // Lookback window
  var now = new Date();
  var since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  var sinceStr = since.toISOString().split("T")[0];
  console.log("Since: " + sinceStr + " (" + LOOKBACK_DAYS + "-day lookback)");
  console.log("Previously sent: " + Object.keys(prev).length + " NCT IDs");
  console.log("");

  // Fetch
  console.log("Fetching from ClinicalTrials.gov...");
  var results = await fetchAll(sinceStr, prev);

  console.log("");
  console.log("=== RESULTS ===");
  console.log("  Total new changes: " + results.allCount);
  console.log("  Watchlist hits: " + results.watchlistHits.length);
  for (var i = 0; i < CATEGORIES.length; i++) {
    console.log("  " + CATEGORIES[i].label + ": " + results[CATEGORIES[i].key].totalCount);
  }
  if (results.watchlistHits.length > 0) {
    console.log("  --- Watchlist detail ---");
    for (var w = 0; w < results.watchlistHits.length; w++) {
      var wf = extractFields(results.watchlistHits[w]);
      console.log("  [" + results.watchlistHits[w]._wl.ticker + "] " + wf.nct + " | " + wf.statusLabel + " | " + wf.title.substring(0, 60));
    }
  }
  console.log("");

  // Build + send
  var wlCount = results.watchlistHits.length;
  var subject = "CT Daily | " + results.allCount + " changes";
  if (wlCount > 0) subject = "CT Daily | " + wlCount + " watchlist hit" + (wlCount !== 1 ? "s" : "") + " | " + results.allCount + " total";
  subject += " | " + now.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  console.log("Subject: " + subject);
  console.log("Sending...");
  var emailHTML = buildEmailHTML(results);
  await sendEmail(subject, emailHTML);

  // Save
  console.log("");
  console.log("Saving dedup data...");
  saveSentData(results.newIds);

  console.log("");
  console.log("=== DONE ===");
}

main().catch(function(err) {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
