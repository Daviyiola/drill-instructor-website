"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const stopwords = new Set("a an and are as at be been but by can could did do does for from had has have he her hers him his how i if in into is it its may more most not of on one or our she so than that the their them then there these they this those through to under up was we were what when where which while who will with would you your".split(" "));

function clean(text) {
  return String(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/\(\d+\)/g, " ")
    .replace(/[‐‑–—-]\s+/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function contentSet(tokens) {
  return new Set(tokens.filter((token) => token.length > 2 && !stopwords.has(token)));
}

function jaccard(left, right) {
  const a = contentSet(left);
  const b = contentSet(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection || 1);
}

function ngramSet(tokens, size) {
  const set = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) set.add(tokens.slice(index, index + size).join(" "));
  return set;
}

function overlapRate(source, generated, size) {
  const sourceSet = ngramSet(source, size);
  const generatedSet = ngramSet(generated, size);
  const matches = [...generatedSet].filter((gram) => sourceSet.has(gram));
  return {count: matches.length, rate: matches.length / (generatedSet.size || 1), examples: matches.slice(0, 5)};
}

function longestCommonRun(left, right) {
  let previous = new Uint16Array(right.length + 1);
  let best = 0;
  let bestEnd = 0;
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Uint16Array(right.length + 1);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) { best = current[j]; bestEnd = i; }
      }
    }
    previous = current;
  }
  return {length: best, text: left.slice(bestEnd - best, bestEnd).join(" ")};
}

const rawSource = fs.readFileSync(path.join(root, "source-questions.txt"), "utf8");
const parts = rawSource.split(/\/\/\s*source\s*(\d+)/i);
const sources = new Map();
for (let index = 1; index < parts.length; index += 2) {
  const sourceId = Number(parts[index]);
  const passageOnly = parts[index + 1].split(/\r?\n\s*\(1\)\s/)[0];
  sources.set(sourceId, clean(passageOnly));
}

const comparisons = [];
for (let sourceId = 1; sourceId <= 15; sourceId += 1) {
  for (const blueprint of ["A", "B"]) {
    const passagePath = path.join(root, "work", `source-${String(sourceId).padStart(2, "0")}`, `blueprint-${blueprint.toLowerCase()}`, "passage.json");
    const passage = JSON.parse(fs.readFileSync(passagePath, "utf8"));
    const sourceTokens = sources.get(sourceId);
    const generatedTokens = clean(passage.passage);
    comparisons.push({
      sourceId,
      blueprint,
      passageAssetId: passage.passage_asset_id,
      sourceWordCount: sourceTokens.length,
      generatedWordCount: generatedTokens.length,
      contentWordJaccard: Number(jaccard(sourceTokens, generatedTokens).toFixed(4)),
      trigramOverlap: overlapRate(sourceTokens, generatedTokens, 3),
      fiveGramOverlap: overlapRate(sourceTokens, generatedTokens, 5),
      longestExactWordRun: longestCommonRun(sourceTokens, generatedTokens),
    });
  }
}

const output = {generatedAt: new Date().toISOString(), scaleNote: "Metrics are descriptive evidence, not the editorial risk score.", comparisons};
const outputPath = path.join(root, "staging", "SIMILARITY_METRICS.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${path.relative(process.cwd(), outputPath)} with ${comparisons.length} comparisons.`);
for (const item of comparisons) console.log(`S${item.sourceId}${item.blueprint}: J=${item.contentWordJaccard.toFixed(3)} 3g=${(item.trigramOverlap.rate * 100).toFixed(2)}% 5g=${item.fiveGramOverlap.count} longest=${item.longestExactWordRun.length} (${item.longestExactWordRun.text})`);
