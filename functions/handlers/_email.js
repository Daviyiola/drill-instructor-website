"use strict";
/* eslint-disable require-jsdoc, max-len */

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function emailShell(title, body, action, closing) {
  const button = action ? `<p style="margin:28px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#4B5320;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700">${escapeHtml(action.label)}</a></p>` : "";
  const footer = closing || "Practice. Review. Improve.<br>— The Drill Instructor Team";
  return `<!doctype html><html><body style="margin:0;background:#F6F8FB;font-family:Arial,sans-serif;color:#172033"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#4B5320;color:white;padding:18px 24px;border-radius:18px 18px 0 0;font-weight:700;letter-spacing:.04em">DRILL INSTRUCTOR</div><div style="background:white;padding:28px 24px;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 18px 18px"><h1 style="font-size:25px;margin:0 0 18px">${escapeHtml(title)}</h1>${body}${button}<p style="margin:28px 0 0;color:#667085;font-size:13px">${footer}</p></div></div></body></html>`;
}

async function sendResendEmail({apiKey, from, to, subject, html, text, idempotencyKey}) {
  if (!apiKey || !from || !to) throw new Error("EMAIL_CONFIGURATION_MISSING");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? {"Idempotency-Key": idempotencyKey} : {}),
    },
    body: JSON.stringify({from, to: [to], subject, html, text}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`RESEND_${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

function displayName(profile, fallback = "there") {
  return String(profile && profile.firstName || "").trim() || fallback;
}

async function sendSubscriptionSuccessEmail({db, apiKey, from, userId, bootcamp, planType, expirationDate, source, idempotencyKey}) {
  const profile = (await db.ref(`users/${userId}`).once("value")).val() || {};
  const email = String(profile.email || "").trim();
  if (!email) return false;
  const name = displayName(profile);
  const label = String(planType || "subscription").replace(/_/g, " ");
  const end = expirationDate ? new Date(expirationDate).toLocaleDateString("en-US", {year: "numeric", month: "long", day: "numeric", timeZone: "UTC"}) : "the end of your access period";
  await sendResendEmail({
    apiKey, from, to: email,
    subject: `${String(bootcamp || "").toUpperCase()} bootcamp access activated`,
    html: emailShell("Bootcamp access confirmed", `<p>Hi ${escapeHtml(name)},</p><p>Your ${escapeHtml(label)} access to the <strong>${escapeHtml(String(bootcamp || "").toUpperCase())}</strong> bootcamp is active through ${escapeHtml(end)}.</p><p>${source === "access_code" ? "Your access code was redeemed successfully." : "Your subscription payment was successful."} You can start training now.</p>`),
    text: `Hi ${name},\n\nYour ${label} ${String(bootcamp || "").toUpperCase()} bootcamp access is active through ${end}.\n\n— The Drill Instructor Team`,
    idempotencyKey,
  });
  return true;
}

module.exports = {displayName, emailShell, escapeHtml, sendResendEmail, sendSubscriptionSuccessEmail};
