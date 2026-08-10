#!/usr/bin/env node
"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const {
  buildCatalog,
  normalizedQuestions,
  questionStimulusKey,
} = require("../handlers/_studentDrill");
const {CONTENT_VERSIONS} = require("../data/contentVersions");
const {correctionsFor} = require("../data/contentCorrections");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_ROOT = path.join(REPOSITORY_ROOT, ".content-packs");
const FREE_ROOT = path.join(
    REPOSITORY_ROOT, "Drill_Instructor", "assets", "content-free",
);
const FIXED_ZIP_DATE = new Date("2026-01-01T00:00:00.000Z");

function sha256File(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename))
      .digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value), "utf8")
      .digest("hex");
}

function slug(value) {
  return String(value || "").trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), {recursive: true});
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sourceAsset(bootcamp, relativeAsset) {
  const basename = path.basename(relativeAsset);
  return path.join(
      REPOSITORY_ROOT,
      "public",
      "question-images",
      bootcamp.toUpperCase(),
      basename,
  );
}

function validateQuestions(bootcamp, questions) {
  const ids = new Set();
  const legacyIds = new Set();
  const contentFingerprints = new Map();
  const duplicateContent = [];
  questions.forEach((question) => {
    if (!question.id || ids.has(question.id)) {
      throw new Error(`${bootcamp}: duplicate or missing id ${question.id}`);
    }
    ids.add(question.id);
    if (!question.legacyId || legacyIds.has(question.legacyId)) {
      throw new Error(
          `${bootcamp}: duplicate or missing legacyId ${question.legacyId}`,
      );
    }
    legacyIds.add(question.legacyId);
    if (!Number.isInteger(question.correctIndex) ||
        question.correctIndex < 0 || question.correctIndex >= 4) {
      throw new Error(`${bootcamp}: invalid answer for ${question.id}`);
    }
    if (!question.subject || !question.module ||
        !Number.isInteger(question.practiceYear) ||
        question.practiceYear < 1) {
      throw new Error(`${bootcamp}: incomplete metadata for ${question.id}`);
    }
    const encoded = Buffer.from(JSON.stringify(question), "utf8");
    if (encoded.toString("utf8") !== JSON.stringify(question)) {
      throw new Error(`${bootcamp}: invalid UTF-8 in ${question.id}`);
    }
    const fingerprint = sha256Text(JSON.stringify({
      prompt: question.prompt,
      passage: question.passage,
      options: question.options,
    }));
    if (contentFingerprints.has(fingerprint)) {
      duplicateContent.push([
        contentFingerprints.get(fingerprint), question.id,
      ]);
    } else {
      contentFingerprints.set(fingerprint, question.id);
    }
    if (!Array.isArray(question.imageSources)) {
      throw new Error(`${bootcamp}: imageSources must be an array for ` +
        question.id);
    }
    question.imageSources.forEach((asset) => {
      if (!fs.existsSync(sourceAsset(bootcamp, asset))) {
        throw new Error(
            `${bootcamp}: missing image ${asset} referenced by ${question.id}`,
        );
      }
    });
  });
  if (duplicateContent.length) {
    throw new Error(
        `${bootcamp}: duplicate question content: ` +
        duplicateContent.map((pair) => pair.join(" / ")).join(", "),
    );
  }
}

function validateCorrections(bootcamp, questions, descriptor) {
  const corrections = correctionsFor(bootcamp);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const forbidden = ["id", "legacyId", "sourceId", "subject", "module",
    "practiceTest", "practiceYear"];
  if (descriptor.correctionRevision === 0 &&
      Object.keys(corrections).length !== 0) {
    throw new Error(`${bootcamp}: revision zero cannot contain corrections`);
  }
  Object.entries(corrections).forEach(([id, change]) => {
    const original = byId.get(id);
    if (!original) throw new Error(`${bootcamp}: unknown correction id ${id}`);
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      throw new Error(`${bootcamp}: invalid correction for ${id}`);
    }
    const reassignment = forbidden.find((field) =>
      Object.prototype.hasOwnProperty.call(change, field));
    if (reassignment) {
      throw new Error(
          `${bootcamp}: correction ${id} cannot change ${reassignment}`,
      );
    }
    const options = Array.isArray(change.options) ?
      change.options : original.options;
    const answer = Object.prototype.hasOwnProperty.call(change, "answerIndex") ?
      Number(change.answerIndex) : original.correctIndex;
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new Error(`${bootcamp}: invalid corrected answer for ${id}`);
    }
    if (change.imageSources !== undefined) {
      if (!Array.isArray(change.imageSources)) {
        throw new Error(`${bootcamp}: corrected imageSources must be an ` +
          `array for ${id}`);
      }
      change.imageSources.forEach((asset) => {
        if (!fs.existsSync(sourceAsset(bootcamp, asset))) {
          throw new Error(`${bootcamp}: missing corrected asset ${asset} ` +
            `for ${id}`);
        }
      });
    }
  });
}

