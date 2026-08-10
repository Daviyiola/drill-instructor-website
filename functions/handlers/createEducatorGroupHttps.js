"use strict";

const {allowCors} = require("./_auth");
const {
  bad,
  errText,
  safeGroupName,
  safeDescription,
  getApprovedEducatorContext,
  filterAllowedMemberIds,
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
    const name = safeGroupName(body.name);
    const description = safeDescription(body.description);
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];

    if (!name) {
      return bad(res, 400, "INVALID_ARGUMENT", ["name"]);
    }

    if (scope === "admin" && !ctx.isAdmin) {
      return bad(res, 403, "ADMIN_ACCESS_REQUIRED");
    }

    const {allowed, rejected} = await filterAllowedMemberIds(
        ctx.db,
        memberIds,
        ctx.schoolNorm,
        ctx.schoolEducator,
    );

    const parentPath = scope === "admin" ?
      `schools/${ctx.schoolId}/groups/admin` :
      `schools/${ctx.schoolId}/groups/educators/${ctx.educatorId}`;

    const groupRef = ctx.db.ref(parentPath).push();
    const groupId = groupRef.key;
    const nowIso = new Date().toISOString();

    const group = {
      name,
      description,
      scope,
      createdBy: ctx.educatorId,
      createdAt: nowIso,
      updatedAt: nowIso,
      members: allowed,
    };

    await groupRef.set(group);

    return res.status(200).json({
      ok: true,
      groupId,
      scope,
      group,
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
