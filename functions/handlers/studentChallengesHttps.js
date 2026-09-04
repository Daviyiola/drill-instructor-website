"use strict";

const crypto = require("crypto");
const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");
const {
  blockSetsFor,
  canSendChallenge,
  isBlockedBySets,
} = require("./_socialPolicy");
const {
  cleanSegment,
  correctionRevisionFor,
  datasetVersionFor,
  normalizedQuestions,
  publicSession,
  resolveStudent,
  subjectTimerKey,
} = require("./_studentDrill");
const {progressForSession, sessionStorageUpdates} =
  require("./_studentDrillProgress");

/**
 * Reject unsupported methods and handle CORS.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {boolean} Whether the request was handled
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
 * Send a stable error response.
 *
 * @param {Object} res Express response
 * @param {*} error Caught error
 * @param {string} fallback Fallback message
 * @return {Object} Express response
 */
function sendError(res, error, fallback) {
  const code = Number.isInteger(error && error.code) ? error.code : 500;
  return res.status(code).json({
    error: error && error.message ? error.message : fallback,
  });
}

/**
 * Convert RTDB arrays/maps to row arrays.
 *
 * @param {*} value Candidate collection
 * @return {Object[]} Values
 */
function collectionValues(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).filter(Boolean);
}

/**
 * Coerce a stored metric to a finite, non-negative number.
 *
 * @param {*} value Candidate value
 * @param {number} fallback Fallback value
 * @return {number} Safe metric
 */
function metricNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

/**
 * Expose only aggregate challenge-result breakdowns. Question ids, answers,
 * selections, explanations, and corrections deliberately stay server-side.
 *
 * @param {*} rows Stored subject/module summaries
 * @param {boolean} includeModule Whether module names should be included
 * @return {Object[]} Safe aggregate rows
 */
function publicChallengeBreakdowns(rows, includeModule) {
  return collectionValues(rows).map((value) => {
    const row = value && typeof value === "object" ? value : {};
    const attempted = metricNumber(row.attempted);
    const correct = metricNumber(row.correct);
    const usedSec = metricNumber(
        row.usedSec !== undefined ? row.usedSec : row.timeSec,
    );
    const result = {
      subject: String(row.subject || row.code || ""),
      totalQ: metricNumber(row.totalQ, attempted),
      attempted,
      correct,
      wrong: metricNumber(row.wrong, Math.max(0, attempted - correct)),
      unanswered: metricNumber(row.unanswered),
      scorePct: metricNumber(
          row.scorePct,
          attempted ? Math.round((correct / attempted) * 100) : 0,
      ),
      usedSec,
      averageTimeSec: metricNumber(
          row.averageTimeSec,
          attempted ? usedSec / attempted : 0,
      ),
    };
    if (includeModule) {
      result.module = String(row.module || row.code || "General");
    }
    return result;
  });
}

/**
 * Summarize challenge content for inbox cards without exposing question ids.
 *
 * @param {Object} challenge Stored challenge document
 * @return {{subjectCount:number, questionCount:number, totalTimeMin:number}}
 */
function challengeSummary(challenge) {
  const subjects = collectionValues(
      challenge && challenge.subjects,
  );
  return subjects.reduce((summary, subject) => {
    const questionCount = Number(
        subject.numQ || subject.numQuestions ||
        collectionValues(subject.questionIds).length,
    );
    const timeLimitMin = Number(
        subject.timeLimitMin || subject.timeLimit || 0,
    );
    return {
      subjectCount: summary.subjectCount + 1,
      questionCount: summary.questionCount +
        (Number.isFinite(questionCount) ? Math.max(0, questionCount) : 0),
      totalTimeMin: summary.totalTimeMin +
        (Number.isFinite(timeLimitMin) ? Math.max(0, timeLimitMin) : 0),
    };
  }, {subjectCount: 0, questionCount: 0, totalTimeMin: 0});
}

/**
 * Map a participant row to the mobile-inspired three-stage inbox.
 *
 * @param {Object} row User challenge row
 * @param {number} now Current epoch milliseconds
 * @return {string} incoming, accepted, completed, or hidden
 */
