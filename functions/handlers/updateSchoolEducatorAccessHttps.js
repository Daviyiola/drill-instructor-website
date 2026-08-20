/* eslint-disable require-jsdoc */
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {
  approvedEducatorCount,
  bad,
  buildRecommendedEducatorAccess,
  cleanStr,
  errText,
  hasAnotherActiveAdmin,
  isActivePlan,
  isObject,
  normalizeAccess,
  normalizeSchool,
  normalizeStatus,
  normalizeUidToEducator,
  planHasBootcamp,
  validateAccessAgainstPlan,
} = require("./_schoolAdminAccess");

async function readCallerContext(db, callerFbUid) {
  const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
  const educatorId = normalizeUidToEducator(mapSnap.val());

  if (!educatorId) {
    return {error: "NOT_AN_EDUCATOR"};
  }

  const educatorSnap = await db.ref(`educators/${educatorId}`).once("value");
  const educator = educatorSnap.val() || {};
  const schoolId = cleanStr(educator.schoolID || educator.schoolId, 80);

  if (!schoolId) {
    return {error: "EDUCATOR_HAS_NO_SCHOOL"};
  }

  return {educatorId, educator, schoolId};
}

function willRemainActiveAdmin(row, newStatus, newAdminAccess) {
  if (!row) return false;
  if (newStatus !== "approved") return false;
  return row.superAdmin === true || newAdminAccess === true;
}

function cleanSelectedBootcamp(reqBody, schoolPlan) {
  const bodyBootcamp = cleanStr(reqBody && reqBody.bootcamp, 40).toLowerCase();
  if (!bodyBootcamp) return "";
  if (!planHasBootcamp(schoolPlan, bodyBootcamp)) return "";
  return bodyBootcamp;
}

async function validateSelectedStudents(db, access, schoolNorm) {
  const students = access.students || {};
  const ids = Object.keys(students)
      .filter((id) => id !== "all" && students[id] === true);

  const snaps = await Promise.all(ids.map((id) => {
    return db.ref(`users/${id}`).once("value");
  }));

  for (let i = 0; i < ids.length; i++) {
    const student = snaps[i].val() || {};
    const sameSchool =
      cleanStr(student.corpsName, 100) === schoolNorm.country &&
      cleanStr(student.battalionName, 100) === schoolNorm.state &&
      cleanStr(student.platoonName, 100) === schoolNorm.name;

    if (!sameSchool || student.platoonPermissions !== true) {
      return {
        error: "INVALID_OR_INACCESSIBLE_STUDENT",
        studentId: ids[i],
      };
    }
  }

  return null;
}

