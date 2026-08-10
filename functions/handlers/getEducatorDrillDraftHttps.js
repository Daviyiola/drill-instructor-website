"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {
  bad,
  cleanStr,
  errText,
  normalizeDrillStatus,
  readEducatorSchoolContext,
  sanitizeDrillListRow,
} = require("./_schoolDrillsAccess");

/**
 * Return true if caller can view this drill.
 *
 * V1:
 * - creator can view own drill
 * - admin/superAdmin can view any school drill
 *
 * @param {Object} row Drill row
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator Caller school educator row
 * @return {boolean} True if allowed
 */
function callerCanView(row, educatorId, schoolEducator) {
  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  const createdBy = cleanStr(row && row.createdByEducatorId, 120);
  return createdBy === educatorId;
}

/**
 * Return full drill detail for the builder/editor.
 *
 * Request:
 * {
 *   bootcamp: "sat",
 *   drillId: "..."
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   drill: { list-safe row },
 *   full: {
 *     blueprint,
 *     settings,
 *     instructions,
 *     ...
 *   }
 * }
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

    const drillSnap = await db
        .ref(`schools/${schoolId}/educatorDrills/${drillId}`)
        .once("value");

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

    if (!callerCanView(drill, educatorId, schoolEducator)) {
      return bad(res, 403, "CANNOT_VIEW_THIS_DRILL");
    }

    const status = normalizeDrillStatus(drill.status, "draft");

    return res.status(200).json({
      ok: true,
      drill: sanitizeDrillListRow(drillId, drill),
      full: {
        drillId,
        bootcamp: drillBootcamp,
        status,
        title: cleanStr(drill.title, 120),
        instructions: cleanStr(drill.instructions, 1200),
        dueAt: cleanStr(drill.dueAt, 80),
        settings: drill.settings && typeof drill.settings === "object" ?
          drill.settings :
          {},
        release: drill.release && typeof drill.release === "object" ?
          drill.release :
          null,
        blueprint: drill.blueprint && typeof drill.blueprint === "object" ?
          drill.blueprint :
          null,
        createdByEducatorId: cleanStr(drill.createdByEducatorId, 120),
        createdByName: cleanStr(drill.createdByName, 140),
        createdAt: cleanStr(drill.createdAt, 80),
        updatedAt: cleanStr(drill.updatedAt, 80),
        publishedAt: cleanStr(drill.publishedAt, 80),
        closedAt: cleanStr(drill.closedAt, 80),
      },
      syncedAt: new Date().toISOString(),
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