function challengeStage(row, now = Date.now()) {
  const status = String(row && row.status || "").toLowerCase();
  const expired = row && row.expiresAt &&
    Date.parse(row.expiresAt) <= now;
  if (status === "declined") return "hidden";
  if (status === "completed" || status === "expired" || expired) {
    return "completed";
  }
  if (status === "pending") return "incoming";
  if (status === "accepted" || status === "sent") return "accepted";
  return "hidden";
}

/**
 * Return the authenticated student's challenge inbox.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function getChallenges(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const requestedBootcamp = String(
        req.body && req.body.bootcamp || "",
    ).toLowerCase();
    if (!requestedBootcamp) {
      const error = new Error("A valid bootcamp is required");
      error.code = 400;
      throw error;
    }
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    await assertLicenseActive(db, studentId, requestedBootcamp);
    const tree = (await db.ref(
        `users/${studentId}/userChallenges`,
    ).once("value")).val() || {};
    const blockSets = await blockSetsFor(db, studentId);
    const inboxRows = Object.entries(tree)
        .map(([challengeId, value]) => {
          const row = value && typeof value === "object" ? value : {};
          const stage = challengeStage(row);
          const expired = row.expiresAt &&
            Date.parse(row.expiresAt) <= Date.now() &&
            String(row.status || "").toLowerCase() !== "completed";
          return {
            challengeId,
            role: String(row.role || ""),
            status: expired ? "expired" : String(row.status || ""),
            stage,
            bootcamp: String(row.bootcamp || "").toLowerCase(),
            datasetVersion: String(row.datasetVersion || ""),
            senderCustomId: String(row.senderCustomId || ""),
            senderDisplay: String(row.senderDisplay || "Squad mate"),
            senderAvatarNumber: Number(row.senderAvatarNumber || 1),
            senderCurrentRank: String(row.senderCurrentRank || ""),
            createdAt: String(row.createdAt || ""),
            expiresAt: String(row.expiresAt || ""),
            completedAt: String(row.completedAt || ""),
            sessionId: String(row.sessionId || ""),
          };
        })
        .filter((row) => row.stage !== "hidden")
        .filter((row) => !row.senderCustomId ||
          row.senderCustomId === studentId ||
          !isBlockedBySets(blockSets, row.senderCustomId))
        .filter((row) => !requestedBootcamp ||
          row.bootcamp === requestedBootcamp)
        .sort((a, b) => Date.parse(b.createdAt || 0) -
          Date.parse(a.createdAt || 0));
    const challenges = await Promise.all(inboxRows.map(async (row) => {
      const challenge = (await db.ref(
          `challenges/${row.challengeId}`,
      ).once("value")).val() || {};
      return {
        ...row,
        ...challengeSummary(challenge),
      };
    }));
    return res.status(200).json({ok: true, challenges});
  } catch (error) {
    return sendError(res, error, "Unable to load squad challenges");
  }
}

/**
 * Sanitize a revealed challenge result for the scoreboard.
 *
 * @param {string} customId Participant custom id
 * @param {Object} value Stored result
 * @return {Object} Public scoreboard row
 */
function publicChallengeResult(customId, value) {
  const row = value && typeof value === "object" ? value : {};
  const participant = row.participant &&
    typeof row.participant === "object" ? row.participant : {};
  const snapshot = row.snapshot && typeof row.snapshot === "object" ?
    row.snapshot : {};
  const summary = snapshot.summary && typeof snapshot.summary === "object" ?
    snapshot.summary : {};
  const attempted = metricNumber(
      row.attempted !== undefined ? row.attempted : summary.attempted,
  );
  const correct = metricNumber(
      row.correct !== undefined ? row.correct : summary.correct,
  );
  const usedSec = metricNumber(
      row.usedSec !== undefined ? row.usedSec :
        (summary.usedSec !== undefined ? summary.usedSec :
          metricNumber(row.timeMs) / 1000),
  );
  return {
    customId,
    displayName: String(participant.displayName || "Squad mate"),
    avatarNumber: Number(
        participant.avatarNumber || participant.avaterNumber || 1,
    ),
    currentRank: String(participant.currentRank || ""),
    attempted,
    correct,
    totalQ: metricNumber(
        row.totalQ !== undefined ? row.totalQ : summary.totalQ,
        attempted,
    ),
    wrong: metricNumber(
        row.wrong !== undefined ? row.wrong : summary.wrong,
        Math.max(0, attempted - correct),
    ),
    unanswered: metricNumber(
        row.unanswered !== undefined ? row.unanswered : summary.unanswered,
    ),
    scorePct: metricNumber(
        summary.scorePct,
        attempted ? Math.round((correct / attempted) * 100) : 0,
    ),
    usedSec,
    averageTimeSec: metricNumber(
        summary.averageTimeSec !== undefined ?
          summary.averageTimeSec : summary.meanSec,
        attempted ? usedSec / attempted : 0,
    ),
    points: metricNumber(
        row.points !== undefined ? row.points : summary.points,
    ),
    subjects: publicChallengeBreakdowns(snapshot.subjects, false),
    modules: publicChallengeBreakdowns(snapshot.modules, true),
    finishedAt: String(row.finishedAt || ""),
  };
}

