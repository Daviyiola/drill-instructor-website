"use strict";

const {getDatabase} = require("firebase-admin/database");
const {getAuth} = require("firebase-admin/auth");
const {requireBearerUid, allowCors} = require("./_auth");

/**
 * Send standardized error response.
 *
 * @param {Object} res Express response
 * @param {number} code HTTP status
 * @param {string} msg Error code
 * @param {*} [details] Optional details
 * @return {Object}
 */
function bad(res, code, msg, details) {
  return res.status(code).json({
    ok: false,
    error: msg,
    details: details || null,
  });
}

/**
 * Safe error text.
 *
 * @param {unknown} e Error
 * @return {string}
 */
function errText(e) {
  if (!e) return "Internal error";
  if (typeof e === "string") return e;

  if (typeof e === "object") {
    const anyErr = e;
    if (typeof anyErr.message === "string" && anyErr.message) {
      return anyErr.message;
    }
  }

  try {
    return JSON.stringify(e);
  } catch (_) {
    return String(e);
  }
}

/**
 * Clean custom user id.
 *
 * @param {*} v Input
 * @return {string}
 */
function cleanCustomId(v) {
  const s = (v || "").toString().trim();
  if (!/^user_[a-z0-9_]{5,95}$/.test(s)) return "";
  return s;
}

/**
 * Clean a Stripe Customer id before using it in an RTDB path.
 *
 * @param {*} v Input
 * @return {string}
 */
function cleanStripeCustomerId(v) {
  const value = String(v || "").trim();
  return /^cus_[A-Za-z0-9]{8,180}$/.test(value) ? value : "";
}

/**
 * Return the external unit-membership path for a student profile.
 *
 * @param {Object} profile Student profile
 * @param {string} studentId Custom student id
 * @return {string} Membership path or empty string
 */
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

/**
 * Delete an educator from their school listing if possible.
 *
 * @param {Object} db RTDB
 * @param {string} educatorId Educator custom id
 * @return {Promise<void>}
 */
async function removeEducatorSchoolListing(db, educatorId) {
  const eduSnap = await db.ref(`educators/${educatorId}`).once("value");
  const edu = eduSnap.val() || {};
  const schoolId = (edu.schoolID || edu.schoolId || "").toString().trim();

  if (!schoolId) return;

  await db.ref(`schools/${schoolId}/educators/${educatorId}`).remove();
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    // Use server-trusted mapping. Do not trust client customUserId.
    const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
    const uidMap = mapSnap.val() || {};

    const studentId = cleanCustomId(uidMap.student);
    const educatorId = cleanCustomId(uidMap.educator);

    if (!studentId && !educatorId) {
      return bad(res, 404, "ACCOUNT_PROFILE_NOT_FOUND");
    }

    // Optional extra confirmation from client.
    // In QML, send { confirmText: "DELETE" }.
    const body = req.body || {};
    if ((body.confirmText || "").toString().trim().toUpperCase() !== "DELETE") {
      return bad(res, 400, "CONFIRMATION_REQUIRED");
    }

    if (educatorId) {
      const educator = (await db.ref(`educators/${educatorId}`)
          .once("value")).val() || {};
      const schoolId = String(educator.schoolID || educator.schoolId || "")
          .trim();
      if (schoolId) {
        const rows = (await db.ref(`schools/${schoolId}/educators`)
            .once("value")).val() || {};
        const current = rows[educatorId] || {};
        if (current.superAdmin === true) {
          const anotherSuperAdmin = Object.keys(rows).some((id) => {
            const row = rows[id] || {};
            return id !== educatorId && row.status === "approved" &&
              row.superAdmin === true;
          });
          if (!anotherSuperAdmin) {
            return bad(res, 409, "SOLE_SUPER_ADMIN_CANNOT_DELETE");
          }
        }
      }
    }

    // 1) Educator school listing
    // must be removed before deleting educator profile,
    // because the schoolID lives on educators/{educatorId}.
    if (educatorId) {
      await removeEducatorSchoolListing(db, educatorId);
    }

    // 2) Main RTDB fan-out deletion.
    const updates = {};

    if (studentId) {
      const [studentSnap, stripeCustomerSnap] = await Promise.all([
        db.ref(`users/${studentId}`).once("value"),
        db.ref(`stripeCustomers/${studentId}`).once("value"),
      ]);
      const student = studentSnap.val() || {};
      const stripeCustomer = stripeCustomerSnap.val() || {};
      const stripeCustomerId = cleanStripeCustomerId(
          stripeCustomer.customerId,
      );
      const membershipPath = studentMembershipPath(student, studentId);
      if (membershipPath) updates[membershipPath] = null;

      updates[`users/${studentId}`] = null;
      updates[`roles/${studentId}`] = null;
      updates[`studentDrills/${studentId}`] = null;
      updates[`subscriptionEvents/${studentId}`] = null;
      updates[`stripeCustomers/${studentId}`] = null;
      if (stripeCustomerId) {
        updates[`stripeCustomerIndex/${stripeCustomerId}`] = null;
      }
    }

    if (educatorId) {
      updates[`educators/${educatorId}`] = null;
      updates[`roles/${educatorId}`] = null;

      // Add more educator fan-out paths here if you have them.
      // Example:
      // updates[`educatorIndexes/${educatorId}`] = null;
    }

    updates[`uidToCustom/${callerFbUid}`] = null;
    updates[`rateLimits/searchUsersByPrefix/${callerFbUid}`] = null;
    updates[`rateLimits/listSchools/${callerFbUid}`] = null;
    updates[`rateLimits/joinUnit/${callerFbUid}`] = null;
    updates[`rateLimits/addSquadMember/${callerFbUid}`] = null;
    updates[`rateLimits/getSquadProfiles/${callerFbUid}`] = null;

    await db.ref().update(updates);

    // 3) Delete Firebase Auth user last.
    // If this succeeds, this account can no longer sign in.
    await getAuth().deleteUser(callerFbUid);

    return res.status(200).json({
      ok: true,
      deletedAuthUid: callerFbUid,
      deletedStudentId: studentId || "",
      deletedEducatorId: educatorId || "",
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      details: errText(e),
    });
  }
};

module.exports.studentMembershipPath = studentMembershipPath;
