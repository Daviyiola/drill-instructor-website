"use strict";
/* eslint-disable require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {getAuth} = require("firebase-admin/auth");
const {requireBearerUid, allowCors} = require("./_auth");

class AccountDeletionError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function bad(res, code, msg, details) {
  return res.status(code).json({
    ok: false,
    error: msg,
    details: details || null,
  });
}

function errText(error) {
  if (!error) return "Internal error";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && error.message) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error);
  }
}

function cleanCustomId(value) {
  const normalized = String(value || "").trim();
  return /^user_[a-z0-9_]{5,95}$/.test(normalized) ? normalized : "";
}

function cleanStripeCustomerId(value) {
  const normalized = String(value || "").trim();
  return /^cus_[A-Za-z0-9]{8,180}$/.test(normalized) ? normalized : "";
}

function studentMembershipPath(profile, studentId) {
  const value = profile && typeof profile === "object" ? profile : {};
  const parts = [
    value.corpsName,
    value.battalionName,
    value.platoonName,
  ].map((part) => String(part || "").trim());
  if (!parts[0] || parts.some((part) => /[.#$[\]/]/.test(part))) return "";
  let path = `units/corps/${parts[0]}`;
  if (parts[1]) path += `/${parts[1]}`;
  if (parts[2]) path += `/${parts[2]}`;
  return `${path}/members/${studentId}`;
}

async function removeEducatorSchoolListing(db, educatorId) {
  const educator = (await db.ref(`educators/${educatorId}`)
      .once("value")).val() || {};
  const schoolId = String(educator.schoolID || educator.schoolId || "").trim();
  if (schoolId) {
    await db.ref(`schools/${schoolId}/educators/${educatorId}`).remove();
  }
}

async function assertEducatorCanDelete(db, educatorId) {
  const educator = (await db.ref(`educators/${educatorId}`)
      .once("value")).val() || {};
  const schoolId = String(educator.schoolID || educator.schoolId || "").trim();
  if (!schoolId) return;

  const rows = (await db.ref(`schools/${schoolId}/educators`)
      .once("value")).val() || {};
  const current = rows[educatorId] || {};
  if (current.superAdmin !== true) return;

  const anotherSuperAdmin = Object.keys(rows).some((id) => {
    const row = rows[id] || {};
    return id !== educatorId && row.status === "approved" &&
      row.superAdmin === true;
  });
  if (!anotherSuperAdmin) {
    throw new AccountDeletionError(409, "SOLE_SUPER_ADMIN_CANNOT_DELETE");
  }
}

/**
 * Canonical account deletion used by both authenticated and email-confirmed
 * deletion flows.
 * @param {string} callerFbUid Firebase Auth UID
 * @return {Promise<Object>} Deleted identifiers
 */
async function deleteAccountByUid(callerFbUid) {
  const db = getDatabase();
  const uidMap = (await db.ref(`uidToCustom/${callerFbUid}`)
      .once("value")).val() || {};
  const studentId = cleanCustomId(uidMap.student);
  const educatorId = cleanCustomId(uidMap.educator);

  if (!studentId && !educatorId) {
    throw new AccountDeletionError(404, "ACCOUNT_PROFILE_NOT_FOUND");
  }
  if (educatorId) await assertEducatorCanDelete(db, educatorId);
  if (educatorId) await removeEducatorSchoolListing(db, educatorId);

  const updates = {};
  if (studentId) {
    const [studentSnap, stripeCustomerSnap, blocksSnap, blockedBySnap] =
      await Promise.all([
        db.ref(`users/${studentId}`).once("value"),
        db.ref(`stripeCustomers/${studentId}`).once("value"),
        db.ref(`studentSocial/${studentId}/blocks`).once("value"),
        db.ref(`studentSocialBlockedBy/${studentId}`).once("value"),
      ]);
    const student = studentSnap.val() || {};
    const stripeCustomer = stripeCustomerSnap.val() || {};
    const stripeCustomerId = cleanStripeCustomerId(stripeCustomer.customerId);
    const membershipPath = studentMembershipPath(student, studentId);
    if (membershipPath) updates[membershipPath] = null;

    updates[`users/${studentId}`] = null;
    updates[`roles/${studentId}`] = null;
    updates[`studentDrills/${studentId}`] = null;
    updates[`subscriptionEvents/${studentId}`] = null;
    updates[`stripeCustomers/${studentId}`] = null;
    updates[`studentSocial/${studentId}`] = null;
    updates[`studentSocialBlockedBy/${studentId}`] = null;
    Object.keys(blocksSnap.val() || {}).forEach((blockedId) => {
      updates[`studentSocialBlockedBy/${blockedId}/${studentId}`] = null;
    });
    Object.keys(blockedBySnap.val() || {}).forEach((blockerId) => {
      updates[`studentSocial/${blockerId}/blocks/${studentId}`] = null;
    });
    if (stripeCustomerId) {
      updates[`stripeCustomerIndex/${stripeCustomerId}`] = null;
    }
  }

  if (educatorId) {
    updates[`educators/${educatorId}`] = null;
    updates[`roles/${educatorId}`] = null;
  }

  updates[`uidToCustom/${callerFbUid}`] = null;
  updates[`rateLimits/searchUsersByPrefix/${callerFbUid}`] = null;
  updates[`rateLimits/listSchools/${callerFbUid}`] = null;
  updates[`rateLimits/joinUnit/${callerFbUid}`] = null;
  updates[`rateLimits/addSquadMember/${callerFbUid}`] = null;
  updates[`rateLimits/getSquadProfiles/${callerFbUid}`] = null;

  await db.ref().update(updates);
  await getAuth().deleteUser(callerFbUid);
  return {
    deletedAuthUid: callerFbUid,
    deletedStudentId: studentId || "",
    deletedEducatorId: educatorId || "",
  };
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");

  try {
    const callerFbUid = await requireBearerUid(req);
    const confirmText = String(req.body && req.body.confirmText || "")
        .trim().toUpperCase();
    if (confirmText !== "DELETE") {
      return bad(res, 400, "CONFIRMATION_REQUIRED");
    }
    const deleted = await deleteAccountByUid(callerFbUid);
    return res.status(200).json({ok: true, ...deleted});
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      return bad(res, error.status, error.code);
    }
    return bad(res, 500, "INTERNAL", errText(error));
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports.AccountDeletionError = AccountDeletionError;
module.exports.deleteAccountByUid = deleteAccountByUid;
module.exports.studentMembershipPath = studentMembershipPath;
