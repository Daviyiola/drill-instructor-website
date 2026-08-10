"use strict";

const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");

/**
 * Send a standardized error response.
 * @param {Object} res Express response object
 * @param {number} code HTTP status code
 * @param {string} msg Error message identifier
 * @param {*} [details] Optional error details
 * @return {Object}
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details: details || null});
}

/**
 * Safe error text for unknown throws.
 * @param {unknown} e Any error
 * @return {string}
 */
function errText(e) {
  if (!e) return "Internal error";
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    /** @type {any} */
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
 * Clean preferred role.
 * @param {*} v Input value
 * @return {string}
 */
function cleanPreferredRole(v) {
  const s = (v || "").toString().trim().toLowerCase();
  if (s === "student") return "student";
  if (s === "educator") return "educator";
  if (s === "instructor") return "educator";
  return "";
}

/**
 * Remove fields the client should not cache directly.
 * @param {Object} obj Raw profile object
 * @return {Object}
 */
function stripPrivateFields(obj) {
  const out = Object.assign({}, obj || {});
  delete out.uid;
  return out;
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const callerFbUid = await requireBearerUid(req);
    const authUser = await getAuth().getUser(callerFbUid);
    const emailVerified = authUser.emailVerified === true;
    const body = req.body || {};
    const preferredRole = cleanPreferredRole(body.preferredRole);

    const db = getDatabase();

    // 1) Resolve linked account(s) from trusted UID mapping
    const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
    const uidMap = mapSnap.val() || {};

    const studentCustomId = uidMap.student || "";
    const educatorCustomId = uidMap.educator || "";

    if (!studentCustomId && !educatorCustomId) {
      return bad(res, 404, "ACCOUNT_PROFILE_NOT_FOUND", {
        message: "No student or educator profile is linked to this account.",
      });
    }

    let role = "";
    let customUserId = "";
    let profilePath = "";

    if (preferredRole === "student") {
      if (!studentCustomId) return bad(res, 404, "STUDENT_PROFILE_NOT_FOUND");
      role = "student";
      customUserId = studentCustomId;
      profilePath = `users/${customUserId}`;
    } else if (preferredRole === "educator") {
      if (!educatorCustomId) return bad(res, 404, "EDUCATOR_PROFILE_NOT_FOUND");
      role = "educator";
      customUserId = educatorCustomId;
      profilePath = `educators/${customUserId}`;
    } else if (educatorCustomId) {
      // Shared login page default.
      // If one UID ever has both, educator wins unless client asks otherwise.
      role = "educator";
      customUserId = educatorCustomId;
      profilePath = `educators/${customUserId}`;
    } else {
      role = "student";
      customUserId = studentCustomId;
      profilePath = `users/${customUserId}`;
    }

    // 2) Load profile
    const profSnap = await db.ref(profilePath).once("value");
    const rawProfile = profSnap.val();

    if (!rawProfile) {
      return bad(res, 404, "PROFILE_RECORD_MISSING", {
        role,
        customUserId,
        emailVerified,
        profilePath,
      });
    }

    // 3) Verify profile ownership
    if (rawProfile.uid && rawProfile.uid !== callerFbUid) {
      return bad(res, 403, "PROFILE_UID_MISMATCH");
    }

    const profile = stripPrivateFields(rawProfile);

    // 4) Student response
    if (role === "student") {
      let stats = null;

      if (body.includeStats === true) {
        const statsSnap = await db.ref(
            `users/${customUserId}/stats`).once("value");
        stats = statsSnap.val() || null;
      }

      return res.status(200).json({
        ok: true,
        role: "student",
        customUserId,
        emailVerified,
        profile,
        stats,
        route: "Shared/Bootcamps.qml",
      });
    }

    // 5) Educator response
    const schoolId = rawProfile.schoolID || "";
    let school = {};
    let schoolAccess = {
      status: rawProfile.approvalStatus || "pending",
      role: "educator",
      adminAccess: false,
      superAdmin: false,
    };

    if (schoolId) {
      const schoolSnap = await db.ref(`schools/${schoolId}`).once("value");
      school = schoolSnap.val() || {};

      const accessSnap = await db
          .ref(`schools/${schoolId}/educators/${customUserId}`)
          .once("value");

      const access = accessSnap.val() || {};

      schoolAccess = {
        status: access.status || rawProfile.approvalStatus || "pending",
        role: access.role || "educator",
        adminAccess: access.adminAccess === true,
        superAdmin: access.superAdmin === true,
      };
    }

    const approvalStatus = schoolAccess.status || "pending";

    return res.status(200).json({
      ok: true,
      role: "educator",
      customUserId,
      profile,
      schoolId,
      schoolName: school.name || rawProfile.schoolName || "",
      corpsName: school.country || rawProfile.corpsName || "",
      battalionName: school.state || rawProfile.battalionName || "",
      platoonName: school.name || rawProfile.platoonName || "",
      approvalStatus,
      emailVerified,
      schoolAccess,
      route: approvalStatus === "approved" && emailVerified ?
        "Shared/Bootcamps.qml" :
        "Instructor/PendingApproval.qml",
    });
  } catch (e) {
    const status = Number(e && e.code);
    return res.status(status === 401 ? 401 : status === 403 ? 403 : 500).json({
      ok: false,
      error: status === 401 ? "AUTHENTICATION_REQUIRED" :
        status === 403 ? String(e.message || "PERMISSION_DENIED") : "INTERNAL",
      details: errText(e),
    });
  }
};
