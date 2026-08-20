"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");

/**
 * Send standardized error response.
 *
 * @param {Object} res Express response
 * @param {number} code HTTP status code
 * @param {string} msg Error message
 * @param {*} [details] Optional details
 * @return {Object}
 */
function bad(res, code, msg, details) {
  return res.status(code).json({
    ok: false,
    error: msg,
    details: details || null,
  });
}

/**
 * Clean and truncate string.
 *
 * @param {*} v Input value
 * @param {number} maxLen Max length
 * @return {string}
 */
function cleanStr(v, maxLen) {
  const s = (v || "").toString().trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Safe error text.
 *
 * @param {unknown} e Error
 * @return {string}
 */
function errText(e) {
  if (!e) return "Internal error";
  if (typeof e === "string") return e;

  if (typeof e === "object") {
    const anyErr = e;
    if (typeof anyErr.message === "string" && anyErr.message) {
      return anyErr.message;
    }
  }

  try {
    return JSON.stringify(e);
  } catch (_) {
    return String(e);
  }
}

/**
 * Normalize uidToCustom educator mapping.
 *
 * @param {*} val Mapping node
 * @return {string}
 */
function normalizeUidToEducator(val) {
  if (!val) return "";
  if (typeof val === "string") return cleanStr(val, 120);
  if (typeof val === "object") return cleanStr(val.educator, 120);
  return "";
}

/**
 * Object guard.
 *
 * @param {*} value Any value
 * @return {Object}
 */
function asObj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ?
    value :
    {};
}

/**
 * Array guard.
 *
 * @param {*} value Any value
 * @return {Array}
 */
