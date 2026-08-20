"use strict";
/* eslint-disable require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {
  bad,
  cleanStr,
  readEducatorSchoolContext,
} = require("./_schoolDrillsAccess");
const {
  buildCatalog,
  correctionRevisionFor,
  datasetVersionFor,
  normalizedQuestions,
  orderedSelectQuestions,
  smartSelectQuestions,
} = require("./_studentDrill");

function parseCursor(value) {
  if (!value) return 0;
  try {
    const parsed = Number(Buffer.from(String(value), "base64url")
        .toString("utf8"));
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch (_) {
    return 0;
  }
}

function encodeCursor(value) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function filterQuestions(bootcamp, body) {
  const subject = cleanStr(body.subject, 100);
  const moduleName = cleanStr(body.module, 200);
  const practiceTest = Number(body.practiceTest || 0);
  const requestedIds = Array.isArray(body.questionIds) ?
    [...new Set(body.questionIds.map((value) => cleanStr(value, 160))
        .filter(Boolean))].slice(0, 500) : [];
  const requestedOrder = new Map(
      requestedIds.map((questionId, index) => [questionId, index]),
  );
  const rows = normalizedQuestions(bootcamp).filter((question) =>
    !question.disabled &&
    (!requestedIds.length || requestedOrder.has(question.id)) &&
    (!subject || question.subject === subject) &&
    (!moduleName || question.module === moduleName) &&
    (!practiceTest || question.practiceYear === practiceTest));
  return requestedIds.length ? rows.sort((left, right) =>
    requestedOrder.get(left.id) - requestedOrder.get(right.id)) : rows;
}

function educatorQuestion(question) {
  return {
    id: question.id,
    legacyId: question.legacyId,
    sourceId: question.sourceId,
    subject: question.subject,
    module: question.module,
    practiceTest: question.practiceYear,
    prompt: question.prompt,
    options: question.options,
    answerIndex: question.correctIndex,
    explanation: question.explanation,
    passage: question.passage,
    imageSources: question.imageSources,
    disabled: Boolean(question.disabled),
  };
}

function educatorCatalog(bootcamp) {
  const catalog = buildCatalog(bootcamp);
  return {
    ok: true,
    ...catalog,
    licensed: true,
    freePracticeYears: [1, 2],
    subjects: catalog.subjects.map((subject) => ({
      ...subject,
      availablePracticeYears: subject.practiceYears,
    })),
  };
}

async function context(req, body) {
  const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
  if (!bootcamp) return {error: "MISSING_BOOTCAMP"};
  const callerUid = await requireBearerUid(req);
  const db = getDatabase();
  const access = await readEducatorSchoolContext(db, callerUid, bootcamp);
  return {...access, db, bootcamp};
}

async function getQuestionBank(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
    const body = req.body || {};
    const access = await context(req, body);
    if (access.error) return bad(res, 403, access.error, access.details);
    const rows = filterQuestions(access.bootcamp, body);
    const offset = parseCursor(body.cursor);
    const hasQuestionIds = Array.isArray(body.questionIds) &&
      body.questionIds.length > 0;
    const limit = Math.min(hasQuestionIds ? 500 : 100,
        Math.max(1, Number(body.limit || (hasQuestionIds ? 500 : 50))));
    const page = rows.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return res.status(200).json({
      ok: true,
      bootcamp: access.bootcamp,
      datasetVersion: datasetVersionFor(access.bootcamp),
      correctionRevision: correctionRevisionFor(access.bootcamp),
      catalog: educatorCatalog(access.bootcamp),
      questions: page.map(educatorQuestion),
      nextCursor: nextOffset < rows.length ? encodeCursor(nextOffset) : null,
      totalMatching: rows.length,
    });
  } catch (error) {
    console.error("EDUCATOR_QUESTION_BANK_FAILED", error);
    return bad(res, Number(error.code) || 500, "QUESTION_BANK_FAILED");
  }
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

async function buildBlueprint(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
    const body = req.body || {};
    const access = await context(req, body);
    if (access.error) return bad(res, 403, access.error, access.details);
    const requested = Array.isArray(body.subjects) ? body.subjects : [];
    if (!requested.length || requested.length > 20) {
      return bad(res, 400, "INVALID_SUBJECT_CONFIGURATION");
    }
    const all = normalizedQuestions(access.bootcamp)
        .filter((question) => !question.disabled);
    const catalog = buildCatalog(access.bootcamp);
    const subjectNames = new Set(catalog.subjects.map((row) => row.name));
    const blueprintSubjects = [];
    const preview = [];
    let totalQuestions = 0;
    for (const row of requested) {
      const subject = cleanStr(row && row.subject, 100);
      if (!subjectNames.has(subject)) {
        return bad(res, 400, "INVALID_BLUEPRINT_SUBJECT", {subject});
      }
      const modules = normalizeList(row.modules);
      const practiceTests = normalizeList(
          row.practiceTests || row.practiceYears,
      ).map(Number).filter((value) => value > 0);
      const requestedCount = Math.min(
          300, Math.max(1, Math.floor(Number(row.questionCount || 20))),
      );
      const candidates = all.filter((question) =>
        question.subject === subject &&
        (!modules.length || modules.includes(question.module)) &&
        (!practiceTests.length ||
          practiceTests.includes(question.practiceYear)));
      const shuffleQuestions = row &&
        (row.shuffleQuestions === true || row.shuffle === true);
      const picked = shuffleQuestions ?
        smartSelectQuestions(candidates, requestedCount) :
        orderedSelectQuestions(candidates, requestedCount);
      if (!picked.length) {
        return bad(res, 400, "NO_MATCHING_QUESTIONS", {subject});
      }
      totalQuestions += picked.length;
      if (totalQuestions > 500) {
        return bad(res, 400, "TOO_MANY_QUESTIONS", {max: 500});
      }
      blueprintSubjects.push({
        subject,
        questionIds: picked.map((question) => question.id),
        timeLimitMin: Math.min(
            300, Math.max(1, Number(row.timeLimitMin || 30)),
        ),
        filters: {
          practiceYearCsv: practiceTests.join(","),
          modulesCsv: modules.join(","),
        },
      });
      preview.push(...picked.map(educatorQuestion));
    }
    return res.status(200).json({
      ok: true,
      blueprint: {
        bootcamp: access.bootcamp,
        datasetVersion: datasetVersionFor(access.bootcamp),
        correctionRevision: correctionRevisionFor(access.bootcamp),
        subjects: blueprintSubjects,
        totalQuestions,
      },
      preview,
    });
  } catch (error) {
    console.error("EDUCATOR_BLUEPRINT_FAILED", error);
    return bad(res, Number(error.code) || 500, "BLUEPRINT_BUILD_FAILED");
  }
}

module.exports = {
  buildBlueprint,
  educatorCatalog,
  filterQuestions,
  getQuestionBank,
};
