"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAnswers,
  normalizeModules,
  normalizeSubjects,
  sortAnswersByBlueprint,
} = require("../handlers/getEducatorDrillSubmissionDetailHttps");

test("educator review preserves canonical references and feedback", () => {
  const [answer] = normalizeAnswers([{
    questionId: "science_7",
    subject: "Science",
    module: "Data representation",
    practiceYear: 2,
    prompt: "Use the figures to answer the question.",
    options: ["A", "B", "C", "D"],
    selectedIndex: 1,
    correctIndex: 2,
    explanation: "Compare both figures.",
    passage: "Figure 1 and Figure 2 show the results.",
    imageSources: ["assets/Sci1.webp", "assets/Sci2.webp"],
  }]);

  assert.equal(answer.question, "Use the figures to answer the question.");
  assert.equal(answer.selectedAnswer, "B");
  assert.equal(answer.correctAnswer, "C");
  assert.equal(answer.selectedOptionIdx, 2);
  assert.equal(answer.practiceYear, 2);
  assert.equal(answer.passage, "Figure 1 and Figure 2 show the results.");
  assert.deepEqual(answer.imageSources, [
    "assets/Sci1.webp",
    "assets/Sci2.webp",
  ]);
});

test("educator review retains one-based assignment question numbering", () => {
  const answers = [
    {questionId: "q-2", index: 1},
    {questionId: "q-1", index: 2},
  ];
  const drill = {
    blueprint: {
      subjects: [{questionIds: ["q-1", "q-2"]}],
    },
  };

  assert.deepEqual(
      sortAnswersByBlueprint(answers, drill).map((row) => ({
        id: row.questionId,
        originalIndex: row.originalIndex,
      })),
      [
        {id: "q-1", originalIndex: 1},
        {id: "q-2", originalIndex: 2},
      ],
  );
});

test("educator result breakdowns retain total and mean time aliases", () => {
  const [subject] = normalizeSubjects([{
    subject: "Mathematics",
    attempted: 4,
    correct: 3,
    usedSec: 90,
  }]);
  const [moduleRow] = normalizeModules([{
    subject: "Mathematics",
    module: "inequalities",
    attempted: 2,
    correct: 1,
    timeSec: 50,
  }]);

  assert.equal(subject.timeSec, 90);
  assert.equal(subject.usedSec, 90);
  assert.equal(subject.averageTimeSec, 22.5);
  assert.equal(moduleRow.timeSec, 50);
  assert.equal(moduleRow.usedSec, 50);
  assert.equal(moduleRow.averageTimeSec, 25);
});
