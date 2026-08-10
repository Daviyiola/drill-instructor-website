"use strict";

const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");

const PROFILE_FIELDS = Object.freeze([
  "firstName",
  "lastName",
  "email",
  "avatarNumber",
  "avaterNumber",
  "currentRank",
  "currentRankNum",
  "points",
  "totalPoints",
  "platoonName",
  "battalionName",
  "corpsName",
  "profilePermissions",
  "platoonPermissions",
  "parentPermissions",
  "schoolID",
  "schoolName",
  "approvalStatus",
]);

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
 * Project only the scalar identity fields used by the app shell and profile.
 * Database branches such as stats, testdata, challenges and assignments are
 * deliberately absent and are served by their dedicated endpoints.
 * @param {Object} obj Raw profile object
 * @return {Object}
 */
function publicProfile(obj) {
  const source = obj && typeof obj === "object" ? obj : {};
  const out = {};
  PROFILE_FIELDS.forEach((field) => {
    const value = source[field];
    if (["string", "number", "boolean"].includes(typeof value)) {
      out[field] = value;
    }
  });
  return out;
}

/**
 * Return the safe entitlement fields consumed by native sign-in caching.
 * The raw code and license signature never leave the server.
 *
 * @param {Object} license Stored license
 * @param {boolean} active Whether signature and expiry validation passed
 * @return {Object}
 */
function publicEntitlement(license, active) {
  const value = license && typeof license === "object" ? license : {};
  return {
    hasActiveLicense: active === true,
    plan: String(value.planType || ""),
    activationDate: String(value.activationDate || ""),
    expirationDate: String(value.expirationDate || ""),
    source: String(value.source || "access_code"),
  };
}

/**
 * Validate and project each bootcamp license stored on a student profile.
 *
 * @param {Object} db Admin database
 * @param {string} studentId Custom student id
 * @param {Object} rawProfile Stored student profile
 * @return {Promise<Object>}
 */
async function studentEntitlements(db, studentId, rawProfile) {
  const testdata = rawProfile && rawProfile.testdata &&
    typeof rawProfile.testdata === "object" ? rawProfile.testdata : {};
  const entitlements = {};

  for (const [rawBootcamp, row] of Object.entries(testdata)) {
    const bootcamp = String(rawBootcamp || "").trim().toLowerCase();
    const license = row && typeof row === "object" && row.license &&
      typeof row.license === "object" ? row.license : null;
    if (!license || !/^[a-z0-9_-]{2,40}$/.test(bootcamp)) continue;

    let active = false;
    try {
      await assertLicenseActive(db, studentId, bootcamp);
      active = true;
    } catch (error) {
      const status = Number(error && error.code);
      if (![400, 403, 409].includes(status)) throw error;
    }
    entitlements[bootcamp] = publicEntitlement(license, active);
  }
  return entitlements;
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

    const profile = publicProfile(rawProfile);

    // 4) Student response
    if (role === "student") {
      const entitlements = await studentEntitlements(
          db,
          customUserId,
          rawProfile,
      );

      return res.status(200).json({
        ok: true,
        role: "student",
        customUserId,
        emailVerified,
        profile,
        entitlements,
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

exports.publicProfile = publicProfile;
exports.publicEntitlement = publicEntitlement;
exports.studentEntitlements = studentEntitlements;