/**
 * Sanitize one creator-visible challenge participant status.
 *
 * @param {string} customId Participant custom id
 * @param {Object} profile Stored user profile
 * @param {Object} inbox Stored participant challenge row
 * @param {string} creatorId Challenge creator custom id
 * @param {boolean} expired Whether the challenge deadline has passed
 * @param {boolean} hasResult Whether a submitted result exists
 * @return {Object} Public participant tracker row
 */
function publicChallengeParticipant(
    customId,
    profile,
    inbox,
    creatorId,
    expired,
    hasResult,
) {
  const user = profile && typeof profile === "object" ? profile : {};
  const row = inbox && typeof inbox === "object" ? inbox : {};
  const displayName = [
    String(user.firstName || "").trim(),
    String(user.lastName || "").trim(),
  ].filter(Boolean).join(" ") || customId;
  const rawStatus = String(row.status || "pending").toLowerCase();
  const completed = rawStatus === "completed" || hasResult;
  return {
    customId,
    displayName,
    avatarNumber: Number(user.avatarNumber || user.avaterNumber || 1),
    currentRank: String(user.currentRank || ""),
    role: customId === creatorId ? "creator" : "recipient",
    status: expired && !completed ? "not_completed" : rawStatus,
    completed,
    completedAt: String(row.completedAt || ""),
    reinviteCount: challengeReinviteCount(row),
  };
}

/**
 * Count re-invitations without counting the original invitation.
 *
 * @param {Object} value Stored participant challenge row
 * @return {number} Number of re-invitations already sent
 */
function challengeReinviteCount(value) {
  const attempt = Number(value && value.inviteAttempt || 1);
  if (!Number.isFinite(attempt)) return 0;
  return Math.max(0, Math.floor(attempt) - 1);
}

/**
 * Reset a declined participant row for a fresh invitation.
 *
 * @param {Object} value Stored participant challenge row
 * @param {string} nowIso Re-invitation timestamp
 * @return {Object|null} Updated row, or null when it cannot be re-invited
 */
function reinvitedChallengeRow(value, nowIso) {
  if (!value || typeof value !== "object" ||
      String(value.status || "").toLowerCase() !== "declined" ||
      challengeReinviteCount(value) >= 2) {
    return null;
  }
  const row = {...value};
  row.status = "pending";
  row.reinvitedAt = nowIso;
  row.updatedAt = nowIso;
  row.inviteAttempt = Math.max(1, Number(row.inviteAttempt || 1)) + 1;
  delete row.declinedAt;
  delete row.declineReason;
  return row;
}

