"use strict";
/* eslint-disable require-jsdoc, max-len */

const {createHash} = require("node:crypto");
const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {allowCors} = require("./_auth");
const {emailShell, escapeHtml, sendResendEmail} = require("./_email");

const SIGN_IN_URL = "https://www.drillinstructorprep.com/app/sign-in";
const RESET_RATE_LIMIT_MS = 60 * 1000;

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function deliveryKey(email) {
  return createHash("sha256").update(email).digest("hex");
}

function firstName(user) {
  const name = String(user.displayName || "").trim();
  return name ? name.split(/\s+/)[0] : "there";
}

async function profileFirstName(db, user) {
  const fallback = firstName(user);
  const mappingSnap = await db.ref(`uidToCustom/${user.uid}`).once("value");
  const mapping = mappingSnap.val() || {};
  const role = mapping.educator ? "educator" : "student";
  const customId = mapping.educator || mapping.student || "";
  if (!customId) return fallback;
  const profilePath = role === "educator" ?
    `educators/${customId}` : `users/${customId}`;
  const profileSnap = await db.ref(profilePath).once("value");
  return String(profileSnap.child("firstName").val() || "").trim() || fallback;
}

async function reserveDelivery(db, email, now) {
  const ref = db.ref(`publicEmailDelivery/passwordReset/${deliveryKey(email)}`);
  const result = await ref.transaction((current) => {
    const lastSentAt = Number(current && current.lastSentAt || 0);
    if (lastSentAt > now - RESET_RATE_LIMIT_MS) return;
    return {lastSentAt: now};
  });
  return result.committed;
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "METHOD_NOT_ALLOWED"});
  }

  const email = normalizedEmail(req.body && req.body.email);
  if (!validEmail(email)) {
    return res.status(400).json({error: "VALID_EMAIL_REQUIRED"});
  }

  try {
    let user;
    try {
      user = await getAuth().getUserByEmail(email);
    } catch (error) {
      if (error && error.code === "auth/user-not-found") {
        return res.status(200).json({ok: true});
      }
      throw error;
    }

    const db = getDatabase();
    const now = Date.now();
    const reserved = await reserveDelivery(db, email, now);
    if (!reserved) return res.status(200).json({ok: true});

    const link = await getAuth().generatePasswordResetLink(email, {
      url: SIGN_IN_URL,
      handleCodeInApp: false,
    });
    const name = await profileFirstName(db, user);
    const body = [
      `<p>Hi ${escapeHtml(name)},</p>`,
      "<p>We received a request to reset your Drill Instructor password.</p>",
      "<p>Use the button below to choose a new password. If you did not request this, you can safely ignore this email and your password will remain unchanged.</p>",
    ].join("");

    await sendResendEmail({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.SUPPORT_FROM_EMAIL,
      to: email,
      subject: "Reset your Drill Instructor password",
      html: emailShell("Reset your password", body, {
        label: "RESET PASSWORD",
        url: link,
      }),
      text: [
        `Hi ${name},`,
        "",
        "We received a request to reset your Drill Instructor password.",
        "",
        `Choose a new password: ${link}`,
        "",
        "If you did not request this, you can safely ignore this email and your password will remain unchanged.",
        "",
        "Practice. Review. Improve.",
        "The Drill Instructor Team",
      ].join("\n"),
      idempotencyKey: `password-reset-${user.uid}-${Math.floor(now / RESET_RATE_LIMIT_MS)}`,
    });

    return res.status(200).json({ok: true});
  } catch (error) {
    console.error("PASSWORD_RESET_EMAIL_FAILED", {
      message: error && error.message,
    });
    return res.status(502).json({error: "UNABLE_TO_SEND_PASSWORD_RESET_EMAIL"});
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports.normalizedEmail = normalizedEmail;
module.exports.validEmail = validEmail;
