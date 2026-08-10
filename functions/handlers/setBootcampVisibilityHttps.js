"use strict";

const admin = require("firebase-admin");
const {allowCors, requireBearerUid} = require("./_auth");
const {
  normalizeBootcamp,
  preferencePath,
  resolveBootcampAccount,
  visibleBootcamps,
} = require("./_bootcampVisibility");

/**
 * Add or hide a bootcamp without changing access, plans, or test data.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function handler(req, res) {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return res.status(405).json({error: "Method not allowed"});
    }

    const uid = await requireBearerUid(req);
    const bootcamp = normalizeBootcamp(req.body && req.body.bootcamp);
    const isVisible = req.body && req.body.visible;
    if (!bootcamp || typeof isVisible !== "boolean") {
      return res.status(400).json({
        error: "Invalid bootcamp visibility request",
      });
    }

    const db = admin.database();
    const account = await resolveBootcampAccount(db, uid);
    if (isVisible && !account.available.includes(bootcamp)) {
      return res.status(403).json({
        error: "This bootcamp is not available to your account",
      });
    }

    const ref = db.ref(preferencePath(account));
    const result = await ref.transaction((current) => {
      const next = current && current.initialized === true ? current : {
        initialized: true,
        visible: {},
      };
      next.visible = next.visible && typeof next.visible === "object" ?
        next.visible : {};
      if (isVisible) next.visible[bootcamp] = true;
      else delete next.visible[bootcamp];
      next.updatedAt = admin.database.ServerValue.TIMESTAMP;
      return next;
    });

    const preference = result.snapshot.val() || {};
    return res.status(200).json({
      ok: true,
      bootcamp,
      visible: isVisible,
      visibleBootcamps: visibleBootcamps(preference.visible),
    });
  } catch (err) {
    const code = Number(err && err.code);
    if (code === 401 || String(err && err.code || "").startsWith("auth/")) {
      return res.status(401).json({error: "Authentication failed"});
    }
    if ([403, 404, 409].includes(code)) {
      return res.status(code).json({error: err.message});
    }
    console.error("SET_BOOTCAMP_VISIBILITY_FAILED", {
      message: err && err.message || "Unknown error",
    });
    return res.status(500).json({
      error: "Unable to update bootcamp visibility",
    });
  }
}

module.exports = handler;
module.exports.handler = handler;
