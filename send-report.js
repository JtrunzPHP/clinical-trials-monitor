// send-report.js
// Fetches clinical trial changes from the last 12 hours and emails a digest.
// Runs via GitHub Actions at 6am and 6pm ET.
//
// BEFORE DEPLOYING: Replace YOURUSERNAME below with your actual GitHub username.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || "you@example.com";
const FROM_EMAIL = process.env.FROM_EMAIL || "Clinical Trials Monitor <alerts@yourdomain.com>";

// *** CHANGE THIS to your actual GitHub Pages URL ***
const DASHBOARD_URL = "https://jtrunzphp.github.io/clinical-trials-monitor/";

const CT_API = "https://clinicaltrials.gov/api/v2/studies";

const CATEGORIES = [
  { key: "terminated", label: "Terminated / Withdrawn / Suspended", statuses: "TERMINATED,WITHDRAWN,SUSPENDED", color: "#ef4444", icon: "&#x26D4;" },
  { key: "progressed", label: "Progressed", statuses: "ACTIVE_NOT_RECRUITING,COMPLETED,ENROLLING_BY_INVITATION", color: "#22c55e", icon: "&#x1F680;" },
  { key: "released", label: "Newly Posted", statuses: "NOT_YET_RECRUITING,RECRUITING", color: "#3b82f6", icon: "&#x1F195;" },
];

// ============================================================
// Fetch helpers
// ============================================================

async function fetchStudies(statuses, sinceDate, maxPages) {
  maxPages = maxPages || 5;
  var all = [];
  var token = null;
  var totalCount = 0;

  for (var page = 0; page < maxPages; page++) {
    var params = new URLSearchParams({
      format: "json",
      pageSize: "100",
      countTotal: "true",
      "query.term": "AREA[LastUpdatePostDate]RANGE[" + sinceDate + ",MAX]",
      sort: "LastUpdatePostDate:desc",
    });
    if (statuses) params.set("filter.overallStatus", statuses);
    if (token) params.set("pageToken", token);

    var resp = await fetch(CT_API + "?" + params.toString());
    if (!resp.ok) throw new Error("API error: " + resp.status);
    var data = await resp.json();

    totalCount = data.totalCount || 0;
    all = all.concat(data.studies || []);
    token = data.nextPageToken;
    if (!token) break;
  }

  return { studies: all, totalCount: totalCount };
}

async function fetchAllCategories(sinceDate) {
  var results = {};

  for (var i = 0; i < CATEGORIES.length; i++) {
    var cat = CATEGORIES[i];
    console.log("  Fetching " + cat.label + "...");
    results[cat.key] = await fetchStudies(cat.statuses, sinceDate);
    console.log("    -> " + results[cat.key].totalCount + " studies");
  }

  // Total across all statuses
  var allParams = new URLSearchParams({
    format: "json",
    pageSize: "1",
    countTotal: "true",
    "query.term": "AREA[LastUpdatePostDate]RANGE[" + sinceDate + ",MAX]",
  });
  var allResp = await fetch(CT_API + "?" + allParams.toString());
  var allData = await allResp.json();
  results.allCount = allData.totalCount || 0;

  return results;
}

// ============================================================
// Email HTML builder
// ============================================================

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric"
    });
  } catch (e) { return d; }
}

