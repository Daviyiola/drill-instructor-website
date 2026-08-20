"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");

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
 * Safe text from unknown errors.
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
 * Supports both old and new uidToCustom shapes.
 *
 * New:
 *   uidToCustom/{uid}/student = "user_..."
 *
 * Legacy possible:
 *   uidToCustom/{uid} = "user_..."
 *
 * @param {*} val uidToCustom node
 * @return {string}
 */
function normalizeUidToStudent(val) {
  if (!val) return "";
  if (typeof val === "string") return cleanStr(val, 120);
  if (typeof val === "object") return cleanStr(val.student, 120);
  return "";
}

/**
 * Convert unknown value to object.
 *
 * @param {*} value Any value
 * @return {Object} Object or empty object
 */
function asObj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ?
    value :
    {};
}

/**
 * Count questions in blueprint.
 *
 * @param {Object} blueprint Drill blueprint
 * @return {number} Total question count
 */
function countBlueprintQuestions(blueprint) {
  const subjects = Array.isArray(blueprint && blueprint.subjects) ?
    blueprint.subjects :
    [];

  let total = 0;

  for (const subject of subjects) {
    const ids = Array.isArray(subject && subject.questionIds) ?
      subject.questionIds :
      [];

    total += ids.length;
  }

  return total;
}

/**
 * Sum per-subject time limits in a blueprint.
 *
 * @param {Object} blueprint Drill blueprint
 * @return {number} Total time in minutes
 */
function totalBlueprintTimeMin(blueprint) {
  const subjects = Array.isArray(blueprint && blueprint.subjects) ?
    blueprint.subjects :
    [];

  let total = 0;

  for (const subject of subjects) {
    total += Number(subject && subject.timeLimitMin || 0);
  }

  return total;
}

/**
 * Validate blueprint has usable question IDs.
 *
 * @param {Object} blueprint Blueprint.
 * @return {Object} Object with ok, error, questionCount, and totalTimeMin.
 */
function validateBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== "object") {
    return {ok: false, error: "MISSING_BLUEPRINT"};
  }

  if (!Array.isArray(blueprint.subjects) || blueprint.subjects.length < 1) {
    return {ok: false, error: "MISSING_BLUEPRINT_SUBJECTS"};
  }

  const questionCount = countBlueprintQuestions(blueprint);

  if (questionCount < 1) {
    return {ok: false, error: "BLUEPRINT_HAS_NO_QUESTIONS"};
  }

  for (const subject of blueprint.subjects) {
    const subjectName = cleanStr(subject && subject.subject, 80);
    const questionIds = Array.isArray(subject && subject.questionIds) ?
      subject.questionIds :
      [];

    if (!subjectName) {
      return {ok: false, error: "BLUEPRINT_SUBJECT_MISSING_NAME"};
    }

    if (questionIds.length < 1) {
      return {ok: false, error: "BLUEPRINT_SUBJECT_HAS_NO_QUESTIONS"};
    }
  }

  return {
    ok: true,
    questionCount,
    totalTimeMin: totalBlueprintTimeMin(blueprint),
  };
}

/**
 * Atomically claim assignment start.
 *
 * This prevents two devices from opening the same assignment.
 *
 * @param {Object} db Firebase DB.
 * @param {string} studentId Student id.
 * @param {string} drillId Drill id.
 * @param {string} nowIso Current ISO timestamp.
 * @return {Promise<Object>} Claim result.
 */