/**
 * Let a challenge creator re-invite a participant who previously declined.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function reinviteParticipant(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const challengeId = cleanSegment(
        req.body && req.body.challengeId,
        120,
    );
    const recipientCustomId = cleanSegment(
        req.body && req.body.recipientCustomId,
        180,
    );
    if (!challengeId || !recipientCustomId) {
      const error = new Error("A valid challenge and recipient are required");
      error.code = 400;
      throw error;
    }

    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const [challengeSnap, creatorInboxSnap, recipientInboxSnap] =
      await Promise.all([
        db.ref(`challenges/${challengeId}`).once("value"),
        db.ref(`users/${studentId}/userChallenges/${challengeId}`)
            .once("value"),
        db.ref(`users/${recipientCustomId}/userChallenges/${challengeId}`)
            .once("value"),
      ]);
    const challenge = challengeSnap.val();
    const creatorInbox = creatorInboxSnap.val();
    const recipientInbox = recipientInboxSnap.val();

    if (!challenge || !creatorInbox ||
        String(challenge.createdByCustomId || "") !== studentId ||
        String(creatorInbox.role || "") !== "sender") {
      const error = new Error("Only the challenge creator can re-invite");
      error.code = 403;
      throw error;
    }
    await assertLicenseActive(db, studentId, challenge.bootcamp);
    if (challenge.status !== "open" ||
        Date.parse(challenge.expiresAt || 0) <= Date.now()) {
      const error = new Error("This challenge is no longer active");
      error.code = 410;
      throw error;
    }
    if (recipientCustomId === studentId ||
        !Array.isArray(challenge.participantsCustomIds) ||
        !challenge.participantsCustomIds.includes(recipientCustomId) ||
        !recipientInbox || String(recipientInbox.role || "") !== "recipient") {
      const error = new Error("That recipient is not part of this challenge");
      error.code = 404;
      throw error;
    }
    if (String(recipientInbox.status || "").toLowerCase() === "pending") {
      return res.status(200).json({
        ok: true,
        state: "pending",
        reinviteCount: challengeReinviteCount(recipientInbox),
      });
    }
    if (String(recipientInbox.status || "").toLowerCase() !== "declined") {
      const error = new Error("Only a declined invitation can be re-sent");
      error.code = 409;
      throw error;
    }
    if (challengeReinviteCount(recipientInbox) >= 2) {
      const error = new Error(
          "This participant has already received the maximum two re-invites",
      );
      error.code = 429;
      throw error;
    }

    const socialPolicy = await canSendChallenge(
        db, studentId, recipientCustomId,
    );
    if (!socialPolicy.allowed) {
      const error = new Error("This recipient is unavailable");
      error.code = 409;
      throw error;
    }

    const nowIso = new Date().toISOString();
    const recipientRef = db.ref(
        `users/${recipientCustomId}/userChallenges/${challengeId}`,
    );
    const transactionResult = await recipientRef.transaction((current) => {
      // Admin RTDB transactions can invoke the first callback with an uncached
      // null value before retrying with the remote row. The participant row was
      // read and validated immediately above, so use it for that cold pass.
      const source = current === null ? recipientInbox : current;
      const next = reinvitedChallengeRow(source, nowIso);
      if (!next) return;
      return next;
    });
    if (!transactionResult.committed) {
      const latest = (await recipientRef.once("value")).val();
      if (String(latest && latest.status || "").toLowerCase() === "pending") {
        return res.status(200).json({
          ok: true,
          state: "pending",
          reinviteCount: challengeReinviteCount(latest),
        });
      }
      if (challengeReinviteCount(latest) >= 2) {
        const error = new Error(
            "This participant has already received the maximum two re-invites",
        );
        error.code = 429;
        throw error;
      }
      const error = new Error(
          "The invitation status changed; refresh and retry",
      );
      error.code = 409;
      throw error;
    }
    const updated = transactionResult.snapshot.val();
    return res.status(200).json({
      ok: true,
      state: "pending",
      reinviteCount: challengeReinviteCount(updated),
    });
  } catch (error) {
    return sendError(res, error, "Unable to re-invite squad mate");
  }
}

/**
 * Return one participant-scoped challenge document and revealed scoreboard.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function getChallenge(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const challengeId = cleanSegment(
        req.body && req.body.challengeId,
        120,
    );
    if (!challengeId) {
      const error = new Error("A valid challenge is required");
      error.code = 400;
      throw error;
    }
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const [challengeSnap, inboxSnap] = await Promise.all([
      db.ref(`challenges/${challengeId}`).once("value"),
      db.ref(
          `users/${studentId}/userChallenges/${challengeId}`,
      ).once("value"),
    ]);
    const challenge = challengeSnap.val();
    const inbox = inboxSnap.val();
    if (!challenge || !inbox ||
        !Array.isArray(challenge.participantsCustomIds) ||
        !challenge.participantsCustomIds.includes(studentId)) {
      const error = new Error("Challenge was not found");
      error.code = 404;
      throw error;
    }
    const blockSets = await blockSetsFor(db, studentId);
    const creatorId = String(challenge.createdByCustomId || "");
    if (creatorId !== studentId && isBlockedBySets(blockSets, creatorId)) {
      const error = new Error("Challenge was not found");
      error.code = 404;
      throw error;
    }
    await assertLicenseActive(db, studentId, challenge.bootcamp);
    const expired = Date.parse(challenge.expiresAt || 0) <= Date.now();
    const reveal = challenge.reveal === true ||
      challenge.status === "completed" ||
      challenge.status === "expired" ||
      expired;
    const isCreator = String(inbox.role || "") === "sender" &&
      String(challenge.createdByCustomId || "") === studentId;
    let results = [];
    let resultTree = {};
    if (reveal || isCreator) {
      resultTree = (await db.ref(
          `challengeResults/${challengeId}`,
      ).once("value")).val() || {};
    }
    if (reveal) {
      results = Object.entries(resultTree)
          .filter(([customId]) => customId === studentId ||
            !isBlockedBySets(blockSets, customId))
          .map(([customId, value]) =>
            publicChallengeResult(customId, value))
          .sort((a, b) => b.correct - a.correct ||
            a.usedSec - b.usedSec);
    }
    let participants = [];
    if (isCreator) {
      participants = await Promise.all(
          challenge.participantsCustomIds
              .filter((customId) => customId === studentId ||
                !isBlockedBySets(blockSets, customId))
              .map(async (customId) => {
                const [profileRow, participantInbox] = await Promise.all([
                  db.ref(`users/${customId}`).once("value"),
                  db.ref(
                      `users/${customId}/userChallenges/${challengeId}`,
                  ).once("value"),
                ]);
                return publicChallengeParticipant(
                    customId,
                    profileRow.val(),
                    participantInbox.val(),
                    studentId,
                    expired,
                    Boolean(resultTree[customId]),
                );
              }),
      );
    }
    return res.status(200).json({
      ok: true,
      challenge: {
        challengeId,
        bootcamp: String(challenge.bootcamp || ""),
        datasetVersion: String(challenge.datasetVersion || ""),
        subjects: collectionValues(challenge.subjects).map((subject) => ({
          subject: String(subject.subject || ""),
          numQ: Number(subject.numQ || subject.numQuestions ||
            collectionValues(subject.questionIds).length),
          timeLimitMin: Number(
              subject.timeLimitMin || subject.timeLimit || 0,
          ),
          questionIds: collectionValues(subject.questionIds)
              .map(String),
          filters: subject.filters || {},
        })),
        createdAt: String(challenge.createdAt || ""),
        expiresAt: String(challenge.expiresAt || ""),
        status: String(challenge.status || ""),
        reveal,
        role: String(inbox.role || ""),
        participantStatus: String(inbox.status || ""),
        senderDisplay: String(inbox.senderDisplay || "Squad mate"),
        senderAvatarNumber: Number(inbox.senderAvatarNumber || 1),
        sessionId: String(inbox.sessionId || ""),
        participantCount: challenge.participantsCustomIds.length,
        participants,
        results,
      },
    });
  } catch (error) {
    return sendError(res, error, "Unable to load squad challenge");
  }
}

/**
 * Resolve a challenge blueprint to the exact signed question selection.
 *
 * @param {Object} challenge Stored challenge
 * @return {{config:Object[], questions:Object[]}} Paper
 */
