#!/usr/bin/env node
"use strict";
/* eslint-disable require-jsdoc */

const fs = require("fs");
const path = require("path");

const DATA_FILES = ["actData.js", "satData.js"];
const DATA_ROOT = path.resolve(__dirname, "..", "data");
const IMAGE_FIELD = /(\s*)"imageSource"\s*:\s*("(?:\\.|[^"\\])*")/g;

function parsedSources(serialized) {
  const source = JSON.parse(serialized);
  return [...new Set(String(source || "").split("|")
      .map((item) => item.trim()).filter(Boolean))];
}

function migrateFile(filename) {
  const absolute = path.join(DATA_ROOT, filename);
  const source = fs.readFileSync(absolute, "utf8");
  let replacements = 0;
  let multiImageQuestions = 0;
  const migrated = source.replace(IMAGE_FIELD, (match, whitespace, value) => {
    const images = parsedSources(value);
    replacements += 1;
    if (images.length > 1) multiImageQuestions += 1;
    return `${whitespace}"imageSources": ${JSON.stringify(images)}`;
  });
  if (!replacements) {
    if (/"imageSources"\s*:/.test(source)) {
      console.log(`${filename}: already migrated`);
      return;
    }
    throw new Error(`${filename}: no imageSource fields found`);
  }
  if (/"imageSource"\s*:/.test(migrated)) {
    throw new Error(`${filename}: an imageSource field was not migrated`);
  }
  fs.writeFileSync(absolute, migrated, "utf8");
  console.log(`${filename}: migrated ${replacements} questions ` +
    `(${multiImageQuestions} multi-image)`);
}

DATA_FILES.forEach(migrateFile);