async function claimAssignmentStart(db, studentId, drillId, nowIso) {
  const ref = db.ref(`users/${studentId}/assignedDrills/${drillId}`);

  let finalRow = null;
  let blockedStatus = "";

  const result = await ref.transaction((current) => {
    if (current === null) {
      return current;
    }

    if (typeof current !== "object") {
      blockedStatus = "invalid";
      return;
    }

    const status = cleanStr(current.status, 40).toLowerCase();

    if (status !== "assigned" && status !== "late") {
      blockedStatus = status || "missing";
      return;
    }

    current.status = "started";
    current.startedAt = current.startedAt || nowIso;
    return current;
  });

  finalRow = result.snapshot && result.snapshot.val();

  if (!result.committed) {
    return {
      ok: false,
      error: "ASSIGNMENT_ALREADY_STARTED_OR_NOT_PLAYABLE",
      status: blockedStatus || cleanStr(
          finalRow && finalRow.status, 40).toLowerCase() || "missing",
      row: finalRow,
    };
  }

  if (!finalRow || typeof finalRow !== "object") {
    return {
      ok: false,
      error: "ASSIGNMENT_NOT_FOUND",
      status: "missing",
    };
  }

  return {
    ok: true,
    row: finalRow,
  };
}

/**
 * Return true if assignment is playable.
 *
 * @param {Object} row Student assignment row
 * @return {boolean} True if can open
 */
function isPlayableAssignment(row) {
  const status = cleanStr(row && row.status, 40).toLowerCase();

  // V1 strict rule:
  // assigned/late can be claimed once.
  // started/submitted cannot be opened again.
  return status === "assigned" || status === "late" || status === "started";
}

/**
 * Normalize assignment card/detail.
 *
 * @param {string} drillId Drill id
 * @param {Object} row Student inbox row
 * @param {Object} drill Full school drill row
 * @param {number} questionCount Question count fallback
 * @param {number} totalTimeMin Total time fallback
 * @return {Object} Assignment detail
 */
function sanitizeAssignment(drillId, row, drill, questionCount, totalTimeMin) {
  return {
    type: "educator_drill",
    drillId,
    schoolId: cleanStr(row.schoolId || drill.schoolId, 120),
    bootcamp: cleanStr(row.bootcamp || drill.bootcamp, 40).toLowerCase(),
    title: cleanStr(row.title || drill.title, 180) || "Assigned Drill",
    instructions: cleanStr(row.instructions || drill.instructions, 1200),
    createdByEducatorId: cleanStr(
        row.createdByEducatorId || drill.createdByEducatorId,
        120,
    ),
    createdByName: cleanStr(
        row.createdByName || drill.createdByName,
        160,
    ) || "Educator",
    assignedAt: cleanStr(row.assignedAt, 80),
    dueAt: cleanStr(row.dueAt || drill.dueAt, 80),
    status: cleanStr(row.status, 40).toLowerCase() || "assigned",
    startedAt: cleanStr(row.startedAt, 80),
    submittedAt: cleanStr(row.submittedAt, 80),
    attemptId: cleanStr(row.attemptId, 140),
    questionCount: Number(row.questionCount || questionCount || 0),
    totalTimeMin: Number(row.totalTimeMin || totalTimeMin || 0),
  };
}

