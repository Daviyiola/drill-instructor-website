"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const bootcampCatalog = require("../data/bootcampCatalog");
const {contentVersionFor} = require("../data/contentVersions");
const {correctionsFor} = require("../data/contentCorrections");

// Kept as an export while both initial bootcamps share the same base version.
// New code should use datasetVersionFor(bootcamp).
const DATASET_VERSION = "2026.08.1";
const SUPPORTED_BOOTCAMPS = ["act", "sat"];
const CORRECTION_REVISION = Math.max(
    ...SUPPORTED_BOOTCAMPS.map((bootcamp) =>
      Number(contentVersionFor(bootcamp).correctionRevision || 0)),
);
const datasetCache = {};

/**
 * Normalize a short identifier used in an RTDB path.
 *
 * @param {*} value Candidate identifier
 * @param {number} maxLength Maximum length
 * @return {string} Safe identifier or an empty string
 */
function cleanSegment(value, maxLength = 120) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || /[.#$[\]/]/.test(text)) return "";
  return text;
}

/**
 * Resolve a signed-in Firebase account to its student profile.
 *
 * @param {Object} db Firebase database
 * @param {string} uid Firebase Auth UID
 * @return {Promise<Object>} Student context
 */
async function resolveStudent(db, uid) {
  const studentId = await resolveStudentId(db, uid);
  const user = (await db.ref(`users/${studentId}`).once("value")).val();
  if (!user || typeof user !== "object") {
    const error = new Error("Student profile was not found");
    error.code = 404;
    throw error;
  }
  return {studentId, user};
}

/**
 * Resolve only the compact UID mapping for endpoints that do not need a full
 * student profile. This prevents autosave from downloading the user's stats,
 * bookmarks, licenses, and history on every request.
 *
 * @param {Object} db Firebase database
 * @param {string} uid Firebase Auth UID
 * @return {Promise<string>} Student custom id
 */
async function resolveStudentId(db, uid) {
  const value = (await db.ref(`uidToCustom/${uid}`).once("value")).val();
  const studentId = cleanSegment(
      typeof value === "string" ? value : value && value.student,
  );
  if (!studentId) {
    const error = new Error("A linked student account was not found");
    error.code = 403;
    throw error;
  }
  return studentId;
}

/**
 * Load the versioned app dataset in an isolated JavaScript context.
 *
 * @param {string} bootcamp Bootcamp id
 * @return {Object[]} Subject records
 */
