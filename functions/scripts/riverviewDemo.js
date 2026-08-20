#!/usr/bin/env node
/* eslint-disable max-len, require-jsdoc, no-console, brace-style, block-spacing */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");
const {applicationDefault, deleteApp, getApps, initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {
  EDUCATORS,
  EXPECTED_DATASET_VERSION,
  PERSONAS,
  SCHOOL_ID,
  SEED_ID,
  generateScenario,
  validateScenario,
} = require("./riverviewDemoScenario");
const {gradeSession} = require("../handlers/_studentDrill");

const ROOT = path.resolve(__dirname, "../..");
const PRIVATE_DIR = path.join(ROOT, ".demo-seed");
const CREDENTIAL_PATH = path.join(PRIVATE_DIR, "riverview-v1-credentials.json");
const REPORT_PATH = path.join(PRIVATE_DIR, "riverview-v1-report.json");
const APPLY_TOKEN = "RIVERVIEW_DEMO_V1";
const REMOVE_TOKEN = "REMOVE_RIVERVIEW_DEMO_V1";

function argsFrom(argv) {
  const args = {mode: "dry-run", apply: false, reanchor: false};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--apply") args.apply = true;
    else if (value === "--reanchor") args.reanchor = true;
    else if (value.startsWith("--")) {
      const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[key] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function ensurePrivateDir() {
  fs.mkdirSync(PRIVATE_DIR, {recursive: true});
}

function writePrivateJson(filePath, value) {
  ensurePrivateDir();
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {encoding: "utf8", mode: 0o600});
}

function demoPassword() {
  const value = String(process.env.RIVERVIEW_DEMO_PASSWORD || "");
  if (value.length < 6) {
    throw new Error("Set RIVERVIEW_DEMO_PASSWORD to a password of at least six characters before seeding");
  }
  return value;
}

function authAccounts() {
  return [
    ...EDUCATORS.map((row) => ({uid: row.uid, customId: row.id, role: "educator", email: row.email, displayName: `${row.firstName} ${row.lastName}`})),
    ...PERSONAS.filter((row) => row.auth).map((row) => ({uid: `auth_demo_riverview_student_${String(row.index).padStart(2, "0")}`, customId: row.id, role: "student", email: row.email, displayName: `${row.firstName} ${row.lastName}`})),
  ];
}

function loadCredentials() {
  if (!fs.existsSync(CREDENTIAL_PATH)) return null;
  return JSON.parse(fs.readFileSync(CREDENTIAL_PATH, "utf8"));
}

function createCredentials(anchor, password) {
  const existing = loadCredentials();
  const credentials = {
    seedId: SEED_ID,
    createdAt: existing && existing.createdAt || new Date().toISOString(),
    anchor,
    accounts: authAccounts().map((account) => ({...account, password})),
  };
  writePrivateJson(CREDENTIAL_PATH, credentials);
  return credentials;
}

function initAdmin(project) {
  if (!project) throw new Error("--project is required for seed, validate, and remove modes");
  if (getApps().length) return {db: getDatabase(), auth: getAuth()};
  const emulator = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
  const databaseURL = `https://${project}-default-rtdb.firebaseio.com`;
  initializeApp(emulator ? {projectId: project, databaseURL} : {credential: applicationDefault(), projectId: project, databaseURL});
  return {db: getDatabase(), auth: getAuth()};
}

async function activeRegistry(db) {
  return (await db.ref("contentPackRegistry/act").once("value")).val() || {};
}

async function requireVersionParity(db) {
  const registry = await activeRegistry(db);
  const activeVersion = String(registry.activeVersion || registry.datasetVersion || "");
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST && activeVersion !== EXPECTED_DATASET_VERSION) {
    throw new Error(`Production ACT registry is ${activeVersion || "missing"}; expected ${EXPECTED_DATASET_VERSION}. No data was changed.`);
  }
  return registry;
}

async function existingManifest(db) {
  return (await db.ref(`demoSeeds/${SEED_ID}`).once("value")).val();
}

function secretFromGcloud(project) {
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    const value = process.env.DEMO_LICENSE_SALT;
    if (!value) throw new Error("Set DEMO_LICENSE_SALT when seeding the emulator");
    return value;
  }
  if (!/^[a-z0-9-]+$/.test(project)) throw new Error("Invalid Google Cloud project ID");
  const executable = process.platform === "win32" ? process.env.ComSpec : "gcloud";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", `gcloud.cmd secrets versions access latest --secret LICENSE_SALT --project ${project}`] : ["secrets", "versions", "access", "latest", "--secret", "LICENSE_SALT", "--project", project];
  const child = spawnSync(executable, commandArgs, {encoding: "utf8", windowsHide: true});
  if (child.status !== 0) throw new Error("Unable to read LICENSE_SALT from Secret Manager. Authenticate gcloud and retry.");
  const value = String(child.stdout || "").trim();
  if (!value) throw new Error("LICENSE_SALT was empty");
  return value;
}

