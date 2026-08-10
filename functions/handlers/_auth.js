"use strict";

const {getAuth} = require("firebase-admin/auth");

/**
 * Verify the Authorization header contains a Firebase ID token
 * and return the decoded UID.
 *
 * @param {Object} req
 * @return {Promise<string>}
 * @throws {Error}
 */
function requireBearerToken(req) {
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
 * @return {boolean}
 */
function allowCors(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

module.exports = {
  requireBearerUid,
  requireBearerToken,
  requireVerifiedBearerUid,
  allowCors,
};