function asArr(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Normalize canonical ordered image references.
 *
 * @param {*} value Image reference collection
 * @return {Array<string>}
 */
function imageSources(value) {
  const values = Array.isArray(value) ? value : String(value || "").split("|");
  return values.map((item) => cleanStr(item, 1000)).filter(Boolean);
}

/**
 * Build full student name.
 *
 * @param {Object} student Student profile
 * @param {string} fallback Fallback id/name
 * @return {string}
 */
function studentDisplayName(student, fallback) {
  const first = cleanStr(student.firstName, 80);
  const last = cleanStr(student.lastName, 80);
  const full = `${first} ${last}`.trim();

  return full ||
    cleanStr(student.studentName, 160) ||
    cleanStr(student.displayName, 160) ||
    cleanStr(fallback, 160) ||
    "Student";
}

/**
 * Normalize summary object.
 *
 * @param {Object} summary Summary row
 * @return {Object}
 */
function normalizeSummary(summary) {
  const s = asObj(summary);

  const totalQ = Math.max(0, Number(s.totalQ || s.totalQuestions || 0));
  const attempted = Math.max(0, Number(s.attempted || 0));
  const correct = Math.max(0, Number(s.correct || 0));
  const wrong = Math.max(0, Number(s.wrong || attempted - correct || 0));
  const unanswered = Math.max(
      0, Number(s.unanswered || totalQ - attempted || 0));
  const usedSec = Math.max(0, Number(s.usedSec || s.timeSec || 0));
  const meanSec = Math.max(
      0,
      Number(s.meanSec || (
        attempted > 0 ? Math.floor(usedSec / attempted) : 0)),
  );
  const points = Math.max(0, Number(s.points || 0));

  return {
    totalQ,
    attempted,
    correct,
    wrong,
    unanswered,
    usedSec,
    meanSec,
    points,
    scorePct: totalQ > 0 ? Math.round((correct * 10000) / totalQ) / 100 : 0,
    accuracyPct: attempted > 0 ?
      Math.round((correct * 10000) / attempted) / 100 :
      0,
  };
}

/**
 * Normalize subject rows.
 *
 * @param {Array} subjects Subjects
 * @return {Array<Object>}
 */
function normalizeSubjects(subjects) {
  const out = [];

  for (const row of asArr(subjects)) {
    const r = asObj(row);
    const code = cleanStr(r.code || r.subject || r.subject_code, 120);
    if (!code) continue;

    const attempted = Math.max(0, Number(r.attempted || 0));
    const correct = Math.max(0, Number(r.correct || 0));
    const totalQ = Math.max(
        0, Number(r.totalQ || r.totalQuestions || attempted || 0));
    const usedSec = Math.max(
        0, Number(r.timeSec || r.time_sec || r.usedSec || 0));

    out.push({
      code,
      subject: code,
      totalQ,
      attempted,
      correct,
      wrong: Math.max(0, Number(r.wrong || attempted - correct || 0)),
      unanswered: Math.max(0, Number(r.unanswered || totalQ - attempted || 0)),
      timeSec: usedSec,
      usedSec,
      meanSec: attempted > 0 ? Math.floor(usedSec / attempted) : 0,
      averageTimeSec: attempted > 0 ? usedSec / attempted : 0,
      scorePct: totalQ > 0 ? Math.round((correct * 10000) / totalQ) / 100 : 0,
      accuracyPct: attempted > 0 ?
        Math.round((correct * 10000) / attempted) / 100 :
        0,
    });
  }

  return out;
}

/**
 * Normalize module rows.
 *
 * @param {Array} modules Modules
 * @return {Array<Object>}
 */
function normalizeModules(modules) {
  const out = [];

  for (const row of asArr(modules)) {
    const r = asObj(row);

    const subjectCode = cleanStr(
        r.subject_code || r.subjectCode || r.subject || "",
        120,
    );

    const code = cleanStr(r.code || r.module || r.module_code || "", 180);

    if (!subjectCode || !code) continue;

    const attempted = Math.max(0, Number(r.attempted || 0));
    const correct = Math.max(0, Number(r.correct || 0));
    const totalQ = Math.max(
        0, Number(r.totalQ || r.totalQuestions || attempted || 0));
    const usedSec = Math.max(
        0, Number(r.timeSec || r.time_sec || r.usedSec || 0));

    out.push({
      subject_code: subjectCode,
      subject: subjectCode,
      code,
      module: code,
      totalQ,
      attempted,
      correct,
      wrong: Math.max(0, Number(r.wrong || attempted - correct || 0)),
      unanswered: Math.max(0, Number(r.unanswered || totalQ - attempted || 0)),
      timeSec: usedSec,
      usedSec,
      meanSec: attempted > 0 ? Math.floor(usedSec / attempted) : 0,
      averageTimeSec: attempted > 0 ? usedSec / attempted : 0,
      scorePct: totalQ > 0 ? Math.round((correct * 10000) / totalQ) / 100 : 0,
      accuracyPct: attempted > 0 ?
        Math.round((correct * 10000) / attempted) / 100 :
        0,
    });
  }

  return out;
}

/**
 * Preview question text.
 *
 * @param {Object} payload Question payload
 * @param {string} fallback Fallback
 * @return {string}
 */
function questionPreview(payload, fallback) {
  const p = asObj(payload);

  const candidates = [
    p.question,
    p.questionText,
    p.prompt,
    p.stem,
    p.title,
    p.name,
    p.text,
  ];

  for (const value of candidates) {
    const q = cleanStr(value, 1000);
    if (q) return q;
  }

  return cleanStr(fallback, 240);
}

/**
 * Normalize answer rows.
 *
 * @param {Array} answers Answers
 * @return {Array<Object>}
 */
function normalizeAnswers(answers) {
  const out = [];

  for (let i = 0; i < asArr(answers).length; i++) {
    const row = asObj(answers[i]);

    const questionId = cleanStr(
        row.questionId || row.question_id || row.id || row.sourceId ||
          row.source_id || "",
        240,
    );

    if (!questionId) continue;

    const payload = asObj(
        row.payload || row.questionPayload || row.question_payload);
    const options = asArr(row.options).length ? asArr(row.options) : [
      payload.option1,
      payload.option2,
      payload.option3,
      payload.option4,
    ];
    const selectedIndex = row.selectedIndex !== undefined &&
      row.selectedIndex !== null ? Number(row.selectedIndex) : null;
    const correctIndex = row.correctIndex !== undefined &&
      row.correctIndex !== null ? Number(row.correctIndex) : null;
    const selectedAnswer = cleanStr(
        row.selectedAnswer || row.chosen_option || row.chosenOption || "",
        2000,
    ) || (selectedIndex !== null && selectedIndex >= 0 ?
      cleanStr(options[selectedIndex], 2000) : "");
    const correctAnswer = cleanStr(
        row.correctAnswer || row.correct_option || row.correctOption || "",
        2000,
    ) || (correctIndex !== null && correctIndex >= 0 ?
      cleanStr(options[correctIndex], 2000) : "");

    const subject = cleanStr(
        row.subjectCode ||
          row.subject ||
          row.subject_code ||
          payload.subject ||
          "",
        120,
    );

    const module = cleanStr(
        row.moduleCode ||
          row.module ||
          row.module_code ||
          payload.module ||
          "",
        180,
    );

    const isCorrect =
      row.isCorrect === true ||
      row.is_correct === true ||
      row.is_correct === 1 ||
      (selectedAnswer !== "" &&
        correctAnswer !== "" &&
        selectedAnswer === correctAnswer);

    const deliveredPosition = Math.max(
        1,
        Number(row.position || i + 1),
    );

    out.push({
      questionId,
      index: deliveredPosition,
      subject,
      module,
      practiceYear: Number(
          row.practiceYear || row.practiceTest || payload.practiceYear ||
          payload.practiceTest || 0),
      question: cleanStr(row.prompt || row.question, 10000) ||
        questionPreview(payload, questionId),

      selectedAnswer,
      correctAnswer,
      isCorrect,
      selectedIndex: selectedIndex !== null && selectedIndex >= 0 ?
        selectedIndex : null,
      correctIndex: correctIndex !== null && correctIndex >= 0 ?
        correctIndex : null,
      selectedOptionIdx: Math.max(
          0,
          selectedIndex !== null && selectedIndex >= 0 ? selectedIndex + 1 :
            Number(
                row.selectedOptionIdx || row.selectedOption ||
                row.selected_option_idx || 0),
      ),
      timeTakenMs: Math.max(
          0,
          Number(row.timeTakenMs || row.time_taken_ms || 0),
      ),

      option1: cleanStr(options[0], 2000),
      option2: cleanStr(options[1], 2000),
      option3: cleanStr(options[2], 2000),
      option4: cleanStr(options[3], 2000),
      explanation: cleanStr(
          row.explanation || payload.explanation || payload.solution ||
          payload.rationale || "",
          5000,
      ),
      passage: cleanStr(row.passage || payload.passage || "", 20000),
      imageSources: imageSources(
          row.imageSources !== undefined ? row.imageSources :
            payload.imageSources !== undefined ? payload.imageSources :
              payload.imageSource),

      payload,
    });
  }

  return out;
}

/**
 * Build the drill's original question order from its saved blueprint.
 *
 * @param {Object} drill Drill row
 * @return {Map<string, number>} Question ID to blueprint position
 */
function buildBlueprintOrderMap(drill) {
  const orderMap = new Map();
  const blueprint = asObj(drill.blueprint);
  const subjects = Array.isArray(blueprint.subjects) ?
    blueprint.subjects :
    [];

  let position = 1;

  for (const subjectRow of subjects) {
    const row = asObj(subjectRow);
    const questionIds = Array.isArray(row.questionIds) ?
      row.questionIds :
      [];

    for (const rawId of questionIds) {
      const questionId = cleanStr(rawId, 240);

      if (!questionId || orderMap.has(questionId)) {
        continue;
      }

      orderMap.set(questionId, position);
      position++;
    }
  }

  return orderMap;
}

/**
 * Sort educator-facing answers into the original blueprint order.
 *
 * The answer's `index` remains the student's delivered position.
 *
 * @param {Array<Object>} answers Normalized answers
 * @param {Object} drill Drill row
 * @return {Array<Object>}
 */
function sortAnswersByBlueprint(answers, drill) {
  const rows = asArr(answers).slice();
  const orderMap = buildBlueprintOrderMap(drill);

  // Safe fallback for older drills without a saved blueprint.
  if (orderMap.size < 1) {
    return rows;
  }

  rows.sort((a, b) => {
    const aOrder = orderMap.has(a.questionId) ?
      orderMap.get(a.questionId) :
      Number.MAX_SAFE_INTEGER;

    const bOrder = orderMap.has(b.questionId) ?
      orderMap.get(b.questionId) :
      Number.MAX_SAFE_INTEGER;

    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }

    // Unknown questions preserve their delivered order.
    return Number(a.index || 0) - Number(b.index || 0);
  });

  for (const row of rows) {
    row.originalIndex = orderMap.has(row.questionId) ?
      Number(orderMap.get(row.questionId)) : Number(row.index || 0);
  }

  return rows;
}


