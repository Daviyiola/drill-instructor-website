"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");
const unzipper = require("unzipper");
const {getDatabase} = require("firebase-admin/database");
const {getStorage} = require("firebase-admin/storage");
const {allowCors, requireBearerUid} = require("./_auth");
const {assertLicenseActive} = require("./_license");
const {
  CONTENT_PACK_GRANT_SECRET,
  signOfflineGrant,
  verifyOfflineGrant,
} = require("./_contentPackGrant");
const {
  SUPPORTED_BOOTCAMPS,
  cleanSegment,
  correctionRevisionFor,
  datasetVersionFor,
  gradeSession,
  normalizedQuestions,
  resolveStudent,
} = require("./_studentDrill");
const {analyticsAttemptFromResult} = require("./_analytics");
const {creditResult, rankForPoints} = require("./studentDrillsHttps");
const {recordStreak} = require("./_streaks");

async function recordOfflineStreak(db, studentId, session, result, body) {
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

const archivedBankCache = new Map();

function rejectNonPost(req, res) {
  if (allowCors(req, res)) return true;
  if (req.method !== "POST") {
    res.status(405).json({error: "Method not allowed"});
    return true;
  }
  return false;
}

function sendError(res, error, fallback) {
  const code = Number(error && error.code);
  if ([400, 401, 403, 404, 409].includes(code)) {
    return res.status(code).json({error: error.message});
  }
  console.error("STUDENT_CONTENT_PACK_FAILED", {
    message: error && error.message || "Unknown error",
  });
  return res.status(500).json({error: fallback});
}

function requireBootcamp(value) {
  const bootcamp = String(value || "").trim().toLowerCase();
  if (!SUPPORTED_BOOTCAMPS.includes(bootcamp)) {
    const error = new Error("This bootcamp does not have a content pack");
    error.code = 404;
    throw error;
  }
  return bootcamp;
}

async function signedObject(objectPath) {
  if (!objectPath) return null;
  const expiresAt = Date.now() + (15 * 60 * 1000);
  const [signedUrl] = await getStorage().bucket().file(objectPath)
      .getSignedUrl({version: "v4", action: "read", expires: expiresAt});
  return {signedUrl, urlExpiresAt: new Date(expiresAt).toISOString()};
}

async function registryEntry(db, bootcamp) {
  const value = (await db.ref(`contentPackRegistry/${bootcamp}`)
      .once("value")).val();
  if (!value || !value.activeVersion || !value.base) {
    const error = new Error("This content pack has not been published yet");
    error.code = 404;
    throw error;
  }
  return value;
}

async function getContentPack(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const bootcamp = requireBootcamp(req.body && req.body.bootcamp);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const registry = await registryEntry(db, bootcamp);
    let license = null;
    try {
      license = await assertLicenseActive(db, studentId, bootcamp);
    } catch (_) {
      license = null;
    }
    const installedVersion = String(
        req.body && req.body.installedVersion || "",
    );
    const installedRevision = Number(
        req.body && req.body.installedCorrectionRevision || 0,
    );
    const packageLink = license ? await signedObject(
        registry.base.objectPath,
    ) : null;
    // Corrections remain available to an already-installed base even after an
    // entitlement expires, because known answer/content fixes must propagate.
    const correctionAvailable = installedVersion === registry.activeVersion &&
      installedRevision < Number(registry.latestCorrectionRevision || 0);
    const correctionLink = correctionAvailable ? await signedObject(
        registry.correction && registry.correction.objectPath,
    ) : null;
    const entitlementExpiresAt = license ?
      String(license.expirationDate || "") : null;
    const grant = license ? signOfflineGrant({
      v: 1,
      studentId,
      bootcamp,
      datasetVersion: registry.activeVersion,
      issuedAt: new Date().toISOString(),
      entitlementExpiresAt,
      nonce: crypto.randomBytes(12).toString("base64url"),
    }) : null;
    return res.status(200).json({
      ok: true,
      bootcamp,
      licensed: Boolean(license),
      datasetVersion: registry.activeVersion,
      correctionRevision: Number(registry.latestCorrectionRevision || 0),
      freePracticeTests: [1, 2],
      packageSizeBytes: Number(registry.base.sizeBytes || 0),
      questionCount: Number(registry.questionCount || 0),
      packageSha256: String(registry.base.sha256 || ""),
      package: packageLink ? {
        ...packageLink,
        sizeBytes: Number(registry.base.sizeBytes || 0),
        questionCount: Number(registry.questionCount || 0),
        sha256: String(registry.base.sha256 || ""),
      } : null,
      correction: correctionLink ? {
        ...correctionLink,
        revision: Number(registry.latestCorrectionRevision || 0),
        sizeBytes: Number(registry.correction.sizeBytes || 0),
        sha256: String(registry.correction.sha256 || ""),
      } : null,
      offlineGrant: grant,
      entitlementExpiresAt,
    });
  } catch (error) {
    return sendError(res, error, "Unable to load content-pack information");
  }
}

function safeMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ?
    value : {};
}

function validGrant(value, expected, startedAt) {
  const grant = verifyOfflineGrant(value);
  if (!grant || grant.v !== 1 || grant.studentId !== expected.studentId ||
      grant.bootcamp !== expected.bootcamp ||
      grant.datasetVersion !== expected.datasetVersion) return false;
  const issuedMs = Date.parse(grant.issuedAt || "");
  const expiryMs = Date.parse(grant.entitlementExpiresAt || "");
  const startMs = Date.parse(startedAt || "");
  return Number.isFinite(issuedMs) && Number.isFinite(expiryMs) &&
    Number.isFinite(startMs) && startMs + (5 * 60 * 1000) >= issuedMs &&
    startMs < expiryMs;
}

async function storageObjectBuffer(objectPath) {
  const [buffer] = await getStorage().bucket().file(objectPath).download();
  return buffer;
}

async function archivedQuestions(bootcamp, datasetVersion,
    correctionRevision) {
  const cacheKey = `${bootcamp}:${datasetVersion}:${correctionRevision}`;
  if (archivedBankCache.has(cacheKey)) return archivedBankCache.get(cacheKey);

  try {
    const zipPath = `content-packs/${bootcamp}/${datasetVersion}/base/pack.zip`;
    const directory = await unzipper.Open.buffer(
        await storageObjectBuffer(zipPath),
    );
    const entries = new Map(directory.files
        .filter((entry) => entry.type === "File")
        .map((entry) => [entry.path, entry]));
    const manifestEntry = entries.get("manifest.json");
    if (!manifestEntry) throw new Error("Archive manifest is missing");
    const manifestBuffer = await manifestEntry.buffer();
    const manifest = JSON.parse(manifestBuffer.toString("utf8"));
    if (manifest.bootcamp !== bootcamp ||
        manifest.datasetVersion !== datasetVersion ||
        ![1, 2].includes(Number(manifest.schemaVersion))) {
      throw new Error("Archive manifest does not match this attempt");
    }
    let changes = {};
    if (correctionRevision > 0) {
      const correctionPath = `content-packs/${bootcamp}/${datasetVersion}/` +
        `corrections/${correctionRevision}.json`;
      const correction = JSON.parse((await storageObjectBuffer(correctionPath))
          .toString("utf8"));
      if (correction.bootcamp !== bootcamp ||
          correction.datasetVersion !== datasetVersion ||
          Number(correction.revision) !== correctionRevision ||
          correction.cumulative !== true) {
        throw new Error("Correction overlay does not match this attempt");
      }
      changes = correction.changes || {};
    }
    const questions = [];
    for (const chunk of manifest.chunks || []) {
      const entry = entries.get(String(chunk.path || ""));
      if (!entry) throw new Error(`Archive chunk is missing: ${chunk.path}`);
      const rows = JSON.parse((await entry.buffer()).toString("utf8"));
      for (const row of rows) {
        const corrected = {...row, ...(changes[row.id] || {})};
        questions.push({
          id: String(corrected.id || ""),
          legacyId: String(corrected.legacyId || ""),
          sourceId: String(corrected.sourceId || ""),
          subject: String(corrected.subject || ""),
          module: String(corrected.module || "General"),
          practiceYear: Number(corrected.practiceTest || 0),
          prompt: String(corrected.prompt || ""),
          options: Array.isArray(corrected.options) ? corrected.options : [],
          correctIndex: Number(corrected.answerIndex),
          explanation: String(corrected.explanation || ""),
          passage: String(corrected.passage || ""),
          imageSources: Array.isArray(corrected.imageSources) ?
            corrected.imageSources.map(String) :
            String(corrected.asset || "").split("|").filter(Boolean),
          disabled: corrected.disabled === true,
        });
      }
    }
    if (questions.length !== Number(manifest.questionCount || 0) ||
        questions.some((question) => !question.id ||
          question.correctIndex < 0 ||
          question.correctIndex >= question.options.length)) {
      throw new Error("Archived content failed question validation");
    }
    archivedBankCache.set(cacheKey, questions);
    return questions;
  } catch (error) {
    console.error("ARCHIVED_CONTENT_LOAD_FAILED", {
      bootcamp, datasetVersion, correctionRevision,
      message: error.message,
    });
    const unavailable = new Error(
        "This content version is not available for delayed grading",
    );
    unavailable.code = 409;
    throw unavailable;
  }
}

