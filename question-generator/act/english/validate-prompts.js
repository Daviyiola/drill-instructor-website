"use strict";

const fs = require("fs");
const path = require("path");

const prompt = fs.readFileSync(path.join(__dirname, "prompt.txt"), "utf8");
const errors = [];
const required = [
  "`LONG` = approximately 340 standard words and exactly 10 questions",
  "`SHORT` = approximately 185 standard words and exactly 5 questions",
  "Production of Writing",
  "Knowledge of Language",
  "Conventions of Standard English",
  "PASSAGE_CANNOT_SUPPORT_REQUIRED_TARGET_COUNT",
  "Questions inside one English passage must remain together and in ascending target order",
  "exactly 4 `LONG` passage bundles and 2 `SHORT` passage bundles",
  "`<b>PASSAGE TITLE</b><br><br>`",
];
const forbidden = [
  "6-8 finalized targets",
  "6 to 8 questions",
  "6_to_8_questions",
  "Valid target counts are 6, 7, or 8",
  "Never recommend 9 or 10 targets",
  "9- or 10-question passages",
  "approximately 200-300 words",
  "Questions may be reindexed or shuffled later",
];

for (const value of required) {
  if (!prompt.includes(value)) errors.push(`Missing required prompt contract: ${value}`);
}
for (const value of forbidden) {
  if (prompt.includes(value)) errors.push(`Obsolete prompt contract remains: ${value}`);
}
for (const number of [1, 2, 3, 4, 5]) {
  if (!prompt.includes(`# PROMPT ${number} —`)) errors.push(`Prompt ${number} heading is missing.`);
}

errors.forEach((message) => console.error(`ERROR: ${message}`));
if (errors.length) process.exitCode = 1;
else console.log("Validated all five ACT English prompt contracts.");
