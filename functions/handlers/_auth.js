"use strict";

const {getAuth} = require("firebase-admin/auth");
const {getAppCheck} = require("firebase-admin/app-check");

const MAX_HTTP_BODY_BYTES = 1024 * 1024;

/**
 * Estimate the parsed request body and reject unexpectedly expensive inputs.
 * Endpoint-specific limits may be lower (progress autosave is 64 KiB).
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @param {number} maxBytes Maximum accepted serialized bytes
 * @return {boolean} Whether the request was rejected
 */
function rejectOversizedBody(req, res, maxBytes = MAX_HTTP_BODY_BYTES) {
  const declared = Number(req.headers["content-length"] || 0);
  let parsed = 0;
  try {
    parsed = Buffer.isBuffer(req.rawBody) ? req.rawBody.length :
      Buffer.byteLength(JSON.stringify(req.body || {}), "utf8");
  } catch (_) {
    parsed = maxBytes + 1;
  }
  if (declared <= maxBytes && parsed <= maxBytes) {
    return false;
  }
  res.status(413).json({error: "REQUEST_BODY_TOO_LARGE"});
  return true;
}

/**
 * Verify App Check when production enforcement is explicitly enabled.
 * Firebase's standard debug provider still produces a verifiable token, so
 * local/test clients need no insecure server-side bypass token.
 *
 * @param {Object} req Express request
 * @return {Promise<void>}
 */
async function requireAppCheck(req) {
  const mode = String(process.env.APP_CHECK_ENFORCEMENT || "disabled")
      .trim().toLowerCase();
  if (mode !== "required") return;
  const token = String(req.headers["x-firebase-appcheck"] || "");
  if (!token) {
    const error = new Error("Missing Firebase App Check token");
    error.code = 401;
    throw error;
  }
  try {
    await getAppCheck().verifyToken(token);
  } catch (_) {
    const error = new Error("Invalid Firebase App Check token");
    error.code = 401;
    throw error;
  }
}

/**
 * Verify the Authorization header contains a Firebase ID token
 * and return the decoded UID.
 *
 * @param {Object} req
 * @return {Promise<string>}
 * @throws {Error}
 */
async function requireBearerToken(req) {
  await requireAppCheck(req);
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    const err = new Error("Missing or invalid Authorization header");
    err.code = 401;
    throw err;
  }
  const idToken = header.slice("Bearer ".length);
  return getAuth().verifyIdToken(idToken);
}

/**
 * Verify the Authorization header and return its Firebase UID.
 *
 * @param {Object} req Express request
 * @return {Promise<string>} Firebase Auth uid
 */
function requireBearerUid(req) {
  return requireBearerToken(req).then((decoded) => decoded.uid);
}

/**
 * Verify the caller and require a currently verified Firebase email.
 * @param {Object} req Express request
 * @return {Promise<string>} Firebase Auth uid
 */
async function requireVerifiedBearerUid(req) {
  const decoded = await requireBearerToken(req);
  const user = await getAuth().getUser(decoded.uid);
  if (!user.emailVerified) {
    const err = new Error("EMAIL_VERIFICATION_REQUIRED");
    err.code = 403;
    throw err;
  }
  return decoded.uid;
}

/**
 * Apply permissive CORS headers to the response.
 * Handles preflight OPTIONS requests.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Object} options Optional request-boundary settings
 * @return {boolean}
 */
function allowCors(req, res, options = {}) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Firebase-AppCheck");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return rejectOversizedBody(
      req,
      res,
      Number(options.maxBodyBytes || MAX_HTTP_BODY_BYTES),
  );
}

module.exports = {
  requireBearerUid,
  requireBearerToken,
  requireVerifiedBearerUid,
  requireAppCheck,
  rejectOversizedBody,
  allowCors,
};
