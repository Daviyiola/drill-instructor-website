"use strict";
/* eslint-disable require-jsdoc */

const METRIC_VERSION = "streak-v1";
const DAY_MS = 24 * 60 * 60 * 1000;

function safeTimezone(value) {
  const timezone = String(value || "").trim();
  if (!timezone || timezone.length > 80) return "";
  try {
    new Intl.DateTimeFormat("en-CA", {timeZone: timezone}).format(new Date());
    return timezone;
  } catch (_) {
    return "";
  }
}

function safeOffset(value) {
  const offset = Number(value);
  return Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ?
    Math.round(offset) : 0;
}

function dayKey(value, timezone = "", offsetMinutes = 0) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const zone = safeTimezone(timezone);
  if (zone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type) => parts.find((row) => row.type === type).value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }
  const shifted = new Date(date.getTime() - safeOffset(offsetMinutes) * 60000);
  return shifted.toISOString().slice(0, 10);
}

function dayOrdinal(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) return null;
  const value = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(value) ? Math.floor(value / DAY_MS) : null;
}

function summarizeDays(days, options = {}) {
  const keys = Object.keys(days || {})
      .filter((key) => days[key] && dayOrdinal(key) !== null)
      .sort();
  if (!keys.length) {
    return {current: 0, best: 0, lastPracticeDay: ""};
  }
  let best = 1;
  let run = 1;
  for (let index = 1; index < keys.length; index++) {
    const previous = dayOrdinal(keys[index - 1]);
    const current = dayOrdinal(keys[index]);
    run = current - previous === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const lastPracticeDay = keys[keys.length - 1];
  const today = dayOrdinal(dayKey(
      options.now || Date.now(),
      options.timezone,
      options.timezoneOffsetMinutes,
  ));
  const distance = today - dayOrdinal(lastPracticeDay);
  return {
    current: distance >= 0 && distance <= 1 ? run : 0,
    best,
    lastPracticeDay,
  };
}

function nextStreakNode(current, options = {}) {
  const node = current && typeof current === "object" ? current : {};
  const previousSummary = node.summary && typeof node.summary === "object" ?
    node.summary : {};
  const timezone = safeTimezone(options.timezone) ||
    safeTimezone(previousSummary.timezone);
  const timezoneOffsetMinutes = timezone ? 0 :
    (options.timezoneOffsetMinutes !== undefined ?
      safeOffset(options.timezoneOffsetMinutes) :
      safeOffset(previousSummary.timezoneOffsetMinutes));
  const days = {...(node.days && typeof node.days === "object" ?
    node.days : {})};
  const practiceDay = dayKey(
      options.submittedAt,
      timezone,
      timezoneOffsetMinutes,
  );
  if (practiceDay) days[practiceDay] = true;
  return {
    summary: {
      ...summarizeDays(days, {
        now: options.now,
        timezone,
        timezoneOffsetMinutes,
      }),
      timezone,
      timezoneOffsetMinutes,
      updatedAt: new Date(options.now || Date.now()).toISOString(),
      metricVersion: METRIC_VERSION,
    },
    days,
  };
}

function publicSummary(value, now = Date.now()) {
  const summary = value && typeof value === "object" ? value : {};
  const lastPracticeDay = String(summary.lastPracticeDay || "");
  const today = dayOrdinal(dayKey(
      now,
      summary.timezone,
      summary.timezoneOffsetMinutes,
  ));
  const last = dayOrdinal(lastPracticeDay);
  const current = last !== null && today - last >= 0 && today - last <= 1 ?
    Number(summary.current || 0) : 0;
  return {
    current,
    best: Number(summary.best || 0),
    lastPracticeDay,
    timezone: String(summary.timezone || ""),
    timezoneOffsetMinutes: safeOffset(summary.timezoneOffsetMinutes),
    metricVersion: String(summary.metricVersion || METRIC_VERSION),
  };
}

async function recordStreak(db, options) {
  const ref = db.ref(`users/${options.studentId}/streaks/` +
    String(options.bootcamp || "").toLowerCase());
  if (Number(options.attempted || 0) > 0) {
    const now = options.now || Date.now();
    const result = await ref.transaction((current) => nextStreakNode(current, {
      ...options,
      now,
    }));
    return publicSummary(result.snapshot.val().summary, now);
  }
  const summary = (await ref.child("summary").once("value")).val();
  return publicSummary(summary, options.now || Date.now());
}

async function readStreakSummaries(db, studentId, bootcamps, now = Date.now()) {
  const entries = await Promise.all([...new Set(bootcamps)].map(async (id) => {
    const value = (await db.ref(
        `users/${studentId}/streaks/${id}/summary`,
    ).once("value")).val();
    return [id, publicSummary(value, now)];
  }));
  return Object.fromEntries(entries);
}

module.exports = {
  METRIC_VERSION,
  dayKey,
  nextStreakNode,
  publicSummary,
  readStreakSummaries,
  recordStreak,
  summarizeDays,
};
