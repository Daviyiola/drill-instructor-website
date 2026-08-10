"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");
const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {
  cleanSegment,
  correctionRevisionFor,
  datasetVersionFor,
  normalizedQuestions,
  publicSession,
  resolveStudent,
  subjectTimerKey,
} = require("./_studentDrill");
const {normalizeRelease} = require("./_analytics");

function releaseFromDrill(drill) {
  const settings = drill.settings || {};
  return normalizeRelease(drill.release || {
    scorePolicy: settings.scorePolicy ||
      (settings.showScoreImmediately === false ? "manual" : "immediate"),
    correctionPolicy: settings.correctionPolicy ||
      (settings.showCorrectionsImmediately === true ? "immediate" : "manual"),
    scoreReleasedAt: null,
    correctionsReleasedAt: null,
  });
}

function assignmentPaper(drill) {
  const blueprint = drill.blueprint || {};
  if (String(blueprint.datasetVersion || "") !==
      datasetVersionFor(drill.bootcamp)) {
    const error = new Error(
        "This assignment question-bank version is unavailable",
    );
    error.code = 409;
    throw error;
  }
  const all = normalizedQuestions(drill.bootcamp);
  const questions = [];
  const config = [];
  const seen = new Set();
  (blueprint.subjects || []).forEach((row) => {
    const subject = String(row.subject || "");
    const selected = (row.questionIds || []).map((rawId) => {
      const id = String(rawId);
      const legacyId = id.split(/::|#/).pop();
      return all.find((question) => question.subject === subject &&
        (question.id === id || question.sourceId === id ||
          question.sourceId === legacyId));
    }).filter(Boolean).filter((question) => {
      if (seen.has(question.id)) return false;
      seen.add(question.id);
      return true;
    });
    if (!selected.length) return;
    questions.push(...selected);
    config.push({
      subject,
      questionCount: selected.length,
      timeLimitMin: Math.max(1, Number(row.timeLimitMin || 1)),
      modules: [...new Set(selected.map((question) => question.module))],
      practiceYears: [...new Set(selected.map((question) =>
        question.practiceYear))],
    });
  });
  const expected = (blueprint.subjects || []).reduce((sum, row) =>
    sum + (row.questionIds || []).length, 0);
  if (!questions.length || questions.length !== expected) {
    const error = new Error("One or more assignment questions are unavailable");
    error.code = 409;
    throw error;
  }
  return {config, questions};
}

async function createAssignmentSession(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  try {
    const uid = await requireBearerUid(req);
    const drillId = cleanSegment(req.body && req.body.drillId, 140);
    if (!drillId) {
      const error = new Error("A valid assignment is required");
      error.code = 400;
      throw error;
    }
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const inbox = (await db.ref(`users/${studentId}/assignedDrills/${drillId}`)
        .once("value")).val();
    if (!inbox || !inbox.schoolId) {
      const error = new Error("Assignment was not found");
      error.code = 404;
      throw error;
    }
    if (!new Set(["assigned", "late", "started"]).has(inbox.status)) {
      const error = new Error("This assignment is not available to start");
      error.code = 409;
      throw error;
    }
    const drill = (await db.ref(
        `schools/${inbox.schoolId}/educatorDrills/${drillId}`,
    ).once("value")).val();
    if (!drill || drill.status !== "published" ||
        !drill.assignedStudents || !drill.assignedStudents[studentId]) {
      const error = new Error("This assignment is not currently available");
      error.code = 409;
      throw error;
    }
    const suffix = crypto.createHash("sha256")
        .update(`${studentId}\u0000${drillId}`).digest("hex").slice(0, 16);
    const sessionId = `assignment_${suffix}`;
    const ref = db.ref(`studentDrills/${studentId}/${sessionId}`);
    const existing = (await ref.once("value")).val();
    if (existing) {
      return res.status(200).json({ok: true, session: publicSession(existing)});
    }
    const paper = assignmentPaper(drill);
    const createdAt = Date.now();
    const timers = {};
    paper.config.forEach((row) => {
      timers[subjectTimerKey(row.subject)] = row.timeLimitMin * 60;
    });
    const session = {
      sessionId,
      studentId,
      status: "active",
      mode: "assignment",
      assignmentId: drillId,
      schoolId: inbox.schoolId,
      bootcamp: drill.bootcamp,
      datasetVersion: drill.blueprint.datasetVersion,
      correctionRevision: Number(
          drill.blueprint.correctionRevision !== undefined ?
            drill.blueprint.correctionRevision :
            correctionRevisionFor(drill.bootcamp),
      ),
      dueAt: drill.dueAt || inbox.dueAt || "",
      assignmentRelease: releaseFromDrill(drill),
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
    const nowIso = new Date(createdAt).toISOString();
    const updates = {};
    updates[`studentDrills/${studentId}/${sessionId}`] = session;
    updates[`users/${studentId}/assignedDrills/${drillId}/status`] = "started";
    updates[`users/${studentId}/assignedDrills/${drillId}/startedAt`] = nowIso;
    updates[`users/${studentId}/assignedDrills/${drillId}/sessionId`] =
      sessionId;
    const schoolBase = `schools/${inbox.schoolId}/educatorDrills/${drillId}` +
      `/assignedStudents/${studentId}`;
    updates[`${schoolBase}/status`] = "started";
    updates[`${schoolBase}/startedAt`] = nowIso;
    updates[`${schoolBase}/sessionId`] = sessionId;
    await db.ref().update(updates);
    return res.status(201).json({ok: true, session: publicSession(session)});
  } catch (error) {
    const code = [400, 401, 403, 404, 409].includes(Number(error.code)) ?
      Number(error.code) : 500;
    if (code === 500) console.error("ASSIGNMENT_SESSION_FAILED", error);
    return res.status(code).json({
      error: code === 500 ? "Unable to start assignment" : error.message,
    });
  }
}

module.exports = {assignmentPaper, createAssignmentSession, releaseFromDrill};
