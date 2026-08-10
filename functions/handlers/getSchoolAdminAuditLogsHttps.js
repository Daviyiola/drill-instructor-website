"use strict";
/* eslint-disable require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {bad, cleanStr, errText, normalizeUidToEducator} =
  require("./_schoolAdminAccess");

function sanitizeLog(id, row) {
  const value = row && typeof row === "object" ? row : {};
  return {
    id,
    actorEducatorId: cleanStr(value.actorEducatorId, 120),
    targetEducatorId: cleanStr(value.targetEducatorId, 120),
    action: cleanStr(value.action, 80),
    createdAt: cleanStr(value.createdAt, 40),
    before: value.before && typeof value.before === "object" ?
      value.before : null,
    after: value.after && typeof value.after === "object" ? value.after : null,
  };
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const map = (await db.ref(`uidToCustom/${uid}`).once("value")).val();
    const educatorId = normalizeUidToEducator(map);
    if (!educatorId) return bad(res, 403, "NOT_AN_EDUCATOR");
    const profile = (await db.ref(`educators/${educatorId}`)
        .once("value")).val() || {};
    const schoolId = cleanStr(profile.schoolID || profile.schoolId, 80);
    const caller = (await db.ref(`schools/${schoolId}/educators/${educatorId}`)
        .once("value")).val() || {};
    if (caller.status !== "approved" ||
        !(caller.adminAccess === true || caller.superAdmin === true)) {
      return bad(res, 403, "NOT_SCHOOL_ADMIN");
    }
    const requestedLimit = Math.floor(Number(req.body && req.body.limit || 30));
    const limit = Math.max(1, Math.min(100, requestedLimit));
    const cursor = cleanStr(req.body && req.body.cursor, 160);
    let query = db.ref(`schools/${schoolId}/auditLogs`).orderByKey();
    if (cursor) query = query.endAt(cursor);
    const snap = await query.limitToLast(limit + (cursor ? 1 : 0))
        .once("value");
    const raw = snap.val() || {};
    let keys = Object.keys(raw).sort().reverse();
    if (cursor) keys = keys.filter((key) => key !== cursor);
    keys = keys.slice(0, limit);
    const logs = keys.map((key) => sanitizeLog(key, raw[key]));
    return res.status(200).json({
      ok: true,
      logs,
      nextCursor: keys.length === limit ? keys[keys.length - 1] : null,
    });
  } catch (error) {
    if (Number(error && error.code) === 401) {
      return bad(res, 401, "AUTHENTICATION_REQUIRED");
    }
    return bad(res, 500, "INTERNAL", errText(error));
  }
}

module.exports = handler;
module.exports.handler = handler;