/**
 * Check educator can view this drill.
 *
 * V1:
 * - creator
 * - adminAccess
 * - superAdmin
 *
 * @param {Object} drill Drill row
 * @param {string} educatorId Educator id
 * @param {Object} schoolEducator School educator row
 * @return {boolean}
 */
function educatorCanViewDrill(drill, educatorId, schoolEducator) {
  if (!drill || typeof drill !== "object") return false;

  if (schoolEducator && schoolEducator.superAdmin === true) return true;
  if (schoolEducator && schoolEducator.adminAccess === true) return true;

  const creator = cleanStr(drill.createdByEducatorId, 120);
  return creator && creator === educatorId;
}

/**
 * Resolve educator context.
 *
 * @param {Object} db RTDB
 * @param {string} fbUid Firebase uid
 * @return {Promise<{
 * educatorId:string, schoolId:string, schoolEducator:Object}>}
 */
async function resolveEducatorContext(db, fbUid) {
  const mapSnap = await db.ref(`uidToCustom/${fbUid}`).once("value");
  const educatorId = normalizeUidToEducator(mapSnap.val());

  if (!educatorId) {
    return {
      educatorId: "",
      schoolId: "",
      schoolEducator: {},
    };
  }

  const educatorSnap = await db.ref(`educators/${educatorId}`).once("value");
  const educator = asObj(educatorSnap.val());

  const schoolId = cleanStr(educator.schoolID || educator.schoolId, 120);

  if (!schoolId) {
    return {
      educatorId,
      schoolId: "",
      schoolEducator: {},
    };
  }

  const schoolEducatorSnap = await db
      .ref(`schools/${schoolId}/educators/${educatorId}`)
      .once("value");

  return {
    educatorId,
    schoolId,
    schoolEducator: asObj(schoolEducatorSnap.val()),
  };
}

