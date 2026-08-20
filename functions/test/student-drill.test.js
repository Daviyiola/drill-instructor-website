"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {
  DATASET_VERSION,
  buildCatalog,
  buildPaper,
  gradeSession,
  normalizeLegacyResult,
  normalizedQuestions,
  orderedSelectQuestions,
  publicQuestion,
  publicSession,
  questionStimulusKey,
  smartSelectQuestions,
  subjectTimerKey,
} = require("../handlers/_studentDrill");
const {
  bookmarkWithAnswer,
  datasetPathKey,
  flattenBookmarkVersions,
  hydrateBookmarkQuestion,
  licenseCoversSession,
  submittedSessionValue,
} = require("../handlers/studentDrillsHttps");
const {
  challengePaper,
  challengeReinviteCount,
  challengeSummary,
  challengeStage,
  publicChallengeParticipant,
  publicChallengeResult,
  reinvitedChallengeRow,
} = require("../handlers/studentChallengesHttps");
const {
  educatorCatalog,
} = require("../handlers/educatorQuestionBankHttps");

test("loads the versioned SAT and ACT question banks", () => {
  assert.equal(DATASET_VERSION, "2026.08.1");
  assert.ok(normalizedQuestions("sat").length > 100);
  assert.ok(normalizedQuestions("act").length > 300);
  assert.deepEqual(
      buildCatalog("sat").subjects.map((subject) => subject.name),
      ["Read. & Writ.", "Math"],
  );
});

