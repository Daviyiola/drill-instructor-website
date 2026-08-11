"use strict";

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {buildCatalog, resolveStudent, SUPPORTED_BOOTCAMPS} =
  require("./_studentDrill");
const {validatePreference} = require("./_diriPreferences");

/**
 * Save the authenticated student's canonical DIRI subject set.
 * @param {Object} req HTTP request
 * @param {Object} res HTTP response
 * @return {Promise<void>}
 */
async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  try {
    const bootcamp = String(req.body && req.body.bootcamp || "")
        .trim().toLowerCase();
    if (!SUPPORTED_BOOTCAMPS.includes(bootcamp)) {
      const error = new Error("A supported bootcamp is required");
      error.code = 400;
      throw error;
    }
    const uid = await requireBearerUid(req);
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const catalog = buildCatalog(bootcamp);
    const preference = validatePreference(
        bootcamp, catalog, req.body && req.body.selectedSubjects);
    await db.ref(`users/${studentId}/analyticsPreferences/${bootcamp}`).set({
      selectedSubjects: preference.selectedSubjects,
      updatedAt: new Date().toISOString(),
    });
    return res.status(200).json({
      ok: true, bootcamp, diriPreference: preference,
    });
  } catch (error) {
    const status = [400, 401, 403, 404].includes(Number(error.code)) ?
      Number(error.code) : 500;
    if (status === 500) {
      console.error("STUDENT_ANALYTICS_PREFERENCE_FAILED", error);
    }
    return res.status(status).json({
      error: status === 500 ?
        "Unable to save analytics preferences" : error.message,
    });
  }
}

module.exports = {handler};
