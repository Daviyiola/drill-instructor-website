"use strict";

/**
 * Normalize and validate an optional educator drill due date.
 *
 * @param {*} value Raw due date.
 * @param {number} now Current timestamp, injectable for tests.
 * @return {{ok:boolean, dueAt:string, error:string}}
 */
function normalizeFutureDueAt(value, now = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return {ok: true, dueAt: "", error: ""};

  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) {
    return {ok: false, dueAt: "", error: "INVALID_DUE_DATE"};
  }
  if (timestamp <= now) {
    return {ok: false, dueAt: "", error: "DUE_DATE_MUST_BE_IN_FUTURE"};
  }
  return {ok: true, dueAt: new Date(timestamp).toISOString(), error: ""};
}

module.exports = {normalizeFutureDueAt};
