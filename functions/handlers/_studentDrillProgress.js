"use strict";
/* eslint-disable require-jsdoc, max-len */

const crypto = require("crypto");
const {cleanSegment, subjectTimerKey} = require("./_studentDrill");

const MAX_PROGRESS_BYTES = 64 * 1024;
const MAX_QUESTION_COUNT = 500;
const MAX_PROGRESS_CLIENTS = 16;
const PROGRESS_FIELDS = [
  "answers", "bookmarks", "flags", "questionTimes", "timers",
];

function httpError(message, code = 400) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function approximateJsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value || {}), "utf8");
}

function assertProgressPayloadSize(body) {
  const bytes = approximateJsonBytes(body);
  if (bytes > MAX_PROGRESS_BYTES) {
    throw httpError("Drill progress payload is too large", 413);
  }
  return bytes;
}

function sessionProgressMetadata(session) {
  const questions = Array.isArray(session && session.questions) ?
    session.questions : [];
  if (!questions.length || questions.length > MAX_QUESTION_COUNT) {
    throw httpError("Drill session question metadata is invalid");
  }
  const questionIds = questions.map((question) =>
    cleanSegment(question && question.id, 120));
  if (questionIds.some((id) => !id) ||
      new Set(questionIds).size !== questionIds.length) {
    throw httpError("Drill session question identifiers are invalid");
  }
  const timerLimits = {};
  (Array.isArray(session.config) ? session.config : []).forEach((row) => {
    const subject = String(row && row.subject || "");
    const minutes = Number(row && row.timeLimitMin || 0);
    if (subject && Number.isFinite(minutes) && minutes > 0) {
      timerLimits[subjectTimerKey(subject)] = Math.min(18000,
          Math.floor(minutes * 60));
    }
  });
  return {
    v: 1,
    sessionId: String(session.sessionId || ""),
    studentId: String(session.studentId || ""),
    status: String(session.status || "active"),
    bootcamp: String(session.bootcamp || ""),
    questionIds,
    timerLimits,
    createdAt: Number(session.createdAt || Date.now()),
  };
}

function initialProgress(session) {
  return {
    v: 1,
    revision: Math.max(0, Number(session.progressRevision || 0)),
    answers: session.answers || {},
    bookmarks: session.bookmarks || {},
    flags: session.flags || {},
    questionTimes: session.questionTimes || {},
    timers: session.timers || {},
    currentQuestionId: String(session.currentQuestionId || ""),
    updatedAt: Number(session.updatedAt || session.createdAt || Date.now()),
  };
}

function sessionStorageUpdates(studentId, session) {
  const base = `${studentId}/${session.sessionId}`;
  return {
    [`studentDrills/${base}`]: sessionDocument(session),
    [`studentDrillMetadata/${base}`]: sessionProgressMetadata(session),
    [`studentDrillProgress/${base}`]: initialProgress(session),
  };
}

function sessionDocument(session) {
  const document = {...session, schemaVersion: 3};
  [
    "answers", "bookmarks", "flags", "questionTimes", "timers",
    "currentQuestionId", "progressRevision",
  ].forEach((field) => delete document[field]);
  return document;
}

function normalizedClient(body) {
  const rawId = cleanSegment(body && body.clientId, 80);
  const sequence = Number(body && body.sequence);
  if (!rawId && body && body.changes) {
    throw httpError("A progress client identifier is required");
  }
  if (rawId && (!Number.isSafeInteger(sequence) || sequence < 1)) {
    throw httpError("A valid progress sequence is required");
  }
  return {clientId: rawId, sequence: rawId ? sequence : 0};
}

function sanitizeMapPatch(raw, questionIds, validator, field) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw httpError(`${field} progress must be an object`);
  }
  const patch = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!questionIds.has(id)) {
      throw httpError(`Unknown question identifier in ${field}`);
    }
    if (value === null) {
      patch[id] = null;
      continue;
    }
    const normalized = validator(value);
    if (normalized === undefined) {
      throw httpError(`Invalid ${field} progress value`);
    }
    patch[id] = normalized;
  }
  return patch;
}

function sanitizeTimerPatch(raw, timerLimits) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw httpError("timers progress must be an object");
  }
  const patch = {};
  for (const [subject, value] of Object.entries(raw)) {
    const storedKey = Object.hasOwn(timerLimits, subject) ?
      subject : subjectTimerKey(subject);
    if (!Object.hasOwn(timerLimits, storedKey)) {
      throw httpError("Unknown subject timer");
    }
    const seconds = Number(value);
    if (!Number.isFinite(seconds)) throw httpError("Invalid timer value");
    patch[storedKey] = Math.min(timerLimits[storedKey],
        Math.max(0, Math.floor(seconds)));
  }
  return patch;
}

