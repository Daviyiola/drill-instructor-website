"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const manifestFile = path.join(root, "batch-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));

function parseFragment(file) {
  return vm.runInNewContext(`(${fs.readFileSync(file, "utf8").trim()})`, Object.create(null), {
    timeout: 2000,
    codeGeneration: {strings: false, wasm: false},
  });
}

function serialize(fragment) {
  const fields = ["skill_tested", "question", "option1", "option2", "option3", "option4", "correctAnswer", "explanation", "practiceYear", "difficulty", "module", "imageSources", "passage"];
  const rows = Object.keys(fragment).map(Number).sort((a, b) => a - b).map((number) => {
    const question = fragment[number];
    return `${number}: {${fields.map((field) => `${field}: ${JSON.stringify(question[field])}`).join(", ")}}`;
  });
  return `{\n${rows.join(",\n")}\n}\n`;
}

if (manifest.firstQuestionNumber === 19 && manifest.lastQuestionNumber === 288) {
  console.log("Generated Reading range is already 19-288.");
  process.exit(0);
}
if (manifest.firstQuestionNumber !== 17 || manifest.lastQuestionNumber !== 286) {
  throw new Error(`Unexpected generated range ${manifest.firstQuestionNumber}-${manifest.lastQuestionNumber}.`);
}

for (const batch of manifest.batches) {
  const source = String(batch.sourceId).padStart(2, "0");
  const blueprint = String(batch.blueprint).toLowerCase();
  const folder = path.join(root, "work", `source-${source}`, `blueprint-${blueprint}`);
  for (const name of ["final.jsfrag", "questions.jsfrag"]) {
    const file = path.join(folder, name);
    const current = parseFragment(file);
    const shifted = {};
    for (const [number, question] of Object.entries(current)) shifted[Number(number) + 2] = question;
    fs.writeFileSync(file, serialize(shifted), "utf8");
  }
  batch.startQuestionNumber += 2;
  batch.endQuestionNumber += 2;
}

manifest.firstQuestionNumber += 2;
manifest.lastQuestionNumber += 2;
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const staleStaging = path.join(root, "staging", "reading-generated-17-286.jsfrag");
if (fs.existsSync(staleStaging)) fs.unlinkSync(staleStaging);
console.log("Shifted all generated ACT Reading batches from 17-286 to 19-288.");
