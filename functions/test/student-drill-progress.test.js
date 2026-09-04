"use strict";
/* eslint-disable require-jsdoc, max-len */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_PROGRESS_CLIENTS,
  applyProgressPatch,
  approximateJsonBytes,
  assertProgressPayloadSize,
  initialProgress,
  progressForSession,
  sanitizeProgressPatch,
  sessionProgressMetadata,
} = require("../handlers/_studentDrillProgress");
const {
  compactResult,
  cleanSegment,
  gradeSession,
  hydrateResult,
  normalizedQuestions,
  publicSession,
  subjectTimerKey,
} = require("../handlers/_studentDrill");
const {submittedSessionValue} =
  require("../handlers/studentDrillsHttps");

function sessionFixture() {
  const questions = normalizedQuestions("act").slice(0, 2);
  return {
    sessionId: "session_1",
    studentId: "student_1",
    status: "active",
    bootcamp: "act",
    datasetVersion: "2026.08.1",
    correctionRevision: 0,
    createdAt: 1000,
    updatedAt: 1000,
    config: [{
      subject: questions[0].subject,
      questionCount: 2,
      timeLimitMin: 30,
      modules: [],
      practiceYears: [1],
    }],
    questions,
    answers: {},
    bookmarks: {},
    flags: {},
    questionTimes: {},
    timers: {[subjectTimerKey(questions[0].subject)]: 1800},
    currentQuestionId: questions[0].id,
  };
}

test("autosave metadata excludes question and answer content", () => {
  const session = sessionFixture();
  const metadata = sessionProgressMetadata(session);
  assert.deepEqual(metadata.questionIds,
      session.questions.map((question) => question.id));
  assert.equal("questions" in metadata, false);
  assert.equal(JSON.stringify(metadata).includes(session.questions[0].prompt),
      false);
  assert.ok(approximateJsonBytes(metadata) < approximateJsonBytes(session) / 4);
});

test("dirty progress applies only supplied fields and supports deletion", () => {
  const session = sessionFixture();
  const metadata = sessionProgressMetadata(session);
  const [first, second] = metadata.questionIds;
  const patch = sanitizeProgressPatch(metadata, {
    clientId: "browser_one",
    sequence: 1,
    changes: {
      answers: {[first]: 2},
      flags: {[second]: null},
      currentQuestionId: second,
    },
  });
  const applied = applyProgressPatch({
    ...initialProgress(session),
    answers: {[second]: 1},
    flags: {[second]: true},
  }, patch, 2000);
  assert.deepEqual(applied.value.answers, {[first]: 2, [second]: 1});
  assert.deepEqual(applied.value.flags, {});
  assert.equal(applied.value.currentQuestionId, second);
});

test("stale autosaves cannot overwrite newer progress", () => {
  const session = sessionFixture();
  const metadata = sessionProgressMetadata(session);
  const id = metadata.questionIds[0];
  const newer = sanitizeProgressPatch(metadata, {
    clientId: "browser_one",
    sequence: 2,
    changes: {answers: {[id]: 3}},
  });
  const first = applyProgressPatch(initialProgress(session), newer, 2000);
  const stale = applyProgressPatch(first.value, {
    ...newer,
    sequence: 1,
    answers: {[id]: 0},
  }, 3000);
  assert.equal(stale.stale, true);
  assert.equal(stale.value.answers[id], 3);
});

test("concurrent clients retain unrelated dirty fields", () => {
  const session = sessionFixture();
  const metadata = sessionProgressMetadata(session);
  const [firstId, secondId] = metadata.questionIds;
  const first = applyProgressPatch(initialProgress(session),
      sanitizeProgressPatch(metadata, {
        clientId: "browser_one", sequence: 1,
        changes: {answers: {[firstId]: 1}},
      }), 2000);
  const second = applyProgressPatch(first.value,
      sanitizeProgressPatch(metadata, {
        clientId: "browser_two", sequence: 1,
        changes: {answers: {[secondId]: 2}},
      }), 2001);
  assert.deepEqual(second.value.answers, {[firstId]: 1, [secondId]: 2});
});

