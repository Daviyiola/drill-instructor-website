"use strict";

const fs = require("fs");
const path = require("path");

const workRoot = path.join(__dirname, "work");
const stopwords = new Set("a an and are as at be been but by can could did do does for from had has have he her hers him his how i if in into is it its may more most not of on one or our she so than that the their them then there these they this those through to under up was we were what when where which while who will with would you your".split(" "));

function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\[[A-D0-9]+\]/g, " ")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function contentSet(tokens) {
  return new Set(tokens.filter((token) => token.length > 2 && !stopwords.has(token)));
}

function jaccard(left, right) {
  const a = contentSet(left); const b = contentSet(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection || 1);
}

function ngrams(tokens, size) {
  const result = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    result.add(tokens.slice(index, index + size).join(" "));
  }
  return result;
}

function longestRun(left, right) {
  let previous = new Uint16Array(right.length + 1); let best = 0; let end = 0;
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Uint16Array(right.length + 1);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) { best = current[j]; end = i; }
      }
    }
    previous = current;
  }
  return {length: best, text: left.slice(end - best, end).join(" ")};
}

function collectPassages(directory) {
  const rows = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...collectPassages(filename));
    else if (entry.isFile() && entry.name === "passage.json") {
      const passage = JSON.parse(fs.readFileSync(filename, "utf8"));
      rows.push({
        passageAssetId: passage.passage_asset_id,
        title: passage.passage_title,
        filename: path.relative(__dirname, filename),
        tokens: clean(passage.student_passage),
      });
    }
  }
  return rows;
}

const passages = collectPassages(workRoot);
const comparisons = [];
for (let leftIndex = 0; leftIndex < passages.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < passages.length; rightIndex += 1) {
    const left = passages[leftIndex]; const right = passages[rightIndex];
    const leftFive = ngrams(left.tokens, 5); const rightFive = ngrams(right.tokens, 5);
    const sharedFiveGrams = [...leftFive].filter((gram) => rightFive.has(gram));
    comparisons.push({
      left: left.passageAssetId,
      right: right.passageAssetId,
      contentWordJaccard: Number(jaccard(left.tokens, right.tokens).toFixed(4)),
      sharedFiveGramCount: sharedFiveGrams.length,
      sharedFiveGramExamples: sharedFiveGrams.slice(0, 5),
      longestExactWordRun: longestRun(left.tokens, right.tokens),
    });
  }
}

comparisons.sort((left, right) =>
  right.sharedFiveGramCount - left.sharedFiveGramCount ||
  right.contentWordJaccard - left.contentWordJaccard);
const output = {generatedAt: new Date().toISOString(), passageCount: passages.length, comparisons};
const outputPath = path.join(workRoot, "cross-bank-similarity.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(`Compared ${passages.length} passages across ${comparisons.length} pairs.`);
for (const row of comparisons.slice(0, 10)) {
  console.log(`${row.left} <> ${row.right}: J=${row.contentWordJaccard.toFixed(3)} 5g=${row.sharedFiveGramCount} longest=${row.longestExactWordRun.length}`);
}
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}.`);
