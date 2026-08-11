"use strict";
/* eslint-disable max-len, require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid, requireVerifiedBearerUid} = require("./_auth");
const {
  blockSetsFor,
  challengeAudienceFor,
  cleanStudentId,
  normalizeChallengeAudience,
  studentIdForUid,
} = require("./_socialPolicy");

function rejectNonPost(req, res) {
  if (allowCors(req, res)) return true;
  if (req.method !== "POST") {
    res.status(405).json({error: "METHOD_NOT_ALLOWED"});
    return true;
  }
  return false;
}

function errorResponse(res, error, fallback) {
  const status = Number(error && error.code);
  if (status === 401) return res.status(401).json({error: "AUTHENTICATION_REQUIRED"});
  if (status === 403 && error.message === "EMAIL_VERIFICATION_REQUIRED") {
    return res.status(403).json({error: "EMAIL_VERIFICATION_REQUIRED"});
  }
  console.error(fallback, {message: error && error.message});
  return res.status(500).json({error: fallback});
}

async function resolveCaller(db, firebaseUid) {
  const studentId = await studentIdForUid(db, firebaseUid);
  if (!studentId) {
    const error = new Error("STUDENT_PROFILE_NOT_FOUND");
    error.code = 403;
    throw error;
  }
  return studentId;
}

async function getSettings(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const firebaseUid = await requireBearerUid(req);
    const db = getDatabase();
    const studentId = await resolveCaller(db, firebaseUid);
    const [challengeAudience, sets] = await Promise.all([
      challengeAudienceFor(db, studentId),
      blockSetsFor(db, studentId),
    ]);
    return res.status(200).json({
      ok: true,
      settings: {challengeAudience},
      blockedCount: sets.outgoing.size,
    });
  } catch (error) {
    return errorResponse(res, error, "UNABLE_TO_LOAD_SOCIAL_SETTINGS");
  }
}

async function updateSettings(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const firebaseUid = await requireVerifiedBearerUid(req);
    const db = getDatabase();
    const studentId = await resolveCaller(db, firebaseUid);
    const rawAudience = String(req.body && req.body.challengeAudience || "").trim().toLowerCase();
    const challengeAudience = normalizeChallengeAudience(rawAudience, "");
    if (!challengeAudience) {
      return res.status(400).json({error: "VALID_CHALLENGE_AUDIENCE_REQUIRED"});
    }
    await db.ref(`studentSocial/${studentId}/settings`).update({
      challengeAudience,
      updatedAt: Date.now(),
    });
    return res.status(200).json({ok: true, settings: {challengeAudience}});
  } catch (error) {
    return errorResponse(res, error, "UNABLE_TO_UPDATE_SOCIAL_SETTINGS");
  }
}

async function blockStudent(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const firebaseUid = await requireBearerUid(req);
    const db = getDatabase();
    const studentId = await resolveCaller(db, firebaseUid);
    const blockedId = cleanStudentId(req.body && req.body.studentId);
    if (!blockedId || blockedId === studentId) {
      return res.status(400).json({error: "VALID_STUDENT_REQUIRED"});
    }
    const role = (await db.ref(`roles/${blockedId}`).once("value")).val();
    if (role !== "student") {
      return res.status(404).json({error: "STUDENT_NOT_FOUND"});
    }
    const now = Date.now();
    const updates = {};
    updates[`studentSocial/${studentId}/blocks/${blockedId}`] = {createdAt: now};
    updates[`studentSocialBlockedBy/${blockedId}/${studentId}`] = true;
    updates[`users/${studentId}/squadMembers/${blockedId}`] = null;
    updates[`users/${blockedId}/squadMembers/${studentId}`] = null;
    await db.ref().update(updates);
    return res.status(200).json({ok: true, state: "blocked"});
  } catch (error) {
    return errorResponse(res, error, "UNABLE_TO_BLOCK_STUDENT");
  }
}

async function unblockStudent(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const firebaseUid = await requireBearerUid(req);
    const db = getDatabase();
    const studentId = await resolveCaller(db, firebaseUid);
    const blockedId = cleanStudentId(req.body && req.body.studentId);
    if (!blockedId || blockedId === studentId) {
      return res.status(400).json({error: "VALID_STUDENT_REQUIRED"});
    }
    const updates = {};
    updates[`studentSocial/${studentId}/blocks/${blockedId}`] = null;
    updates[`studentSocialBlockedBy/${blockedId}/${studentId}`] = null;
    await db.ref().update(updates);
    return res.status(200).json({ok: true, state: "unblocked"});
  } catch (error) {
    return errorResponse(res, error, "UNABLE_TO_UNBLOCK_STUDENT");
  }
}

async function getBlockedStudents(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const firebaseUid = await requireBearerUid(req);
    const db = getDatabase();
    const studentId = await resolveCaller(db, firebaseUid);
    const tree = (await db.ref(`studentSocial/${studentId}/blocks`)
        .once("value")).val() || {};
    const ids = Object.keys(tree).slice(0, 100);
    const profiles = await Promise.all(ids.map(async (id) => {
      const value = (await db.ref(`users/${id}`).once("value")).val() || {};
      return {
        id,
        firstName: String(value.firstName || ""),
        lastName: String(value.lastName || ""),
        schoolName: String(value.platoonName || ""),
        blockedAt: Number(tree[id] && tree[id].createdAt || 0),
      };
    }));
    profiles.sort((a, b) => b.blockedAt - a.blockedAt);
    return res.status(200).json({ok: true, blockedStudents: profiles});
  } catch (error) {
    return errorResponse(res, error, "UNABLE_TO_LOAD_BLOCKED_STUDENTS");
  }
}

module.exports = {
  blockStudent,
  getBlockedStudents,
  getSettings,
  unblockStudent,
  updateSettings,
};
