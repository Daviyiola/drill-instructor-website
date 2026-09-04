#!/usr/bin/env node
"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {buildReport} = require("./auditQuestionBank");
const {
  contentFingerprint,
  datasetVersionsFor,
} = require("./questionReviewIdentity");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_ROOT = path.join(REPOSITORY_ROOT, ".question-audits");
const SUBJECT_TARGET = 4;
const PILOT_REQUIRED_IDS = new Set([
  "Mathematics#42",
  "Mathematics#294",
  "Math#50",
  "Math#166",
  "Math#171",
]);

function score(question) {
  return crypto.createHash("sha256")
      .update(`academic-pilot-v1\u0000${question.legacyId}`)
      .digest("hex");
}

function reviewTemplate() {
  return {
    independentlyDeterminedAnswerIndex: null,
    answerVerdict: "not_reviewed",
    explanationVerdict: "not_reviewed",
    wordingVerdict: "not_reviewed",
    formattingVerdict: "not_reviewed",
    confidence: null,
    notes: "",
    proposedChanges: null,
  };
}

function pilotQuestions(report) {
  const selected = [];
  const selectedIds = new Set();
  const add = (question) => {
    if (!question || selectedIds.has(question.legacyId)) return;
    selectedIds.add(question.legacyId);
    selected.push(question);
  };
  report.questions.filter((question) =>
    PILOT_REQUIRED_IDS.has(question.legacyId)).forEach(add);
  const groups = new Map();
  report.questions.forEach((question) => {
    const key = `${question.bootcamp}\u0000${question.subject}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(question);
  });
  groups.forEach((questions) => {
    const already = selected.filter((selectedQuestion) =>
      selectedQuestion.bootcamp === questions[0].bootcamp &&
      selectedQuestion.subject === questions[0].subject);
    const usedModules = new Set(already.map((question) => question.module));
    const candidates = [...questions].sort((left, right) =>
      score(left).localeCompare(score(right)));
    const imageCandidate = candidates.find((question) =>
      question.imageSources.length && !selectedIds.has(question.legacyId));
    if (already.length < SUBJECT_TARGET && imageCandidate) {
      add(imageCandidate);
      usedModules.add(imageCandidate.module);
    }
    for (const question of candidates) {
      const currentCount = selected.filter((selectedQuestion) =>
        selectedQuestion.bootcamp === question.bootcamp &&
        selectedQuestion.subject === question.subject).length;
      if (currentCount >= SUBJECT_TARGET) break;
      if (selectedIds.has(question.legacyId) ||
          usedModules.has(question.module)) continue;
      add(question);
      usedModules.add(question.module);
    }
    for (const question of candidates) {
      const currentCount = selected.filter((selectedQuestion) =>
        selectedQuestion.bootcamp === question.bootcamp &&
        selectedQuestion.subject === question.subject).length;
      if (currentCount >= SUBJECT_TARGET) break;
      add(question);
    }
  });
  return selected.sort((left, right) =>
    left.bootcamp.localeCompare(right.bootcamp) ||
    left.subject.localeCompare(right.subject) ||
    Number(left.sourceId) - Number(right.sourceId));
}

function blindQuestion(question, datasets) {
  return {
    id: question.id,
    legacyId: question.legacyId,
    bootcamp: question.bootcamp,
    subject: question.subject,
    module: question.module,
    practiceTest: question.practiceTest,
    prompt: question.prompt,
    passage: question.passage,
    imageSources: question.imageSources,
    options: question.options,
    deterministicFindings: question.findings,
    contentFingerprint: contentFingerprint(question, datasets),
    review: reviewTemplate(),
  };
}

function answerKeyQuestion(question, datasets) {
  return {
    legacyId: question.legacyId,
    contentFingerprint: contentFingerprint(question, datasets),
    configuredAnswer: question.configuredAnswer,
    configuredAnswerIndex: question.configuredAnswerIndex,
    explanation: question.explanation,
  };
}

function main() {
  const report = buildReport(["act", "sat"]);
  const questions = pilotQuestions(report);
  const datasets = datasetVersionsFor(questions);
  fs.mkdirSync(OUTPUT_ROOT, {recursive: true});
  const blindPath = path.join(OUTPUT_ROOT, "academic-pilot-blind.json");
  const keyPath = path.join(OUTPUT_ROOT, "academic-pilot-key.json");
  fs.writeFileSync(blindPath, `${JSON.stringify({
    formatVersion: 1,
    rubric: "docs/QUESTION_REVIEW_RUBRIC.md",
    selectionSeed: "academic-pilot-v1",
    datasets,
    questionCount: questions.length,
    questions: questions.map((question) => blindQuestion(question, datasets)),
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(keyPath, `${JSON.stringify({
    formatVersion: 1,
    datasets,
    questionCount: questions.length,
    questions: questions.map((question) =>
      answerKeyQuestion(question, datasets)),
  }, null, 2)}\n`, "utf8");
  console.log(`Prepared ${questions.length} blind pilot questions.`);
  console.log(`Review: ${blindPath}`);
  console.log(`Answer key: ${keyPath}`);
}

if (require.main === module) main();

module.exports = {pilotQuestions, reviewTemplate};
