"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {normalizeFutureDueAt} = require("./_educatorDueDate");
const {
  bad,
  cleanStr,
  errText,
  readEducatorSchoolContext,
  sanitizeDrillListRow,
} = require("./_schoolDrillsAccess");

/**
 * Return true if caller can edit this drill.
 *
 * Creator can edit their own drill settings.
 * Admin/superAdmin can edit all school drill settings.
 *
 * @param {Object} drill Drill row
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator School educator row
 * @return {boolean}
 */
function canEditDrillSettings(drill, educatorId, schoolEducator) {
  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  const createdBy = cleanStr(drill && drill.createdByEducatorId, 120);
  return createdBy === educatorId;
}

/**
 * Normalize safe drill settings.
 *
 * @param {Object} input Raw settings
 * @param {Object} existing Existing settings
 * @return {Object}
 */
function normalizeSettings(input, existing) {
  const src = input && typeof input === "object" ? input : {};
  const old = existing && typeof existing === "object" ? existing : {};
  const policies = new Set(["immediate", "on_due_date", "manual"]);
  const scorePolicy = cleanStr(src.scorePolicy || old.scorePolicy, 30);
  const correctionPolicy = cleanStr(
      src.correctionPolicy || old.correctionPolicy,
      30,
  );

  return {
    scorePolicy: policies.has(scorePolicy) ? scorePolicy : "immediate",
    correctionPolicy: policies.has(correctionPolicy) ?
      correctionPolicy : "manual",

    shuffleQuestions:
      src.shuffleQuestions !== undefined ?
        src.shuffleQuestions === true :
        old.shuffleQuestions !== false,

    shuffleOptions:
      src.shuffleOptions !== undefined ?
        src.shuffleOptions === true :
        old.shuffleOptions !== false,
  };
}

/**
 * Validate due date.
 *
 * Empty dueAt means no due date.
 *
 * @param {string} raw Raw due date
 * @return {{ok:boolean, dueAt:string, error:string}}
 */
