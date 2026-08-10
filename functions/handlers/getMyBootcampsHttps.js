"use strict";

const {getDatabase, ServerValue} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {
  preferencePath,
  resolveBootcampAccount,
  visibleBootcamps,
} = require("./_bootcampVisibility");
const {readStreakSummaries} = require("./_streaks");

const STUDENT_PROFILE_FIELDS = [
  "uid",
  "firstName",
  "lastName",
  "email",
  "avatarNumber",
  "avaterNumber",
  "currentRank",
  "points",
  "totalPoints",
  "platoonName",
  "battalionName",
  "corpsName",
  "profilePermissions",
  "platoonPermissions",
];

/**
 * Read only navigation/profile fields instead of the complete user subtree.
 * The latter also contains result data and becomes progressively more costly.
 *
 * @param {Object} db Firebase database
 * @param {string} studentId Student custom id
 * @param {string} callerUid Authenticated Firebase uid
 * @return {Promise<Object>} Client-safe profile projection
 */
async function readStudentProfile(db, studentId, callerUid) {
  const values = await Promise.all(STUDENT_PROFILE_FIELDS.map(async (field) =>
    (await db.ref(`users/${studentId}/${field}`).once("value")).val(),
  ));
  const profile = {};
  STUDENT_PROFILE_FIELDS.forEach((field, index) => {
    if (values[index] !== null && values[index] !== undefined) {
      profile[field] = values[index];
    }
  });
  if (profile.uid && profile.uid !== callerUid) {
    const err = new Error("Profile ownership could not be verified");
    err.code = 403;
    throw err;
  }
  delete profile.uid;
  return profile;
}

/**
 * Return and, on first use, initialize the caller's visible bootcamp list.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({error: "Method not allowed"});
    }

    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const account = await resolveBootcampAccount(db, uid);
    const ref = db.ref(preferencePath(account));

    const result = await ref.transaction((current) => {
      if (current && current.initialized === true) return current;
      const seed = {};
      account.entitled.forEach((id) => {
        seed[id] = true;
      });
      return {
        initialized: true,
        visible: seed,
        updatedAt: ServerValue.TIMESTAMP,
      };
    });

    const preference = result.snapshot.val() || {};
    const [profile, streaks] = account.role === "student" ?
      await Promise.all([
        readStudentProfile(db, account.customUserId, uid),
        readStreakSummaries(
            db,
            account.customUserId,
            account.available,
        ),
      ]) : [null, {}];
    const accountResponse = account.role === "student" ? {
      ok: true,
      role: "student",
      customUserId: account.customUserId,
      profile,
      route: "Shared/Bootcamps.qml",
    } : null;
    return res.status(200).json({
      ok: true,
      role: account.role,
      initialized: preference.initialized === true,
      visibleBootcamps: visibleBootcamps(preference.visible),
      availableBootcamps: account.available,
      entitledBootcamps: account.entitled,
      streaks,
      account: accountResponse,
    });
  } catch (err) {
    const code = Number(err && err.code);
    if (code === 401 || String(err && err.code || "").startsWith("auth/")) {
      return res.status(401).json({error: "Authentication failed"});
    }
    if ([403, 404, 409].includes(code)) {
      return res.status(code).json({error: err.message});
    }
    console.error("GET_MY_BOOTCAMPS_FAILED", {
      message: err && err.message || "Unknown error",
    });
    return res.status(500).json({error: "Unable to load bootcamps"});
  }
}

module.exports = handler;
module.exports.handler = handler;