/**
 * Get one full educator drill assignment for a student.
 *
 * Request:
 * {
 *   bootcamp: "sat",
 *   drillId: "..."
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   studentId,
 *   assignment,
 *   blueprint,
 *   settings
 * }
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      // console.log("DETAIL_ASSIGNMENT S1 method blocked");
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const drillId = cleanStr(body.drillId, 140);

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    if (!drillId) {
      return bad(res, 400, "MISSING_DRILL_ID");
    }

    const callerFbUid = await requireBearerUid(req);

    const db = getDatabase();

    const mapSnap = await db.ref(`uidToCustom/${callerFbUid}`).once("value");
    const studentId = normalizeUidToStudent(mapSnap.val());

    if (!studentId) {
      return bad(res, 403, "NOT_A_STUDENT");
    }

    await assertLicenseActive(db, studentId, bootcamp);

    const inboxSnap = await db
        .ref(`users/${studentId}/assignedDrills/${drillId}`)
        .once("value");

    const inboxRow = inboxSnap.val();

    if (!inboxRow || typeof inboxRow !== "object") {
      return bad(res, 404, "ASSIGNMENT_NOT_FOUND");
    }

    const assignmentBootcamp = cleanStr(inboxRow.bootcamp, 40).toLowerCase();

    if (assignmentBootcamp !== bootcamp) {
      return bad(res, 403, "ASSIGNMENT_BOOTCAMP_MISMATCH", {
        requestedBootcamp: bootcamp,
        assignmentBootcamp,
      });
    }

    if (!isPlayableAssignment(inboxRow)) {
      return bad(res, 409, "ASSIGNMENT_NOT_PLAYABLE", {
        status: cleanStr(inboxRow.status, 40).toLowerCase(),
      });
    }

    const schoolId = cleanStr(inboxRow.schoolId, 120);

    if (!schoolId) {
      return bad(res, 400, "ASSIGNMENT_MISSING_SCHOOL_ID");
    }

    const drillSnap = await db
        .ref(`schools/${schoolId}/educatorDrills/${drillId}`)
        .once("value");

    const drill = drillSnap.val();

    if (!drill || typeof drill !== "object") {
      return bad(res, 404, "DRILL_NOT_FOUND");
    }

    const drillBootcamp = cleanStr(drill.bootcamp, 40).toLowerCase();

    if (drillBootcamp !== bootcamp) {
      return bad(res, 403, "DRILL_BOOTCAMP_MISMATCH", {
        requestedBootcamp: bootcamp,
        drillBootcamp,
      });
    }

    const drillStatus = cleanStr(drill.status, 40).toLowerCase();

    if (drillStatus !== "published") {
      return bad(res, 409, "DRILL_NOT_PUBLISHED", {
        status: drillStatus || "missing",
      });
    }

    const assignedStudentRow = asObj(
        asObj(drill.assignedStudents)[studentId],
    );

    if (!assignedStudentRow || Object.keys(assignedStudentRow).length < 1) {
      return bad(res, 403, "STUDENT_NOT_ASSIGNED_TO_DRILL");
    }

    const blueprint = drill.blueprint && typeof drill.blueprint === "object" ?
      drill.blueprint :
      null;

    const bpCheck = validateBlueprint(blueprint);

    if (!bpCheck.ok) {
      return bad(res, 400, bpCheck.error);
    }

    const settings = drill.settings && typeof drill.settings === "object" ?
      drill.settings :
      {};

    const nowIso = new Date().toISOString();

    let claimedInboxRow = inboxRow;
    const inboxStatus = cleanStr(inboxRow.status, 40).toLowerCase();

    if (inboxStatus === "started") {
      claimedInboxRow = inboxRow;
    } else {
      const claimed = await claimAssignmentStart(
          db, studentId, drillId, nowIso);


      if (!claimed.ok) {
        return bad(res, 409, claimed.error, {
          status: claimed.status || "unknown",
        });
      }

      claimedInboxRow = claimed.row || {
        ...inboxRow,
        status: "started",
        startedAt: nowIso,
      };

      const assignedStudentBase =
  `schools/${schoolId}/educatorDrills/${drillId}/assignedStudents/${studentId}`;

      await db.ref().update({
        [`${assignedStudentBase}/status`]: "started",
        [`${assignedStudentBase}/startedAt`]: claimedInboxRow.startedAt ||
        nowIso,
      });
    }

    const assignment = sanitizeAssignment(
        drillId,
        claimedInboxRow,
        drill,
        bpCheck.questionCount,
        bpCheck.totalTimeMin,
    );


    return res.status(200).json({
      ok: true,
      studentId,
      assignment,
      blueprint,
      settings: {
        scorePolicy: settings.scorePolicy || "immediate",
        correctionPolicy: settings.correctionPolicy || "manual",
        shuffleQuestions: settings.shuffleQuestions !== false,
        shuffleOptions: settings.shuffleOptions !== false,
      },
      syncedAt: nowIso,
    });
  } catch (e) {
    const details = errText(e);

    if ([400, 403, 409].includes(Number(e && e.code))) {
      return bad(res, Number(e.code), "SUBSCRIPTION_REQUIRED", details);
    }

    if (e && e.code === 401) {
      return bad(res, 401, "INVALID_AUTH_HEADER", details);
    }

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
