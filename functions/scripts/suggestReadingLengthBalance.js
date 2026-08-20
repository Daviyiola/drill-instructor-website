"use strict";
/* eslint-disable max-len, require-jsdoc, indent */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const dataPath = path.join(__dirname, "..", "data", "actData.js");
let source = fs.readFileSync(dataPath, "utf8");
const subjects = vm.runInNewContext(`${source}\n;allSubjects;`, Object.create(null), {
  timeout: 10000,
  codeGeneration: {strings: false, wasm: false},
});
const reading = subjects.find((entry) => entry.subject === "Reading");

function plain(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function variants(value) {
  const text = plain(value).replace(/[.!?]+$/, "");
  const candidates = new Set();
  const add = (candidate) => {
    const normalized = candidate.trim().replace(/[,;:]+$/, "");
    const lastWord = (normalized.match(/([A-Za-z']+)$/) || [])[1] || "";
    const incomplete = /^(?:a|an|the|and|or|but|is|are|was|were|be|been|being|can|could|may|might|must|should|would|will|do|does|did|have|has|had|only|even|during)$/i.test(lastWord);
    if (!incomplete && normalized.split(/\s+/).length >= 5) candidates.add(`${normalized}.`);
  };
  const connectors = [
    /,\s+(?:which|where|while|although|even though|because)\b/i,
    /;\s*/,
    /\s+(?:because|although|even though|even when|even after|whereas|so that|rather than|instead of|while|when|after|before|once|until)\s+/i,
    /\s+so\s+/i,
  ];
  connectors.forEach((pattern) => {
    const match = pattern.exec(text);
    if (match && match.index > 0) add(text.slice(0, match.index));
  });
  return [...candidates];
}

const suggestions = [];
for (const bankIndex of Object.keys(reading).filter((key) => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b)) {
  const question = reading[bankIndex];
  const options = [question.option1, question.option2, question.option3, question.option4];
  const correctIndex = options.indexOf(question.correctAnswer);
  if (correctIndex < 0) continue;
  const lengths = options.map((option) => plain(option).length);
  const correctLength = lengths[correctIndex];
  if (lengths.filter((length) => length === Math.min(...lengths)).length !== 1 || lengths[correctIndex] !== Math.min(...lengths)) continue;
  const candidates = [];
  options.forEach((option, optionIndex) => {
    if (optionIndex === correctIndex) return;
    variants(option).forEach((replacement) => {
      const length = plain(replacement).length;
      if (length < correctLength && length >= Math.max(24, Math.floor(correctLength * 0.62))) {
        candidates.push({optionIndex, original: option, replacement, length});
      }
    });
  });
  candidates.sort((left, right) => right.length - left.length);
  if (candidates.length) {
    suggestions.push({
      bankIndex,
      practiceYear: question.practiceYear,
      question: plain(question.question),
      correctAnswer: question.correctAnswer,
      correctLength,
      ...candidates[0],
    });
  }
}

function subjectRange() {
  const marker = "    subject: \"Reading\",";
  const markerIndex = source.indexOf(marker);
  const start = source.lastIndexOf("  {", markerIndex);
  const next = source.indexOf("\n  {\n    subject:", markerIndex + marker.length);
  return {start, end: next < 0 ? source.lastIndexOf("\n];") : next};
}

function questionRange(bankIndex) {
  const subject = subjectRange();
  const marker = `    ${bankIndex}: {`;
  const start = source.indexOf(marker, subject.start);
  const closing = source.indexOf("\n    },", start);
  return {start, end: closing < 0 || closing >= subject.end ? subject.end : closing + 7};
}

if (process.argv.includes("--apply")) {
  suggestions.forEach((suggestion) => {
    const range = questionRange(suggestion.bankIndex);
    let block = source.slice(range.start, range.end);
    const optionName = `option${suggestion.optionIndex + 1}`;
    const original = `${optionName}: ${JSON.stringify(suggestion.original)}`;
    const replacement = `${optionName}: ${JSON.stringify(suggestion.replacement)}`;
    if (!block.includes(original)) throw new Error(`Could not balance Reading ${suggestion.bankIndex}.`);
    block = block.replace(original, replacement);
    source = source.slice(0, range.start) + block + source.slice(range.end);
  });
  fs.writeFileSync(dataPath, source, "utf8");
  console.log(`Applied ${suggestions.length} Reading length-balance edits.`);
} else {
  const numericArgs = process.argv.slice(2).filter((value) => /^\d+$/.test(value));
  const page = Math.max(1, Number(numericArgs[0] || 1));
  const pageSize = Math.max(1, Number(numericArgs[1] || 15));
  console.log(JSON.stringify({
    count: suggestions.length,
    page,
    pageSize,
    suggestions: suggestions.slice((page - 1) * pageSize, page * pageSize),
  }, null, 2));
}
