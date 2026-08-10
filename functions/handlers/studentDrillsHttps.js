"use strict";

const crypto = require("crypto");
const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {assertLicenseActive} = require("./_license");
const {
  FREE_CREDITS_ALLOWANCE,
  FREE_POINTS_CEILING,
  creditFreeSession,
  creditPaidSession,
  promoteFreeSessionToPaid,
} = require("./_pointsCredit");
const {
  SUPPORTED_BOOTCAMPS,
  buildCatalog,
  buildPaper,
  canonicalAssetPaths,
  cleanSegment,
  correctionRevisionFor,
  gradeSession,
  normalizedQuestions,
  publicQuestion,
  publicSession,
  resolveStudent,
  subjectTimerKey,
  subjectTimerValue,
  datasetVersionFor,
} = require("./_studentDrill");
const {
  analyticsAttemptFromResult,
  projectAttempt,
  resolveAssignmentRelease,
} = require("./_analytics");
const {releaseFromDrill} = require("./studentAssignmentsHttps");
const {recordStreak} = require("./_streaks");

/**
 * Record a completed attempt in the canonical streak projection.
 *
 * @param {Object} db Firebase database
 * @param {string} studentId Student custom id
 * @param {Object} session Canonical session
 * @param {Object} result Server-graded result
 * @param {Object} body Submission request body
 * @return {Promise<Object>} Public streak summary
 */
async function recordSubmissionStreak(db, studentId, session, result, body) {
  return recordStreak(db, {
    studentId,
    bootcamp: session.bootcamp,
    attempted: Number(
        result && result.summary && result.summary.attempted || 0,
    ),
    submittedAt: result && result.createdAt ||
      session.submittedAt || Date.now(),
    timezone: body && body.timezone,
    timezoneOffsetMinutes: body && body.timezoneOffsetMinutes,
  });
}

/**
 * Send consistent errors without exposing server internals.
 *
 * @param {Object} res Express response
 * @param {*} error Thrown error
 * @param {string} fallback Safe fallback message
 * @return {Object} Express response
 */
function sendError(res, error, fallback) {
  const code = Number(error && error.code);
  const authCode = String(error && error.code || "");
  if (code === 401 || authCode.startsWith("auth/")) {
    return res.status(401).json({error: "Authentication failed"});
  }
  if ([400, 403, 404, 409].includes(code)) {
    return res.status(code).json({error: error.message});
  }
  console.error("STUDENT_DRILL_FAILED", {
    message: error && error.message || "Unknown error",
  });
  return res.status(500).json({error: fallback});
}

/**
 * Require POST after handling CORS.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {boolean} Whether the request is already handled
 */
function rejectNonPost(req, res) {
  if (allowCors(req, res)) return true;
  if (req.method !== "POST") {
    res.status(405).json({error: "Method not allowed"});
    return true;
  }
  return false;
}

/**
 * Validate one supported question-bank id.
 *
 * @param {*} value Candidate bootcamp
 * @return {string} Valid bootcamp
 */
function requireBootcamp(value) {
  const bootcamp = String(value || "").trim().toLowerCase();
  if (!SUPPORTED_BOOTCAMPS.includes(bootcamp)) {
    const error = new Error("This bootcamp does not have a web question bank");
    error.code = 404;
    throw error;
  }
  return bootcamp;
}

/**
 * Convert a version label to a valid Realtime Database path segment.
 *
 * @param {*} value Dataset version
 * @return {string} Safe path key
 */
