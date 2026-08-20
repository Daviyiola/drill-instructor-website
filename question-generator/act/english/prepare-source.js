"use strict";

const fs = require("fs");
const path = require("path");

const sourceId = Number(process.argv[2]);
if (!Number.isInteger(sourceId)) {
  console.error("Usage: node prepare-source.js <source-id>");
  process.exit(1);
}

const root = __dirname;
const sourceText = fs.readFileSync(path.join(root, "source-questions.txt"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "source-manifest.json"), "utf8"));
const configured = manifest.sources.find((row) => row.sourceId === sourceId);
if (!configured) {
  console.error(`Unknown English source ${sourceId}.`);
  process.exit(1);
}
if (configured.include === false) {
  console.error(`English source ${sourceId} is excluded: ${configured.excludeReason}.`);
  process.exit(1);
}

const headings = [...sourceText.matchAll(/^\/\/source\s+(\d+)\s*$/gmi)];
const index = headings.findIndex((match) => Number(match[1]) === sourceId);
if (index < 0) {
  console.error(`Source block ${sourceId} was not found.`);
  process.exit(1);
}
let block = sourceText.slice(headings[index].index, headings[index + 1]?.index || sourceText.length)
    .replace(/^\/\/source.*\r?\n/i, "")
    .replace(/^\/\/ DUPLICATE.*\r?\n/gmi, "")
    .trim();

let underlineOpen = false;
block = block.replace(/<u>(\s*[,.;:?!—-]?\s*)(\d+)?/g, (match, separator, marker) => {
  if (underlineOpen) {
    underlineOpen = false;
    return `</u>${separator}${marker ? `<b>[${marker}]</b>` : ""}`;
  }
  if (marker) return `${separator}<b>[${marker}]</b>`;
  underlineOpen = true;
  return `<u>${separator}`;
});
if (underlineOpen) {
  console.error(`Source ${sourceId} has unmatched legacy underline markers.`);
  process.exit(1);
}

console.log(JSON.stringify({
  sourceId,
  sourceSet: configured.sourceSet,
  passageClass: configured.passageClass,
  requiredQuestionCount: configured.questionCount,
  sourcePassageType: configured.passageType,
  sourceText: block,
}, null, 2));