function assertActCounts(questions) {
  const expected = {
    Mathematics: [45, 45, 45, 45, 45, 45, 45, 45, 10],
    Science: [40, 40, 40, 40, 8],
    English: [50, 50],
  };
  Object.entries(expected).forEach(([subject, counts]) => {
    const actual = counts.map((_, index) => questions.filter((question) =>
      question.subject === subject && question.practiceYear === index + 1,
    ).length);
    if (JSON.stringify(actual) !== JSON.stringify(counts)) {
      throw new Error(
          `act: ${subject} expected ${counts.join(",")}; got ` +
          actual.join(","),
      );
    }
  });
  if (questions.some((question) => question.subject === "Reading")) {
    throw new Error("act: Reading must remain omitted until questions exist");
  }
}

function indexQuestion(question) {
  return {
    id: question.id,
    legacyId: question.legacyId,
    sourceId: question.sourceId,
    subject: question.subject,
    module: question.module,
    practiceTest: question.practiceYear,
    stimulusKey: sha256Text(questionStimulusKey(question)).slice(0, 24),
    imageSources: question.imageSources,
    disabled: Boolean(question.disabled),
  };
}

function packQuestion(question) {
  return {
    id: question.id,
    legacyId: question.legacyId,
    sourceId: question.sourceId,
    subject: question.subject,
    module: question.module,
    practiceTest: question.practiceYear,
    prompt: question.prompt,
    options: question.options,
    answerIndex: question.correctIndex,
    explanation: question.explanation,
    passage: question.passage,
    imageSources: question.imageSources,
    disabled: Boolean(question.disabled),
  };
}