function sanitizeProgressPatch(metadata, body) {
  if (!metadata || metadata.status !== "active") {
    throw httpError("This drill is not active", 409);
  }
  const source = body && body.changes !== undefined ? body.changes : body;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw httpError("Drill progress changes are invalid");
  }
  const ids = new Set(Array.isArray(metadata.questionIds) ?
    metadata.questionIds : []);
  const answer = (value) => {
    const index = Number(value);
    return Number.isInteger(index) && index >= 0 && index <= 3 ? index :
      undefined;
  };
  const marker = (value) => value === true ? true : undefined;
  const seconds = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(7200,
        Math.max(0, Math.floor(number))) : undefined;
  };
  const patch = {
    answers: sanitizeMapPatch(source.answers, ids, answer, "answers"),
    bookmarks: sanitizeMapPatch(source.bookmarks, ids, marker, "bookmarks"),
    flags: sanitizeMapPatch(source.flags, ids, marker, "flags"),
    questionTimes: sanitizeMapPatch(
        source.questionTimes, ids, seconds, "questionTimes"),
    timers: sanitizeTimerPatch(source.timers, metadata.timerLimits || {}),
  };
  if (source.currentQuestionId !== undefined) {
    if (!ids.has(source.currentQuestionId)) {
      throw httpError("Current question identifier is invalid");
    }
    patch.currentQuestionId = source.currentQuestionId;
  }
  const changed = PROGRESS_FIELDS.some((field) =>
    patch[field] && Object.keys(patch[field]).length) ||
    patch.currentQuestionId !== undefined;
  if (!changed) throw httpError("No valid progress changes were provided");
  return {...patch, ...normalizedClient(body)};
}

function mergeMap(current, patch) {
  const next = {...(current && typeof current === "object" ? current : {})};
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (value === null) delete next[key];
    else next[key] = value;
  });
  return next;
}

function applyProgressPatch(currentValue, patch, now = Date.now()) {
  const current = currentValue && typeof currentValue === "object" ?
    currentValue : {v: 1, revision: 0, clientSequences: {}};
  const clientSequences = {...(current.clientSequences || {})};
  const clientKey = patch.clientId ?
    crypto.createHash("sha256").update(patch.clientId).digest("hex").slice(0, 20) :
    "legacy";
  if (patch.clientId && Number(clientSequences[clientKey] || 0) >=
      patch.sequence) return {value: current, stale: true};
  if (patch.clientId && !Object.hasOwn(clientSequences, clientKey) &&
      Object.keys(clientSequences).length >= MAX_PROGRESS_CLIENTS) {
    throw httpError("Too many progress clients for this drill", 409);
  }
  if (patch.clientId) clientSequences[clientKey] = patch.sequence;
  const value = {
    ...current,
    v: 1,
    revision: Number(current.revision || 0) + 1,
    clientSequences,
    updatedAt: now,
  };
  PROGRESS_FIELDS.forEach((field) => {
    if (patch[field] !== undefined) {
      value[field] = mergeMap(current[field], patch[field]);
    }
  });
  if (patch.currentQuestionId !== undefined) {
    value.currentQuestionId = patch.currentQuestionId;
  }
  return {value, stale: false};
}

function progressForSession(session, progress) {
  const stored = progress && typeof progress === "object" ? progress : {};
  return {
    ...session,
    answers: stored.answers || session.answers || {},
    bookmarks: stored.bookmarks || session.bookmarks || {},
    flags: stored.flags || session.flags || {},
    questionTimes: stored.questionTimes || session.questionTimes || {},
    timers: stored.timers || session.timers || {},
    currentQuestionId: stored.currentQuestionId ||
      session.currentQuestionId || "",
    progressRevision: Number(stored.revision || 0),
    updatedAt: Number(stored.updatedAt || session.updatedAt ||
      session.createdAt || 0),
  };
}

module.exports = {
  MAX_PROGRESS_BYTES,
  MAX_PROGRESS_CLIENTS,
  applyProgressPatch,
  approximateJsonBytes,
  assertProgressPayloadSize,
  initialProgress,
  progressForSession,
  sanitizeProgressPatch,
  sessionProgressMetadata,
  sessionDocument,
  sessionStorageUpdates,
};
