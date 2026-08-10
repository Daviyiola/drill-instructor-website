"use strict";

const {createHash} = require("node:crypto");
const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerToken} = require("./_auth");

const MAX_MESSAGE_LENGTH = 4000;
const HOUR_MS = 60 * 60 * 1000;
const EMAIL_LIMIT_PER_HOUR = 5;
const IP_LIMIT_PER_HOUR = 10;

/**
 * Trim a short user-entered value for email composition.
 * @param {*} value Candidate value
 * @param {number} maxLength Maximum retained length
 * @return {string} Cleaned value
 */
function cleanText(value, maxLength) {
  return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
}

/**
 * Escape text for Resend's small HTML support message.
 * @param {*} value Candidate text
 * @return {string} Escaped HTML text
 */
function escapeHtml(value) {
  return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

/**
 * Resolve a verified identity when an optional bearer token is supplied.
 * @param {Object} req Express request
 * @return {Promise<Object|null>} Verified identity or null
 */
async function signedInIdentity(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  try {
    const token = await requireBearerToken(req);
    return {uid: token.uid, email: String(token.email || "")};
  } catch (_error) {
    return null;
  }
}

/**
 * Produce a non-reversible RTDB-safe identifier for a rate-limit subject.
 * @param {string} value Identifier to hash
 * @return {string} SHA-256 digest
 */
function hashIdentifier(value) {
  return createHash("sha256")
      .update(`drill-instructor-support:${String(value || "")}`)
      .digest("hex");
}

/**
 * Resolve the originating address without trusting it beyond rate limiting.
 * @param {Object} req Express request
 * @return {string} Best available address
 */
function requestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
  const socketAddress = req.socket && req.socket.remoteAddress;
  return forwarded || String(req.ip || socketAddress || "unknown");
}

/**
 * Enforce a rolling fixed-window limit without retaining raw identifiers.
 * Each identifier occupies one node whose old window is overwritten.
 * @param {Object} db Firebase Admin database
 * @param {string} kind Rate-limit category
 * @param {string} identifier Email, UID, or address
 * @param {number} limit Maximum submissions per hour
 * @param {number} [now] Current timestamp
 * @return {Promise<{allowed: boolean, retryAfterSeconds: number}>} Result
 */
async function enforceHourlyLimit(
    db, kind, identifier, limit, now = Date.now()) {
  const ref = db.ref(
      `rateLimits/support/${kind}/${hashIdentifier(identifier)}`,
  );
  let allowed = true;
  let retryAfterSeconds = 0;

  await ref.transaction((current) => {
    const row = current && typeof current === "object" ? current : {};
    const windowStartedAt = Number(row.windowStartedAt || 0);
    const withinWindow = now - windowStartedAt < HOUR_MS;
    const count = withinWindow ? Number(row.count || 0) : 0;

    if (withinWindow && count >= limit) {
      allowed = false;
      retryAfterSeconds = Math.max(
          1,
          Math.ceil((windowStartedAt + HOUR_MS - now) / 1000),
      );
      return;
    }

    return {
      windowStartedAt: withinWindow ? windowStartedAt : now,
      count: count + 1,
      updatedAt: now,
    };
  });

  return {allowed, retryAfterSeconds};
}

/**
 * Send one email through Resend.
 * @param {string} resendKey Resend API key
 * @param {Object} payload Resend email payload
 * @param {string} idempotencyKey Stable request key
 * @return {Promise<Response>} Fetch response
 */
function sendResendEmail(resendKey, payload, idempotencyKey) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Send a student or visitor support message using Resend.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<void>}
 */