function addDemoLicenses(scenario, secret) {
  const activationDate = scenario.anchor;
  const expirationDate = new Date(Date.parse(activationDate) + (365 * 86400000)).toISOString();
  PERSONAS.filter((persona) => persona.auth).forEach((persona) => {
    const planType = "annual";
    const payload = `${planType}|act|${activationDate}|${expirationDate}|${persona.id}`;
    const licenseHash = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    scenario.data[`users/${persona.id}`].testdata = {act: {license: {planType, bootcamp: "act", activationDate, expirationDate, licenseHash, source: "demo_seed", updatedAt: scenario.anchor}}};
  });
}

async function assertPathsSafe(db, scenario, manifest) {
  const owned = new Set((manifest && manifest.ownedPaths) || []);
  for (const target of Object.keys(scenario.data)) {
    const current = (await db.ref(target).once("value")).val();
    if (current === null || current === undefined) continue;
    if (!owned.has(target)) throw new Error(`Refusing to overwrite unowned RTDB path: ${target}`);
  }
}

async function assertAuthSafe(auth, manifest) {
  const owned = new Set((manifest && manifest.authUids) || []);
  for (const account of authAccounts()) {
    try {
      const user = await auth.getUser(account.uid);
      if (!owned.has(account.uid) || user.customClaims.demoSeedId !== SEED_ID) throw new Error(`Refusing to overwrite unowned Auth account: ${account.uid}`);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
  }
}

async function saveBackup(db, scenario, project) {
  const backupPath = path.join(PRIVATE_DIR, `riverview-v1-${project}-preseed-backup.json`);
  if (fs.existsSync(backupPath)) return;
  const values = {};
  for (const target of Object.keys(scenario.data)) values[target] = (await db.ref(target).once("value")).val();
  writePrivateJson(backupPath, {seedId: SEED_ID, project, createdAt: new Date().toISOString(), values});
}

async function ensureAuth(auth, credentials) {
  for (const account of credentials.accounts) {
    try {
      const existing = await auth.getUser(account.uid);
      if (existing.customClaims.demoSeedId !== SEED_ID) throw new Error(`Auth UID ${account.uid} is not owned by this seed`);
      await auth.updateUser(account.uid, {email: account.email, password: account.password, displayName: account.displayName, emailVerified: true, disabled: false});
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
      await auth.createUser({uid: account.uid, email: account.email, password: account.password, displayName: account.displayName, emailVerified: true, disabled: false});
    }
    await auth.setCustomUserClaims(account.uid, {demoSeedId: SEED_ID, role: account.role, customUserId: account.customId});
  }
}

async function writeBounded(db, scenario) {
  const entries = Object.entries(scenario.data);
  let changed = 0;
  let skipped = 0;
  for (let index = 0; index < entries.length; index++) {
    const [target, value] = entries[index];
    const current = (await db.ref(target).once("value")).val();
    if (stableJson(current) === stableJson(value)) {
      skipped += 1;
      continue;
    }
    await db.ref(target).set(value);
    changed += 1;
    if (changed % 10 === 0) console.log(`Updated ${changed} changed RTDB roots`);
  }
  console.log(`RTDB write complete: ${changed} changed, ${skipped} already current.`);
}

function stableJson(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize(input[key])]));
  };
  return JSON.stringify(normalize(value));
}

function manifestFor(scenario, status = "complete") {
  return {
    seedId: SEED_ID,
    scenarioVersion: 1,
    status,
    anchor: scenario.anchor,
    datasetVersion: scenario.datasetVersion,
    correctionRevision: scenario.correctionRevision,
    schoolId: SCHOOL_ID,
    ownedPaths: Object.keys(scenario.data).sort(),
    authUids: authAccounts().map((account) => account.uid),
    updatedAt: new Date().toISOString(),
  };
}

function printReport(report) {
  console.log(`Riverview demo dry run: ${report.counts.students} students, ${report.counts.educators} educators, ${report.counts.sessions} completed sessions.`);
  console.log(`Group accuracy: ${report.group.accuracy}%. Reading inference at 60%: ${report.group.readingInferenceAt60.meeting} meeting, ${report.group.readingInferenceAt60.below} below, ${report.group.readingInferenceAt60.noData} no data.`);
  console.table(report.students.map((student) => ({student: student.name, sessions: student.sessions, questions: student.attempted, accuracy: student.accuracy, inference: student.readingInference.accuracy, points: student.points})));
}

