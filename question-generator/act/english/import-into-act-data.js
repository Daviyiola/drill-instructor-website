"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const repositoryRoot = path.resolve(root, "../../..");
const manifestPath = path.join(root, "production-manifest.json");
const dataPath = path.join(repositoryRoot, "functions", "data", "actData.js");
const beginMarker = "    // BEGIN GENERATED ACT ENGLISH 101-400";
const endMarker = "    // END GENERATED ACT ENGLISH 101-400";

function loadDataset(source, filename) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, {filename, timeout: 5000});
  return vm.runInContext("getSubjects()", context, {filename, timeout: 5000});
}

function bundleDirectory(bundle) {
  if (bundle.bundleId.startsWith("gap-")) {
    return path.join(root, "work", "gap-long", `blueprint-${bundle.blueprint.toLowerCase()}`);
  }
  return path.join(
      root,
      "work",
      `source-${String(bundle.sourceId).padStart(2, "0")}`,
      `blueprint-${bundle.blueprint.toLowerCase()}`,
  );
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const bundles = manifest.forms.flatMap((form) => form.bundles)
    .sort((left, right) => left.provisionalStartKey - right.provisionalStartKey);
if (manifest.forms.some((form) => form.status !== "validated") ||
    bundles.some((bundle) => bundle.status !== "validated")) {
  throw new Error("Every form and bundle must be validated before import.");
}

const generated = {};
for (const bundle of bundles) {
  const directory = bundleDirectory(bundle);
  const passage = JSON.parse(fs.readFileSync(path.join(directory, "passage.json"), "utf8"));
  const questions = JSON.parse(fs.readFileSync(path.join(directory, "final.jsfrag"), "utf8"));
  for (const [key, question] of Object.entries(questions)) {
    if (generated[key]) throw new Error(`Duplicate generated English key ${key}.`);
    generated[key] = {...question, passage: passage.student_passage};
  }
}

const generatedKeys = Object.keys(generated).map(Number).sort((left, right) => left - right);
const expectedKeys = Array.from({length: 300}, (_, index) => index + 101);
if (JSON.stringify(generatedKeys) !== JSON.stringify(expectedKeys)) {
  throw new Error("Generated English keys must be consecutive from 101 through 400.");
}

let source = fs.readFileSync(dataPath, "utf8");
const eol = source.includes("\r\n") ? "\r\n" : "\n";
const before = loadDataset(source, dataPath);
const existingEnglish = before.find((subject) => subject.subject === "English");
if (!existingEnglish) throw new Error("Could not locate the existing English subject.");
for (let key = 1; key <= 100; key += 1) {
  if (!existingEnglish[key]) throw new Error(`Existing English key ${key} is missing.`);
}

const serialized = JSON.stringify(generated, null, 2).split("\n");
const generatedBody = serialized.slice(1, -1).map((line) => `  ${line}`).join(eol);
const generatedBlock = `${beginMarker}${eol}${generatedBody}${eol}${endMarker}`;
const existingBegin = source.indexOf(beginMarker);
const existingEnd = source.indexOf(endMarker);

if (existingBegin >= 0 || existingEnd >= 0) {
  if (existingBegin < 0 || existingEnd < existingBegin) {
    throw new Error("The generated ACT English import markers are incomplete.");
  }
  source = source.slice(0, existingBegin) + generatedBlock +
      source.slice(existingEnd + endMarker.length);
} else {
  const englishStart = source.indexOf(`  {${eol}    subject: "English",`);
  const readingStart = source.indexOf(`  {${eol}    subject: "Reading",`, englishStart + 1);
  if (englishStart < 0 || readingStart < 0) {
    throw new Error("Could not isolate the English subject block.");
  }
  const englishClose = source.lastIndexOf(`${eol}  },`, readingStart);
  if (englishClose < englishStart) throw new Error("Could not locate the end of the English subject block.");
  source = source.slice(0, englishClose) + `${eol}${generatedBlock}` + source.slice(englishClose);
}

const after = loadDataset(source, dataPath);
const importedEnglish = after.find((subject) => subject.subject === "English");
const importedKeys = Object.keys(importedEnglish || {}).filter((key) => /^\d+$/u.test(key)).map(Number);
if (importedKeys.length !== 400 || Math.max(...importedKeys) !== 400) {
  throw new Error(`Imported English bank has ${importedKeys.length} questions; expected 400.`);
}
if (importedKeys.some((key) => importedEnglish[key].passage === "{{shared_passage}}")) {
  throw new Error("At least one imported question still contains a shared-passage placeholder.");
}

fs.writeFileSync(dataPath, source, "utf8");
console.log("Imported 300 validated questions as ACT English keys 101-400.");
console.log("ACT English now contains 400 questions across keys 1-400.");
