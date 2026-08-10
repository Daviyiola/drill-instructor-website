"use strict";
const {getAuth} = require("firebase-admin/auth");

/**
 * Shared helpers for Drill Instructor educator drill endpoints.
 * V1 lifecycle:
 *   draft -> published -> closed
 *
 * Published drills are immutable except:
 *   dueAt
 *   status
 *   showScoreImmediately
 *   showCorrectionsImmediately
 */

const {
  bad,
  cleanStr,
  educatorHasBootcampAccess,
  errText,
  isActivePlan,
  isObject,
  normalizeSchool,
  normalizeUidToEducator,
  planHasBootcamp,
} = require("./_schoolAdminAccess");

const DRILL_STATUSES = {
  draft: true,
  published: true,
  closed: true,
};

const MAX_TITLE_LEN = 120;
const MAX_INSTRUCTIONS_LEN = 1200;
const MAX_SUBJECTS_PER_DRILL = 20;
const MAX_QUESTIONS_PER_SUBJECT = 300;
const MAX_TOTAL_QUESTIONS = 500;

/**
 * Return true only for plain object maps.
 *
 * @param {*} v Input value
 * @return {boolean} True if object map
 */
function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Normalize booleans from client payload.
 *
 * @param {*} v Input value
 * @param {boolean} fallback Fallback value
 * @return {boolean} Normalized boolean
 */
function normalizeBool(v, fallback) {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return fallback === true;
}

/**
 * Normalize a drill status.
 *
 * @param {*} v Input value
 * @param {string} fallback Fallback status
 * @return {string} Safe drill status
 */
function normalizeDrillStatus(v, fallback) {
  const s = cleanStr(v, 40).toLowerCase() || fallback || "draft";
  return DRILL_STATUSES[s] === true ? s : "draft";
}

/**
 * Return ISO date string if valid, otherwise empty string.
 *
 * @param {*} v Date-ish value
 * @return {string} ISO string or empty
 */
function normalizeDateIso(v) {
  const raw = cleanStr(v, 80);
  if (!raw) return "";

  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return "";

  return new Date(ms).toISOString();
}

/**
 * Generate a lightweight display name for educator/student profiles.
 *
 * @param {Object} profile Profile object
 * @param {string} fallback Fallback text
 * @return {string} Display name
 */
function displayName(profile, fallback) {
  const first = cleanStr(profile && profile.firstName, 60);
  const last = cleanStr(profile && profile.lastName, 60);
  const full = `${first} ${last}`.trim();

  if (full) return full;
  return cleanStr(profile && profile.email, 120) || fallback || "";
}

/**
 * Resolve calling educator and school from Firebase UID.
 *
 * @param {Object} db Firebase database instance
 * @param {string} callerFbUid Firebase auth UID
 * @return {Promise<Object>} Caller context
 */
async function readCallerContext(db, callerFbUid) {
  const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
  const educatorId = normalizeUidToEducator(mapSnap.val());

  if (!educatorId) {
    return {error: "NOT_AN_EDUCATOR"};
  }

  const educatorSnap = await db.ref(`educators/${educatorId}`).once("value");
  const educator = educatorSnap.val() || {};
  const schoolId = cleanStr(educator.schoolID || educator.schoolId, 80);

  if (!schoolId) {
    return {error: "EDUCATOR_HAS_NO_SCHOOL"};
  }

  return {educatorId, educator, schoolId};
}

/**
 * Read and validate the school-side educator context.
 *
 * @param {Object} db Firebase database instance
 * @param {string} callerFbUid Firebase auth UID
 * @param {string} bootcamp Optional active bootcamp
 * @return {Promise<Object>} Validated context or error
 */
