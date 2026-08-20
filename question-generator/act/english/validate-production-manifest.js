"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const production = JSON.parse(fs.readFileSync(path.join(root, "production-manifest.json"), "utf8"));
const sources = JSON.parse(fs.readFileSync(path.join(root, "source-manifest.json"), "utf8"));
const sourceById = new Map(sources.sources.map((row) => [row.sourceId, row]));
const errors = [];
const bundles = production.forms.flatMap((form) => form.bundles.map((bundle) => ({...bundle, form: form.form})));

if (production.forms.length !== 6) errors.push(`Expected 6 forms; found ${production.forms.length}.`);
if (bundles.length !== 36) errors.push(`Expected 36 bundles; found ${bundles.length}.`);

for (const form of production.forms) {
  const long = form.bundles.filter((row) => row.passageClass === "LONG").length;
  const short = form.bundles.filter((row) => row.passageClass === "SHORT").length;
  const questions = form.bundles.reduce((sum, row) => sum + (row.passageClass === "LONG" ? 10 : 5), 0);
  const types = form.bundles.reduce((counts, row) => {
    counts[row.passageType] = (counts[row.passageType] || 0) + 1;
    return counts;
  }, {});
  if (long !== 4 || short !== 2 || questions !== 50) {
    errors.push(`Form ${form.form}: ${long} LONG + ${short} SHORT = ${questions} questions.`);
  }
  if ((types.informational || 0) < 2 || (types.informational || 0) > 4 ||
      (types.argumentative || 0) < 1 || (types.argumentative || 0) > 2 ||
      (types.narrative || 0) < 1 || (types.narrative || 0) > 2) {
    errors.push(`Form ${form.form} passage types are ${JSON.stringify(types)}.`);
  }
}

const seenIds = new Set();
const seenStarts = new Set();
for (const bundle of bundles) {
  if (seenIds.has(bundle.bundleId)) errors.push(`Duplicate bundleId ${bundle.bundleId}.`);
  seenIds.add(bundle.bundleId);
  if (seenStarts.has(bundle.provisionalStartKey)) errors.push(`Duplicate provisionalStartKey ${bundle.provisionalStartKey}.`);
  seenStarts.add(bundle.provisionalStartKey);
  if (bundle.sourceId !== null) {
    const source = sourceById.get(bundle.sourceId);
    if (!source) errors.push(`${bundle.bundleId} references unknown source ${bundle.sourceId}.`);
    else if (source.include === false) errors.push(`${bundle.bundleId} references excluded source ${bundle.sourceId}.`);
    else if (source.passageClass !== bundle.passageClass) errors.push(`${bundle.bundleId} changes ${source.passageClass} to ${bundle.passageClass}.`);
  }
}

for (const source of sources.sources.filter((row) => row.include !== false)) {
  const count = bundles.filter((bundle) => bundle.sourceId === source.sourceId).length;
  if (count !== 2) errors.push(`Eligible source ${source.sourceId} appears ${count} times; expected 2.`);
}
const gaps = bundles.filter((bundle) => bundle.sourceId === null);
if (gaps.length !== 2 || gaps.some((bundle) => bundle.passageClass !== "LONG")) {
  errors.push(`Expected exactly 2 independent LONG gap bundles; found ${JSON.stringify(gaps.map((row) => row.bundleId))}.`);
}

const ranges = bundles.map((bundle) => {
  const count = bundle.passageClass === "LONG" ? 10 : 5;
  return [bundle.provisionalStartKey, bundle.provisionalStartKey + count - 1, bundle.bundleId];
}).sort((left, right) => left[0] - right[0]);
let expected = 101;
for (const [start, end, id] of ranges) {
  if (start !== expected) errors.push(`${id} begins at ${start}; expected ${expected}.`);
  expected = end + 1;
}
if (expected !== 401) errors.push(`Provisional ranges end at ${expected - 1}; expected 400.`);

errors.forEach((message) => console.error(`ERROR: ${message}`));
if (errors.length) process.exitCode = 1;
else console.log("Validated 36 ACT English bundles across six provisional 50-question forms.");
