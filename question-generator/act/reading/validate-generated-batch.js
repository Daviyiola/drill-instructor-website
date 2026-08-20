"use strict";

const fs = require("fs");
const vm = require("vm");

const allowedModules = new Set([
  "Author's Purpose and Perspective",
  "Central Ideas and Themes",
  "Character and Relationship Analysis",
  "Comparative Passage Analysis",
  "Function and Structure",
  "Inference and Implication",
  "Sequence and Relationships",
  "Textual Details",
  "Vocabulary in Context",
]);

const requiredFields = [
  "skill_tested",
  "question",
  "option1",
  "option2",
  "option3",
  "option4",
  "correctAnswer",
  "explanation",
  "practiceYear",
  "difficulty",
  "module",
  "imageSources",
  "passage",
];

function fail(messages) {
  for (const message of messages) console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function visibleLength(value) {
  return String(value || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

function choiceLengthSignal(options, correctAnswer) {
  const correctIndex = options.indexOf(correctAnswer);
  if (correctIndex < 0) return null;
  const lengths = options.map(visibleLength);
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);
  const longestIndexes = lengths.map((length, index) => ({length, index})).filter(({length}) => length === longest).map(({index}) => index);
  const longestDistractor = Math.max(...lengths.filter((_, index) => index !== correctIndex));
  const shortestIndexes = lengths.map((length, index) => ({length, index})).filter(({length}) => length === shortest).map(({index}) => index);
  const shortestDistractor = Math.min(...lengths.filter((_, index) => index !== correctIndex));
  return {
    correctIndex,
    correctLength: lengths[correctIndex],
    longestDistractor,
    longestIndexes,
    expectedLongestGuess: longestIndexes.includes(correctIndex) ? 1 / longestIndexes.length : 0,
    shortestIndexes,
    shortestDistractor,
    expectedShortestGuess: shortestIndexes.includes(correctIndex) ? 1 / shortestIndexes.length : 0,
  };
}

const [, , filePath, startText] = process.argv;
const start = Number(startText);

if (!filePath || !Number.isInteger(start)) {
  fail(["Usage: node validate-generated-batch.js <batch.jsfrag> <startQuestionNumber>"]);
  return;
}

let batch;
try {
  const source = fs.readFileSync(filePath, "utf8").trim();
  batch = vm.runInNewContext(`(${source})`, Object.create(null), {
    timeout: 1000,
    codeGeneration: {strings: false, wasm: false},
  });
} catch (error) {
  fail([`The batch is not a parseable JavaScript object literal: ${error.message}`]);
  return;
}

const errors = [];
const keys = Object.keys(batch || {}).map(Number).sort((a, b) => a - b);
const expectedKeys = Array.from({length: 9}, (_, index) => start + index);

if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
  errors.push(`Expected question keys ${expectedKeys.join(", ")}; received ${keys.join(", ") || "none"}.`);
}

const difficultyCounts = {Medium: 0, Hard: 0, "Very Hard": 0};
let expectedLongestGuess = 0;
let expectedShortestGuess = 0;

for (const key of expectedKeys) {
  const question = batch && batch[key];
  if (!question || typeof question !== "object") {
    errors.push(`Question ${key} is missing or invalid.`);
    continue;
  }

  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(question, field)) {
      errors.push(`Question ${key} is missing ${field}.`);
    }
  }

  const options = [question.option1, question.option2, question.option3, question.option4];
  if (options.filter((option) => option === question.correctAnswer).length !== 1) {
    errors.push(`Question ${key} correctAnswer must exactly match one and only one option.`);
  }
  const lengthSignal = choiceLengthSignal(options, question.correctAnswer);
  if (lengthSignal) {
    expectedLongestGuess += lengthSignal.expectedLongestGuess;
    expectedShortestGuess += lengthSignal.expectedShortestGuess;
    const margin = lengthSignal.correctLength - lengthSignal.longestDistractor;
    const ratio = lengthSignal.longestDistractor ? lengthSignal.correctLength / lengthSignal.longestDistractor : Infinity;
    if (lengthSignal.longestIndexes.length === 1 && lengthSignal.longestIndexes[0] === lengthSignal.correctIndex && margin >= 12 && ratio >= 1.18) {
      errors.push(`Question ${key} leaks its answer through length: the correct choice is ${margin} visible characters longer than every distractor.`);
    }
    const shortestMargin = lengthSignal.shortestDistractor - lengthSignal.correctLength;
    if (lengthSignal.shortestIndexes.length === 1 && lengthSignal.shortestIndexes[0] === lengthSignal.correctIndex && shortestMargin >= 12) {
      errors.push(`Question ${key} leaks its answer through brevity: the correct choice is ${shortestMargin} visible characters shorter than every distractor.`);
    }
  }
  if (!allowedModules.has(question.module)) {
    errors.push(`Question ${key} has an unsupported module: ${question.module}.`);
  }
  if (!Object.prototype.hasOwnProperty.call(difficultyCounts, question.difficulty)) {
    errors.push(`Question ${key} has an unsupported difficulty: ${question.difficulty}.`);
  } else {
    difficultyCounts[question.difficulty] += 1;
  }
  if (!Array.isArray(question.imageSources) || question.imageSources.length !== 0) {
    errors.push(`Question ${key} imageSources must be an empty array for this run.`);
  }
  if (question.passage !== "{{shared_passage}}") {
    errors.push(`Question ${key} passage must be exactly {{shared_passage}}.`);
  }
  if (typeof question.explanation !== "string" || !question.explanation.includes("Step 1:") || !question.explanation.includes("Answer:")) {
    errors.push(`Question ${key} explanation is missing required plain-text step or answer labels.`);
  }
  if (/<(?:b|strong)>\s*(?:Step|Answer|Additional reasoning step)/i.test(question.explanation || "")) {
    errors.push(`Question ${key} bolds an explanation label.`);
  }
  if (/Additional reasoning step:/i.test(question.explanation || "")) {
    errors.push(`Question ${key} must number its reasoning sequentially instead of using Additional reasoning step.`);
  }

  for (const [field, value] of Object.entries(question)) {
    if (typeof value === "string" && value.includes('"')) {
      errors.push(`Question ${key} field ${field} contains a literal double quotation mark.`);
    }
  }
}

if (difficultyCounts.Medium !== 3 || difficultyCounts.Hard !== 4 || difficultyCounts["Very Hard"] !== 2) {
  errors.push(`Difficulty distribution must be 3 Medium, 4 Hard, 2 Very Hard; received ${JSON.stringify(difficultyCounts)}.`);
}

if (expectedLongestGuess > 4.001) {
  errors.push(`A longest-choice strategy is expected to answer ${expectedLongestGuess.toFixed(1)} of 9 questions correctly; the maximum is 4.0.`);
}
if (expectedShortestGuess > 4.001) {
  errors.push(`A shortest-choice strategy is expected to answer ${expectedShortestGuess.toFixed(1)} of 9 questions correctly; the maximum is 4.0.`);
}

if (errors.length) {
  fail(errors);
} else {
  console.log(`Validated questions ${start}-${start + 8}: 9 records, canonical fields, and correct difficulty distribution.`);
}