async function readEducatorSchoolContext(db, callerFbUid, bootcamp) {
  const authUser = await getAuth().getUser(callerFbUid);
  if (!authUser.emailVerified) {
    return {error: "EMAIL_VERIFICATION_REQUIRED"};
  }
  const callerCtx = await readCallerContext(db, callerFbUid);

  if (callerCtx.error) {
    return callerCtx;
  }

  const {educatorId, educator, schoolId} = callerCtx;

  const [schoolSnap, schoolEducatorSnap] = await Promise.all([
    db.ref(`schools/${schoolId}`).once("value"),
    db.ref(`schools/${schoolId}/educators/${educatorId}`).once("value"),
  ]);

  const school = schoolSnap.val() || {};
  const schoolEducator = schoolEducatorSnap.val() || {};
  const schoolNorm = normalizeSchool(schoolId, school);

  if (schoolEducator.status !== "approved") {
    return {
      error: "EDUCATOR_NOT_APPROVED",
      details: {
        status: schoolEducator.status || "missing",
      },
    };
  }

  if (!schoolNorm.name || !schoolNorm.country || !schoolNorm.state) {
    return {
      error: "SCHOOL_RECORD_INCOMPLETE",
      details: {
        schoolId,
        missing: {
          name: !schoolNorm.name,
          country: !schoolNorm.country,
          state: !schoolNorm.state,
        },
      },
    };
  }

  const plan = isObject(school.plan) ? school.plan : {};

  if (!isActivePlan(plan)) {
    return {
      error: "SCHOOL_PLAN_NOT_ACTIVE",
      details: {
        planStatus: cleanStr(plan.status, 40) || "missing",
      },
    };
  }

  const cleanBootcamp = cleanStr(bootcamp, 40).toLowerCase();

  if (cleanBootcamp && !planHasBootcamp(plan, cleanBootcamp)) {
    return {
      error: "BOOTCAMP_NOT_IN_SCHOOL_PLAN",
      details: {
        bootcamp: cleanBootcamp,
      },
    };
  }

  if (
    cleanBootcamp &&
    !educatorHasBootcampAccess(schoolEducator, cleanBootcamp)
  ) {
    return {
      error: "EDUCATOR_HAS_NO_BOOTCAMP_ACCESS",
      details: {
        bootcamp: cleanBootcamp,
      },
    };
  }

  return {
    educatorId,
    educator,
    educatorName: displayName(educator, educatorId),
    schoolId,
    school,
    schoolNorm,
    schoolEducator,
    plan,
    bootcamp: cleanBootcamp,
  };
}

/**
 * Normalize question id while preserving numeric ids when possible.
 *
 * @param {*} v Input question id
 * @return {number|string} Normalized id
 */
function normalizeQuestionId(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.floor(v);
  }

  const raw = cleanStr(v, 120);
  if (!raw) return "";

  const n = Number(raw);
  if (Number.isFinite(n) && String(Math.floor(n)) === raw) {
    return Math.floor(n);
  }

  return raw;
}

/**
 * Return a unique, order-preserving array of question IDs.
 *
 * @param {*} input Input questionIds
 * @return {Array<number|string>} Normalized question IDs
 */
function normalizeQuestionIds(input) {
  if (!Array.isArray(input)) return [];

  const out = [];
  const seen = {};

  for (let i = 0; i < input.length; i++) {
    if (out.length >= MAX_QUESTIONS_PER_SUBJECT) break;

    const qid = normalizeQuestionId(input[i]);
    if (qid === "") continue;

    const key = String(qid);
    if (seen[key] === true) continue;

    seen[key] = true;
    out.push(qid);
  }

  return out;
}

/**
 * Normalize a subject blueprint row.
 *
 * @param {*} row Input row
 * @return {Object|null} Sanitized row or null
 */
function sanitizeBlueprintSubject(row) {
  if (!isPlainObject(row)) return null;

  const subject = cleanStr(row.subject, 100);
  if (!subject) return null;

  const questionIds = normalizeQuestionIds(row.questionIds);
  if (questionIds.length < 1) return null;

  const rawTimeLimit = Number(row.timeLimitMin || row.timeLimitMinutes || 0);
  const timeLimitMin = Number.isFinite(rawTimeLimit) && rawTimeLimit > 0 ?
    Math.min(Math.floor(rawTimeLimit), 300) :
    0;

  const filtersIn = isPlainObject(row.filters) ? row.filters : {};
  const filters = {
    practiceYearCsv: cleanStr(
        row.practiceYearCsv || filtersIn.practiceYearCsv,
        300,
    ),
    modulesCsv: cleanStr(row.modulesCsv || filtersIn.modulesCsv, 1000),
  };

  return {
    subject,
    questionIds,
    timeLimitMin,
    filters,
  };
}

/**
 * @typedef {Object} BlueprintSanitizeResult
 * @property {boolean} ok
 * @property {Object=} blueprint
 * @property {string=} error
 * @property {Object=} details
 */

/**
 * Sanitize drill blueprint.
 *
 * @param {*} input Client blueprint.
 * @param {string} fallbackBootcamp Fallback bootcamp.
 * @return {BlueprintSanitizeResult} Sanitized result.
 */
