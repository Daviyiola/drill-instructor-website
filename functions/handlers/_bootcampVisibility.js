"use strict";

const CATALOG = ["act", "sat", "utme", "waec"];

/**
 * Normalize a bootcamp identifier used in RTDB paths.
 *
 * @param {*} value Candidate identifier
 * @return {string} Supported lowercase identifier or an empty string
 */
function normalizeBootcamp(value) {
  const id = String(value || "").trim().toLowerCase();
  return CATALOG.includes(id) ? id : "";
}

/**
 * Return the enabled bootcamps in a school plan.
 *
 * @param {*} bootcamps Raw plan bootcamp map
 * @return {string[]} Sorted supported identifiers
 */
function enabledPlanBootcamps(bootcamps) {
  if (!bootcamps || typeof bootcamps !== "object") return [];
  return Object.entries(bootcamps)
      .filter(([, value]) => value === true ||
        (value && typeof value === "object" && value.enabled === true))
      .map(([key]) => normalizeBootcamp(key))
      .filter(Boolean)
      .sort();
}

/**
 * Return supported bootcamp keys with existing student test data.
 *
 * @param {*} testdata Raw student testdata map
 * @return {string[]} Sorted supported identifiers
 */
function studentTestdataBootcamps(testdata) {
  if (!testdata || typeof testdata !== "object") return [];
  return Object.keys(testdata)
      .map(normalizeBootcamp)
      .filter(Boolean)
      .sort();
}

/**
 * Convert a stored visibility map to identifiers.
 *
 * @param {*} visible Raw visibility map
 * @return {string[]} Sorted supported identifiers
 */
function visibleBootcamps(visible) {
  if (!visible || typeof visible !== "object") return [];
  return Object.entries(visible)
      .filter(([, value]) => value === true)
      .map(([key]) => normalizeBootcamp(key))
      .filter(Boolean)
      .sort();
}

/**
 * Resolve the caller's linked Drill Instructor account.
 *
 * @param {Object} db Firebase database
 * @param {string} uid Firebase Auth UID
 * @return {Promise<Object>} Account scope
 */
async function resolveBootcampAccount(db, uid) {
  const uidMap = (await db.ref(`uidToCustom/${uid}`).once("value")).val() || {};
  const educatorId = String(uidMap.educator || "");
  const studentId = String(uidMap.student || "");

  if (educatorId) {
    const educator = (await db.ref(`educators/${educatorId}`)
        .once("value")).val() || {};
    const schoolId = String(educator.schoolID || educator.schoolId || "");
    if (!schoolId) {
      const err = new Error("Educator school is not configured");
      err.code = 409;
      throw err;
    }
    const access = (await db.ref(`schools/${schoolId}/educators/${educatorId}`)
        .once("value")).val() || {};
    const status = String(
        access.status || educator.approvalStatus || "pending",
    );
    if (status !== "approved") {
      const err = new Error("Educator account is not approved");
      err.code = 403;
      throw err;
    }
    const plan = (await db.ref(`schools/${schoolId}/plan/bootcamps`)
        .once("value")).val() || {};
    const available = enabledPlanBootcamps(plan);
    return {
      role: "educator",
      customUserId: educatorId,
      available,
      entitled: available,
    };
  }

  if (studentId) {
    const testdata = (await db.ref(`users/${studentId}/testdata`)
        .once("value")).val() || {};
    return {
      role: "student",
      customUserId: studentId,
      available: [...CATALOG],
      entitled: studentTestdataBootcamps(testdata),
    };
  }

  const err = new Error("No linked account was found");
  err.code = 404;
  throw err;
}

/**
 * Preference location kept separate from subscriptions, plans, and test data.
 *
 * @param {Object} account Resolved account scope
 * @return {string} RTDB preference path
 */
function preferencePath(account) {
  return `accountPreferences/${account.role}/${account.customUserId}/bootcamps`;
}

module.exports = {
  CATALOG,
  enabledPlanBootcamps,
  normalizeBootcamp,
  preferencePath,
  resolveBootcampAccount,
  studentTestdataBootcamps,
  visibleBootcamps,
};
