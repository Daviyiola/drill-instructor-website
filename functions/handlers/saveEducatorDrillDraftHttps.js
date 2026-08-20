"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {normalizeFutureDueAt} = require("./_educatorDueDate");
const {
  bad,
  canEditContentStatus,
  cleanStr,
  emptyDrillSummary,
  errText,
  normalizeDrillStatus,
  readEducatorSchoolContext,
  sanitizeBlueprint,
  sanitizeDraftInput,
  sanitizeDrillListRow,
} = require("./_schoolDrillsAccess");

/**
 * Build a stable drill id.
 *
 * @param {Object} db Firebase database instance
 * @param {string} schoolId School id
 * @return {string} New drill id
 */
function makeDrillId(db, schoolId) {
  return db.ref(`schools/${schoolId}/educatorDrills`).push().key;
}

/**
 * Return true if caller can edit the draft.
 *
 * V1:
 * - creator can edit own draft
 * - admin/superAdmin can edit any draft in school
 *
 * @param {Object} row Existing drill row
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator Caller school row
 * @return {boolean} True if editable
 */
function callerCanEditDraft(row, educatorId, schoolEducator) {
  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  const createdBy = cleanStr(row && row.createdByEducatorId, 120);
  return createdBy === educatorId;
}

/**
 * Validate existing drill row for draft editing.
 *
 * @param {Object|null} existing Existing row
 * @param {string} drillId Drill id
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator Caller school row
 * @return {Object|null} Error object or null
 */
function validateExistingDraft(existing, drillId, educatorId, schoolEducator) {
  if (!drillId) return null;

  if (!existing) {
    return {
      code: 404,
      error: "DRILL_NOT_FOUND",
    };
  }

  const status = normalizeDrillStatus(existing.status, "draft");

  if (!canEditContentStatus(status)) {
    return {
      code: 409,
      error: "DRILL_CONTENT_IMMUTABLE_AFTER_PUBLISH",
      details: {
        status,
      },
    };
  }

  if (!callerCanEditDraft(existing, educatorId, schoolEducator)) {
    return {
      code: 403,
      error: "CANNOT_EDIT_THIS_DRILL",
    };
  }

  return null;
}

/**
 * HTTPS handler to create or update an educator drill draft.
 *
 * Request body:
 *   {
 *     drillId?: string,
 *     bootcamp: "sat",
 *     title: "...",
 *     instructions: "...",
 *     dueAt: "...",
 *     settings: {
 *       showScoreImmediately: true,
 *       showCorrectionsImmediately: false,
 *       shuffleQuestions: true,
 *       shuffleOptions: true
 *     },
 *     blueprint: {
 *       bootcamp: "sat",
 *       datasetVersion: "sat-v1",
 *       subjects: [
 *         {
 *           subject: "Math",
 *           questionIds: [1, 2, 3],
 *           timeLimitMin: 15,
 *           filters: {
 *             practiceYearCsv: "1,2,3",
 *             modulesCsv: "Algebra|Geometry"
 *           }
 *         }
 *       ]
 *     }
 *   }
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
    const drillIdIn = cleanStr(body.drillId, 120);
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    const allowsEmptyBlueprint = body.blueprint === null ||
      body.blueprint === undefined;
    const blueprintResult = allowsEmptyBlueprint ?
      {ok: true, blueprint: null} :
      sanitizeBlueprint(body.blueprint, bootcamp);
    if (!blueprintResult.ok) {
      return bad(
          res,
          400,
          blueprintResult.error || "INVALID_BLUEPRINT",
          blueprintResult.details || null,
      );
    }

    if (blueprintResult.blueprint &&
        blueprintResult.blueprint.bootcamp !== bootcamp) {
      return bad(res, 400, "BLUEPRINT_BOOTCAMP_MISMATCH", {
        bootcamp,
        blueprintBootcamp: blueprintResult.blueprint.bootcamp,
      });
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

    let existing = null;

    if (drillIdIn) {
      const existingSnap = await db
          .ref(`schools/${schoolId}/educatorDrills/${drillIdIn}`)
          .once("value");

      existing = existingSnap.val();

      const existingError = validateExistingDraft(
          existing,
          drillIdIn,
          educatorId,
          schoolEducator,
      );

      if (existingError) {
        return bad(
            res,
            existingError.code,
            existingError.error,
            existingError.details || null,
        );
      }

      const existingBootcamp = cleanStr(existing.bootcamp, 40).toLowerCase();
      if (existingBootcamp && existingBootcamp !== bootcamp) {
        return bad(res, 409, "CANNOT_CHANGE_DRILL_BOOTCAMP", {
          existingBootcamp,
          requestedBootcamp: bootcamp,
        });
      }
    }

    const now = new Date().toISOString();
    const drillId = drillIdIn || makeDrillId(db, schoolId);

    if (!drillId) {
      return bad(res, 500, "FAILED_TO_CREATE_DRILL_ID");
    }

    const draftInput = sanitizeDraftInput(body, existing || {});
    if (!draftInput.title) {
      return bad(res, 400, "MISSING_TITLE");
    }

    const dueResult = normalizeFutureDueAt(draftInput.dueAt);
    if (!dueResult.ok) {
      return bad(res, 400, dueResult.error);
    }
    draftInput.dueAt = dueResult.dueAt;

    const row = {
      drillId,
      schoolId,
      bootcamp,
      status: "draft",

      title: draftInput.title,
      instructions: draftInput.instructions,

      createdByEducatorId: existing && existing.createdByEducatorId ?
        cleanStr(existing.createdByEducatorId, 120) :
        educatorId,

      createdByName: existing && existing.createdByName ?
        cleanStr(existing.createdByName, 140) :
        educatorName,

      createdAt: existing && existing.createdAt ?
        cleanStr(existing.createdAt, 80) :
        now,

      updatedAt: now,

      publishedAt: "",
      closedAt: "",
      reopenedAt: "",

      dueAt: draftInput.dueAt,

      settings: draftInput.settings,
      blueprint: blueprintResult.blueprint,

      assignedStudents: existing && existing.assignedStudents ?
        existing.assignedStudents :
        {},

      sourceGroups: existing && existing.sourceGroups ?
        existing.sourceGroups :
        {},

      summary: existing && existing.summary ?
        existing.summary :
        emptyDrillSummary(),
    };

    const updates = {};
    updates[`schools/${schoolId}/educatorDrills/${drillId}`] = row;

    await db.ref().update(updates);

    return res.status(200).json({
      ok: true,
      drill: sanitizeDrillListRow(drillId, row),
      drillId,
      status: "draft",
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
