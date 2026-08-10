"use strict";

const Stripe = require("stripe");
const {getAuth} = require("firebase-admin/auth");
const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const {allowCors, requireBearerUid} = require("./_auth");
const {resolveStudent} = require("./_studentDrill");
const {
  SUPPORTED_BOOTCAMPS,
  SUPPORTED_PLANS,
  cleanSegment,
  priceIdFor,
  webAppUrl,
} = require("./_stripeBilling");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

/**
 * Create or recover the Stripe Customer mapped to this student.
 *
 * @param {Object} stripe Stripe client
 * @param {Object} db Firebase database
 * @param {string} uid Firebase UID
 * @param {string} studentId Custom student id
 * @return {Promise<string>} Stripe Customer id
 */
async function ensureCustomer(stripe, db, uid, studentId) {
  const stored = (await db.ref(`stripeCustomers/${studentId}`)
      .once("value")).val() || {};
  const storedId = cleanSegment(stored.customerId, 180);
  if (storedId) {
    try {
      const customer = await stripe.customers.retrieve(storedId);
      if (customer && customer.deleted !== true) return storedId;
    } catch (error) {
      if (!error || error.statusCode !== 404) throw error;
    }
  }

  const [authUser, profile] = await Promise.all([
    getAuth().getUser(uid),
    db.ref(`users/${studentId}`).once("value").then((snap) => snap.val() || {}),
  ]);
  const name = [profile.firstName, profile.lastName]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  const customer = await stripe.customers.create({
    email: authUser.email || undefined,
    name: name || undefined,
    metadata: {userId: studentId},
  });
  const now = new Date().toISOString();
  await db.ref().update({
    [`stripeCustomers/${studentId}`]: {
      customerId: customer.id,
      createdAt: now,
      updatedAt: now,
    },
    [`stripeCustomerIndex/${customer.id}`]: {
      userId: studentId,
      updatedAt: now,
    },
  });
  return customer.id;
}

/**
 * Create a Stripe-hosted recurring Checkout Session.
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
    const planType = cleanSegment(req.body && req.body.planType, 20)
        .toLowerCase();
    if (!SUPPORTED_BOOTCAMPS.has(bootcamp) ||
        !SUPPORTED_PLANS.has(planType)) {
      return res.status(400).json({error: "Invalid bootcamp or plan"});
    }

    const priceId = priceIdFor(bootcamp, planType);
    const appUrl = webAppUrl();
    const secret = STRIPE_SECRET_KEY.value();
    if (!secret || !priceId || !appUrl) {
      console.error("STRIPE_CHECKOUT_CONFIGURATION_MISSING", {
        bootcamp,
        planType,
        hasSecret: Boolean(secret),
        hasPrice: Boolean(priceId),
        hasWebAppUrl: Boolean(appUrl),
      });
      return res.status(503).json({
        error: "Online checkout is not configured yet",
      });
    }

    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const currentLicense = (await db.ref(
        `users/${studentId}/testdata/${bootcamp}/license`,
    ).once("value")).val() || {};
    const currentExpiry = Date.parse(currentLicense.expirationDate || "");
    if (Number.isFinite(currentExpiry) && currentExpiry > Date.now()) {
      return res.status(409).json({
        error: "Active access already exists for this bootcamp",
      });
    }
    const currentStripeStatus = String(currentLicense.status || "");
    const recoverableStripeStatuses = new Set([
      "active",
      "incomplete",
      "past_due",
      "paused",
      "trialing",
      "unpaid",
    ]);
    if (currentLicense.source === "stripe" &&
        cleanSegment(currentLicense.stripeSubscriptionId, 180) &&
        recoverableStripeStatuses.has(currentStripeStatus)) {
      return res.status(409).json({
        error: "Manage the existing subscription before starting another",
      });
    }

    const stripe = new Stripe(secret);
    const customerId = await ensureCustomer(stripe, db, uid, studentId);
    const metadata = {userId: studentId, bootcamp, planType};
    const returnPath = `/app/bootcamps/${bootcamp}/subscription`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      managed_payments: {enabled: false},
      customer: customerId,
      client_reference_id: studentId,
      line_items: [{price: priceId, quantity: 1}],
      metadata,
      subscription_data: {metadata},
      success_url: `${appUrl}${returnPath}?checkout=success` +
        "&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: `${appUrl}${returnPath}?checkout=cancelled`,
      billing_address_collection: "auto",
    });
    return res.status(200).json({ok: true, url: session.url});
  } catch (error) {
    const code = Number(error && error.code);
    const authCode = String(error && error.code || "");
    if (code === 401 || authCode.startsWith("auth/")) {
      return res.status(401).json({error: "Authentication failed"});
    }
    console.error("STRIPE_CHECKOUT_FAILED", {
      message: error && error.message || "Unknown error",
    });
    return res.status(500).json({error: "Unable to start secure checkout"});
  }
}

module.exports = {ensureCustomer, handler};