function sanitizeBlueprint(input, fallbackBootcamp) {
  if (!isPlainObject(input)) {
    return {ok: false, error: "MISSING_BLUEPRINT"};
  }

  const bootcamp = cleanStr(input.bootcamp || fallbackBootcamp, 40)
      .toLowerCase();
  const datasetVersion = cleanStr(input.datasetVersion, 120);
  const correctionRevision = Math.max(
      0, Math.floor(Number(input.correctionRevision || 0)),
  );

  if (!bootcamp) {
    return {ok: false, error: "MISSING_BLUEPRINT_BOOTCAMP"};
  }

  if (!datasetVersion) {
    return {ok: false, error: "MISSING_DATASET_VERSION"};
  }

  if (!Array.isArray(input.subjects) || input.subjects.length < 1) {
    return {ok: false, error: "MISSING_BLUEPRINT_SUBJECTS"};
  }

  const subjects = [];
  let totalQuestions = 0;

  for (let i = 0; i < input.subjects.length; i++) {
    if (subjects.length >= MAX_SUBJECTS_PER_DRILL) break;

    const row = sanitizeBlueprintSubject(input.subjects[i]);
    if (!row) continue;

    totalQuestions += row.questionIds.length;
    subjects.push(row);
  }

  if (subjects.length < 1 || totalQuestions < 1) {
    return {ok: false, error: "BLUEPRINT_HAS_NO_QUESTIONS"};
  }

  if (totalQuestions > MAX_TOTAL_QUESTIONS) {
    return {
      ok: false,
      error: "TOO_MANY_QUESTIONS",
      details: {
        max: MAX_TOTAL_QUESTIONS,
        totalQuestions,
      },
    };
  }

  return {
    ok: true,
    blueprint: {
      bootcamp,
      datasetVersion,
      correctionRevision,
      subjects,
      totalQuestions,
    },
  };
}

/**
 * Sanitize settings. Allows existing values for patch-style saves.
 *
 * @param {*} input Input settings
 * @param {*} existing Existing settings
 * @return {Object} Sanitized settings
 */
function sanitizeDrillSettings(input, existing) {
  const src = isPlainObject(input) ? input : {};
  const old = isPlainObject(existing) ? existing : {};
  const policies = new Set(["immediate", "on_due_date", "manual"]);
  const scorePolicy = cleanStr(src.scorePolicy || old.scorePolicy, 30);
  const correctionPolicy = cleanStr(
      src.correctionPolicy || old.correctionPolicy,
      30,
  );

  return {
    scorePolicy: policies.has(scorePolicy) ? scorePolicy : "immediate",
    correctionPolicy: policies.has(correctionPolicy) ?
      correctionPolicy : "manual",
    shuffleQuestions: normalizeBool(
        src.shuffleQuestions,
        old.shuffleQuestions !== false,
    ),
    shuffleOptions: normalizeBool(
        src.shuffleOptions,
        old.shuffleOptions !== false,
    ),
  };
}

/**
 * Sanitize draft input body.
 *
 * @param {*} body Request body
 * @param {*} existing Existing drill row
 * @return {Object} Sanitized draft payload
 */
function sanitizeDraftInput(body, existing) {
  const src = isPlainObject(body) ? body : {};
  const old = isPlainObject(existing) ? existing : {};

  const title = cleanStr(src.title || old.title, MAX_TITLE_LEN);
  const instructions = cleanStr(
      src.instructions !== undefined ? src.instructions : old.instructions,
      MAX_INSTRUCTIONS_LEN,
  );

  const dueAt = src.dueAt !== undefined ?
    normalizeDateIso(src.dueAt) :
    cleanStr(old.dueAt, 80);

  const settings = sanitizeDrillSettings(src.settings, old.settings);

  return {
    title,
    instructions,
    dueAt,
    settings,
  };
}

/**
 * Sanitize a compact student mirror row.
 *
 * @param {Object} drill Drill row
 * @param {string} schoolId School id
 * @param {string} studentStatus Student assignment status
 * @return {Object} Student mirror row
 */
function buildStudentAssignedDrillMirror(drill, schoolId, studentStatus) {
  const settings = sanitizeDrillSettings(drill.settings || {}, {});

  return {
    drillId: cleanStr(drill.drillId, 120),
    schoolId: cleanStr(schoolId, 80),
    bootcamp: cleanStr(drill.bootcamp, 40).toLowerCase(),
    title: cleanStr(drill.title, MAX_TITLE_LEN),
    instructions: cleanStr(drill.instructions, MAX_INSTRUCTIONS_LEN),
    status: cleanStr(studentStatus || "assigned", 40),
    createdByEducatorId: cleanStr(drill.createdByEducatorId, 120),
    createdByName: cleanStr(drill.createdByName, 140),
    assignedAt: cleanStr(drill.publishedAt || drill.assignedAt, 80),
    dueAt: cleanStr(drill.dueAt, 80),
    submittedAt: "",
    scorePolicy: settings.scorePolicy,
    correctionPolicy: settings.correctionPolicy,
  };
}