async function seed(args) {
  if (!args.apply || args.confirm !== APPLY_TOKEN) throw new Error(`Production/emulator seed requires --apply --confirm ${APPLY_TOKEN}`);
  const {db, auth} = initAdmin(args.project);
  await requireVersionParity(db);
  const currentManifest = await existingManifest(db);
  if (currentManifest && currentManifest.seedId !== SEED_ID) throw new Error("Existing demo manifest is not owned by this scenario");
  const anchor = currentManifest && !args.reanchor ? currentManifest.anchor : new Date().toISOString();
  const scenario = generateScenario({anchor});
  const validation = validateScenario(scenario);
  if (!validation.ok) throw new Error(`Scenario validation failed:\n${validation.errors.join("\n")}`);
  await assertPathsSafe(db, scenario, currentManifest);
  await assertAuthSafe(auth, currentManifest);
  await saveBackup(db, scenario, args.project);
  const credentials = createCredentials(scenario.anchor, demoPassword());
  addDemoLicenses(scenario, secretFromGcloud(args.project));
  await db.ref(`demoSeeds/${SEED_ID}`).set(manifestFor(scenario, "provisioning"));
  await ensureAuth(auth, credentials);
  await writeBounded(db, scenario);
  await db.ref(`demoSeeds/${SEED_ID}`).set({...manifestFor(scenario), createdAt: currentManifest && currentManifest.createdAt || new Date().toISOString()});
  writePrivateJson(REPORT_PATH, scenario.report);
  printReport(scenario.report);
  console.log(`Seed complete. Credentials were saved to ${path.relative(ROOT, CREDENTIAL_PATH)} and were not printed.`);
}

function comparableSummary(value) {
  const summary = value || {};
  return {totalQ: Number(summary.totalQ || 0), attempted: Number(summary.attempted || 0), correct: Number(summary.correct || 0), wrong: Number(summary.wrong || 0), unanswered: Number(summary.unanswered || 0), points: Number(summary.points || 0), usedSec: Number(summary.usedSec || 0)};
}