function writePackageDirectory(root, bootcamp, questions, descriptor) {
  const canonicalCatalog = buildCatalog(bootcamp);
  const subjects = new Map();
  questions.forEach((question) => {
    if (!subjects.has(question.subject)) {
      subjects.set(question.subject, {
        modules: new Set(),
        practiceYears: new Set(),
        questionCount: 0,
      });
    }
    const subject = subjects.get(question.subject);
    subject.modules.add(question.module);
    subject.practiceYears.add(question.practiceYear);
    subject.questionCount += 1;
  });
  const catalogSubjects = canonicalCatalog.subjects
      .filter((subject) => subjects.has(subject.name))
      .map((subject) => {
        const available = subjects.get(subject.name);
        return {
          name: subject.name,
          modules: subject.modules.filter((module) =>
            available.modules.has(module)),
          practiceYears: [...available.practiceYears]
              .sort((left, right) => left - right),
          questionCount: available.questionCount,
        };
      });
  const index = questions.map(indexQuestion);
  const assets = [...new Set(questions.flatMap((question) =>
    question.imageSources))].sort();
  const chunks = [];
  const grouped = new Map();
  questions.forEach((question) => {
    const key = `${question.subject}\u0000${question.practiceYear}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(packQuestion(question));
  });
  [...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right)).forEach(([key, rows]) => {
    const [subject, practiceTest] = key.split("\u0000");
    const relative = `questions/${slug(subject)}/${practiceTest}.json`;
    writeJson(path.join(root, relative), rows);
    chunks.push({
      subject,
      practiceTest: Number(practiceTest),
      path: relative,
      questionCount: rows.length,
      sha256: sha256File(path.join(root, relative)),
    });
  });
  assets.forEach((relative) => {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(sourceAsset(bootcamp, relative), destination);
  });
  writeJson(path.join(root, "index.json"), index);
  const manifest = {
    schemaVersion: descriptor.schemaVersion,
    bootcamp,
    datasetVersion: descriptor.datasetVersion,
    correctionRevision: descriptor.correctionRevision,
    generatedAt: "2026-07-01T00:00:00.000Z",
    freePracticeTests: [...descriptor.freePracticeTests],
    questionCount: questions.length,
    assetCount: assets.length,
    catalog: catalogSubjects,
    chunks,
    files: {
      index: {
        path: "index.json",
        sha256: sha256File(path.join(root, "index.json")),
      },
      assets: assets.map((relative) => ({
        path: relative,
        sha256: sha256File(path.join(root, relative)),
      })),
    },
  };
  writeJson(path.join(root, "manifest.json"), manifest);
  return manifest;
}

function archiveDirectory(source, destination) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver("zip", {zlib: {level: 9}});
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    const files = [];
    const walk = (dir) => fs.readdirSync(dir, {withFileTypes: true})
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((entry) => {
          const absolute = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(absolute);
          else files.push(absolute);
        });
    walk(source);
    // Append already-read buffers. archive.file() performs asynchronous stat
    // calls whose completion order can vary, changing otherwise identical ZIP
    // bytes and hashes between builds.
    files.forEach((filename) => archive.append(fs.readFileSync(filename), {
      name: path.relative(source, filename).replace(/\\/g, "/"),
      date: FIXED_ZIP_DATE,
      mode: 0o100644,
    }));
    archive.finalize();
  });
}

async function buildBootcamp(bootcamp) {
  const descriptor = CONTENT_VERSIONS[bootcamp];
  const questions = normalizedQuestions(bootcamp, false);
  validateQuestions(bootcamp, questions);
  validateCorrections(bootcamp, questions, descriptor);
  if (bootcamp === "act") assertActCounts(questions);

  const versionRoot = path.join(
      OUTPUT_ROOT, bootcamp, descriptor.datasetVersion,
  );
  const stagingRoot = path.join(versionRoot, "staging");
  fs.rmSync(versionRoot, {recursive: true, force: true});
  fs.rmSync(path.join(FREE_ROOT, bootcamp), {recursive: true, force: true});
  const manifest = writePackageDirectory(
      stagingRoot, bootcamp, questions, descriptor,
  );
  const correction = {
    schemaVersion: descriptor.schemaVersion,
    bootcamp,
    datasetVersion: descriptor.datasetVersion,
    revision: descriptor.correctionRevision,
    cumulative: true,
    changes: correctionsFor(bootcamp),
  };
  writeJson(
      path.join(stagingRoot, "corrections", "0.json"), correction,
  );
  const zipPath = path.join(versionRoot, "base", "pack.zip");
  await archiveDirectory(stagingRoot, zipPath);

  const correctionPath = path.join(
      versionRoot, "corrections", `${descriptor.correctionRevision}.json`,
  );
  writeJson(correctionPath, correction);

  const freeQuestions = questions.filter((question) =>
    descriptor.freePracticeTests.includes(question.practiceYear));
  writePackageDirectory(
      path.join(FREE_ROOT, bootcamp), bootcamp, freeQuestions, descriptor,
  );
  writeJson(
      path.join(FREE_ROOT, bootcamp, "corrections", "0.json"), correction,
  );
  return {
    activeVersion: descriptor.datasetVersion,
    schemaVersion: descriptor.schemaVersion,
    latestCorrectionRevision: descriptor.correctionRevision,
    questionCount: manifest.questionCount,
    base: {
      objectPath: `content-packs/${bootcamp}/${descriptor.datasetVersion}/` +
        "base/pack.zip",
      sizeBytes: fs.statSync(zipPath).size,
      sha256: sha256File(zipPath),
    },
    correction: {
      objectPath: `content-packs/${bootcamp}/${descriptor.datasetVersion}/` +
        `corrections/${descriptor.correctionRevision}.json`,
      sizeBytes: fs.statSync(correctionPath).size,
      sha256: sha256File(correctionPath),
    },
  };
}

async function main() {
  const registry = {};
  for (const bootcamp of Object.keys(CONTENT_VERSIONS).sort()) {
    registry[bootcamp] = await buildBootcamp(bootcamp);
  }
  writeJson(path.join(OUTPUT_ROOT, "registry.candidate.json"), registry);
  process.stdout.write(
      `Built ${Object.keys(registry).length} content packs in ${OUTPUT_ROOT}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
