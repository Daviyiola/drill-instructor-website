"use strict";

const fs = require("fs");
const path = require("path");

const [, , bundlePath, startText] = process.argv;
if (!bundlePath || !startText || !Number.isInteger(Number(startText))) {
  console.error("Usage: node materialize-bundle.js <bundle-directory> <starting-export-key>");
  process.exit(1);
}

const directory = path.resolve(bundlePath);
const passage = JSON.parse(fs.readFileSync(path.join(directory, "passage.json"), "utf8"));
const specs = JSON.parse(fs.readFileSync(path.join(directory, "question-specs.json"), "utf8"));
const start = Number(startText);

if (!Array.isArray(specs) || specs.length !== Number(passage.required_target_count)) {
  throw new Error("question-specs.json must contain one row for every passage target.");
}

const questions = {};
specs.forEach((spec, index) => {
  if (!Array.isArray(spec.options) || spec.options.length !== 4) {
    throw new Error(`Question ${index + 1} must contain exactly four options.`);
  }
  const options = spec.options.map((option) => String(option).trim());
  const correctAnswer = String(spec.correctAnswer).trim();
  if (new Set(options).size !== 4) {
    throw new Error(`Question ${index + 1} contains duplicate choices after trimming.`);
  }
  if (!options.includes(correctAnswer)) {
    throw new Error(`Question ${index + 1} correctAnswer must match an option.`);
  }
  questions[start + index] = {
    skill_tested: spec.skill_tested,
    question: `(${index + 1}) ${spec.question}`,
    option1: options[0],
    option2: options[1],
    option3: options[2],
    option4: options[3],
    correctAnswer,
    explanation: `<b>Step 1:</b> ${spec.step1}<br><br><b>Step 2:</b> ${spec.step2}<br><br><b>Answer:</b> ${correctAnswer}`,
    practiceYear: 1,
    difficulty: spec.difficulty,
    module: spec.module,
    imageSources: [],
    passage: "{{shared_passage}}",
  };
});

const fragment = JSON.stringify(questions, null, 2)
    .replace(/^\{/u, "{")
    .replace(/\n\}$/u, "\n}") + "\n";
fs.writeFileSync(path.join(directory, "questions.jsfrag"), fragment, "utf8");
fs.writeFileSync(path.join(directory, "final.jsfrag"), fragment, "utf8");
console.log(`Materialized ${specs.length} questions from export key ${start}.`);
