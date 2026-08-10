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
  return res.status(code).json({error: msg, details: details || null});
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

/**
 * Safe error text for unknown throws.
 * @param {unknown} e Any error
 * @return {string}
 */
function errText(e) {
  if (!e) return "Internal error";
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    /** @type {any} */
    const anyErr = e;
    if (typeof anyErr.message === "string" && anyErr.message) {
      return anyErr.message;
    }
  }
  try {
    return JSON.stringify(e);
  } catch (_) {
    return String(e);
  }
}

exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") {
      return bad(res, 405, "METHOD_NOT_ALLOWED");
    }

    const caller = await requireBearerToken(req);
    const callerFbUid = caller.uid;
    const body = req.body || {};

    const schoolId = cleanStr(body.schoolId || body.schoolID, 60);
    if (!schoolId) {
      return bad(res, 400, "INVALID_ARGUMENT", ["schoolId"]);
    }

    const firstName = cleanStr(body.firstName, 40);
    const lastName = cleanStr(body.lastName, 40);
    const email = cleanStr(caller.email, 120).toLowerCase();

    if (!firstName || !email) {
      return bad(res, 400, "INVALID_ARGUMENT", [
    !firstName ? "firstName" : null,
    !email ? "email" : null,
      ].filter(Boolean));
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return bad(res, 400, "INVALID_EMAIL");
    }

    const customUserId = "user_" + email.replace(/[^a-z0-9]/g, "_");
    if (!/^user_[a-z0-9_]{5,95}$/.test(customUserId)) {
      return bad(res, 400, "INVALID_CUSTOM_USER_ID");
    }

    const avaterNumber = clampInt(
      body.avatarNumber !== undefined && body.avatarNumber !== null ?
        body.avatarNumber :
        body.avaterNumber,
      1,
      14,
      1,
    );

    const db = getDatabase();

    // 0) Validate school designation (server side)
    const desSnap = await db.ref(`designations/${schoolId}`).once("value");
    if (desSnap.val() !== true) {
      return bad(res, 403, "ACCESS_DENIED", [
        "School ID is not authorized for educator registration",
      ]);
    }

    // 1) Read school info (name, country, state)
    const schoolSnap = await db.ref(`schools/${schoolId}`).once("value");
    const school = schoolSnap.val() || {};

    const schoolName = cleanStr(school.name, 80);
    const corpsName = cleanStr(school.country, 80);
    const battalionName = cleanStr(school.state, 80);
    const platoonName = schoolName;

    if (!schoolName || !corpsName || !battalionName) {
      return bad(res, 400, "SCHOOL_RECORD_INCOMPLETE", {
        schoolId: schoolId,
        missing: {
          name: !schoolName,
          country: !corpsName,
          state: !battalionName,
        },
      });
    }

    // 2) Reserve or verify ownership of educator customUserId
    const educatorRef = db.ref(`educators/${customUserId}`);

    const txResult = await educatorRef.transaction((cur) => {
      const nowIso = new Date().toISOString();

      if (!cur) {
        return {
          uid: callerFbUid,
          firstName: firstName,
          lastName: lastName,
          email: email,
          avaterNumber: avaterNumber,
          schoolID: schoolId,
          schoolName: schoolName,
          corpsName: corpsName,
          battalionName: battalionName,
          platoonName: platoonName,
          approvalStatus: "pending",
          createdAt: nowIso,
        };
      }

      // If exists, only allow if already owned by this uid
      if (cur.uid && cur.uid !== callerFbUid) return; // abort

      // Do not allow this signup endpoint to
      // move an existing educator to another school
      if (cur.schoolID && cur.schoolID !== schoolId) return; // abort

      // Safe updates
      cur.uid = callerFbUid;
      cur.firstName = firstName || cur.firstName || "";
      cur.lastName = lastName || cur.lastName || "";
      cur.email = email || cur.email || "";
      cur.avaterNumber = avaterNumber || cur.avaterNumber || 1;

      // Only set school fields if they were not already set
      cur.schoolID = cur.schoolID || schoolId;
      cur.schoolName = cur.schoolName || schoolName;

      cur.corpsName = cur.corpsName || corpsName;
      cur.battalionName = cur.battalionName || battalionName;
      cur.platoonName = cur.platoonName || platoonName;

      cur.approvalStatus = cur.approvalStatus || "pending";
      cur.updatedAt = nowIso;

      return cur;
    });

    if (!txResult.committed) {
      return bad(res, 409, "EDUCATOR_PROFILE_CONFLICT", [customUserId]);
    }

    // 3) Write school educator listing row without overwriting approval status
    const listingRef = db.ref(`schools/${schoolId}/educators/${customUserId}`);

    await listingRef.transaction((cur) => {
      const nowIso = new Date().toISOString();

      if (!cur) {
        return {
          status: "pending", // pending | approved | rejected | revoked
          role: "educator",
          adminAccess: false, // can approve/deny educator requests
          superAdmin: false, // can grant/remove adminAccess
          createdAt: nowIso,
        };
      }

      cur.role = cur.role || "educator";

      // Preserve existing permissions if already set.
      if (cur.adminAccess === undefined) cur.adminAccess = false;
      if (cur.superAdmin === undefined) cur.superAdmin = false;

      cur.updatedAt = nowIso;
      return cur;
    });

    // 4) Role and reverse mapping
    const updates = {};
    updates[`roles/${customUserId}`] = "educator";
    updates[`uidToCustom/${callerFbUid}/educator`] = customUserId;

    await db.ref().update(updates);

    // 5) Return educator profile + unit fields (for offline caching)
    const profSnap = await db.ref(`educators/${customUserId}`).once("value");
    const profile = profSnap.val() || {};

    return res.status(200).json({
      ok: true,
      role: "educator",
      customUserId: customUserId,
      schoolId: schoolId,
      schoolName: schoolName,
      corpsName: corpsName,
      battalionName: battalionName,
      platoonName: platoonName,
      profile: profile,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "INTERNAL",
      details: errText(e),
    });
  }
};
