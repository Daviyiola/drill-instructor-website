"use strict";

const {allowCors} = require("./_auth");
const {
  bad,
  cleanStr,
  errText,
  getApprovedEducatorContext,
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

    const scope = sanitizeScope(body.scope);
    const groupId = cleanStr(body.groupId || body.rawGroupId, 120);

    if (!groupId) {
      return bad(res, 400, "INVALID_ARGUMENT", ["groupId"]);
    }

    if (scope === "admin" && !ctx.isAdmin) {
      return bad(res, 403, "ADMIN_ACCESS_REQUIRED");
    }

    const groupPath = groupPathForScope(
        ctx.schoolId,
        ctx.educatorId,
        scope,
        groupId,
    );

    const groupRef = ctx.db.ref(groupPath);
    const snap = await groupRef.once("value");

    if (!snap.exists()) {
      return bad(res, 404, "GROUP_NOT_FOUND");
    }

    await groupRef.remove();

    return res.status(200).json({
      ok: true,
      groupId,
      scope,
      deleted: true,
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
