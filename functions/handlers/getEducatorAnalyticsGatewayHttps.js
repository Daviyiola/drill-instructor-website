"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {projectAttempt} = require("./_analytics");
const {
  bad,
  cleanStr,
  collectCandidateStudentIds,
  educatorHasBootcampAccess,
  errText,
  hydrateAllowedStudents,
  isActivePlan,
  normalizeSchool,
  normalizeUidToEducator,
  planHasBootcamp,
  sanitizeGroup,
} = require("./_schoolAdminAccess");

/**
 * Resolve calling educator and school from Firebase UID.
 *
 * @param {Object} db Firebase database instance
 * @param {string} callerFbUid Firebase auth UID
 * @return {Promise<Object>} Caller context or error
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
 * Convert requested range key to cutoff timestamp.
 *
 * @param {string} rangeKey Range key
 * @return {number} Start timestamp in ms; 0 means all time
 */
function rangeStartMs(rangeKey) {
  const key = cleanStr(rangeKey, 20).toLowerCase();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (key === "14d" || key === "14") return now - (14 * dayMs);
  if (key === "30d" || key === "30") return now - (30 * dayMs);
  if (key === "90d" || key === "90") return now - (90 * dayMs);

  return 0;
}

/**
 * Normalize date/time input to milliseconds.
 *
 * @param {*} v Date-ish value
 * @return {number} Milliseconds, or 0 when invalid
 */
