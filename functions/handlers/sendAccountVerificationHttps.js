"use strict";
/* eslint-disable require-jsdoc, max-len */

const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");

const {allowCors, requireBearerToken} = require("./_auth");
const {
  displayName,
  emailShell,
  escapeHtml,
  sendResendEmail,
} = require("./_email");

// Firebase validates the continue URL against:
// Authentication > Settings > Authorized domains.
//
// Production is served from the www host, so keep the generated
// verification link on that authorized origin.
const APP_URL = "https://www.drillinstructorprep.com/app/sign-in";

const VERIFICATION_RATE_LIMIT_MS = 60 * 1000;


/**
 * Masks an email address before returning it to the client.
 *
 * Example:
 * david@example.com -> da***@example.com
 *
 * @param {string} email
 * @return {string}
 */
function maskEmail(email) {
  const [name, domain] = String(email || "").split("@");

  if (!name || !domain) {
    return "your email";
  }

  const maskedName =
    `${name.slice(0, 2)}${"*".repeat(Math.max(2, name.length - 2))}`;

  return `${maskedName}@${domain}`;
}


/**
 * Builds the HTML body for a verification email.
 *
 * @param {Object} options
 * @param {string} options.name
 * @param {string} options.role
 * @param {boolean} options.welcome
 * @return {string}
 */
function buildHtmlBody({name, role, welcome}) {
  const safeName = escapeHtml(name);

  if (!welcome) {
    return [
      `<p>Hi ${safeName},</p>`,
      "<p>Use the button below to verify your Drill Instructor email address.</p>",
    ].join("");
  }

  if (role === "educator") {
    return [
      `<p>Hi ${safeName},</p>`,
      "<p>Welcome aboard.</p>",
      "<p>Your educator workspace helps you create focused drills, guide students, and understand performance across your classes.</p>",
      "<p>Before you can enter the educator workspace, please verify your email address. Your account will also need to be approved by your school.</p>",
      "<p>Once both steps are complete, you’ll be ready to start building drills and supporting your students.</p>",
    ].join("");
  }

  return [
    `<p>Hi ${safeName},</p>`,
    "<p>Welcome aboard.</p>",
    "<p>Drill Instructor is built to help you prepare with purpose, not simply answer more questions. Create focused drills, learn from explanations, identify where you need improvement, and watch your progress build over time.</p>",
    "<p>Your account is ready, so you can begin practicing now. Verify your email to protect your account and enable future changes to your profile information.</p>",
  ].join("");
}


/**
 * Builds the plain-text version of a verification email.
 *
 * @param {Object} options
 * @param {string} options.name
 * @param {string} options.role
 * @param {boolean} options.welcome
 * @param {string} options.link
 * @return {string}
 */
function buildPlainText({name, role, welcome, link}) {
  if (!welcome) {
    return [
      `Hi ${name},`,
      "",
      `Verify your Drill Instructor email: ${link}`,
      "",
      "The Drill Instructor Team",
    ].join("\n");
  }

  if (role === "educator") {
    return [
      `Hi ${name},`,
      "",
      "Welcome aboard.",
      "",
      "Your educator workspace helps you create focused drills, guide students, and understand performance across your classes.",
      "",
      "Before you can enter the educator workspace, please verify your email address. Your account will also need to be approved by your school.",
      "",
      "Once both steps are complete, you’ll be ready to start building drills and supporting your students.",
      "",
      `Verify your email: ${link}`,
      "",
      "Practice. Review. Improve.",
      "— The Drill Instructor Team",
    ].join("\n");
  }

  return [
    `Hi ${name},`,
    "",
    "Welcome aboard.",
    "",
    "Drill Instructor is built to help you prepare with purpose, not simply answer more questions. Create focused drills, learn from explanations, identify where you need improvement, and watch your progress build over time.",
    "",
    "Your account is ready, so you can begin practicing now. Verify your email to protect your account and enable future changes to your profile information.",
    "",
    `Verify your email: ${link}`,
    "",
    "Practice. Review. Improve.",
    "— The Drill Instructor Team",
  ].join("\n");
}


/**
 * Returns the email subject.
 *
 * @param {string} role
 * @param {boolean} welcome
 * @return {string}
 */
function getSubject(role, welcome) {
  if (!welcome) {
    return "Verify your Drill Instructor email";
  }

  return role === "educator" ?
    "Welcome to Drill Instructor — verify your email" :
    "Welcome to Drill Instructor — verify your email";
}


/**
 * Returns the heading displayed in the email shell.
 *
 * @param {string} role
 * @param {boolean} welcome
 * @return {string}
 */
function getHeading(role, welcome) {
  if (!welcome) {
    return "Verify your email";
  }

  return role === "educator" ?
    "Welcome aboard" :
    "Welcome to Drill Instructor";
}


