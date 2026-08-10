"use strict";
/* eslint-disable require-jsdoc, max-len */

const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerToken} = require("./_auth");
const {displayName, emailShell, escapeHtml, sendResendEmail} = require("./_email");

// Firebase validates the continue URL against Authentication > Settings >
// Authorized domains. Production is served from the www host, so keep the
// generated verification link on that authorized origin.
const APP_URL = "https://www.drillinstructorprep.com/app/sign-in";

function maskEmail(email) {
  const [name, domain] = String(email || "").split("@");
  if (!name || !domain) return "your email";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return res.status(405).json({error: "METHOD_NOT_ALLOWED"});
    const decoded = await requireBearerToken(req);
    const authUser = await getAuth().getUser(decoded.uid);
    if (authUser.emailVerified) {
      return res.status(200).json({ok: true, emailVerified: true, emailSent: false});
    }
    if (!authUser.email) return res.status(400).json({error: "ACCOUNT_EMAIL_REQUIRED"});

    const db = getDatabase();
    const [mapSnap, deliverySnap] = await Promise.all([
      db.ref(`uidToCustom/${decoded.uid}`).once("value"),
      db.ref(`emailDelivery/${decoded.uid}/verification`).once("value"),
    ]);
    const mapping = mapSnap.val() || {};
    const role = mapping.educator ? "educator" : "student";
    const customId = mapping.educator || mapping.student || "";
    const profile = customId ? (await db.ref(`${role === "educator" ? "educators" : "users"}/${customId}`).once("value")).val() || {} : {};
    const delivery = deliverySnap.val() || {};
    const now = Date.now();
    if (Number(delivery.lastSentAt || 0) > now - 60000) {
      return res.status(429).json({error: "VERIFICATION_EMAIL_RATE_LIMITED", retryAfterSeconds: 60});
    }

    const welcome = !delivery.welcomeSentAt && String(req.body && req.body.reason || "") === "signup";
    const link = await getAuth().generateEmailVerificationLink(authUser.email, {
      url: APP_URL,
      handleCodeInApp: false,
    });
    const name = displayName(profile);
    const roleParagraph = role === "educator" ?
      "Your educator workspace helps you create drills, guide students, and understand performance. Once your email is verified and your school approves the account, you can enter the workspace." :
      "Choose a bootcamp, build focused practice drills, earn points, and climb the ranks. You can begin practicing now; verification is required before changing profile or unit details.";
    const body = welcome ?
      `<p>Hi ${escapeHtml(name)},</p><p>Welcome aboard. ${roleParagraph}</p><p>Verify this email address to secure your account.</p>` :
      `<p>Hi ${escapeHtml(name)},</p><p>Use the button below to verify your Drill Instructor email address.</p>`;
    await sendResendEmail({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.SUPPORT_FROM_EMAIL,
      to: authUser.email,
      subject: welcome ? "Welcome to Drill Instructor — verify your email" : "Verify your Drill Instructor email",
      html: emailShell(welcome ? "Welcome aboard" : "Verify your email", body, {label: "VERIFY EMAIL", url: link}),
      text: `Hi ${name},\n\nVerify your Drill Instructor email: ${link}\n\n— The Drill Instructor Team`,
      idempotencyKey: `verification-${decoded.uid}-${welcome ? "welcome" : Math.floor(now / 60000)}`,
    });
    await db.ref(`emailDelivery/${decoded.uid}/verification`).update({
      lastSentAt: now,
      ...(welcome ? {welcomeSentAt: now} : {}),
    });
    return res.status(200).json({ok: true, emailVerified: false, emailSent: true, email: maskEmail(authUser.email)});
  } catch (error) {
    const status = Number(error && error.code);
    console.error("ACCOUNT_VERIFICATION_EMAIL_FAILED", {message: error && error.message});
    return res.status(status === 401 ? 401 : status === 403 ? 403 : 500).json({error: status === 401 ? "AUTHENTICATION_REQUIRED" : "UNABLE_TO_SEND_VERIFICATION_EMAIL"});
  }
}

module.exports = handler;
module.exports.handler = handler;
