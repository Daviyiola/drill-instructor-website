"use strict";
/* eslint-disable require-jsdoc */

const {createHash} = require("node:crypto");
const {getDatabase} = require("firebase-admin/database");
const {allowCors} = require("./_auth");
const {
  AccountDeletionError,
  deleteAccountByUid,
} = require("./deleteAccountHttps");

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validToken(value) {
  return /^[A-Za-z0-9_-]{40,60}$/.test(value);
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({ok: false, error: "METHOD_NOT_ALLOWED"});
  }

  const token = String(req.body && req.body.token || "").trim();
  const confirmText = String(req.body && req.body.confirmText || "")
      .trim().toUpperCase();
  if (!validToken(token)) {
    return res.status(400).json({ok: false, error: "INVALID_OR_EXPIRED_LINK"});
  }
  if (confirmText !== "DELETE") {
    return res.status(400).json({ok: false, error: "CONFIRMATION_REQUIRED"});
  }

  const db = getDatabase();
  const hash = tokenHash(token);
  const requestRef = db.ref(`accountDeletionRequests/${hash}`);
  let request = null;
  const claim = await requestRef.transaction((current) => {
    if (!current || current.status !== "pending" ||
        Number(current.expiresAt || 0) <= Date.now()) return;
    request = current;
    return {...current, status: "processing", processingAt: Date.now()};
  });
  if (!claim.committed || !request || !request.uid) {
    return res.status(400).json({ok: false, error: "INVALID_OR_EXPIRED_LINK"});
  }

  const pointerRef = db.ref(`accountDeletionByUid/${request.uid}`);
  const activeHash = String((await pointerRef.once("value")).val() || "");
  if (activeHash !== hash) {
    await requestRef.remove();
    return res.status(400).json({ok: false, error: "INVALID_OR_EXPIRED_LINK"});
  }

  try {
    await deleteAccountByUid(request.uid);
    await db.ref().update({
      [`accountDeletionRequests/${hash}`]: null,
      [`accountDeletionByUid/${request.uid}`]: null,
    });
    return res.status(200).json({ok: true});
  } catch (error) {
    await requestRef.update({status: "pending", processingAt: null});
    if (error instanceof AccountDeletionError) {
      return res.status(error.status).json({ok: false, error: error.code});
    }
    console.error("ACCOUNT_DELETION_CONFIRM_FAILED", {
      message: error && error.message,
    });
    return res.status(500).json({ok: false, error: "UNABLE_TO_DELETE_ACCOUNT"});
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports.tokenHash = tokenHash;
module.exports.validToken = validToken;
