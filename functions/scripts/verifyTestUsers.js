"use strict";
/* eslint-disable require-jsdoc */

const {applicationDefault, initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const accounts = require("./testVerifiedUsers.config");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function cleanEntry(value) {
  if (typeof value === "string") return {email: value.trim()};
  if (!value || typeof value !== "object") return {};
  return {
    email: String(value.email || "").trim(),
    uid: String(value.uid || "").trim(),
  };
}

async function run() {
  const projectId = argument("--project");
  const apply = process.argv.includes("--apply");

  if (!projectId) {
    throw new Error("Pass an explicit Firebase project with --project");
  }
  if (!Array.isArray(accounts) || !accounts.length) {
    throw new Error(
        "The test-user allowlist is empty. Edit " +
        "scripts/testVerifiedUsers.config.js first.",
    );
  }

  initializeApp({credential: applicationDefault(), projectId});
  const auth = getAuth();
  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${projectId}`);
  for (const raw of accounts) {
    const entry = cleanEntry(raw);
    const label = entry.email || entry.uid || "invalid entry";
    try {
      if (!entry.email && !entry.uid) throw new Error("email or uid required");
      const user = entry.uid ?
        await auth.getUser(entry.uid) :
        await auth.getUserByEmail(entry.email);

      if (user.emailVerified) {
        unchanged += 1;
        console.log(`ALREADY VERIFIED  ${user.email || user.uid}`);
        continue;
      }
      if (!apply) {
        changed += 1;
        console.log(`WOULD VERIFY      ${user.email || user.uid}`);
        continue;
      }

      await auth.updateUser(user.uid, {emailVerified: true});
      changed += 1;
      console.log(`VERIFIED          ${user.email || user.uid}`);
    } catch (error) {
      failed += 1;
      console.error(`FAILED            ${label}: ${error.message}`);
    }
  }

  console.log(
      `Finished: ${changed} ${apply ? "verified" : "would verify"}, ` +
      `${unchanged} already verified, ${failed} failed.`,
  );
  if (failed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