function studyRowHTML(study, color) {
  var p = study.protocolSection || {};
  var id = p.identificationModule || {};
  var sm = p.statusModule || {};
  var dm = p.designModule || {};
  var sp = p.sponsorCollaboratorsModule || {};
  var nct = id.nctId || "";
  var title = (id.briefTitle || "Untitled");
  if (title.length > 100) title = title.substring(0, 100) + "...";
  var status = (sm.overallStatus || "UNKNOWN").replace(/_/g, " ");
  var updated = sm.lastUpdatePostDateStruct ? sm.lastUpdatePostDateStruct.date : null;
  var sponsor = (sp.leadSponsor ? sp.leadSponsor.name : null) || "Unknown";
  var phases = (dm.phases || []).join(", ").replace(/_/g, " ");
  var enrollment = dm.enrollmentInfo ? dm.enrollmentInfo.count : null;
  var whyStopped = sm.whyStopped || "";

  var html = '<tr><td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;">';
  html += '<div style="border-left:3px solid ' + color + ';padding-left:12px;">';
  html += '<a href="https://clinicaltrials.gov/study/' + esc(nct) + '" style="font-family:monospace;font-size:13px;color:' + color + ';font-weight:700;text-decoration:none;">' + esc(nct) + '</a>';
  html += ' <span style="font-size:10px;padding:2px 6px;border-radius:10px;background:' + color + '15;color:' + color + ';font-weight:600;">' + esc(status) + '</span>';
  if (phases) html += ' <span style="font-size:10px;color:#9ca3af;">' + esc(phases) + '</span>';
  html += '<div style="font-size:14px;font-weight:600;color:#111827;margin:4px 0 2px;line-height:1.35;">' + esc(title) + '</div>';
  html += '<div style="font-size:12px;color:#9ca3af;">';
  html += esc(sponsor);
  if (enrollment) html += ' &middot; ' + enrollment.toLocaleString() + ' enrolled';
  html += ' &middot; Updated ' + fmtDate(updated);
  html += '</div>';
  if (whyStopped) {
    html += '<div style="font-size:12px;color:#ef4444;margin-top:2px;">Why stopped: ' + esc(whyStopped) + '</div>';
  }
  html += '</div></td></tr>';
  return html;
}

function categorySectionHTML(cat, data) {
  if (data.totalCount === 0) return "";

  var shown = data.studies.slice(0, 15);
  var remaining = data.totalCount - shown.length;

  var html = '<div style="margin-bottom:28px;">';
  html += '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">';

  // Category header
  html += '<tr><td style="padding:10px 16px;background:' + cat.color + '08;border-left:4px solid ' + cat.color + ';">';
  html += '<span style="font-size:16px;">' + cat.icon + '</span>';
  html += ' <span style="font-size:15px;font-weight:700;color:' + cat.color + ';">' + esc(cat.label) + '</span>';
  html += ' <span style="font-size:13px;color:#9ca3af;">' + data.totalCount + (data.totalCount === 1 ? ' study' : ' studies') + '</span>';
  html += '</td></tr>';

  // Study rows
  for (var i = 0; i < shown.length; i++) {
    html += studyRowHTML(shown[i], cat.color);
  }

  // "More" link
  if (remaining > 0) {
    html += '<tr><td style="padding:10px 16px;text-align:center;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">';
    html += '+ ' + remaining + ' more &mdash; <a href="' + DASHBOARD_URL + '" style="color:#4f46e5;text-decoration:none;font-weight:600;">view all on dashboard</a>';
    html += '</td></tr>';
  }

  html += '</table></div>';
  return html;
}