function dateMs(v) {
  if (!v) return 0;

  if (typeof v === "number") {
    return v < 1000000000000 ? v * 1000 : v;
  }

  const parsed = Date.parse(String(v));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Create an empty analytics aggregate row.
 *
 * @return {Object} Aggregate object
 */
function emptyAgg() {
  return {
    attempted: 0,
    correct: 0,
    sessions: 0,
    totalTimeSec: 0,
    avgTimeSec: 0,
    accuracyPct: 0,
    lastTakenAt: "",
    lastTakenMs: 0,
  };
}

/**
 * Finalize accuracy and average time for an aggregate row.
 *
 * @param {Object} agg Aggregate row
 * @return {Object} Final aggregate row
 */
function finalizeAgg(agg) {
  const attempted = Number(agg.attempted || 0);
  const correct = Number(agg.correct || 0);
  const totalTimeSec = Number(agg.totalTimeSec || 0);

  agg.accuracyPct = attempted > 0 ?
    Math.round((correct * 100) / attempted) :
    0;

  agg.avgTimeSec = attempted > 0 ?
    Math.floor(totalTimeSec / attempted) :
    0;

  return agg;
}

/**
 * Read and aggregate one student's statsIndex.
 *
 * @param {Object} db Firebase database instance
 * @param {string} studentId Student custom id
 * @param {string} bootcamp Active bootcamp
 * @param {number} startMs Range start in ms
 * @return {Promise<Object>} Aggregate row
 */
async function readStudentStatsIndexAgg(db, studentId, bootcamp, startMs) {
  const snap = await db.ref(`users/${studentId}/statsIndex`).once("value");
  const rows = snap.val() || {};
  const agg = emptyAgg();

  if (rows && typeof rows === "object") {
    for (const attemptId of Object.keys(rows)) {
      if (!rows[attemptId] || !rows[attemptId].activity ||
          !rows[attemptId].source || !rows[attemptId].submittedAt) continue;
      const attempt = projectAttempt(rows[attemptId], {educator: true});
      const submittedMs = dateMs(attempt.submittedAt);
      if (attempt.bootcamp !== bootcamp ||
          startMs > 0 && submittedMs < startMs) continue;
      agg.attempted += Number(attempt.activity &&
        attempt.activity.attempted || 0);
      agg.correct += Number(attempt.performance &&
        attempt.performance.correct || 0);
      agg.totalTimeSec += Number(attempt.activity &&
        attempt.activity.activeTimeSec || 0);
      agg.sessions += 1;
      if (submittedMs > agg.lastTakenMs) {
        agg.lastTakenMs = submittedMs;
        agg.lastTakenAt = attempt.submittedAt;
      }
    }
  }

  return finalizeAgg(agg);
}

/**
 * Build a student analytics gateway row.
 *
 * @param {Object} student Sanitized student row
 * @param {Object} agg Aggregated stats row
 * @return {Object} Gateway student row
 */
function buildStudentGatewayRow(student, agg) {
  return {
    id: cleanStr(student.id, 120),
    firstName: cleanStr(student.firstName, 60),
    lastName: cleanStr(student.lastName, 60),
    platoonName: cleanStr(student.platoonName, 100),
    attempted: Number(agg.attempted || 0),
    correct: Number(agg.correct || 0),
    accuracyPct: Number(agg.accuracyPct || 0),
    sessions: Number(agg.sessions || 0),
    totalTimeSec: Number(agg.totalTimeSec || 0),
    avgTimeSec: Number(agg.avgTimeSec || 0),
    lastTakenAt: cleanStr(agg.lastTakenAt, 40),
    lastTakenMs: Number(agg.lastTakenMs || 0),
  };
}

/**
 * Return true if school admin groups should be visible broadly.
 *
 * @param {Object} schoolEducator School educator permission row
 * @return {boolean} True when all school groups are visible
 */
function canSeeAllAdminGroups(schoolEducator) {
  const access = schoolEducator.access || {};

  return schoolEducator.superAdmin === true ||
    schoolEducator.adminAccess === true ||
    !!(access.groups && access.groups.all === true);
}

/**
 * Read visible school/admin groups for analytics.
 *
 * @param {Object} db Firebase database instance
 * @param {string} schoolId School id
 * @param {Object} schoolEducator School educator row
 * @param {Object} allowedMap Visible student ids map
 * @return {Promise<Object[]>} Sanitized group rows
 */
async function readVisibleAdminGroups(
    db, schoolId, schoolEducator, allowedMap) {
  const access = schoolEducator.access || {};
  const groupsSnap = await db.ref(`schools/${schoolId}/groups/admin`)
      .once("value");
  const groups = groupsSnap.val() || {};
  const out = [];
  const allowAllGroups = canSeeAllAdminGroups(schoolEducator);

  for (const groupId of Object.keys(groups)) {
    const explicitlyAllowed =
      access.groups &&
      access.groups[groupId] === true;

    if (!allowAllGroups && !explicitlyAllowed) continue;

    const row = sanitizeGroup(groupId, groups[groupId], allowedMap, false);
    out.push(row);
  }

  return out;
}

/**
 * Read educator-owned groups for analytics.
 *
 * @param {Object} db Firebase database instance
 * @param {string} schoolId School id
 * @param {string} educatorId Educator id
 * @param {Object} allowedMap Visible student ids map
 * @return {Promise<Object[]>} Sanitized group rows
 */
async function readVisibleEducatorGroups(
    db,
    schoolId,
    educatorId,
    allowedMap,
) {
  const groupsSnap = await db
      .ref(`schools/${schoolId}/groups/educators/${educatorId}`)
      .once("value");

  const groups = groupsSnap.val() || {};
  const out = [];

  for (const groupId of Object.keys(groups)) {
    const row = sanitizeGroup(groupId, groups[groupId], allowedMap, false);
    row.id = `educator_${row.rawGroupId}`;
    row.scope = "educator";
    row.ownerEducatorId = educatorId;
    out.push(row);
  }

  return out;
}

/**
 * Read all groups visible to this educator.
 *
 * @param {Object} db Firebase database instance
 * @param {string} schoolId School id
 * @param {string} educatorId Educator id
 * @param {Object} schoolEducator School educator row
 * @param {Object} allowedMap Visible student ids map
 * @return {Promise<Object[]>} Sanitized group rows
 */
async function readVisibleGroups(
    db,
    schoolId,
    educatorId,
    schoolEducator,
    allowedMap,
) {
  const [adminGroups, educatorGroups] = await Promise.all([
    readVisibleAdminGroups(db, schoolId, schoolEducator, allowedMap),
    readVisibleEducatorGroups(db, schoolId, educatorId, allowedMap),
  ]);

  const rows = adminGroups.concat(educatorGroups);

  rows.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "admin" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

/**
 * Build group analytics row from group members.
 *
 * @param {Object} group Sanitized group row
 * @param {Object} studentAggMap Student aggregate map
 * @return {Object} Gateway group row
 */
function buildGroupGatewayRow(group, studentAggMap) {
  const agg = emptyAgg();
  const memberIds = Array.isArray(group.memberIds) ? group.memberIds : [];
  let activeStudentCount = 0;

  for (const studentId of memberIds) {
    const sAgg = studentAggMap[studentId] || emptyAgg();

    if (Number(sAgg.sessions || 0) > 0) {
      activeStudentCount += 1;
    }

    agg.attempted += Number(sAgg.attempted || 0);
    agg.correct += Number(sAgg.correct || 0);
    agg.sessions += Number(sAgg.sessions || 0);
    agg.totalTimeSec += Number(sAgg.totalTimeSec || 0);

    if (Number(sAgg.lastTakenMs || 0) > agg.lastTakenMs) {
      agg.lastTakenMs = Number(sAgg.lastTakenMs || 0);
      agg.lastTakenAt = cleanStr(sAgg.lastTakenAt, 40);
    }
  }

  finalizeAgg(agg);

  return {
    id: cleanStr(group.id, 180),
    rawGroupId: cleanStr(group.rawGroupId, 180),
    scope: cleanStr(group.scope, 40) || "admin",
    ownerEducatorId: cleanStr(group.ownerEducatorId, 120),
    name: cleanStr(group.name, 100) || "Untitled Group",
    studentCount: memberIds.length,
    activeStudentCount,
    attempted: Number(agg.attempted || 0),
    correct: Number(agg.correct || 0),
    accuracyPct: Number(agg.accuracyPct || 0),
    sessions: Number(agg.sessions || 0),
    totalTimeSec: Number(agg.totalTimeSec || 0),
    avgTimeSec: Number(agg.avgTimeSec || 0),
    lastTakenAt: cleanStr(agg.lastTakenAt, 40),
    lastTakenMs: Number(agg.lastTakenMs || 0),
  };
}

/**
 * Sort rows according to requested field/order.
 *
 * @param {Object[]} rows Input rows
 * @param {string} sortBy Sort key
 * @param {string} orderBy asc or desc
 * @return {Object[]} Sorted rows
 */
function sortGatewayRows(rows, sortBy, orderBy) {
  const sort = cleanStr(sortBy, 30).toLowerCase() || "name";
  const order = cleanStr(orderBy, 10).toLowerCase() === "asc" ? 1 : -1;

  rows.sort((a, b) => {
    let av = 0;
    let bv = 0;

    if (sort === "name") {
      const an = cleanStr(a.name || `${a.firstName} ${a.lastName}`, 200);
      const bn = cleanStr(b.name || `${b.firstName} ${b.lastName}`, 200);
      return an.localeCompare(bn) * order;
    }

    if (sort === "attempted") {
      av = Number(a.attempted || 0);
      bv = Number(b.attempted || 0);
    } else if (sort === "correct") {
      av = Number(a.correct || 0);
      bv = Number(b.correct || 0);
    } else if (sort === "accuracy") {
      av = Number(a.accuracyPct || 0);
      bv = Number(b.accuracyPct || 0);
    } else if (sort === "recent") {
      av = Number(a.lastTakenMs || 0);
      bv = Number(b.lastTakenMs || 0);
    } else if (sort === "sessions") {
      av = Number(a.sessions || 0);
      bv = Number(b.sessions || 0);
    } else if (sort === "averagetime") {
      av = Number(a.avgTimeSec || 0);
      bv = Number(b.avgTimeSec || 0);
    } else {
      av = Number(a.attempted || 0);
      bv = Number(b.attempted || 0);
    }

    if (av === bv) {
      const an = cleanStr(a.name || `${a.firstName} ${a.lastName}`, 200);
      const bn = cleanStr(b.name || `${b.firstName} ${b.lastName}`, 200);
      return an.localeCompare(bn);
    }

    return av < bv ? -1 * order : 1 * order;
  });

  return rows;
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const body = req.body || {};
    const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
    const rangeKey = cleanStr(body.range, 20).toLowerCase() || "30d";
    const sortBy = cleanStr(body.sortBy, 30).toLowerCase() || "name";
    const orderBy = cleanStr(body.orderBy, 10).toLowerCase() || "desc";

    if (!bootcamp) {
      return bad(res, 400, "MISSING_BOOTCAMP");
    }

    const callerFbUid = await requireBearerUid(req);
    const db = getDatabase();
    const callerCtx = await readCallerContext(db, callerFbUid);

    if (callerCtx.error) {
      return bad(res, 403, callerCtx.error);
    }

    const {educatorId, schoolId} = callerCtx;

    const [nameSnap, countrySnap, stateSnap, planSnap, schoolEducatorSnap] =
      await Promise.all([
        db.ref(`schools/${schoolId}/name`).once("value"),
        db.ref(`schools/${schoolId}/country`).once("value"),
        db.ref(`schools/${schoolId}/state`).once("value"),
        db.ref(`schools/${schoolId}/plan`).once("value"),
        db.ref(`schools/${schoolId}/educators/${educatorId}`).once("value"),
      ]);

    const school = {
      name: nameSnap.val(),
      country: countrySnap.val(),
      state: stateSnap.val(),
      plan: planSnap.val() || {},
    };
    const schoolEducator = schoolEducatorSnap.val() || {};

    if (schoolEducator.status !== "approved") {
      return bad(res, 403, "EDUCATOR_NOT_APPROVED", {
        status: schoolEducator.status || "missing",
      });
    }

    const plan = school.plan || {};
    if (!isActivePlan(plan)) {
      return bad(res, 403, "SCHOOL_PLAN_NOT_ACTIVE", {
        planStatus: cleanStr(plan.status, 40) || "missing",
      });
    }

    if (!planHasBootcamp(plan, bootcamp)) {
      return bad(res, 403, "BOOTCAMP_NOT_IN_SCHOOL_PLAN", {
        bootcamp,
      });
    }

    if (!educatorHasBootcampAccess(schoolEducator, bootcamp)) {
      return bad(res, 403, "EDUCATOR_HAS_NO_BOOTCAMP_ACCESS", {
        bootcamp,
      });
    }

    const schoolNorm = normalizeSchool(schoolId, school);
    if (!schoolNorm.name || !schoolNorm.country || !schoolNorm.state) {
      return bad(res, 400, "SCHOOL_RECORD_INCOMPLETE", {
        schoolId,
        missing: {
          name: !schoolNorm.name,
          country: !schoolNorm.country,
          state: !schoolNorm.state,
        },
      });
    }

    const candidateResult = await collectCandidateStudentIds(
        db,
        schoolId,
        schoolNorm,
        schoolEducator,
    );

    const candidateIds = Array.isArray(candidateResult) ?
  candidateResult :
  candidateResult.candidateIds || [];

    const groupGrantMap = Array.isArray(candidateResult) ?
  {} :
  candidateResult.groupGrantMap || {};

    const {studentRows, allowedMap} = await hydrateAllowedStudents(
        db,
        candidateIds,
        schoolNorm,
        schoolEducator,
        groupGrantMap,
    );

    const startMs = rangeStartMs(rangeKey);
    const studentAggMap = {};
    const studentGatewayRows = [];

    const aggSnaps = await Promise.all(studentRows.map((student) => {
      return readStudentStatsIndexAgg(db, student.id, bootcamp, startMs);
    }));

    for (let i = 0; i < studentRows.length; i++) {
      const student = studentRows[i];
      const agg = aggSnaps[i];

      studentAggMap[student.id] = agg;
      studentGatewayRows.push(buildStudentGatewayRow(student, agg));
    }

    const groups = await readVisibleGroups(
        db,
        schoolId,
        educatorId,
        schoolEducator,
        allowedMap,
    );

    const groupGatewayRows = groups.map((group) => {
      return buildGroupGatewayRow(group, studentAggMap);
    });

    sortGatewayRows(studentGatewayRows, sortBy, orderBy);
    sortGatewayRows(groupGatewayRows, sortBy, orderBy);

    return res.status(200).json({
      ok: true,
      bootcamp,
      range: rangeKey,
      sortBy,
      orderBy,
      school: {
        schoolId,
        name: schoolNorm.name,
        country: schoolNorm.country,
        state: schoolNorm.state,
      },
      students: studentGatewayRows,
      groups: groupGatewayRows,
      //   debugCounts: {
      //     candidateIds: candidateIds.length,
      //     studentRows: studentRows.length,
      //     groups: groupGatewayRows.length,
      //   },
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
