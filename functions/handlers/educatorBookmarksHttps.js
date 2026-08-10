"use strict";
/* eslint-disable require-jsdoc */

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {bad, cleanStr, readEducatorSchoolContext} =
  require("./_schoolDrillsAccess");
const {
  cleanSegment,
  correctionRevisionFor,
  datasetVersionFor,
  normalizedQuestions,
} = require("./_studentDrill");

function bookmarkPath(schoolId, educatorId, bootcamp) {
  return `schools/${schoolId}/educatorBookmarks/${educatorId}/${bootcamp}`;
}

function normalizeGroups(value) {
  const rows = Array.isArray(value) ? value :
    value && typeof value === "object" ? Object.values(value) : [];
  return [...new Set(rows.map((group) => cleanStr(group, 40)).filter(Boolean))]
      .slice(0, 20);
}

function publicQuestion(question, saved) {
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
    bookmarkedAt: cleanStr(saved && saved.bookmarkedAt, 80),
    groups: normalizeGroups(saved && saved.groups),
  };
}

async function educatorContext(req) {
  const body = req.body || {};
  const bootcamp = cleanStr(body.bootcamp, 40).toLowerCase();
  if (!bootcamp) return {error: "MISSING_BOOTCAMP", code: 400};
  const uid = await requireBearerUid(req);
  const db = getDatabase();
  const context = await readEducatorSchoolContext(db, uid, bootcamp);
  return {...context, db, bootcamp};
}

async function getBookmarks(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
    const context = await educatorContext(req);
    if (context.error) {
      return bad(res, context.code || 403, context.error, context.details);
    }
    const path = bookmarkPath(
        context.schoolId,
        context.educatorId,
        context.bootcamp,
    );
    const stored = (await context.db.ref(path).once("value")).val() || {};
    const byId = new Map(normalizedQuestions(context.bootcamp)
        .map((question) => [question.id, question]));
    const bookmarks = Object.entries(stored)
        .map(([questionId, value]) => {
          const question = byId.get(questionId);
          return question ? publicQuestion(question, value) : null;
        })
        .filter(Boolean)
        .sort((a, b) => String(b.bookmarkedAt)
            .localeCompare(String(a.bookmarkedAt)));
    return res.status(200).json({
      ok: true,
      bootcamp: context.bootcamp,
      datasetVersion: datasetVersionFor(context.bootcamp),
      correctionRevision: correctionRevisionFor(context.bootcamp),
      bookmarks,
      unavailableCount: Math.max(
          0,
          Object.keys(stored).length - bookmarks.length,
      ),
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("GET_EDUCATOR_BOOKMARKS_FAILED", error);
    return bad(res, Number(error.code) || 500, "EDUCATOR_BOOKMARKS_FAILED");
  }
}

async function setBookmark(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
    const context = await educatorContext(req);
    if (context.error) {
      return bad(res, context.code || 403, context.error, context.details);
    }
    const questionId = cleanSegment(req.body && req.body.questionId, 140);
    if (!questionId) return bad(res, 400, "MISSING_QUESTION_ID");
    const question = normalizedQuestions(context.bootcamp)
        .find((row) => row.id === questionId);
    if (!question || question.disabled) {
      return bad(res, 404, "QUESTION_NOT_AVAILABLE");
    }
    const bookmarked = req.body && req.body.bookmarked !== false;
    const path = `${bookmarkPath(
        context.schoolId,
        context.educatorId,
        context.bootcamp,
    )}/${questionId}`;
    const now = new Date().toISOString();
    await context.db.ref(path).set(bookmarked ? {
      questionId,
      datasetVersion: datasetVersionFor(context.bootcamp),
      subject: question.subject,
      module: question.module,
      practiceTest: question.practiceYear,
      bookmarkedAt: now,
    } : null);
    return res.status(200).json({
      ok: true,
      questionId,
      bookmarked,
      updatedAt: now,
    });
  } catch (error) {
    console.error("SET_EDUCATOR_BOOKMARK_FAILED", error);
    return bad(res, Number(error.code) || 500, "EDUCATOR_BOOKMARK_FAILED");
  }
}

async function setBookmarkGroups(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
    const context = await educatorContext(req);
    if (context.error) {
      return bad(res, context.code || 403, context.error, context.details);
    }
    const questionId = cleanSegment(req.body && req.body.questionId, 140);
    if (!questionId) return bad(res, 400, "MISSING_QUESTION_ID");
    const base = bookmarkPath(
        context.schoolId,
        context.educatorId,
        context.bootcamp,
    );
    const bookmarkRef = context.db.ref(`${base}/${questionId}`);
    if (!(await bookmarkRef.once("value")).exists()) {
      return bad(res, 404, "BOOKMARK_NOT_FOUND");
    }
    const groups = normalizeGroups(req.body && req.body.groups);
    await bookmarkRef.child("groups").set(groups.length ? groups : null);
    return res.status(200).json({ok: true, questionId, groups});
  } catch (error) {
    console.error("SET_EDUCATOR_BOOKMARK_GROUPS_FAILED", error);
    return bad(res, Number(error.code) || 500, "BOOKMARK_GROUPS_FAILED");
  }
}

async function deleteBookmarkGroup(req, res) {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "METHOD_NOT_ALLOWED");
    const context = await educatorContext(req);
    if (context.error) {
      return bad(res, context.code || 403, context.error, context.details);
    }
    const group = cleanStr(req.body && req.body.group, 40);
    if (!group) return bad(res, 400, "MISSING_GROUP");
    const base = bookmarkPath(
        context.schoolId,
        context.educatorId,
        context.bootcamp,
    );
    const stored = (await context.db.ref(base).once("value")).val() || {};
    const updates = {};
    Object.entries(stored).forEach(([questionId, bookmark]) => {
      const groups = normalizeGroups(bookmark && bookmark.groups)
          .filter((item) => item !== group);
      updates[`${questionId}/groups`] = groups.length ? groups : null;
    });
    if (Object.keys(updates).length) {
      await context.db.ref(base).update(updates);
    }
    return res.status(200).json({ok: true, group});
  } catch (error) {
    console.error("DELETE_EDUCATOR_BOOKMARK_GROUP_FAILED", error);
    return bad(res, Number(error.code) || 500, "DELETE_BOOKMARK_GROUP_FAILED");
  }
}

module.exports = {
  bookmarkPath,
  deleteBookmarkGroup,
  getBookmarks,
  normalizeGroups,
  publicQuestion,
  setBookmark,
  setBookmarkGroups,
};
