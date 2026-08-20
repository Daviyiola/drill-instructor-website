#!/usr/bin/env node
"use strict";
/* eslint-disable require-jsdoc */

const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");
const {CONTENT_VERSIONS} = require("../data/contentVersions");

const FUNCTIONS_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_ROOT = path.resolve(FUNCTIONS_ROOT, "..");
const SUPPORTED_NATIVE_SCHEMA = 2;
const DEPLOY_BATCHES = [
  [
    "getStudentDrillCatalogHttps",
    "createStudentDrillHttps",
    "submitStudentDrillHttps",
  ],
  [
    "setStudentBookmarkHttps",
    "getStudentBookmarksHttps",
    "getStudentContentPackHttps",
    "submitOfflineStudentDrillHttps",
  ],
  [
    "createStudentChallengeSessionHttps",
    "createStudentAssignmentSessionHttps",
  ],
  [
    "getEducatorQuestionBankHttps",
    "buildEducatorDrillBlueprintHttps",
    "getEducatorBookmarksHttps",
    "setEducatorBookmarkHttps",
  ],
];

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function fail(message) {
  process.stderr.write(`\nCONTENT RELEASE STOPPED: ${message}\n`);
  process.exit(1);
}

function phase(label) {
  process.stdout.write(`\n=== ${label} ===\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: FUNCTIONS_ROOT,
    stdio: options.capture ? ["inherit", "pipe", "inherit"] : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    env: options.env || process.env,
    shell: process.platform === "win32" && /\.cmd$/i.test(command),
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status}`);
  }
  return options.capture ? String(result.stdout || "") : "";
}

function firebaseCommand() {
  const executable = process.platform === "win32" ? "firebase.cmd" :
    "firebase";
  const local = path.join(
      REPOSITORY_ROOT, "node_modules", ".bin", executable,
  );
  return fs.existsSync(local) ? local : executable;
}

function firebaseEnvironment() {
  return {
    ...process.env,
    // An inherited DEBUG value makes Firebase CLI mix diagnostic lines into
    // captured command output, which prevents registry JSON from parsing.
    DEBUG: "",
    FIREBASE_CLI_DISABLE_UPDATE_CHECK: "1",
    // Firebase defaults to ten seconds, which is too short for this
    // codebase's complete exported Function manifest on some machines.
    FUNCTIONS_DISCOVERY_TIMEOUT:
      process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "60",
  };
}

function validateInputs() {
  const bootcamp = argument("bootcamp").toLowerCase();
  const project = argument("project");
  if (bootcamp !== "all" && !CONTENT_VERSIONS[bootcamp]) {
    fail("Pass --bootcamp act, --bootcamp sat, or --bootcamp all");
  }
  if (!/^[a-z0-9][a-z0-9-]{4,62}$/.test(project)) {
    fail("Pass a valid Firebase project with --project");
  }
  const bootcamps = bootcamp === "all" ? ["act", "sat"] : [bootcamp];
  bootcamps.forEach((name) => {
    const descriptor = CONTENT_VERSIONS[name];
    if (Number(descriptor.schemaVersion) !== SUPPORTED_NATIVE_SCHEMA) {
      fail(
          `${name.toUpperCase()} schemaVersion is ` +
          `${descriptor.schemaVersion}; the native client currently supports ` +
          `schema ${SUPPORTED_NATIVE_SCHEMA}.`,
      );
    }
    if (!/^\d{4}\.\d{2}\.\d+$/.test(descriptor.datasetVersion)) {
      fail(`${name.toUpperCase()} has an invalid datasetVersion`);
    }
  });
  return {bootcamps, project};
}

function main() {
  const {bootcamps, project} = validateInputs();
  const firebase = firebaseCommand();
  const releaseLabel = bootcamps.map((bootcamp) => {
    const descriptor = CONTENT_VERSIONS[bootcamp];
    return `${bootcamp.toUpperCase()} ${descriptor.datasetVersion} ` +
      `(correction ${descriptor.correctionRevision})`;
  }).join(" and ");
  phase(`Releasing ${releaseLabel}`);

  phase("1/4 Build and validate content artifacts");
  run(process.execPath, [path.join(__dirname, "buildContentPacks.js")]);

  bootcamps.forEach((bootcamp, index) => {
    phase(`2/4 Publish and activate ${bootcamp.toUpperCase()} ` +
      `(${index + 1}/${bootcamps.length})`);
    run(process.execPath, [
      path.join(__dirname, "publishContentPacks.js"),
      "--project", project,
      "--bootcamp", bootcamp,
    ]);
  });

  for (let index = 0; index < DEPLOY_BATCHES.length; index += 1) {
    const functions = DEPLOY_BATCHES[index];
    phase(`3/4 Deploy Functions batch ${index + 1}/${DEPLOY_BATCHES.length}`);
    run(firebase, [
      "deploy",
      "--only",
      functions.map((name) => `functions:${name}`).join(","),
      "--project",
      project,
    ], {
      env: firebaseEnvironment(),
    });
  }

  bootcamps.forEach((bootcamp) => {
    const descriptor = CONTENT_VERSIONS[bootcamp];
    phase(`4/4 Verify the active ${bootcamp.toUpperCase()} content registry`);
    const rawRegistry = run(firebase, [
      "database:get",
      `/contentPackRegistry/${bootcamp}`,
      "--project",
      project,
    ], {capture: true, env: firebaseEnvironment()});
    let registry;
    try {
      registry = JSON.parse(rawRegistry);
    } catch (error) {
      fail(`Firebase returned an unreadable ${bootcamp.toUpperCase()} ` +
        `registry response: ${error.message}`);
    }
    if (!registry || registry.activeVersion !== descriptor.datasetVersion ||
        Number(registry.schemaVersion) !== Number(descriptor.schemaVersion) ||
        Number(registry.latestCorrectionRevision || 0) !==
          Number(descriptor.correctionRevision || 0)) {
      fail(`The live ${bootcamp.toUpperCase()} content registry does not ` +
        "match the requested release");
    }
  });

  process.stdout.write(`\nReleased ${releaseLabel} successfully.\n`);
}

main();
