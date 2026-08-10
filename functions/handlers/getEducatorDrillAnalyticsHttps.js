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
 * @param {number} maxLen Maximum length
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
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
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
  const unanswered = Math.max(0, Number(
      s.unanswered || totalQ - attempted || 0));
  const usedSec = Math.max(0, Number(s.usedSec || s.timeSec || 0));
  const meanSec = Math.max(
      0,
      Number(
          s.meanSec || (attempted > 0 ? Math.floor(usedSec / attempted) : 0)),
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
 * Return default aggregate stats bucket.
 *
 * @return {Object}
 */
function emptyAgg() {
  return {
    students: 0,
    totalQSum: 0,
    attemptedSum: 0,
    correctSum: 0,
    wrongSum: 0,
    unansweredSum: 0,
    usedSecSum: 0,
    below40Count: 0,
    below60Count: 0,
    below70Count: 0,
  };
}

/**
 * Add one performance row into aggregate bucket.
 *
 * @param {Object} bucket Aggregate bucket
 * @param {Object} row Performance row
 */
function addAgg(bucket, row) {
  const totalQ = Math.max(0, Number(row.totalQ || row.totalQuestions || 0));
  const attempted = Math.max(0, Number(row.attempted || 0));
  const correct = Math.max(0, Number(row.correct || 0));
  const wrong = Math.max(0, Number(row.wrong || attempted - correct || 0));
  const unanswered = Math.max(
      0, Number(row.unanswered || totalQ - attempted || 0));
  const usedSec = Math.max(
      0, Number(row.usedSec || row.timeSec || row.time_sec || 0));

  const pct = attempted > 0 ? (correct * 100) / attempted : 0;

  bucket.students += 1;
  bucket.totalQSum += totalQ;
  bucket.attemptedSum += attempted;
  bucket.correctSum += correct;
  bucket.wrongSum += wrong;
  bucket.unansweredSum += unanswered;
  bucket.usedSecSum += usedSec;

  if (pct < 40) bucket.below40Count += 1;
  if (pct < 60) bucket.below60Count += 1;
  if (pct < 70) bucket.below70Count += 1;
}

/**
 * Finalize aggregate bucket.
 *
 * @param {string} key Bucket key
 * @param {Object} bucket Aggregate bucket
 * @param {Object=} extra Extra fields
 * @return {Object}
 */
function finalizeAgg(key, bucket, extra) {
  const students = Math.max(0, Number(bucket.students || 0));
  const attempted = Math.max(0, Number(bucket.attemptedSum || 0));
  const correct = Math.max(0, Number(bucket.correctSum || 0));
  const totalQ = Math.max(0, Number(bucket.totalQSum || 0));
  const usedSec = Math.max(0, Number(bucket.usedSecSum || 0));

  return {
    key,
    ...(extra || {}),
    students,
    totalQ,
    attempted,
    correct,
    wrong: Math.max(0, Number(bucket.wrongSum || 0)),
    unanswered: Math.max(0, Number(bucket.unansweredSum || 0)),
    usedSec,
    accuracyPct: attempted > 0 ?
      Math.round((correct * 10000) / attempted) / 100 :
      0,
    avgTimeSec: attempted > 0 ? Math.round(usedSec / attempted) : 0,
    avgTotalQ: students > 0 ? Math.round((totalQ / students) * 100) / 100 : 0,
    avgAttempted: students > 0 ? Math.round((
      attempted / students) * 100) / 100 : 0,
    avgCorrect: students > 0 ? Math.round((correct / students) * 100) / 100 : 0,
    avgWrong: students > 0 ?
      Math.round((Number(bucket.wrongSum || 0) / students) * 100) / 100 :
      0,
    avgUnanswered: students > 0 ?
      Math.round((Number(bucket.unansweredSum || 0) / students) * 100) / 100 :
      0,
    avgUsedSec: students > 0 ? Math.round(usedSec / students) : 0,
    avgMeanSec: attempted > 0 ? Math.round(usedSec / attempted) : 0,
    avgScorePct: totalQ > 0 ? Math.round((correct * 10000) / totalQ) / 100 : 0,
    avgAccuracyPct: attempted > 0 ?
      Math.round((correct * 10000) / attempted) / 100 :
      0,
    below40Count: Number(bucket.below40Count || 0),
    below60Count: Number(bucket.below60Count || 0),
    below70Count: Number(bucket.below70Count || 0),
  };
}

/**
 * Return or create aggregate bucket.
 *
 * @param {Object} map Bucket map
 * @param {string} key Bucket key
 * @return {Object}
 */
function ensureBucket(map, key) {
  if (!map[key]) map[key] = emptyAgg();
  return map[key];
}

/**
 * Count selected option distribution.
 *
 * @param {Object} q Question analytics bucket
 * @param {string} selected Selected answer text
 */
function addOptionSelection(q, selected) {
  const answer = cleanStr(selected, 1000);
  if (!answer) return;

  if (!q.optionMap[answer]) {
    q.optionMap[answer] = {
      answer,
      count: 0,
    };
  }

  q.optionMap[answer].count += 1;
}

/**
 * Resolve a stored option index without treating null as option zero.
 *
 * @param {Array<*>} options Available options
 * @param {*} value Stored index
 * @return {string} Selected option text
 */
function indexedOption(options, value) {
  if (value === null || value === undefined || value === "") return "";
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index >= options.length) {
    return "";
  }
  return cleanStr(options[index], 1000);
}

