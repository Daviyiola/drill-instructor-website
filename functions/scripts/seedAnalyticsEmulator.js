"use strict";
/* eslint-disable require-jsdoc, max-len */

const {initializeApp} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {personas} = require("../test/fixtures/analyticsPersonas");

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error("This script is restricted to the Firebase RTDB emulator");
}

initializeApp({projectId: process.env.GCLOUD_PROJECT || "demo-drill-instructor"});

async function run() {
  const updates = {};
  Object.entries(personas).forEach(([persona, attempts]) => {
    attempts.forEach((attempt, index) => {
      const studentId = `synthetic_${persona}`;
      const attemptId = `${persona}_${index + 1}`;
      updates[`users/${studentId}/statsIndex/${attemptId}`] = {
        ...attempt,
        attemptId,
        studentId,
      };
    });
  });
  await getDatabase().ref().update(updates);
  console.log(`Seeded ${Object.keys(personas).length} synthetic personas`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
