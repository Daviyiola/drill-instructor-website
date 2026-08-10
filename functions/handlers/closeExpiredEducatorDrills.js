"use strict";

const {onSchedule} = require("firebase-functions/v2/scheduler");
const {getDatabase} = require("firebase-admin/database");

/**
 * Safe trimmed string.
 *
 * @param {*} v
 * @return {string}
 */
function cleanStr(v) {
  return (v === undefined || v === null) ? "" : String(v).trim();
}

/**
 * Return true if dueAt is valid and in the past.
 *
 * @param {*} dueAt
 * @param {number} nowMs
 * @return {boolean}
 */
function isExpiredDueAt(dueAt, nowMs) {
  const raw = cleanStr(dueAt);
  if (!raw) return false;

  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return false;

  return ms <= nowMs;
}

/**
 * For closing a drill:
 * - submitted stays submitted
 * - everything else becomes closed
 *
 * @param {*} studentStatus
 * @return {string}
 */
function closedStudentStatus(studentStatus) {
  const s = cleanStr(studentStatus).toLowerCase();
  return s === "submitted" ? "submitted" : "closed";
}

exports.closeExpiredEducatorDrills = onSchedule(
    {
      schedule: "0 */4 * * *", // every 4 hours
      timeZone: "UTC",
      region: "us-central1",
      timeoutSeconds: 540,
      memory: "512MiB",
    },
    async () => {
      const db = getDatabase();
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const schoolsSnap = await db.ref("schools").once("value");
      const schools = schoolsSnap.val() || {};

      const updates = {};
      const closedDrillIds = [];

      for (const schoolId of Object.keys(schools)) {
        const school = schools[schoolId] || {};
        const drills =
          school.educatorDrills &&
          typeof school.educatorDrills === "object" ?
            school.educatorDrills :
            {};

        for (const drillId of Object.keys(drills)) {
          const drill = drills[drillId] || {};
          const status = cleanStr(drill.status).toLowerCase();

          if (status !== "published") {
            continue;
          }

          if (!isExpiredDueAt(drill.dueAt, nowMs)) {
            continue;
          }

          const drillBase = `schools/${schoolId}/educatorDrills/${drillId}`;

          updates[`${drillBase}/status`] = "closed";
          updates[`${drillBase}/closedAt`] = nowIso;
          updates[`${drillBase}/updatedAt`] = nowIso;
          updates[`${drillBase}/statusUpdatedAt`] = nowIso;
          updates[`${drillBase}/statusUpdatedByEducatorId`] = "system";

          const assignedStudents =
            drill.assignedStudents &&
            typeof drill.assignedStudents === "object" ?
              drill.assignedStudents :
              {};

          for (const studentId of Object.keys(assignedStudents)) {
            const assigned = assignedStudents[studentId] || {};
            const nextStatus = closedStudentStatus(assigned.status);

            const schoolAssignedBase =
              `${drillBase}/assignedStudents/${studentId}`;

            const userAssignedBase =
              `users/${studentId}/assignedDrills/${drillId}`;

            updates[`${schoolAssignedBase}/status`] = nextStatus;
            updates[`${schoolAssignedBase}/closedAt`] = nowIso;
            updates[`${schoolAssignedBase}/updatedAt`] = nowIso;

            updates[`${userAssignedBase}/status`] = nextStatus;
            updates[`${userAssignedBase}/closedAt`] = nowIso;
            updates[`${userAssignedBase}/updatedAt`] = nowIso;
          }

          closedDrillIds.push({
            schoolId,
            drillId,
          });
        }
      }

      if (Object.keys(updates).length > 0) {
        await db.ref().update(updates);
      }

      console.log("CLOSE_EXPIRED_EDUCATOR_DRILLS_DONE", {
        closedDrillCount: closedDrillIds.length,
        closedDrills: closedDrillIds,
        updatePathCount: Object.keys(updates).length,
        ranAt: nowIso,
      });
    },
);
