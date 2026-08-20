// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {studentEnrollmentOpen} = require("./_schoolPolicies");

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
     * @return {number} New value
     */
      (cur) => {
        const base = typeof cur === "number" ? cur : 0;
        const next = base + 1;
        countNow = next;

        if (next > limit) {
          allowed = false;
          return base;
        }
        return next;
      },
  );

  return {allowed: allowed, count: countNow};
}

/**
 * Normalizes unit key segments (country, state) used as RTDB keys.
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
  // Important: keep the "/" escaped in the regex literal. "[
  // " and "]" do NOT need escaping inside a char class.
  if (/[.#$[\]/]/.test(s)) return "";
  if (!/^[A-Za-z0-9 _+'(),-]+$/.test(s)) return "";
  return s;
}

/**
 * List schools under:
 * units/corps/<country>/<state>/*
 * excluding totalPoints and members keys.
 *
 * Request body:
 * { country: "Nigeria", state: "Lagos" }
 *
 * Response 200:
 * { ok: true, schools: [{ name: "Redeemers School" }, ...] }
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

    const fbUid = await requireBearerUid(req);
    const db = getDatabase();

    const rl = await enforceRateLimit(db, fbUid, 60, "listSchools");
    if (!rl.allowed) {
      res.status(429).json({error: "RATE_LIMITED", retryAfterSeconds: 60});
      return;
    }

    const myCustomId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!myCustomId) {
      bad(res, 403, "PERMISSION_DENIED");
      return;
    }

    /** @type {any} */
    const body = req.body || {};
    const country = normalizeUnitKey(body.country);
    const state = normalizeUnitKey(body.state);

    if (!country || !state) {
      bad(res, 400, "INVALID_ARGUMENT", ["country", "state"]);
      return;
    }

    const refPath = "units/corps/" + country + "/" + state;
    const snap = await db.ref(refPath).once("value");
    const data = snap.val();

    // Temporary debugging help (safe to keep, but you can remove later)
    console.log("listSchools refPath:", refPath);
    console.log("listSchools keys:", Object.keys(data || {}));

    if (!data || typeof data !== "object") {
      res.status(200).json({ok: true, schools: []});
      return;
    }

    /** @type {Array<{name: string}>} */
    const schools = [];

    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === "totalPoints") continue;
      if (k === "members") continue;

      const node = data[k];
      if (!node || typeof node !== "object") continue;

      if (!studentEnrollmentOpen(node)) continue;

      schools.push({name: k});
    }

    schools.sort(
        /**
       * @param {{name: string}} a First
       * @param {{name: string}} b Second
       * @return {number} Sort order
       */
        (a, b) => (a.name > b.name ? 1 : a.name < b.name ? -1 : 0),
    );

    res.status(200).json({ok: true, schools: schools});
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    res.status(500).json({error: err.message});
  }
};
