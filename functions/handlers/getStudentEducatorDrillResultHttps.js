"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");
const {resolveAssignmentRelease} = require("./_analytics");
const {releaseFromDrill} = require("./studentAssignmentsHttps");

/**
 * Send standardized error response.
 *
 * @param {Object} res Express response
 * @param {number} code HTTP status code
 * @param {string} msg Error message
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
 * Clean string.
 *
 * @param {*} v Input value
 * @param {number} maxLen Max length
 * @return {string}
 */
function cleanStr(v, maxLen) {
  const s = (v || "").toString().trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Safe object guard.
 *
 * @param {*} v Any value
 * @return {Object}
 */
function asObj(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/**
 * Safe array guard.
 *
 * @param {*} v Any value
 * @return {Array}
 */
function asArr(v) {
  return Array.isArray(v) ? v : [];
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
 * Resolve student custom id from Firebase uid.
 *
 * Supports uidToCustom/{uid} being either:
 * - "customId"
 * - { student: "customId" }
 *
 * @param {Object} db RTDB
 * @param {string} fbUid Firebase uid
 * @return {Promise<string>}
 */
async function resolveStudentId(db, fbUid) {
  const snap = await db.ref(`uidToCustom/${fbUid}`).once("value");
  const val = snap.val();

  if (!val) return "";
  if (typeof val === "string") return cleanStr(val, 140);
  if (typeof val === "object") return cleanStr(val.student, 140);

  return "";
}

/**
 * Return true if ISO date has passed.
 *
 * @param {string} iso ISO date string
 * @return {boolean}
 */
function isPastIso(iso) {
  const raw = cleanStr(iso, 100);
  if (!raw) return false;

  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return false;

  return Date.now() >= ms;
}

/**
 * Pick attempt by id, or latest attempt.
 *
 * @param {Object} attemptsMap Attempts map
 * @param {string} preferredAttemptId Preferred attempt id
 * @return {Object}
 */
function pickAttempt(attemptsMap, preferredAttemptId) {
  const map = asObj(attemptsMap);

  if (preferredAttemptId && map[preferredAttemptId]) {
    return asObj(map[preferredAttemptId]);
  }

  let best = {};
  let bestTime = 0;

  for (const attemptId of Object.keys(map)) {
    const row = asObj(map[attemptId]);
    const t = Date.parse(row.submittedAt || row.createdAt || "");
    const ms = Number.isNaN(t) ? 0 : t;

    if (!Object.keys(best).length || ms > bestTime) {
      best = row;
      bestTime = ms;
    }
  }

  return best;
}

/**
 * Deep clone JSON-safe value.
 *
 * @param {*} value Any value
 * @return {*}
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

/**
 * Remove correction-sensitive fields from answers.
 *
 * @param {Object} snapshot Snapshot
 * @return {Object}
 */
function stripCorrections(snapshot) {
  const copy = clone(snapshot);
  const answers = asArr(copy.answers);

  copy.answers = answers.map((row) => {
    const a = asObj(row);

    return {
      questionId: cleanStr(a.questionId || a.question_id, 240),
      subject: cleanStr(a.subject || a.subjectCode || a.subject_code, 120),
      module: cleanStr(a.module || a.moduleCode || a.module_code, 180),
      selectedAnswer: cleanStr(a.selectedAnswer || a.chosen_option, 1000),
      isCorrect: a.isCorrect === true || a.is_correct === true,
      timeTakenMs: Math.max(0, Number(a.timeTakenMs || a.time_taken_ms || 0)),
    };
  });

  return copy;
}

/**
 * Build a result snapshot from attempt fields if no snapshot exists.
 *
 * @param {Object} attempt Attempt row
 * @return {Object}
 */
function buildSnapshotFromAttempt(attempt) {
  return {
    summary: asObj(attempt.summary),
    subjects: asArr(attempt.subjects),
    modules: asArr(attempt.modules),
    answers: asArr(attempt.answers),
  };
}

/**
 * Attach assignment metadata to snapshot.
 *
 * @param {Object} snapshot Result snapshot
 * @param {Object} meta Assignment meta
 * @return {Object}
 */
function withAssignmentMeta(snapshot, meta) {
  const out = clone(snapshot);

  out.assignmentMeta = {
    type: "educator_drill",
    drillId: meta.drillId,
    assignmentId: meta.drillId,
    studentId: meta.studentId,
    attemptId: meta.attemptId,
    dueAt: meta.dueAt || "",
    submittedAt: meta.submittedAt || "",

    // These names match Results.qml expectations.
    showScoreImmediately: meta.canViewScore === true,
    showCorrectionsImmediately: meta.canViewCorrections === true,
  };

  return out;
}

/**
 * HTTPS handler to get signed-in student's own educator drill result.
 *
 * Request:
 * {
 *   bootcamp: "utme",
 *   drillId: "-abc"
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   permissions: {...},
 *   assignment: {...},
 *   settings: {...},
 *   snapshot: {...}
 * }
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const drillId = cleanStr(body.drillId, 160);

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    if (!drillId) {
      return bad(res, 400, "MISSING_DRILL_ID");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    const studentId = await resolveStudentId(db, callerFbUid);

    if (!studentId) {
      return bad(res, 403, "NOT_A_STUDENT");
    }

    await assertLicenseActive(db, studentId, bootcamp);

    const inboxSnap = await db
        .ref(`users/${studentId}/assignedDrills/${drillId}`)
        .once("value");

    const inbox = asObj(inboxSnap.val());

    if (!Object.keys(inbox).length) {
      return bad(res, 404, "ASSIGNMENT_NOT_FOUND");
    }

    const schoolId = cleanStr(inbox.schoolId || inbox.schoolID, 120);

    if (!schoolId) {
      return bad(res, 409, "ASSIGNMENT_MISSING_SCHOOL");
    }

    const drillSnap = await db
        .ref(`schools/${schoolId}/educatorDrills/${drillId}`)
        .once("value");

    const drill = asObj(drillSnap.val());

    if (!Object.keys(drill).length) {
      return bad(res, 404, "DRILL_NOT_FOUND");
    }

    const drillBootcamp = cleanStr(drill.bootcamp, 40).toLowerCase();

    if (drillBootcamp !== bootcamp) {
      return bad(res, 403, "DRILL_BOOTCAMP_MISMATCH");
    }

    const assigned = asObj(
        asObj(drill.assignedStudents)[studentId] || inbox,
    );

    const status = cleanStr(
        assigned.status || inbox.status,
        40,
    ).toLowerCase();

    if (status !== "submitted") {
      return bad(res, 409, "RESULT_NOT_SUBMITTED", {
        status,
      });
    }

    const attemptId = cleanStr(
        assigned.attemptId || inbox.attemptId || body.attemptId,
        180,
    );

    const attemptsSnap = await db
        .ref(
            `schools/${schoolId}/educatorDrillAttempts/${drillId}/${studentId}`)
        .once("value");

    const attempt = pickAttempt(attemptsSnap.val(), attemptId);

    if (!attempt || !Object.keys(attempt).length) {
      return bad(res, 404, "ATTEMPT_NOT_FOUND");
    }

    const realAttemptId = cleanStr(
        attempt.attemptId || attemptId,
        180,
    );

    const settings = asObj(drill.settings);
    const dueAt = cleanStr(drill.dueAt || inbox.dueAt, 100);
    const duePassed = isPastIso(dueAt);
    const drillStatus = cleanStr(drill.status, 40).toLowerCase();
    const release = resolveAssignmentRelease(releaseFromDrill(drill), dueAt);
    const canViewScore = release.scoreReleased;
    const canViewCorrections = release.correctionsReleased;

    const submittedAt = cleanStr(
        attempt.submittedAt || assigned.submittedAt || inbox.submittedAt,
        100,
    );

    let snapshot = asObj(attempt.snapshot);

    if (!Object.keys(snapshot).length) {
      snapshot = buildSnapshotFromAttempt(attempt);
    }

    if (!canViewScore) {
      snapshot = {
        summary: {},
        subjects: [],
        modules: [],
        answers: [],
      };
    } else if (!canViewCorrections) {
      snapshot = stripCorrections(snapshot);
    }

    snapshot = withAssignmentMeta(snapshot, {
      drillId,
      studentId,
      attemptId: realAttemptId,
      dueAt,
      submittedAt,
      canViewScore,
      canViewCorrections,
    });

    return res.status(200).json({
      ok: true,
      studentId,
      schoolId,
      drill: {
        drillId,
        bootcamp: drillBootcamp,
        title: cleanStr(drill.title, 180),
        instructions: cleanStr(drill.instructions, 500),
        status: drillStatus,
        dueAt,
        createdByEducatorId: cleanStr(drill.createdByEducatorId, 140),
        createdByName: cleanStr(drill.createdByName, 160),
      },
      assignment: {
        drillId,
        studentId,
        schoolId,
        status,
        attemptId: realAttemptId,
        submittedAt,
        dueAt,
      },
      settings: {
        scorePolicy: release.scorePolicy,
        correctionPolicy: release.correctionPolicy,
        scoreReleasedAt: release.scoreReleasedAt,
        correctionsReleasedAt: release.correctionsReleasedAt,
        showScoreImmediately: release.scorePolicy === "immediate",
        showCorrectionsImmediately: release.correctionPolicy === "immediate",
        shuffleQuestions: settings.shuffleQuestions !== false,
        shuffleOptions: settings.shuffleOptions !== false,
      },
      permissions: {
        canViewScore,
        canViewCorrections,
        duePassed,
      },
      snapshot,
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    const details = errText(e);

    if ([400, 403, 409].includes(Number(e && e.code))) {
      return bad(res, Number(e.code), "SUBSCRIPTION_REQUIRED", details);
    }

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
