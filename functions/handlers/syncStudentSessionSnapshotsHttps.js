"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {bad, cleanStr, errText} = require("./_schoolAdminAccess");
const {projectAttempt, resolveAssignmentRelease} = require("./_analytics");

/**
 * Convert date-ish value to milliseconds.
 *
 * @param {*} v Date-ish value
 * @return {number} Milliseconds or 0
 */
function dateMs(v) {
  if (!v) return 0;

  if (typeof v === "number") {
    return v < 1000000000000 ? v * 1000 : v;
  }

  const parsed = Date.parse(String(v));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Resolve signed-in Firebase UID to student custom id.
 *
 * Supports both uidToCustom string values and object values.
 *
 * @param {Object} db RTDB instance
 * @param {string} callerFbUid Firebase Auth UID
 * @return {Promise<Object>} Student context or error object
 */
async function readStudentContext(db, callerFbUid) {
  const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
  const mapVal = mapSnap.val();

  let studentId = "";

  if (typeof mapVal === "string") {
    studentId = cleanStr(mapVal, 120);
  } else if (mapVal && typeof mapVal === "object") {
    studentId = cleanStr(mapVal.student, 120);
  }

  if (!studentId) {
    return {error: "NOT_A_STUDENT"};
  }

  const userSnap = await db.ref(`users/${studentId}`).once("value");
  const user = userSnap.val() || {};

  if (!user || typeof user !== "object") {
    return {error: "STUDENT_NOT_FOUND"};
  }

  return {studentId, user};
}

/**
 * Return true when a canonical analytics attempt belongs in the requested
 * bootcamp/time window.
 *
 * @param {Object} attempt Canonical attempt object
 * @param {string} bootcamp Bootcamp id
 * @param {number} startMs Start time
 * @param {number} endMs End time
 * @return {boolean}
 */
function attemptMatches(attempt, bootcamp, startMs, endMs) {
  if (!attempt || typeof attempt !== "object") return false;

  const attemptBootcamp = cleanStr(attempt.bootcamp, 40)
      .toLowerCase();

  if (bootcamp && attemptBootcamp && attemptBootcamp !== bootcamp) return false;

  const takenMs = dateMs(attempt.submittedAt);

  if (startMs > 0 && takenMs > 0 && takenMs < startMs) return false;
  if (endMs > 0 && takenMs > 0 && takenMs > endMs) return false;

  return true;
}

/**
 * Build a compact, answer-free local snapshot from one canonical attempt.
 * Full question/correction payloads remain behind getStudentDrillResultHttps.
 *
 * @param {Object} rawAttempt Canonical analytics attempt
 * @return {Object} Test-record-compatible compact snapshot
 */
function compactSnapshotFromAttempt(rawAttempt) {
  const attempt = projectAttempt(rawAttempt);
  const activity = attempt.activity || {};
  const performance = attempt.performance || {};
  const isAssignment = attempt.source === "assignment";
  const release = isAssignment ?
    resolveAssignmentRelease(attempt.release, attempt.dueAt || null) : null;
  const scoreVisible = attempt.scoreVisible === true;
  const submittedAt = String(attempt.submittedAt || "");

  return {
    sessionId: String(attempt.attemptId || ""),
    bootcamp: String(attempt.bootcamp || "").toLowerCase(),
    source: String(attempt.source || "solo"),
    sourceId: String(attempt.sourceId || ""),
    createdAt: submittedAt,
    updatedAt: submittedAt,
    takenAt: submittedAt,
    summary: {
      totalQ: Number(activity.totalQuestions || 0),
      attempted: Number(activity.attempted || 0),
      correct: scoreVisible ? Number(performance.correct || 0) : 0,
      wrong: scoreVisible ? Number(performance.wrong || 0) : 0,
      unanswered: scoreVisible ? Number(performance.unanswered || 0) : 0,
      usedSec: Number(activity.elapsedTimeSec || 0),
      points: scoreVisible ? Number(performance.points || 0) : 0,
    },
    subjects: Array.isArray(attempt.subjects) ? attempt.subjects : [],
    modules: Array.isArray(attempt.modules) ? attempt.modules : [],
    answers: [],
    ...(isAssignment ? {
      assignmentMeta: {
        type: "educator_drill",
        dueAt: String(attempt.dueAt || ""),
        showScoreImmediately: scoreVisible,
        showCorrectionsImmediately: Boolean(
            release && release.correctionsReleased),
      },
    } : {}),
  };
}

/**
 * Build local-cache-compatible row.
 *
 * @param {string} sessionId Session id
 * @param {Object} snap Snapshot
 * @return {Object}
 */
function buildSnapshotRow(sessionId, snap) {
  const sid = cleanStr(snap.sessionId || sessionId, 180);

  return {
    session_id: sid,
    json: JSON.stringify(snap),
    created_at: cleanStr(
        snap.createdAt || snap.takenAt || snap.updatedAt || "",
        80,
    ),
  };
}

/**
 * Read compact canonical test-record snapshots for one student.
 *
 * @param {Object} db RTDB instance
 * @param {string} studentId Student id
 * @param {string} bootcamp Bootcamp id
 * @param {number} startMs Start time
 * @param {number} endMs End time
 * @return {Promise<Object[]>}
 */
async function readStudentSnapshots(db, studentId, bootcamp, startMs, endMs) {
  const snap = await db.ref(`users/${studentId}/statsIndex`)
      .orderByChild("bootcampSubmittedAt")
      .startAt(`${bootcamp}|`)
      .endAt(`${bootcamp}|\uf8ff`)
      // This endpoint feeds a device cache. Keep sign-in and record refreshes
      // bounded; opening a record fetches its complete immutable result.
      .limitToLast(100)
      .once("value");
  const attempts = snap.val() || {};
  const rows = [];

  if (attempts && typeof attempts === "object") {
    for (const attemptId of Object.keys(attempts)) {
      const attempt = attempts[attemptId];
      if (!attemptMatches(attempt, bootcamp, startMs, endMs)) continue;
      const compact = compactSnapshotFromAttempt({
        ...attempt,
        attemptId: attempt.attemptId || attemptId,
      });
      if (!compact.sessionId) continue;
      rows.push(buildSnapshotRow(compact.sessionId, compact));
    }
  }

  rows.sort((a, b) => {
    const ams = dateMs(a.created_at);
    const bms = dateMs(b.created_at);
    return bms - ams;
  });

  return rows;
}

/**
 * Acknowledge local cache rows only when the corresponding server-graded
 * session already exists. Client-computed summaries never become canonical
 * stats. Offline-created content-pack submissions will use a raw-answer queue
 * in a separate contract.
 *
 * @param {Object} db RTDB instance
 * @param {string} studentId Student id
 * @param {string} bootcamp Bootcamp id
 * @param {Object[]} localSnapshots Local rows
 * @return {Promise<Object>}
 */
async function uploadLocalSnapshots(db, studentId, bootcamp, localSnapshots) {
  const rows = Array.isArray(localSnapshots) ? localSnapshots : [];
  const MAX_UPLOAD = 50;

  const acceptedSessionIds = [];
  const rejected = [];
  const limitedRows = rows.slice(0, MAX_UPLOAD);

  for (let i = 0; i < limitedRows.length; i++) {
    const row = limitedRows[i] || {};
    const sessionId = cleanStr(row.session_id || row.sessionId, 180);
    if (!sessionId) {
      rejected.push({
        index: i,
        session_id: "",
        error: "MISSING_SESSION_ID",
      });
      continue;
    }
    const serverSession = (await db.ref(
        `studentDrills/${studentId}/${sessionId}`,
    ).once("value")).val();
    const canonicalIndex = (await db.ref(
        `users/${studentId}/statsIndex/${sessionId}`,
    ).once("value")).val();
    if (serverSession && serverSession.status === "submitted" &&
        serverSession.result && canonicalIndex && canonicalIndex.activity) {
      acceptedSessionIds.push(sessionId);
    } else {
      rejected.push({
        index: i,
        session_id: sessionId,
        error: "SERVER_GRADED_SESSION_REQUIRED",
      });
    }
  }

  return {
    uploadedCount: acceptedSessionIds.length,
    uploadedSessionIds: acceptedSessionIds,
    rejected,
  };
}

exports.handler = async (req, res) => {
  // Older native clients upload as many as 50 complete local snapshot JSON
  // blobs even though this endpoint only trusts their session identifiers.
  // Keep those released clients working while the current app sends IDs only.
  if (allowCors(req, res, {maxBodyBytes: 8 * 1024 * 1024})) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const startMs = dateMs(body.startAt);
    const endMs = dateMs(body.endAt);

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    const ctx = await readStudentContext(db, callerFbUid);
    if (ctx.error) {
      return bad(res, 403, ctx.error);
    }

    const {studentId, user} = ctx;

    const uploadResult = await uploadLocalSnapshots(
        db,
        studentId,
        bootcamp,
        body.localSnapshots || [],
    );

    const snapshots = await readStudentSnapshots(
        db,
        studentId,
        bootcamp,
        startMs,
        endMs,
    );

    return res.status(200).json({
      ok: true,
      bootcamp,
      studentId,
      student: {
        id: studentId,
        firstName: cleanStr(user.firstName, 80),
        lastName: cleanStr(user.lastName, 80),
        platoonName: cleanStr(user.platoonName, 120),
      },
      uploadedCount: uploadResult.uploadedCount,
      uploadedSessionIds: uploadResult.uploadedSessionIds,
      rejected: uploadResult.rejected,
      snapshots,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    const details = errText(e);

    if (
      details.includes("auth/id-token-expired") ||
      details.includes("Firebase ID token has expired")
    ) {
      return bad(res, 401, "ID_TOKEN_EXPIRED", details);
    }

    if (
      details.includes("auth/argument-error") ||
      details.includes("Decoding Firebase ID token failed")
    ) {
      return bad(res, 401, "INVALID_ID_TOKEN", details);
    }

    return bad(res, 500, "INTERNAL", details);
  }
};

module.exports.compactSnapshotFromAttempt = compactSnapshotFromAttempt;
