// send-report.js - Clinical Trials Daily Digest v5 (deviations from plan)
//
// v5 no longer lists newly posted or progressed studies. It reads data/pipeline/index.json
// (built each morning by build-pipeline.js from CT.gov plus the record history collected by
// collect-history.js) and emails only trials whose record has moved away from the sponsor's
// original plan and was updated in the lookback window:
//   push-outs and pull-forwards vs the original primary completion date
//   enrollment vs original target (cuts, raises, delivered vs plan)
//   primary endpoint changed after the study started
//   terminations, suspensions and withdrawals with the reason classified
//   results overdue vs primary completion (Mondays only, so it does not repeat daily)
// Each row shows original vs current, the delta, the date the public could see it, and a one-line read.
//
// A separate CT ALERT email still goes out for Phase 2/3 or coverage-ticker stops not already alerted.
// Dedup: last-sent.json keyed on NCT + CT.gov last-update date. Alert log: study-state.json.
//
// Secrets: RESEND_API_KEY, RECIPIENT_EMAILS, FROM_EMAIL (optional). Env: ALERT_ONLY=true, DRY_RUN=true.

"use strict";

const fs = require("fs");
const path = require("path");
const T = require("./tickers.js");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "Clinical Trials Monitor <onboarding@resend.dev>";
const RECIPIENT_EMAILS = (process.env.RECIPIENT_EMAILS || process.env.RECIPIENT_EMAIL || "").split(",").map(function (e) { return e.trim(); }).filter(Boolean);
const ALERT_ONLY = String(process.env.ALERT_ONLY || "").toLowerCase() === "true";
const DRY_RUN = String(process.env.DRY_RUN || "").toLowerCase() === "true";

const PIPELINE_URL = "https://jtrunzphp.github.io/clinical-trials-monitor/pipeline.html";
const INDEX_FILE = path.join(__dirname, "data", "pipeline", "index.json");
const SENT_FILE = path.join(__dirname, "last-sent.json");
const STATE_FILE = path.join(__dirname, "study-state.json");

const LOOKBACK_DAYS = 2;
const DEDUP_EXPIRY_MS = 72 * 60 * 60 * 1000;
const MIN_DEVIATION = 15;          // ignore trivial deviations
const MAX_ROWS_PER_SECTION = 30;
const OVERDUE_DAY = 1;             // Monday (UTC) for the weekly results-overdue section

// ---------------- helpers ----------------
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function pad2(n) { return (n < 10 ? "0" : "") + n; }
function isoDate(d) { return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
function fmtMonth(s) { if (!s) return "n/a"; var m = /^(\d{4})-(\d{2})/.exec(s); if (!m) return s; return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1] + " " + m[1]; }
function fmtNum(n) { return n == null ? "n/a" : Number(n).toLocaleString("en-US"); }
function csvCell(v) { var s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function statusColor(label) { return ({ "Terminated": "#ef4444", "Withdrawn": "#ef4444", "Suspended": "#f59e0b", "Completed": "#22c55e", "Active, not recruiting": "#22c55e", "Enrolling by invitation": "#3b82f6", "Recruiting": "#3b82f6", "Not yet recruiting": "#8b5cf6" })[label] || "#6b7280"; }
function sevColor(s) { return s === "high" ? "#b91c1c" : s === "medium" ? "#b45309" : s === "info" ? "#047857" : "#6b7280"; }
function sevBg(s) { return s === "high" ? "#fee2e2" : s === "medium" ? "#fef3c7" : s === "info" ? "#ecfdf5" : "#f3f4f6"; }
const KIND_LABEL = { pcd_slip: "Push-out", pcd_pull: "Pull-forward", start_slip: "Late start", not_started: "Not started", enroll_over: "Over-enrolled", enroll_under: "Under-enrolled", enroll_final: "Enrollment final", target_up: "Target raised", target_cut: "Target cut", endpoint: "Endpoint changed", results_overdue: "Results overdue", stopped: "Stopped" };

function loadJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; } }
function loadSent() { var d = loadJson(SENT_FILE, { ids: {}, timestamp: 0 }); if (d.timestamp && d.timestamp < Date.now() - DEDUP_EXPIRY_MS) return { ids: {}, timestamp: 0 }; return d; }
function saveSent(prev, newIds) {
  var merged = Object.assign({}, prev.ids || {}, newIds), cutoff = Date.now() - DEDUP_EXPIRY_MS, kept = {};
  Object.keys(merged).forEach(function (k) { if (merged[k] > cutoff) kept[k] = merged[k]; });
  fs.writeFileSync(SENT_FILE, JSON.stringify({ ids: kept, timestamp: Date.now() }, null, 2));
}
function loadState() { var s = loadJson(STATE_FILE, {}); if (!s.alerted) s.alerted = {}; if (!s.studies) s.studies = {}; return s; }
function saveState(s) { var cutoff = Date.now() - 30 * 86400000, a = {}; Object.keys(s.alerted).forEach(function (k) { if (s.alerted[k] > cutoff) a[k] = s.alerted[k]; }); s.alerted = a; fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1)); }
function key(d) { return d.nct + "|" + (d.lastUpdate || ""); }

