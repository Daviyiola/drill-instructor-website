"use strict";
/* eslint-disable require-jsdoc */

const CHALLENGE_AUDIENCES = new Set(["anyone", "squad_only", "nobody"]);
const LEGACY_DEFAULT_AUDIENCE = "anyone";
const NEW_ACCOUNT_DEFAULT_AUDIENCE = "squad_only";

function cleanStudentId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{5,160}$/.test(id) ? id : "";
}

function normalizeChallengeAudience(value, fallback = LEGACY_DEFAULT_AUDIENCE) {
  const audience = String(value || "").trim().toLowerCase();
  return CHALLENGE_AUDIENCES.has(audience) ? audience : fallback;
}

async function studentIdForUid(db, firebaseUid) {
  const mapping = (await db.ref(`uidToCustom/${firebaseUid}`)
      .once("value")).val() || {};
  const candidate = typeof mapping === "string" ? mapping : mapping.student;
  return cleanStudentId(candidate);
}

async function challengeAudienceFor(db, studentId) {
  const value = (await db.ref(
      `studentSocial/${studentId}/settings/challengeAudience`,
  ).once("value")).val();
  return normalizeChallengeAudience(value);
}

async function blockRelationship(db, firstId, secondId) {
  const [firstBlocksSecond, secondBlocksFirst] = await Promise.all([
    db.ref(`studentSocial/${firstId}/blocks/${secondId}`).once("value"),
    db.ref(`studentSocial/${secondId}/blocks/${firstId}`).once("value"),
  ]);
  return {
    blocked: firstBlocksSecond.exists() || secondBlocksFirst.exists(),
    firstBlocksSecond: firstBlocksSecond.exists(),
    secondBlocksFirst: secondBlocksFirst.exists(),
  };
}

async function blockSetsFor(db, studentId) {
  const [outgoingSnap, incomingSnap] = await Promise.all([
    db.ref(`studentSocial/${studentId}/blocks`).once("value"),
    db.ref(`studentSocialBlockedBy/${studentId}`).once("value"),
  ]);
  return {
    outgoing: new Set(Object.keys(outgoingSnap.val() || {})),
    incoming: new Set(Object.keys(incomingSnap.val() || {})),
  };
}

function isBlockedBySets(sets, otherId) {
  return sets.outgoing.has(otherId) || sets.incoming.has(otherId);
}

async function canSendChallenge(db, senderId, recipientId) {
  if (!cleanStudentId(senderId) || !cleanStudentId(recipientId) ||
      senderId === recipientId) {
    return {allowed: false, reason: "unavailable"};
  }
  const relationship = await blockRelationship(db, senderId, recipientId);
  if (relationship.blocked) {
    return {allowed: false, reason: "unavailable"};
  }
  const audience = await challengeAudienceFor(db, recipientId);
  if (audience === "nobody") {
    return {allowed: false, reason: "unavailable"};
  }
  if (audience === "squad_only") {
    const recipientAddedSender = (await db.ref(
        `users/${recipientId}/squadMembers/${senderId}`,
    ).once("value")).val() === true;
    if (!recipientAddedSender) {
      return {allowed: false, reason: "unavailable"};
    }
  }
  return {allowed: true, reason: "allowed"};
}

module.exports = {
  CHALLENGE_AUDIENCES,
  LEGACY_DEFAULT_AUDIENCE,
  NEW_ACCOUNT_DEFAULT_AUDIENCE,
  blockRelationship,
  blockSetsFor,
  canSendChallenge,
  challengeAudienceFor,
  cleanStudentId,
  isBlockedBySets,
  normalizeChallengeAudience,
  studentIdForUid,
};