/**
 * Summarize a blueprint for list cards.
 *
 * @param {Object} blueprint Sanitized blueprint
 * @return {Object} Summary
 */
function summarizeBlueprint(blueprint) {
  const subjects = Array.isArray(blueprint && blueprint.subjects) ?
    blueprint.subjects :
    [];

  let questionCount = 0;
  const subjectNames = [];

  for (const row of subjects) {
    if (!row || typeof row !== "object") continue;

    const subject = cleanStr(row.subject, 100);
    if (subject) subjectNames.push(subject);

    const ids = Array.isArray(row.questionIds) ? row.questionIds : [];
    questionCount += ids.length;
  }

  return {
    subjectCount: subjectNames.length,
    subjectsText: subjectNames.join(", "),
    questionCount,
  };
}

/**
 * Sanitize drill row for endpoint response/list UI.
 *
 * @param {string} drillId Drill id
 * @param {Object} row Raw drill row
 * @return {Object} Sanitized list row
 */
function sanitizeDrillListRow(drillId, row) {
  const safe = row && typeof row === "object" ? row : {};
  const status = normalizeDrillStatus(safe.status, "draft");
  const blueprintSummary = summarizeBlueprint(safe.blueprint || {});
  const summary = isPlainObject(safe.summary) ? safe.summary : {};

  return {
    drillId: cleanStr(safe.drillId || drillId, 120),
    id: cleanStr(safe.drillId || drillId, 120),
    bootcamp: cleanStr(safe.bootcamp, 40).toLowerCase(),
    status,
    title: cleanStr(safe.title, MAX_TITLE_LEN) || "Untitled Drill",
    instructions: cleanStr(safe.instructions, MAX_INSTRUCTIONS_LEN),
    createdByEducatorId: cleanStr(safe.createdByEducatorId, 120),
    createdByName: cleanStr(safe.createdByName, 140),
    createdAt: cleanStr(safe.createdAt, 80),
    updatedAt: cleanStr(safe.updatedAt, 80),
    publishedAt: cleanStr(safe.publishedAt, 80),
    closedAt: cleanStr(safe.closedAt, 80),
    reopenedAt: cleanStr(safe.reopenedAt, 80),
    dueAt: cleanStr(safe.dueAt, 80),
    settings: sanitizeDrillSettings(safe.settings || {}, {}),
    blueprintSummary,
    assignedCount: Number(summary.assignedCount || 0),
    startedCount: Number(summary.startedCount || 0),
    submittedCount: Number(summary.submittedCount || 0),
    averageAccuracy: Number(summary.averageAccuracy || 0),
    averageTimeSec: Number(summary.averageTimeSec || 0),
  };
}

/**
 * Return true if status can be deleted.
 *
 * @param {string} status Drill status
 * @return {boolean} True if deletable
 */
function canDeleteStatus(status) {
  return normalizeDrillStatus(status, "draft") === "draft";
}

/**
 * Return true if drill content can be edited.
 *
 * @param {string} status Drill status
 * @return {boolean} True if editable
 */
function canEditContentStatus(status) {
  return normalizeDrillStatus(status, "draft") === "draft";
}

/**
 * Build initial summary for a newly saved draft.
 *
 * @return {Object} Empty summary
 */
function emptyDrillSummary() {
  return {
    assignedCount: 0,
    startedCount: 0,
    submittedCount: 0,
    averageAccuracy: 0,
    averageTimeSec: 0,
  };
}

module.exports = {
  DRILL_STATUSES,
  MAX_INSTRUCTIONS_LEN,
  MAX_TITLE_LEN,
  bad,
  buildStudentAssignedDrillMirror,
  canDeleteStatus,
  canEditContentStatus,
  cleanStr,
  displayName,
  emptyDrillSummary,
  errText,
  normalizeBool,
  normalizeDateIso,
  normalizeDrillStatus,
  readCallerContext,
  readEducatorSchoolContext,
  sanitizeBlueprint,
  sanitizeDrillListRow,
  sanitizeDrillSettings,
  sanitizeDraftInput,
  summarizeBlueprint,
};
