"use strict";
/* eslint-disable require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {buildCatalog, resolveStudent, SUPPORTED_BOOTCAMPS} =
  require("./_studentDrill");
const {aggregateAnalytics, activitySessions} = require("./_analytics");

function requestOptions(body) {
  const bootcamp = String(body.bootcamp || "").trim().toLowerCase();
  if (!SUPPORTED_BOOTCAMPS.includes(bootcamp)) {
    const error = new Error("A supported bootcamp is required");
    error.code = 400;
    throw error;
  }
  const endAt = new Date(body.endAt || Date.now());
  const startAt = new Date(body.startAt || endAt.getTime() - 29 * 86400000);
  if (!Number.isFinite(startAt.getTime()) ||
      !Number.isFinite(endAt.getTime()) || startAt > endAt) {
    const error = new Error("A valid analytics date range is required");
    error.code = 400;
    throw error;
  }
  if (endAt - startAt > 10 * 365 * 86400000) {
    const error = new Error("The analytics range is too large");
    error.code = 400;
    throw error;
  }
  const allowedSources = new Set(["all", "solo", "challenge", "assignment"]);
  const source = String(body.source || "all");
  return {
    bootcamp,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    timezone: String(body.timezone || "UTC").slice(0, 80),
    source: allowedSources.has(source) ? source : "all",
    subject: String(body.subject || "").trim().slice(0, 120),
    granularity: ["week", "month"].includes(body.granularity) ?
      body.granularity : "day",
  };
}

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  try {
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const options = requestOptions(req.body || {});
    // The response has two windows: the requested display range and a fixed
    // trailing 90-day DIRI window. Fetch their union so the shared aggregator
    // can render the selected range without letting it alter readiness.
    const now = Date.now();
    const diriStart = now - 89 * 86400000;
    const queryStart = new Date(Math.min(
        Date.parse(options.startAt), diriStart,
    )).toISOString();
    const queryEnd = new Date(Math.max(
        Date.parse(options.endAt), now,
    )).toISOString();
    const attempts = (await db.ref(`users/${studentId}/statsIndex`)
        .orderByChild("submittedAt")
        .startAt(queryStart)
        .endAt(queryEnd)
        .once("value")).val() || {};
    const analytics = aggregateAnalytics(
        Object.values(attempts),
        options,
        buildCatalog(options.bootcamp),
    );
    return res.status(200).json({
      ok: true,
      bootcamp: options.bootcamp,
      // Deliberately lightweight: native caches these coordinates to make
      // practice-test variety complete across devices without result payloads.
      activitySessions: activitySessions(Object.values(attempts), options),
      ...analytics,
    });
  } catch (error) {
    const status = [400, 401, 403, 404].includes(Number(error.code)) ?
      Number(error.code) : 500;
    if (status === 500) {
      console.error("STUDENT_ANALYTICS_FAILED", {message: error.message});
    }
    return res.status(status).json({
      error: status === 500 ? "Unable to load analytics" : error.message,
    });
  }
}

module.exports = {handler, requestOptions};
