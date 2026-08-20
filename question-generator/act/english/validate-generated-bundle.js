"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const allowedModules = new Set([
  "Conciseness and Redundancy",
  "Modifiers and Comparisons",
  "Organization and Cohesion",
  "Pronouns",
  "Punctuation",
  "Sentence Structure",
  "Style and Tone",
  "Subject-Verb Agreement",
  "Topic Development",
  "Transitions and Logical Relationships",
  "Verb Tense and Form",
  "Word Choice and Usage",
]);
const categories = new Set([
  "Production of Writing",
  "Knowledge of Language",
  "Conventions of Standard English",
]);
const categoryByModule = new Map([
  ["Topic Development", new Set(["Production of Writing"])],
  ["Organization and Cohesion", new Set(["Production of Writing"])],
  ["Transitions and Logical Relationships", new Set(["Production of Writing", "Knowledge of Language"])],
  ["Conciseness and Redundancy", new Set(["Knowledge of Language"])],
  ["Style and Tone", new Set(["Knowledge of Language"])],
  ["Word Choice and Usage", new Set(["Knowledge of Language"])],
]);
const requiredFields = [
  "skill_tested", "question", "option1", "option2", "option3", "option4",
  "correctAnswer", "explanation", "practiceYear", "difficulty", "module",
  "imageSources", "passage",
];

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
  return {correctIndex, correctLength: lengths[correctIndex], longestDistractor, longestIndexes, expectedLongestGuess: longestIndexes.includes(correctIndex) ? 1 / longestIndexes.length : 0, shortestIndexes, shortestDistractor, expectedShortestGuess: shortestIndexes.includes(correctIndex) ? 1 / shortestIndexes.length : 0};
}

function expectedCategory(module) {
  return categoryByModule.get(module) || new Set(["Conventions of Standard English"]);
}

function wordCount(value) {
  return String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\[[A-D0-9]+\]/g, " ")
      .replace(/[^\p{L}\p{N}'’-]+/gu, " ")
      .trim().split(/\s+/).filter(Boolean).length;
}

function ids(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => Number(row.target_id));
}

function parseQuestions(filename) {
  const source = fs.readFileSync(filename, "utf8").trim();
  return vm.runInNewContext(`(${source})`, Object.create(null), {
    timeout: 1000,
    codeGeneration: {strings: false, wasm: false},
  });
}

const [, , bundlePath, startText] = process.argv;
if (!bundlePath) {
  console.error("Usage: node validate-generated-bundle.js <bundle-directory> [starting-export-key]");
  process.exit(1);
}

const directory = path.resolve(bundlePath);
const passagePath = path.join(directory, "passage.json");
const questionsPath = ["final.jsfrag", "questions.jsfrag"]
    .map((name) => path.join(directory, name)).find((filename) => fs.existsSync(filename));
const errors = [];
const warnings = [];

if (!fs.existsSync(passagePath)) errors.push(`Missing ${passagePath}.`);
if (!questionsPath) errors.push(`Missing final.jsfrag or questions.jsfrag in ${directory}.`);
if (errors.length) {
  errors.forEach((message) => console.error(`ERROR: ${message}`));
  process.exit(1);
}

let asset;
let questions;
try {
  asset = JSON.parse(fs.readFileSync(passagePath, "utf8"));
} catch (error) {
  errors.push(`passage.json is not strict JSON: ${error.message}`);
}
try {
  questions = parseQuestions(questionsPath);
} catch (error) {
  errors.push(`Question fragment is not parseable: ${error.message}`);
}

