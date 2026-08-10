"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {
  bad,
  cleanStr,
  emptyDrillSummary,
  errText,
  readEducatorSchoolContext,
  sanitizeDrillListRow,
} = require("./_schoolDrillsAccess");

/**
 * Create a new drill id under the school's educator drills branch.
 *
 * @param {Object} db Firebase database instance
 * @param {string} schoolId School id
 * @return {string} New drill id
 */
function makeDrillId(db, schoolId) {
  return db.ref(`schools/${schoolId}/educatorDrills`).push().key;
}

/**
 * Return true if caller can duplicate this drill.
 *
 * V1:
 * - creator can duplicate own drill
 * - admin/superAdmin can duplicate any school drill
 *
 * @param {Object} row Drill row
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator Caller school educator row
 * @return {boolean} True if allowed
 */
function callerCanDuplicate(row, educatorId, schoolEducator) {
  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  const createdBy = cleanStr(row && row.createdByEducatorId, 120);
  return createdBy === educatorId;
}

/**
 * Build duplicated draft title.
 *
 * @param {string} oldTitle Existing title
 * @return {string} New title
 */
function duplicateTitle(oldTitle) {
  const base = cleanStr(oldTitle, 100) || "Untitled Drill";

  if (base.toLowerCase().indexOf("copy") !== -1) {
    return base;
  }

  return `${base} Copy`;
}

/**
 * HTTPS handler to duplicate an educator drill into a new draft.
 *
 * Request body:
 *   {
 *     bootcamp: "sat",
 *     drillId: "..."
 *   }
 *
 * Any source status is allowed:
 *   draft
 *   published
 *   closed
 *
 * New drill:
 *   status = draft
 *   assignedStudents = {}
 *   sourceGroups = {}
 *   summary = empty
 *   publishedAt/closedAt/reopenedAt = ""
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const sourceDrillId = cleanStr(body.drillId, 120);

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    if (!sourceDrillId) {
      return bad(res, 400, "MISSING_DRILL_ID");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    const ctx = await readEducatorSchoolContext(db, callerFbUid, bootcamp);

    if (ctx.error) {
      return bad(res, 403, ctx.error, ctx.details || null);
    }

    const {
      educatorId,
      educatorName,
      schoolId,
      schoolEducator,
    } = ctx;

    const sourceSnap = await db
        .ref(`schools/${schoolId}/educatorDrills/${sourceDrillId}`)
        .once("value");

    const source = sourceSnap.val();

    if (!source || typeof source !== "object") {
      return bad(res, 404, "DRILL_NOT_FOUND");
    }

    const sourceBootcamp = cleanStr(source.bootcamp, 40).toLowerCase();
    if (sourceBootcamp !== bootcamp) {
      return bad(res, 403, "DRILL_BOOTCAMP_MISMATCH", {
        requestedBootcamp: bootcamp,
        sourceBootcamp,
      });
    }

    if (!callerCanDuplicate(source, educatorId, schoolEducator)) {
      return bad(res, 403, "CANNOT_DUPLICATE_THIS_DRILL");
    }

    if (!source.blueprint || typeof source.blueprint !== "object") {
      return bad(res, 409, "SOURCE_DRILL_HAS_NO_BLUEPRINT");
    }

    const now = new Date().toISOString();
    const newDrillId = makeDrillId(db, schoolId);

    if (!newDrillId) {
      return bad(res, 500, "FAILED_TO_CREATE_DRILL_ID");
    }

    const copy = {
      drillId: newDrillId,
      schoolId,
      bootcamp,
      status: "draft",

      title: duplicateTitle(source.title),
      instructions: cleanStr(source.instructions, 1200),

      createdByEducatorId: educatorId,
      createdByName: educatorName,
      createdAt: now,
      updatedAt: now,

      duplicatedFromDrillId: sourceDrillId,
      duplicatedAt: now,

      publishedAt: "",
      closedAt: "",
      reopenedAt: "",

      dueAt: cleanStr(source.dueAt, 80),

      settings: source.settings && typeof source.settings === "object" ?
        source.settings :
        {
          showScoreImmediately: true,
          showCorrectionsImmediately: false,
          shuffleQuestions: true,
          shuffleOptions: true,
        },

      blueprint: source.blueprint,

      assignedStudents: {},
      sourceGroups: {},
      summary: emptyDrillSummary(),
    };

    const updates = {};
    updates[`schools/${schoolId}/educatorDrills/${newDrillId}`] = copy;

    await db.ref().update(updates);

    return res.status(200).json({
      ok: true,
      sourceDrillId,
      drillId: newDrillId,
      drill: sanitizeDrillListRow(newDrillId, copy),
      syncedAt: now,
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
