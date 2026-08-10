"use strict";
/* eslint-disable max-len */

const {getDatabase} = require("firebase-admin/database");
const {requireVerifiedBearerUid, allowCors} = require("./_auth");

/**
 * Normalize a human name without accepting control characters or markup.
 *
 * @param {*} value Candidate name
 * @return {string} Safe name
 */
function cleanName(value) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  const hasControl = [...text].some((character) =>
    character.charCodeAt(0) < 32,
  );
  if (!text || text.length > 60 || /[<>{}]/.test(text) || hasControl) {
    return "";
  }
  return text;
}

/**
 * Validate an avatar number supported by both current clients.
 *
 * @param {*} value Candidate avatar
 * @return {number} Avatar number
 */
function cleanAvatar(value) {
  const avatar = Number(value);
  return Number.isInteger(avatar) && avatar >= 1 && avatar <= 14 ? avatar : 1;
}

/**
 * Return only the student profile fields exposed to the profile editor.
 *
 * @param {Object} profile Stored student profile
 * @return {Object} Public editable profile
 */
function editableProfile(profile) {
  const value = profile && typeof profile === "object" ? profile : {};
  return {
    firstName: String(value.firstName || ""),
    lastName: String(value.lastName || ""),
    avatarNumber: cleanAvatar(value.avatarNumber || value.avaterNumber || 1),
    profilePermissions: value.profilePermissions === true,
    platoonPermissions: value.platoonPermissions === true,
    corpsName: String(value.corpsName || ""),
    battalionName: String(value.battalionName || ""),
    platoonName: String(value.platoonName || ""),
  };
}

/**
 * Update owner-controlled student identity and privacy fields.
 *
 * Unit membership is intentionally handled by joinUnitHttps so the profile
 * labels and membership indexes cannot diverge.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({error: "METHOD_NOT_ALLOWED"});
    }

    const firebaseUid = await requireVerifiedBearerUid(req);
    const db = getDatabase();
    const mapping = (await db.ref(`uidToCustom/${firebaseUid}`)
        .once("value")).val() || {};
    const studentId = String(
        typeof mapping === "string" ? mapping : mapping.student || "",
    ).trim();

    // The uidToCustom mapping is server-owned and is the authority here. Keep
    // accepting the earlier opaque `pk_...` ids while new accounts use
    // `user_...`; neither form is supplied by the request body.
    if (!/^[A-Za-z0-9_-]{5,160}$/.test(studentId)) {
      return res.status(403).json({error: "STUDENT_PROFILE_NOT_FOUND"});
    }

    const profileRef = db.ref(`users/${studentId}`);
    const profile = (await profileRef.once("value")).val();
    if (!profile || profile.uid !== firebaseUid) {
      return res.status(403).json({error: "PROFILE_OWNERSHIP_MISMATCH"});
    }

    const body = req.body || {};
    const firstName = cleanName(body.firstName);
    const lastName = cleanName(body.lastName);
    if (!firstName || !lastName) {
      return res.status(400).json({error: "VALID_NAME_REQUIRED"});
    }
    if (
      typeof body.profilePermissions !== "boolean" ||
      typeof body.platoonPermissions !== "boolean"
    ) {
      return res.status(400).json({error: "VALID_PERMISSIONS_REQUIRED"});
    }

    const avatarNumber = cleanAvatar(body.avatarNumber);
    await profileRef.update({
      firstName,
      lastName,
      avatarNumber,
      avaterNumber: avatarNumber,
      profilePermissions: body.profilePermissions,
      platoonPermissions: body.platoonPermissions,
      profileUpdatedAt: Date.now(),
    });

    const updated = {
      ...profile,
      firstName,
      lastName,
      avatarNumber,
      avaterNumber: avatarNumber,
      profilePermissions: body.profilePermissions,
      platoonPermissions: body.platoonPermissions,
    };
    return res.status(200).json({
      ok: true,
      profile: editableProfile(updated),
    });
  } catch (error) {
    if (Number(error && error.code) === 403 && error.message === "EMAIL_VERIFICATION_REQUIRED") {
      return res.status(403).json({error: "EMAIL_VERIFICATION_REQUIRED"});
    }
    const status = Number(error && error.code);
    if (status === 401) {
      return res.status(401).json({error: "AUTHENTICATION_REQUIRED"});
    }
    console.error("STUDENT_PROFILE_UPDATE_FAILED", {
      message: error && error.message || "Unknown error",
    });
    return res.status(500).json({error: "UNABLE_TO_UPDATE_PROFILE"});
  }
}

module.exports = handler;
module.exports.handler = handler;
module.exports.cleanName = cleanName;
module.exports.cleanAvatar = cleanAvatar;
module.exports.editableProfile = editableProfile;
