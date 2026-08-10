"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {
  bad,
  canDeleteStatus,
  cleanStr,
  errText,
  normalizeDrillStatus,
  readEducatorSchoolContext,
} = require("./_schoolDrillsAccess");

/**
 * Return true if caller can delete this draft.
 *
 * V1:
 * - creator can delete own draft
 * - admin/superAdmin can delete any school draft
 *
 * @param {Object} row Drill row
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator Caller school educator row
 * @return {boolean} True if allowed
 */
function callerCanDeleteDraft(row, educatorId, schoolEducator) {
  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  const createdBy = cleanStr(row && row.createdByEducatorId, 120);
  return createdBy === educatorId;
}

/**
 * HTTPS handler to delete an educator drill draft.
 *
 * Request body:
 *   {
 *     bootcamp: "sat",
 *     drillId: "..."
 *   }
 *
 * Only status === "draft" can be deleted.
 * Published/closed drills are not deletable in v1.
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
    const drillId = cleanStr(body.drillId, 120);

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    if (!drillId) {
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
      return bad(res, 403, "DRILL_BOOTCAMP_MISMATCH", {
        requestedBootcamp: bootcamp,
        drillBootcamp,
      });
    }

    const status = normalizeDrillStatus(drill.status, "draft");

    if (!canDeleteStatus(status)) {
      return bad(res, 409, "ONLY_DRAFTS_CAN_BE_DELETED", {
        status,
      });
    }

    if (!callerCanDeleteDraft(drill, educatorId, schoolEducator)) {
      return bad(res, 403, "CANNOT_DELETE_THIS_DRAFT");
    }

    await drillRef.remove();

    return res.status(200).json({
      ok: true,
      drillId,
      deletedAt: new Date().toISOString(),
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