async function validateProduction(args) {
  const {db, auth} = initAdmin(args.project);
  await requireVersionParity(db);
  const manifest = await existingManifest(db);
  if (!manifest || manifest.status !== "complete") throw new Error("Riverview seed manifest is missing or incomplete");
  const errors = [];
  const students = [];
  for (const persona of PERSONAS) {
    const user = (await db.ref(`users/${persona.id}`).once("value")).val();
    const sessions = (await db.ref(`studentDrills/${persona.id}`).once("value")).val() || {};
    if (!user || user.demoSeedId !== SEED_ID) { errors.push(`Missing/foreign student ${persona.id}`); continue; }
    if (user.corpsName !== "United States" || user.battalionName !== "Tennessee" || user.platoonName !== "Riverview High School") errors.push(`Student school aliases invalid: ${persona.id}`);
    const attempts = Object.values(user.statsIndex || {});
    let attempted = 0; let correct = 0; let inferenceAttempted = 0; let inferenceCorrect = 0;
    attempts.forEach((attempt) => {
      const scoreVisible = attempt.source !== "assignment" || attempt.release && (attempt.release.scorePolicy === "immediate" || attempt.release.scoreReleasedAt);
      if (scoreVisible) { attempted += Number(attempt.activity && attempt.activity.attempted || 0); correct += Number(attempt.performance && attempt.performance.correct || 0); }
      if (scoreVisible) (attempt.modules || []).filter((row) => row.subject === "Reading" && row.module === "Inference and Implication").forEach((row) => { inferenceAttempted += Number(row.attempted || 0); inferenceCorrect += Number(row.correct || 0); });
    });
    Object.values(sessions).filter((session) => session.status === "submitted").forEach((session) => {
      const regraded = gradeSession(session, session.answers, session.timers, Date.parse(session.result.createdAt));
      if (JSON.stringify(comparableSummary(regraded.summary)) !== JSON.stringify(comparableSummary(session.result.summary))) errors.push(`Grading mismatch: ${session.sessionId}`);
      const stat = user.stats && user.stats[session.sessionId];
      if (!stat || stat.resultPath !== `studentDrills/${persona.id}/${session.sessionId}/result`) errors.push(`Test Record mismatch: ${session.sessionId}`);
    });
    students.push({id: persona.id, name: `${persona.firstName} ${persona.lastName}`, sessions: attempts.length, attempted, accuracy: attempted ? Math.round((correct / attempted) * 1000) / 10 : null, inferenceAttempted, inferenceAccuracy: inferenceAttempted ? Math.round((inferenceCorrect / inferenceAttempted) * 1000) / 10 : null});
  }
  const school = (await db.ref(`schools/${SCHOOL_ID}`).once("value")).val();
  if (!school || school.demoSeedId !== SEED_ID) errors.push("Demo school is missing or foreign");
  if (Object.keys(school && school.groups && school.groups.admin && school.groups.admin.demo_squad && school.groups.admin.demo_squad.members || {}).length !== 14) errors.push("Demo Squad does not contain 14 students");
  const unitMembers = (await db.ref("units/corps/United States/Tennessee/Riverview High School/members").once("value")).val() || {};
  if (Object.keys(unitMembers).length !== 14 || Object.values(unitMembers).some((value) => value !== true)) errors.push("School unit membership is not a 14-member true map");
  for (const educator of EDUCATORS) {
    const profile = (await db.ref(`educators/${educator.id}`).once("value")).val() || {};
    const row = school && school.educators && school.educators[educator.id] || {};
    if (profile.schoolID !== SCHOOL_ID || profile.schoolId !== SCHOOL_ID) errors.push(`Educator school aliases invalid: ${educator.id}`);
    if (row.status !== "approved" || !row.access || row.access.bootcamps.act !== true || !row.access.subjectsByBootcamp || !row.access.subjectsByBootcamp.act) errors.push(`Educator workspace access invalid: ${educator.id}`);
  }
  for (const account of authAccounts()) {
    try { const user = await auth.getUser(account.uid); if (!user.emailVerified || user.customClaims.demoSeedId !== SEED_ID) errors.push(`Auth account invalid: ${account.uid}`); } catch (_) { errors.push(`Auth account missing: ${account.uid}`); }
  }
  const threshold = students.reduce((value, row) => { if (!row.inferenceAttempted) value.noData++; else if (row.inferenceAccuracy >= 60) value.meeting++; else value.below++; return value; }, {meeting: 0, below: 0, noData: 0});
  if (threshold.meeting !== 10 || threshold.below !== 3 || threshold.noData !== 1) errors.push(`Production inference threshold mismatch: ${JSON.stringify(threshold)}`);
  const report = {validatedAt: new Date().toISOString(), project: args.project, seedId: SEED_ID, students, threshold, errors};
  writePrivateJson(REPORT_PATH, report);
  if (errors.length) throw new Error(`Production validation failed:\n${errors.join("\n")}`);
  console.log(`Validation passed: 14 students; inference threshold ${threshold.meeting}/${threshold.below}/${threshold.noData}.`);
}

async function remove(args) {
  if (!args.apply || args.confirm !== REMOVE_TOKEN) throw new Error(`Removal requires --apply --confirm ${REMOVE_TOKEN}`);
  const {db, auth} = initAdmin(args.project);
  const manifest = await existingManifest(db);
  if (!manifest || manifest.seedId !== SEED_ID) throw new Error("Owned Riverview manifest was not found; refusing cleanup");
  for (const target of manifest.ownedPaths || []) await db.ref(target).remove();
  for (const uid of manifest.authUids || []) {
    try { const user = await auth.getUser(uid); if (user.customClaims.demoSeedId !== SEED_ID) throw new Error(`Refusing to delete unowned Auth account ${uid}`); await auth.deleteUser(uid); } catch (error) { if (error.code !== "auth/user-not-found") throw error; }
  }
  await db.ref(`demoSeeds/${SEED_ID}`).remove();
  console.log("Removed only paths and Auth UIDs owned by riverview-v1. Local credentials/backups were retained.");
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  if (args.mode === "dry-run") {
    const scenario = generateScenario({anchor: args.anchor || new Date().toISOString()});
    const validation = validateScenario(scenario);
    writePrivateJson(REPORT_PATH, {...scenario.report, validation});
    printReport(scenario.report);
    if (!validation.ok) throw new Error(validation.errors.join("\n"));
    console.log(`Dry-run report saved to ${path.relative(ROOT, REPORT_PATH)}.`);
  } else if (args.mode === "seed") await seed(args);
  else if (args.mode === "validate") await validateProduction(args);
  else if (args.mode === "remove") await remove(args);
  else throw new Error("--mode must be dry-run, seed, validate, or remove");
}

main().catch((error) => {
  console.error(`RIVERVIEW DEMO FAILED: ${error.message}`);
  if (process.env.DEMO_DEBUG === "1") console.error(error.stack);
  process.exitCode = 1;
}).finally(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
});