function buildFullEmailHTML(results, windowLabel, sinceISO, untilISO) {
  var catSections = "";
  var hasContent = false;
  for (var i = 0; i < CATEGORIES.length; i++) {
    var cat = CATEGORIES[i];
    if (results[cat.key].totalCount > 0) hasContent = true;
    catSections += categorySectionHTML(cat, results[cat.key]);
  }

  var sinceDisplay = fmtDate(sinceISO);
  var untilDisplay = fmtDate(untilISO);

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>';
  html += '<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">';
  html += '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:20px 0;"><tr><td align="center">';
  html += '<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">';

  // Header
  html += '<tr><td style="background:#1e1b4b;padding:24px 28px;">';
  html += '<div style="font-size:20px;font-weight:700;color:#ffffff;">&#x1F52C; Clinical Trials Monitor</div>';
  html += '<div style="font-size:13px;color:#a5b4fc;margin-top:4px;">' + esc(windowLabel) + '</div>';
  html += '</td></tr>';

  // Summary bar
  html += '<tr><td style="padding:20px 28px 8px;">';
  html += '<table width="100%" cellpadding="0" cellspacing="8" style="border-collapse:separate;">';
  html += '<tr>';
  html += '<td style="text-align:center;padding:12px;background:#f9fafb;border-radius:8px;width:25%;">';
  html += '<div style="font-size:22px;font-weight:700;color:#6366f1;">' + results.allCount + '</div>';
  html += '<div style="font-size:11px;color:#9ca3af;">All Changes</div></td>';
  for (var j = 0; j < CATEGORIES.length; j++) {
    var c = CATEGORIES[j];
    html += '<td style="text-align:center;padding:12px;background:#f9fafb;border-radius:8px;width:25%;">';
    html += '<div style="font-size:22px;font-weight:700;color:' + c.color + ';">' + results[c.key].totalCount + '</div>';
    html += '<div style="font-size:11px;color:#9ca3af;">' + esc(c.label.split(" /")[0]) + '</div></td>';
  }
  html += '</tr></table></td></tr>';

  // Period
  html += '<tr><td style="padding:16px 28px 4px;">';
  html += '<div style="font-size:12px;color:#9ca3af;">Covering: <b>' + sinceDisplay + '</b> &rarr; <b>' + untilDisplay + '</b></div>';
  html += '</td></tr>';

  // Category sections
  html += '<tr><td style="padding:16px 28px;">';
  if (hasContent) {
    html += catSections;
  } else {
    html += '<div style="text-align:center;padding:32px;color:#9ca3af;font-size:14px;">No changes detected in this window. All quiet.</div>';
  }
  html += '</td></tr>';

  // Footer
  html += '<tr><td style="padding:16px 28px 24px;border-top:1px solid #f3f4f6;">';
  html += '<div style="text-align:center;">';
  html += '<a href="' + DASHBOARD_URL + '" style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Open Dashboard</a>';
  html += '</div>';
  html += '<div style="text-align:center;margin-top:12px;font-size:11px;color:#9ca3af;">';
  html += 'Source: ClinicalTrials.gov API v2 &middot; Automated via GitHub Actions';
  html += '</div></td></tr>';

  html += '</table></td></tr></table></body></html>';
  return html;
}

// ============================================================
// Send via Resend
// ============================================================

async function sendEmail(subject, html) {
  var resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [RECIPIENT_EMAIL],
      subject: subject,
      html: html,
    }),
  });

  if (!resp.ok) {
    var errText = await resp.text();
    throw new Error("Resend API error " + resp.status + ": " + errText);
  }

  var data = await resp.json();
  console.log("Email sent successfully! ID: " + data.id);
  return data;
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("=== Clinical Trials Email Report ===");
  console.log("Time: " + new Date().toISOString());

  var now = new Date();
  var hour = now.getUTCHours();

  // Look back 12 hours
  var since = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  var sinceStr = since.toISOString().split("T")[0];

  // Determine AM or PM window (rough UTC check)
  var isAM = hour < 16;
  var windowLabel = isAM
    ? "Overnight Digest (6 PM - 6 AM ET)"
    : "Daytime Digest (6 AM - 6 PM ET)";

  console.log("Window: " + windowLabel);
  console.log("Since: " + sinceStr);
  console.log("");

  // Fetch all data
  console.log("Fetching data from ClinicalTrials.gov...");
  var results = await fetchAllCategories(sinceStr);

  console.log("");
  console.log("Summary:");
  console.log("  Total changes: " + results.allCount);
  for (var i = 0; i < CATEGORIES.length; i++) {
    console.log("  " + CATEGORIES[i].label + ": " + results[CATEGORIES[i].key].totalCount);
  }
  console.log("");

  // Build email
  var totalChanges = results.allCount;
  var subject = "Clinical Trials " + windowLabel + " - " + totalChanges + " change" + (totalChanges !== 1 ? "s" : "") + " detected";
  var emailHTML = buildFullEmailHTML(results, windowLabel, since.toISOString(), now.toISOString());

  // Send
  console.log("Sending email to " + RECIPIENT_EMAIL + "...");
  await sendEmail(subject, emailHTML);
  console.log("");
  console.log("Done!");
}

main().catch(function(err) {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
