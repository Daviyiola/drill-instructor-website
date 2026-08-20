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
const {releaseFromDrill} = require("./studentAssignmentsHttps");

/**
 * Return true if caller can change this drill status.
 *
 * Creator can change own drill status.
 * Admin/superAdmin can change all school drill statuses.
 *
 * @param {Object} drill Drill row
 * @param {string} educatorId Caller educator id
 * @param {Object} schoolEducator School educator row
 * @return {boolean}
 */
function canChangeDrillStatus(drill, educatorId, schoolEducator) {
  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  const createdBy = cleanStr(drill && drill.createdByEducatorId, 120);
  return createdBy === educatorId;
}

/**
 * Preserve the native client's established automatic reopen deadline.
 * The web client sends an educator-selected future date explicitly.
 *
 * @return {string} ISO timestamp seven days from now.
 */
function defaultReopenDueAt() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setUTCHours(23, 59, 0, 0);
  return date.toISOString();
}

/**
 * Return normalized assigned student map.
 *
 * @param {Object} drill Drill row
 * @return {Object}
 */
function assignedStudentsOf(drill) {
  return drill &&
    drill.assignedStudents &&
    typeof drill.assignedStudents === "object" ?
    drill.assignedStudents :
    {};
}

/**
 * Return next inbox status for reopen.
 *
 * Submitted stays submitted.
 * Started stays started.
 * Everyone else becomes assigned.
 *
 * @param {string} oldStatus Previous student drill status
 * @return {string}
 */
function reopenedStudentStatus(oldStatus) {
  const s = cleanStr(oldStatus, 40).toLowerCase();

  if (s === "submitted") return "submitted";
  // if (s === "started") return "started";

  return "assigned";
}

