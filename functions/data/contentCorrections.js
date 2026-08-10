"use strict";

/**
 * Cumulative corrections relative to each immutable base content version.
 *
 * When correctionRevision is bumped in contentVersions.js, the matching map
 * here must contain every correction made since the base was published. A
 * correction may change content fields or set disabled: true, but moving a
 * question between subjects, modules, or practice tests requires a new base.
 */
const CONTENT_CORRECTIONS = Object.freeze({
  act: Object.freeze({}),
  sat: Object.freeze({}),
});

/**
 * @param {*} bootcamp Bootcamp identifier
 * @return {Object} Cumulative correction map keyed by canonical question id
 */
function correctionsFor(bootcamp) {
  return CONTENT_CORRECTIONS[String(bootcamp || "").trim().toLowerCase()] || {};
}

module.exports = {CONTENT_CORRECTIONS, correctionsFor};