/**
 * HTTPS handler to update safe settings for an educator drill.
 *
 * Request:
 * {
 *   bootcamp: "utme",
 *   drillId: "-abc",
 *   title: "Quiz title",
 *   instructions: "Instructions",
 *   dueAt: "2026-06-20T23:59:00.000Z",
 *   settings: {
 *     showScoreImmediately: true,
 *     showCorrectionsImmediately: false,
 *     shuffleQuestions: true,
 *     shuffleOptions: true
 *   }
 * }
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const drillId = cleanStr(body.drillId, 160);

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    if (!drillId) {
      return bad(res, 400, "MISSING_DRILL_ID");
    }

    const title = cleanStr(body.title, 160);
    const instructions = cleanStr(body.instructions, 2000);

    if (!title) {
      return bad(res, 400, "MISSING_TITLE");
    }

    const dueResult = normalizeFutureDueAt(body.dueAt);

    if (!dueResult.ok) {
      return bad(res, 400, dueResult.error);
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    const ctx = await readEducatorSchoolContext(db, callerFbUid, bootcamp);

    if (ctx.error) {
      return bad(res, 403, ctx.error, ctx.details || null);
    }

    const {
      educatorId,
      schoolId,
      schoolEducator,
    } = ctx;

    const drillRef = db.ref(`schools/${schoolId}/educatorDrills/${drillId}`);
    const drillSnap = await drillRef.once("value");
    const drill = drillSnap.val();

    if (!drill || typeof drill !== "object") {
      return bad(res, 404, "DRILL_NOT_FOUND");
    }

    const drillBootcamp = cleanStr(drill.bootcamp, 40).toLowerCase();

    if (drillBootcamp !== bootcamp) {
      return bad(res, 403, "DRILL_BOOTCAMP_MISMATCH");
    }

    if (!canEditDrillSettings(drill, educatorId, schoolEducator)) {
      return bad(res, 403, "DRILL_NOT_OWNED_BY_CALLER");
    }

    const status = cleanStr(drill.status, 40).toLowerCase() || "draft";

    if (status === "draft") {
      return bad(res, 409, "DRAFTS_USE_DRAFT_EDITOR");
    }

    if (status !== "published" && status !== "closed") {
      return bad(res, 409, "DRILL_STATUS_NOT_EDITABLE", {
        status,
      });
    }

    const nowIso = new Date().toISOString();

    const existingSettings =
      drill.settings && typeof drill.settings === "object" ?
        drill.settings :
        {};

    const settings = normalizeSettings(body.settings, existingSettings);
    if (!dueResult.dueAt && (settings.scorePolicy === "on_due_date" ||
        settings.correctionPolicy === "on_due_date")) {
      return bad(res, 400, "DUE_DATE_REQUIRED_FOR_RELEASE_POLICY");
    }

    const existingRelease = drill.release &&
      typeof drill.release === "object" ? drill.release : {};
    const release = {
      scorePolicy: settings.scorePolicy,
      correctionPolicy: settings.correctionPolicy,
      scoreReleasedAt: existingRelease.scoreReleasedAt || null,
      correctionsReleasedAt:
        existingRelease.correctionsReleasedAt || null,
    };
    const updatePatch = {
      title,
      instructions,
      dueAt: dueResult.dueAt,
      settings,
      release,
      updatedAt: nowIso,
      settingsUpdatedAt: nowIso,
      settingsUpdatedByEducatorId: educatorId,
    };

    const updates = {};

    for (const key of Object.keys(updatePatch)) {
      updates[`schools/${schoolId}/educatorDrills/${drillId}/${key}`] =
        updatePatch[key];
    }

    const assignedStudents =
      drill.assignedStudents && typeof drill.assignedStudents === "object" ?
        drill.assignedStudents :
        {};

    for (const studentId of Object.keys(assignedStudents)) {
      updates[`users/${studentId}/assignedDrills/${drillId}/title`] = title;
      updates[`users/${studentId}/assignedDrills/${drillId}/instructions`] =
        instructions;
      updates[`users/${studentId}/assignedDrills/${drillId}/dueAt`] =
        dueResult.dueAt;
      updates[`users/${studentId}/assignedDrills/${drillId}/settings`] =
        settings;
      updates[`users/${studentId}/assignedDrills/${drillId}/updatedAt`] =
        nowIso;
      const attemptRows = (await db.ref(`users/${studentId}/statsIndex`)
          .once("value")).val() || {};
      for (const attemptId of Object.keys(attemptRows)) {
        const attempt = attemptRows[attemptId] || {};
        if (attempt.source !== "assignment" || attempt.sourceId !== drillId) {
          continue;
        }
        updates[`users/${studentId}/statsIndex/${attemptId}/release`] =
          release;
        updates[`users/${studentId}/statsIndex/${attemptId}/dueAt`] =
          dueResult.dueAt;
        updates[`studentDrills/${studentId}/${attemptId}/assignmentRelease`] =
          release;
        updates[`studentDrills/${studentId}/${attemptId}/dueAt`] =
          dueResult.dueAt;
      }
    }

    await db.ref().update(updates);

    const updatedDrill = {
      ...drill,
      ...updatePatch,
    };

    return res.status(200).json({
      ok: true,
      drillId,
      schoolId,
      status,
      drill: sanitizeDrillListRow(drillId, updatedDrill),
      syncedAt: nowIso,
    });
  } catch (e) {
    const details = errText(e);

    if (
      details.includes("auth/id-token-expired") ||
      details.includes("Firebase ID token has expired")
    ) {
      return bad(res, 401, "ID_TOKEN_EXPIRED", details);
    }

    if (
      details.includes("auth/argument-error") ||
      details.includes("Decoding Firebase ID token failed")
    ) {
      return bad(res, 401, "INVALID_ID_TOKEN", details);
    }

    return bad(res, 500, "INTERNAL", details);
  }
};
