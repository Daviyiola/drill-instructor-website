// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {getAuth} = require("firebase-admin/auth");
const {requireBearerUid, allowCors} = require("./_auth");

/** @typedef {import("firebase-admin").database.Database} Database */
/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */

/**
 * Minimal educator profile used by this handler.
 * @typedef {Object} EducatorProfile
 * @property {string} [uid]
 * @property {string} [approvalStatus]
 * @property {string} [schoolID]
 * @property {string} [schoolName]
 * @property {string} [firstName]
 * @property {string} [lastName]
 * @property {string} [email]
 * @property {string} [platoonName]
 * @property {string} [battalionName]
 * @property {string} [corpsName]
 */

/**
 * Send a standardized JSON error response.
 * @param {Response} res
 * @param {number} code
 * @param {string} msg
 * @param {unknown} [details]
 * @return {Response}
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details});
}

/**
 * Look up an educator custom ID using a Firebase UID.
 * @param {Database} db
 * @param {string} firebaseUid
 * @return {Promise<{educatorId: string, profile: EducatorProfile}|null>}
 */
async function getEducatorByFirebaseUid(db, firebaseUid) {
  const snap = await db
      .ref("educators")
      .orderByChild("uid")
      .equalTo(firebaseUid)
      .limitToFirst(1)
      .once("value");

  const val = snap.val() || {};
  const keys = Object.keys(val);

  if (!keys.length) return null;

  const educatorId = keys[0];

  return {
    educatorId,
    profile: val[educatorId] || {},
  };
}

/**
 * HTTPS handler to check an educator's approval status.
 *
 * Request body:
 *   {}
 *
 * Response (200):
 *   {
 *     ok: true,
 *     educatorId: string,
 *     approvalStatus: "pending" | "approved" | "rejected",
 *     schoolId: string,
 *     schoolName: string,
 *     route: string
 *   }
 *
 * @param {Request} req
 * @param {Response} res
 * @return {Promise<Response|void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") return bad(res, 405, "Method not allowed");

    const fbUid = await requireBearerUid(req);
    const authUser = await getAuth().getUser(fbUid);
    const emailVerified = authUser.emailVerified === true;

    /** @type {Database} */
    const db = getDatabase();

    const found = await getEducatorByFirebaseUid(db, fbUid);
    if (!found) return bad(res, 404, "EDUCATOR_PROFILE_NOT_FOUND");

    const educatorId = found.educatorId;
    const profile = found.profile || {};

    if (profile.uid !== fbUid) {
      return bad(res, 403, "PROFILE_UID_MISMATCH");
    }

    let approvalStatus =
      typeof profile.approvalStatus === "string" && profile.approvalStatus ?
        profile.approvalStatus :
        "pending";

    const schoolId =
      typeof profile.schoolID === "string" ? profile.schoolID : "";

    const schoolName =
      typeof profile.schoolName === "string" ? profile.schoolName : "";

    // The school-side access row is authoritative when present. This keeps
    // status checks aligned with workspace authorization even if a profile
    // mirror is temporarily stale.
    if (schoolId) {
      const access = (await db.ref(
          `schools/${schoolId}/educators/${educatorId}`,
      ).once("value")).val() || {};
      if (typeof access.status === "string" && access.status) {
        approvalStatus = access.status;
      }
    }

    let route = "Instructor/PendingApproval.qml";

    if (approvalStatus === "approved" && emailVerified) {
      route = "Shared/Bootcamps.qml";
    }

    return res.status(200).json({
      ok: true,
      educatorId,
      customUserId: educatorId,
      approvalStatus,
      emailVerified,
      accessReady: approvalStatus === "approved" && emailVerified,
      schoolId,
      schoolName,
      route,
      profile: {
        firstName: profile.firstName || "",
        lastName: profile.lastName || "",
        email: profile.email || "",
        schoolID: schoolId,
        schoolName,
        approvalStatus,
        platoonName: profile.platoonName || "",
        battalionName: profile.battalionName || "",
        corpsName: profile.corpsName || "",
      },
    });
  } catch (e) {
    /** @type {{ code?: unknown, message?: unknown }} */
    const maybe = typeof e === "object" && e !== null ? e : {};

    const code = Number.isInteger(maybe.code) ?
      /** @type {number} */ (maybe.code) :
      500;

    const msg =
      typeof maybe.message === "string" ?
        maybe.message :
        e instanceof Error ?
          e.message :
          "Internal error";

    return res.status(code).json({error: msg});
  }
};