// ---------------- selection ----------------
function selectItems(index, sinceStr, prevSent, isMonday) {
  var items = (index.deviations || []).filter(function (d) {
    if (d.deviation < MIN_DEVIATION) return false;
    var sigs = (d.signals || []).filter(function (s) { return s.severity !== "info"; });
    if (!sigs.length) return false;
    var recent = d.lastUpdate && d.lastUpdate >= sinceStr && !prevSent[key(d)];
    var onlyOverdue = sigs.every(function (s) { return s.kind === "results_overdue"; });
    if (onlyOverdue) return isMonday;                 // weekly section, independent of update date
    if (!recent) return false;
    // Only surface a trial when the relevant field actually moved in the latest build (or the trial
    // is new to us). The row then shows the cumulative gap vs the original plan. This stops a slip
    // from 2024 reappearing every time the sponsor touches the record.
    var moved = function (re) { return d.isNew || (d.changedToday || []).some(function (t) { return re.test(t); }); };
    var kinds = sigs.map(function (s) { return s.kind; });
    if (kinds.indexOf("stopped") !== -1) return moved(/^Status:/);
    if (kinds.indexOf("endpoint") !== -1 && sigs.some(function (s) { return s.kind === "endpoint" && s.severity === "high" && (s.date || "") >= sinceStr; })) return true;
    if (kinds.some(function (k) { return k === "pcd_slip" || k === "pcd_pull"; }) && moved(/^Primary completion/)) return true;
    if (kinds.some(function (k) { return /enroll|target/.test(k); }) && moved(/enrollment|Enrollment/)) return true;
    if (kinds.indexOf("start_slip") !== -1 && moved(/^Start date/)) return true;
    if (kinds.indexOf("not_started") !== -1 && d.isNew) return true;
    return moved(/Primary outcome wording/) && kinds.indexOf("endpoint") !== -1;
  });
  var sections = { stopped: [], timeline: [], enrollment: [], protocol: [], overdue: [] };
  items.forEach(function (d) {
    var kinds = d.signals.map(function (s) { return s.kind; });
    if (kinds.indexOf("stopped") !== -1) sections.stopped.push(d);
    else if (kinds.indexOf("endpoint") !== -1 && d.signals.some(function (s) { return s.kind === "endpoint" && s.severity === "high"; })) sections.protocol.push(d);
    else if (kinds.some(function (k) { return k === "pcd_slip" || k === "pcd_pull" || k === "start_slip" || k === "not_started"; })) sections.timeline.push(d);
    else if (kinds.some(function (k) { return /enroll|target/.test(k); })) sections.enrollment.push(d);
    else if (kinds.indexOf("results_overdue") !== -1) sections.overdue.push(d);
  });
  Object.keys(sections).forEach(function (k) { sections[k].sort(function (a, b) { return b.deviation - a.deviation || b.importance - a.importance; }); });
  return { items: items, sections: sections };
}
function isUrgent(d) {
  if (!d.signals.some(function (s) { return s.kind === "stopped"; })) return false;
  return d.coverage || /PHASE3|PHASE2/.test(d.phaseKey);
}

