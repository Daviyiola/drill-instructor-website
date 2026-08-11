// @ts-check
"use strict";

const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const crypto = require("crypto");
const {requireBearerUid, allowCors} = require("./_auth");
const {assertLicenseActive} = require("./_license");
const {canSendChallenge} = require("./_socialPolicy");

const CHALLENGE_SIGNING_SECRET = defineSecret("CHALLENGE_SIGNING_SECRET");
const MAX_OPEN_OUTGOING = 20;
const MAX_RECIPIENTS_PER_SEND = 500; // lower if you want to be extra safe

/** @typedef {import("firebase-admin").database.Database} Database */
/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */

/**
 * Snapshot summary numbers persisted by the client.
 * @typedef {Object} SnapshotSummary
 * @property {number} totalQ
 * @property {number} attempted
 * @property {number} correct
 * @property {number} [points]
 * @property {number} [usedSec]
 */

/**
 * Minimal user profile fields used by this handler.
 * @typedef {Object} UserProfile
 * @property {string} [firstName]
 * @property {string} [lastName]
 * @property {string} [battalionName]
 * @property {string} [platoonName]
 * @property {string} [email]
 * @property {number} [avaterNumber]   // legacy typo
 * @property {number} [avatarNumber]   // correct
 * @property {string} [currentRank]
 */

/**
 * Minimal snapshot shape used here.
 * @typedef {Object} SessionSnapshot
 * @property {string} [bootcamp]
 * @property {string} [takenAt]
 * @property {string} [createdAt]
 * @property {SnapshotSummary} summary
 */

/**
 * Blueprint describing the quiz content (order is meaningful).
 * @typedef {Object} Blueprint
 * @property {string} bootcamp
 * @property {string} datasetVersion
 * @property {Array<{subject:string, questionIds:number[]}>} subjects
 */

/**
 * Compact, normalized result used for storage and compatibility.
 * @typedef {Object} CreatorMiniResult
 * @property {number} totalQ
 * @property {number} attempted
 * @property {number} correct
 * @property {number} wrong
 * @property {number} unanswered
 * @property {number} usedSec
 * @property {number} points
 * @property {number} timeMs
 */

/**
 * Standard JSON error helper.
 * @param {Response} res
 * @param {number} code
 * @param {string} msg
 * @param {unknown} [details]
 * @return {Response}
 */
function bad(res, code, msg, details) {
  return res.status(code).json({error: msg, details});
}

/**
 * Look up a user's custom id (the key under /users) by Firebase UID.
 * @param {Database} db
 * @param {string} firebaseUid
 * @return {Promise<string|null>}
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
 * Build a stable fingerprint from blueprint content (order preserving).
 * @param {Blueprint} blueprint
 * @return {string}
 */
function buildFingerprint(blueprint) {
  const canon = {
    bootcamp: blueprint.bootcamp,
    datasetVersion: blueprint.datasetVersion,
    correctionRevision: Number(blueprint.correctionRevision || 0),
    subjects: (blueprint.subjects || []).map((s) => ({
      subject: s.subject,
      questionIds: s.questionIds || [],
    })),
  };

  return crypto.createHash(
      "sha256").update(JSON.stringify(canon)).digest("hex");
}

/**
 * @param {UserProfile} p
 * @return {string}
 */
function computeDisplayName(p) {
  const first = (p.firstName || "").trim();
  const last = (p.lastName || "").trim();
  if (first || last) return (first + " " + last).trim();
  return (p.battalionName || p.platoonName || p.email || "").toString();
}

/**
 * Clamp avatar to 1..14. Accept both avaterNumber (
 * legacy typo) and avatarNumber.
 * @param {UserProfile} p
 * @return {number}
 */
function computeAvatarNumber(p) {
  let raw = 1;

  if (p && p.avaterNumber !== undefined && p.avaterNumber !== null) {
    raw = Number(p.avaterNumber);
  } else if (p && p.avatarNumber !== undefined && p.avatarNumber !== null) {
    raw = Number(p.avatarNumber);
  }

  if (!Number.isFinite(raw)) raw = 1;
  if (raw < 1) raw = 1;
  if (raw > 14) raw = 14;
  return raw;
}

/**
 * @param {UserProfile} p
 * @return {string}
 */
function computeCurrentRank(p) {
  if (p && typeof p.currentRank === "string" && p.currentRank.trim()) {
    return p.currentRank.trim();
  }
  return "Unknown Player";
}

/**
 * Normalize creator result from snapshot (preferred) or legacy shape.
 * @param {SessionSnapshot|undefined} creatorSnapshot
 * @param {unknown} legacyResult
 * @return {CreatorMiniResult}
 */
