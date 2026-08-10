"use strict";

const {getDatabase} = require("firebase-admin/database");
const {allowCors, requireBearerUid} = require("./_auth");
const {resolveStudent} = require("./_studentDrill");
const {
  SUPPORTED_BOOTCAMPS,
  cleanSegment,
} = require("./_stripeBilling");

/**
 * Return only fields safe for the authenticated student's billing UI.
 *
 * @param {string} id Ledger record id
 * @param {Object} value Stored event
 * @return {Object} Public event
 */
function publicEvent(id, value) {
  const event = value && typeof value === "object" ? value : {};
  const cancelAtPeriodEnd = event.cancelAtPeriodEnd === true;
  const type = String(event.type || "");
  return {
    id,
    type: type === "subscription_updated" && cancelAtPeriodEnd ?
      "cancellation_scheduled" : type,
    source: String(event.source || ""),
    status: String(event.status || ""),
    planType: String(event.planType || ""),
    activationDate: String(event.activationDate || ""),
    expirationDate: String(event.expirationDate || ""),
    amount: Number(event.amount || 0),
    currency: String(event.currency || ""),
    invoiceId: String(event.invoiceId || ""),
    receiptUrl: String(event.receiptUrl || ""),
    invoicePdf: String(event.invoicePdf || ""),
    cancelAtPeriodEnd,
    recordedAt: String(event.recordedAt || ""),
  };
}

/**
 * List the student's immutable subscription-event history for one bootcamp.
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
    const bootcamp = cleanSegment(req.body && req.body.bootcamp, 20)
        .toLowerCase();
    if (!SUPPORTED_BOOTCAMPS.has(bootcamp)) {
      return res.status(400).json({error: "Invalid bootcamp"});
    }
    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const tree = (await db.ref(
        `subscriptionEvents/${studentId}/${bootcamp}`,
    ).once("value")).val() || {};
    const events = Object.entries(tree)
        .map(([id, value]) => publicEvent(id, value))
        .filter((event) => event.type !== "subscription_updated")
        .sort((a, b) => Date.parse(b.recordedAt || 0) -
          Date.parse(a.recordedAt || 0))
        .slice(0, 100);
    return res.status(200).json({ok: true, events});
  } catch (error) {
    const code = Number(error && error.code);
    const authCode = String(error && error.code || "");
    if (code === 401 || authCode.startsWith("auth/")) {
      return res.status(401).json({error: "Authentication failed"});
    }
    console.error("SUBSCRIPTION_HISTORY_FAILED", {
      message: error && error.message || "Unknown error",
    });
    return res.status(500).json({
      error: "Unable to retrieve subscription history",
    });
  }
}

module.exports = {handler, publicEvent};
