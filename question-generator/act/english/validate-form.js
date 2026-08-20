"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const bundleDirectories = process.argv.slice(2).map((value) => path.resolve(value));
if (bundleDirectories.length !== 6) {
  console.error("Usage: node validate-form.js <bundle-1> <bundle-2> <bundle-3> <bundle-4> <bundle-5> <bundle-6>");
  process.exit(1);
}

function parseQuestions(directory) {
  const filename = ["final.jsfrag", "questions.jsfrag"]
      .map((name) => path.join(directory, name)).find((candidate) => fs.existsSync(candidate));
  if (!filename) throw new Error(`Missing question fragment in ${directory}`);
  return vm.runInNewContext(`(${fs.readFileSync(filename, "utf8").trim()})`, Object.create(null), {
    timeout: 1000,
    codeGeneration: {strings: false, wasm: false},
  });
}

function visibleLength(value) {
  return String(value || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

const errors = [];
const totals = {
  questions: 0,
  classes: {LONG: 0, SHORT: 0},
  types: {informational: 0, argumentative: 0, narrative: 0},
  categories: {
    "Production of Writing": 0,
    "Knowledge of Language": 0,
    "Conventions of Standard English": 0,
  },
  difficulties: {Medium: 0, Hard: 0, "Very Hard": 0},
  answerPositions: [0, 0, 0, 0],
  expectedLongestGuess: 0,
  expectedShortestGuess: 0,
};
const titles = new Set();

for (const directory of bundleDirectories) {
  try {
    const asset = JSON.parse(fs.readFileSync(path.join(directory, "passage.json"), "utf8"));
    const questions = parseQuestions(directory);
    const rows = Object.values(questions);
    totals.questions += rows.length;
    if (Object.prototype.hasOwnProperty.call(totals.classes, asset.passage_class)) {
      totals.classes[asset.passage_class] += 1;
    } else {
      errors.push(`${directory} has unsupported passage class ${asset.passage_class}.`);
    }
    const type = String(asset.passage_type || "").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(totals.types, type)) totals.types[type] += 1;
    else errors.push(`${directory} has unsupported passage type ${asset.passage_type}.`);

    const title = String(asset.passage_title || "").trim().toLowerCase();
    if (titles.has(title)) errors.push(`Duplicate generated passage title: ${asset.passage_title}.`);
    titles.add(title);

    for (const target of asset.edit_targets || []) {
      if (Object.prototype.hasOwnProperty.call(totals.categories, target.reporting_category)) {
        totals.categories[target.reporting_category] += 1;
      } else {
        errors.push(`${asset.passage_title} has unsupported reporting category ${target.reporting_category}.`);
      }
    }
    for (const question of rows) {
      if (Object.prototype.hasOwnProperty.call(totals.difficulties, question.difficulty)) {
        totals.difficulties[question.difficulty] += 1;
      }
      const options = [question.option1, question.option2, question.option3, question.option4];
      const index = options.indexOf(question.correctAnswer);
      if (index >= 0) totals.answerPositions[index] += 1;
      if (index >= 0) {
        const lengths = options.map(visibleLength);
        const longest = Math.max(...lengths);
        const shortest = Math.min(...lengths);
        const longestIndexes = lengths.map((length, optionIndex) => ({length, optionIndex})).filter(({length}) => length === longest).map(({optionIndex}) => optionIndex);
        if (longestIndexes.includes(index)) totals.expectedLongestGuess += 1 / longestIndexes.length;
        const shortestIndexes = lengths.map((length, optionIndex) => ({length, optionIndex})).filter(({length}) => length === shortest).map(({optionIndex}) => optionIndex);
        if (shortestIndexes.includes(index)) totals.expectedShortestGuess += 1 / shortestIndexes.length;
      }
    }
  } catch (error) {
    errors.push(`${directory}: ${error.message}`);
  }
}

if (totals.questions !== 50) errors.push(`Form has ${totals.questions} questions; expected 50.`);
if (totals.classes.LONG !== 4 || totals.classes.SHORT !== 2) {
  errors.push(`Form has ${totals.classes.LONG} LONG and ${totals.classes.SHORT} SHORT passages; expected 4 and 2.`);
}
if (totals.types.informational < 2 || totals.types.argumentative < 1 || totals.types.narrative < 1) {
  errors.push(`Form passage types are ${JSON.stringify(totals.types)}; require at least 2 informational, 1 argumentative, and 1 narrative.`);
}
if (totals.types.informational > 4 || totals.types.argumentative > 2 || totals.types.narrative > 2) {
  errors.push(`Form passage types are ${JSON.stringify(totals.types)}; allow at most 4 informational, 2 argumentative, and 2 narrative passages.`);
}
const categoryRanges = {
  "Production of Writing": [19, 21],
  "Knowledge of Language": [9, 11],
  "Conventions of Standard English": [19, 21],
};
for (const [category, [minimum, maximum]] of Object.entries(categoryRanges)) {
  const count = totals.categories[category];
  if (count < minimum || count > maximum) errors.push(`${category} count is ${count}; expected ${minimum}-${maximum}.`);
}
const difficultyRanges = {Medium: [14, 22], Hard: [18, 26], "Very Hard": [6, 14]};
for (const [difficulty, [minimum, maximum]] of Object.entries(difficultyRanges)) {
  const count = totals.difficulties[difficulty];
  if (count < minimum || count > maximum) errors.push(`${difficulty} count is ${count}; expected ${minimum}-${maximum}.`);
}
if (Math.max(...totals.answerPositions) - Math.min(...totals.answerPositions) > 4) {
  errors.push(`Correct-answer positions are imbalanced: ${totals.answerPositions.join(", ")}.`);
}
if (totals.expectedLongestGuess > 18.001) {
  errors.push(`A longest-choice strategy is expected to answer ${totals.expectedLongestGuess.toFixed(1)} of 50 questions correctly; maximum 18.0.`);
}
if (totals.expectedShortestGuess > 18.001) {
  errors.push(`A shortest-choice strategy is expected to answer ${totals.expectedShortestGuess.toFixed(1)} of 50 questions correctly; maximum 18.0.`);
}

console.log(JSON.stringify(totals, null, 2));
errors.forEach((message) => console.error(`ERROR: ${message}`));
if (errors.length) process.exitCode = 1;
else console.log("Validated complete 50-question ACT English form.");