// ---------------- email ----------------
function tickerBadge(d) { var cov = d.coverage; return '<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:' + (cov ? '#1e1b4b' : '#e5e7eb') + ';color:' + (cov ? '#a5b4fc' : '#374151') + ';font-size:11px;font-weight:800;font-family:monospace;">' + esc(d.ticker) + '</span>'; }
function pill(text, color, bg) { return '<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:' + (bg || color + '18') + ';color:' + color + ';font-weight:600;white-space:nowrap;">' + esc(text) + '</span>'; }
function row(d) {
  var c = statusColor(d.status);
  var h = '<tr><td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;">';
  h += '<div style="margin-bottom:4px;">' + tickerBadge(d) + ' <span style="font-size:11px;color:#9ca3af;">' + esc(d.sector || "") + ' &middot; ' + esc(d.area || "") + '</span><span style="float:right;font-size:11px;color:#9ca3af;">dev ' + d.deviation + ' &middot; imp ' + d.importance + '</span></div>';
  h += '<div style="border-left:3px solid ' + c + ';padding-left:12px;">';
  h += '<div><a href="https://clinicaltrials.gov/study/' + esc(d.nct) + '" style="font-family:monospace;font-size:12px;color:' + c + ';font-weight:700;text-decoration:none;">' + esc(d.nct) + '</a> ' + pill(d.status, c) + (d.phase ? ' ' + pill(d.phase, "#6b7280", "#f3f4f6") : '') + '</div>';
  h += '<div style="font-size:14px;font-weight:600;color:#111827;margin:3px 0;line-height:1.35;">' + esc(d.title.length > 130 ? d.title.substring(0, 130) + "..." : d.title) + '</div>';
  h += '<div style="font-size:12px;color:#9ca3af;">' + esc(d.intervention || "") + (d.conditions && d.conditions.length ? ' &middot; ' + esc(d.conditions.join(", ")) : '') + (d.enroll != null ? ' &middot; ' + fmtNum(d.enroll) + ' pts' : '') + (d.pcd ? ' &middot; PCD ' + esc(fmtMonth(d.pcd)) : '') + ' &middot; posted ' + esc(d.lastUpdate || "") + (d.historyPending ? ' &middot; <i>vs first seen, history pending</i>' : '') + '</div>';
  (d.signals || []).filter(function (s) { return s.severity !== "info"; }).forEach(function (s) {
    h += '<div style="margin-top:6px;padding:6px 8px;border-radius:6px;background:' + sevBg(s.severity) + ';">' + pill(KIND_LABEL[s.kind] || s.kind, sevColor(s.severity), "#ffffffaa") + ' <span style="font-size:12px;font-weight:600;color:#111827;">' + esc(s.text) + '</span><div style="font-size:11px;color:#4b5563;margin-top:2px;">' + esc(s.read) + '</div>' + (s.detail ? '<div style="font-size:11px;color:#6b7280;margin-top:3px;">Original: ' + esc(s.detail.original) + '<br>Current: ' + esc(s.detail.current) + '</div>' : '') + '</div>';
  });
  if (d.changedToday && d.changedToday.length) h += '<div style="font-size:11px;color:#6b7280;margin-top:4px;">Moved in this build: ' + esc(d.changedToday.join("; ")) + '</div>';
  h += '</div></td></tr>';
  return h;
}
function section(icon, title, sub, color, bg, list) {
  if (!list.length) return "";
  var h = '<tr><td style="padding:14px 28px 4px;"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">';
  h += '<tr><td style="padding:10px 16px;background:' + bg + ';border-left:4px solid ' + color + ';"><span style="font-size:15px;">' + icon + '</span> <span style="font-size:14px;font-weight:700;color:' + color + ';">' + esc(title) + '</span> <span style="font-size:12px;color:#6b7280;">' + esc(sub) + '</span></td></tr>';
  list.slice(0, MAX_ROWS_PER_SECTION).forEach(function (d) { h += row(d); });
  if (list.length > MAX_ROWS_PER_SECTION) h += '<tr><td style="padding:8px 16px;text-align:center;font-size:12px;color:#6b7280;">+ ' + (list.length - MAX_ROWS_PER_SECTION) + ' more in the attached CSV and on the site</td></tr>';
  return h + '</table></td></tr>';
}
function box(n, label, color, bg) { return '<td style="text-align:center;padding:10px 6px;background:' + (bg || "#f9fafb") + ';border-radius:8px;"><div style="font-size:20px;font-weight:700;color:' + color + ';">' + n + '</div><div style="font-size:10px;color:#9ca3af;">' + esc(label) + '</div></td>'; }