function datasetPathKey(value) {
  return String(value || "").replace(/[.#$[\]/]/g, "_");
}

/**
 * Build the transaction value that claims one active drill submission.
 *
 * RTDB may initially supply null or incomplete locally cached data even when
 * the server record exists, so the freshly read owned session is the fallback.
 *
 * @param {*} current Transaction's current value
 * @param {Object} session Freshly read owned session
 * @param {string} studentId Calling student id
 * @param {Object} progress Sanitized progress
 * @param {Object} result Server-graded result
 * @param {number} endedAt Submission timestamp
 * @return {Object|undefined} Submitted session or transaction abort
 */
function submittedSessionValue(
    current,
    session,
    studentId,
    progress,
    result,
    endedAt,
) {
  const hasSessionState = current && typeof current === "object" &&
    typeof current.status === "string" &&
    typeof current.studentId === "string";
  const latest = hasSessionState ? current : session;
  if (!latest || latest.studentId !== studentId ||
      latest.status !== "active") return;
  return {
    ...latest,
    ...progress,
    status: "submitted",
    submittedAt: endedAt,
    updatedAt: endedAt,
    result,
  };
}

/**
 * Determine whether all practice years are available.
 *
 * @param {Object} db Firebase database
 * @param {string} studentId Student id
 * @param {string} bootcamp Bootcamp id
 * @return {Promise<Object|null>} Active license or null
 */
async function hasLicense(db, studentId, bootcamp) {
  try {
    return await assertLicenseActive(db, studentId, bootcamp);
  } catch (error) {
    console.warn("STUDENT_DRILL_LICENSE_REJECTED", {
      studentId,
      bootcamp,
      code: Number(error && error.code) || 500,
      reason: error && error.message || "License validation failed",
    });
    return null;
  }
}

/**
 * Determine whether an active license already covered a submitted session.
 *
 * This prevents a subscription purchased after an old free attempt from
 * retroactively converting that attempt into paid practice.
 *
 * @param {Object|null} license Valid active license
 * @param {Object} session Stored drill session
 * @return {boolean} Whether the license covered the submission
 */
function licenseCoversSession(license, session) {
  if (!license) return false;
  const activationMs = Date.parse(license.activationDate || "");
  const submittedMs = Number(session && session.submittedAt) ||
    Date.parse(session && session.result && session.result.takenAt || "");
  return Number.isFinite(activationMs) &&
    Number.isFinite(submittedMs) &&
    activationMs <= submittedMs;
}

/**
 * Return catalog filters without question or answer content.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function getCatalog(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const bootcamp = requireBootcamp(req.body && req.body.bootcamp);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const licensed = Boolean(await hasLicense(db, studentId, bootcamp));
    const catalog = buildCatalog(bootcamp);
    const subjects = catalog.subjects.map((subject) => ({
      ...subject,
      availablePracticeYears: licensed ? subject.practiceYears :
        subject.practiceYears.filter((year) => year <= 2),
    }));
    return res.status(200).json({
      ok: true,
      ...catalog,
      subjects,
      licensed,
      freePracticeYears: [1, 2],
    });
  } catch (error) {
    return sendError(res, error, "Unable to load drill options");
  }
}

/**
 * Create and persist a server-owned question paper.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function createDrill(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const bootcamp = requireBootcamp(req.body && req.body.bootcamp);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const licensed = Boolean(await hasLicense(db, studentId, bootcamp));
    const paper = buildPaper(bootcamp, req.body && req.body.config, licensed);
    const sessionId = crypto.randomUUID();
    const createdAt = Date.now();
    const timers = {};
    paper.config.forEach((row) => {
      timers[subjectTimerKey(row.subject)] = row.timeLimitMin * 60;
    });
    const session = {
      sessionId,
      studentId,
      status: "active",
      bootcamp,
      datasetVersion: datasetVersionFor(bootcamp),
      correctionRevision: correctionRevisionFor(bootcamp),
      createdAt,
      updatedAt: createdAt,
      config: paper.config,
      questions: paper.questions,
      answers: {},
      bookmarks: {},
      flags: {},
      questionTimes: {},
      timers,
      currentQuestionId: paper.questions[0] && paper.questions[0].id || "",
    };
    await db.ref(`studentDrills/${studentId}/${sessionId}`).set(session);
    return res.status(201).json({ok: true, session: publicSession(session)});
  } catch (error) {
    return sendError(res, error, "Unable to create drill");
  }
}

/**
 * Read an owned drill session.
 *
 * @param {Object} db Firebase database
 * @param {string} studentId Student id
 * @param {*} sessionValue Candidate session id
 * @return {Promise<Object>} Stored session and ref
 */
async function readSession(db, studentId, sessionValue) {
  const sessionId = cleanSegment(sessionValue, 80);
  if (!sessionId) {
    const error = new Error("A valid drill session is required");
    error.code = 400;
    throw error;
  }
  const ref = db.ref(`studentDrills/${studentId}/${sessionId}`);
  const session = (await ref.once("value")).val();
  if (!session || session.studentId !== studentId) {
    const error = new Error("Drill session was not found");
    error.code = 404;
    throw error;
  }
  return {ref, session, sessionId};
}

/**
 * Sanitize active answer, timer, bookmark, and position state.
 *
 * @param {Object} session Stored session
 * @param {Object} body Client request body
 * @return {Object} Sanitized progress
 */
function sanitizeProgress(session, body) {
  const questionIds = new Set(session.questions.map((question) => question.id));
  const answers = {};
  const rawAnswers = body.answers && typeof body.answers === "object" ?
    body.answers : {};
  Object.entries(rawAnswers).forEach(([id, value]) => {
    const index = Number(value);
    if (questionIds.has(id) && Number.isInteger(index) && index >= 0 &&
        index <= 3) answers[id] = index;
  });
  const bookmarks = {};
  const rawBookmarks = body.bookmarks && typeof body.bookmarks === "object" ?
    body.bookmarks : {};
  Object.entries(rawBookmarks).forEach(([id, value]) => {
    if (questionIds.has(id) && value === true) bookmarks[id] = true;
  });
  const flags = {};
  const rawFlags = body.flags && typeof body.flags === "object" ?
    body.flags : {};
  Object.entries(rawFlags).forEach(([id, value]) => {
    if (questionIds.has(id) && value === true) flags[id] = true;
  });
  const questionTimes = {};
  const rawQuestionTimes =
    body.questionTimes && typeof body.questionTimes === "object" ?
      body.questionTimes : {};
  Object.entries(rawQuestionTimes).forEach(([id, value]) => {
    const seconds = Number(value);
    if (questionIds.has(id) && Number.isFinite(seconds)) {
      questionTimes[id] = Math.min(7200, Math.max(0, Math.floor(seconds)));
    }
  });
  const timers = {};
  const rawTimers = body.timers && typeof body.timers === "object" ?
    body.timers : {};
  session.config.forEach((row) => {
    const limit = row.timeLimitMin * 60;
    const value = subjectTimerValue(rawTimers, row.subject, NaN);
    timers[subjectTimerKey(row.subject)] = Number.isFinite(value) ?
      Math.min(limit, Math.max(0, Math.floor(value))) :
      subjectTimerValue(session.timers, row.subject, limit);
  });
  const currentQuestionId = questionIds.has(body.currentQuestionId) ?
    body.currentQuestionId : session.currentQuestionId || "";
  return {
    answers,
    bookmarks,
    flags,
    questionTimes,
    timers,
    currentQuestionId,
  };
}

/**
 * Persist recoverable in-progress drill state.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function saveProgress(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const {ref, session} = await readSession(
        db,
        studentId,
        req.body && req.body.sessionId,
    );
    if (session.status !== "active") {
      return res.status(200).json({
        ok: true,
        status: session.status,
        savedAt: session.updatedAt,
      });
    }
    const progress = sanitizeProgress(session, req.body || {});
    const savedAt = Date.now();
    await ref.update({...progress, updatedAt: savedAt});
    return res.status(200).json({ok: true, status: "active", savedAt});
  } catch (error) {
    return sendError(res, error, "Unable to save drill progress");
  }
}

/**
 * Return an active or submitted owned session.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function getSession(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const {session} = await readSession(
        db,
        studentId,
        req.body && req.body.sessionId,
    );
    if (session.status === "submitted") {
      return res.status(200).json({
        ok: true,
        status: "submitted",
        sessionId: session.sessionId,
        mode: session.mode || "practice",
        challengeId: session.challengeId || "",
      });
    }
    return res.status(200).json({ok: true, session: publicSession(session)});
  } catch (error) {
    return sendError(res, error, "Unable to load drill session");
  }
}

/**
 * Convert points total to the existing app rank fields.
 *
 * @param {number} total Total points
 * @return {Object} Rank fields
 */
function rankForPoints(total) {
  const thresholds = [
    [100, "RECRUIT"],
    [250, "CORPORAL"],
    [450, "SERGEANT"],
    [800, "WARRANT OFFICER"],
    [1300, "LIEUTENANT"],
    [1950, "CAPTAIN"],
    [3000, "MAJOR"],
    [4500, "COLONEL"],
    [7000, "MAJOR GENERAL"],
    [Infinity, "GENERAL"],
  ];
  const index = thresholds.findIndex(([limit]) => total < limit);
  return {currentRank: thresholds[index][1], rankNum: index + 1};
}

/**
 * Credit a server-graded drill using existing paid/free accounting.
 *
 * @param {Object} db Firebase database
 * @param {string} studentId Student id
 * @param {Object} session Submitted session
 * @param {Object} result Graded result
 * @param {boolean=} licensedOverride Known license status
 * @return {Promise<Object>} Credit response
 */
async function creditResult(
    db,
    studentId,
    session,
    result,
    licensedOverride,
) {
  const licensed = typeof licensedOverride === "boolean" ?
    licensedOverride :
    Boolean(await hasLicense(db, studentId, session.bootcamp));
  let deltaPoints = 0;
  let reason = "ok";
  let freeCreditConsumed = false;
  if (licensed) {
    deltaPoints = await creditPaidSession(
        db,
        studentId,
        session.sessionId,
        result.summary.points,
    );
  } else {
    const credit = await creditFreeSession(
        db,
        studentId,
        session.sessionId,
        result.summary.points,
        FREE_POINTS_CEILING,
        FREE_CREDITS_ALLOWANCE,
    );
    deltaPoints = credit.delta;
    reason = credit.reason;
    freeCreditConsumed = credit.consumedCredit;
  }
  const totalPoints = Number((await db.ref(`users/${studentId}/totalPoints`)
      .once("value")).val() || 0);
  await db.ref(`users/${studentId}`).update(rankForPoints(totalPoints));
  return {
    creditMode: licensed ? "paid" : "free",
    deltaPoints,
    reason,
    freeCreditConsumed,
    totalPoints,
  };
}

/**
 * Store or repair the credit decision for a submitted drill.
 *
 * @param {Object} db Firebase database
 * @param {string} studentId Student id
 * @param {Object} ref Session database reference
 * @param {Object} session Submitted session
 * @return {Promise<Object>} Stable credit response
 */
async function ensureSessionCredit(db, studentId, ref, session) {
  const existing = session.credit || null;
  if (existing && existing.creditMode === "paid") return existing;

  const license = await hasLicense(db, studentId, session.bootcamp);
  const coveredByLicense = licenseCoversSession(license, session);
  let credit;

  if (existing && existing.creditMode === "free" && coveredByLicense) {
    const promotion = await promoteFreeSessionToPaid(
        db,
        studentId,
        session.sessionId,
        session.result.summary.points,
    );
    const totalPoints = Number((await db.ref(`users/${studentId}/totalPoints`)
        .once("value")).val() || 0);
    await db.ref(`users/${studentId}`).update(rankForPoints(totalPoints));
    credit = {
      creditMode: "paid",
      deltaPoints: promotion.awardedPoints,
      reason: "recovered_subscription_credit",
      freeCreditConsumed: false,
      freeCreditRefunded: promotion.freeCreditRefunded,
      recovered: true,
      totalPoints,
    };
  } else if (!existing) {
    credit = await creditResult(
        db,
        studentId,
        session,
        session.result,
        coveredByLicense,
    );
  } else {
    return existing;
  }

  await ref.child("credit").set(credit);
  await db.ref(`users/${studentId}/statsIndex/${session.sessionId}/credited`)
      .set(credit.deltaPoints > 0);
  return credit;
}

/**
 * Apply assignment score and correction release to a submission response.
 *
 * @param {Object} db Firebase database
 * @param {string} studentId Student id
 * @param {Object} session Submitted session
 * @param {Object} result Server-graded result
 * @return {Promise<Object>} Release-aware response fields
 */
async function releasedSubmissionResult(db, studentId, session, result) {
  if (session.mode !== "assignment") {
    return {result, resultStatus: "released"};
  }
  const attempt = (await db.ref(
      `users/${studentId}/statsIndex/${session.sessionId}`,
  ).once("value")).val() || {};
  const release = resolveAssignmentRelease(
      attempt.release || session.assignmentRelease,
      attempt.dueAt || session.dueAt,
  );
  if (!release.scoreReleased) {
    return {
      result: null,
      resultStatus: "pending",
      permissions: {canViewScore: false, canViewCorrections: false},
    };
  }
  return {
    result: release.correctionsReleased ? result : {...result, answers: []},
    resultStatus: release.correctionsReleased ?
      "corrections_released" : "score_released",
    permissions: {
      canViewScore: true,
      canViewCorrections: release.correctionsReleased,
    },
  };
}

/**
 * Atomically submit and server-grade a drill.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function submitDrill(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const {ref, session} = await readSession(
        db,
        studentId,
        req.body && req.body.sessionId,
    );
    if (session.status === "submitted" && session.result) {
      const credit = await ensureSessionCredit(db, studentId, ref, session);
      const streak = await recordSubmissionStreak(
          db, studentId, session, session.result, req.body || {},
      );
      const released = await releasedSubmissionResult(
          db, studentId, session, session.result,
      );
      return res.status(200).json({
        ok: true,
        ...released,
        credit,
        streak,
        duplicate: true,
        challengeId: session.challengeId || "",
      });
    }
    const progress = sanitizeProgress(session, req.body || {});
    const endedAt = Date.now();
    const nextSession = {...session, ...progress};
    const result = gradeSession(
        nextSession,
        progress.answers,
        progress.timers,
        endedAt,
    );
    const claimed = await ref.transaction((current) =>
      submittedSessionValue(
          current,
          session,
          studentId,
          progress,
          result,
          endedAt,
      ));
    if (!claimed.committed) {
      const latest = (await ref.once("value")).val() || {};
      if (latest.status === "submitted" && latest.result) {
        const credit = await ensureSessionCredit(
            db,
            studentId,
            ref,
            latest,
        );
        const released = await releasedSubmissionResult(
            db, studentId, latest, latest.result,
        );
        const streak = await recordSubmissionStreak(
            db, studentId, latest, latest.result, req.body || {},
        );
        return res.status(200).json({
          ok: true,
          ...released,
          credit,
          streak,
          duplicate: true,
          challengeId: latest.challengeId || "",
        });
      }
      const error = new Error(
          "The drill could not be submitted from its current state",
      );
      error.code = 409;
      throw error;
    }

    const source = session.mode === "challenge" ? "challenge" :
      session.mode === "assignment" ? "assignment" : "solo";
    let assignmentDrill = null;
    if (source === "assignment") {
      assignmentDrill = (await db.ref(
          `schools/${session.schoolId}/educatorDrills/${session.assignmentId}`,
      ).once("value")).val();
      if (!assignmentDrill) {
        const error = new Error("Assignment was not found");
        error.code = 404;
        throw error;
      }
    }
    const analyticsAttempt = analyticsAttemptFromResult({
      result,
      session,
      studentId,
      source,
      sourceId: source === "challenge" ? session.challengeId :
        source === "assignment" ? session.assignmentId : session.sessionId,
      schoolId: source === "assignment" ? session.schoolId : "",
      dueAt: source === "assignment" ? assignmentDrill.dueAt : "",
      release: source === "assignment" ?
        releaseFromDrill(assignmentDrill) : null,
    });
    const attemptUpdates = {};
    attemptUpdates[`users/${studentId}/statsIndex/${session.sessionId}`] =
      analyticsAttempt;
    // The compact index powers Test Records and analytics. The detail row is
    // deliberately question-free; the owned studentDrills session remains the
    // source for review/corrections when policy permits.
    attemptUpdates[`users/${studentId}/stats/${session.sessionId}`] = {
      type: "results_snapshot",
      v: 2,
      attemptId: session.sessionId,
      sessionId: session.sessionId,
      bootcamp: analyticsAttempt.bootcamp,
      source: analyticsAttempt.source,
      sourceId: analyticsAttempt.sourceId,
      submittedAt: analyticsAttempt.submittedAt,
      takenAt: analyticsAttempt.submittedAt,
      createdAt: analyticsAttempt.submittedAt,
      datasetVersion: String(session.datasetVersion || ""),
      summary: result.summary,
      subjects: result.subjects,
      modules: result.modules,
      resultPath: `studentDrills/${studentId}/${session.sessionId}/result`,
      gradingVersion: "server-v1",
    };
    if (source === "assignment") {
      const drillId = session.assignmentId;
      const schoolId = session.schoolId;
      const attemptPath = `schools/${schoolId}/educatorDrillAttempts/` +
        `${drillId}/${studentId}/${session.sessionId}`;
      attemptUpdates[attemptPath] = {
        attemptId: session.sessionId,
        drillId,
        schoolId,
        bootcamp: session.bootcamp,
        studentId,
        submittedAt: result.createdAt,
        startedAt: new Date(session.createdAt).toISOString(),
        dueAt: assignmentDrill.dueAt || "",
        summary: result.summary,
        subjects: result.subjects,
        modules: result.modules,
        answers: result.answers,
        snapshot: result,
        gradingVersion: "server-v1",
      };
      const assignedBase = `schools/${schoolId}/educatorDrills/${drillId}` +
        `/assignedStudents/${studentId}`;
      attemptUpdates[`${assignedBase}/status`] = "submitted";
      attemptUpdates[`${assignedBase}/submittedAt`] = result.createdAt;
      attemptUpdates[`${assignedBase}/attemptId`] = session.sessionId;
      attemptUpdates[`${assignedBase}/summary`] = result.summary;
      const inboxBase = `users/${studentId}/assignedDrills/${drillId}`;
      attemptUpdates[`${inboxBase}/status`] = "submitted";
      attemptUpdates[`${inboxBase}/submittedAt`] = result.createdAt;
      attemptUpdates[`${inboxBase}/attemptId`] = session.sessionId;
      attemptUpdates[`${inboxBase}/sessionId`] = session.sessionId;
      attemptUpdates[`schools/${schoolId}/educatorDrills/${drillId}/` +
        `latestAttempts/${studentId}`] = {
        attemptId: session.sessionId,
        studentId,
        submittedAt: result.createdAt,
        summary: result.summary,
      };
    }
    await db.ref().update(attemptUpdates);
    const credit = await creditResult(db, studentId, session, result);
    await ref.child("credit").set(credit);
    await db.ref(`users/${studentId}/statsIndex/${session.sessionId}/credited`)
        .set(credit.deltaPoints > 0);
    const streak = await recordSubmissionStreak(
        db, studentId, session, result, req.body || {},
    );
    const released = await releasedSubmissionResult(
        db, studentId, session, result,
    );
    return res.status(200).json({
      ok: true,
      ...released,
      credit,
      streak,
      challengeId: session.challengeId || "",
    });
  } catch (error) {
    return sendError(res, error, "Unable to submit drill");
  }
}

/**
 * Return a submitted result with explanations and answer keys.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function getResult(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const sessionId = cleanSegment(req.body && req.body.sessionId, 80);
    if (!sessionId) {
      const error = new Error("A valid drill session is required");
      error.code = 400;
      throw error;
    }
    const sessionRef = db.ref(`studentDrills/${studentId}/${sessionId}`);
    const session = (await sessionRef.once("value")).val();
    if (!session) {
      const error = new Error("Drill result was not found");
      error.code = 404;
      throw error;
    }
    let result = session.result;
    let permissions = null;
    const correctionsOnly = req.body && req.body.correctionsOnly === true;
    if (session.mode === "assignment") {
      const attempt = (await db.ref(
          `users/${studentId}/statsIndex/${sessionId}`,
      ).once("value")).val() || {};
      const release = resolveAssignmentRelease(
          attempt.release || session.assignmentRelease,
          attempt.dueAt || session.dueAt,
      );
      if (!release.scoreReleased) {
        const error = new Error("This assignment score has not been released");
        error.code = 403;
        throw error;
      }
      if (!release.correctionsReleased && session.result) {
        result = {...session.result, answers: []};
      }
      permissions = {
        canViewScore: release.scoreReleased,
        canViewCorrections: release.correctionsReleased,
      };
    }
    if (session.status !== "submitted" || !session.result) {
      const error = new Error("This drill has not been submitted");
      error.code = 409;
      throw error;
    }
    // Results retain the whole paper for its summary, while a correction view
    // needs only attempted rows. Positions retain original numbering.
    if (correctionsOnly && Array.isArray(result && result.answers)) {
      result = {
        ...result,
        answers: result.answers.filter((answer) => {
          const selectedIndex = answer && answer.selectedIndex;
          const options = answer && Array.isArray(answer.options) ?
            answer.options : [];
          return Number.isInteger(selectedIndex) &&
            selectedIndex >= 0 && selectedIndex < options.length;
        }),
      };
    }
    const credit = await ensureSessionCredit(
        db,
        studentId,
        sessionRef,
        session,
    );
    return res.status(200).json({
      ok: true,
      result: {...result, mode: session.mode || "solo"},
      credit,
      ...(permissions ? {permissions} : {}),
    });
  } catch (error) {
    return sendError(res, error, "Unable to load drill result");
  }
}

/**
 * List compact completed drill records for one bootcamp.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function getHistory(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const bootcamp = requireBootcamp(req.body && req.body.bootcamp);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const requestedLimit = Number(req.body && req.body.limit || 25);
    const limit = Math.max(1, Math.min(100,
        Number.isFinite(requestedLimit) ? requestedLimit : 25));
    const cursor = cleanSegment(req.body && req.body.cursor, 80);
    const rangeStart = `${bootcamp}|`;
    const rangeEnd = cursor ? `${bootcamp}|${cursor}` : `${bootcamp}|\uf8ff`;
    const rows = (await db.ref(`users/${studentId}/statsIndex`)
        .orderByChild("bootcampSubmittedAt")
        .startAt(rangeStart)
        .endAt(rangeEnd)
        .limitToLast(limit + 1)
        .once("value")).val() || {};
    const history = Object.values(rows)
        .filter((row) => row && row.activity && row.source && row.submittedAt)
        .map((row) => projectAttempt(row))
        .map((row) => ({
          sessionId: String(row.attemptId || ""),
          sourceId: String(row.sourceId || ""),
          source: String(row.source || "solo"),
          bootcamp: String(row.bootcamp || "").toLowerCase(),
          takenAt: row.submittedAt || "",
          attempted: Number(row.activity && row.activity.attempted || 0),
          correct: row.scoreVisible ?
            Number(row.performance && row.performance.correct || 0) : null,
          duration_sec: Number(
              row.activity && row.activity.elapsedTimeSec || 0,
          ),
          points: row.scoreVisible ?
            Number(row.performance && row.performance.points || 0) : null,
          total_questions: Number(
              row.activity && row.activity.totalQuestions || 0,
          ),
          scoreStatus: row.scoreVisible ? "released" : "pending",
          correctionsStatus: row.source !== "assignment" ||
            resolveAssignmentRelease(row.release, row.dueAt)
                .correctionsReleased ?
            "released" : "pending",
        }))
        .filter((row) => row.bootcamp === bootcamp &&
          (!cursor || String(row.takenAt) < cursor))
        .sort((a, b) => Date.parse(b.takenAt || 0) - Date.parse(a.takenAt || 0))
        .slice(0, limit);
    return res.status(200).json({
      ok: true,
      bootcamp,
      history,
      nextCursor: history.length === limit ?
        history[history.length - 1].takenAt : null,
    });
  } catch (error) {
    return sendError(res, error, "Unable to load drill history");
  }
}

/**
 * Add or remove a lightweight bookmark pointer. Online sessions are verified
 * against their paper; offline/native mutations may identify a pinned pack
 * directly and never upload a question payload.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function setBookmark(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const body = req.body || {};
    const questionId = cleanSegment(body.questionId, 120);
    const sessionId = cleanSegment(body.sessionId, 80);
    let ref = null;
    let session = null;
    let bootcamp = "";
    let datasetVersion = "";
    let correctionRevision = 0;
    let sourceSessionId = "";
    let sourceAttemptId = "";
    let question = null;

    if (sessionId) {
      const loaded = await readSession(db, studentId, sessionId);
      ref = loaded.ref;
      session = loaded.session;
      bootcamp = session.bootcamp;
      datasetVersion = session.datasetVersion;
      correctionRevision = Number(session.correctionRevision || 0);
      sourceSessionId = session.sessionId;
      question = session.questions.find((row) => row.id === questionId);
    } else {
      bootcamp = requireBootcamp(body.bootcamp);
      datasetVersion = String(body.datasetVersion || "").trim();
      correctionRevision = Math.max(0, Number(body.correctionRevision || 0));
      sourceAttemptId = cleanSegment(body.sourceAttemptId, 80);
      if (!datasetVersion) {
        const error = new Error("A pinned dataset version is required");
        error.code = 400;
        throw error;
      }
      const pseudo = await bookmarkQuestionSession({
        id: questionId,
        datasetVersion,
        correctionRevision,
      }, bootcamp);
      question = pseudo && pseudo.questions[0];
    }

    await assertLicenseActive(db, studentId, bootcamp);
    if (!question || typeof req.body.bookmarked !== "boolean") {
      const error = new Error("A valid bookmark request is required");
      error.code = 400;
      throw error;
    }
    const versionKey = datasetPathKey(datasetVersion);
    const bookmarkRef = db.ref(
        `users/${studentId}/bookmarks/${bootcamp}/` +
        `${versionKey}/${questionId}`,
    );
    if (req.body.bookmarked) {
      await bookmarkRef.transaction((current) => ({
        id: question.id,
        datasetVersion,
        correctionRevision,
        ...(sourceSessionId ? {sourceSessionId} : {}),
        ...(sourceAttemptId ? {sourceAttemptId} : {}),
        updatedAt: Date.now(),
        ...(current && Array.isArray(current.groups) ?
          {groups: current.groups} : {}),
      }));
      if (ref) await ref.child(`bookmarks/${questionId}`).set(true);
    } else {
      await bookmarkRef.remove();
      if (ref) await ref.child(`bookmarks/${questionId}`).remove();
    }
    return res.status(200).json({
      ok: true,
      questionId,
      bookmarked: req.body.bookmarked,
    });
  } catch (error) {
    return sendError(res, error, "Unable to update bookmark");
  }
}

/**
 * Hydrate a compact bookmark pointer from its immutable source session.
 * Legacy full-payload bookmarks remain valid when the session is unavailable.
 *
 * @param {Object} bookmark Stored compact or legacy bookmark
 * @param {Object|null} session Source drill session
 * @param {string} bootcamp Bootcamp id
 * @return {Object} Browser-safe saved question
 */
function hydrateBookmarkQuestion(bookmark, session, bootcamp) {
  const questions = session && Array.isArray(session.questions) ?
    session.questions : [];
  const question = questions.find((row) => row.id === bookmark.id);
  const payload = question ? publicQuestion(question) : bookmark;
  const hydrated = {
    ...payload,
    id: String(bookmark.id || payload.id || ""),
    bootcamp,
    datasetVersion: String(
        bookmark.datasetVersion ||
        session && session.datasetVersion ||
        "",
    ),
    sourceSessionId: String(bookmark.sourceSessionId || ""),
    updatedAt: Number(bookmark.updatedAt || 0),
    ...(Array.isArray(bookmark.groups) ? {groups: bookmark.groups} : {}),
  };
  hydrated.imageSources = canonicalAssetPaths(
      payload.imageSources !== undefined ?
        payload.imageSources : payload.imageSource,
  );
  delete hydrated.imageSource;
  return hydrated;
}

/**
 * Resolve a bookmark's public question without ever substituting a different
 * question. Prefer the live bank when the canonical ID was carried forward;
 * otherwise load its pinned immutable content-pack version.
 *
 * This require is deliberately lazy: the content-pack handler also imports
 * drill credit helpers from this module.
 *
 * @param {Object} bookmark Stored bookmark pointer
 * @param {string} bootcamp Bootcamp id
 * @return {Promise<Object|null>} A question-only pseudo session or null
 */
async function bookmarkQuestionSession(bookmark, bootcamp) {
  const questionId = String(bookmark.id || bookmark.sourceId || "");
  if (!questionId) return null;

  const current = normalizedQuestions(bootcamp)
      .find((row) => String(row.id) === questionId);
  if (current) return {questions: [current]};

  const datasetVersion = String(bookmark.datasetVersion || "");
  if (!datasetVersion) return null;
  try {
    const packs = require("./studentContentPacksHttps");
    const archived = await packs.questionsForPinnedVersion(
        bootcamp,
        datasetVersion,
        Number(bookmark.correctionRevision || 0),
    );
    const question = archived.find((row) => String(row.id) === questionId);
    return question ? {questions: [question]} : null;
  } catch (error) {
    console.warn("BOOKMARK_CONTENT_UNAVAILABLE", {
      bootcamp,
      datasetVersion,
      questionId,
      message: error && error.message,
    });
    return null;
  }
}

/**
 * Flatten bookmark records stored under one or more dataset versions.
 *
 * @param {*} value Bootcamp bookmark tree
 * @return {Object[]} Latest bookmark for each question id
 */
function flattenBookmarkVersions(value) {
  if (!value || typeof value !== "object") return [];
  const latestByQuestion = new Map();
  Object.values(value).forEach((versionRows) => {
    if (!versionRows || typeof versionRows !== "object") return;
    Object.values(versionRows).forEach((bookmark) => {
      if (!bookmark || typeof bookmark !== "object") return;
      const questionId = String(bookmark.id || bookmark.sourceId || "");
      if (!questionId) return;
      const datasetVersion = String(bookmark.datasetVersion || "");
      const identity = `${datasetVersion}\u0000${questionId}`;
      const previous = latestByQuestion.get(identity);
      if (!previous ||
          Number(bookmark.updatedAt || 0) >=
          Number(previous.updatedAt || 0)) {
        latestByQuestion.set(identity, bookmark);
      }
    });
  });
  return [...latestByQuestion.values()]
      .sort((a, b) => Number(b.updatedAt || 0) -
        Number(a.updatedAt || 0));
}

/**
 * Add answer feedback only when the source drill has been submitted.
 *
 * @param {Object} bookmark Stored bookmark
 * @param {Object|null} session Source drill session
 * @param {Object|null} resolvedSource Question source for a compact pointer
 * @return {Object} Safe bookmark response
 */
function bookmarkWithAnswer(bookmark, session, resolvedSource = null) {
  if (session && session.mode === "assignment" &&
      !resolveAssignmentRelease(
          session.assignmentRelease,
          session.dueAt,
      ).correctionsReleased) {
    return {...bookmark, answerAvailable: false};
  }

  // A cloud session has an explicit submission lifecycle. Do not reveal its
  // feedback until it has been submitted (and any assignment policy permits).
  if (session) {
    if (session.status !== "submitted" || !session.result) {
      return {...bookmark, answerAvailable: false};
    }
    const answers = Array.isArray(session.result.answers) ?
      session.result.answers : [];
    const answer = answers.find((row) => row.id === bookmark.id);
    if (!answer) return {...bookmark, answerAvailable: false};
    const correctIndex = answerIndexForBookmark(answer);
    return {
      ...bookmark,
      correctIndex,
      explanation: String(answer.explanation || ""),
      answerAvailable: correctIndex >= 0,
    };
  }

  // Downloaded/offline solo bookmarks have no cloud session to inspect. Once
  // their compact pointer is resolved against its pinned question bank, use
  // that immutable answer data rather than blanking a useful local snapshot.
  const questions = resolvedSource && Array.isArray(resolvedSource.questions) ?
    resolvedSource.questions : [];
  const question = questions.find((row) => row.id === bookmark.id);
  if (!question) return {...bookmark, answerAvailable: false};
  const correctIndex = answerIndexForBookmark(question);
  return {
    ...bookmark,
    correctIndex,
    explanation: String(question.explanation || ""),
    answerAvailable: correctIndex >= 0,
  };
}

/**
 * Read a valid zero-based answer index from either canonical field name.
 *
 * @param {Object} row Answer or normalized question
 * @return {number} Index, or -1 when unavailable
 */
function answerIndexForBookmark(row) {
  const raw = row && row.correctIndex !== undefined ?
    row.correctIndex : row && row.answerIndex;
  if (raw === undefined || raw === null || raw === "") return -1;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

/**
 * Return saved questions without grading data.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function getBookmarks(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const bootcamp = requireBootcamp(req.body && req.body.bootcamp);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    await assertLicenseActive(db, studentId, bootcamp);
    const rows = (await db.ref(
        `users/${studentId}/bookmarks/${bootcamp}`,
    ).once("value")).val() || {};
    const bookmarks = flattenBookmarkVersions(rows);
    const sessionIds = [...new Set(bookmarks
        .map((row) => String(row.sourceSessionId || ""))
        .filter(Boolean))];
    const sessions = await Promise.all(sessionIds.map(async (sessionId) => {
      const value = (await db.ref(
          `studentDrills/${studentId}/${sessionId}`,
      ).once("value")).val();
      return [sessionId, value];
    }));
    const sessionMap = new Map(sessions);
    const enrichedBookmarks = await Promise.all(bookmarks.map(
        async (bookmark) => {
          const session =
            sessionMap.get(String(bookmark.sourceSessionId || "")) || null;
          const source = session || await bookmarkQuestionSession(
              bookmark,
              bootcamp,
          );
          return bookmarkWithAnswer(
              hydrateBookmarkQuestion(bookmark, source, bootcamp),
              session,
              source,
          );
        },
    ));
    return res.status(200).json({
      ok: true,
      bootcamp,
      datasetVersion: datasetVersionFor(bootcamp),
      correctionRevision: correctionRevisionFor(bootcamp),
      bookmarks: enrichedBookmarks,
    });
  } catch (error) {
    return sendError(res, error, "Unable to load bookmarks");
  }
}

/**
 * Organize a bookmark into user-defined groups.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function setBookmarkGroups(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const bootcamp = requireBootcamp(req.body && req.body.bootcamp);
    const questionId = cleanSegment(req.body && req.body.questionId, 120);
    const rawGroups = req.body && req.body.groups;
    if (!questionId || !Array.isArray(rawGroups)) {
      const error = new Error("A valid bookmark group request is required");
      error.code = 400;
      throw error;
    }
    const groups = [...new Set(rawGroups
        .map((value) => String(value || "").trim().slice(0, 40))
        .filter(Boolean))]
        .slice(0, 10);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    await assertLicenseActive(db, studentId, bootcamp);
    const rootPath = `users/${studentId}/bookmarks/${bootcamp}`;
    const tree = (await db.ref(rootPath).once("value")).val() || {};
    const updates = {};
    Object.entries(tree).forEach(([versionKey, rows]) => {
      if (!rows || typeof rows !== "object") return;
      Object.entries(rows).forEach(([storedId, bookmark]) => {
        if (!bookmark || typeof bookmark !== "object") return;
        if (String(bookmark.id || bookmark.sourceId || "") !== questionId) {
          return;
        }
        updates[`${versionKey}/${storedId}/groups`] =
          groups.length ? groups : null;
      });
    });
    if (!Object.keys(updates).length) {
      const error = new Error("Bookmark was not found");
      error.code = 404;
      throw error;
    }
    await db.ref(rootPath).update(updates);
    return res.status(200).json({ok: true, questionId, groups});
  } catch (error) {
    return sendError(res, error, "Unable to update bookmark groups");
  }
}

/**
 * Delete one student-owned bookmark group from every bookmark in a bootcamp.
 * Groups are inferred from bookmark tags, so deleting a group means removing
 * that tag everywhere rather than deleting any saved questions.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function deleteBookmarkGroup(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const bootcamp = requireBootcamp(req.body && req.body.bootcamp);
    const group = String(req.body && req.body.group || "").trim().slice(0, 40);
    if (!group) {
      const error = new Error("A bookmark group is required");
      error.code = 400;
      throw error;
    }
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    await assertLicenseActive(db, studentId, bootcamp);
    const rootPath = `users/${studentId}/bookmarks/${bootcamp}`;
    const tree = (await db.ref(rootPath).once("value")).val() || {};
    const updates = {};
    Object.entries(tree).forEach(([versionKey, rows]) => {
      if (!rows || typeof rows !== "object") return;
      Object.entries(rows).forEach(([storedId, bookmark]) => {
        if (!bookmark || typeof bookmark !== "object" ||
            !Array.isArray(bookmark.groups) ||
            !bookmark.groups.includes(group)) return;
        const remaining = bookmark.groups.filter((item) => item !== group);
        updates[`${versionKey}/${storedId}/groups`] =
          remaining.length ? remaining : null;
      });
    });
    if (!Object.keys(updates).length) {
      const error = new Error("Bookmark group was not found");
      error.code = 404;
      throw error;
    }
    await db.ref(rootPath).update(updates);
    return res.status(200).json({ok: true, group});
  } catch (error) {
    return sendError(res, error, "Unable to delete bookmark group");
  }
}

module.exports = {
  bookmarkWithAnswer,
  createDrill,
  deleteBookmarkGroup,
  creditResult,
  datasetPathKey,
  ensureSessionCredit,
  flattenBookmarkVersions,
  getBookmarks,
  getCatalog,
  getHistory,
  getResult,
  getSession,
  hydrateBookmarkQuestion,
  licenseCoversSession,
  rankForPoints,
  saveProgress,
  setBookmark,
  setBookmarkGroups,
  submitDrill,
  submittedSessionValue,
};
