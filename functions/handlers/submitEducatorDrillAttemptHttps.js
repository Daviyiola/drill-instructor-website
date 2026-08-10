"use strict";

const {submitDrill} = require("./studentDrillsHttps");

/**
 * Assignment submissions now use the generic server-owned drill lifecycle.
 * The request must contain a sessionId and progress maps; client summaries,
 * answer keys, correctness flags, points, and snapshots are ignored.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function handler(req, res) {
  return submitDrill(req, res);
}

module.exports = {handler};
