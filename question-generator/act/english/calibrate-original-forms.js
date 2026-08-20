"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const repositoryRoot = path.resolve(root, "../../..");
const dataPath = path.join(repositoryRoot, "functions", "data", "actData.js");
const config = JSON.parse(fs.readFileSync(path.join(root, "original-forms-calibration.json"), "utf8"));
const beginMarker = "    // BEGIN CALIBRATED ORIGINAL ACT ENGLISH 1-100";
const endMarker = "    // END CALIBRATED ORIGINAL ACT ENGLISH 1-100";
const generatedMarker = "    // BEGIN GENERATED ACT ENGLISH 101-400";

function loadDataset(source) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, {filename: dataPath, timeout: 5000});
  return vm.runInContext("getSubjects()", context, {filename: dataPath, timeout: 5000});
}

function originalChoice(question) {
  const target = Number(String(question.question || "").match(/^\((\d+)\)/u)?.[1]);
  if (!target) throw new Error(`Cannot determine target number for ${question.question}.`);
  const matches = [...String(question.passage || "")
      .matchAll(/<u>([\s\S]*?)<\/u>\s*<b>\[(\d+)\]<\/b>/gu)];
  const match = matches.find((row) => Number(row[2]) === target);
  if (!match) throw new Error(`Cannot find underlined target ${target} in its passage.`);
  return match[1]
      .replace(/<br\s*\/?\s*>/giu, " ")
      .replace(/<[^>]+>/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
}

function options(question) {
  return [question.option1, question.option2, question.option3, question.option4];
}

let source = fs.readFileSync(dataPath, "utf8");
const eol = source.includes("\r\n") ? "\r\n" : "\n";
const dataset = loadDataset(source);
const english = dataset.find((subject) => subject.subject === "English");
if (!english) throw new Error("ACT English was not found.");

const calibrated = {};
const answerMoveTargets = new Map();
for (const form of config.forms) {
  for (const [letter, keys] of Object.entries(form.answerMoves)) {
    keys.forEach((key) => answerMoveTargets.set(key, "ABCD".indexOf(letter)));
  }
}
const noChangeOption1 = new Set(config.originalNoChangeOption1Keys);
const noChangeCorrect = new Set(config.originalNoChangeCorrectKeys);
for (let key = 1; key <= 100; key += 1) {
  const question = {...english[key]};
  if (!question) throw new Error(`ACT English question ${key} is missing.`);
  const currentOptions = options(question).map((option) => String(option).trim());
  const moveTarget = answerMoveTargets.get(key);
  const currentAnswer = currentOptions.indexOf(question.correctAnswer);
  if (moveTarget !== undefined && currentAnswer === moveTarget) {
    [currentOptions[1], currentOptions[moveTarget]] = [currentOptions[moveTarget], currentOptions[1]];
  }
  if (noChangeOption1.has(key)) currentOptions[0] = originalChoice(question);
  if (noChangeCorrect.has(key)) {
    question.correctAnswer = currentOptions[0];
    question.explanation = String(question.explanation || "")
        .replace(/NO CHANGE/giu, `“${question.correctAnswer}”`);
  }
  if (new Set(currentOptions).size !== 4) {
    throw new Error(`Question ${key} has duplicate choices after expanding NO CHANGE.`);
  }
  [question.option1, question.option2, question.option3, question.option4] = currentOptions;
  calibrated[key] = question;
}

for (const form of config.forms) {
  const medium = new Set(form.mediumKeys);
  const veryHard = new Set(form.veryHardKeys);
  for (let key = form.range[0]; key <= form.range[1]; key += 1) {
    calibrated[key].difficulty = medium.has(key) ? "Medium" : veryHard.has(key) ? "Very Hard" : "Hard";
  }
  for (const [letter, keys] of Object.entries(form.answerMoves)) {
    const target = "ABCD".indexOf(letter);
    for (const key of keys) {
      const question = calibrated[key];
      const currentOptions = options(question);
      const current = currentOptions.indexOf(question.correctAnswer);
      if (current < 0) throw new Error(`Question ${key} has no matching correct choice.`);
      [currentOptions[current], currentOptions[target]] = [currentOptions[target], currentOptions[current]];
      [question.option1, question.option2, question.option3, question.option4] = currentOptions;
    }
  }
}

const rendered = JSON.stringify(calibrated, null, 2).split("\n")
    .slice(1, -1).map((line) => `  ${line}`).join(eol);
const block = `${beginMarker}${eol}${rendered},${eol}${endMarker}${eol}`;
const existingBegin = source.indexOf(beginMarker);
const existingEnd = source.indexOf(endMarker);
if (existingBegin >= 0 || existingEnd >= 0) {
  if (existingBegin < 0 || existingEnd < existingBegin) throw new Error("Original-form calibration markers are incomplete.");
  source = source.slice(0, existingBegin) + block + source.slice(existingEnd + endMarker.length + eol.length);
} else {
  const englishHeader = source.indexOf(`  {${eol}    subject: "English",`);
  const subjectLine = source.indexOf('    subject: "English",', englishHeader);
  const headerEnd = source.indexOf(eol, subjectLine) + eol.length;
  const generatedStart = source.indexOf(generatedMarker, headerEnd);
  if (englishHeader < 0 || headerEnd <= 0 || generatedStart < 0) throw new Error("Could not isolate original ACT English questions.");
  source = source.slice(0, headerEnd) + block + source.slice(generatedStart);
}

loadDataset(source);
fs.writeFileSync(dataPath, source, "utf8");
console.log("Calibrated ACT English Forms 1 and 2 (questions 1-100).");
