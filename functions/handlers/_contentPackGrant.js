"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");
const {defineSecret} = require("firebase-functions/params");

const CONTENT_PACK_GRANT_SECRET = defineSecret("CONTENT_PACK_GRANT_SECRET");

function signature(encodedPayload) {
  return crypto.createHmac("sha256", CONTENT_PACK_GRANT_SECRET.value())
      .update(encodedPayload).digest("base64url");
}

/**
 * Create an opaque signed grant that can be carried by an offline attempt.
 * The raw subscription/access code is never stored on the device.
 *
 * @param {Object} payload Grant claims
 * @return {string} Signed grant
 */
function signOfflineGrant(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8")
      .toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

/**
 * @param {*} value Candidate grant
 * @return {Object|null} Verified claims
 */
function verifyOfflineGrant(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 2) return null;
  const expected = Buffer.from(signature(parts[0]), "utf8");
  const actual = Buffer.from(parts[1], "utf8");
  if (expected.length !== actual.length ||
      !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(
        Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    return payload && typeof payload === "object" ? payload : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  CONTENT_PACK_GRANT_SECRET,
  signOfflineGrant,
  verifyOfflineGrant,
};
