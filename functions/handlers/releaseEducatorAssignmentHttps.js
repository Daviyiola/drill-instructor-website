"use strict";
/* eslint-disable require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {bad, cleanStr, readEducatorSchoolContext} =
  require("./_schoolDrillsAccess");
const {releaseFromDrill} = require("./studentAssignmentsHttps");

function canRelease(drill, educatorId, schoolEducator) {
  return schoolEducator &&
    (schoolEducator.superAdmin === true ||
      schoolEducator.adminAccess === true) ||
    cleanStr(drill.createdByEducatorId, 120) === educatorId;
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
  try {
    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const drillId = cleanStr(body.drillId, 160);
    const target = cleanStr(body.target, 30).toLowerCase();
    if (!bootcamp || !drillId ||
        !new Set(["score", "corrections"]).has(target)) {
      return bad(res, 400, "INVALID_RELEASE_REQUEST");
    }
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const context = await readEducatorSchoolContext(db, uid, bootcamp);
    if (context.error) return bad(res, 403, context.error, context.details);
    const path = `schools/${context.schoolId}/educatorDrills/${drillId}`;
    const drill = (await db.ref(path).once("value")).val();
    if (!drill) return bad(res, 404, "DRILL_NOT_FOUND");
    if (!canRelease(drill, context.educatorId, context.schoolEducator)) {
      return bad(res, 403, "DRILL_NOT_OWNED_BY_CALLER");
    }
    const current = releaseFromDrill(drill);
    const nowIso = new Date().toISOString();
    const release = {
      ...current,
      scoreReleasedAt: current.scoreReleasedAt || nowIso,
      correctionsReleasedAt: target === "corrections" ?
        current.correctionsReleasedAt || nowIso : current.correctionsReleasedAt,
    };
    const updates = {};
    updates[`${path}/release`] = release;
    updates[`${path}/releaseUpdatedAt`] = nowIso;
    updates[`${path}/releaseUpdatedByEducatorId`] = context.educatorId;
    const students = Object.keys(drill.assignedStudents || {});
    for (const studentId of students) {
      const attemptRows = (await db.ref(`users/${studentId}/statsIndex`)
          .once("value")).val() || {};
      Object.entries(attemptRows).forEach(([attemptId, attempt]) => {
        if (attempt.source === "assignment" && attempt.sourceId === drillId) {
          updates[`users/${studentId}/statsIndex/${attemptId}/release`] =
            release;
          updates[`studentDrills/${studentId}/${attemptId}/assignmentRelease`] =
            release;
        }
      });
    }
    await db.ref().update(updates);
    return res.status(200).json({
      ok: true,
      drillId,
      target,
      release,
      releasedByEducatorId: context.educatorId,
      releasedAt: nowIso,
    });
  } catch (error) {
    console.error("ASSIGNMENT_RELEASE_FAILED", {message: error.message});
    return bad(res, error.code === 401 ? 401 : 500,
        error.code === 401 ? "AUTHENTICATION_FAILED" : "INTERNAL");
  }
}

module.exports = {handler};