async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ok: false, error: "Method not allowed"});
    return;
  }

  const body = req.body || {};
  const name = cleanText(body.name, 100);
  const message = cleanText(body.message, MAX_MESSAGE_LENGTH);
  const suppliedEmail = cleanText(body.email, 254).toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!name || !message || !emailPattern.test(suppliedEmail)) {
    res.status(400).json({
      ok: false,
      error: "Enter your name, email, and message.",
    });
    return;
  }

  const identity = await signedInIdentity(req);
  const email = identity && identity.email ? identity.email : suppliedEmail;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.SUPPORT_FROM_EMAIL;
  const to = process.env.SUPPORT_TO_EMAIL;
  if (!resendKey || !from || !to) {
    console.error("SUPPORT_EMAIL_NOT_CONFIGURED");
    res.status(503).json({
      ok: false,
      error: "Support messaging is not configured yet.",
    });
    return;
  }

  try {
    const db = getDatabase();
    const emailLimit = await enforceHourlyLimit(
        db,
        identity ? "account" : "email",
        identity ? identity.uid : email,
        EMAIL_LIMIT_PER_HOUR,
    );
    if (!emailLimit.allowed) {
      res.set("Retry-After", String(emailLimit.retryAfterSeconds));
      res.status(429).json({
        ok: false,
        error: "Too many messages. Please try again later.",
        retryAfterSeconds: emailLimit.retryAfterSeconds,
      });
      return;
    }

    if (!identity) {
      const ipLimit = await enforceHourlyLimit(
          db,
          "ip",
          requestIp(req),
          IP_LIMIT_PER_HOUR,
      );
      if (!ipLimit.allowed) {
        res.set("Retry-After", String(ipLimit.retryAfterSeconds));
        res.status(429).json({
          ok: false,
          error: "Too many messages. Please try again later.",
          retryAfterSeconds: ipLimit.retryAfterSeconds,
        });
        return;
      }
    }
  } catch (error) {
    console.error("SUPPORT_RATE_LIMIT_ERROR", error);
    res.status(503).json({
      ok: false,
      error: "Support messaging is temporarily unavailable.",
    });
    return;
  }

  try {
    const requestDigest = createHash("sha256")
        .update(`${email}\n${name}\n${message}`)
        .digest("hex")
        .slice(0, 40);
    const response = await sendResendEmail(resendKey, {
      from,
      to: [to],
      reply_to: email,
      subject: `Drill Instructor support: ${name}`,
      text: `From: ${name} <${email}>\n` +
        `Account: ${identity ? identity.uid : "visitor"}\n\n${message}`,
      html: `<p><strong>From:</strong> ${escapeHtml(name)} ` +
        `&lt;${escapeHtml(email)}&gt;</p>` +
        `<p><strong>Account:</strong> ` +
        `${escapeHtml(identity ? identity.uid : "visitor")}</p>` +
        `<p>${escapeHtml(message)}</p>`,
    }, `support-${requestDigest}`);
    if (!response.ok) {
      console.error(
          "RESEND_SUPPORT_FAILED", response.status, await response.text());
      res.status(502).json({
        ok: false,
        error: "Unable to send your message right now.",
      });
      return;
    }

    let receiptSent = false;
    try {
      const receipt = await sendResendEmail(resendKey, {
        from,
        to: [email],
        reply_to: to,
        subject: "We received your Drill Instructor message",
        text: `Hi ${name},\n\nWe received your message and will reply ` +
          `as soon as we can.\n\nYour message:\n${message}\n\n` +
          "Drill Instructor Support",
        html: `<p>Hi ${escapeHtml(name)},</p>` +
          "<p>We received your message and will reply as soon as we can.</p>" +
          "<p><strong>Your message:</strong></p>" +
          `<blockquote style="margin:0;padding:12px 16px;` +
          `border-left:4px solid #4B5320;background:#F6F8FB">` +
          `${escapeHtml(message)}</blockquote>` +
          "<p>Drill Instructor Support</p>",
      }, `support-receipt-${requestDigest}`);
      receiptSent = receipt.ok;
      if (!receipt.ok) {
        console.error(
            "RESEND_SUPPORT_RECEIPT_FAILED",
            receipt.status,
            await receipt.text(),
        );
      }
    } catch (error) {
      console.error("RESEND_SUPPORT_RECEIPT_ERROR", error);
    }

    res.status(200).json({ok: true, receiptSent});
  } catch (error) {
    console.error("RESEND_SUPPORT_ERROR", error);
    res.status(502).json({
      ok: false,
      error: "Unable to send your message right now.",
    });
  }
}

module.exports = {
  EMAIL_LIMIT_PER_HOUR,
  HOUR_MS,
  IP_LIMIT_PER_HOUR,
  enforceHourlyLimit,
  handler,
  hashIdentifier,
  requestIp,
};
