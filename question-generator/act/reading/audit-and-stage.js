"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const manifestPath = path.join(root, "batch-manifest.json");
const workRoot = path.join(root, "work");
const stagingRoot = path.join(root, "staging");
const sourceText = normalizedSource(fs.readFileSync(path.join(root, "source-questions.txt"), "utf8"));
const sourceNgrams = ngrams(sourceText, 12);
const allowedTypes = new Set(["Literary Narrative", "Social Science", "Humanities", "Natural Science", "Paired Passages"]);
const allowedModules = new Set([
  "Author's Purpose and Perspective", "Central Ideas and Themes", "Character and Relationship Analysis",
  "Comparative Passage Analysis", "Function and Structure", "Inference and Implication",
  "Sequence and Relationships", "Textual Details", "Vocabulary in Context",
]);
const fields = ["skill_tested", "question", "option1", "option2", "option3", "option4", "correctAnswer", "explanation", "practiceYear", "difficulty", "module", "imageSources", "passage"];

function parseFragment(file) {
  return vm.runInNewContext(`(${fs.readFileSync(file, "utf8").trim()})`, Object.create(null), {
    timeout: 1000,
    codeGeneration: {strings: false, wasm: false},
  });
}

function words(html) {
  return html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

function visibleLength(value) {
  return String(value || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

function choiceLengthSignal(options, correctAnswer) {
  const correctIndex = options.indexOf(correctAnswer);
  if (correctIndex < 0) return null;
  const lengths = options.map(visibleLength);
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);
  const longestIndexes = lengths.map((length, index) => ({length, index})).filter(({length}) => length === longest).map(({index}) => index);
  const longestDistractor = Math.max(...lengths.filter((_, index) => index !== correctIndex));
  const shortestIndexes = lengths.map((length, index) => ({length, index})).filter(({length}) => length === shortest).map(({index}) => index);
  const shortestDistractor = Math.min(...lengths.filter((_, index) => index !== correctIndex));
  return {correctIndex, correctLength: lengths[correctIndex], longestDistractor, longestIndexes, expectedLongestGuess: longestIndexes.includes(correctIndex) ? 1 / longestIndexes.length : 0, shortestIndexes, shortestDistractor, expectedShortestGuess: shortestIndexes.includes(correctIndex) ? 1 / shortestIndexes.length : 0};
}

function normalized(text) {
  return String(text).toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedSource(text) {
  return String(text).toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

function ngrams(tokens, size) {
  const result = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) result.add(tokens.slice(index, index + size).join(" "));
  return result;
}

function jaccard(left, right) {
  const a = new Set(normalizedSource(left));
  const b = new Set(normalizedSource(right));
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection || 1);
}

function serializeValue(value) {
  return JSON.stringify(value);
}

function serializeQuestion(number, question) {
  return `${number}: {${fields.map((field) => `${field}: ${serializeValue(question[field])}`).join(", ")}}`;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const errors = [];
const warnings = [];
const seenAssets = new Set();
const seenPassages = new Map();
const seenQuestions = new Map();
const seenQuestionRecords = new Map();
const allQuestions = new Map();
const passageIndex = [];
const moduleCounts = Object.fromEntries([...allowedModules].map((module) => [module, 0]));
const difficultyCounts = {Medium: 0, Hard: 0, "Very Hard": 0};
const answerPositionCounts = {option1: 0, option2: 0, option3: 0, option4: 0};
const passagesBySource = new Map();
const sourcePairSimilarities = [];

if (manifest.batches.length !== 30) errors.push(`Manifest has ${manifest.batches.length} batches instead of 30.`);
if (manifest.questionCount !== 270 || manifest.firstQuestionNumber !== 19 || manifest.lastQuestionNumber !== 288) errors.push("Manifest corpus totals do not match 270 questions numbered 19-288.");

for (const sourceId of Array.from({length: 15}, (_, index) => index + 1)) {
  const blueprintFile = path.join(workRoot, `source-${String(sourceId).padStart(2, "0")}`, "blueprints.json");
  if (!fs.existsSync(blueprintFile)) {
    errors.push(`Missing blueprint file for source ${sourceId}.`);
    continue;
  }
  const blueprintAsset = JSON.parse(fs.readFileSync(blueprintFile, "utf8"));
  const labels = (blueprintAsset.blueprints || []).map((item) => item.blueprint_label).sort().join("");
  if (labels !== "AB") errors.push(`Source ${sourceId} does not contain exactly Blueprints A and B.`);
  for (const blueprint of blueprintAsset.blueprints || []) {
    if (!allowedTypes.has(blueprint.act_reading_passage_type)) errors.push(`Source ${sourceId}${blueprint.blueprint_label} has invalid blueprint passage type ${blueprint.act_reading_passage_type}.`);
  }
}

for (const batch of manifest.batches) {
  const sourceFolder = `source-${String(batch.sourceId).padStart(2, "0")}`;
  const blueprintFolder = `blueprint-${batch.blueprint.toLowerCase()}`;
  const folder = path.join(workRoot, sourceFolder, blueprintFolder);
  const passageFile = path.join(folder, "passage.json");
  const finalFile = path.join(folder, "final.jsfrag");
  const passageVerificationFile = path.join(folder, "passage-verification.json");
  const questionsFile = path.join(folder, "questions.jsfrag");
  const questionVerificationFile = path.join(folder, "question-verification.txt");
  const label = `${sourceFolder}/${blueprintFolder}`;
  if (batch.status !== "validated") errors.push(`${label} is not marked validated.`);
  if (![passageFile, passageVerificationFile, questionsFile, questionVerificationFile, finalFile].every(fs.existsSync)) {
    errors.push(`${label} is missing one or more required workflow artifacts.`);
    continue;
  }

  const passageVerification = JSON.parse(fs.readFileSync(passageVerificationFile, "utf8"));
  if (passageVerification.status !== "passed_local_verification") errors.push(`${label} passage verification is not passed.`);
  if (fs.readFileSync(questionsFile, "utf8") !== fs.readFileSync(finalFile, "utf8")) errors.push(`${label} questions.jsfrag is stale relative to final.jsfrag.`);
  if (!fs.readFileSync(questionVerificationFile, "utf8").startsWith("PASS — local question verification")) errors.push(`${label} question verification is not passed.`);

  const asset = JSON.parse(fs.readFileSync(passageFile, "utf8"));
  const actualWords = words(asset.passage || "");
  if (!allowedTypes.has(asset.act_reading_passage_type)) errors.push(`${label} has invalid passage type ${asset.act_reading_passage_type}.`);
  if (actualWords < 650 || actualWords > 850) errors.push(`${label} has ${actualWords} words; expected 650-850.`);
  if (asset.passage_word_count !== actualWords) errors.push(`${label} declares ${asset.passage_word_count} words but contains ${actualWords}.`);
  if (!Array.isArray(asset.imageSources) || asset.imageSources.length) errors.push(`${label} must use imageSources: [].`);
  if (!asset.passage_asset_id || seenAssets.has(asset.passage_asset_id)) errors.push(`${label} has a missing or duplicate passage_asset_id.`);
  seenAssets.add(asset.passage_asset_id);
  const expectedHeader = `<b>${asset.act_reading_passage_type.toUpperCase()}:</b>`;
  if (!(asset.passage || "").startsWith(expectedHeader) || asset.passage_type_display_label !== asset.act_reading_passage_type.toUpperCase()) errors.push(`${label} visible passage-type header does not match its canonical metadata.`);
  if ((asset.passage || "").replace(/<br><br>/g, "").includes("<br>")) errors.push(`${label} contains a single <br> rather than paragraph-level <br><br>.`);
  if ((asset.passage || "").includes('"')) errors.push(`${label} contains a literal double quotation mark in the passage string.`);
  const passageKey = normalized(asset.passage);
  if (seenPassages.has(passageKey)) errors.push(`${label} duplicates the passage in ${seenPassages.get(passageKey)}.`);
  seenPassages.set(passageKey, label);
  const generatedNgrams = ngrams(normalizedSource(asset.passage), 12);
  const sourceMatches = [...generatedNgrams].filter((item) => sourceNgrams.has(item));
  if (sourceMatches.length) errors.push(`${label} shares a 12-word sequence with source material: ${sourceMatches[0]}.`);
  if (!passagesBySource.has(batch.sourceId)) passagesBySource.set(batch.sourceId, {});
  passagesBySource.get(batch.sourceId)[batch.blueprint] = asset.passage;

  let questions;
  try { questions = parseFragment(finalFile); } catch (error) { errors.push(`${label} fragment cannot be parsed: ${error.message}`); continue; }
  const keys = Object.keys(questions).map(Number).sort((a, b) => a - b);
  const expected = Array.from({length: 9}, (_, index) => batch.startQuestionNumber + index);
  if (JSON.stringify(keys) !== JSON.stringify(expected)) errors.push(`${label} keys do not match ${expected[0]}-${expected[8]}.`);
  const batchDifficulties = {Medium: 0, Hard: 0, "Very Hard": 0};
  let batchExpectedLongestGuess = 0;
  let batchExpectedShortestGuess = 0;

  for (const number of expected) {
    const question = questions[number];
    if (!question) { errors.push(`${label} is missing question ${number}.`); continue; }
    for (const field of fields) if (!Object.prototype.hasOwnProperty.call(question, field)) errors.push(`Question ${number} is missing ${field}.`);
    const options = [question.option1, question.option2, question.option3, question.option4];
    if (new Set(options).size !== 4) errors.push(`Question ${number} has duplicate options.`);
    const correctIndex = options.findIndex((option) => option === question.correctAnswer);
    if (correctIndex < 0 || options.filter((option) => option === question.correctAnswer).length !== 1) errors.push(`Question ${number} does not have exactly one matching correct option.`);
    else answerPositionCounts[`option${correctIndex + 1}`] += 1;
    const lengthSignal = choiceLengthSignal(options, question.correctAnswer);
    if (lengthSignal) {
      batchExpectedLongestGuess += lengthSignal.expectedLongestGuess;
      batchExpectedShortestGuess += lengthSignal.expectedShortestGuess;
      const margin = lengthSignal.correctLength - lengthSignal.longestDistractor;
      const ratio = lengthSignal.longestDistractor ? lengthSignal.correctLength / lengthSignal.longestDistractor : Infinity;
      if (lengthSignal.longestIndexes.length === 1 && lengthSignal.longestIndexes[0] === lengthSignal.correctIndex && margin >= 12 && ratio >= 1.18) errors.push(`Question ${number} leaks its answer through length by ${margin} visible characters.`);
      const shortestMargin = lengthSignal.shortestDistractor - lengthSignal.correctLength;
      if (lengthSignal.shortestIndexes.length === 1 && lengthSignal.shortestIndexes[0] === lengthSignal.correctIndex && shortestMargin >= 12) errors.push(`Question ${number} leaks its answer through brevity by ${shortestMargin} visible characters.`);
    }
    if (!allowedModules.has(question.module)) errors.push(`Question ${number} has invalid module ${question.module}.`);
    else moduleCounts[question.module] += 1;
    if (!Object.prototype.hasOwnProperty.call(batchDifficulties, question.difficulty)) errors.push(`Question ${number} has invalid difficulty ${question.difficulty}.`);
    else { batchDifficulties[question.difficulty] += 1; difficultyCounts[question.difficulty] += 1; }
    if (!Array.isArray(question.imageSources) || question.imageSources.length) errors.push(`Question ${number} must use imageSources: [].`);
    if (question.passage !== "{{shared_passage}}") errors.push(`Question ${number} lacks the shared-passage placeholder.`);
    const explanationWithoutPairs = String(question.explanation || "").replace(/<br><br>/g, "");
    if (explanationWithoutPairs.includes("<br>")) errors.push(`Question ${number} contains a single explanation break.`);
    if (!String(question.explanation).includes("Step 1:") || !String(question.explanation).includes("Answer:")) errors.push(`Question ${number} lacks required explanation labels.`);
    if (/<(?:b|strong)>\s*(?:Step|Answer|Additional reasoning step)/i.test(question.explanation || "")) errors.push(`Question ${number} bolds an explanation label.`);
    if (/Additional reasoning step:/i.test(question.explanation || "")) errors.push(`Question ${number} must number its reasoning sequentially.`);
    for (const [field, value] of Object.entries(question)) if (typeof value === "string" && value.includes('"')) errors.push(`Question ${number} field ${field} contains a literal double quote.`);
    if (!String(question.explanation).includes(String(question.correctAnswer))) errors.push(`Question ${number} explanation does not restate its correct answer.`);
    if (question.module === "Comparative Passage Analysis" && asset.act_reading_passage_type !== "Paired Passages") errors.push(`Question ${number} uses Comparative Passage Analysis on a non-paired passage.`);
    const questionKey = normalized(question.question);
    if (seenQuestions.has(questionKey)) warnings.push(`Question ${number} reuses the standard stem from question ${seenQuestions.get(questionKey)}.`);
    seenQuestions.set(questionKey, number);
    const recordKey = normalized([question.question, ...options].join(" "));
    if (seenQuestionRecords.has(recordKey)) errors.push(`Question ${number} duplicates the full question and options from question ${seenQuestionRecords.get(recordKey)}.`);
    seenQuestionRecords.set(recordKey, number);
    allQuestions.set(number, {...question, passage: asset.passage});
  }
  if (JSON.stringify(batchDifficulties) !== JSON.stringify({Medium: 3, Hard: 4, "Very Hard": 2})) errors.push(`${label} has incorrect difficulty distribution ${JSON.stringify(batchDifficulties)}.`);
  if (batchExpectedLongestGuess > 4.001) errors.push(`${label} allows a longest-choice strategy to score ${batchExpectedLongestGuess.toFixed(1)} of 9; maximum 4.0.`);
  if (batchExpectedShortestGuess > 4.001) errors.push(`${label} allows a shortest-choice strategy to score ${batchExpectedShortestGuess.toFixed(1)} of 9; maximum 4.0.`);
  passageIndex.push({sourceId: batch.sourceId, blueprint: batch.blueprint, startQuestionNumber: batch.startQuestionNumber, endQuestionNumber: batch.endQuestionNumber, passageAssetId: asset.passage_asset_id, passageType: asset.act_reading_passage_type, wordCount: actualWords});
}

const globalKeys = [...allQuestions.keys()].sort((a, b) => a - b);
const expectedGlobalKeys = Array.from({length: 270}, (_, index) => manifest.firstQuestionNumber + index);
if (JSON.stringify(globalKeys) !== JSON.stringify(expectedGlobalKeys)) errors.push(`Global question numbering is not contiguous from ${manifest.firstQuestionNumber} through ${manifest.lastQuestionNumber}.`);
if (JSON.stringify(difficultyCounts) !== JSON.stringify({Medium: 90, Hard: 120, "Very Hard": 60})) errors.push(`Global difficulty distribution is incorrect: ${JSON.stringify(difficultyCounts)}.`);
for (const [module, count] of Object.entries(moduleCounts)) if (!count) errors.push(`Module ${module} has no questions.`);
for (const [sourceId, pair] of passagesBySource.entries()) {
  if (!pair.A || !pair.B) { errors.push(`Source ${sourceId} is missing one passage for distinctness comparison.`); continue; }
  const similarity = jaccard(pair.A, pair.B);
  sourcePairSimilarities.push({sourceId, similarity});
  if (similarity >= 0.5) errors.push(`Source ${sourceId} Blueprint A/B token similarity is too high at ${similarity.toFixed(3)}.`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

fs.mkdirSync(stagingRoot, {recursive: true});
const stagingFile = path.join(stagingRoot, "reading-generated-19-288.jsfrag");
fs.writeFileSync(stagingFile, `{\n${globalKeys.map((number) => serializeQuestion(number, allQuestions.get(number))).join(",\n")}\n}\n`, "utf8");
const stagedQuestions = parseFragment(stagingFile);
const stagedKeys = Object.keys(stagedQuestions).map(Number).sort((a, b) => a - b);
if (JSON.stringify(stagedKeys) !== JSON.stringify(expectedGlobalKeys)) throw new Error("Staging parse-back failed its key-continuity check.");
for (const number of stagedKeys) if (stagedQuestions[number].passage.includes("{{shared_passage}}")) throw new Error(`Staged question ${number} was not hydrated.`);
fs.writeFileSync(path.join(stagingRoot, "passage-index.json"), `${JSON.stringify({generatedAt: new Date().toISOString(), passageCount: passageIndex.length, questionCount: allQuestions.size, passages: passageIndex}, null, 2)}\n`, "utf8");

const report = [
  "# ACT Reading corpus audit", "", `Generated: ${new Date().toISOString()}`, "",
  "## Result", "", `- 15 source groups`, `- 30 original passages`, `- 270 questions numbered 19-288`, `- 30 validated batch statuses`, `- All passages contain 650-850 words and their declared counts match`, `- All question records satisfy the canonical schema and answer contract`, `- Global difficulty distribution: 90 Medium, 120 Hard, 60 Very Hard`, "",
  "## Module coverage", "", ...Object.entries(moduleCounts).sort((a,b)=>a[0].localeCompare(b[0])).map(([module,count])=>`- ${module}: ${count}`), "",
  "## Original answer-position distribution", "", ...Object.entries(answerPositionCounts).map(([position,count])=>`- ${position}: ${count}`), "",
  "The staging fragment preserves the authored option order. Answer-position distribution is reported for human review and is not used as a correctness signal.", "",
  "## Reused standard stems", "", ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ["- None"]), "",
  "## Blueprint distinctness", "", ...sourcePairSimilarities.map(({sourceId, similarity}) => `- Source ${sourceId}: A/B token-set similarity ${(similarity * 100).toFixed(1)}%`), "",
  "No generated passage shares an exact 12-word sequence with the supplied source material.", "",
  "## Staging artifacts", "", "- `staging/reading-generated-19-288.jsfrag` hydrates every question with its verified passage and is ready for human import review.", "- `staging/passage-index.json` maps every source and blueprint to its passage asset and question range.", "", "No content was published or deployed.", "",
];
fs.writeFileSync(path.join(stagingRoot, "AUDIT_REPORT.md"), report.join("\n"), "utf8");

console.log(`AUDIT PASSED: ${passageIndex.length} passages, ${allQuestions.size} questions, keys ${globalKeys[0]}-${globalKeys.at(-1)}.`);
console.log(`Difficulty: ${JSON.stringify(difficultyCounts)}.`);
console.log(`Answer positions: ${JSON.stringify(answerPositionCounts)}.`);
console.log(`Staged ${path.relative(process.cwd(), stagingFile)}.`);