function buildDigest(sel, index, now, isMonday) {
  var S = sel.sections;
  var dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">';
  html += '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 0;"><tr><td align="center"><table width="660" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';
  html += '<tr><td style="background:#1e1b4b;padding:22px 28px;"><div style="font-size:20px;font-weight:700;color:#ffffff;">&#x1F52C; Clinical Trials: Deviations from Plan</div><div style="font-size:13px;color:#a5b4fc;margin-top:4px;">' + esc(dateStr) + ' &middot; public-company trials whose record moved away from the original registration in the last ' + LOOKBACK_DAYS + ' days</div></td></tr>';
  html += '<tr><td style="padding:18px 28px 6px;"><table width="100%" cellpadding="0" cellspacing="5" style="border-collapse:separate;"><tr>';
  html += box(S.stopped.length, "Stopped", "#b91c1c", S.stopped.length ? "#fee2e2" : null) + box(S.timeline.length, "Timeline vs plan", "#b45309", S.timeline.length ? "#fef3c7" : null) + box(S.enrollment.length, "Enrollment vs plan", "#0f766e") + box(S.protocol.length, "Endpoint changed", "#7c3aed") + box(isMonday ? S.overdue.length : "wk", "Results overdue", "#6b7280");
  html += '</tr></table><div style="font-size:11px;color:#9ca3af;margin-top:4px;">Comparisons use the record as first registered on CT.gov. History collected for ' + (index.stats ? index.stats.historyCoveragePct : "?") + '% of mapped trials; rows marked "history pending" compare against the first day we saw the trial instead. Rows are ranked by deviation score (number and severity of deviations, scaled for Phase 3).</div></td></tr>';
  html += section("&#x26D4;", "STOPPED", "(terminated, suspended, withdrawn; reason classified)", "#b91c1c", "#fee2e2", S.stopped);
  html += section("&#x23F3;", "TIMELINE VS PLAN", "(primary completion pushed out or pulled forward vs original)", "#b45309", "#fef3c7", S.timeline);
  html += section("&#x1F465;", "ENROLLMENT VS PLAN", "(targets cut or raised, delivered vs original target)", "#0f766e", "#ecfdf5", S.enrollment);
  html += section("&#x1F4DD;", "PRIMARY ENDPOINT CHANGED", "(after the study started)", "#7c3aed", "#f5f3ff", S.protocol);
  if (isMonday) html += section("&#x1F4EC;", "RESULTS OVERDUE (weekly)", "(Phase 2/3, 12+ months past primary completion, nothing posted)", "#6b7280", "#f3f4f6", S.overdue);
  if (!sel.items.length) html += '<tr><td style="text-align:center;padding:32px;color:#9ca3af;font-size:14px;">No deviations from plan posted in the last ' + LOOKBACK_DAYS + ' days.</td></tr>';
  html += '<tr><td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;"><div style="text-align:center;"><a href="' + PIPELINE_URL + '#deviations" style="display:inline-block;padding:10px 28px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">All deviations on the site</a></div>';
  html += '<div style="text-align:center;margin-top:12px;font-size:11px;color:#9ca3af;">Source: ClinicalTrials.gov API v2 plus record history &middot; built ' + esc((index.generated || "").substring(0, 16).replace("T", " ")) + ' UTC &middot; full list attached as CSV</div></td></tr>';
  return html + '</table></td></tr></table></body></html>';
}
function buildAlert(items, now) {
  var dateStr = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="padding:20px 0;"><tr><td align="center"><table width="660" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;">';
  html += '<tr><td style="background:#7f1d1d;padding:20px 28px;"><div style="font-size:19px;font-weight:700;color:#fff;">&#x1F6A8; Clinical Trials Alert</div><div style="font-size:13px;color:#fecaca;margin-top:4px;">' + esc(dateStr) + ' ET &middot; ' + items.length + ' urgent stop' + (items.length === 1 ? '' : 's') + '</div></td></tr>';
  html += '<tr><td style="padding:8px 28px 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">';
  items.forEach(function (d) { html += row(d); });
  html += '</table></td></tr><tr><td style="padding:12px 28px 20px;border-top:1px solid #f3f4f6;text-align:center;font-size:11px;color:#9ca3af;">Criteria: Phase 2/3 or coverage-ticker study moved to Terminated, Suspended or Withdrawn.</td></tr></table></td></tr></table></body></html>';
  return html;
}
function buildCSV(items) {
  var header = ["Ticker", "Tier", "Sector", "NCT", "Status", "Phase", "Area", "Title", "Intervention", "Posted", "Deviation score", "Importance", "Original PCD", "Current PCD", "PCD slip months", "PCD moves", "Original enrollment", "Current enrollment", "Enrollment delta %", "Signals", "Reads", "History", "Link"];
  var lines = [header.join(",")];
  items.forEach(function (d) {
    var p = d.plan || {};
    lines.push([d.ticker, d.coverage ? "Coverage" : "Public", d.sector, d.nct, d.status, d.phase, d.area, d.title, d.intervention, d.lastUpdate, d.deviation, d.importance, p.origPcd || "", d.pcd || "", p.pcdSlipMonths == null ? "" : p.pcdSlipMonths, p.pcdMoves == null ? "" : p.pcdMoves, p.origEnroll == null ? "" : p.origEnroll, d.enroll == null ? "" : d.enroll, p.enrollDeltaPct == null ? "" : p.enrollDeltaPct, d.signals.map(function (s) { return s.text; }).join(" | "), d.signals.map(function (s) { return s.read; }).join(" | "), d.historyPending ? "pending" : "collected", "https://clinicaltrials.gov/study/" + d.nct].map(csvCell).join(","));
  });
  return lines.join("\r\n");
}

