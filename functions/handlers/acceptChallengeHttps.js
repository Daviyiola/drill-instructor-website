const {getDatabase} = require("firebase-admin/database");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");
const {blockRelationship} = require("./_socialPolicy");

/**
 * Send a standardized JSON error response.
 *
 * @param {!Object} res Express response object.
 * @param {number} code HTTP status code.
 * @param {string} msg Error message identifier.
 * @param {(Array|Object|string)=} details Optional extra error info.
 * @return {!Object} JSON response with error info.
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details});
}

/**
 * Look up a user's custom ID (the key under /users) using a Firebase UID.
 *
 * @param {!Object} db Realtime Database instance.
 * @param {string} firebaseUid Firebase UID from the verified token.
 * @return {!Promise<?string>} Resolves to the custom user ID or null.
 */
async function getCustomIdByFirebaseUid(db, firebaseUid) {
  const snap = await db
      .ref("users")
      .orderByChild("uid")
      .equalTo(firebaseUid)
      .limitToFirst(1)
      .once("value");
  const val = snap.val() || {};
  const keys = Object.keys(val);
  return keys.length ? keys[0] : null;
}


/**
 * HTTPS handler to accept a challenge.
 *
 * Validates caller, ensures challenge exists and is open, checks license,
 * and marks the caller's row as accepted.
 *
 * @param {!Object} req HTTP request.
 * @param {!Object} res HTTP response.
 * @return {!Promise<void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;
  try {
    if (req.method !== "POST") return bad(res, 405, "Method not allowed");

    const fbUid = await requireBearerUid(req);
    const body = req.body || {};
    const challengeId = body.challengeId;
    if (!challengeId) {
      return bad(res, 400, "INVALID_ARGUMENT", ["challengeId"]);
    }

    const db = getDatabase();
    const customId = await getCustomIdByFirebaseUid(db, fbUid);
    if (!customId) return bad(res, 403, "PERMISSION_DENIED");

    const chSnap = await db.ref(`challenges/${challengeId}`).once("value");
    const ch = chSnap.val();
    if (!ch) return bad(res, 404, "NOT_FOUND");
    if (ch.status !== "open") return bad(res, 412, "FAILED_PRECONDITION");

    const creatorId = String(ch.createdByCustomId || ch.creatorCustomId || "");
    if (creatorId && creatorId !== customId &&
        await blockRelationship(db, customId, creatorId)) {
      return bad(res, 404, "CHALLENGE_UNAVAILABLE");
    }

    const exp = new Date(ch.expiresAt).getTime();
    if (Date.now() > exp) return bad(res, 408, "DEADLINE_EXCEEDED");

    const list = ch.participantsCustomIds;
    if (!Array.isArray(list) || list.indexOf(customId) === -1) {
      return bad(res, 403, "PERMISSION_DENIED", ["Not a participant"]);
    }

    // license: acceptor must be licensed for this bootcamp
    await assertLicenseActive(db, customId, ch.bootcamp);

    await db.ref(`users/${customId}/userChallenges/${challengeId}`).update({
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });

    return res.status(200).json({ok: true});
  } catch (e) {
    const code = Number.isInteger(e.code) ? e.code : 500;
    return res.status(code).json({error: e.message || "Internal error"});
  }
};
