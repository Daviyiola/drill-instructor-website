"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {
  bad,
  cleanStr,
  errText,
  readEducatorSchoolContext,
  sanitizeDrillListRow,
} = require("./_schoolDrillsAccess");

/**
 * Return true when the caller may see and archive the drill.
 *
 * @param {Object} drill Drill row
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator School permission row
 * @return {boolean}
 */
function canArchiveDrill(drill, educatorId, schoolEducator) {
  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  return cleanStr(drill && drill.createdByEducatorId, 120) === educatorId;
}

/**
 * Set a caller-specific archive flag on a closed educator drill.
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

    const callerFbUid = await requireBearerUid(req);
    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const drillId = cleanStr(body.drillId, 160);
    const archived = body.archived === true;

    if (!bootcamp) return bad(res, 400, "MISSING_BOOTCAMP");
    if (!drillId) return bad(res, 400, "MISSING_DRILL_ID");
    if (typeof body.archived !== "boolean") {
      return bad(res, 400, "INVALID_ARCHIVED_STATE");
    }

    const db = getDatabase();
    const ctx = await readEducatorSchoolContext(db, callerFbUid, bootcamp);

    if (ctx.error) {
      return bad(res, 403, ctx.error, ctx.details || null);
    }

    const {educatorId, schoolId, schoolEducator} = ctx;
    const drillRef = db.ref(`schools/${schoolId}/educatorDrills/${drillId}`);
    const drillSnap = await drillRef.once("value");
    const drill = drillSnap.val();

    if (!drill || typeof drill !== "object") {
      return bad(res, 404, "DRILL_NOT_FOUND");
    }

    if (cleanStr(drill.bootcamp, 40).toLowerCase() !== bootcamp) {
      return bad(res, 403, "DRILL_BOOTCAMP_MISMATCH");
    }

    if (!canArchiveDrill(drill, educatorId, schoolEducator)) {
      return bad(res, 403, "CANNOT_ARCHIVE_THIS_DRILL");
    }

    const status = cleanStr(drill.status, 40).toLowerCase() || "draft";
    if (archived && status !== "closed") {
      return bad(res, 409, "ONLY_CLOSED_DRILLS_CAN_BE_ARCHIVED", {status});
    }

    const nowIso = new Date().toISOString();
    const archiveRef = drillRef.child(`archivedBy/${educatorId}`);

    if (archived) await archiveRef.set(true);
    else await archiveRef.remove();

    const cleanDrill = sanitizeDrillListRow(drillId, drill);
    cleanDrill.archived = archived && status === "closed";

    return res.status(200).json({
      ok: true,
      drillId,
      archived: cleanDrill.archived,
      drill: cleanDrill,
      syncedAt: nowIso,
    });
  } catch (e) {
    const details = errText(e);

    if (Number(e && e.code) === 401) {
      return bad(res, 401, "UNAUTHENTICATED", details);
    }

    if (details.includes("auth/id-token-expired") ||
        details.includes("Firebase ID token has expired")) {
      return bad(res, 401, "ID_TOKEN_EXPIRED", details);
    }

    if (details.includes("auth/argument-error") ||
        details.includes("Decoding Firebase ID token failed")) {
      return bad(res, 401, "INVALID_ID_TOKEN", details);
    }

    return bad(res, 500, "INTERNAL", details);
  }
};

exports.canArchiveDrill = canArchiveDrill;
