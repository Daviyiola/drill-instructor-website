"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");

const APP_ACCOUNT_NAMESPACE = Buffer.from(
    "6f8b45e9445b4f68a8e9a4f6ea3d1a1d", "hex",
);

function appAccountTokenForUid(uid) {
  const bytes = crypto.createHash("sha1")
      .update(APP_ACCOUNT_NAMESPACE)
      .update(String(uid || ""))
      .digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-` +
    `${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = {appAccountTokenForUid};
