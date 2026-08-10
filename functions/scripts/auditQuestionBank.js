#!/usr/bin/env node
"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  canonicalAssetPaths,
  loadDataset,
  normalizedQuestions,
} = require("../handlers/_studentDrill");
const {CONTENT_VERSIONS} = require("../data/contentVersions");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT = path.join(REPOSITORY_ROOT, ".question-audits");
const TEXT_FIELDS = [
  "question",
  "passage",
  "explanation",
  "option1",
  "option2",
  "option3",
  "option4",
];
const SUPPORTED_TAGS = new Set([
  "b", "strong", "i", "em", "u", "br", "p", "sup", "sub",
  "ul", "ol", "li",
]);
const VOID_TAGS = new Set(["br"]);
const UNSAFE_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "link", "meta",
]);
const VALID_TAG = /<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?\s*\/?>/g;

function argumentsFor(argv) {
  const result = {
    bootcamps: ["act", "sat"],
    output: DEFAULT_OUTPUT,
    strict: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--strict") result.strict = true;
    if (value === "--bootcamp") {
      const bootcamp = String(argv[index + 1] || "").toLowerCase();
      index += 1;
      result.bootcamps = bootcamp === "all" ? ["act", "sat"] : [bootcamp];
    }
    if (value === "--output") {
      result.output = path.resolve(argv[index + 1] || DEFAULT_OUTPUT);
      index += 1;
    }
  }
  const invalid = result.bootcamps.find((item) =>
    !Object.prototype.hasOwnProperty.call(CONTENT_VERSIONS, item));
  if (invalid) throw new Error(`Unsupported bootcamp: ${invalid}`);
  return result;
}

function normalizedText(value) {
  return String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
}

function finding(severity, code, field, message) {
  return {severity, code, field: field || null, message};
}

