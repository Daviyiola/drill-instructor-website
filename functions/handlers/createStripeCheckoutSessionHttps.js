"use strict";
/* eslint-disable require-jsdoc */

const crypto = require("crypto");
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
const RESERVATION_MS = 35 * 60 * 1000;
const CREATION_LOCK_MS = 2 * 60 * 1000;

class CheckoutError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function waitForValue(readValue, predicate, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await readValue();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return null;
}

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

  const reservationRef = db.ref(`stripeCustomerReservations/${studentId}`);
  const attemptId = crypto.randomUUID();
  let ownsClaim = false;
  await reservationRef.transaction((current) => {
    const claimedAt = Date.parse(current && current.claimedAt || "");
    if (current && current.status === "creating" &&
        Number.isFinite(claimedAt) &&
        claimedAt > Date.now() - CREATION_LOCK_MS) return;
    ownsClaim = true;
    return {
      status: "creating",
      attemptId,
      claimedAt: new Date().toISOString(),
    };
  });

  if (!ownsClaim) {
    const recovered = await waitForValue(
        async () => (await db.ref(`stripeCustomers/${studentId}`)
            .once("value")).val() || {},
        (value) => Boolean(cleanSegment(value.customerId, 180)),
    );
    const recoveredId = cleanSegment(recovered && recovered.customerId, 180);
    if (recoveredId) return recoveredId;
    throw new CheckoutError(409, "Checkout is already being prepared");
  }

  const [authUser, profile] = await Promise.all([
    getAuth().getUser(uid),
    db.ref(`users/${studentId}`).once("value").then((snap) => snap.val() || {}),
  ]);
  const name = [profile.firstName, profile.lastName]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  try {
    const customer = await stripe.customers.create({
      email: authUser.email || undefined,
      name: name || undefined,
      metadata: {userId: studentId},
    }, {idempotencyKey: `customer-${studentId}-${attemptId}`});
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
      [`stripeCustomerReservations/${studentId}`]: {
        status: "ready",
        attemptId,
        customerId: customer.id,
        updatedAt: now,
      },
    });
    return customer.id;
  } catch (error) {
    await reservationRef.transaction((current) =>
      current && current.attemptId === attemptId ? null : undefined,
    );
    throw error;
  }
}

async function claimCheckoutReservation(ref, planType, nowMs = Date.now()) {
  const attemptId = crypto.randomUUID();
  let decision = "busy";
  await ref.transaction((current) => {
    const expiresAt = Date.parse(current && current.expiresAt || "");
    if (current && current.status === "open" &&
        current.checkoutUrl &&
        Number.isFinite(expiresAt) && expiresAt > nowMs) {
      decision = current.planType === planType ? "existing" : "conflict";
      return current;
    }
    const createdAt = Date.parse(current && current.createdAt || "");
    if (current && current.status === "creating" &&
        Number.isFinite(createdAt) &&
        createdAt > nowMs - CREATION_LOCK_MS) {
      decision = "busy";
      return;
    }
    decision = "claimed";
    return {
      status: "creating",
      planType,
      attemptId,
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + RESERVATION_MS).toISOString(),
    };
  });
  const value = (await ref.once("value")).val() || {};
  return {decision, attemptId, value};
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
    const reservationRef = db.ref(
        `stripeCheckoutReservations/${studentId}/${bootcamp}`,
    );
    const claim = await claimCheckoutReservation(
        reservationRef, planType, Date.now(),
    );
    if (claim.decision === "existing") {
      return res.status(200).json({
        ok: true,
        url: claim.value.checkoutUrl,
        recovered: true,
      });
    }
    if (claim.decision === "conflict") {
      return res.status(409).json({
        error: "Finish or cancel the existing checkout before changing plans.",
      });
    }
    if (claim.decision === "busy") {
      const recovered = await waitForValue(
          async () => (await reservationRef.once("value")).val() || {},
          (value) => value.status === "open" && Boolean(value.checkoutUrl),
      );
      if (recovered && recovered.checkoutUrl) {
        return res.status(200).json({
          ok: true,
          url: recovered.checkoutUrl,
          recovered: true,
        });
      }
      return res.status(409).json({
        error: "Checkout is already being prepared. Please try again.",
      });
    }
    const metadata = {userId: studentId, bootcamp, planType};
    const returnPath = `/app/bootcamps/${bootcamp}/subscription`;
    try {
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
        expires_at: Math.floor((Date.now() + RESERVATION_MS) / 1000),
      }, {idempotencyKey: `checkout-${studentId}-${bootcamp}-` +
        claim.attemptId});
      const openedAt = new Date().toISOString();
      await reservationRef.set({
        status: "open",
        planType,
        sessionId: session.id,
        checkoutUrl: session.url,
        createdAt: claim.value.createdAt || openedAt,
        expiresAt: new Date(Date.now() + RESERVATION_MS).toISOString(),
        attemptId: claim.attemptId,
      });
      return res.status(200).json({ok: true, url: session.url});
    } catch (error) {
      await reservationRef.transaction((current) => {
        if (!current || current.attemptId !== claim.attemptId) return;
        return {...current, status: "expired", checkoutUrl: "",
          failedAt: new Date().toISOString()};
      });
      throw error;
    }
  } catch (error) {
    const code = Number(error && error.code);
    const authCode = String(error && error.code || "");
    if (code === 401 || authCode.startsWith("auth/")) {
      return res.status(401).json({error: "Authentication failed"});
    }
    if (error instanceof CheckoutError) {
      return res.status(error.status).json({error: error.message});
    }
    console.error("STRIPE_CHECKOUT_FAILED", {
      message: error && error.message || "Unknown error",
    });
    return res.status(500).json({error: "Unable to start secure checkout"});
  }
}

module.exports = {
  CheckoutError,
  claimCheckoutReservation,
  ensureCustomer,
  handler,
  waitForValue,
};
