"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "batch-manifest.json"), "utf8"));
const fields = ["skill_tested", "question", "option1", "option2", "option3", "option4", "correctAnswer", "explanation", "practiceYear", "difficulty", "module", "imageSources", "passage"];

function parseFragment(file) {
  return vm.runInNewContext(`(${fs.readFileSync(file, "utf8").trim()})`, Object.create(null), {
    timeout: 1000,
    codeGeneration: {strings: false, wasm: false},
  });
}

function serialize(number, question) {
  return `${number}: {${fields.map((field) => `${field}: ${JSON.stringify(question[field])}`).join(", ")}}`;
}

const counts = {option1: 0, option2: 0, option3: 0, option4: 0};

for (const batch of manifest.batches) {
  const source = String(batch.sourceId).padStart(2, "0");
  const blueprint = batch.blueprint.toLowerCase();
  const file = path.join(root, "work", `source-${source}`, `blueprint-${blueprint}`, "final.jsfrag");
  const questions = parseFragment(file);
  const serialized = [];

  for (let number = batch.startQuestionNumber; number <= batch.endQuestionNumber; number += 1) {
    const question = questions[number];
    const options = [question.option1, question.option2, question.option3, question.option4];
    const correctMatches = options.filter((option) => option === question.correctAnswer);
    if (correctMatches.length !== 1) throw new Error(`Question ${number} has an invalid correct-answer contract.`);
    const distractors = options.filter((option) => option !== question.correctAnswer);
    const targetIndex = (number - manifest.firstQuestionNumber) % 4;
    const balanced = [...distractors];
    balanced.splice(targetIndex, 0, question.correctAnswer);
    for (let index = 0; index < 4; index += 1) question[`option${index + 1}`] = balanced[index];
    counts[`option${targetIndex + 1}`] += 1;
    serialized.push(serialize(number, question));
  }

  fs.writeFileSync(file, `{\n${serialized.join(",\n")}\n}\n`, "utf8");
}

console.log(`Balanced correct-answer positions: ${JSON.stringify(counts)}.`);
