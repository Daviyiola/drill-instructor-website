"use strict";
/* eslint-disable require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {requireVerifiedBearerUid, allowCors} = require("./_auth");
const {
  bad,
  cleanStr,
  errText,
  normalizeSchool,
  normalizeUidToEducator,
} = require("./_schoolAdminAccess");
const {isValidTimezone} = require("./_schoolPolicies");

async function handler(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
    const uid = await requireVerifiedBearerUid(req);
    const db = getDatabase();
    const mapped = (await db.ref(`uidToCustom/${uid}`).once("value")).val();
    const educatorId = normalizeUidToEducator(mapped);
    if (!educatorId) return bad(res, 403, "NOT_AN_EDUCATOR");

    const profile = (await db.ref(`educators/${educatorId}`)
        .once("value")).val() || {};
    const schoolId = cleanStr(profile.schoolID || profile.schoolId, 80);
    if (!schoolId) return bad(res, 403, "EDUCATOR_HAS_NO_SCHOOL");

    const [schoolSnap, callerSnap] = await Promise.all([
      db.ref(`schools/${schoolId}`).once("value"),
      db.ref(`schools/${schoolId}/educators/${educatorId}`).once("value"),
    ]);
    const school = schoolSnap.val() || {};
    const caller = callerSnap.val() || {};
    if (caller.status !== "approved" || caller.superAdmin !== true) {
      return bad(res, 403, "SUPER_ADMIN_REQUIRED");
    }

    const timezone = cleanStr(req.body && req.body.timezone, 80);
    const educatorRegistrationOpen =
      req.body && req.body.educatorRegistrationOpen;
    const studentEnrollmentOpen = req.body && req.body.studentEnrollmentOpen;
    if (!isValidTimezone(timezone)) {
      return bad(res, 400, "INVALID_TIMEZONE");
    }
    if (typeof educatorRegistrationOpen !== "boolean" ||
        typeof studentEnrollmentOpen !== "boolean") {
      return bad(res, 400, "INVALID_SCHOOL_POLICIES");
    }

    const normalized = normalizeSchool(schoolId, school);
    if (!normalized.name || !normalized.country || !normalized.state) {
      return bad(res, 400, "SCHOOL_RECORD_INCOMPLETE");
    }

    const previousUnit = (await db.ref(
        `units/corps/${normalized.country}/${normalized.state}/` +
        normalized.name,
    ).once("value")).val() || {};
    const now = new Date().toISOString();
    const auditRef = db.ref(`schools/${schoolId}/auditLogs`).push();
    const updates = {};
    updates[`schools/${schoolId}/timezone`] = timezone;
    updates[`designations/${schoolId}`] = educatorRegistrationOpen;
    updates[
        `units/corps/${normalized.country}/${normalized.state}/` +
        `${normalized.name}/platoonPermissions`
    ] = studentEnrollmentOpen;
    updates[`schools/${schoolId}/auditLogs/${auditRef.key}`] = {
      actorEducatorId: educatorId,
      targetEducatorId: "",
      action: "updateSchoolSettings",
      createdAt: now,
      before: {
        timezone: normalized.timezone || "",
        educatorRegistrationOpen:
          (await db.ref(`designations/${schoolId}`).once("value")).val() ===
          true,
        studentEnrollmentOpen: previousUnit.platoonPermissions !== false,
      },
      after: {timezone, educatorRegistrationOpen, studentEnrollmentOpen},
    };
    await db.ref().update(updates);

    return res.status(200).json({
      ok: true,
      school: {...normalized, timezone},
      policies: {educatorRegistrationOpen, studentEnrollmentOpen},
      syncedAt: now,
    });
  } catch (error) {
    if (Number(error && error.code) === 401) {
      return bad(res, 401, "AUTHENTICATION_REQUIRED");
    }
    if (Number(error && error.code) === 403 &&
        error.message === "EMAIL_VERIFICATION_REQUIRED") {
      return bad(res, 403, "EMAIL_VERIFICATION_REQUIRED");
    }
    return bad(res, 500, "INTERNAL", errText(error));
  }
}

module.exports = handler;
module.exports.handler = handler;