async function questionsForPinnedVersion(bootcamp, datasetVersion,
    correctionRevision) {
  if (datasetVersion === datasetVersionFor(bootcamp) &&
      correctionRevision === correctionRevisionFor(bootcamp)) {
    return normalizedQuestions(bootcamp);
  }
  return archivedQuestions(bootcamp, datasetVersion, correctionRevision);
}

async function submitOfflineDrill(req, res) {
  if (rejectNonPost(req, res)) return;
  try {
    const uid = await requireBearerUid(req);
    const body = req.body || {};
    const bootcamp = requireBootcamp(body.bootcamp);
    const attemptId = cleanSegment(body.attemptId, 80);
    if (!attemptId) {
      const error = new Error("A valid attemptId is required");
      error.code = 400;
      throw error;
    }
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const existingRef = db.ref(`studentDrills/${studentId}/${attemptId}`);
    const existing = (await existingRef.once("value")).val();
    if (existing && existing.status === "submitted" && existing.result) {
      const streak = await recordOfflineStreak(
          db, studentId, existing, existing.result, body,
      );
      return res.status(200).json({
        ok: true, result: existing.result, credit: existing.credit || null,
        streak, duplicate: true,
      });
    }

    const datasetVersion = String(body.datasetVersion || "");
    if (!/^\d{4}\.\d{2}\.\d+$/.test(datasetVersion)) {
      const error = new Error(
          "A valid content version is required",
      );
      error.code = 400;
      throw error;
    }
    const correctionRevision = Number(body.correctionRevision || 0);
    if (!Number.isInteger(correctionRevision) ||
        correctionRevision < 0 || correctionRevision > 9999) {
      const error = new Error(
          "A valid correction revision is required",
      );
      error.code = 400;
      throw error;
    }
    const questionIds = Array.isArray(body.questionIds) ?
      body.questionIds.map(String) : [];
    if (!questionIds.length || questionIds.length > 500 ||
        new Set(questionIds).size !== questionIds.length) {
      const error = new Error("A valid ordered question list is required");
      error.code = 400;
      throw error;
    }
    const pinnedQuestions = await questionsForPinnedVersion(
        bootcamp, datasetVersion, correctionRevision,
    );
    const allById = new Map(pinnedQuestions
        .map((question) => [question.id, question]));
    const questions = questionIds.map((id) => allById.get(id));
    if (questions.some((question) => !question || question.disabled)) {
      const error = new Error("The attempt contains an unavailable question");
      error.code = 400;
      throw error;
    }
    const freeOnly = questions.every((question) =>
      question.practiceYear === 1 || question.practiceYear === 2);
    const grantCovered = validGrant(body.offlineGrant, {
      studentId, bootcamp, datasetVersion,
    }, body.startedAt);
    if (!freeOnly && !grantCovered) {
      const error = new Error(
          "A valid offline entitlement grant is required for this attempt",
      );
      error.code = 403;
      throw error;
    }
    const startedMs = Date.parse(body.startedAt || "");
    const endedMs = Date.parse(body.endedAt || "");
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) ||
        endedMs < startedMs) {
      const error = new Error("Valid attempt start and end times are required");
      error.code = 400;
      throw error;
    }
    const requestedConfig = Array.isArray(body.config) ? body.config : [];
    const config = [...new Set(questions.map((question) => question.subject))]
        .map((subject) => {
          const requested = requestedConfig.find((row) =>
            String(row && row.subject || "") === subject) || {};
          const rows = questions.filter((question) =>
            question.subject === subject);
          return {
            subject,
            questionCount: rows.length,
            timeLimitMin: Math.min(
                300, Math.max(1, Number(requested.timeLimitMin || 30)),
            ),
            modules: [...new Set(rows.map((question) => question.module))],
            practiceYears: [...new Set(rows.map((question) =>
              question.practiceYear))],
          };
        });
    const session = {
      sessionId: attemptId,
      studentId,
      status: "submitted",
      mode: "practice",
      transport: "offline_pack",
      bootcamp,
      datasetVersion,
      correctionRevision,
      createdAt: startedMs,
      submittedAt: endedMs,
      updatedAt: endedMs,
      config,
      questions,
      answers: safeMap(body.answers),
      questionTimes: safeMap(body.questionTimes),
      timers: safeMap(body.timers),
    };
    const result = gradeSession(
        session, session.answers, session.timers, endedMs,
    );
    session.result = result;
    const attempt = analyticsAttemptFromResult({
      result,
      session,
      studentId,
      source: "solo",
      sourceId: attemptId,
    });
    const detail = {
      type: "results_snapshot",
      v: 2,
      attemptId,
      sessionId: attemptId,
      bootcamp,
      source: "solo",
      sourceId: attemptId,
      submittedAt: attempt.submittedAt,
      takenAt: attempt.submittedAt,
      createdAt: attempt.submittedAt,
      datasetVersion,
      correctionRevision: session.correctionRevision,
      summary: result.summary,
      subjects: result.subjects,
      modules: result.modules,
      resultPath: `studentDrills/${studentId}/${attemptId}/result`,
      gradingVersion: "server-v1",
    };
    const claim = await existingRef.transaction((current) => {
      if (current) return;
      return session;
    });
    if (!claim.committed) {
      const winner = (await existingRef.once("value")).val();
      if (winner && winner.status === "submitted" && winner.result) {
        const streak = await recordOfflineStreak(
            db, studentId, winner, winner.result, body,
        );
        return res.status(200).json({
          ok: true, result: winner.result, credit: winner.credit || null,
          streak, duplicate: true,
        });
      }
      const error = new Error("This attemptId is already in use");
      error.code = 409;
      throw error;
    }
    await db.ref().update({
      [`users/${studentId}/statsIndex/${attemptId}`]: attempt,
      [`users/${studentId}/stats/${attemptId}`]: detail,
    });
    const credit = await creditResult(
        db, studentId, session, result, grantCovered,
    );
    await existingRef.child("credit").set(credit);
    await db.ref(`users/${studentId}/statsIndex/${attemptId}/credited`)
        .set(credit.deltaPoints > 0);
    const streak = await recordOfflineStreak(
        db, studentId, session, result, body,
    );
    const totalPoints = Number((await db.ref(`users/${studentId}/totalPoints`)
        .once("value")).val() || 0);
    await db.ref(`users/${studentId}`).update(rankForPoints(totalPoints));
    return res.status(200).json({
      ok: true, result, credit, streak, duplicate: false,
    });
  } catch (error) {
    return sendError(res, error, "Unable to synchronize offline drill");
  }
}

module.exports = {
  CONTENT_PACK_GRANT_SECRET,
  getContentPack,
  submitOfflineDrill,
  validGrant,
  questionsForPinnedVersion,
};
