"use strict";
/* eslint-disable max-len, require-jsdoc, indent */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const [subjectName = "Reading", groupText = "1", mode = "full"] = process.argv.slice(2);
const requestedGroup = Number(groupText);
const dataPath = path.join(__dirname, "..", "data", "actData.js");
const source = fs.readFileSync(dataPath, "utf8");
const subjects = vm.runInNewContext(`${source}\n;allSubjects;`, Object.create(null), {
  timeout: 10000,
  codeGeneration: {strings: false, wasm: false},
});
const subject = subjects.find((entry) => entry.subject.toLowerCase() === subjectName.toLowerCase());
if (!subject) throw new Error(`Unknown subject ${subjectName}.`);

const groups = [];
const byPassage = new Map();
for (const key of Object.keys(subject).filter((value) => /^\d+$/.test(value)).map(Number).sort((a, b) => a - b)) {
  const question = subject[key];
  const passage = String(question.passage || "");
  if (!byPassage.has(passage)) {
    const group = {passage, questions: []};
    byPassage.set(passage, group);
    groups.push(group);
  }
  byPassage.get(passage).questions.push({bankIndex: key, ...question});
}

if (!Number.isInteger(requestedGroup) || requestedGroup < 1 || requestedGroup > groups.length) {
  throw new Error(`${subject.subject} contains ${groups.length} passage groups; choose 1-${groups.length}.`);
}

const group = groups[requestedGroup - 1];
function visibleLength(value) {
  return String(value || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}
function uniquelyLongestCorrect(question) {
  const options = [question.option1, question.option2, question.option3, question.option4];
  const correctIndex = options.indexOf(question.correctAnswer);
  const lengths = options.map(visibleLength);
  const maximum = Math.max(...lengths);
  return correctIndex >= 0 && lengths[correctIndex] === maximum && lengths.filter((length) => length === maximum).length === 1;
}
function longestCorrectMargin(question) {
  const options = [question.option1, question.option2, question.option3, question.option4];
  const correctIndex = options.indexOf(question.correctAnswer);
  if (correctIndex < 0) return -Infinity;
  const lengths = options.map(visibleLength);
  return lengths[correctIndex] - Math.max(...lengths.filter((_, index) => index !== correctIndex));
}
function uniquelyShortestCorrect(question) {
  const options = [question.option1, question.option2, question.option3, question.option4];
  const correctIndex = options.indexOf(question.correctAnswer);
  const lengths = options.map(visibleLength);
  const minimum = Math.min(...lengths);
  return correctIndex >= 0 && lengths[correctIndex] === minimum && lengths.filter((length) => length === minimum).length === 1;
}
let filtered = subject.subject === "English" ? group.questions.filter((question) => question.module === "Topic Development") : group.questions;
if (mode === "flagged") filtered = filtered.filter(uniquelyLongestCorrect);
if (mode === "severe20") filtered = filtered.filter((question) => longestCorrectMargin(question) >= 20);
if (mode === "severe10") filtered = filtered.filter((question) => longestCorrectMargin(question) >= 10);
if (mode === "shortest") filtered = filtered.filter(uniquelyShortestCorrect);
const output = {
  subject: subject.subject,
  group: requestedGroup,
  groupCount: groups.length,
    passage: mode === "full" ? group.passage : undefined,
  questions: filtered.map((question) => ({
    bankIndex: question.bankIndex,
    module: question.module,
    difficulty: question.difficulty,
    question: question.question,
    options: [question.option1, question.option2, question.option3, question.option4],
    correctAnswer: question.correctAnswer,
    optionLengths: [question.option1, question.option2, question.option3, question.option4].map(visibleLength),
    explanation: ["severe20", "severe10", "shortest"].includes(mode) ? undefined : question.explanation,
  })),
};
console.log(JSON.stringify(output, null, 2));
