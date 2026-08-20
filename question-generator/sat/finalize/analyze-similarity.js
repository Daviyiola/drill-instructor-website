"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "../../..");
const filename = path.join(root, "functions", "data", "satData.js");
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(filename, "utf8"), context, {filename});
const subjects = vm.runInContext("getSubjects()", context, {filename});

function words(value) {
  return String(value || "").replace(/<[^>]+>/gu, " ").toLowerCase()
      .replace(/\d+(?:\.\d+)?/gu, "#").replace(/[^a-z#]+/gu, " ")
      .trim().split(/\s+/u).filter(Boolean);
}

function bigrams(value) {
  const input = words(value);
  const result = new Set();
  for (let index = 0; index < input.length - 1; index += 1) {
    result.add(`${input[index]} ${input[index + 1]}`);
  }
  return result;
}

function similarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  let intersection = 0;
  a.forEach((value) => { if (b.has(value)) intersection += 1; });
  return intersection / (a.size + b.size - intersection || 1);
}

subjects.forEach((subject) => {
  const rows = Object.keys(subject).filter((key) => /^\d+$/u.test(key))
      .map((key) => ({key: Number(key), ...subject[key]}));
  const pairs = [];
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      if (rows[left].module !== rows[right].module) continue;
      const score = similarity(rows[left].question, rows[right].question);
      if (score >= 0.45) pairs.push({score, left: rows[left], right: rows[right]});
    }
  }
  pairs.sort((left, right) => right.score - left.score ||
    left.left.key - right.left.key || left.right.key - right.right.key);
  console.log(`\n### ${subject.subject}`);
  pairs.slice(0, 45).forEach((pair) => {
    const left = String(pair.left.question).replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
    const right = String(pair.right.question).replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
    console.log(`${pair.score.toFixed(3)} ${pair.left.key}-${pair.right.key} ${pair.left.module}\n  ${left}\n  ${right}`);
  });
});