function challengePaper(challenge) {
  const all = normalizedQuestions(challenge.bootcamp);
  const selected = [];
  const config = [];
  const seen = new Set();
  collectionValues(challenge.subjects).forEach((subjectRow) => {
    const subject = String(subjectRow.subject || "");
    const ids = collectionValues(subjectRow.questionIds).map(String);
    const questions = ids.map((id) => {
      const legacySourceId = id.split(/::|#/).pop();
      return all.find((question) =>
        question.subject === subject &&
        (question.id === id ||
          question.sourceId === id ||
          question.sourceId === legacySourceId),
      );
    }).filter(Boolean);
    questions.forEach((question) => {
      if (!seen.has(question.id)) {
        seen.add(question.id);
        selected.push(question);
      }
    });
    if (questions.length) {
      config.push({
        subject,
        questionCount: questions.length,
        timeLimitMin: Math.max(
            5,
            Number(subjectRow.timeLimitMin ||
              subjectRow.timeLimit || 5),
        ),
        modules: [...new Set(questions.map((row) => row.module))],
        practiceYears: [
          ...new Set(questions.map((row) => row.practiceYear)),
        ],
      });
    }
  });
  if (!selected.length) {
    const error = new Error("Challenge questions are unavailable");
    error.code = 409;
    throw error;
  }
  return {config, questions: selected};
}

/**
 * Create or resume a server-owned drill session for an accepted challenge.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function createChallengeSession(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const challengeId = cleanSegment(
        req.body && req.body.challengeId,
        120,
    );
    if (!challengeId) {
      const error = new Error("A valid challenge is required");
      error.code = 400;
      throw error;
    }
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const [challengeSnap, inboxSnap] = await Promise.all([
      db.ref(`challenges/${challengeId}`).once("value"),
      db.ref(
          `users/${studentId}/userChallenges/${challengeId}`,
      ).once("value"),
    ]);
    const challenge = challengeSnap.val();
    const inbox = inboxSnap.val();
    if (!challenge || !inbox ||
        !Array.isArray(challenge.participantsCustomIds) ||
        !challenge.participantsCustomIds.includes(studentId)) {
      const error = new Error("Challenge was not found");
      error.code = 404;
      throw error;
    }
    const blockSets = await blockSetsFor(db, studentId);
    const creatorId = String(challenge.createdByCustomId || "");
    if (creatorId !== studentId && isBlockedBySets(blockSets, creatorId)) {
      const error = new Error("Challenge was not found");
      error.code = 404;
      throw error;
    }
    if (inbox.status !== "accepted") {
      const error = new Error("Accept this challenge before starting");
      error.code = 409;
      throw error;
    }
    if (challenge.status !== "open" ||
        Date.parse(challenge.expiresAt || 0) <= Date.now()) {
      const error = new Error("This challenge is no longer active");
      error.code = 410;
      throw error;
    }
    await assertLicenseActive(db, studentId, challenge.bootcamp);
    if (String(challenge.datasetVersion || "") !==
        datasetVersionFor(challenge.bootcamp)) {
      const error = new Error(
          "This challenge uses a question-bank version that is unavailable",
      );
      error.code = 409;
      throw error;
    }
    const suffix = crypto.createHash("sha256").update(studentId)
        .digest("hex").slice(0, 12);
    const sessionId = `challenge_${challengeId}_${suffix}`;
    const sessionRef = db.ref(
        `studentDrills/${studentId}/${sessionId}`,
    );
    const existing = (await sessionRef.once("value")).val();
    if (existing) {
      const progress = (await db.ref(
          `studentDrillProgress/${studentId}/${sessionId}`,
      ).once("value")).val();
      return res.status(200).json({
        ok: true,
        session: publicSession(progressForSession(existing, progress)),
      });
    }
    const paper = challengePaper(challenge);
    const createdAt = Date.now();
    const timers = {};
    paper.config.forEach((row) => {
      timers[subjectTimerKey(row.subject)] = row.timeLimitMin * 60;
    });
    const session = {
      sessionId,
      studentId,
      status: "active",
      mode: "challenge",
      challengeId,
      bootcamp: challenge.bootcamp,
      datasetVersion: challenge.datasetVersion,
      correctionRevision: Number(
          challenge.correctionRevision !== undefined ?
            challenge.correctionRevision :
            correctionRevisionFor(challenge.bootcamp),
      ),
      createdAt,
      updatedAt: createdAt,
      config: paper.config,
      questions: paper.questions,
      answers: {},
      bookmarks: {},
      flags: {},
      questionTimes: {},
      timers,
      currentQuestionId: paper.questions[0].id,
    };
    await db.ref().update({
      ...sessionStorageUpdates(studentId, session),
      [`users/${studentId}/userChallenges/${challengeId}/sessionId`]:
        sessionId,
      [`users/${studentId}/userChallenges/${challengeId}/startedAt`]:
        new Date(createdAt).toISOString(),
    });
    return res.status(201).json({
      ok: true,
      session: publicSession(session),
    });
  } catch (error) {
    return sendError(res, error, "Unable to start squad challenge");
  }
}

module.exports = {
  challengePaper,
  challengeReinviteCount,
  challengeSummary,
  challengeStage,
  createChallengeSession,
  getChallenge,
  getChallenges,
  publicChallengeParticipant,
  publicChallengeBreakdowns,
  publicChallengeResult,
  reinviteParticipant,
  reinvitedChallengeRow,
};
