// @ts-check
"use strict";
/* eslint-disable max-len */

const {getDatabase} = require("firebase-admin/database");
const {requireVerifiedBearerUid, allowCors} = require("./_auth");

/**
 * @typedef {import("express").Request} Request
 * @typedef {import("express").Response} Response
 * @typedef {import("firebase-admin").database.Database} Database
 */

/**
 * Send a JSON error response.
 *
 * @param {Response} res Express response
 * @param {number} code HTTP status code
 * @param {string} msg Error message
 * @param {*} [details] Optional details payload
 * @return {Response} Express response
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details: details});
}

/**
 * Lookup the custom user id (key under /users) by Firebase auth uid stored at:
 * users/{customId}/uid
 *
 * @param {Database} db RTDB database instance
 * @param {string} firebaseUid Firebase auth uid
 * @return {Promise<string|null>} Custom user id or null
 */
async function getCustomIdByFirebaseUid(db, firebaseUid) {
  const snap = await db
      .ref("users")
      .orderByChild("uid")
      .equalTo(firebaseUid)
      .limitToFirst(1)
      .once("value");

  const val = snap.val() || {};
  const keys = Object.keys(val);
  return keys.length ? keys[0] : null;
}


/**
 * Enforce a per minute rate limit using RTDB transactions.
 *
 * @param {Database} db RTDB database instance
 * @param {string} fbUid Firebase auth uid
 * @param {number} limit Max requests per minute
 * @param {string} bucket Rate limit bucket name
 * @return {Promise<{allowed: boolean, count: number}>} Result object
 */
async function enforceRateLimit(db, fbUid, limit, bucket) {
  const minuteKey = String(Math.floor(Date.now() / 60000));
  const path = "rateLimits/" + bucket + "/" + fbUid + "/" + minuteKey;
  const ref = db.ref(path);

  /** @type {boolean} */
  let allowed = true;

  /** @type {number} */
  let countNow = 0;

  await ref.transaction(
      /**
     * @param {unknown} cur Current value at this path
     * @return {number|undefined} New value, or undefined to abort update
     */
      (cur) => {
        const base = typeof cur === "number" ? cur : 0;
        const next = base + 1;
        countNow = next;

        if (next > limit) {
          allowed = false;
          return base; // keep previous count
        }
        return next;
      },
  );

  return {allowed: allowed, count: countNow};
}

/**
 * Normalize unit key segments (country, state, school) used as RTDB keys.
 * Disallows Firebase forbidden chars: . # $ [ ] /
 *
 * @param {unknown} v Input value
 * @return {string} Normalized string or empty string
 */
function normalizeUnitKey(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  if (s.length > 80) return "";
  // No useless escapes: [ and / do
  // not need escaping inside a character class here.
  if (/[.#$[\]/]/.test(s)) return "";
  if (!/^[A-Za-z0-9 _+'(),-]+$/.test(s)) return "";
  return s;
}

/**
 * Compute membership path for a given scope.
 * country required, state optional, school optional.
 *
 * @param {string} country Country name
 * @param {string} state State name
 * @param {string} school School name
 * @param {string} userId Custom user id
 * @return {string} RTDB path string or empty string
 */
function membershipPath(country, state, school, userId) {
  if (country && state && school) {
    return (
      "units/corps/" +
      country +
      "/" +
      state +
      "/" +
      school +
      "/members/" +
      userId
    );
  }
  if (country && state) {
    return "units/corps/" + country + "/" + state + "/members/" + userId;
  }
  if (country) {
    return "units/corps/" + country + "/members/" + userId;
  }
  return "";
}

/**
 * Join unit at country, state, school scope.
 * Deletes the old membership path and
 * writes the new membership path atomically.
 *
 * Request body:
 * { country: "...", state: "...", school: "..." }
 *
 * Response 200:
 * { ok: true, state: "changed" | "same", selected: { country, state, school } }
 *
 * @param {Request} req Express request
 * @param {Response} res Express response
 * @return {Promise<void>} Promise that resolves when response is sent
 */
exports.handler = async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      bad(res, 405, "Method not allowed");
      return;
    }

    const fbUid = await requireVerifiedBearerUid(req);
    const db = getDatabase();

    const rl = await enforceRateLimit(db, fbUid, 20, "joinUnit");
    if (!rl.allowed) {
      res.status(429).json({error: "RATE_LIMITED", retryAfterSeconds: 60});
      return;
    }

    const myCustomId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!myCustomId) {
      bad(res, 403, "PERMISSION_DENIED");
      return;
    }

    const roleSnap = await db.ref("roles/" + myCustomId).once("value");
    if (roleSnap.val() !== "student") {
      bad(res, 412, "FAILED_PRECONDITION", ["Not a student"]);
      return;
    }

    /** @type {any} */
    const body = req.body || {};
    const country = normalizeUnitKey(body.country);
    const state = normalizeUnitKey(body.state || "");
    const school = normalizeUnitKey(body.school || "");

    if (!country) {
      bad(res, 400, "INVALID_ARGUMENT", ["country"]);
      return;
    }

    let unitRefPath = "units/corps/" + country;
    if (state) unitRefPath += "/" + state;
    if (school) unitRefPath += "/" + school;

    const unitSnap = await db.ref(unitRefPath).once("value");
    if (!unitSnap.exists()) {
      bad(res, 412, "FAILED_PRECONDITION", ["Unit does not exist"]);
      return;
    }

    const userSnap = await db.ref("users/" + myCustomId).once("value");
    /** @type {any} */
    const user = userSnap.val() || {};

    const oldCountry = typeof user.corpsName === "string" ? user.corpsName : "";
    const oldState =
      typeof user.battalionName === "string" ? user.battalionName : "";
    const oldSchool =
      typeof user.platoonName === "string" ? user.platoonName : "";

    const newPath = membershipPath(country, state, school, myCustomId);
    if (!newPath) {
      bad(res, 400, "INVALID_ARGUMENT", ["country"]);
      return;
    }

    const oldPath = membershipPath(oldCountry, oldState, oldSchool, myCustomId);

    if (oldPath && oldPath === newPath) {
      // Profile labels can outlive a missing/stale membership index (for
      // example after older clients wrote the labels directly). Reassert the
      // canonical membership instead of treating matching labels as proof
      // that the index already exists.
      await db.ref(newPath).set(true);
      res.status(200).json({
        ok: true,
        state: "same",
        selected: {country: country, state: state, school: school},
      });
      return;
    }

    /** @type {Record<string, unknown>} */
    const updates = {};

    if (oldPath) updates[oldPath] = null;
    updates[newPath] = true;

    updates["users/" + myCustomId + "/corpsName"] = country;
    updates["users/" + myCustomId + "/battalionName"] = state || "";
    updates["users/" + myCustomId + "/platoonName"] = school || "";

    await db.ref().update(updates);

    res.status(200).json({
      ok: true,
      state: "changed",
      selected: {country: country, state: state, school: school},
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (Number(err.code) === 401) {
      res.status(401).json({error: "AUTHENTICATION_REQUIRED"});
      return;
    }
    if (Number(err.code) === 403 && err.message === "EMAIL_VERIFICATION_REQUIRED") {
      res.status(403).json({error: "EMAIL_VERIFICATION_REQUIRED"});
      return;
    }
    res.status(500).json({error: err.message});
  }
};
