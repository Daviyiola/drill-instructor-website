"use strict";
/* eslint-disable require-jsdoc, max-len */

const {getDatabase} = require("firebase-admin/database");
const {requireVerifiedBearerUid, allowCors} = require("./_auth");
const {cleanName, cleanAvatar} = require("./updateStudentProfileHttps");
const {normalizeUidToEducator} = require("./_schoolAdminAccess");

async function handler(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") {
      return res.status(405).json({error: "METHOD_NOT_ALLOWED"});
    }
    const uid = await requireVerifiedBearerUid(req);
    const db = getDatabase();
    const map = (await db.ref(`uidToCustom/${uid}`).once("value")).val();
    const educatorId = normalizeUidToEducator(map);
    if (!educatorId) {
      return res.status(403).json({error: "EDUCATOR_PROFILE_NOT_FOUND"});
    }
    const ref = db.ref(`educators/${educatorId}`);
    const profile = (await ref.once("value")).val() || {};
    if (profile.uid && profile.uid !== uid) {
      return res.status(403).json({error: "PROFILE_OWNERSHIP_MISMATCH"});
    }
    const firstName = cleanName(req.body && req.body.firstName);
    const lastName = cleanName(req.body && req.body.lastName);
    if (!firstName || !lastName) {
      return res.status(400).json({error: "VALID_NAME_REQUIRED"});
    }
    const avatarNumber = cleanAvatar(req.body && req.body.avatarNumber);
    await ref.update({
      firstName,
      lastName,
      avatarNumber,
      avaterNumber: avatarNumber,
      profileUpdatedAt: Date.now(),
    });
    return res.status(200).json({
      ok: true,
      profile: {
        firstName,
        lastName,
        email: String(profile.email || ""),
        avatarNumber,
        schoolID: String(profile.schoolID || profile.schoolId || ""),
        schoolName: String(profile.schoolName || ""),
        corpsName: String(profile.corpsName || ""),
        battalionName: String(profile.battalionName || ""),
        platoonName: String(profile.platoonName || ""),
      },
    });
  } catch (error) {
    if (Number(error && error.code) === 401) {
      return res.status(401).json({error: "AUTHENTICATION_REQUIRED"});
    }
    if (Number(error && error.code) === 403 && error.message === "EMAIL_VERIFICATION_REQUIRED") {
      return res.status(403).json({error: "EMAIL_VERIFICATION_REQUIRED"});
    }
    return res.status(500).json({error: "UNABLE_TO_UPDATE_PROFILE"});
  }
}

module.exports = handler;
module.exports.handler = handler;
