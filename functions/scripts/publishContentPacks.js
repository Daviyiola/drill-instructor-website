#!/usr/bin/env node
"use strict";
/* eslint-disable require-jsdoc */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  applicationDefault,
  deleteApp,
  initializeApp,
} = require("firebase-admin/app");
const {getDatabase} = require("firebase-admin/database");
const {getStorage} = require("firebase-admin/storage");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const OUTPUT_ROOT = path.join(REPOSITORY_ROOT, ".content-packs");

function localPathForObject(objectPath) {
  const parts = objectPath.split("/");
  if (parts[0] !== "content-packs" || parts.length < 5) {
    throw new Error(`Unexpected content object path: ${objectPath}`);
  }
  const bootcamp = parts[1];
  const version = parts[2];
  return path.join(OUTPUT_ROOT, bootcamp, version, ...parts.slice(3));
}

async function uploadImmutable(bucket, objectPath, expectedSha256) {
  const filename = localPathForObject(objectPath);
  if (!fs.existsSync(filename)) {
    throw new Error(`Build artifact is missing: ${filename}`);
  }
  const localSha256 = crypto.createHash("sha256")
      .update(fs.readFileSync(filename)).digest("hex");
  if (localSha256 !== expectedSha256) {
    throw new Error(`Artifact hash does not match registry: ${objectPath}`);
  }
  const remoteFile = bucket.file(objectPath);
  const [exists] = await remoteFile.exists();
  if (exists) {
    const [metadata] = await remoteFile.getMetadata();
    const remoteSha256 = metadata && metadata.metadata &&
      metadata.metadata.sha256;
    if (remoteSha256 !== localSha256) {
      throw new Error(
          `Immutable object already exists with different bytes: ${objectPath}`,
      );
    }
    process.stdout.write(`Verified existing ${objectPath}\n`);
    return;
  }
  await bucket.upload(filename, {
    destination: objectPath,
    resumable: false,
    validation: "crc32c",
    preconditionOpts: {ifGenerationMatch: 0},
    metadata: {
      cacheControl: "private, max-age=31536000, immutable",
      contentType: objectPath.endsWith(".zip") ?
        "application/zip" : "application/json; charset=utf-8",
      metadata: {sha256: localSha256},
    },
  });
}

async function main() {
  const projectFlag = process.argv.indexOf("--project");
  const projectId = (projectFlag >= 0 ? process.argv[projectFlag + 1] :
    process.argv[2]) || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error(
        "Pass the Firebase project id: npm run content:publish -- <project>",
    );
  }
  const databaseURL = process.env.FIREBASE_DATABASE_URL ||
    `https://${projectId}-default-rtdb.firebaseio.com`;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET ||
    `${projectId}.firebasestorage.app`;
  const app = initializeApp({
    credential: applicationDefault(),
    projectId,
    databaseURL,
    storageBucket,
  });
  try {
    const registryFilename = path.join(
        OUTPUT_ROOT, "registry.candidate.json",
    );
    const registry = JSON.parse(fs.readFileSync(registryFilename, "utf8"));
    const bootcampFlag = process.argv.indexOf("--bootcamp");
    const requestedBootcamp = bootcampFlag >= 0 ?
      String(process.argv[bootcampFlag + 1] || "").trim().toLowerCase() : "";
    if (bootcampFlag >= 0 && !requestedBootcamp) {
      throw new Error("Pass a bootcamp after --bootcamp (for example, act)");
    }
    if (requestedBootcamp && !registry[requestedBootcamp]) {
      throw new Error(
          `The candidate registry does not contain ${requestedBootcamp}`,
      );
    }
    const selectedRegistry = requestedBootcamp ?
      {[requestedBootcamp]: registry[requestedBootcamp]} : registry;
    const bucket = getStorage().bucket();

    // Upload and CRC-validate every immutable object before exposing any new
    // active pointer to clients.
    for (const descriptor of Object.values(selectedRegistry)) {
      await uploadImmutable(
          bucket, descriptor.base.objectPath, descriptor.base.sha256,
      );
      await uploadImmutable(
          bucket, descriptor.correction.objectPath,
          descriptor.correction.sha256,
      );
    }
    const updates = {};
    for (const [bootcamp, descriptor] of Object.entries(selectedRegistry)) {
      updates[`contentPackRegistry/${bootcamp}`] = descriptor;
    }
    await getDatabase().ref().update(updates);
    process.stdout.write(
        `Published and activated ${Object.keys(selectedRegistry).join(", ")}\n`,
    );
  } finally {
    // RTDB keeps a live socket open. Dispose the Admin app so the publisher
    // terminates when invoked by the automated release runner.
    await deleteApp(app);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