function loadDataset(bootcamp) {
  const id = String(bootcamp || "").toLowerCase();
  if (!SUPPORTED_BOOTCAMPS.includes(id)) return [];
  if (datasetCache[id]) return datasetCache[id];

  const filename = path.join(__dirname, "..", "data", `${id}Data.js`);
  const source = fs.readFileSync(filename, "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, {filename, timeout: 2000});
  const loaded = vm.runInContext(
      "typeof getSubjects === 'function' ? getSubjects() : " +
      "(typeof allSubjects !== 'undefined' ? allSubjects : [])",
      context,
      {filename, timeout: 2000},
  );
  const rows = Array.isArray(loaded) ? loaded : [];
  datasetCache[id] = rows;
  return rows;
}

/**
 * @param {string} bootcamp Bootcamp id
 * @return {string} Active immutable base version
 */
function datasetVersionFor(bootcamp) {
  const descriptor = contentVersionFor(bootcamp);
  return descriptor ? descriptor.datasetVersion : "";
}

/**
 * @param {string} bootcamp Bootcamp id
 * @return {number} Active cumulative correction revision
 */
function correctionRevisionFor(bootcamp) {
  const descriptor = contentVersionFor(bootcamp);
  return descriptor ? Number(descriptor.correctionRevision || 0) : 0;
}

const ACT_SECTION_SIZES = {
  Mathematics: 45,
  Science: 40,
  English: 50,
  Reading: 36,
};

/**
 * Preserve an authored practice-test label. ACT source rows that lack a
 * trusted label fall back to deterministic grouping; insertion order is stable.
 *
 * @param {string} bootcamp Bootcamp id
 * @param {string} subject Subject name
 * @param {number} ordinal One-based position inside the subject
 * @param {*} authoredValue Existing source label
 * @return {number} Canonical practice-test number
 */
function canonicalPracticeTest(bootcamp, subject, ordinal, authoredValue) {
  const authoredTest = Number(authoredValue);
  if (Number.isInteger(authoredTest) && authoredTest > 0) {
    return authoredTest;
  }
  if (bootcamp !== "act") return Number(authoredValue || 0);
  const size = ACT_SECTION_SIZES[subject];
  return size ? Math.floor((ordinal - 1) / size) + 1 :
    Number(authoredValue || 0);
}

/**
 * Whether a complete ACT subject has usable authored practice-test labels.
 * Old source files used `practiceYear: 1` as a placeholder on every row, so
 * labels are trusted only when every question is labeled and no test exceeds
 * the official section size. `practiceYear` is the sole authoring field for
 * every bootcamp.
 *
 * @param {Object[]} records Raw question records for one subject
 * @param {string} subject ACT subject
 * @return {boolean} Whether the labels can be used as authored
 */
function hasUsableAuthoredActTestLabels(records, subject) {
  const sectionSize = ACT_SECTION_SIZES[subject];
  if (!sectionSize || !records.length) return false;
  const counts = new Map();
  for (const raw of records) {
    const value = raw && raw.practiceYear;
    const test = Number(value);
    if (!Number.isInteger(test) || test < 1) return false;
    counts.set(test, (counts.get(test) || 0) + 1);
  }
  return [...counts.values()].every((count) => count <= sectionSize);
}

/**
 * Convert source image names to pack-relative WebP paths.
 *
 * @param {*} value Source image reference
 * @return {string[]} Pack-relative paths
 */
function canonicalAssetPaths(value) {
  const sources = Array.isArray(value) ? value :
    String(value || "").split("|");
  return [...new Set(sources.map((item) => String(item || "").trim())
      .filter(Boolean)
      .map((source) => {
        const basename = source.replace(/\\/g, "/").split("/").pop()
            .replace(/\.[^.]+$/, "");
        return basename ? `assets/${basename}.webp` : "";
      }).filter(Boolean))];
}

/**
 * Encode a visible subject label as a Realtime Database-safe timer key.
 * Subject labels may contain characters such as `.` that RTDB forbids in
 * object property names (for example SAT "Read. & Writ.").
 *
 * @param {*} subject Visible subject label
 * @return {string} Stable RTDB-safe key
 */
function subjectTimerKey(subject) {
  const encoded = Buffer.from(String(subject || ""), "utf8").toString("hex");
  return `subject_${encoded}`;
}

/**
 * Read a subject timer from either the public/legacy display-keyed shape or
 * the canonical RTDB-safe stored shape.
 *
 * @param {*} timers Timer map
 * @param {*} subject Visible subject label
 * @param {number} fallback Fallback seconds
 * @return {number} Timer value
 */
function subjectTimerValue(timers, subject, fallback = 0) {
  const source = timers && typeof timers === "object" ? timers : {};
  const direct = Number(source[String(subject || "")]);
  if (Number.isFinite(direct)) return direct;
  const stored = Number(source[subjectTimerKey(subject)]);
  return Number.isFinite(stored) ? stored : fallback;
}

/**
 * Project stored timers back to visible subject labels for web/native clients.
 * JSON permits these keys even though RTDB does not.
 *
 * @param {*} config Session subject configuration
 * @param {*} timers Stored timer map
 * @return {Object} Client timer map
 */
function publicTimerMap(config, timers) {
  const result = {};
  (Array.isArray(config) ? config : []).forEach((row) => {
    const subject = String(row && row.subject || "");
    if (!subject) return;
    result[subject] = subjectTimerValue(
        timers,
        subject,
        Number(row.timeLimitMin || 0) * 60,
    );
  });
  return result;
}

/**
 * Convert raw dataset records to normalized questions.
 *
 * @param {string} bootcamp Bootcamp id
 * @param {boolean} applyCorrections Apply the active cumulative overlay
 * @return {Object[]} Normalized questions
 */
function normalizedQuestions(bootcamp, applyCorrections = true) {
  const id = String(bootcamp || "").toLowerCase();
  const rows = loadDataset(bootcamp);
  const corrections = correctionsFor(id);
  const questions = [];
  const subjectOrdinals = new Map();
  const authoredActLabels = new Map();
  if (id === "act") {
    rows.forEach((row) => {
      const subject = String(row.subject || "").trim();
      const records = Object.keys(row)
          .filter((key) => key !== "subject" && row[key] &&
              typeof row[key] === "object")
          .map((key) => row[key]);
      authoredActLabels.set(
          subject, hasUsableAuthoredActTestLabels(records, subject),
      );
    });
  }
  rows.forEach((row) => {
    const subject = String(row.subject || "").trim();
    const subjectKey = subject.toLowerCase().replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    Object.keys(row).forEach((key) => {
      if (key === "subject") return;
      const raw = row[key];
      if (!raw || typeof raw !== "object") return;
      const options = [raw.option1, raw.option2, raw.option3, raw.option4]
          .map((option) => String(option || ""));
      const correctIndex = options.indexOf(String(raw.correctAnswer || ""));
      if (!subject || !raw.question || correctIndex < 0) return;
      const ordinal = (subjectOrdinals.get(subject) || 0) + 1;
      subjectOrdinals.set(subject, ordinal);
      const canonicalId = `${subjectKey}_${key}`;
      const normalized = {
        id: canonicalId,
        legacyId: `${subject}#${key}`,
        sourceId: String(key),
        subject,
        module: String(raw.module || "General"),
        practiceYear: canonicalPracticeTest(id, subject, ordinal,
            id === "act" && !authoredActLabels.get(subject) ? null :
              raw.practiceYear),
        prompt: String(raw.question || ""),
        passage: String(raw.passage || ""),
        imageSources: canonicalAssetPaths(
            raw.imageSources !== undefined ? raw.imageSources :
              raw.imageSource,
        ),
        options,
        correctIndex,
        explanation: String(raw.explanation || ""),
        disabled: false,
      };
      const correction = applyCorrections ? corrections[canonicalId] : null;
      if (correction && typeof correction === "object") {
        const translated = {...correction};
        if (Object.prototype.hasOwnProperty.call(translated, "answerIndex")) {
          translated.correctIndex = Number(translated.answerIndex);
          delete translated.answerIndex;
        }
        if (Object.prototype.hasOwnProperty.call(translated, "imageSource") ||
            Object.prototype.hasOwnProperty.call(translated, "imageSources")) {
          translated.imageSources = canonicalAssetPaths(
              translated.imageSources !== undefined ?
                translated.imageSources : translated.imageSource,
          );
          delete translated.imageSource;
        }
        Object.assign(normalized, translated);
      }
      questions.push(normalized);
    });
  });
  return questions;
}

/**
 * Build subject, module, year, and question-count metadata.
 *
 * @param {string} bootcamp Bootcamp id
 * @return {Object} Catalog metadata
 */
function buildCatalog(bootcamp) {
  const questions = normalizedQuestions(bootcamp);
  const subjects = {};
  questions.forEach((question) => {
    if (!subjects[question.subject]) {
      subjects[question.subject] = {
        name: question.subject,
        modules: new Set(),
        practiceYears: new Set(),
        questionCount: 0,
      };
    }
    const subject = subjects[question.subject];
    subject.modules.add(question.module);
    if (question.practiceYear > 0) {
      subject.practiceYears.add(question.practiceYear);
    }
    subject.questionCount += 1;
  });
  const manifest = bootcampCatalog[bootcamp] || {subjects: []};
  const manifestSubjects = new Map(
      manifest.subjects.map((subject) => [subject.name, subject]),
  );
  const orderedNames = [
    ...manifest.subjects.map((subject) => subject.name),
    ...Object.keys(subjects).filter((name) => !manifestSubjects.has(name))
        .sort(),
  ];
  return {
    bootcamp,
    datasetVersion: datasetVersionFor(bootcamp),
    correctionRevision: correctionRevisionFor(bootcamp),
    subjects: orderedNames.filter((name) => subjects[name]).map((name) => {
      const subject = subjects[name];
      const preferred = manifestSubjects.get(name);
      const preferredModules = preferred ? preferred.modules : [];
      const modules = [
        ...preferredModules.filter((module) => subject.modules.has(module)),
        ...[...subject.modules].filter((module) =>
          !preferredModules.includes(module)).sort(),
      ];
      return {
        name: subject.name,
        modules,
        practiceYears: [...subject.practiceYears].sort((a, b) => a - b),
        questionCount: subject.questionCount,
      };
    }),
  };
}

/**
 * Shuffle a copy of an array.
 *
 * @param {Object[]} values Input values
 * @return {Object[]} Shuffled copy
 */
function shuffled(values) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = crypto.randomInt(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/**
 * Normalize one passage or image value used to identify a shared stimulus.
 *
 * @param {*} value Candidate stimulus value
 * @return {string} Normalized value
 */
function normalizedStimulusPart(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Identify questions that must remain together when a paper is shuffled.
 *
 * Questions without a passage or image deliberately receive unique keys.
 *
 * @param {Object} question Normalized question
 * @return {string} Stimulus-group key
 */
function questionStimulusKey(question) {
  if (!question) return "";
  const passage = normalizedStimulusPart(question.passage);
  const imageSources = canonicalAssetPaths(question.imageSources);
  if (!passage && imageSources.length === 0) {
    return `independent|${String(question.id || "")}`;
  }
  return `stimulus|${passage}|${JSON.stringify(imageSources)}`;
}

/**
 * Preserve source order while grouping questions by passage and image.
 *
 * @param {Object[]} questions Candidate questions
 * @return {Array<{key:string, questions:Object[]}>} Stimulus groups
 */
function groupQuestionsByStimulus(questions) {
  const groupsByKey = new Map();
  const groups = [];
  questions.forEach((question) => {
    const key = questionStimulusKey(question);
    if (!groupsByKey.has(key)) {
      const group = {key, questions: []};
      groupsByKey.set(key, group);
      groups.push(group);
    }
    groupsByKey.get(key).questions.push(question);
  });
  return groups;
}

/**
 * Select one random consecutive portion of a stimulus group.
 *
 * @param {Object[]} questions Ordered questions in one group
 * @param {number} count Required number
 * @return {Object[]} Consecutive question window
 */
function randomConsecutiveWindow(questions, count) {
  if (!Array.isArray(questions) || questions.length === 0 || count <= 0) {
    return [];
  }
  if (count >= questions.length) return questions.slice();
  const start = crypto.randomInt(questions.length - count + 1);
  return questions.slice(start, start + count);
}

/**
 * Port the app's stimulus-aware smart selection algorithm.
 *
 * Group order is randomized, question order inside a group is preserved, and
 * an oversized final group contributes one random consecutive window.
 *
 * @param {Object[]} candidates Filtered candidate questions
 * @param {number} maxCount Maximum paper size
 * @return {Object[]} Selected questions
 */
function smartSelectQuestions(candidates, maxCount) {
  const limit = Math.max(0, Number(maxCount || 0));
  if (limit <= 0 || !Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }
  if (candidates.length <= limit) return candidates.slice();

  const groups = shuffled(groupQuestionsByStimulus(candidates));
  const selected = [];
  for (const group of groups) {
    if (selected.length >= limit) break;
    const remaining = limit - selected.length;
    if (group.questions.length <= remaining) {
      selected.push(...group.questions);
    } else {
      selected.push(...randomConsecutiveWindow(group.questions, remaining));
    }
  }
  return selected;
}

/**
 * Select questions deterministically from the earliest available practice
 * test while preserving passage/image groups and their source order.
 *
 * @param {Object[]} candidates Filtered candidate questions
 * @param {number} maxCount Maximum paper size
 * @return {Object[]} Selected questions
 */
function orderedSelectQuestions(candidates, maxCount) {
  const limit = Math.max(0, Number(maxCount || 0));
  if (limit <= 0 || !Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }
  const ordered = candidates.slice().sort((left, right) => {
    const testDifference = Number(left.practiceYear || 0) -
      Number(right.practiceYear || 0);
    if (testDifference) return testDifference;
    return String(left.id || "").localeCompare(String(right.id || ""),
        undefined, {numeric: true});
  });
  if (ordered.length <= limit) return ordered;
  const selected = [];
  for (const group of groupQuestionsByStimulus(ordered)) {
    if (selected.length >= limit) break;
    selected.push(...group.questions.slice(0, limit - selected.length));
  }
  return selected;
}

/**
 * Validate a client drill configuration and select its question paper.
 *
 * @param {string} bootcamp Bootcamp id
 * @param {*} input Client configuration
 * @param {boolean} licensed Whether all practice years are unlocked
 * @return {Object} Validated configuration and selected questions
 */
function buildPaper(bootcamp, input, licensed) {
  const requested = input && Array.isArray(input.subjects) ?
    input.subjects : [];
  if (requested.length < 1 || requested.length > 4) {
    const error = new Error("Choose between one and four subjects");
    error.code = 400;
    throw error;
  }

  const all = normalizedQuestions(bootcamp);
  const catalog = buildCatalog(bootcamp);
  const byName = Object.fromEntries(
      catalog.subjects.map((subject) => [subject.name, subject]),
  );
  const selected = [];
  const config = [];
  const seen = new Set();

  requested.forEach((row) => {
    const subject = String(row && row.subject || "").trim();
    if (!byName[subject] || seen.has(subject)) {
      const error = new Error("The drill contains an invalid subject");
      error.code = 400;
      throw error;
    }
    seen.add(subject);
    const rawCount = Number(row.questionCount || 20);
    const count = Number.isFinite(rawCount) ?
      Math.min(40, Math.max(5, Math.floor(rawCount))) : 20;
    const rawTimeLimit = Number(row.timeLimitMin || 30);
    const timeLimitMin = Math.min(
        120,
        Math.max(5, Number.isFinite(rawTimeLimit) ? rawTimeLimit : 30),
    );
    const requestedModules = Array.isArray(row.modules) ?
      row.modules.map(String) : [];
    const validModules = requestedModules.filter((module) =>
      byName[subject].modules.includes(module));
    const requestedYears = Array.isArray(row.practiceYears) ?
      row.practiceYears.map(Number) : [];
    const allowedYears = licensed ? byName[subject].practiceYears :
      byName[subject].practiceYears.filter((year) => year <= 2);
    const filteredYears = requestedYears.filter((year) =>
      allowedYears.includes(year));
    const years = filteredYears.length ? filteredYears : allowedYears;
    const candidates = all.filter((question) =>
      !question.disabled &&
      question.subject === subject &&
      (validModules.length === 0 || validModules.includes(question.module)) &&
      (years.length === 0 || years.includes(question.practiceYear)));
    const picked = smartSelectQuestions(candidates, count);
    if (picked.length === 0) {
      const error = new Error(`No questions match the ${subject} filters`);
      error.code = 400;
      throw error;
    }
    selected.push(...picked);
    config.push({
      subject,
      questionCount: picked.length,
      timeLimitMin,
      modules: validModules,
      practiceYears: years,
    });
  });

  return {config, questions: selected};
}

/**
 * Remove grading-only fields from an active question.
 *
 * @param {Object} question Stored question
 * @return {Object} Browser-safe active question
 */
function publicQuestion(question) {
  const visible = {...question};
  visible.imageSources = canonicalAssetPaths(
      question.imageSources !== undefined ?
        question.imageSources : question.imageSource,
  );
  delete visible.imageSource;
  delete visible.correctIndex;
  delete visible.explanation;
  return visible;
}

/**
 * Return an active session without answer keys.
 *
 * @param {Object} session Stored session
 * @return {Object} Browser-safe session
 */
function publicSession(session) {
  return {
    sessionId: session.sessionId,
    status: session.status,
    mode: session.mode || "practice",
    challengeId: session.challengeId || "",
    assignmentId: session.assignmentId || "",
    dueAt: session.dueAt || "",
    assignmentRelease: session.assignmentRelease || null,
    bootcamp: session.bootcamp,
    datasetVersion: session.datasetVersion,
    correctionRevision: Number(session.correctionRevision || 0),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt || session.createdAt,
    config: session.config,
    questions: (session.questions || []).map(publicQuestion),
    answers: session.answers || {},
    bookmarks: session.bookmarks || {},
    flags: session.flags || {},
    questionTimes: session.questionTimes || {},
    timers: publicTimerMap(session.config, session.timers),
    currentQuestionId: session.currentQuestionId || "",
    progressRevision: Number(session.progressRevision || 0),
  };
}

/**
 * Grade a completed drill and create the durable result snapshot.
 *
 * @param {Object} session Stored active session
 * @param {Object} answers Submitted answer map
 * @param {Object} timers Submitted timer map
 * @param {number} endedAt Completion timestamp
 * @return {Object} Result snapshot
 */
function gradeSession(session, answers, timers, endedAt = Date.now()) {
  const questions = Array.isArray(session.questions) ? session.questions : [];
  const safeAnswers = answers && typeof answers === "object" ? answers : {};
  const questionTimes = session.questionTimes &&
    typeof session.questionTimes === "object" ? session.questionTimes : {};
  let attempted = 0;
  let correct = 0;
  const feedback = questions.map((question, index) => {
    const selectedIndex = Number.isInteger(safeAnswers[question.id]) ?
      safeAnswers[question.id] : null;
    const isAttempted = selectedIndex !== null && selectedIndex >= 0 &&
      selectedIndex < question.options.length;
    const isCorrect = isAttempted && selectedIndex === question.correctIndex;
    if (isAttempted) attempted += 1;
    if (isCorrect) correct += 1;
    return {
      position: index + 1,
      ...publicQuestion(question),
      selectedIndex,
      correctIndex: question.correctIndex,
      isCorrect,
      timeSpentSec: Math.max(
          0,
          Math.floor(Number(questionTimes[question.id] || 0)),
      ),
      explanation: question.explanation,
    };
  });
  const totalQ = questions.length;
  const wrong = attempted - correct;
  const unanswered = totalQ - attempted;
  const points = (3 * correct) + wrong;
  const subjectSummary = session.config.map((config) => {
    const rows = feedback.filter((row) => row.subject === config.subject);
    const subjectAttempted = rows.filter((row) =>
      row.selectedIndex !== null).length;
    const subjectCorrect = rows.filter((row) => row.isCorrect).length;
    const usedSec = rows.reduce(
        (total, row) => total + row.timeSpentSec,
        0,
    );
    return {
      subject: config.subject,
      totalQ: rows.length,
      attempted: subjectAttempted,
      correct: subjectCorrect,
      wrong: subjectAttempted - subjectCorrect,
      unanswered: rows.length - subjectAttempted,
      scorePct: subjectAttempted ?
        Math.round((subjectCorrect / subjectAttempted) * 1000) / 10 : 0,
      usedSec,
      averageTimeSec: subjectAttempted ?
        Math.round((usedSec / subjectAttempted) * 10) / 10 : 0,
      timeLimitSec: config.timeLimitMin * 60,
      remainingSec: Math.max(0, subjectTimerValue(
          timers,
          config.subject,
          0,
      )),
    };
  });
  const moduleGroups = new Map();
  feedback.forEach((row) => {
    const key = `${row.subject}\u0000${row.module}`;
    if (!moduleGroups.has(key)) {
      moduleGroups.set(key, {
        subject: row.subject,
        module: row.module,
        rows: [],
      });
    }
    moduleGroups.get(key).rows.push(row);
  });
  const modules = [...moduleGroups.values()].map((group) => {
    const moduleRows = group.rows;
    const attemptedRows = moduleRows.filter((row) =>
      row.selectedIndex !== null);
    const moduleCorrect = attemptedRows.filter((row) => row.isCorrect).length;
    const usedSec = moduleRows.reduce(
        (total, row) => total + row.timeSpentSec,
        0,
    );
    return {
      subject: group.subject,
      module: group.module,
      totalQ: moduleRows.length,
      attempted: attemptedRows.length,
      correct: moduleCorrect,
      wrong: attemptedRows.length - moduleCorrect,
      unanswered: moduleRows.length - attemptedRows.length,
      scorePct: attemptedRows.length ?
        Math.round((moduleCorrect / attemptedRows.length) * 1000) / 10 : 0,
      usedSec,
      averageTimeSec: attemptedRows.length ?
        Math.round((usedSec / attemptedRows.length) * 10) / 10 : 0,
    };
  });
  return {
    sessionId: session.sessionId,
    type: "results_snapshot",
    v: 2,
    bootcamp: session.bootcamp,
    datasetVersion: session.datasetVersion,
    correctionRevision: Number(session.correctionRevision || 0),
    takenAt: new Date(session.createdAt).toISOString(),
    createdAt: new Date(endedAt).toISOString(),
    summary: {
      totalQ,
      attempted,
      correct,
      wrong,
      unanswered,
      points,
      scorePct: attempted ?
        Math.round((correct / attempted) * 1000) / 10 : 0,
      usedSec: Math.max(0, Math.floor((endedAt - session.createdAt) / 1000)),
    },
    subjects: subjectSummary,
    modules,
    answers: feedback,
  };
}

/**
 * Remove immutable question content from a result before persistence. The
 * pinned dataset/correction coordinates on the result are sufficient to
 * reconstruct review content later.
 *
 * @param {Object} result Full server-graded result
 * @param {Object=} attemptState Attempt-specific bookmark/flag state
 * @return {Object} Compact durable result
 */
function compactResult(result, attemptState = {}) {
  return {
    ...result,
    v: 3,
    answers: collectionValues(result && result.answers).map((answer) => ({
      id: String(answer.id || ""),
      position: Number(answer.position || 0),
      selectedIndex: Number.isInteger(answer.selectedIndex) ?
        answer.selectedIndex : null,
      correctIndex: Number(answer.correctIndex),
      isCorrect: answer.isCorrect === true,
      timeSpentSec: Math.max(0, Number(answer.timeSpentSec || 0)),
      ...(attemptState.bookmarks && attemptState.bookmarks[answer.id] ?
        {bookmarked: true} : {}),
      ...(attemptState.flags && attemptState.flags[answer.id] ?
        {flagged: true} : {}),
    })),
  };
}

/**
 * Join a compact v3 result to the exact immutable question rows selected for
 * the attempt. Legacy v2 results already contain their own review payload.
 *
 * @param {Object} result Stored result
 * @param {Object[]} questions Pinned question bank rows
 * @return {Object} Public review result
 */
function hydrateResult(result, questions) {
  if (!result || Number(result.v || 0) < 3) return result;
  const byId = new Map((Array.isArray(questions) ? questions : [])
      .map((question) => [String(question.id || ""), question]));
  const answers = collectionValues(result.answers).map((answer) => {
    const question = byId.get(String(answer.id || ""));
    if (!question) return null;
    return {
      position: Number(answer.position || 0),
      ...publicQuestion(question),
      selectedIndex: Number.isInteger(answer.selectedIndex) ?
        answer.selectedIndex : null,
      correctIndex: Number(question.correctIndex),
      isCorrect: answer.isCorrect === true,
      timeSpentSec: Math.max(0, Number(answer.timeSpentSec || 0)),
      explanation: String(question.explanation || ""),
      ...(answer.bookmarked ? {bookmarked: true} : {}),
      ...(answer.flagged ? {flagged: true} : {}),
    };
  }).filter(Boolean);
  if (answers.length !== collectionValues(result.answers).length) {
    const error = new Error("Pinned drill content is incomplete");
    error.code = 409;
    throw error;
  }
  return {...result, answers};
}

/**
 * Convert an RTDB array or numeric-key object to a normal array.
 *
 * @param {*} value Candidate collection
 * @return {Object[]} Collection values
 */
function collectionValues(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.values(value);
}

/**
 * Build module summaries when a legacy snapshot omitted its module index.
 *
 * @param {Object[]} answers Normalized answer rows
 * @return {Object[]} Module breakdowns
 */
function moduleBreakdownsFromAnswers(answers) {
  const groups = new Map();
  answers.forEach((answer) => {
    const subject = String(answer.subject || "General");
    const module = String(answer.module || "General");
    const key = `${subject}\u0000${module}`;
    if (!groups.has(key)) groups.set(key, {subject, module, rows: []});
    groups.get(key).rows.push(answer);
  });
  return [...groups.values()].map((group) => {
    const attemptedRows = group.rows.filter((row) =>
      Number.isInteger(row.selectedIndex) &&
      row.selectedIndex >= 0 &&
      row.selectedIndex < row.options.length);
    const correct = attemptedRows.filter((row) => row.isCorrect).length;
    const usedSec = attemptedRows.reduce(
        (total, row) => total + Math.max(0, Number(row.timeSpentSec || 0)),
        0,
    );
    return {
      subject: group.subject,
      module: group.module,
      totalQ: group.rows.length,
      attempted: attemptedRows.length,
      correct,
      wrong: attemptedRows.length - correct,
      unanswered: group.rows.length - attemptedRows.length,
      scorePct: attemptedRows.length ?
        Math.round((correct / attemptedRows.length) * 1000) / 10 : 0,
      usedSec,
      averageTimeSec: attemptedRows.length ?
        Math.round((usedSec / attemptedRows.length) * 10) / 10 : 0,
    };
  });
}

/**
 * Convert a mobile-app snapshot to the web result contract.
 *
 * @param {Object} snapshot Existing results snapshot
 * @return {Object} Normalized result
 */
function normalizeLegacyResult(snapshot) {
  const answers = collectionValues(snapshot.answers);
  const feedback = answers.map((answer, index) => {
    const payload = answer.questionPayload || answer.payload || {};
    const options = [
      payload.option1,
      payload.option2,
      payload.option3,
      payload.option4,
    ].map((value) => String(value || ""));
    const correctText = String(
        answer.correctAnswer || payload.correctAnswer || "",
    );
    const selectedText = String(answer.selectedAnswer || "");
    const selectedMatch = options.indexOf(selectedText);
    return {
      id: cleanSegment(answer.questionId, 120) || `legacy_${index + 1}`,
      sourceId: String(answer.questionId || index + 1),
      position: Number(answer.position || index + 1),
      subject: String(answer.subject || payload.subject || "General"),
      module: String(answer.module || payload.module || "General"),
      practiceYear: Number(payload.practiceYear || 0),
      prompt: String(payload.question || answer.question || ""),
      passage: String(payload.passage || ""),
      imageSources: canonicalAssetPaths(
          payload.imageSources !== undefined ? payload.imageSources :
            payload.imageSource,
      ),
      options,
      selectedIndex: selectedText && selectedMatch >= 0 ? selectedMatch : null,
      correctIndex: options.indexOf(correctText),
      isCorrect: answer.isCorrect === true ||
        (selectedText !== "" && selectedText === correctText),
      timeSpentSec: Number(answer.timeSpentSec || answer.time_taken_ms / 1000 ||
        0),
      explanation: String(payload.explanation || ""),
    };
  });
  const summary = snapshot.summary || {};
  const totalQ = Number(summary.totalQ || 0);
  const correct = Number(summary.correct || 0);
  const subjects = collectionValues(snapshot.subjects)
      .map((subject) => ({
        subject: String(subject.subject || subject.code || "General"),
        totalQ: Number(subject.totalQ || 0),
        attempted: Number(subject.attempted || 0),
        correct: Number(subject.correct || 0),
        wrong: Number(subject.wrong || 0),
        unanswered: Number(subject.unanswered || 0),
        scorePct: Number(subject.scorePct || 0),
        usedSec: Number(subject.usedSec || subject.time_spent_sec ||
          subject.timeSec || 0),
        averageTimeSec: Number(subject.averageTimeSec ||
          subject.meanSec || 0),
        timeLimitSec: Number(subject.timer_alloc_sec || subject.timeSec || 0),
        remainingSec: 0,
      }));
  const storedModules = collectionValues(snapshot.modules)
      .map((module) => {
        const attempted = Number(module.attempted || 0);
        const totalQ = Number(module.totalQ || attempted);
        const correct = Number(module.correct || 0);
        const usedSec = Number(module.usedSec || module.timeSec ||
          module.time_spent_sec || 0);
        return {
          subject: String(module.subject || module.subjectCode ||
            module.subject_code || "General"),
          module: String(module.module || module.code || "General"),
          totalQ,
          attempted,
          correct,
          wrong: Number(module.wrong !== undefined ?
            module.wrong : Math.max(0, attempted - correct)),
          unanswered: Number(
              module.unanswered !== undefined ?
                module.unanswered : Math.max(0, totalQ - attempted),
          ),
          scorePct: Number(module.scorePct !== undefined ?
            module.scorePct : attempted ? correct / attempted * 100 : 0),
          usedSec,
          averageTimeSec: Number(
              module.averageTimeSec !== undefined ?
                module.averageTimeSec :
                module.meanSec !== undefined ?
                  module.meanSec :
                  attempted ? usedSec / attempted : 0,
          ),
        };
      });
  const modules = storedModules.length ?
    storedModules : moduleBreakdownsFromAnswers(feedback);
  const attempted = Number(summary.attempted || 0);
  return {
    ...snapshot,
    sessionId: String(snapshot.sessionId || snapshot.session_id || ""),
    datasetVersion: String(snapshot.datasetVersion || "legacy"),
    summary: {
      totalQ,
      attempted,
      correct,
      wrong: Number(summary.wrong || 0),
      unanswered: Number(summary.unanswered || 0),
      points: Number(summary.points || 0),
      scorePct: summary.scorePct !== undefined ?
        Number(summary.scorePct) : attempted ? (correct / attempted) * 100 : 0,
      usedSec: Number(summary.usedSec || snapshot.durationSec || 0),
    },
    subjects,
    modules,
    answers: feedback,
  };
}

module.exports = {
  CORRECTION_REVISION,
  DATASET_VERSION,
  SUPPORTED_BOOTCAMPS,
  buildCatalog,
  buildPaper,
  canonicalAssetPaths,
  canonicalPracticeTest,
  hasUsableAuthoredActTestLabels,
  cleanSegment,
  correctionRevisionFor,
  compactResult,
  gradeSession,
  hydrateResult,
  loadDataset,
  datasetVersionFor,
  normalizedQuestions,
  normalizeLegacyResult,
  publicQuestion,
  publicSession,
  orderedSelectQuestions,
  questionStimulusKey,
  resolveStudent,
  resolveStudentId,
  smartSelectQuestions,
  subjectTimerKey,
  subjectTimerValue,
};
