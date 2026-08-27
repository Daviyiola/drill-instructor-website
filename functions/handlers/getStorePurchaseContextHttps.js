"use strict";
/* eslint-disable require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {resolveStudent} = require("./_studentDrill");
const {appAccountTokenForUid} = require("./_storeAccount");

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  try {
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const appAccountToken = appAccountTokenForUid(uid);
    await db.ref(`storeAccountTokens/apple/${appAccountToken}`).set({
      userId: studentId,
      updatedAt: new Date().toISOString(),
    });
    await db.ref(`storeAccountTokens/google/${appAccountToken}`).set({
      userId: studentId,
      updatedAt: new Date().toISOString(),
    });
    return res.status(200).json({
      ok: true,
      apple: {appAccountToken},
      google: {obfuscatedAccountId: appAccountToken},
    });
  } catch (error) {
    return res.status(401).json({error: "Authentication failed"});
  }
}

module.exports = {handler};
