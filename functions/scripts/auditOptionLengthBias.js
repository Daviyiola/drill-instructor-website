"use strict";
/* eslint-disable max-len, require-jsdoc, indent */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dataPath = path.join(__dirname, "..", "data", "actData.js");
const source = fs.readFileSync(dataPath, "utf8");
const subjects = vm.runInNewContext(`${source}\n;allSubjects;`, Object.create(null), {
  timeout: 10000,
  codeGeneration: {strings: false, wasm: false},
});

function plain(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recordsFor(subjectName) {
  const subject = subjects.find((entry) => entry.subject === subjectName);
  if (!subject) return [];
  return Object.keys(subject)
    .filter((key) => /^\d+$/.test(key))
    .map((key) => ({bankIndex: Number(key), ...subject[key]}));
}

function walkFiles(root, suffix, output = []) {
  if (!fs.existsSync(root)) return output;
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, suffix, output);
    else if (entry.name.endsWith(suffix)) output.push(fullPath);
  }
  return output;
}

function generatedFingerprints(subjectName) {
  const folder = path.join(__dirname, "..", "..", "question-generator", "act", subjectName.toLowerCase(), "work");
  const fingerprints = new Set();
  for (const file of walkFiles(folder, "final.jsfrag")) {
    try {
      const parsed = vm.runInNewContext(`(${fs.readFileSync(file, "utf8").trim()})`, Object.create(null), {
        timeout: 1000,
        codeGeneration: {strings: false, wasm: false},
      });
      for (const value of Object.values(parsed || {})) {
        fingerprints.add(`${plain(value.question)}||${plain(value.correctAnswer)}`);
      }
    } catch (_) {
      // A malformed staging fragment should not prevent auditing the production bank.
    }
  }
  return fingerprints;
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function summarize(subjectName) {
  const records = recordsFor(subjectName);
  const generated = generatedFingerprints(subjectName);
  const rows = records.map((question) => {
    const options = [question.option1, question.option2, question.option3, question.option4];
    const lengths = options.map((option) => plain(option).length);
    const correctIndex = options.findIndex((option) => plain(option) === plain(question.correctAnswer));
    const maxLength = Math.max(...lengths);
    const minLength = Math.min(...lengths);
    const longestIndexes = lengths.map((length, index) => ({length, index}))
      .filter((entry) => entry.length === maxLength)
      .map((entry) => entry.index);
    const shortestIndexes = lengths.map((length, index) => ({length, index}))
      .filter((entry) => entry.length === minLength)
      .map((entry) => entry.index);
    const distractorLengths = lengths.filter((_, index) => index !== correctIndex);
    const longestDistractor = Math.max(...distractorLengths);
    return {
      bankIndex: question.bankIndex,
      practiceYear: question.practiceYear,
      module: question.module,
      prompt: plain(question.question),
      provenance: generated.has(`${plain(question.question)}||${plain(question.correctAnswer)}`) ? "generated" : "preexisting_or_edited",
      correctIndex,
      lengths,
      correctLength: correctIndex >= 0 ? lengths[correctIndex] : null,
      longestIndexes,
      uniqueLongestCorrect: longestIndexes.length === 1 && longestIndexes[0] === correctIndex,
      longestOrTiedCorrect: longestIndexes.includes(correctIndex),
      expectedLongestGuess: longestIndexes.includes(correctIndex) ? 1 / longestIndexes.length : 0,
      uniqueShortestCorrect: shortestIndexes.length === 1 && shortestIndexes[0] === correctIndex,
      expectedShortestGuess: shortestIndexes.includes(correctIndex) ? 1 / shortestIndexes.length : 0,
      margin: correctIndex >= 0 ? lengths[correctIndex] - longestDistractor : null,
    };
  });

  const valid = rows.filter((row) => row.correctIndex >= 0);
  const byTest = {};
  const byModule = {};
  const byProvenance = {};
  for (const row of valid) {
    const key = String(row.practiceYear || "unknown");
    byTest[key] = byTest[key] ||
      {questions: 0, uniqueLongestCorrect: 0, expectedLongestGuess: 0,
        uniqueShortestCorrect: 0, expectedShortestGuess: 0};
    byTest[key].questions += 1;
    byTest[key].uniqueLongestCorrect += row.uniqueLongestCorrect ? 1 : 0;
    byTest[key].expectedLongestGuess += row.expectedLongestGuess;
    byTest[key].uniqueShortestCorrect += row.uniqueShortestCorrect ? 1 : 0;
    byTest[key].expectedShortestGuess += row.expectedShortestGuess;

    const moduleKey = String(row.module || "Unclassified");
    byModule[moduleKey] = byModule[moduleKey] ||
      {questions: 0, uniqueLongestCorrect: 0,
        expectedLongestGuess: 0, margin10: 0};
    byModule[moduleKey].questions += 1;
    byModule[moduleKey].uniqueLongestCorrect += row.uniqueLongestCorrect ? 1 : 0;
    byModule[moduleKey].expectedLongestGuess += row.expectedLongestGuess;
    byModule[moduleKey].margin10 += row.margin >= 10 ? 1 : 0;

    const provenanceKey = row.provenance;
    byProvenance[provenanceKey] = byProvenance[provenanceKey] ||
      {questions: 0, uniqueLongestCorrect: 0,
        expectedLongestGuess: 0, margin10: 0};
    byProvenance[provenanceKey].questions += 1;
    byProvenance[provenanceKey].uniqueLongestCorrect += row.uniqueLongestCorrect ? 1 : 0;
    byProvenance[provenanceKey].expectedLongestGuess += row.expectedLongestGuess;
    byProvenance[provenanceKey].margin10 += row.margin >= 10 ? 1 : 0;
  }
  for (const value of Object.values(byModule)) {
    value.uniqueLongestCorrectRate = round(100 * value.uniqueLongestCorrect / value.questions);
    value.longestGuessExpectedAccuracy = round(100 * value.expectedLongestGuess / value.questions);
    value.margin10Rate = round(100 * value.margin10 / value.questions);
    value.expectedLongestGuess = undefined;
  }
  for (const value of Object.values(byProvenance)) {
    value.uniqueLongestCorrectRate = round(100 * value.uniqueLongestCorrect / value.questions);
    value.longestGuessExpectedAccuracy = round(100 * value.expectedLongestGuess / value.questions);
    value.margin10Rate = round(100 * value.margin10 / value.questions);
    value.expectedLongestGuess = undefined;
  }
  for (const value of Object.values(byTest)) {
    value.uniqueLongestCorrectRate = round(100 * value.uniqueLongestCorrect / value.questions);
    value.longestGuessExpectedAccuracy = round(100 * value.expectedLongestGuess / value.questions);
    value.uniqueShortestCorrectRate = round(100 * value.uniqueShortestCorrect / value.questions);
    value.shortestGuessExpectedAccuracy = round(100 * value.expectedShortestGuess / value.questions);
    value.expectedLongestGuess = undefined;
    value.expectedShortestGuess = undefined;
  }

  const optionPositionCounts = [0, 0, 0, 0];
  for (const row of valid) optionPositionCounts[row.correctIndex] += 1;
  const totalOptionChars = valid.reduce((sum, row) => sum + row.lengths.reduce((a, b) => a + b, 0), 0);
  const totalCorrectChars = valid.reduce((sum, row) => sum + row.correctLength, 0);

  return {
    subject: subjectName,
    questions: records.length,
    validAnswerKeys: valid.length,
    additionalReasoningLabels: records.filter((question) => /Additional reasoning step:/i.test(question.explanation || "")).length,
    correctOptionPositionCounts: Object.fromEntries(optionPositionCounts.map((count, index) => [String.fromCharCode(65 + index), count])),
    uniqueLongestCorrect: valid.filter((row) => row.uniqueLongestCorrect).length,
    uniqueLongestCorrectRate: round(100 * valid.filter((row) => row.uniqueLongestCorrect).length / valid.length),
    longestOrTiedCorrect: valid.filter((row) => row.longestOrTiedCorrect).length,
    longestOrTiedCorrectRate: round(100 * valid.filter((row) => row.longestOrTiedCorrect).length / valid.length),
    longestGuessExpectedAccuracy: round(100 * valid.reduce((sum, row) => sum + row.expectedLongestGuess, 0) / valid.length),
    uniqueShortestCorrectRate: round(100 * valid.filter((row) => row.uniqueShortestCorrect).length / valid.length),
    shortestGuessExpectedAccuracy: round(100 * valid.reduce((sum, row) => sum + row.expectedShortestGuess, 0) / valid.length),
    correctAtLeast10CharsLonger: valid.filter((row) => row.margin >= 10).length,
    correctAtLeast20CharsLonger: valid.filter((row) => row.margin >= 20).length,
    meanCorrectOptionChars: round(totalCorrectChars / valid.length),
    meanDistractorOptionChars: round((totalOptionChars - totalCorrectChars) / (valid.length * 3)),
    byPracticeTest: byTest,
    byModule,
    byProvenance,
    strongestGiveaways: valid
      .filter((row) => row.uniqueLongestCorrect)
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 12)
      .map(({bankIndex, practiceYear, module, correctIndex, correctLength, lengths, margin, prompt}) => ({
        bankIndex,
        practiceYear,
        module,
        correctOption: String.fromCharCode(65 + correctIndex),
        correctLength,
        optionLengths: lengths,
        margin,
        prompt,
      })),
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  measurement: "Visible character count after stripping HTML; longest-choice expected accuracy splits ties evenly.",
  subjects: ["Reading", "English", "Mathematics", "Science"].map(summarize),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
