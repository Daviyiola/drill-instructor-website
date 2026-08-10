"use strict";

const {getDatabase} = require("firebase-admin/database");
const {requireBearerToken, allowCors} = require("./_auth");

/**
 * Send a standardized error response.
 * @param {Object} res Express response object
 * @param {number} code HTTP status code
 * @param {string} msg Error message identifier
 * @param {*} [details] Optional error details
 * @return {Object}
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details});
}

/**
 * Clean and truncate a string input.
 * @param {*} v Input value
 * @param {number} maxLen Maximum length
 * @return {string}
 */
function cleanStr(v, maxLen) {
  const s = (v || "").toString().trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Clamp an integer within bounds with fallback.
 * @param {*} v Input value
 * @param {number} lo Minimum
 * @param {number} hi Maximum
 * @param {number} fallback Fallback value
 * @return {number}
 */
function clampInt(v, lo, hi, fallback) {
  let n = Number(v);
  if (!Number.isFinite(n)) n = fallback;
  n = Math.floor(n);
  if (n < lo) n = lo;
  if (n > hi) n = hi;
  return n;
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") return bad(res, 405, "Method not allowed");

    const caller = await requireBearerToken(req);
    const callerFbUid = caller.uid;
    const body = req.body || {};

    const firstName = cleanStr(body.firstName, 40);
    const lastName = cleanStr(body.lastName, 40);
    const email = cleanStr(caller.email, 120).toLowerCase();
    // const avatarNumber = clampInt(body.avatarNumber ??
    // body.avaterNumber, 1, 12, 1);

    const avaterNumber = clampInt(body.avaterNumber, 1, 14, 1);

    const restoreWanted = !!body.restoreWanted;

    if (!firstName || !lastName || !email) {
      return bad(res, 400, "INVALID_ARGUMENT", [
    !firstName ? "firstName" : null,
    !lastName ? "lastName" : null,
    !email ? "email" : null,
      ].filter(Boolean));
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return bad(res, 400, "INVALID_EMAIL");
    }

    // Preserve the established RTDB key format but derive it from the
    // verified Auth identity, never from a caller-supplied custom id.
    const customUserId = "user_" + email.replace(/[^a-z0-9]/g, "_");
    if (!/^user_[a-z0-9_]{5,95}$/.test(customUserId)) {
      return bad(res, 400, "INVALID_CUSTOM_USER_ID");
    }

    const db = getDatabase();

    // 1) Reserve or verify ownership of customUserId
    const userRef = db.ref(`users/${customUserId}`);

    const txResult = await userRef.transaction((cur) => {
      if (!cur) {
        // create skeleton with uid ownership
        return {
          uid: callerFbUid,
          firstName,
          lastName,
          email,
          avaterNumber,
          totalPoints: 0,
          platoonName: "",
          battalionName: "",
          corpsName: "Earth",
          profilePermissions: false,
          platoonPermissions: false,
          parentPermissions: false,
          currentRank: "RECRUIT",
          createdAt: new Date().toISOString(),
        };
      }

      // If exists, only allow if already owned by this uid
      if (cur.uid && cur.uid !== callerFbUid) return; // abort transaction
      // If owned, you may update names avatar email safely
      cur.firstName = firstName || cur.firstName || "";
      cur.lastName = lastName || cur.lastName || "";
      cur.email = email || cur.email || "";
      cur.avaterNumber = avaterNumber || cur.avaterNumber || 1;
      cur.updatedAt = new Date().toISOString();
      cur.uid = callerFbUid;
      return cur;
    });

    if (!txResult.committed) {
      return bad(res, 409, "CUSTOM_ID_TAKEN", [customUserId]);
    }

    // 2) Set role server side
    const updates = {};
    updates[`roles/${customUserId}`] = "student";
    updates[`uidToCustom/${callerFbUid}/student`] = customUserId;

    await db.ref().update(updates);

    // 3) Optional restore lookup (example stub)
    let restore = null;
    if (restoreWanted) {
      // Example: backups/<customUserId>/latest
      const bSnap = await db
          .ref(`backups/${customUserId}/latest`)
          .once("value");
      restore = bSnap.val() || null;
    }

    // 4) Return profile + restore payload
    const profSnap = await db.ref(`users/${customUserId}`).once("value");
    const profile = profSnap.val() || {};

    return res.status(200).json({
      customUserId,
      profile,
      role: "student",
      restore,
    });
  } catch (e) {
    const code = Number.isInteger(e.code) ? e.code : 500;
    return res.status(code).json({error: e.message || "Internal error"});
  }
};