function summarizeCreatorResult(creatorSnapshot, legacyResult) {
  if (
    creatorSnapshot &&
    creatorSnapshot.summary &&
    typeof creatorSnapshot.summary === "object"
  ) {
    const sum = creatorSnapshot.summary;
    const totalQ = Math.max(0, Number(sum.totalQ || 0));
    const attempted = Math.max(0, Number(sum.attempted || 0));
    const correct = Math.max(0, Number(sum.correct || 0));
    const usedSec = Math.max(0, Number(sum.usedSec || 0));
    const points = Math.max(0, Number(sum.points || 0));

    const wrong = Math.max(0, attempted - correct);
    const unanswered = Math.max(0, totalQ - attempted);
    const timeMs = usedSec > 0 ? Math.floor(usedSec * 1000) : 0;

    return {
      totalQ,
      attempted,
      correct,
      wrong,
      unanswered,
      usedSec,
      points,
      timeMs,
    };
  }

  /** @type {{correct?: unknown, wrong?:
   * unknown, unanswered?: unknown, timeMs?: unknown}} */
  const r =
    legacyResult && typeof legacyResult === "object" ? legacyResult : {};

  const correct = Math.max(0, Number(r.correct || 0));
  const wrong = Math.max(0, Number(r.wrong || 0));
  const unanswered = Math.max(0, Number(r.unanswered || 0));
  const timeMs = Math.max(0, Number(r.timeMs || 0));

  const attempted = correct + wrong;
  const totalQ = attempted + unanswered;
  const usedSec = Math.max(0, Math.floor(timeMs / 1000));
  const points = correct; // conservative legacy default

  return {
    totalQ,
    attempted,
    correct,
    wrong,
    unanswered,
    usedSec,
    points,
    timeMs,
  };
}

/**
 * @param {Request} req
 * @param {Response} res
 * @return {Promise<Response|void>}
 */
