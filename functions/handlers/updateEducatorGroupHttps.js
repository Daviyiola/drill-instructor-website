/* eslint-disable require-jsdoc, max-len */
"use strict";

const {allowCors} = require("./_auth");
const {
  bad,
  cleanStr,
  errText,
  safeGroupName,
  safeDescription,
  getApprovedEducatorContext,
  filterAllowedMemberIds,
  groupPathForScope,
  sanitizeScope,
} = require("./_educatorGroupAccess");

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const ctx = await getApprovedEducatorContext(req);
    const body = req.body || {};

    const oldScope = sanitizeScope(body.scope);
    const newScope = body.newScope ? sanitizeScope(body.newScope) : oldScope;
    const groupId = cleanStr(body.groupId || body.rawGroupId, 120);

    if (!groupId) {
      return bad(res, 400, "INVALID_ARGUMENT", ["groupId"]);
    }

    // Any admin-scope read/write/move requires admin.
    if ((oldScope === "admin" || newScope === "admin") && !ctx.isAdmin) {
      return bad(res, 403, "ADMIN_ACCESS_REQUIRED");
    }

    // Moving a school/admin group into personal group also requires admin,
    // because otherwise any educator could “steal” school groups into their space.
    if (oldScope !== newScope && !ctx.isAdmin) {
      return bad(res, 403, "ADMIN_ACCESS_REQUIRED");
    }

    const oldPath = groupPathForScope(
        ctx.schoolId,
        ctx.educatorId,
        oldScope,
        groupId,
    );

    const oldRef = ctx.db.ref(oldPath);
    const oldSnap = await oldRef.once("value");
    const existing = oldSnap.val();

    if (!existing) {
      return bad(res, 404, "GROUP_NOT_FOUND");
    }

    const nowIso = new Date().toISOString();

    const nextGroup = Object.assign({}, existing);
    nextGroup.updatedAt = nowIso;

    if (body.name !== undefined) {
      const name = safeGroupName(body.name);
      if (!name) return bad(res, 400, "INVALID_ARGUMENT", ["name"]);
      nextGroup.name = name;
    }

    if (body.description !== undefined) {
      nextGroup.description = safeDescription(body.description);
    }

    let rejected = [];

    if (Array.isArray(body.memberIds)) {
      const result = await filterAllowedMemberIds(
          ctx.db,
          body.memberIds,
          ctx.schoolNorm,
          ctx.schoolEducator,
      );

      nextGroup.members = result.allowed;
      rejected = result.rejected;
    }

    nextGroup.scope = newScope;

    // If same scope, normal update.
    if (oldScope === newScope) {
      await oldRef.set(nextGroup);

      return res.status(200).json({
        ok: true,
        groupId,
        scope: newScope,
        moved: false,
        group: nextGroup,
        rejectedMemberIds: rejected,
      });
    }

    // If scope changed, move between paths.
    const newPath = groupPathForScope(
        ctx.schoolId,
        ctx.educatorId,
        newScope,
        groupId,
    );

    const updates = {};
    updates[oldPath] = null;
    updates[newPath] = nextGroup;

    await ctx.db.ref().update(updates);

    return res.status(200).json({
      ok: true,
      groupId,
      oldScope,
      scope: newScope,
      moved: true,
      group: nextGroup,
      rejectedMemberIds: rejected,
    });
  } catch (e) {
    const code = e.statusCode || 500;
    return res.status(code).json({
      ok: false,
      error: code === 500 ? "INTERNAL" : errText(e),
      details: e.details || (code === 500 ? errText(e) : null),
    });
  }
};
