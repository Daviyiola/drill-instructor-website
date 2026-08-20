"use strict";
/* eslint-disable max-len, require-jsdoc */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const dataPath = path.join(repositoryRoot, "functions", "data", "actData.js");
const repairPath = process.argv[2] ?
  path.resolve(repositoryRoot, process.argv[2]) :
  path.join(repositoryRoot, "question-reviews", "act-option-choice-repairs.json");
const repairDocument = JSON.parse(fs.readFileSync(repairPath, "utf8"));
let source = fs.readFileSync(dataPath, "utf8");
const subjects = vm.runInNewContext(`${source}\n;allSubjects;`, Object.create(null), {
  timeout: 10000,
  codeGeneration: {strings: false, wasm: false},
});

function subjectRange(subjectName) {
  const marker = `    subject: ${JSON.stringify(subjectName)},`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Could not locate ${subjectName}.`);
  const start = source.lastIndexOf("  {", markerIndex);
  const next = source.indexOf("\n  {\n    subject:", markerIndex + marker.length);
  return {start, end: next < 0 ? source.lastIndexOf("\n];") : next};
}

function questionRange(subjectName, bankIndex) {
  const range = subjectRange(subjectName);
  const marker = `    ${bankIndex}: {`;
  const start = source.indexOf(marker, range.start);
  if (start < 0 || start >= range.end) throw new Error(`Could not locate ${subjectName} question ${bankIndex}.`);
  const closingMarker = source.indexOf("\n    },", start);
  const end = closingMarker < 0 || closingMarker >= range.end ? range.end : closingMarker + "\n    },".length;
  if (end <= start || end > range.end) throw new Error(`Could not isolate ${subjectName} question ${bankIndex}.`);
  return {start, end};
}

let applied = 0;
for (const repair of repairDocument.repairs || []) {
  const subject = subjects.find((entry) => entry.subject === repair.subject);
  const question = subject && subject[repair.bankIndex];
  if (!question) throw new Error(`Unknown ${repair.subject} question ${repair.bankIndex}.`);
  if (question.question !== repair.question) throw new Error(`Question guard failed for ${repair.subject} ${repair.bankIndex}.`);
  if (!Array.isArray(repair.options) || repair.options.length !== 4 || new Set(repair.options).size !== 4) {
    throw new Error(`${repair.subject} ${repair.bankIndex} must provide four distinct options.`);
  }
  const oldOptions = [question.option1, question.option2, question.option3, question.option4];
  const correctIndex = oldOptions.indexOf(question.correctAnswer);
  if (correctIndex < 0) throw new Error(`${repair.subject} ${repair.bankIndex} has an invalid existing key.`);
  const newCorrectAnswer = repair.options[correctIndex];
  const range = questionRange(repair.subject, repair.bankIndex);
  let block = source.slice(range.start, range.end);
  for (let index = 0; index < 4; index += 1) {
    const pattern = new RegExp(`(\\n      option${index + 1}: )${JSON.stringify(oldOptions[index]).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(,)`);
    if (!pattern.test(block)) throw new Error(`Could not replace option ${index + 1} for ${repair.subject} ${repair.bankIndex}.`);
    block = block.replace(pattern, `$1${JSON.stringify(repair.options[index])}$2`);
  }
  const correctPattern = new RegExp(`(\\n      correctAnswer: )${JSON.stringify(question.correctAnswer).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(,)`);
  if (!correctPattern.test(block)) throw new Error(`Could not replace the answer key for ${repair.subject} ${repair.bankIndex}.`);
  block = block.replace(correctPattern, `$1${JSON.stringify(newCorrectAnswer)}$2`);
  if (newCorrectAnswer !== question.correctAnswer) {
    const explanation = String(question.explanation || "");
    const answerSuffix = `Answer:</b> ${question.correctAnswer}`;
    const plainAnswerSuffix = `Answer: ${question.correctAnswer}`;
    let updated = explanation;
    if (updated.includes(answerSuffix)) updated = updated.replace(answerSuffix, `Answer:</b> ${newCorrectAnswer}`);
    else if (updated.includes(plainAnswerSuffix)) updated = updated.replace(plainAnswerSuffix, `Answer: ${newCorrectAnswer}`);
    else if (updated.includes(question.correctAnswer)) {
      const answerIndex = updated.lastIndexOf(question.correctAnswer);
      updated = `${updated.slice(0, answerIndex)}${newCorrectAnswer}${updated.slice(answerIndex + question.correctAnswer.length)}`;
    }
    if (updated !== explanation) {
      const explanationPattern = new RegExp(`(\\n      explanation: )${JSON.stringify(explanation).replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(,)`);
      if (!explanationPattern.test(block)) throw new Error(`Could not replace the explanation for ${repair.subject} ${repair.bankIndex}.`);
      block = block.replace(explanationPattern, `$1${JSON.stringify(updated)}$2`);
    }
  }
  source = source.slice(0, range.start) + block + source.slice(range.end);
  applied += 1;
}

fs.writeFileSync(dataPath, source, "utf8");
console.log(`Applied ${applied} answer-choice repairs to actData.js.`);