/**
 * Sends a Drill Instructor account verification email.
 *
 * @param {Object} req
 * @param {Object} res
 * @return {Promise<*>}
 */
async function handler(req, res) {
  if (allowCors(req, res)) {
    return;
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "METHOD_NOT_ALLOWED",
      });
    }

    // Require a valid Firebase ID token.
    const decoded = await requireBearerToken(req);

    // Get the authoritative Firebase Auth record.
    const authUser = await getAuth().getUser(decoded.uid);

    // No need to send another email if already verified.
    if (authUser.emailVerified) {
      return res.status(200).json({
        ok: true,
        emailVerified: true,
        emailSent: false,
      });
    }

    if (!authUser.email) {
      return res.status(400).json({
        error: "ACCOUNT_EMAIL_REQUIRED",
      });
    }

    const db = getDatabase();

    // Load the user's Drill Instructor mapping and verification-email history.
    const [mapSnap, deliverySnap] = await Promise.all([
      db.ref(`uidToCustom/${decoded.uid}`).once("value"),
      db.ref(`emailDelivery/${decoded.uid}/verification`).once("value"),
    ]);

    const mapping = mapSnap.val() || {};
    const delivery = deliverySnap.val() || {};

    // Determine whether this account belongs to an educator or student.
    const role = mapping.educator ? "educator" : "student";
    const customId = mapping.educator || mapping.student || "";

    // Load the corresponding Drill Instructor profile.
    let profile = {};

    if (customId) {
      const profilePath =
        role === "educator" ?
          `educators/${customId}` :
          `users/${customId}`;

      const profileSnap = await db.ref(profilePath).once("value");
      profile = profileSnap.val() || {};
    }

    const now = Date.now();

    // Prevent repeated verification emails within 60 seconds.
    const lastSentAt = Number(delivery.lastSentAt || 0);

    if (lastSentAt > now - VERIFICATION_RATE_LIMIT_MS) {
      const elapsedMs = now - lastSentAt;
      const remainingMs =
        Math.max(0, VERIFICATION_RATE_LIMIT_MS - elapsedMs);

      const retryAfterSeconds =
        Math.max(1, Math.ceil(remainingMs / 1000));

      return res.status(429).json({
        error: "VERIFICATION_EMAIL_RATE_LIMITED",
        retryAfterSeconds,
      });
    }

    // Only send the welcome version once, and only when the request
    // originated from the signup flow.
    const reason = String(req.body && req.body.reason || "");

    const welcome =
      !delivery.welcomeSentAt &&
      reason === "signup";

    // Firebase remains responsible for securely generating and processing
    // the verification code. Resend is only responsible for delivery.
    const link = await getAuth().generateEmailVerificationLink(
        authUser.email,
        {
          url: APP_URL,
          handleCodeInApp: false,
        },
    );

    const name = displayName(profile);

    const body = buildHtmlBody({
      name,
      role,
      welcome,
    });

    const plainText = buildPlainText({
      name,
      role,
      welcome,
      link,
    });

    const subject = getSubject(role, welcome);
    const heading = getHeading(role, welcome);

    // Signup emails receive the branded closing line.
    const footer = welcome ?
      "Practice. Review. Improve.<br>— The Drill Instructor Team" :
      "";

    await sendResendEmail({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.SUPPORT_FROM_EMAIL,
      to: authUser.email,
      subject,

      html: emailShell(
          heading,
          body,
          {
            label: "VERIFY EMAIL",
            url: link,
          },
          footer,
      ),

      text: plainText,

      // The welcome email always uses the same idempotency key,
      // preventing accidental duplicate welcome emails.
      //
      // Normal verification emails are grouped by minute.
      idempotencyKey:
        `verification-${decoded.uid}-${welcome ? "welcome" : Math.floor(now / 60000)}`,
    });

    // Only record delivery after Resend succeeds.
    await db.ref(
        `emailDelivery/${decoded.uid}/verification`,
    ).update({
      lastSentAt: now,
      ...(welcome ? {welcomeSentAt: now} : {}),
    });

    return res.status(200).json({
      ok: true,
      emailVerified: false,
      emailSent: true,
      email: maskEmail(authUser.email),
    });
  } catch (error) {
    const status = Number(error && error.code);

    console.error(
        "ACCOUNT_VERIFICATION_EMAIL_FAILED",
        {
          message: error && error.message,
        },
    );

    if (status === 401) {
      return res.status(401).json({
        error: "AUTHENTICATION_REQUIRED",
      });
    }

    if (status === 403) {
      return res.status(403).json({
        error: "UNABLE_TO_SEND_VERIFICATION_EMAIL",
      });
    }

    return res.status(500).json({
      error: "UNABLE_TO_SEND_VERIFICATION_EMAIL",
    });
  }
}

module.exports = handler;
module.exports.handler = handler;