if (asset && questions) {
  const passageClass = asset.passage_class;
  const expectedCount = passageClass === "LONG" ? 10 : passageClass === "SHORT" ? 5 : 0;
  if (!expectedCount) errors.push(`Unsupported passage_class: ${JSON.stringify(passageClass)}.`);
  if (Number(asset.required_target_count) !== expectedCount) {
    errors.push(`required_target_count must be ${expectedCount} for ${passageClass}.`);
  }
  if (Number(asset.passage_quality_self_check?.final_target_count) !== expectedCount) {
    errors.push(`passage_quality_self_check.final_target_count must be ${expectedCount}.`);
  }

  const titlePrefix = `<b>${asset.passage_title}</b><br><br>`;
  for (const field of ["student_passage", "corrected_passage"]) {
    if (!String(asset[field] || "").startsWith(titlePrefix)) {
      errors.push(`${field} must begin with the exact rendered passage title.`);
    }
  }
  const words = wordCount(String(asset.student_passage || "").slice(titlePrefix.length));
  if (passageClass === "LONG" && (words < 320 || words > 370)) {
    errors.push(`LONG passage has ${words} words; expected 320-370.`);
  }
  if (passageClass === "SHORT" && (words < 160 || words > 210)) {
    errors.push(`SHORT passage has ${words} words; expected 160-210.`);
  }
  if (!String(asset.student_passage || "").includes("<br><br>")) {
    errors.push("student_passage has no renderer-safe paragraph break.");
  }
  if ((String(asset.student_passage || "").match(/<u>/g) || []).length !==
      (String(asset.student_passage || "").match(/<\/u>/g) || []).length) {
    errors.push("student_passage has unbalanced underline tags.");
  }

  const expectedIds = Array.from({length: expectedCount}, (_, index) => index + 1);
  const markerIds = [...String(asset.student_passage || "").matchAll(/<b>\[(\d+)\]<\/b>/g)]
      .map((match) => Number(match[1]));
  if (JSON.stringify(markerIds) !== JSON.stringify(expectedIds)) {
    errors.push(`Passage marker order is ${markerIds.join(", ")}; expected ${expectedIds.join(", ")}.`);
  }
  for (const [name, rows] of [
    ["edit_targets", asset.edit_targets],
    ["question_opportunities", asset.question_opportunities],
    ["module_coverage_plan", asset.module_coverage_plan],
  ]) {
    if (JSON.stringify(ids(rows)) !== JSON.stringify(expectedIds)) {
      errors.push(`${name} target IDs must be ${expectedIds.join(", ")}.`);
    }
  }

  const targets = new Map((asset.edit_targets || []).map((row) => [Number(row.target_id), row]));
  for (const [targetId, target] of targets) {
    if (!allowedModules.has(target.module)) errors.push(`Target ${targetId} has unsupported module ${target.module}.`);
    if (!categories.has(target.reporting_category)) errors.push(`Target ${targetId} has unsupported reporting category.`);
    if (categories.has(target.reporting_category) &&
        !expectedCategory(target.module).has(target.reporting_category)) {
      errors.push(`Target ${targetId} module ${target.module} does not match ${target.reporting_category}.`);
    }
  }

  const keys = Object.keys(questions).map(Number).sort((left, right) => left - right);
  if (keys.length !== expectedCount) errors.push(`Question fragment contains ${keys.length}; expected ${expectedCount}.`);
  if (startText !== undefined) {
    const start = Number(startText);
    const expectedKeys = Array.from({length: expectedCount}, (_, index) => start + index);
    if (!Number.isInteger(start) || JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
      errors.push(`Export keys must be consecutive from ${startText}.`);
    }
  } else if (keys.some((key, index) => index && key !== keys[index - 1] + 1)) {
    errors.push("Export keys must be consecutive.");
  }

  let expectedLongestGuess = 0;
  let expectedShortestGuess = 0;
  keys.forEach((key, index) => {
    const question = questions[key];
    const targetId = index + 1;
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(question, field)) errors.push(`Question ${key} is missing ${field}.`);
    }
    if (!String(question.question || "").startsWith(`(${targetId})`)) {
      errors.push(`Question ${key} must begin with (${targetId}).`);
    }
    const options = [question.option1, question.option2, question.option3, question.option4];
    if (new Set(options).size !== 4) errors.push(`Question ${key} has duplicate answer choices.`);
    if (options.filter((option) => option === question.correctAnswer).length !== 1) {
      errors.push(`Question ${key} correctAnswer must match exactly one option.`);
    }
    const lengthSignal = choiceLengthSignal(options, question.correctAnswer);
    if (lengthSignal) {
      expectedLongestGuess += lengthSignal.expectedLongestGuess;
      expectedShortestGuess += lengthSignal.expectedShortestGuess;
      const margin = lengthSignal.correctLength - lengthSignal.longestDistractor;
      const ratio = lengthSignal.longestDistractor ? lengthSignal.correctLength / lengthSignal.longestDistractor : Infinity;
      if (lengthSignal.longestIndexes.length === 1 && lengthSignal.longestIndexes[0] === lengthSignal.correctIndex && margin >= 12 && ratio >= 1.18) {
        errors.push(`Question ${key} leaks its answer through length by ${margin} visible characters.`);
      }
      const shortestMargin = lengthSignal.shortestDistractor - lengthSignal.correctLength;
      if (lengthSignal.shortestIndexes.length === 1 && lengthSignal.shortestIndexes[0] === lengthSignal.correctIndex && shortestMargin >= 12) {
        errors.push(`Question ${key} leaks its answer through brevity by ${shortestMargin} visible characters.`);
      }
    }
    if (!allowedModules.has(question.module)) errors.push(`Question ${key} has unsupported module ${question.module}.`);
    if (targets.get(targetId)?.module !== question.module) errors.push(`Question ${key} silently changed its target module.`);
    if (!new Set(["Medium", "Hard", "Very Hard"]).has(question.difficulty)) {
      errors.push(`Question ${key} has unsupported difficulty ${question.difficulty}.`);
    }
    if (!Array.isArray(question.imageSources) || question.imageSources.length) {
      errors.push(`Question ${key} imageSources must be [].`);
    }
    if (question.passage !== "{{shared_passage}}") errors.push(`Question ${key} must use {{shared_passage}}.`);
    if (question.practiceYear !== 1) warnings.push(`Question ${key} practiceYear is not the deferred placeholder 1.`);
    const explanation = String(question.explanation || "");
    if (!explanation.includes("<b>Step 1:</b>") ||
        !explanation.includes("<br><br><b>Step 2:</b>") ||
        !explanation.includes("<br><br><b>Answer:</b>")) {
      errors.push(`Question ${key} explanation does not use the required stepped HTML format.`);
    }
    if (!explanation.endsWith(String(question.correctAnswer || ""))) {
      errors.push(`Question ${key} explanation must end with the exact correctAnswer.`);
    }
  });
  if (expectedLongestGuess > expectedCount * 0.4 + 0.001) {
    errors.push(`The bundle allows a longest-choice strategy to score ${expectedLongestGuess.toFixed(1)} of ${expectedCount}; maximum ${(expectedCount * 0.4).toFixed(1)}.`);
  }
  if (expectedShortestGuess > expectedCount * 0.4 + 0.001) {
    errors.push(`The bundle allows a shortest-choice strategy to score ${expectedShortestGuess.toFixed(1)} of ${expectedCount}; maximum ${(expectedCount * 0.4).toFixed(1)}.`);
  }
}

warnings.forEach((message) => console.warn(`WARNING: ${message}`));
errors.forEach((message) => console.error(`ERROR: ${message}`));
if (errors.length) process.exitCode = 1;
else console.log(`Validated ${asset.passage_class} English bundle ${asset.passage_asset_id || path.basename(directory)}.`);
