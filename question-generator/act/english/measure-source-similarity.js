"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
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
  for (let index = 0; index <= tokens.length - size; index += 1) result.add(tokens.slice(index, index + size).join(" "));
  return result;
}
function overlap(left, right, size) {
  const source = ngrams(left, size); const generated = ngrams(right, size);
  const examples = [...generated].filter((gram) => source.has(gram));
  return {count: examples.length, rate: examples.length / (generated.size || 1), examples: examples.slice(0, 5)};
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

const raw = fs.readFileSync(path.join(root, "source-questions.txt"), "utf8");
const matches = [...raw.matchAll(/^\/\/source\s+(\d+)\s*$/gmi)];
const sources = new Map(matches.map((match, index) => {
  const block = raw.slice(match.index, matches[index + 1]?.index || raw.length);
  return [Number(match[1]), clean(block.split(/^\(1\)\s+/m)[0])];
}));

const comparisons = [];
for (const sourceDirectory of fs.readdirSync(path.join(root, "work"), {withFileTypes: true})) {
  if (!sourceDirectory.isDirectory() || !/^source-\d+$/u.test(sourceDirectory.name)) continue;
  const sourceId = Number(sourceDirectory.name.slice(7));
  for (const blueprint of ["a", "b"]) {
    const filename = path.join(root, "work", sourceDirectory.name, `blueprint-${blueprint}`, "passage.json");
    if (!fs.existsSync(filename) || !sources.has(sourceId)) continue;
    const passage = JSON.parse(fs.readFileSync(filename, "utf8"));
    const sourceTokens = sources.get(sourceId); const generatedTokens = clean(passage.student_passage);
    comparisons.push({
      sourceId, blueprint: blueprint.toUpperCase(), passageAssetId: passage.passage_asset_id,
      contentWordJaccard: Number(jaccard(sourceTokens, generatedTokens).toFixed(4)),
      trigramOverlap: overlap(sourceTokens, generatedTokens, 3),
      fiveGramOverlap: overlap(sourceTokens, generatedTokens, 5),
      longestExactWordRun: longestRun(sourceTokens, generatedTokens),
    });
  }
}
const output = {generatedAt: new Date().toISOString(), comparisons};
const outputPath = path.join(root, "work", "similarity-metrics.json");
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
for (const row of comparisons) {
  console.log(`S${String(row.sourceId).padStart(2, "0")}${row.blueprint}: J=${row.contentWordJaccard.toFixed(3)} 5g=${row.fiveGramOverlap.count} longest=${row.longestExactWordRun.length}`);
}
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}.`);