/**
 * HTTPS handler to close or reopen an educator drill.
 *
 * Request:
 * {
 *   bootcamp: "utme",
 *   drillId: "-abc",
 *   action: "close" | "reopen"
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
    const action = cleanStr(body.action, 40).toLowerCase();

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    if (!drillId) {
      return bad(res, 400, "MISSING_DRILL_ID");
    }

    if (action !== "close" && action !== "reopen") {
      return bad(res, 400, "INVALID_ACTION");
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

    if (!canChangeDrillStatus(drill, educatorId, schoolEducator)) {
      return bad(res, 403, "CANNOT_CHANGE_THIS_DRILL_STATUS");
    }

    const oldStatus = cleanStr(drill.status, 40).toLowerCase() || "draft";

    if (action === "close" && oldStatus !== "published") {
      return bad(res, 409, "ONLY_PUBLISHED_DRILLS_CAN_BE_CLOSED", {
        status: oldStatus,
      });
    }

    if (action === "reopen" && oldStatus !== "closed") {
      return bad(res, 409, "ONLY_CLOSED_DRILLS_CAN_BE_REOPENED", {
        status: oldStatus,
      });
    }

    const nowIso = new Date().toISOString();
    const updates = {};

    let newStatus = oldStatus;
    let newDueAt = cleanStr(drill.dueAt, 80);
    let closedAt = cleanStr(drill.closedAt, 80);
    let reopenedAt = cleanStr(drill.reopenedAt, 80);

    if (action === "close") {
      newStatus = "closed";
      closedAt = nowIso;
      const currentRelease = releaseFromDrill(drill);
      const closedRelease = {
        ...currentRelease,
        // Closing releases the score irreversibly. Corrections retain their
        // independent policy and release timestamp.
        scoreReleasedAt: currentRelease.scoreReleasedAt || nowIso,
      };

      updates[`schools/${schoolId}/educatorDrills/${drillId}/status`] =
        newStatus;
      updates[`schools/${schoolId}/educatorDrills/${drillId}/release`] =
        closedRelease;
      updates[`schools/${schoolId}/educatorDrills/${drillId}/closedAt`] =
        closedAt;
      updates[`schools/${schoolId}/educatorDrills/${drillId}/updatedAt`] =
        nowIso;
      updates[`schools/${schoolId}/educatorDrills/${drillId}/statusUpdatedAt`] =
        nowIso;
      updates[
          `schools/${schoolId}/educatorDrills` +
          `/${drillId}/statusUpdatedByEducatorId`
      ] =
        educatorId;
    }

    if (action === "reopen") {
      const requestedDueAt = body.dueAt || defaultReopenDueAt();
      const dueResult = normalizeFutureDueAt(requestedDueAt);
      if (!dueResult.ok || !dueResult.dueAt) {
        return bad(res, 400, dueResult.error || "REOPEN_DUE_DATE_REQUIRED");
      }
      newStatus = "published";
      reopenedAt = nowIso;
      closedAt = "";
      newDueAt = dueResult.dueAt;

      updates[`schools/${schoolId}/educatorDrills/${drillId}/status`] =
        newStatus;
      updates[`schools/${schoolId}/educatorDrills/${drillId}/reopenedAt`] =
        reopenedAt;
      updates[`schools/${schoolId}/educatorDrills/${drillId}/closedAt`] =
        "";
      updates[`schools/${schoolId}/educatorDrills/${drillId}/dueAt`] =
        newDueAt;
      // Archive is a personal inbox preference for closed drills. A reopened
      // drill is active again, so clear every educator's stale archive flag.
      updates[`schools/${schoolId}/educatorDrills/${drillId}/archivedBy`] =
        null;
      updates[`schools/${schoolId}/educatorDrills/${drillId}/updatedAt`] =
        nowIso;
      updates[`schools/${schoolId}/educatorDrills/${drillId}/statusUpdatedAt`] =
        nowIso;
      updates[
          `schools/${schoolId}/educatorDrills` +
          `/${drillId}/statusUpdatedByEducatorId`
      ] =
        educatorId;
    }

    const assignedStudents = assignedStudentsOf(drill);

    for (const studentId of Object.keys(assignedStudents)) {
      const assigned = assignedStudents[studentId] || {};
      const oldStudentStatus = cleanStr(assigned.status, 40).toLowerCase();

      const schoolAssignedBase =
    `schools/${schoolId}/educatorDrills/${drillId}` +
    `/assignedStudents/${studentId}`;

      const userAssignedBase =
    `users/${studentId}/assignedDrills/${drillId}`;

      if (action === "close") {
        const nextStatus =
      oldStudentStatus === "submitted" ? "submitted" : "closed";

        updates[`${schoolAssignedBase}/status`] = nextStatus;
        updates[`${schoolAssignedBase}/closedAt`] = nowIso;
        updates[`${schoolAssignedBase}/updatedAt`] = nowIso;

        updates[`${userAssignedBase}/status`] = nextStatus;
        updates[`${userAssignedBase}/closedAt`] = nowIso;
        updates[`${userAssignedBase}/updatedAt`] = nowIso;

        const attemptId = cleanStr(assigned.attemptId, 160);
        if (attemptId) {
          const attemptRelease = releaseFromDrill(drill);
          const released = {
            ...attemptRelease,
            scoreReleasedAt: attemptRelease.scoreReleasedAt || nowIso,
          };
          updates[`users/${studentId}/statsIndex/${attemptId}/release`] =
            released;
          updates[`studentDrills/${studentId}/${attemptId}/` +
            "assignmentRelease"] = released;
        }
      }

      if (action === "reopen") {
        const nextStatus = reopenedStudentStatus(oldStudentStatus);

        updates[`${schoolAssignedBase}/status`] = nextStatus;
        updates[`${schoolAssignedBase}/reopenedAt`] = nowIso;
        updates[`${schoolAssignedBase}/closedAt`] = null;
        updates[`${schoolAssignedBase}/dueAt`] = newDueAt;
        updates[`${schoolAssignedBase}/updatedAt`] = nowIso;

        updates[`${userAssignedBase}/status`] = nextStatus;
        updates[`${userAssignedBase}/reopenedAt`] = nowIso;
        updates[`${userAssignedBase}/closedAt`] = null;
        updates[`${userAssignedBase}/dueAt`] = newDueAt;
        updates[`${userAssignedBase}/updatedAt`] = nowIso;
      }
    }

    await db.ref().update(updates);

    const updatedDrill = {
      ...drill,
      status: newStatus,
      dueAt: newDueAt,
      closedAt,
      reopenedAt,
      updatedAt: nowIso,
    };

    if (action === "reopen") {
      updatedDrill.archivedBy = null;
    }

    return res.status(200).json({
      ok: true,
      action,
      drillId,
      schoolId,
      oldStatus,
      status: newStatus,
      dueAt: newDueAt,
      drill: sanitizeDrillListRow(drillId, updatedDrill),
      syncedAt: nowIso,
    });
  } catch (e) {
    console.error("UPDATE_DRILL_STATUS_INTERNAL", {
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack ? e.stack : "",
    });

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
