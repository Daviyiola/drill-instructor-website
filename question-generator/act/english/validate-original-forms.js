"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const repositoryRoot = path.resolve(root, "../../..");
const dataPath = path.join(repositoryRoot, "functions", "data", "actData.js");
const config = JSON.parse(fs.readFileSync(path.join(root, "original-forms-calibration.json"), "utf8"));
const source = fs.readFileSync(dataPath, "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(source, context, {filename: dataPath, timeout: 5000});
const english = vm.runInContext("getSubjects()", context, {filename: dataPath, timeout: 5000})
    .find((subject) => subject.subject === "English");
const errors = [];

for (const form of config.forms) {
  const rows = [];
  for (let key = form.range[0]; key <= form.range[1]; key += 1) rows.push({key, question: english[key]});
  const answerPositions = {A: 0, B: 0, C: 0, D: 0};
  const difficulties = {Medium: 0, Hard: 0, "Very Hard": 0};
  const passages = new Map();
  for (const {key, question} of rows) {
    if (!question) { errors.push(`Form ${form.form} is missing question ${key}.`); continue; }
    const currentOptions = [question.option1, question.option2, question.option3, question.option4];
    const answerIndex = currentOptions.indexOf(question.correctAnswer);
    if (answerIndex < 0) errors.push(`Question ${key} correctAnswer does not match an option.`);
    else answerPositions["ABCD"[answerIndex]] += 1;
    if (!(question.difficulty in difficulties)) errors.push(`Question ${key} has invalid difficulty.`);
    else difficulties[question.difficulty] += 1;
    if (currentOptions.some((option) => String(option).trim().toUpperCase() === "NO CHANGE")) {
      errors.push(`Question ${key} still contains a literal NO CHANGE choice.`);
    }
    if (/NO CHANGE/iu.test(String(question.explanation || ""))) {
      errors.push(`Question ${key} explanation still refers to NO CHANGE.`);
    }
    if (!String(question.explanation || "").trim()) errors.push(`Question ${key} has no explanation.`);
    passages.set(question.passage, (passages.get(question.passage) || 0) + 1);
  }
  if (rows.length !== config.targetsPerForm.questions) errors.push(`Form ${form.form} does not contain 50 questions.`);
  if (passages.size !== config.targetsPerForm.passages) errors.push(`Form ${form.form} contains ${passages.size} passages; expected 6.`);
  if (JSON.stringify(answerPositions) !== JSON.stringify(config.targetsPerForm.answerPositions)) {
    errors.push(`Form ${form.form} answer positions are ${JSON.stringify(answerPositions)}.`);
  }
  if (JSON.stringify(difficulties) !== JSON.stringify(config.targetsPerForm.difficulties)) {
    errors.push(`Form ${form.form} difficulties are ${JSON.stringify(difficulties)}.`);
  }
  console.log(JSON.stringify({form: form.form, questions: rows.length, passages: passages.size, answerPositions, difficulties}));
}

errors.forEach((error) => console.error(`ERROR: ${error}`));
if (errors.length) process.exitCode = 1;
else console.log("Validated calibrated ACT English Forms 1 and 2.");
