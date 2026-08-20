"use strict";
/* eslint-disable require-jsdoc, max-len */

const {createHash, randomBytes} = require("node:crypto");
const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {allowCors} = require("./_auth");
const {emailShell, escapeHtml, sendResendEmail} = require("./_email");

const CONFIRM_URL = "https://drillinstructorprep.com/account-deletion/confirm";
const TOKEN_TTL_MS = 30 * 60 * 1000;
const DELIVERY_LIMIT_MS = 5 * 60 * 1000;

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function reserveDelivery(db, emailHash, now) {
  const ref = db.ref(`publicEmailDelivery/accountDeletion/${emailHash}`);
  const result = await ref.transaction((current) => {
    const lastSentAt = Number(current && current.lastSentAt || 0);
    if (lastSentAt > now - DELIVERY_LIMIT_MS) return;
    return {lastSentAt: now};
  });
  return result.committed;
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ok: false, error: "METHOD_NOT_ALLOWED"});
  }

  const email = normalizedEmail(req.body && req.body.email);
  if (!validEmail(email)) {
    return res.status(400).json({ok: false, error: "VALID_EMAIL_REQUIRED"});
  }

  // Always return the same response for known and unknown addresses so this
  // public endpoint cannot be used to enumerate Drill Instructor accounts.
  const accepted = () => res.status(200).json({ok: true});
  try {
    let user;
    try {
      user = await getAuth().getUserByEmail(email);
    } catch (error) {
      if (error && error.code === "auth/user-not-found") return accepted();
      throw error;
    }

    const db = getDatabase();
    const now = Date.now();
    const emailHash = sha256(email);
    if (!await reserveDelivery(db, emailHash, now)) return accepted();

    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256(token);
    const pointerRef = db.ref(`accountDeletionByUid/${user.uid}`);
    const previousTokenHash = String((await pointerRef.once("value")).val() || "");
    const updates = {
      [`accountDeletionRequests/${tokenHash}`]: {
        uid: user.uid,
        emailHash,
        createdAt: now,
        expiresAt: now + TOKEN_TTL_MS,
        status: "pending",
      },
      [`accountDeletionByUid/${user.uid}`]: tokenHash,
    };
    if (/^[a-f0-9]{64}$/.test(previousTokenHash)) {
      updates[`accountDeletionRequests/${previousTokenHash}`] = null;
    }
    await db.ref().update(updates);

    const link = `${CONFIRM_URL}?token=${encodeURIComponent(token)}`;
    const name = String(user.displayName || "").trim().split(/\s+/)[0] || "there";
    await sendResendEmail({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.SUPPORT_FROM_EMAIL,
      to: email,
      subject: "Confirm your Drill Instructor account deletion",
      html: emailShell("Confirm account deletion", [
        `<p>Hi ${escapeHtml(name)},</p>`,
        "<p>We received a request to permanently delete your Drill Instructor account and associated personal data.</p>",
        "<p>This confirmation link expires in 30 minutes. If you did not make this request, ignore this email and your account will remain unchanged.</p>",
      ].join(""), {label: "REVIEW DELETION REQUEST", url: link}),
      text: [
        `Hi ${name},`,
        "",
        "We received a request to permanently delete your Drill Instructor account and associated personal data.",
        "",
        `Review and confirm the request: ${link}`,
        "",
        "This link expires in 30 minutes. If you did not make this request, ignore this email.",
        "",
        "The Drill Instructor Team",
      ].join("\n"),
      idempotencyKey: `account-deletion-${user.uid}-${Math.floor(now / DELIVERY_LIMIT_MS)}`,
    });
    return accepted();
  } catch (error) {
    console.error("ACCOUNT_DELETION_REQUEST_FAILED", {
      message: error && error.message,
    });
    // Preserve the non-enumerating response contract even when delivery fails.
    return accepted();
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports.normalizedEmail = normalizedEmail;
module.exports.validEmail = validEmail;
module.exports.sha256 = sha256;