function markupTags(value) {
  const counts = {};
  let match;
  VALID_TAG.lastIndex = 0;
  while ((match = VALID_TAG.exec(String(value || ""))) !== null) {
    const tag = match[1].toLowerCase();
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

function inspectMarkup(value, field) {
  const text = String(value || "");
  const findings = [];
  const stack = [];
  const validRanges = [];
  let hasSupportedMarkup = false;
  let match;
  VALID_TAG.lastIndex = 0;
  while ((match = VALID_TAG.exec(text)) !== null) {
    validRanges.push([match.index, VALID_TAG.lastIndex]);
    const tag = match[1].toLowerCase();
    const closing = /^<\//.test(match[0]);
    const selfClosing = /\/\s*>$/.test(match[0]) || VOID_TAGS.has(tag);
    if (UNSAFE_TAGS.has(tag)) {
      findings.push(finding(
          "error", "unsafe_markup", field,
          `Unsafe <${tag}> markup is not allowed.`,
      ));
      continue;
    }
    if (!SUPPORTED_TAGS.has(tag)) {
      findings.push(finding(
          "warning", "unsupported_markup", field,
          `Unsupported <${tag}> markup requires review.`,
      ));
      continue;
    }
    hasSupportedMarkup = true;
    if (/\s+[A-Za-z_:][-A-Za-z0-9_:.]*\s*=/.test(match[0])) {
      findings.push(finding(
          "warning", "markup_attributes", field,
          `Attributes on <${tag}> are outside the portable text contract.`,
      ));
    }
    if (selfClosing) continue;
    if (!closing) {
      stack.push(tag);
      continue;
    }
    if (stack[stack.length - 1] === tag) {
      stack.pop();
    } else {
      findings.push(finding(
          "error", "mismatched_markup", field,
          `Closing </${tag}> does not match the open markup order.`,
      ));
    }
  }
  stack.forEach((tag) => findings.push(finding(
      "error", "unclosed_markup", field,
      `Opening <${tag}> has no matching closing tag.`,
  )));

  const residue = [...text];
  validRanges.forEach(([start, end]) => {
    for (let index = start; index < end; index += 1) residue[index] = " ";
  });
  const known = [...SUPPORTED_TAGS, ...UNSAFE_TAGS].join("|");
  const malformed = new RegExp(`<\\/?(?:${known})\\b`, "i");
  if (malformed.test(residue.join(""))) {
    findings.push(finding(
        "error", "malformed_markup", field,
        "A recognized HTML tag is incomplete or malformed.",
    ));
  }
  if (hasSupportedMarkup) {
    findings.push(finding(
        "info", "legacy_markup", field,
        "Portable rich-text markup is present and can be normalized later.",
    ));
  }
  return findings;
}

function inspectText(value, field, required) {
  const text = String(value || "");
  const findings = inspectMarkup(text, field);
  if (required && !normalizedText(text)) {
    findings.push(finding(
        "error", "missing_text", field, `${field} is required.`,
    ));
  }
  if (/\uFFFD|(?:Ã.|Â.|â€|â€™|â€œ|â€)/.test(text)) {
    findings.push(finding(
        "error", "encoding_artifact", field,
        "Text contains a replacement or likely mojibake character.",
    ));
  }
  if (/[^\t\n\r\x20-\uFFFF]/u.test(text)) {
    findings.push(finding(
        "error", "control_character", field,
        "Text contains an unsupported control character.",
    ));
  }
  if (text && text !== text.trim()) {
    findings.push(finding(
        "warning", "outer_whitespace", field,
        "Text has leading or trailing whitespace.",
    ));
  }
  return findings;
}

function sourceAsset(bootcamp, relativeAsset) {
  return path.join(
      REPOSITORY_ROOT,
      "public",
      "question-images",
      bootcamp.toUpperCase(),
      path.basename(relativeAsset),
  );
}

function manualReviewTemplate() {
  return {
    status: "pending",
    independentlyDeterminedAnswerIndex: null,
    answerVerdict: "not_reviewed",
    explanationVerdict: "not_reviewed",
    confidence: null,
    proposedChanges: null,
    reviewer: null,
    reviewedAt: null,
    notes: "",
  };
}

function auditQuestion(bootcamp, subject, sourceId, raw, canonical) {
  const findings = [];
  TEXT_FIELDS.forEach((field) => {
    const required = field !== "passage";
    findings.push(...inspectText(raw[field], field, required));
  });
  const options = [raw.option1, raw.option2, raw.option3, raw.option4]
      .map((value) => String(value || ""));
  const normalizedOptions = options.map(normalizedText);
  const duplicateOptions = new Set();
  normalizedOptions.forEach((value, index) => {
    if (value && normalizedOptions.indexOf(value) !== index) {
      duplicateOptions.add(value);
    }
  });
  if (duplicateOptions.size) {
    findings.push(finding(
        "error", "duplicate_options", "options",
        "Two or more answer options have identical normalized text.",
    ));
  }
  const exactMatches = options.reduce((indexes, option, index) => {
    if (option === String(raw.correctAnswer || "")) indexes.push(index);
    return indexes;
  }, []);
  if (exactMatches.length === 0) {
    const normalizedAnswer = normalizedText(raw.correctAnswer);
    const looseMatches = normalizedOptions.reduce((indexes, option, index) => {
      if (option && option === normalizedAnswer) indexes.push(index);
      return indexes;
    }, []);
    findings.push(finding(
        "error", "answer_not_in_options", "correctAnswer",
        looseMatches.length === 1 ?
          "The answer only matches an option after text normalization." :
          "The configured answer does not match any option.",
    ));
  } else if (exactMatches.length > 1) {
    findings.push(finding(
        "error", "ambiguous_answer", "correctAnswer",
        "The configured answer matches more than one option.",
    ));
  }
  const explanationText = normalizedText(raw.explanation);
  if (explanationText && explanationText.length < 40) {
    findings.push(finding(
        "warning", "short_explanation", "explanation",
        "The explanation is under 40 normalized characters.",
    ));
  }
  const correctIndex = exactMatches.length === 1 ? exactMatches[0] : null;
  const correctText = correctIndex === null ? "" :
    normalizedOptions[correctIndex];
  const formattingFields = {};
  TEXT_FIELDS.forEach((field) => {
    const tags = markupTags(raw[field]);
    if (Object.keys(tags).length) formattingFields[field] = {tags};
  });
  const imageSources = canonicalAssetPaths(
      raw.imageSources !== undefined ? raw.imageSources : raw.imageSource,
  );
  if (raw.imageSource !== undefined) {
    findings.push(finding(
        "warning", "deprecated_image_field", "imageSource",
        "Use imageSources arrays for canonical delivery.",
    ));
  }
  imageSources.forEach((asset) => {
    if (!fs.existsSync(sourceAsset(bootcamp, asset))) {
      findings.push(finding(
          "error", "missing_asset", "imageSources",
          `Referenced image does not exist: ${asset}`,
      ));
    }
  });
  if (!subject) {
    findings.push(finding(
        "error", "missing_subject", "subject", "Subject is required.",
    ));
  }
  const practiceYear = Number(raw.practiceYear);
  if (!Number.isInteger(practiceYear) || practiceYear < 1) {
    findings.push(finding(
        "error", "invalid_practice_test", "practiceYear",
        "practiceYear must be a positive integer.",
    ));
  }
  if (!String(raw.module || "").trim()) {
    findings.push(finding(
        "error", "missing_module", "module", "Module is required.",
    ));
  }
  if (!canonical) {
    findings.push(finding(
        "error", "normalization_failed", null,
        "The production normalizer would omit this question.",
    ));
  }
  return {
    id: canonical && canonical.id || null,
    legacyId: `${subject}#${sourceId}`,
    sourceId: String(sourceId),
    bootcamp,
    subject,
    module: String(raw.module || ""),
    practiceTest: canonical && canonical.practiceYear || practiceYear || null,
    prompt: String(raw.question || ""),
    options,
    configuredAnswer: String(raw.correctAnswer || ""),
    configuredAnswerIndex: correctIndex,
    explanation: String(raw.explanation || ""),
    passage: String(raw.passage || ""),
    imageSources,
    formattingProfile: {
      fields: formattingFields,
      fieldsWithMarkup: Object.keys(formattingFields),
    },
    explanationProfile: {
      normalizedCharacterCount: explanationText.length,
      stepBased: /\bstep\s*1\s*:/i.test(explanationText),
      mentionsConfiguredAnswer: Boolean(
          correctText && explanationText.includes(correctText),
      ),
    },
    findings,
    manualReview: manualReviewTemplate(),
  };
}

function contentFingerprint(question) {
  return crypto.createHash("sha256").update(JSON.stringify({
    prompt: normalizedText(question.prompt),
    options: question.options.map(normalizedText),
    passage: normalizedText(question.passage),
  })).digest("hex");
}

function auditBootcamp(bootcamp) {
  const canonical = normalizedQuestions(bootcamp, false);
  const canonicalByLegacy = new Map(
      canonical.map((question) => [question.legacyId, question]),
  );
  const questions = [];
  loadDataset(bootcamp).forEach((row) => {
    const subject = String(row.subject || "").trim();
    Object.entries(row).forEach(([sourceId, raw]) => {
      if (sourceId === "subject" || !raw || typeof raw !== "object") return;
      const legacyId = `${subject}#${sourceId}`;
      questions.push(auditQuestion(
          bootcamp,
          subject,
          sourceId,
          raw,
          canonicalByLegacy.get(legacyId),
      ));
    });
  });
  const ids = new Map();
  const fingerprints = new Map();
  questions.forEach((question) => {
    if (question.id) {
      if (ids.has(question.id)) {
        question.findings.push(finding(
            "error", "duplicate_id", "id",
            `Canonical ID duplicates ${ids.get(question.id)}.`,
        ));
      } else {
        ids.set(question.id, question.legacyId);
      }
    }
    const fingerprint = contentFingerprint(question);
    if (fingerprints.has(fingerprint)) {
      question.findings.push(finding(
          "error", "duplicate_question", null,
          `Question content duplicates ${fingerprints.get(fingerprint)}.`,
      ));
    } else {
      fingerprints.set(fingerprint, question.legacyId);
    }
  });
  return questions;
}

function summarize(questions) {
  const severityCounts = {error: 0, warning: 0, info: 0};
  const codeCounts = {};
  const markupTagCounts = {};
  questions.forEach((question) => question.findings.forEach((item) => {
    severityCounts[item.severity] += 1;
    codeCounts[item.code] = (codeCounts[item.code] || 0) + 1;
  }));
  questions.forEach((question) => {
    Object.values(question.formattingProfile.fields).forEach((field) => {
      Object.entries(field.tags).forEach(([tag, count]) => {
        markupTagCounts[tag] = (markupTagCounts[tag] || 0) + count;
      });
    });
  });
  return {
    questionCount: questions.length,
    questionsWithErrors: questions.filter((question) =>
      question.findings.some((item) => item.severity === "error")).length,
    questionsWithWarnings: questions.filter((question) =>
      question.findings.some((item) => item.severity === "warning")).length,
    pendingManualReview: questions.filter((question) =>
      question.manualReview.status === "pending").length,
    explanationStyles: {
      stepBased: questions.filter((question) =>
        question.explanationProfile.stepBased).length,
      prose: questions.filter((question) =>
        !question.explanationProfile.stepBased &&
        question.explanationProfile.normalizedCharacterCount > 0).length,
      missing: questions.filter((question) =>
        question.explanationProfile.normalizedCharacterCount === 0).length,
    },
    questionsWithImages: questions.filter((question) =>
      question.imageSources.length > 0).length,
    severityCounts,
    markupTagCounts: Object.fromEntries(Object.entries(markupTagCounts)
        .sort((left, right) => left[0].localeCompare(right[0]))),
    codeCounts: Object.fromEntries(Object.entries(codeCounts)
        .sort((left, right) => left[0].localeCompare(right[0]))),
  };
}

function markdown(report) {
  const lines = [
    "# Question Bank Audit",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "Deterministic findings do not certify academic correctness. The manual " +
      "review fields in the JSON report are the handoff for independent " +
      "solving and explanation review.",
    "",
    "## Summary",
    "",
    "| Bank | Version | Questions | Error questions | Warning questions |",
    "| --- | --- | ---: | ---: | ---: |",
  ];
  Object.entries(report.bootcamps).forEach(([bootcamp, row]) => {
    lines.push(
        `| ${bootcamp.toUpperCase()} | ${row.datasetVersion} | ` +
        `${row.summary.questionCount} | ${row.summary.questionsWithErrors} | ` +
        `${row.summary.questionsWithWarnings} |`,
    );
  });
  lines.push("", "## Finding counts", "", "| Code | Count |", "| --- | ---: |");
  Object.entries(report.summary.codeCounts).forEach(([code, count]) => {
    lines.push(`| ${code} | ${count} |`);
  });
  lines.push("", "## Markup inventory", "", "| Tag | Uses |", "| --- | ---: |");
  Object.entries(report.summary.markupTagCounts).forEach(([tag, count]) => {
    lines.push(`| ${tag} | ${count} |`);
  });
  lines.push(
      "", "## Questions requiring deterministic fixes", "",
      "| Question | Location | Findings |", "| --- | --- | --- |",
  );
  report.questions.filter((question) => question.findings.some((item) =>
    item.severity !== "info")).forEach((question) => {
    const issues = question.findings.filter((item) =>
      item.severity !== "info").map((item) =>
      `${item.severity}: ${item.code}`).join("; ");
    const location = `${question.bootcamp.toUpperCase()} / ` +
      `${question.subject} / Test ${question.practiceTest}`;
    lines.push(`| ${question.legacyId.replace(/\|/g, "\\|")} | ` +
      `${location.replace(/\|/g, "\\|")} | ${issues} |`);
  });
  return `${lines.join("\n")}\n`;
}

function buildReport(bootcamps, generatedAt = new Date().toISOString()) {
  const questions = bootcamps.flatMap(auditBootcamp);
  const report = {
    formatVersion: 1,
    generatedAt,
    scope: bootcamps,
    bootcamps: {},
    summary: summarize(questions),
    questions,
  };
  bootcamps.forEach((bootcamp) => {
    const rows = questions.filter((question) =>
      question.bootcamp === bootcamp);
    report.bootcamps[bootcamp] = {
      datasetVersion: CONTENT_VERSIONS[bootcamp].datasetVersion,
      schemaVersion: CONTENT_VERSIONS[bootcamp].schemaVersion,
      correctionRevision: CONTENT_VERSIONS[bootcamp].correctionRevision,
      summary: summarize(rows),
    };
  });
  return report;
}

function writeReport(report, output) {
  fs.mkdirSync(output, {recursive: true});
  const jsonPath = path.join(output, "question-bank-audit.json");
  const markdownPath = path.join(output, "question-bank-audit.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, markdown(report), "utf8");
  return {jsonPath, markdownPath};
}

function main() {
  const options = argumentsFor(process.argv.slice(2));
  const report = buildReport(options.bootcamps);
  const files = writeReport(report, options.output);
  console.log(`Audited ${report.summary.questionCount} questions.`);
  console.log(`Errors: ${report.summary.severityCounts.error}; ` +
    `warnings: ${report.summary.severityCounts.warning}.`);
  console.log(`JSON: ${files.jsonPath}`);
  console.log(`Markdown: ${files.markdownPath}`);
  if (options.strict && report.summary.severityCounts.error > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  argumentsFor,
  auditBootcamp,
  buildReport,
  inspectMarkup,
  markupTags,
  markdown,
  normalizedText,
  summarize,
};