/**
 * Preserve legacy payload options when the canonical options array is absent.
 *
 * @param {Object} row Stored answer row
 * @return {{payload:Object, options:Array}}
 */
function answerContent(row) {
  const storedPayload = asObj(row.payload || row.questionPayload);
  const options = asArr(row.options);
  const payload = {
    ...storedPayload,
    question: row.prompt || storedPayload.question || "",
    option1: options[0] || storedPayload.option1 || "",
    option2: options[1] || storedPayload.option2 || "",
    option3: options[2] || storedPayload.option3 || "",
    option4: options[3] || storedPayload.option4 || "",
    subject: row.subject || storedPayload.subject || "",
    module: row.module || storedPayload.module || "",
  };
  return {
    payload,
    options: options.length ? options : [
      payload.option1,
      payload.option2,
      payload.option3,
      payload.option4,
    ],
  };
}

/**
 * Return option distribution using option order from payload.
 *
 * @param {Object} q Question analytics bucket
 * @return {Array<Object>}
 */
function optionDistribution(q) {
  const options = [
    cleanStr(q.option1, 1000),
    cleanStr(q.option2, 1000),
    cleanStr(q.option3, 1000),
    cleanStr(q.option4, 1000),
  ];

  const labels = ["A", "B", "C", "D"];
  const out = [];

  for (let i = 0; i < options.length; i++) {
    const answer = options[i];
    if (!answer) continue;

    const count = q.optionMap && q.optionMap[answer] ?
      Number(q.optionMap[answer].count || 0) :
      0;

    out.push({
      label: labels[i],
      answer,
      count,
      percentage: Number(q.attempted || 0) > 0 ?
        Math.round((count * 10000) / Number(q.attempted || 0)) / 100 :
        0,
      isCorrect: Boolean(q.correctAnswer) && answer === q.correctAnswer,
    });
  }

  return out;
}

/**
 * Add common wrong answer count.
 *
 * @param {Object} map Answer map
 * @param {string} answer Answer text
 */
function addWrongAnswer(map, answer) {
  const key = cleanStr(answer, 500);
  if (!key) return;

  if (!map[key]) {
    map[key] = {
      answer: key,
      count: 0,
    };
  }

  map[key].count += 1;
}

/**
 * Convert answer count map into sorted top list.
 *
 * @param {Object} map Answer map
 * @param {number} limit Max answers
 * @return {Array<Object>}
 */
function topWrongAnswers(map, limit) {
  const rows = Object.keys(map || {}).map((k) => map[k]);

  rows.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return String(a.answer || "").localeCompare(String(b.answer || ""));
  });

  return rows.slice(0, limit || 5);
}

/**
 * Build question text preview.
 *
 * @param {Object} payload Question payload
 * @param {string} fallback Fallback id
 * @return {string}
 */
