"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repositoryRoot = path.resolve(__dirname, "../../..");
const filename = path.join(repositoryRoot, "functions", "data", "actData.js");
const source = fs.readFileSync(filename, "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(source, context, {filename, timeout: 5000});
const mathematics = vm.runInContext("getSubjects()", context, {filename, timeout: 5000})
    .find((row) => row.subject === "Mathematics");

function tokens(value) {
  return String(value || "").replace(/<[^>]+>/gu, " ").toLowerCase()
      .replace(/[−–—]/gu, "-").replace(/\d+(?:\.\d+)?/gu, "#")
      .replace(/\b[a-z]\b/gu, "v").replace(/[^a-z#]+/gu, " ")
      .trim().split(/\s+/u).filter(Boolean);
}

function ngrams(words, size = 2) {
  const result = new Set();
  for (let index = 0; index <= words.length - size; index += 1) {
    result.add(words.slice(index, index + size).join(" "));
  }
  return result;
}

function similarity(left, right) {
  const a = ngrams(tokens(left));
  const b = ngrams(tokens(right));
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / (a.size + b.size - intersection || 1);
}

const questions = Object.keys(mathematics).filter((key) => /^\d+$/u.test(key))
    .map((key) => ({key: Number(key), ...mathematics[key]}));
const pairs = [];
for (let left = 0; left < questions.length; left += 1) {
  for (let right = left + 1; right < questions.length; right += 1) {
    if (questions[left].module !== questions[right].module) continue;
    const score = similarity(questions[left].question, questions[right].question);
    if (score >= 0.48) pairs.push({
      score: Number(score.toFixed(3)),
      left: questions[left].key,
      right: questions[right].key,
      module: questions[left].module,
      leftPrompt: questions[left].question,
      rightPrompt: questions[right].question,
    });
  }
}
pairs.sort((a, b) => b.score - a.score || a.left - b.left || a.right - b.right);
console.log(JSON.stringify(pairs.slice(0, 100), null, 2));