/**
 * Pick latest attempt from student attempts map.
 *
 * @param {Object} attemptsById Attempt map
 * @param {string} preferredAttemptId Preferred attempt id
 * @return {Object|null}
 */
function pickAttempt(attemptsById, preferredAttemptId) {
  const map = asObj(attemptsById);

  if (preferredAttemptId && map[preferredAttemptId]) {
    return asObj(map[preferredAttemptId]);
  }

  let best = null;
  let bestTime = 0;

  for (const attemptId of Object.keys(map)) {
    const row = asObj(map[attemptId]);
    const t = Date.parse(row.submittedAt || row.createdAt || "");
    const v = Number.isNaN(t) ? 0 : t;

    if (!best || v > bestTime) {
      best = row;
      bestTime = v;
    }
  }

  return best;
}

/**
 * Get one student's drill submission detail.
 *
 * Request:
 * {
 *   drillId: "...",
 *   studentId: "...",
 *   attemptId: "..." // optional but preferred
 * }
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const drillId = cleanStr(body.drillId, 140);
    const studentId = cleanStr(body.studentId, 140);
    const attemptId = cleanStr(body.attemptId, 180);

    if (!drillId) {
      return bad(res, 400, "MISSING_DRILL_ID");
    }

    if (!studentId) {
      return bad(res, 400, "MISSING_STUDENT_ID");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();

    const ctx = await resolveEducatorContext(db, callerFbUid);

    if (!ctx.educatorId) {
      return bad(res, 403, "NOT_AN_EDUCATOR");
    }

    if (!ctx.schoolId) {
      return bad(res, 403, "EDUCATOR_HAS_NO_SCHOOL");
    }

    const approvalStatus = cleanStr(
        ctx.schoolEducator.approvalStatus || ctx.schoolEducator.status,
        40,
    ).toLowerCase();

    if (
      approvalStatus &&
      approvalStatus !== "approved" &&
      ctx.schoolEducator.approved !== true
    ) {
      return bad(res, 403, "EDUCATOR_NOT_APPROVED");
    }

    const drillSnap = await db
        .ref(`schools/${ctx.schoolId}/educatorDrills/${drillId}`)
        .once("value");

    const drill = asObj(drillSnap.val());

    if (!drill || Object.keys(drill).length < 1) {
      return bad(res, 404, "DRILL_NOT_FOUND");
    }

    if (!educatorCanViewDrill(drill, ctx.educatorId, ctx.schoolEducator)) {
      return bad(res, 403, "EDUCATOR_CANNOT_VIEW_DRILL_SUBMISSION");
    }

    const assignedRow = asObj(asObj(drill.assignedStudents)[studentId]);

    if (!assignedRow || Object.keys(assignedRow).length < 1) {
      return bad(res, 404, "STUDENT_NOT_ASSIGNED_TO_DRILL");
    }

    const status = cleanStr(assignedRow.status, 40).toLowerCase();

    if (status !== "submitted") {
      return bad(res, 409, "STUDENT_HAS_NOT_SUBMITTED", {
        status: status || "assigned",
      });
    }

    const attemptsSnap = await db
        .ref(
            `schools/${ctx.schoolId}/educatorDrillAttempts/` +
  `${drillId}/${studentId}`,
        )
        .once("value");

    const attempt = pickAttempt(attemptsSnap.val(), attemptId);

    if (!attempt) {
      return bad(res, 404, "ATTEMPT_NOT_FOUND");
    }

    const studentSnap = await db.ref(`users/${studentId}`).once("value");
    const student = asObj(studentSnap.val());

    const summary = normalizeSummary(
        attempt.summary || assignedRow.summary || {});
    const subjects = normalizeSubjects(attempt.subjects);
    const modules = normalizeModules(attempt.modules);
    const snapshot = asObj(attempt.snapshot);
    const rawAnswers = asArr(attempt.answers).length ?
      attempt.answers : snapshot.answers;
    const normalizedAnswers = normalizeAnswers(rawAnswers);
    const answers = sortAnswersByBlueprint(normalizedAnswers, drill);

    return res.status(200).json({
      ok: true,
      schoolId: ctx.schoolId,
      drill: {
        drillId,
        bootcamp: cleanStr(drill.bootcamp, 40).toLowerCase(),
        title: cleanStr(drill.title, 180) || "Drill",
        instructions: cleanStr(drill.instructions, 1000),
        dueAt: cleanStr(drill.dueAt, 80),
        status: cleanStr(drill.status, 40).toLowerCase(),
        datasetVersion: cleanStr(
            asObj(drill.blueprint).datasetVersion || drill.datasetVersion, 120),
        correctionRevision: Math.max(0, Number(
            asObj(drill.blueprint).correctionRevision ||
            drill.correctionRevision || 0)),
      },
      student: {
        studentId,
        studentName: studentDisplayName(student, studentId),
        firstName: cleanStr(student.firstName, 80),
        lastName: cleanStr(student.lastName, 80),
        avatarNumber: Number(student.avaterNumber || student.avatarNumber || 1),
      },
      attempt: {
        attemptId: cleanStr(attempt.attemptId || attemptId, 180),
        submittedAt: cleanStr(
            attempt.submittedAt || assignedRow.submittedAt, 80),
        startedAt: cleanStr(attempt.startedAt || assignedRow.startedAt, 80),
        assignedAt: cleanStr(attempt.assignedAt || assignedRow.assignedAt, 80),
        datasetVersion: cleanStr(
            attempt.datasetVersion || asObj(drill.blueprint).datasetVersion ||
            drill.datasetVersion, 120),
        correctionRevision: Math.max(0, Number(
            attempt.correctionRevision ||
            asObj(drill.blueprint).correctionRevision ||
            drill.correctionRevision || 0)),
        summary,
        subjects,
        modules,
        answers,
      },
      syncedAt: new Date().toISOString(),
    });
  } catch (e) {
    const details = errText(e);

    if (
      details.includes("auth/id-token-expired") ||
      details.includes("Firebase ID token has expired")
    ) {
      return bad(res, 401, "ID_TOKEN_EXPIRED", details);
    }

    if (
      details.includes("auth/argument-error") ||
      details.includes("Decoding Firebase ID token failed")
    ) {
      return bad(res, 401, "INVALID_ID_TOKEN", details);
    }

    return bad(res, 500, "INTERNAL", details);
  }
};

exports.buildBlueprintOrderMap = buildBlueprintOrderMap;
exports.normalizeAnswers = normalizeAnswers;
exports.normalizeSubjects = normalizeSubjects;
exports.normalizeModules = normalizeModules;
exports.sortAnswersByBlueprint = sortAnswersByBlueprint;