function questionPreview(payload, fallback) {
  const q = cleanStr(payload.question, 240);
  if (q) return q;
  return cleanStr(fallback, 240);
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
 * Build question metadata from blueprint order.
 *
 * @param {Object} blueprint Drill blueprint
 * @return {Object}
 */
function buildBlueprintQuestionMeta(blueprint) {
  const out = {};
  const subjects = asArr(blueprint && blueprint.subjects);
  let globalIndex = 1;

  for (const subject of subjects) {
    const subjectName = cleanStr(subject && subject.subject, 120);
    const ids = asArr(subject && subject.questionIds);

    for (const id of ids) {
      const questionId = cleanStr(id, 240);
      if (!questionId) continue;

      out[questionId] = {
        blueprintIndex: globalIndex,
        subjectIndex: Object.keys(out).length + 1,
        subject: subjectName,
      };

      globalIndex += 1;
    }
  }

  return out;
}

/**
 * Count assigned statuses.
 *
 * @param {Object} assignedMap Assigned students map
 * @return {Object}
 */
function countAssignedStatuses(assignedMap) {
  const counts = {
    assigned: 0,
    started: 0,
    submitted: 0,
    late: 0,
    other: 0,
  };

  for (const studentId of Object.keys(assignedMap || {})) {
    const row = asObj(assignedMap[studentId]);
    const status = cleanStr(row.status, 40).toLowerCase();

    if (status === "assigned") counts.assigned++;
    else if (status === "started") counts.started++;
    else if (status === "submitted") counts.submitted++;
    else if (status === "late") counts.late++;
    else counts.other++;
  }

  return counts;
}

/**
 * Pick latest attempt from student attempts map.
 *
 * @param {Object} attemptsById Attempt map
 * @param {string} preferredAttemptId Preferred id
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
 * Sort analytics rows weakest first.
 *
 * @param {Object} a Row A
 * @param {Object} b Row B
 * @return {number}
 */
function weakestFirst(a, b) {
  if (a.avgAccuracyPct !== b.avgAccuracyPct) {
    return a.avgAccuracyPct - b.avgAccuracyPct;
  }

  if (b.students !== a.students) return b.students - a.students;

  return String(a.key || "").localeCompare(String(b.key || ""));
}

/**
 * Sort question analytics weakest first.
 *
 * @param {Object} a Row A
 * @param {Object} b Row B
 * @return {number}
 */
function questionWeakestFirst(a, b) {
  if (a.correctPct !== b.correctPct) return a.correctPct - b.correctPct;
  if (b.attempted !== a.attempted) return b.attempted - a.attempted;
  return String(a.questionId || "").localeCompare(String(b.questionId || ""));
}

/**
 * Get educator drill aggregate analytics.
 *
 * Request:
 * {
 *   drillId: "..."
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

    if (!drillId) {
      return bad(res, 400, "MISSING_DRILL_ID");
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
      return bad(res, 403, "EDUCATOR_CANNOT_VIEW_DRILL_ANALYTICS");
    }

    const assignedMap = asObj(drill.assignedStudents);
    const assignedIds = Object.keys(assignedMap);
    const statusCounts = countAssignedStatuses(assignedMap);

    const blueprintQuestionMeta = buildBlueprintQuestionMeta(asObj(
        drill.blueprint));

    const attemptsSnap = await db
        .ref(`schools/${ctx.schoolId}/educatorDrillAttempts/${drillId}`)
        .once("value");

    const attemptsRoot = asObj(attemptsSnap.val());

    const overallBucket = emptyAgg();
    const subjectMap = {};
    const moduleMap = {};
    const questionMap = {};
    const studentRows = [];

    for (const studentId of assignedIds) {
      const assigned = asObj(assignedMap[studentId]);
      const status = cleanStr(assigned.status, 40).toLowerCase() || "assigned";
      const attemptId = cleanStr(assigned.attemptId, 160);

      if (status !== "submitted") {
        continue;
      }

      const studentAttempts = asObj(attemptsRoot[studentId]);
      const attempt = pickAttempt(studentAttempts, attemptId);

      if (!attempt) continue;

      const summary = normalizeSummary(
          attempt.summary || assigned.summary || {});
      addAgg(overallBucket, summary);

      let studentName = studentId;

      try {
        const studentSnap = await db.ref(`users/${studentId}`).once("value");
        studentName = studentDisplayName(asObj(studentSnap.val()), studentId);
      } catch (_) {
        studentName = studentId;
      }

      studentRows.push({
        studentId,
        studentName,
        attemptId: cleanStr(attempt.attemptId || attemptId, 160),
        submittedAt: cleanStr(attempt.submittedAt || assigned.submittedAt, 80),
        summary,
      });

      const subjects = asArr(attempt.subjects);
      for (const subject of subjects) {
        const row = asObj(subject);
        const code = cleanStr(row.code || row.subject || row.subject_code, 120);
        if (!code) continue;

        const bucket = ensureBucket(subjectMap, code);
        addAgg(bucket, {
          totalQ: row.totalQ || row.totalQuestions || row.attempted || 0,
          attempted: row.attempted || 0,
          correct: row.correct || 0,
          wrong: row.wrong || 0,
          unanswered: row.unanswered || 0,
          timeSec: row.timeSec || row.time_sec || row.usedSec || 0,
        });
      }

      const modules = asArr(attempt.modules);
      for (const moduleRow of modules) {
        const row = asObj(moduleRow);
        const subjectCode = cleanStr(
            row.subject_code || row.subjectCode || row.subject || "",
            120,
        );
        const code = cleanStr(
            row.code || row.module || row.module_code || "", 180);

        if (!subjectCode || !code) continue;

        const key = `${subjectCode}||${code}`;
        const bucket = ensureBucket(moduleMap, key);
        bucket.subject = subjectCode;
        bucket.module = code;

        addAgg(bucket, {
          totalQ: row.totalQ || row.totalQuestions || row.attempted || 0,
          attempted: row.attempted || 0,
          correct: row.correct || 0,
          wrong: row.wrong || 0,
          unanswered: row.unanswered || 0,
          timeSec: row.timeSec || row.time_sec || row.usedSec || 0,
        });
      }

      const answers = asArr(attempt.answers);
      for (const answer of answers) {
        const row = asObj(answer);

        const questionId = cleanStr(
            row.questionId || row.question_id || row.id || "",
            240,
        );
        if (!questionId) continue;

        const content = answerContent(row);
        const payload = content.payload;
        const resolvedOptions = content.options;
        const subjectCode = cleanStr(
            row.subjectCode ||
              row.subject ||
              row.subject_code ||
              payload.subject ||
              "",
            120,
        );
        const moduleCode = cleanStr(
            row.moduleCode ||
              row.module ||
              row.module_code ||
              payload.module ||
              "",
            180,
        );

        const bpMeta = blueprintQuestionMeta[questionId] || {};

        if (!questionMap[questionId]) {
          questionMap[questionId] = {
            questionId,
            blueprintIndex: Number(bpMeta.blueprintIndex || 0),
            subject: subjectCode || bpMeta.subject || "",
            module: moduleCode,
            question: questionPreview(payload, questionId),

            option1: cleanStr(payload.option1, 1000),
            option2: cleanStr(payload.option2, 1000),
            option3: cleanStr(payload.option3, 1000),
            option4: cleanStr(payload.option4, 1000),

            attempted: 0,
            correct: 0,
            wrong: 0,
            unanswered: 0,
            students: 0,
            wrongAnswerMap: {},
            optionMap: {},

            timedCount: 0,
            totalTimeMs: 0,
            fastestMs: 0,
            slowestMs: 0,
          };
        }

        const q = questionMap[questionId];

        if (!q.subject && subjectCode) q.subject = subjectCode;
        if (!q.module && moduleCode) q.module = moduleCode;
        if (!q.question || q.question === questionId) {
          q.question = questionPreview(payload, questionId);
        }

        if (!q.option1 && payload.option1) {
          q.option1 = cleanStr(payload.option1, 1000);
        }
        if (!q.option2 && payload.option2) {
          q.option2 = cleanStr(payload.option2, 1000);
        }
        if (!q.option3 && payload.option3) {
          q.option3 = cleanStr(payload.option3, 1000);
        }
        if (!q.option4 && payload.option4) {
          q.option4 = cleanStr(payload.option4, 1000);
        }

        q.students += 1;

        const timeTakenMs = Math.max(
            0,
            Number(row.timeTakenMs || row.time_taken_ms ||
              Number(row.timeSpentSec || 0) * 1000),
        );

        if (timeTakenMs > 0) {
          q.totalTimeMs += timeTakenMs;
          q.timedCount += 1;

          if (!q.fastestMs || timeTakenMs < q.fastestMs) {
            q.fastestMs = timeTakenMs;
          }

          if (!q.slowestMs || timeTakenMs > q.slowestMs) {
            q.slowestMs = timeTakenMs;
          }
        }

        const selected = cleanStr(
            row.selectedAnswer || row.chosen_option ||
              indexedOption(resolvedOptions,
                  row.selectedIndex !== undefined &&
                  row.selectedIndex !== null ?
                    row.selectedIndex : row.selectedOptionIdx),
            1000,
        );
        const correctAnswer = cleanStr(
            row.correctAnswer || row.correct_option ||
              indexedOption(resolvedOptions, row.correctIndex),
            1000,
        );

        if (!q.correctAnswer && correctAnswer) {
          q.correctAnswer = correctAnswer;
        }

        const isCorrect =
          row.isCorrect === true ||
          row.is_correct === true ||
          row.is_correct === 1 ||
          (selected !== "" &&
            correctAnswer !== "" && selected === correctAnswer);

        if (!selected) {
          q.unanswered += 1;
        } else {
          q.attempted += 1;
          addOptionSelection(q, selected);

          if (isCorrect) {
            q.correct += 1;
          } else {
            q.wrong += 1;
            addWrongAnswer(q.wrongAnswerMap, selected);
          }
        }
      }
    }

    const submittedStudents = studentRows.length;

    const subjects = Object.keys(subjectMap).map((key) => {
      return finalizeAgg(key, subjectMap[key], {
        subject: key,
      });
    });

    subjects.sort(weakestFirst);

    const modules = Object.keys(moduleMap).map((key) => {
      const b = moduleMap[key];
      return finalizeAgg(key, b, {
        subject: b.subject || key.split("||")[0] || "",
        module: b.module || key.split("||")[1] || "",
      });
    });

    modules.sort(weakestFirst);

    const questions = Object.keys(questionMap).map((key) => {
      const q = questionMap[key];

      const attempted = Math.max(0, Number(q.attempted || 0));
      const correct = Math.max(0, Number(q.correct || 0));
      const students = Math.max(0, Number(q.students || 0));

      const timedCount = Math.max(0, Number(q.timedCount || 0));
      const totalTimeMs = Math.max(0, Number(q.totalTimeMs || 0));

      return {
        questionId: q.questionId,
        blueprintIndex: Number(q.blueprintIndex || 0),
        subject: q.subject || "",
        module: q.module || "",
        question: q.question || q.questionId,

        options: optionDistribution(q),

        students,
        attempted,
        correct,
        wrong: Math.max(0, Number(q.wrong || 0)),
        unanswered: Math.max(0, Number(q.unanswered || 0)),

        correctPct: attempted > 0 ?
    Math.round((correct * 10000) / attempted) / 100 :
    0,

        studentCorrectPct: students > 0 ?
    Math.round((correct * 10000) / students) / 100 :
    0,

        timedCount,
        avgTimeSec: timedCount > 0 ?
    Math.round((totalTimeMs / timedCount) / 10) / 100 :
    0,
        fastestSec: q.fastestMs > 0 ?
    Math.round(q.fastestMs / 10) / 100 :
    0,
        slowestSec: q.slowestMs > 0 ?
    Math.round(q.slowestMs / 10) / 100 :
    0,
        totalTimeSec: Math.round(totalTimeMs / 1000),

        commonWrongAnswers: topWrongAnswers(q.wrongAnswerMap, 5),
      };
    });

    questions.sort(questionWeakestFirst);

    studentRows.sort((a, b) => {
      const ap = a.summary.accuracyPct || 0;
      const bp = b.summary.accuracyPct || 0;
      if (ap !== bp) return ap - bp;
      return String(
          a.studentName || "").localeCompare(String(b.studentName || ""));
    });

    const overall = finalizeAgg("overall", overallBucket, {
      studentsSubmitted: submittedStudents,
      assignedCount: assignedIds.length,
      startedCount: statusCounts.started,
      submittedCount: statusCounts.submitted,
      lateCount: statusCounts.late,
      notStartedCount: statusCounts.assigned,
      lockedCount: statusCounts.started,
      completionPct: assignedIds.length > 0 ?
        Math.round((submittedStudents * 10000) / assignedIds.length) / 100 :
        0,
    });

    return res.status(200).json({
      ok: true,
      schoolId: ctx.schoolId,
      drill: {
        drillId,
        bootcamp: cleanStr(drill.bootcamp, 40).toLowerCase(),
        title: cleanStr(drill.title, 180) || "Drill",
        instructions: cleanStr(drill.instructions, 500),
        status: cleanStr(drill.status, 40).toLowerCase(),
        createdByEducatorId: cleanStr(drill.createdByEducatorId, 120),
        createdByName: cleanStr(drill.createdByName, 160),
        assignedCount: assignedIds.length,
        submittedCount: submittedStudents,
        dueAt: cleanStr(drill.dueAt, 80),
        publishedAt: cleanStr(drill.publishedAt, 80),
      },
      statusCounts,
      overall,
      subjects,
      modules,
      questions,
      weakestStudents: studentRows.slice(0, 10),
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

exports.indexedOption = indexedOption;
exports.answerContent = answerContent;
exports.optionDistribution = optionDistribution;
