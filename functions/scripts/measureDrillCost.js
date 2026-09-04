"use strict";
/* eslint-disable require-jsdoc */

const {
  compactResult,
  correctionRevisionFor,
  datasetVersionFor,
  gradeSession,
  normalizedQuestions,
  subjectTimerKey,
} = require("../handlers/_studentDrill");
const {
  applyProgressPatch,
  approximateJsonBytes,
  initialProgress,
  sessionDocument,
  sessionProgressMetadata,
} = require("../handlers/_studentDrillProgress");

function representativeSession() {
  const questions = normalizedQuestions("act")
      .filter((question) => question.subject === "English")
      .slice(0, 40);
  const config = [{
    subject: "English",
    questionCount: 40,
    timeLimitMin: 30,
    modules: [],
    practiceYears: [1, 2],
  }];
  const timers = {[subjectTimerKey("English")]: 1800};
  const answers = {};
  const questionTimes = {};
  questions.forEach((question, index) => {
    answers[question.id] = index % 4;
    questionTimes[question.id] = 45;
  });
  return {
    sessionId: "representative_session",
    studentId: "representative_student",
    status: "active",
    bootcamp: "act",
    datasetVersion: datasetVersionFor("act"),
    correctionRevision: correctionRevisionFor("act"),
    createdAt: 1000,
    updatedAt: 1000,
    config,
    questions,
    answers,
    bookmarks: {},
    flags: {},
    questionTimes,
    timers,
    currentQuestionId: questions[39].id,
  };
}

function main() {
  const session = representativeSession();
  const fullResult = gradeSession(session, session.answers, session.timers,
      1801000);
  const legacyCompleted = {...session, status: "submitted", result: fullResult};
  const compact = compactResult(fullResult, session);
  const normalizedCompleted = {
    ...sessionDocument(session),
    status: "submitted",
    questions: undefined,
    questionRefs: session.questions.map((question) => question.id),
    result: compact,
  };
  delete normalizedCompleted.questions;

  const metadata = sessionProgressMetadata(session);
  const oldAutosaveRequests = 150 + 40 + 39;
  const newAutosaveRequests = 40;
  const oldSessionReadBytes = approximateJsonBytes(session);
  const oldProgressWriteBytes = approximateJsonBytes({
    answers: session.answers,
    bookmarks: session.bookmarks,
    flags: session.flags,
    questionTimes: session.questionTimes,
    timers: session.timers,
    currentQuestionId: session.currentQuestionId,
    updatedAt: 1800000,
  });
  const sampleQuestion = session.questions[20];
  // Conservatively model every atomic transaction as if it already contains
  // the full end-of-drill progress map. Real earlier saves are smaller.
  const transactionValue = applyProgressPatch(initialProgress(session), {
    clientId: "representative_browser",
    sequence: 40,
    answers: {[sampleQuestion.id]: 0},
    questionTimes: {[sampleQuestion.id]: 45},
    timers: {[subjectTimerKey("English")]: 900},
    currentQuestionId: sampleQuestion.id,
  }, 900000).value;
  const newTransactionBytes = approximateJsonBytes(transactionValue);
  const beforeDownload = oldAutosaveRequests * oldSessionReadBytes;
  const afterDownload = newAutosaveRequests *
    (approximateJsonBytes(metadata) + newTransactionBytes + 2);
  const beforeWrite = oldAutosaveRequests * oldProgressWriteBytes;
  const afterWrite = newAutosaveRequests * newTransactionBytes;
  const beforeStored = approximateJsonBytes(legacyCompleted);
  const afterStored = approximateJsonBytes(normalizedCompleted) +
    approximateJsonBytes({...metadata, status: "submitted"});
  const result = {
    assumptions: {
      questions: 40,
      durationMinutes: 30,
      oldPeriodicSeconds: 12,
      newPeriodicSeconds: 45,
      oldRequestsInclude: "150 periodic + 40 answer + 39 navigation",
      newRequestsInclude: "one dirty flush per question/navigation window",
      excludes: "HTTP overhead and legacy full user-profile reads",
    },
    before: {
      autosaveRequests: oldAutosaveRequests,
      fullSessionReads: oldAutosaveRequests,
      rtdbDownloadBytes: beforeDownload,
      rtdbWriteBytes: beforeWrite,
      completedSessionStoredBytes: beforeStored,
      progressFunctionInvocations: oldAutosaveRequests,
    },
    after: {
      autosaveRequests: newAutosaveRequests,
      fullSessionReads: 0,
      rtdbDownloadBytes: afterDownload,
      rtdbWriteBytes: afterWrite,
      completedSessionStoredBytes: afterStored,
      progressFunctionInvocations: newAutosaveRequests,
    },
    reductionPercent: {
      autosaveRequests: 100 * (1 - newAutosaveRequests / oldAutosaveRequests),
      rtdbDownload: 100 * (1 - afterDownload / beforeDownload),
      rtdbWrite: 100 * (1 - afterWrite / beforeWrite),
      completedSessionStorage: 100 * (1 - afterStored / beforeStored),
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