test("SAT timers use safe stored keys and visible public labels", () => {
  const subject = "Read. & Writ.";
  const storedKey = subjectTimerKey(subject);
  assert.doesNotMatch(storedKey, /[.#$[\]/]/);
  const session = publicSession({
    sessionId: "sat_timer",
    status: "active",
    bootcamp: "sat",
    datasetVersion: "test",
    createdAt: 1,
    config: [{subject, questionCount: 10, timeLimitMin: 30}],
    questions: [],
    timers: {[storedKey]: 1234},
  });
  assert.deepEqual(session.timers, {[subject]: 1234});
});

test("educator catalog exposes the complete practice-test contract", () => {
  const catalog = educatorCatalog("act");
  assert.equal(catalog.ok, true);
  assert.equal(catalog.licensed, true);
  assert.ok(catalog.subjects.length > 0);
  for (const subject of catalog.subjects) {
    assert.deepEqual(subject.availablePracticeYears, subject.practiceYears);
  }
});

test("ordered educator browsing starts early and keeps groups", () => {
  const candidates = [
    {id: "q-4", practiceYear: 2, passage: "Later", imageSources: []},
    {id: "q-2", practiceYear: 1, passage: "Shared", imageSources: []},
    {id: "q-1", practiceYear: 1, passage: "Shared", imageSources: []},
    {id: "q-3", practiceYear: 1, passage: "", imageSources: []},
  ];
  assert.deepEqual(
      orderedSelectQuestions(candidates, 3).map((row) => row.id),
      ["q-1", "q-2", "q-3"],
  );
});

test("maps mobile challenge states into the three-stage inbox", () => {
  assert.equal(challengeStage({status: "pending"}), "incoming");
  assert.equal(challengeStage({status: "accepted"}), "accepted");
  assert.equal(challengeStage({status: "completed"}), "completed");
  assert.equal(challengeStage({status: "declined"}), "hidden");
  assert.equal(challengeStage({
    status: "accepted",
    expiresAt: "2020-01-01T00:00:00.000Z",
  }), "completed");
});

test("summarizes challenge subjects, questions, and allotted time", () => {
  assert.deepEqual(challengeSummary({
    subjects: [
      {
        subject: "Mathematics",
        questionIds: ["m1", "m2"],
        timeLimitMin: 12,
      },
      {
        subject: "Science",
        numQ: 3,
        timeLimit: 8,
      },
    ],
  }), {
    subjectCount: 2,
    questionCount: 5,
    totalTimeMin: 20,
  });
});

test("builds challenge papers from exact versioned question ids", () => {
  const question = normalizedQuestions("act")[0];
  const paper = challengePaper({
    bootcamp: "act",
    subjects: [{
      subject: question.subject,
      questionIds: [question.id],
      timeLimitMin: 8,
    }],
  });
  assert.equal(paper.questions.length, 1);
  assert.equal(paper.questions[0].id, question.id);
  assert.equal(paper.config[0].timeLimitMin, 8);
});

test("challenge scoreboards expose summary fields without snapshots", () => {
  const result = publicChallengeResult("student_1", {
    attempted: 10,
    correct: 8,
    totalQ: 12,
    usedSec: 125,
    snapshot: {
      summary: {points: 80},
      subjects: [{
        subject: "Mathematics",
        attempted: 10,
        correct: 8,
        usedSec: 125,
        answers: [{correctIndex: 2}],
      }],
      modules: [{
        subject: "Mathematics",
        module: "Algebra",
        attempted: 5,
        correct: 4,
        usedSec: 60,
      }],
      answers: [{correctIndex: 2}],
    },
    participant: {displayName: "Alex", avaterNumber: 3},
  });
  assert.equal(result.displayName, "Alex");
  assert.equal(result.correct, 8);
  assert.equal(result.avatarNumber, 3);
  assert.equal(result.averageTimeSec, 12.5);
  assert.equal(result.subjects[0].usedSec, 125);
  assert.equal(result.subjects[0].averageTimeSec, 12.5);
  assert.equal(result.modules[0].module, "Algebra");
  assert.equal(result.subjects[0].answers, undefined);
  assert.equal(result.snapshot, undefined);
});

test("creator tracking keeps expired non-finishers visible", () => {
  const creator = publicChallengeParticipant(
      "student_creator",
      {
        firstName: "Ari",
        lastName: "Stone",
        avatarNumber: 4,
        currentRank: "Sergeant",
      },
      {status: "completed", completedAt: "2026-07-24T10:00:00.000Z"},
      "student_creator",
      true,
      true,
  );
  const invitee = publicChallengeParticipant(
      "student_friend",
      {firstName: "Bo", lastName: "Reed"},
      {status: "accepted"},
      "student_creator",
      true,
      false,
  );
  assert.equal(creator.role, "creator");
  assert.equal(creator.completed, true);
  assert.equal(invitee.role, "recipient");
  assert.equal(invitee.status, "not_completed");
  assert.equal(invitee.completed, false);
});

test("re-inviting resets only declined invitation metadata", () => {
  assert.deepEqual(reinvitedChallengeRow({
    role: "recipient",
    status: "declined",
    inviteAttempt: 1,
    declinedAt: "2026-07-29T01:00:00.000Z",
    declineReason: "user_declined",
    expiresAt: "2026-07-30T01:00:00.000Z",
  }, "2026-07-29T02:00:00.000Z"), {
    role: "recipient",
    status: "pending",
    inviteAttempt: 2,
    reinvitedAt: "2026-07-29T02:00:00.000Z",
    updatedAt: "2026-07-29T02:00:00.000Z",
    expiresAt: "2026-07-30T01:00:00.000Z",
  });
  assert.equal(reinvitedChallengeRow({status: "accepted"}, "now"), null);
  assert.equal(challengeReinviteCount({}), 0);
  assert.equal(challengeReinviteCount({inviteAttempt: 2}), 1);
  assert.equal(challengeReinviteCount({inviteAttempt: 3}), 2);
  assert.equal(reinvitedChallengeRow({
    status: "declined",
    inviteAttempt: 3,
  }, "now"), null);
});

test("mobile challenges use the shared cloud session", () => {
  const qmlRoot = join(
      __dirname,
      "..",
      "..",
      "Drill_Instructor",
      "qml",
      "Student",
      "Bootcamps",
  );
  const squad = readFileSync(join(qmlRoot, "SquadDrills.qml"), "utf8");
  const questions = readFileSync(join(qmlRoot, "Questions.qml"), "utf8");

  assert.match(squad, /createStudentChallengeSessionHttps/);
  assert.match(squad, /useCloudSession:\s*true/);
  assert.match(questions, /if \(useCloudSession && cloudSession\)/);
  assert.match(
      questions,
      /questionMode === 1 \|\| questionMode === 2/,
  );
  assert.match(
      questions,
      /submitChallengeResult\(\s*challengeId,\s*sessionId/,
  );
  assert.doesNotMatch(questions, /submitSessionSnapshotHttps/);
  assert.match(questions, /passage:\s*String\(raw\.passage/);
  assert.match(questions, /cachedCloudAssets\(/);
  assert.match(questions, /cacheCloudSessionAssets\(session\)/);
  assert.match(questions, /moreInfoModal\.referencePassage/);
  assert.match(questions, /moreInfoModal\.referenceImages/);
  assert.match(questions, /Saved for Sync/);
  assert.match(questions, /savePendingEducatorDrillSubmission/);
  assert.match(squad, /submitStudentDrillHttps/);
  assert.doesNotMatch(squad, /submitEducatorDrillAttemptHttps/);
});

test("challenge completion loads the canonical submitted session", () => {
  const handler = readFileSync(join(
      __dirname,
      "..",
      "handlers",
      "completeChallengeHttps.js",
  ), "utf8");
  const webRunner = readFileSync(join(
      __dirname,
      "..",
      "..",
      "components",
      "app",
      "QuestionRunner.tsx",
  ), "utf8");

  assert.match(handler, /studentDrills\/" \+ customId \+ "\/" \+ sessionId/);
  assert.match(handler, /session\.status !== "submitted"/);
  assert.match(handler, /session\.challengeId/);
  assert.match(handler, /summarizeSubmittedResult\(session\.result\)/);
  assert.doesNotMatch(handler, /body\.snapshot/);
  assert.match(webRunner, /"completeChallengeHttps",[\s\S]*?sessionId/);
});

test("active questions never expose grading fields", () => {
  const source = normalizedQuestions("sat")[0];
  const visible = publicQuestion(source);
  assert.equal("correctIndex" in visible, false);
  assert.equal("explanation" in visible, false);
  assert.equal(visible.prompt, source.prompt);
});

test("free drill configuration is limited to early practice years", () => {
  const paper = buildPaper("sat", {
    subjects: [{
      subject: "Math",
      questionCount: 5,
      timeLimitMin: 10,
      modules: [],
      practiceYears: [1, 2, 3],
    }],
  }, false);
  assert.equal(paper.questions.length, 5);
  assert.ok(paper.questions.every((question) => question.practiceYear <= 2));
});

test("smart selection preserves shared-stimulus order and adjacency", () => {
  const candidates = [
    ...[1, 2, 3, 4].map((value) => ({
      id: `passage_a_${value}`,
      passage: "Passage A",
      imageSources: [],
      sourceOrder: value,
    })),
    ...[1, 2, 3].map((value) => ({
      id: `image_b_${value}`,
      passage: "",
      imageSources: ["figure-b.png"],
      sourceOrder: value,
    })),
    {id: "independent_1", passage: "", imageSources: [], sourceOrder: 1},
    {id: "independent_2", passage: "", imageSources: [], sourceOrder: 2},
  ];

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const selected = smartSelectQuestions(candidates, 6);
    assert.equal(selected.length, 6);

    const closedKeys = new Set();
    let activeKey = "";
    selected.forEach((question) => {
      const key = questionStimulusKey(question);
      if (key !== activeKey) {
        assert.equal(closedKeys.has(key), false);
        if (activeKey) closedKeys.add(activeKey);
        activeKey = key;
      }
    });

    ["Passage A", "figure-b.png"].forEach((stimulus) => {
      const rows = selected.filter((question) =>
        question.passage === stimulus ||
          question.imageSources.includes(stimulus));
      for (let index = 1; index < rows.length; index += 1) {
        assert.equal(
            rows[index].sourceOrder,
            rows[index - 1].sourceOrder + 1,
        );
      }
    });
  }
});

test("submission transaction survives an uncached initial value", () => {
  const session = {
    sessionId: "session_1",
    studentId: "student_1",
    status: "active",
    answers: {},
  };
  const result = {summary: {correct: 1}};
  const claimed = submittedSessionValue(
      null,
      session,
      "student_1",
      {answers: {question_1: 2}},
      result,
      5000,
  );
  assert.equal(claimed.status, "submitted");
  assert.deepEqual(claimed.result, result);
  assert.deepEqual(claimed.answers, {question_1: 2});

  assert.equal(submittedSessionValue(
      {...session, status: "submitted"},
      session,
      "student_1",
      {},
      result,
      5000,
  ), undefined);
});

test("bookmark dataset versions use valid RTDB path keys", () => {
  assert.equal(datasetPathKey("2025.08"), "2025_08");
});

test("bookmark listing combines versions and keeps the newest question", () => {
  const bookmarks = flattenBookmarkVersions({
    "2025_07": {
      old: {id: "Math#1", updatedAt: 10, prompt: "Old"},
      retained: {id: "Math#2", updatedAt: 20},
    },
    "2025_08": {
      current: {id: "Math#1", updatedAt: 30, prompt: "Current"},
    },
  });
  assert.equal(bookmarks.length, 2);
  assert.equal(bookmarks[0].prompt, "Current");
  assert.equal(bookmarks[1].id, "Math#2");
});

test("compact bookmark pointers hydrate from their source session", () => {
  const bookmark = {
    id: "math_12",
    datasetVersion: "2025.08",
    sourceSessionId: "session_1",
    updatedAt: 100,
    groups: ["Review later"],
  };
  const hydrated = hydrateBookmarkQuestion(bookmark, {
    datasetVersion: "2025.08",
    questions: [{
      id: "math_12",
      sourceId: "12",
      subject: "Mathematics",
      module: "Algebra",
      practiceYear: 1,
      prompt: "Solve for x.",
      passage: "",
      imageSources: [],
      options: ["1", "2", "3", "4"],
      correctIndex: 1,
      explanation: "Private until submission.",
    }],
  }, "act");
  assert.equal(hydrated.prompt, "Solve for x.");
  assert.equal(hydrated.module, "Algebra");
  assert.equal(hydrated.bootcamp, "act");
  assert.deepEqual(hydrated.groups, ["Review later"]);
  assert.equal(hydrated.correctIndex, undefined);
  assert.equal(hydrated.explanation, undefined);
});

test("bookmark answers are revealed only after source submission", () => {
  const bookmark = {id: "Math#1", prompt: "Question"};
  assert.equal(
      bookmarkWithAnswer(bookmark, {status: "active"}).answerAvailable,
      false,
  );
  const revealed = bookmarkWithAnswer(bookmark, {
    status: "submitted",
    result: {
      answers: [{
        id: "Math#1",
        correctIndex: 2,
        explanation: "Because it is C.",
      }],
    },
  });
  assert.equal(revealed.answerAvailable, true);
  assert.equal(revealed.correctIndex, 2);
  assert.equal(revealed.explanation, "Because it is C.");
});

test("credit recovery only uses a license active by submission time", () => {
  const license = {activationDate: "2026-07-01T00:00:00.000Z"};
  assert.equal(licenseCoversSession(license, {
    submittedAt: Date.parse("2026-07-15T00:00:00.000Z"),
  }), true);
  assert.equal(licenseCoversSession(license, {
    submittedAt: Date.parse("2026-06-15T00:00:00.000Z"),
  }), false);
  assert.equal(licenseCoversSession(null, {submittedAt: Date.now()}), false);
});

test("license-dependent drill exports bind LICENSE_SALT", () => {
  const source = readFileSync(join(__dirname, "..", "index.js"), "utf8");
  assert.match(source, /const studentDrillLicensedOptions = \{/);
  assert.match(source, /secrets: \[LICENSE_SALT\]/);

  [
    "getStudentDrillCatalogHttps",
    "createStudentDrillHttps",
    "submitStudentDrillHttps",
    "getStudentDrillResultHttps",
    "setStudentBookmarkHttps",
    "getStudentBookmarksHttps",
    "setStudentBookmarkGroupsHttps",
    "getStudentChallengesHttps",
    "getStudentChallengeHttps",
    "reinviteStudentChallengeParticipantHttps",
  ].forEach((exportName) => {
    const pattern = new RegExp(
        `exports\\.${exportName} = onRequest\\(\\s*` +
        "studentDrillLicensedOptions,",
    );
    assert.match(source, pattern);
  });
});

test("server grading calculates attempts, points, and feedback", () => {
  const questions = normalizedQuestions("sat").slice(0, 2);
  const session = {
    sessionId: "session_1",
    bootcamp: "sat",
    datasetVersion: DATASET_VERSION,
    createdAt: 1000,
    questions,
    config: [{subject: questions[0].subject, timeLimitMin: 10}],
    questionTimes: {
      [questions[0].id]: 18,
      [questions[1].id]: 22,
    },
  };
  const result = gradeSession(session, {
    [questions[0].id]: questions[0].correctIndex,
    [questions[1].id]: (questions[1].correctIndex + 1) % 4,
  }, {[questions[0].subject]: 500}, 61000);
  assert.equal(result.summary.totalQ, 2);
  assert.equal(result.summary.attempted, 2);
  assert.equal(result.summary.correct, 1);
  assert.equal(result.summary.scorePct, 50);
  assert.equal(result.summary.points, 4);
  assert.equal(result.subjects[0].averageTimeSec, 20);
  assert.ok(result.modules.length >= 1);
  assert.equal(result.answers[0].timeSpentSec, 18);
  assert.equal(result.answers[0].explanation, questions[0].explanation);
});

test("accuracy excludes unanswered questions", () => {
  const questions = normalizedQuestions("sat").slice(0, 2);
  const session = {
    sessionId: "session_attempted_accuracy",
    bootcamp: "sat",
    datasetVersion: DATASET_VERSION,
    createdAt: 1000,
    questions,
    config: [{subject: questions[0].subject, timeLimitMin: 10}],
    questionTimes: {[questions[0].id]: 12},
  };
  const result = gradeSession(session, {
    [questions[0].id]: questions[0].correctIndex,
  }, {[questions[0].subject]: 500}, 61000);
  assert.equal(result.summary.totalQ, 2);
  assert.equal(result.summary.attempted, 1);
  assert.equal(result.summary.correct, 1);
  assert.equal(result.summary.unanswered, 1);
  assert.equal(result.summary.scorePct, 100);
});

test("normalizes mobile snapshots for web results and review", () => {
  const result = normalizeLegacyResult({
    sessionId: "mobile_1",
    bootcamp: "sat",
    summary: {totalQ: 1, attempted: 1, correct: 1, points: 3},
    subjects: [{subject: "Math", totalQ: 1, attempted: 1, correct: 1}],
    answers: [{
      questionId: "Math#1",
      subject: "Math",
      selectedAnswer: "Four",
      correctAnswer: "Four",
      questionPayload: {
        question: "Two plus two?",
        option1: "Three",
        option2: "Four",
        option3: "Five",
        option4: "Six",
        correctAnswer: "Four",
        explanation: "Add the values.",
      },
    }],
  });
  assert.equal(result.answers[0].selectedIndex, 1);
  assert.equal(result.answers[0].correctIndex, 1);
  assert.equal(result.answers[0].prompt, "Two plus two?");
});

test("normalizes RTDB object-shaped module summaries", () => {
  const result = normalizeLegacyResult({
    sessionId: "mobile_modules",
    bootcamp: "act",
    summary: {totalQ: 2, attempted: 1, correct: 1},
    modules: {
      first: {
        subject_code: "Mathematics",
        code: "Algebra",
        attempted: 2,
        correct: 1,
        timeSec: 48,
      },
    },
  });
  assert.equal(result.modules.length, 1);
  assert.equal(result.modules[0].module, "Algebra");
  assert.equal(result.modules[0].subject, "Mathematics");
  assert.equal(result.modules[0].scorePct, 50);
  assert.equal(result.modules[0].averageTimeSec, 24);
  assert.equal(result.modules[0].wrong, 1);
});
