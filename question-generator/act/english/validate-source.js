"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const sourcePath = path.join(root, "source-questions.txt");
const manifestPath = path.join(root, "source-manifest.json");
const sourceText = fs.readFileSync(sourcePath, "utf8");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function normalizeText(value) {
  return String(value || "")
      .normalize("NFKD")
      .replace(/<[^>]*>/g, " ")
      .replace(/\[[A-D0-9]+\]/g, " ")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase();
}

function sourceBlocks(text) {
  const matches = [...text.matchAll(/^\/\/source\s+(\d+)\s*$/gmi)];
  return matches.map((match, index) => ({
    sourceId: Number(match[1]),
    text: text.slice(match.index, matches[index + 1]?.index || text.length),
  }));
}

function titleFor(block) {
  return (block.match(/^PASSAGE\s+[IVX]+\s*\r?\n\s*\r?\n([^\r\n]+)/mi) || [])[1]?.trim() || "";
}

function questionNumbers(block) {
  return [...block.matchAll(/^\((\d+)\)\s+/gm)].map((match) => Number(match[1]));
}

function passageBody(block, title) {
  return block.split(/^\(1\)\s+/m)[0]
      .replace(/^\/\/source.*$/gmi, "")
      .replace(/^\/\/ DUPLICATE.*$/gmi, "")
      .replace(/^PASSAGE.*$/gmi, "")
      .replace(title, "");
}

function standardWordCount(value) {
  return normalizeText(value).split(/\s+/).filter(Boolean).length;
}

function tokenSet(value) {
  return new Set(normalizeText(value).split(/\s+/).filter((token) => token.length > 2));
}

function jaccard(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

const errors = [];
const warnings = [];
const blocks = sourceBlocks(sourceText);
const manifestById = new Map(manifest.sources.map((row) => [row.sourceId, row]));

if (blocks.length !== manifest.sources.length) {
  errors.push(`Expected ${manifest.sources.length} source blocks; found ${blocks.length}.`);
}

const parsed = blocks.map(({sourceId, text}) => {
  const configured = manifestById.get(sourceId);
  const title = titleFor(text);
  const numbers = questionNumbers(text);
  const body = passageBody(text, title);
  const questionCount = numbers.length;
  const passageClass = questionCount === 10 ? "LONG" : questionCount === 5 ? "SHORT" : "INVALID";
  const expectedNumbers = Array.from({length: questionCount}, (_, index) => index + 1);

  if (!configured) errors.push(`Source ${sourceId} is missing from source-manifest.json.`);
  if (configured && normalizeText(configured.title) !== normalizeText(title)) {
    errors.push(`Source ${sourceId} title differs from the manifest: ${JSON.stringify(title)}.`);
  }
  if (configured && configured.questionCount !== questionCount) {
    errors.push(`Source ${sourceId} expected ${configured.questionCount} questions; found ${questionCount}.`);
  }
  if (configured && configured.passageClass !== passageClass) {
    errors.push(`Source ${sourceId} expected ${configured.passageClass}; found ${passageClass}.`);
  }
  if (JSON.stringify(numbers) !== JSON.stringify(expectedNumbers)) {
    errors.push(`Source ${sourceId} question numbering is ${numbers.join(", ")}; expected ${expectedNumbers.join(", ")}.`);
  }
  const underlineMarkers = (text.match(/<u>/g) || []).length;
  if (underlineMarkers % 2 !== 0) {
    warnings.push(`Source ${sourceId} has an odd number of legacy <u> tokens; the source preparer will distinguish standalone markers from underline spans.`);
  }

  const words = standardWordCount(body);
  if (passageClass === "LONG" && (words < 275 || words > 390)) {
    warnings.push(`Source ${sourceId} LONG passage has ${words} words; inspect before blueprinting.`);
  }
  if (passageClass === "SHORT" && (words < 150 || words > 220)) {
    warnings.push(`Source ${sourceId} SHORT passage has ${words} words; inspect before blueprinting.`);
  }

  return {sourceId, title, body, passageClass, questionCount, words, include: configured?.include !== false};
});

for (let left = 0; left < parsed.length; left += 1) {
  for (let right = left + 1; right < parsed.length; right += 1) {
    const similarity = jaccard(parsed[left].body, parsed[right].body);
    if (similarity >= 0.9) {
      const excluded = !parsed[left].include || !parsed[right].include;
      const message = `Sources ${parsed[left].sourceId} and ${parsed[right].sourceId} are ${(similarity * 100).toFixed(1)}% token-similar.`;
      if (excluded) warnings.push(message);
      else errors.push(message);
    }
  }
}

for (const set of [1, 2, 3]) {
  const rows = parsed.filter((row) => Math.ceil(row.sourceId / 6) === set);
  const longCount = rows.filter((row) => row.passageClass === "LONG").length;
  const shortCount = rows.filter((row) => row.passageClass === "SHORT").length;
  const questions = rows.reduce((sum, row) => sum + row.questionCount, 0);
  if (longCount !== 4 || shortCount !== 2 || questions !== 50) {
    errors.push(`Source set ${set} is ${longCount} LONG + ${shortCount} SHORT = ${questions} questions.`);
  }
}

for (const row of parsed) {
  console.log(`Source ${String(row.sourceId).padStart(2, "0")}: ${row.passageClass} · ${row.questionCount} questions · ${row.words} words · ${row.title}${row.include ? "" : " · EXCLUDED"}`);
}
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);

if (errors.length) {
  process.exitCode = 1;
} else {
  console.log(`Validated ${parsed.length} English sources (${parsed.filter((row) => row.include).length} eligible).`);
}
