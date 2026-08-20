"use strict";

const fs = require("fs");
const path = require("path");

const root = __dirname;
const editorial = JSON.parse(fs.readFileSync(path.join(root, "editorial-similarity-scores.json"), "utf8"));
const metrics = JSON.parse(fs.readFileSync(path.join(root, "staging", "SIMILARITY_METRICS.json"), "utf8"));
const metricByKey = new Map(metrics.comparisons.map((item) => [`${item.sourceId}${item.blueprint}`, item]));
const weightEntries = Object.entries(editorial.overallWeights);

function overall(item) {
  return weightEntries.reduce((sum, [field, weight]) => sum + item[field] * weight, 0);
}

function verdict(item) {
  if (item.disguisedRewriteRisk >= 8) return "REDESIGN";
  if (item.disguisedRewriteRisk >= 6) return "REVIEW";
  return "LOW";
}

const enriched = editorial.scores.map((item) => ({...item, overall: overall(item), metric: metricByKey.get(`${item.sourceId}${item.blueprint}`), verdict: verdict(item)}));
const averageOverall = enriched.reduce((sum, item) => sum + item.overall, 0) / enriched.length;
const averageDisguised = enriched.reduce((sum, item) => sum + item.disguisedRewriteRisk, 0) / enriched.length;
const maximumJaccard = Math.max(...enriched.map((item) => item.metric.contentWordJaccard));
const maximumRun = Math.max(...enriched.map((item) => item.metric.longestExactWordRun.length));
const totalFiveGrams = enriched.reduce((sum, item) => sum + item.metric.fiveGramOverlap.count, 0);

const lines = [
  "# ACT Reading source-similarity audit", "",
  `Generated: ${new Date().toISOString()}`, "",
  "## Executive finding", "",
  `The portfolio has **very low textual-copy risk** but uneven **conceptual and structural distance**. The average weighted similarity score is **${averageOverall.toFixed(1)}/10**, while the average holistic disguised-rewrite risk is **${averageDisguised.toFixed(1)}/10**. Seven batches should be redesigned before publication because their narrative or argumentative skeleton remains conspicuously close to the corresponding source.`, "",
  `Across all 30 source-to-generation comparisons, the maximum content-word Jaccard similarity is **${(maximumJaccard * 100).toFixed(1)}%**, the longest exact run is **${maximumRun} words**, and the total number of shared five-word sequences is **${totalFiveGrams}**. The short exact runs are boilerplate such as passage labels, not source expression.`, "",
  "This is an editorial risk assessment, not a legal opinion.", "",
  "## Scale and weighting", "",
  "Every score uses **1 = minimal resemblance** and **10 = near-copy or strongly disguised rewrite**. Overall similarity weights wording and factual overlap most heavily: wording/syntax 20%, facts/entities/examples 20%, and each remaining evidence dimension 10%. The separate disguised-rewrite score is a holistic judgment that deliberately gives more attention to conspicuous conceptual and structural transposition.", "",
  "| Code | Dimension |", "|---|---|",
  "| W | Wording and syntax |", "| F | Facts, entities, and examples |", "| S | Subject matter |", "| C | Central conceptual theme |", "| P | Paragraph-function sequence |", "| R | Overall rhetorical architecture |", "| I | Distinctive imagery and motifs |", "| Q | Question-logic transfer |", "| D | Risk of feeling like a disguised rewrite |", "| O | Weighted overall similarity |", "",
  "## Complete scorecard", "",
  "| Batch | Generated focus | W | F | S | C | P | R | I | Q | D | O | Decision |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ...enriched.map((item) => `| S${item.sourceId}${item.blueprint} | ${item.label} | ${item.wordingSyntax} | ${item.factsEntitiesExamples} | ${item.subjectMatter} | ${item.centralConceptualTheme} | ${item.paragraphFunctionSequence} | ${item.rhetoricalArchitecture} | ${item.imageryMotifs} | ${item.questionLogic} | **${item.disguisedRewriteRisk}** | **${item.overall.toFixed(1)}** | ${item.verdict} |`), "",
  "## Redesign before publication", "",
  ...enriched.filter((item) => item.verdict === "REDESIGN").map((item) => `### S${item.sourceId}${item.blueprint}: ${item.label}\n\n${item.rationale}`), "",
  "The most concerning batch is **S8A**. It replaces romance with apprenticeship but retains an orchestrated meeting, attraction to a commitment, approval from one community, family resistance, and a deliberate choice. That reads like a domain-swapped version of the source arc. **S4A**, **S6A**, **S6B**, and **S7A** also preserve unusually recognizable experiential or conceptual skeletons. **S14A** and **S15A** are factually independent but remain too adjacent in debate structure or scientific domain to offer the desired safety margin.", "",
  "## Review and optionally restructure", "",
  ...enriched.filter((item) => item.verdict === "REVIEW").map((item) => `- **S${item.sourceId}${item.blueprint} — ${item.label}:** ${item.rationale}`), "",
  "These batches do not copy wording, facts, names, quotations, or examples. Their risk comes from retaining a conspicuous sequence of paragraph jobs or the same conceptual opposition. They can usually be de-risked by changing the opening strategy, causal order, evidence hierarchy, and conclusion—not merely by swapping nouns.", "",
  "## Low-risk batches", "",
  enriched.filter((item) => item.verdict === "LOW").map((item) => `S${item.sourceId}${item.blueprint}`).join(", "), "",
  "## Recommended release gate", "",
  "1. Replace the seven REDESIGN batches with new blueprints whose central conflict or explanatory mechanism is different from the source—not only a different topic.",
  "2. Give the REVIEW batches a targeted structural pass. At minimum, change two of these three elements: opening move, evidence/episode sequence, or final synthesis.",
  "3. Rerun `measure-source-similarity.js` after revisions. Keep zero shared five-word sequences and investigate any exact run above four words.",
  "4. Repeat this editorial scorecard after revisions; target disguised-rewrite risk of 5 or lower for every batch.", "",
  "## Per-batch rationale", "",
  ...enriched.map((item) => `- **S${item.sourceId}${item.blueprint} (${item.verdict}, D ${item.disguisedRewriteRisk}/10, O ${item.overall.toFixed(1)}/10):** ${item.rationale}`), "",
];

const outputPath = path.join(root, "staging", "SOURCE_SIMILARITY_AUDIT.md");
fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}.`);
console.log(`Average overall ${averageOverall.toFixed(2)}, average disguised-rewrite risk ${averageDisguised.toFixed(2)}, redesign ${enriched.filter((item) => item.verdict === "REDESIGN").length}, review ${enriched.filter((item) => item.verdict === "REVIEW").length}, low ${enriched.filter((item) => item.verdict === "LOW").length}.`);