exports.handler = async (req, res) => {
  if (allowCors(req, res)) return;

  try {
    if (req.method !== "POST") return bad(res, 405, "Method not allowed");

    const callerFbUid = await requireBearerUid(req);

    /** @type {{
     *   recipients?: unknown,
     *   blueprint?: unknown,
     *   ttlMinutes?: unknown,
     *   creatorHasPlayed?: unknown,
     *   creatorResult?: unknown,
     *   creatorSnapshot?: unknown,
     *   sourceSessionId?: unknown
     * }} */
    const body = req.body || {};

    /** @type {string[]} */
    const errs = [];

    const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (!Array.isArray(rawRecipients) || rawRecipients.length === 0) {
      errs.push("recipients");
    }

    if (Array.isArray(
        rawRecipients) && rawRecipients.length > MAX_RECIPIENTS_PER_SEND * 2) {
      return bad(res, 429, "TOO_MANY_RECIPIENTS_RAW", [
        `softMax=${MAX_RECIPIENTS_PER_SEND}`,
        `got=${rawRecipients.length}`,
      ]);
    }

    const blueprint = /** @type {Blueprint} */ (body.blueprint);
    if (!blueprint || typeof blueprint !== "object") {
      errs.push("blueprint");
    } else {
      if (!blueprint.bootcamp) errs.push("blueprint.bootcamp");
      if (!blueprint.datasetVersion) errs.push("blueprint.datasetVersion");
      if (!Array.isArray(
          blueprint.subjects) || blueprint.subjects.length === 0) {
        errs.push("blueprint.subjects");
      }
    }

    const ttlRaw = typeof body.ttlMinutes === "number" ? body.ttlMinutes : 120;
    const ttl = Math.min(Math.max(ttlRaw, 5), 7 * 24 * 60);

    const creatorHasPlayed = !!body.creatorHasPlayed;
    const creatorSnapshot = /** @type {
      SessionSnapshot|undefined} */ (body.creatorSnapshot);
    const creatorResult = body.creatorResult;

    if (creatorHasPlayed) {
      if (creatorSnapshot &&
        typeof creatorSnapshot === "object" && creatorSnapshot.summary) {
        const s = creatorSnapshot.summary;

        if (!Number.isFinite(Number(s.totalQ)) || Number(s.totalQ) < 0) {
          errs.push("creatorSnapshot.summary.totalQ>=0");
        }
        if (!Number.isFinite(Number(s.attempted)) || Number(s.attempted) < 0) {
          errs.push("creatorSnapshot.summary.attempted>=0");
        }
        if (!Number.isFinite(Number(s.correct)) || Number(s.correct) < 0) {
          errs.push("creatorSnapshot.summary.correct>=0");
        }
      } else if (creatorResult && typeof creatorResult === "object") {
        /** @type {{correct?: unknown, wrong?:
         * unknown, unanswered?: unknown, timeMs?: unknown}} */
        const cr = creatorResult;

        if (!(Number.isFinite(Number(cr.correct)) &&
        Number(cr.correct) >= 0)) errs.push("creatorResult.correct>=0");
        if (!(Number.isFinite(Number(cr.wrong)) &&
        Number(cr.wrong) >= 0)) errs.push("creatorResult.wrong>=0");
        if (!(Number.isFinite(Number(cr.unanswered)) &&
        Number(cr.unanswered) >= 0)) errs.push("creatorResult.unanswered>=0");
        if (!(Number.isFinite(Number(cr.timeMs)) &&
        Number(cr.timeMs) >= 0)) errs.push("creatorResult.timeMs>=0");
      } else {
        errs.push(
            "creatorSnapshot|creatorResult required when creatorHasPlayed=true",
        );
      }
    }

    if (errs.length) return bad(res, 400, "INVALID_ARGUMENT", errs);

    const db = getDatabase();

    const callerCustomId = await getCustomIdByFirebaseUid(db, callerFbUid);
    if (!callerCustomId) {
      return bad(res, 403, "PERMISSION_DENIED", ["caller not found"]);
    }

    const sourceSessionId = typeof body.sourceSessionId === "string" ?
      body.sourceSessionId.trim().slice(0, 80) : "";
    if (sourceSessionId) {
      const sourceSession = (await db.ref(
          `studentDrills/${callerCustomId}/${sourceSessionId}`,
      ).once("value")).val();
      if (!sourceSession || sourceSession.status !== "submitted") {
        return bad(res, 403, "SOURCE_RESULT_NOT_FOUND");
      }
      if (sourceSession.mode === "assignment") {
        return bad(res, 403, "ASSIGNMENT_RESULTS_ARE_NOT_SHAREABLE");
      }
    }

    await assertLicenseActive(db, callerCustomId, blueprint.bootcamp);

    const senderRowsSnap = await db.ref(
        `users/${callerCustomId}/userChallenges`).once("value");
    const rows = senderRowsSnap.val() || {};
    let openCount = 0;

    Object.keys(rows).forEach((k) => {
      const r = rows[k];
      if (!r || typeof r !== "object") return;
      if (r.status === "sent" || r.status === "pending" ||
        r.status === "accepted") openCount += 1;
    });

    if (openCount >= MAX_OPEN_OUTGOING) {
      return bad(res, 429, "RATE_LIMIT", ["Too many pending challenges"]);
    }

    const profSnap = await db.ref("users/" + callerCustomId).once("value");
    /** @type {UserProfile} */
    const creatorProfile = profSnap.val() || {};
    const senderDisplay = computeDisplayName(creatorProfile);
    const senderAvatarNumber = computeAvatarNumber(creatorProfile);
    const senderCurrentRank = computeCurrentRank(creatorProfile);

    /** @type {string[]} */
    const normRecipients = Array.from(
        new Set(
            rawRecipients
                .filter((r) => typeof r === "string")
                .map((r) => r.trim())
                .filter(Boolean),
        ),
    ).filter((r) => r !== callerCustomId);

    if (normRecipients.length > MAX_RECIPIENTS_PER_SEND) {
      return bad(res, 429, "TOO_MANY_RECIPIENTS", [
        `max=${MAX_RECIPIENTS_PER_SEND}`,
        `got=${normRecipients.length}`,
      ]);
    }

    if (normRecipients.length === 0) {
      return bad(res, 412, "No valid recipients after filtering self/dupes");
    }

    /** @type {string[]} */
    const filtered = [];
    /** @type {string[]} */
    const skipped = [];

    const policies = await Promise.all(normRecipients.map((cid) =>
      canSendChallenge(db, callerCustomId, cid),
    ));
    normRecipients.forEach((cid, index) => {
      if (policies[index].allowed) filtered.push(cid);
      else skipped.push(cid);
    });

    if (filtered.length === 0) {
      return bad(res, 412, "RECIPIENTS_UNAVAILABLE");
    }

    /** @type {string[]} */
    const participantsCustomIds = [callerCustomId, ...filtered];

    /** @type {Record<string, string>} */
    const participantsUidsByCustomId = {};
    /** @type {string[]} */
    const missing = [];

    await Promise.all(
        participantsCustomIds.map(async (/** @type {string} */ cid) => {
          const s = await db.ref(`users/${cid}/uid`).once("value");
          const fbUid = s.val();
          if (!fbUid) missing.push(cid);
          else participantsUidsByCustomId[cid] = String(fbUid);
        }),
    );

    if (missing.length) return bad(res, 404, "RECIPIENT_NOT_FOUND", missing);

    const secret = CHALLENGE_SIGNING_SECRET.value();
    const fingerprint = buildFingerprint(blueprint);
    const signature = crypto.createHmac(
        "sha256", secret).update(fingerprint).digest("hex");

    const now = Date.now();
    const expiresAtMs = now + ttl * 60 * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString();

    const recipientsSorted = [...filtered].sort();
    const participantsKey = [callerCustomId, ...recipientsSorted].join("|");
    const dedupeMaterial = fingerprint + "|" + participantsKey;
    const dedupeKey = crypto.createHash("sha256").update(
        dedupeMaterial).digest("hex").slice(0, 24);

    const keyRef = db.ref(`challengeKeys/${dedupeKey}`);
    const proposedId = crypto.randomBytes(12).toString("hex");
    let chosenId = proposedId;
    let existed = false;
    const nowMs = Date.now();

    await keyRef.transaction(
        (cur) => {
          const stillOpen =
          cur &&
          cur.challengeId &&
          cur.expiresAt &&
          new Date(cur.expiresAt).getTime() > nowMs;

          if (stillOpen) {
            existed = true;
            chosenId = cur.challengeId;
            return cur;
          }

          return {challengeId: proposedId, expiresAt};
        },
        undefined,
        false,
    );

    if (existed) {
      const existing = (await db.ref(`challenges/${chosenId}`).get()).val();
      if (
        existing &&
        existing.status === "open" &&
        new Date(existing.expiresAt).getTime() > Date.now()
      ) {
        return res.status(200).json({
          challengeId: chosenId,
          expiresAt: existing.expiresAt,
          skipped,
          deduped: true,
        });
      }
    }

    /** @type {Record<string, true>} */
    const participantsUidsMap = {};
    Object.keys(participantsUidsByCustomId).forEach((cid) => {
      const uid = participantsUidsByCustomId[cid];
      if (uid) participantsUidsMap[uid] = true;
    });

    const challengeId = chosenId;

    const challengeDoc = {
      challengeId,
      bootcamp: blueprint.bootcamp,
      datasetVersion: blueprint.datasetVersion,
      correctionRevision: Number(blueprint.correctionRevision || 0),
      subjects: blueprint.subjects,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      createdByCustomId: callerCustomId,
      participantsCustomIds: [callerCustomId, ...filtered],
      participantsUidsMap,
      participantsUidsByCustomId,
      contentFingerprint: fingerprint,
      signature,
      status: "open",
      reveal: false,
    };

    /** @type {Record<string, unknown>} */
    const updates = {};
    updates[`challenges/${challengeId}`] = challengeDoc;

    for (const cid of participantsCustomIds) {
      const isCreator = cid === callerCustomId;
      const base = `users/${cid}/userChallenges/${challengeId}`;

      const row = {
        role: isCreator ? "sender" : "recipient",
        status: isCreator ? (
          creatorHasPlayed ? "completed" : "accepted") : "pending",
        bootcamp: blueprint.bootcamp,
        datasetVersion: blueprint.datasetVersion,
        correctionRevision: Number(blueprint.correctionRevision || 0),
        senderCustomId: callerCustomId,
        senderCurrentRank,
        senderDisplay: senderDisplay || "",
        senderAvatarNumber,
        createdAt: challengeDoc.createdAt,
        expiresAt,
        /** @type {string|null} */
        completedAt: null,
      };

      if (creatorHasPlayed && isCreator) {
        row.completedAt = new Date(now).toISOString();
      }

      updates[base] = row;
    }

    if (creatorHasPlayed) {
      const resPath = `challengeResults/${challengeId}/${callerCustomId}`;
      const mini = summarizeCreatorResult(creatorSnapshot, creatorResult);

      updates[resPath] = {
        correct: mini.correct,
        wrong: mini.wrong,
        unanswered: mini.unanswered,
        timeMs: mini.timeMs,
        points: mini.points,
        attempted: mini.attempted,
        totalQ: mini.totalQ,
        finishedAt: new Date(now).toISOString(),
        snapshot: creatorSnapshot || null,
        participant: {
          displayName: senderDisplay,
          avaterNumber: senderAvatarNumber,
          currentRank: senderCurrentRank,
        },
      };
    }

    await db.ref().update(updates);

    await db.ref(`challengeKeys/${dedupeKey}`).set({
      challengeId,
      expiresAt,
    });

    if (creatorHasPlayed && filtered.length === 0) {
      await db.ref(`challenges/${challengeId}`).update({
        status: "completed",
        reveal: true,
        completedAt: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      challengeId,
      expiresAt,
      skipped,
      deduped: false,
    });
  } catch (e) {
    /** @type {{ code?: unknown, message?: unknown }} */
    const maybe = typeof e === "object" && e !== null ? e : {};

    const code = Number.isInteger(
        maybe.code) ? /** @type {number} */ (maybe.code) : 500;

    const msg =
      typeof maybe.message === "string" ?
        maybe.message :
        e instanceof Error ?
          e.message :
          "Internal error";

    return res.status(code).json({error: msg});
  }
};