// ---------------- send ----------------
async function sendEmail(subject, html, attachments) {
  if (DRY_RUN) { var out = path.join(__dirname, "dry-run-" + subject.replace(/[^a-z0-9]+/gi, "-").substring(0, 60) + ".html"); fs.writeFileSync(out, html); console.log("DRY RUN: wrote " + out); return { id: "dry-run" }; }
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set.");
  if (!RECIPIENT_EMAILS.length) throw new Error("No recipients configured. Set RECIPIENT_EMAILS secret.");
  var body = { from: FROM_EMAIL, to: RECIPIENT_EMAILS, subject: subject, html: html };
  if (attachments && attachments.length) body.attachments = attachments;
  var resp = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error("Resend API " + resp.status + ": " + await resp.text());
  var data = await resp.json();
  console.log("Email sent! ID: " + data.id + " | Recipients: " + RECIPIENT_EMAILS.join(", "));
  return data;
}

// ---------------- main ----------------
async function main() {
  var now = new Date(), today = isoDate(now);
  var isMonday = now.getUTCDay() === OVERDUE_DAY;
  console.log("=== Clinical Trials Digest v5 (deviations)" + (ALERT_ONLY ? " ALERT ONLY" : "") + (DRY_RUN ? " DRY RUN" : "") + " ===");
  console.log("Time: " + now.toISOString() + " | Recipients: " + RECIPIENT_EMAILS.join(", ") + " | ticker map: " + T.TICKER_MAP.length);

  var index = loadJson(INDEX_FILE, null);
  if (!index || !index.deviations) throw new Error("data/pipeline/index.json not found or has no deviations list. Run the Build Pipeline Site Data workflow first.");
  var built = (index.generated || "").substring(0, 10);
  console.log("Site data built " + index.generated + " | deviations in index: " + index.deviations.length + " | history coverage " + (index.stats ? index.stats.historyCoveragePct : "?") + "%");
  if (built && built < isoDate(new Date(now.getTime() - 2 * 86400000))) console.log("WARNING: site data is more than two days old; check the build workflow.");

  var sinceStr = isoDate(new Date(now.getTime() - LOOKBACK_DAYS * 86400000));
  var prevSent = loadSent();
  var state = loadState();
  var sel = selectItems(index, sinceStr, prevSent.ids || {}, isMonday);
  console.log("Selected: " + sel.items.length + " | stopped " + sel.sections.stopped.length + ", timeline " + sel.sections.timeline.length + ", enrollment " + sel.sections.enrollment.length + ", endpoint " + sel.sections.protocol.length + ", overdue " + (isMonday ? sel.sections.overdue.length : "(not Monday)"));

  var urgent = (index.deviations || []).filter(function (d) { return isUrgent(d) && d.lastUpdate && d.lastUpdate >= sinceStr && (d.isNew || (d.changedToday || []).some(function (t) { return /^Status:/.test(t); })) && !state.alerted[key(d)]; }).sort(function (a, b) { return b.deviation - a.deviation; });
  if (urgent.length) {
    console.log("Sending alert for " + urgent.length + " urgent stop(s)...");
    await sendEmail("CT ALERT | " + urgent.length + " urgent stop" + (urgent.length === 1 ? "" : "s") + " | " + now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }), buildAlert(urgent, now));
    urgent.forEach(function (d) { state.alerted[key(d)] = Date.now(); });
    saveState(state);
  } else console.log("No new urgent stops.");
  if (ALERT_ONLY) { console.log("=== DONE ==="); return; }

  var S = sel.sections;
  var subject = "CT Deviations | " + S.stopped.length + " stopped | " + S.timeline.length + " timeline | " + S.enrollment.length + " enrollment | " + S.protocol.length + " endpoint | " + now.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  console.log("Subject: " + subject);
  sel.items.slice(0, 15).forEach(function (d) { console.log("  (" + d.deviation + ") [" + d.ticker + "] " + d.nct + " " + d.status + " | " + d.signals.filter(function (s) { return s.severity !== "info"; }).map(function (s) { return s.text; }).join("; ").substring(0, 160)); });
  var csv = buildCSV(sel.items);
  await sendEmail(subject, buildDigest(sel, index, now, isMonday), [{ filename: "ct-deviations-" + today + ".csv", content: Buffer.from(csv, "utf8").toString("base64") }]);
  if (DRY_RUN) fs.writeFileSync(path.join(__dirname, "dry-run-" + today + ".csv"), csv);

  var newIds = {};
  sel.items.forEach(function (d) { newIds[key(d)] = Date.now(); });
  saveSent(prevSent, newIds);
  console.log("Saved " + Object.keys(newIds).length + " dedup keys. === DONE ===");
}

if (require.main === module) main().catch(function (e) { console.error("FATAL:", e.message || e); process.exit(1); });
module.exports = { selectItems, buildDigest, buildCSV, isUrgent };
