"use strict";

const FREE_POINTS_CEILING = 2000;
const FREE_CREDITS_ALLOWANCE = 10;

/**
 * Return a safe object.
 *
 * @param {*} value Candidate value
 * @return {Object} Object or empty object
 */
function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ?
    value : {};
}

/**
 * Credit the best score for one session in a transaction on the user record.
 *
 * @param {Object} db RTDB instance
 * @param {string} customId Custom user id
 * @param {string} sessionKey Session ledger key
 * @param {number} points Submitted points
 * @return {Promise<number>} Delta credited
 */
async function creditPaidSession(db, customId, sessionKey, points) {
  const userRef = db.ref(`users/${customId}`);
  const newPoints = Math.max(0, Number(points || 0));
  let delta = 0;

  await userRef.transaction((current) => {
    const user = asObject(current);
    const ledger = asObject(user.pointsBySession);
    const previous = Math.max(0, Number(ledger[sessionKey] || 0));
    delta = Math.max(0, newPoints - previous);
    if (delta <= 0) return current;

    return {
      ...user,
      pointsBySession: {...ledger, [sessionKey]: newPoints},
      totalPoints: Math.max(0, Number(user.totalPoints || 0)) + delta,
    };
  }, undefined, false);

  return delta;
}

/**
 * Promote a mistakenly free-credited session to paid accounting.
 *
 * The user transaction makes the repair idempotent. It awards any points that
 * were previously blocked and refunds a free-practice credit when the session
 * had consumed one.
 *
 * @param {Object} db RTDB instance
 * @param {string} customId Custom user id
 * @param {string} sessionKey Session ledger key
 * @param {number} points Submitted points
 * @return {Promise<Object>} Promotion outcome
 */
async function promoteFreeSessionToPaid(
    db,
    customId,
    sessionKey,
    points,
) {
  const userRef = db.ref(`users/${customId}`);
  const newPoints = Math.max(0, Number(points || 0));
  let outcome = {
    awardedPoints: newPoints,
    deltaApplied: 0,
    freeCreditRefunded: false,
  };

  await userRef.transaction((current) => {
    const user = asObject(current);
    const ledger = asObject(user.pointsBySession);
    const previous = Math.max(0, Number(ledger[sessionKey] || 0));
    const awardedPoints = Math.max(previous, newPoints);
    const deltaApplied = Math.max(0, awardedPoints - previous);
    const usedSessions = asObject(user.freeCreditUsedForSessions);
    const freeCreditRefunded = usedSessions[sessionKey] === true;
    const freeBudget = asObject(user.freeBudget);
    const creditsUsed = Math.max(0, Number(freeBudget.creditsUsed || 0));
    const nextUsedSessions = {...usedSessions};
    delete nextUsedSessions[sessionKey];

    outcome = {
      awardedPoints,
      deltaApplied,
      freeCreditRefunded,
    };

    return {
      ...user,
      pointsBySession: {...ledger, [sessionKey]: awardedPoints},
      totalPoints: Math.max(0, Number(user.totalPoints || 0)) + deltaApplied,
      freeBudget: {
        ...freeBudget,
        creditsUsed: Math.max(
            0,
            creditsUsed - (freeCreditRefunded ? 1 : 0),
        ),
      },
      freeCreditUsedForSessions: nextUsedSessions,
    };
  }, undefined, false);

  return outcome;
}

/**
 * Credit a free session while atomically enforcing its cap and allowance.
 *
 * @param {Object} db RTDB instance
 * @param {string} customId Custom user id
 * @param {string} sessionKey Session ledger key
 * @param {number} points Submitted points
 * @param {number} ceiling Maximum free total points
 * @param {number} allowance Maximum free credited sessions
 * @return {Promise<Object>} Credit outcome
 */
async function creditFreeSession(
    db,
    customId,
    sessionKey,
    points,
    ceiling = FREE_POINTS_CEILING,
    allowance = FREE_CREDITS_ALLOWANCE,
) {
  const userRef = db.ref(`users/${customId}`);
  const newPoints = Math.max(0, Number(points || 0));
  let outcome = {
    delta: 0,
    consumedCredit: false,
    reason: "no_improvement",
  };

  await userRef.transaction((current) => {
    const user = asObject(current);
    const ledger = asObject(user.pointsBySession);
    const previous = Math.max(0, Number(ledger[sessionKey] || 0));
    if (newPoints <= previous) {
      outcome = {delta: 0, consumedCredit: false, reason: "no_improvement"};
      return current;
    }

    const total = Math.max(0, Number(user.totalPoints || 0));
    const remaining = Math.max(0, ceiling - total);
    if (remaining <= 0) {
      outcome = {delta: 0, consumedCredit: false, reason: "cap_reached"};
      return current;
    }

    const usedSessions = asObject(user.freeCreditUsedForSessions);
    const alreadyConsumed = usedSessions[sessionKey] === true;
    const freeBudget = asObject(user.freeBudget);
    const creditsUsed = Math.max(0, Number(freeBudget.creditsUsed || 0));
    if (!alreadyConsumed && creditsUsed >= allowance) {
      outcome = {
        delta: 0,
        consumedCredit: false,
        reason: "free_credits_exhausted",
      };
      return current;
    }

    const delta = Math.min(newPoints - previous, remaining);
    const consumedCredit = !alreadyConsumed;
    outcome = {delta, consumedCredit, reason: "ok"};

    return {
      ...user,
      pointsBySession: {...ledger, [sessionKey]: newPoints},
      totalPoints: total + delta,
      freeBudget: {
        ...freeBudget,
        creditsUsed: creditsUsed + (consumedCredit ? 1 : 0),
      },
      freeCreditUsedForSessions: consumedCredit ? {
        ...usedSessions,
        [sessionKey]: true,
      } : usedSessions,
    };
  }, undefined, false);

  return outcome;
}

module.exports = {
  FREE_CREDITS_ALLOWANCE,
  FREE_POINTS_CEILING,
  creditFreeSession,
  creditPaidSession,
  promoteFreeSessionToPaid,
};
