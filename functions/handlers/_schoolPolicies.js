"use strict";

/**
 * Existing school records predate the enrollment switch. Treat a missing
 * value as open; only an explicit false closes student enrollment.
 *
 * @param {Object|null|undefined} unit School unit record
 * @return {boolean} Whether a new student may join
 */
function studentEnrollmentOpen(unit) {
  return !unit || unit.platoonPermissions !== false;
}

/**
 * Validate an IANA timezone without maintaining a second timezone catalog.
 *
 * @param {unknown} value Candidate timezone
 * @return {boolean} Whether Intl recognizes the timezone
 */
function isValidTimezone(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 80) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: value.trim()}).format();
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = {isValidTimezone, studentEnrollmentOpen};