async function validateSelectedGroups(db, schoolId, access, schoolNorm) {
  const groups = access.groups || {};
  if (groups.all === true) return null;

  const ids = Object.keys(groups)
      .filter((id) => id !== "all" && groups[id] === true);

  const snaps = await Promise.all(ids.map((id) => {
    return db.ref(`schools/${schoolId}/groups/admin/${id}`).once("value");
  }));

  for (let i = 0; i < ids.length; i++) {
    if (!snaps[i].exists()) {
      return {
        error: "INVALID_SCHOOL_GROUP",
        groupId: ids[i],
      };
    }

    const group = snaps[i].val() || {};
    const members = group.members || {};
    const memberIds = Object.keys(members)
        .filter((studentId) => members[studentId] === true);

    if (memberIds.length === 0) continue;

    const studentSnaps = await Promise.all(memberIds.map((studentId) => {
      return db.ref(`users/${studentId}`).once("value");
    }));

    for (let j = 0; j < memberIds.length; j++) {
      const student = studentSnaps[j].val() || {};

      const sameSchool =
        cleanStr(student.corpsName, 100) === schoolNorm.country &&
        cleanStr(student.battalionName, 100) === schoolNorm.state &&
        cleanStr(student.platoonName, 100) === schoolNorm.name;

      if (!sameSchool || student.platoonPermissions !== true) {
        return {
          error: "GROUP_HAS_INVALID_OR_INACCESSIBLE_STUDENT",
          groupId: ids[i],
          studentId: memberIds[j],
        };
      }
    }
  }

  return null;
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const targetEducatorId = cleanStr(body.targetEducatorId, 120);

    if (!targetEducatorId) {
      return bad(res, 400, "MISSING_TARGET_EDUCATOR_ID");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();
    const callerCtx = await readCallerContext(db, callerFbUid);

    if (callerCtx.error) {
      return bad(res, 403, callerCtx.error);
    }

    const {educatorId: callerEducatorId, schoolId} = callerCtx;

    const [schoolSnap, callerRowSnap, targetProfileSnap] = await Promise.all([
      db.ref(`schools/${schoolId}`).once("value"),
      db.ref(`schools/${schoolId}/educators/${callerEducatorId}`)
          .once("value"),
      db.ref(`educators/${targetEducatorId}`).once("value"),
    ]);

    const school = schoolSnap.val() || {};
    const callerRow = callerRowSnap.val() || {};
    const targetProfile = targetProfileSnap.val() || {};
    const schoolEducators = school.educators || {};
    const targetRow = schoolEducators[targetEducatorId] || null;

    const callerIsAdmin = callerRow.adminAccess === true ||
      callerRow.superAdmin === true;

    if (callerRow.status !== "approved" || !callerIsAdmin) {
      return bad(res, 403, "NOT_SCHOOL_ADMIN", {
        status: callerRow.status || "missing",
      });
    }

    if (!targetRow) {
      return bad(res, 404, "TARGET_NOT_IN_SCHOOL");
    }

    const targetSchoolId = cleanStr(
        targetProfile.schoolID || targetProfile.schoolId,
        80,
    );

    if (targetSchoolId && targetSchoolId !== schoolId) {
      return bad(res, 403, "TARGET_BELONGS_TO_DIFFERENT_SCHOOL");
    }

    if (targetRow.superAdmin === true && callerRow.superAdmin !== true) {
      return bad(res, 403, "CANNOT_EDIT_SUPER_ADMIN");
    }

    const oldStatus = normalizeStatus(targetRow.status, "pending");
    const newStatus = normalizeStatus(body.status, oldStatus);

    if (!newStatus) {
      return bad(res, 400, "INVALID_STATUS");
    }

    const requestedAdminAccess = body.adminAccess === true;
    const adminAccessProvided = Object.prototype.hasOwnProperty.call(
        body,
        "adminAccess",
    );
    const newAdminAccess = adminAccessProvided ?
      requestedAdminAccess :
      targetRow.adminAccess === true;

    if (
      adminAccessProvided &&
      newAdminAccess !== (targetRow.adminAccess === true) &&
      callerRow.superAdmin !== true
    ) {
      return bad(res, 403, "ONLY_SUPER_ADMIN_CAN_CHANGE_ADMIN_ACCESS");
    }

    if (targetEducatorId === callerEducatorId) {
      if (newStatus !== oldStatus) {
        return bad(res, 403, "CANNOT_CHANGE_OWN_STATUS");
      }

      if (newAdminAccess !== (targetRow.adminAccess === true)) {
        return bad(res, 403, "CANNOT_CHANGE_OWN_ADMIN_ACCESS");
      }
    }

    const removingActiveAdmin =
      targetRow.status === "approved" &&
      (targetRow.adminAccess === true || targetRow.superAdmin === true) &&
      !willRemainActiveAdmin(targetRow, newStatus, newAdminAccess);

    if (removingActiveAdmin && !hasAnotherActiveAdmin(
        schoolEducators,
        targetEducatorId,
    )) {
      return bad(res, 409, "CANNOT_REMOVE_LAST_ACTIVE_ADMIN");
    }

    const plan = isObject(school.plan) ? school.plan : {};
    const activeBootcamp = cleanSelectedBootcamp(body, plan);
    const firstApproval = oldStatus !== "approved" && newStatus === "approved";
    // Older clients did not send an access mode and could approve an educator
    // without a usable bootcamp/subject scope. First approval now defaults to
    // the school's active bootcamps, all subjects, students, and groups. Newer
    // clients send "custom" after presenting that recommended setup for review.
    const accessMode = cleanStr(body.accessMode, 20).toLowerCase();
    const useRecommendedAccess = firstApproval && accessMode !== "custom";
    const accessInput = useRecommendedAccess ?
      buildRecommendedEducatorAccess(plan) :
      (isObject(body.access) ? body.access : targetRow.access);

    const normalizedAccess = normalizeAccess(
        accessInput,
        targetRow.access,
        activeBootcamp,
        firstApproval && accessMode !== "custom",
    );

    if (newStatus === "approved" && !isActivePlan(plan)) {
      return bad(res, 403, "SCHOOL_PLAN_NOT_ACTIVE", {
        planStatus: cleanStr(plan.status, 40) || "missing",
      });
    }

    if (firstApproval) {
      const limit = Number(plan.educatorSeatLimit || 0);
      const approvedCount = approvedEducatorCount(schoolEducators);

      if (limit > 0 && approvedCount >= limit) {
        return bad(res, 409, "EDUCATOR_SEAT_LIMIT_REACHED", {
          approvedCount,
          educatorSeatLimit: limit,
        });
      }
    }

    const planValidation = validateAccessAgainstPlan(normalizedAccess, plan);
    if (planValidation) {
      return bad(res, 403, planValidation.error, planValidation);
    }

    const schoolNorm = normalizeSchool(schoolId, school);
    const groupValidation = await validateSelectedGroups(
        db,
        schoolId,
        normalizedAccess,
        schoolNorm,
    );
    if (groupValidation) {
      return bad(res, 400, groupValidation.error, groupValidation);
    }

    const studentValidation = await validateSelectedStudents(
        db,
        normalizedAccess,
        schoolNorm,
    );
    if (studentValidation) {
      return bad(res, 400, studentValidation.error, studentValidation);
    }

    const now = new Date().toISOString();
    const before = {
      status: targetRow.status || "pending",
      adminAccess: targetRow.adminAccess === true,
      superAdmin: targetRow.superAdmin === true,
      access: targetRow.access || {},
    };

    const after = {
      status: newStatus,
      adminAccess: newAdminAccess,
      superAdmin: targetRow.superAdmin === true,
      access: normalizedAccess,
    };

    const updates = {};
    const basePath = `schools/${schoolId}/educators/${targetEducatorId}`;

    updates[`${basePath}/status`] = newStatus;
    updates[`${basePath}/adminAccess`] = newAdminAccess;
    updates[`${basePath}/access`] = normalizedAccess;
    updates[`${basePath}/statusUpdatedAt`] = now;
    updates[`educators/${targetEducatorId}/approvalStatus`] = newStatus;

    if (firstApproval) {
      updates[`${basePath}/approvedAt`] = now;
      updates[`${basePath}/approvedBy`] = callerEducatorId;
    }

    const auditRef = db.ref(`schools/${schoolId}/auditLogs`).push();
    updates[`schools/${schoolId}/auditLogs/${auditRef.key}`] = {
      actorEducatorId: callerEducatorId,
      targetEducatorId,
      action: "updateEducatorAccess",
      createdAt: now,
      before,
      after,
    };

    await db.ref().update(updates);

    return res.status(200).json({
      ok: true,
      targetEducatorId,
      status: newStatus,
      adminAccess: newAdminAccess,
      access: normalizedAccess,
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
