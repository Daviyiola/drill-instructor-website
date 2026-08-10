// @ts-check
"use strict";

const crypto = require("crypto");
const {defineSecret} = require("firebase-functions/params");

/** Secret used to validate license signatures (HMAC). */
const LICENSE_SALT = defineSecret("LICENSE_SALT");

/**
 * Small HTTP-style error that carries a numeric status code.
 */
class HttpError extends Error {
  /**
   * @param {string} message - Error message.
   * @param {number} code - HTTP-ish status code (e.g., 403, 409).
   */
  constructor(message, code) {
    super(message);
    this.name = "HttpError";
    this.code = code;
  }
}

/** @typedef {import('firebase-admin').database.Database} Database */

/**
 * Public shape of a stored license record.
 * @typedef {Object} LicenseRecord
 * @property {string} planType - Plan name or SKU.
 * @property {string} bootcamp - Bootcamp identifier the license covers.
 * @property {string} activationDate - ISO-8601 activation timestamp.
 * @property {string} expirationDate - ISO-8601 expiration timestamp.
 * @property {string} licenseHash - Hex HMAC-SHA256 of the license payload.
 */

/**
 * Constant-time comparison for two hex strings.
 * @param {string} a - First hex string.
 * @param {string} b - Second hex string.
 * @return {boolean} True when equal.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  // If either is not valid hex, Buffer length will mismatch or throw.
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Assert that a user has an active, valid license for the bootcamp.
 * Reads from path: users/{customId}/testdata/{bootcampId}/license
 *
 * Throws:
 *  - HttpError 403 when license is mismatched, or signature fails.
 *  - HttpError 403 when license is missing, incomplete.
 *  - HttpError 409 when license is expired.
 *  - HttpError 400 when date values are not valid ISO-8601 strings.
 *
 * @param {Database} db - Realtime Database instance.
 * @param {string} customId - Your app user ID (not Firebase auth UID).
 * @param {string} bootcampId - Bootcamp identifier to check against.
 * @return {Promise<LicenseRecord>} Resolves with the license record when valid.
 * @throws {HttpError} Thrown when the license is not valid.
 */
async function assertLicenseActive(db, customId, bootcampId) {
  if (!db) throw new HttpError("Missing database instance", 500);
  if (!customId) throw new HttpError("Missing customId", 400);
  if (!bootcampId) throw new HttpError("Missing bootcampId", 400);

  const ref = db.ref(`users/${customId}/testdata/${bootcampId}/license`);
  const snap = await ref.once("value");
  /** @type {LicenseRecord | null} */
  const lic = snap.val();

  if (!lic) {
    throw new HttpError("License not found", 403);
  }

  const {planType, bootcamp, activationDate, expirationDate, licenseHash} = lic;

  if (!planType || !bootcamp ||
    !activationDate || !expirationDate || !licenseHash) {
    throw new HttpError("License incomplete", 403);
  }

  // License must match the requested bootcamp exactly.
  if (bootcamp !== bootcampId) {
    throw new HttpError("License bootcamp mismatch", 403);
  }

  // Validate ISO dates
  const actMs = Date.parse(activationDate);
  const expMs = Date.parse(expirationDate);
  if (!Number.isFinite(actMs) || !Number.isFinite(expMs)) {
    throw new HttpError("License dates must be ISO-8601", 400);
  }

  // Expiry check
  if (expMs <= Date.now()) {
    throw new HttpError("License expired", 409);
  }

  // Recompute HMAC and compare
  const payload = `${planType}|${bootcamp}|`+
  `${activationDate}|${expirationDate}|${customId}`;
  const expected = crypto.createHmac("sha256",
      LICENSE_SALT.value()).update(payload).digest("hex");

  if (!timingSafeEqual(expected, licenseHash)) {
    throw new HttpError("License signature mismatch", 403);
  }

  return lic;
}

module.exports = {assertLicenseActive, LICENSE_SALT, HttpError};