test("progress client sequence state is bounded", () => {
  const session = sessionFixture();
  const metadata = sessionProgressMetadata(session);
  const id = metadata.questionIds[0];
  let progress = initialProgress(session);
  for (let index = 0; index < MAX_PROGRESS_CLIENTS; index += 1) {
    progress = applyProgressPatch(progress, sanitizeProgressPatch(metadata, {
      clientId: `browser_${index}`,
      sequence: 1,
      changes: {answers: {[id]: index % 4}},
    }), 2000 + index).value;
  }
  assert.throws(() => applyProgressPatch(
      progress,
      sanitizeProgressPatch(metadata, {
        clientId: "one_browser_too_many",
        sequence: 1,
        changes: {answers: {[id]: 0}},
      }),
      3000,
  ), /Too many progress clients/);
});

test("invalid identifiers, malformed values, and oversized payloads fail", () => {
  const metadata = sessionProgressMetadata(sessionFixture());
  assert.throws(() => sanitizeProgressPatch(metadata, {
    clientId: "browser", sequence: 1,
    changes: {answers: {unknown_question: 1}},
  }), /Unknown question/);
  assert.throws(() => sanitizeProgressPatch(metadata, {
    clientId: "browser", sequence: 1,
    changes: {answers: {[metadata.questionIds[0]]: 99}},
  }), /Invalid answers/);
  assert.throws(() => assertProgressPayloadSize({
    changes: {answers: {question: "x".repeat(70 * 1024)}},
  }), /too large/);
  assert.throws(() => sanitizeProgressPatch(metadata, {
    clientId: "browser", sequence: 1, changes: {},
  }), /No valid progress changes/);
  assert.equal(cleanSegment("invalid/session", 80), "");
});

test("submission ownership prevents cross-user access", () => {
  const session = sessionFixture();
  const result = gradeSession(session, {}, session.timers, 61000);
  assert.equal(submittedSessionValue(
      session,
      session,
      "student_other",
      initialProgress(session),
      result,
      61000,
  ), undefined);

  const source = fs.readFileSync(path.join(
      __dirname, "..", "handlers", "studentDrillsHttps.js"), "utf8");
  assert.match(source, /metadata\.studentId !== studentId/);
});

test("legacy session progress remains readable", () => {
  const session = sessionFixture();
  session.answers[session.questions[0].id] = 2;
  const visible = publicSession(progressForSession(session, null));
  assert.equal(visible.answers[session.questions[0].id], 2);
  assert.equal(visible.progressRevision, 0);
});

test("compact results reconstruct exact pinned review content", () => {
  const session = sessionFixture();
  session.questionTimes = {[session.questions[0].id]: 12};
  const answers = {[session.questions[0].id]:
    session.questions[0].correctIndex};
  const full = gradeSession(session, answers, session.timers, 61000);
  const compact = compactResult(full, {flags: {
    [session.questions[0].id]: true,
  }});
  assert.equal(compact.v, 3);
  assert.equal("prompt" in compact.answers[0], false);
  assert.equal("options" in compact.answers[0], false);
  const hydrated = hydrateResult(compact, session.questions);
  assert.equal(hydrated.answers[0].prompt, session.questions[0].prompt);
  assert.deepEqual(hydrated.answers[0].options,
      session.questions[0].options);
  assert.equal(hydrated.answers[0].flagged, true);
  assert.ok(approximateJsonBytes(compact) < approximateJsonBytes(full) / 2);
});

test("submission incorporates answers newer than the last autosave", () => {
  const session = sessionFixture();
  const question = session.questions[0];
  session.answers = {[question.id]: (question.correctIndex + 1) % 4};
  const latest = {[question.id]: question.correctIndex};
  const result = gradeSession({...session, answers: latest}, latest,
      session.timers, 61000);
  const stored = submittedSessionValue(null, session, session.studentId, {
    answers: latest,
    bookmarks: {},
    flags: {},
    questionTimes: {},
    timers: session.timers,
    currentQuestionId: question.id,
  }, result, 61000);
  assert.equal(stored.result.answers[0].selectedIndex, question.correctIndex);
  assert.equal(stored.result.answers[0].isCorrect, true);
});

test("web runner uses no-op dirty saves and a 45 second cadence", () => {
  const source = fs.readFileSync(path.join(
      __dirname, "..", "..", "components", "app", "QuestionRunner.tsx"),
  "utf8");
  assert.match(source, /if \(!Object\.keys\(dirty\)\.length/);
  assert.match(source,
      /Date\.now\(\) - lastSaveAttemptRef\.current >= 45000/);
  assert.match(source, /changes,/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /pagehide/);
  assert.match(source, /mergeProgressChanges\(inFlightChangesRef\.current/);
  assert.match(source, /sessionStorage\.getItem\(storageKey\)/);
});
