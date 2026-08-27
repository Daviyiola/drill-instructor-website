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
const {stripeSubscriptionIdFromEntitlement} =
  require("./_stripeEntitlements");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const RESERVATION_MS = 60 * 60 * 1000;
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

async function findStripeCustomer(stripe, studentId) {
  if (!stripe.customers || typeof stripe.customers.search !== "function") {
    return "";
  }
  const escaped = String(studentId || "").replace(/'/g, "\\'");
  const result = await stripe.customers.search({
    query: `metadata['userId']:'${escaped}'`,
    limit: 10,
  });
  const customer = (result.data || []).find((row) => row.deleted !== true &&
    row.metadata && row.metadata.userId === studentId);
  return cleanSegment(customer && customer.id, 180);
}

async function findOpenCheckoutSession(stripe, customerId, operationId) {
  const result = await stripe.checkout.sessions.list({
    customer: customerId,
    limit: 100,
  });
  return (result.data || []).find((session) =>
    session.status === "open" && session.url && session.metadata &&
    session.metadata.operationId === operationId,
  ) || null;
}

async function claimCustomerReservation(ref, nowMs = Date.now()) {
  const attemptId = crypto.randomUUID();
  const proposedOperationId = crypto.randomUUID();
  let operationId = proposedOperationId;
  const result = await ref.transaction((current) => {
    const claimedAt = Date.parse(current && current.claimedAt || "");
    if (current && current.status === "creating" &&
        Number.isFinite(claimedAt) &&
        claimedAt > nowMs - CREATION_LOCK_MS) return;
    const retryingCreation = current &&
      ["creating", "retryable"].includes(current.status);
    operationId = String(retryingCreation &&
      (current.operationId || current.attemptId) || proposedOperationId);
    return {
      status: "creating",
      attemptId,
      operationId,
      claimedAt: new Date(nowMs).toISOString(),
    };
  });
  const value = result.snapshot && result.snapshot.val() || {};
  return {
    claimed: result.committed === true && value.attemptId === attemptId,
    attemptId,
    operationId: String(value.operationId || operationId),
  };
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
  const claim = await claimCustomerReservation(reservationRef);
  const {attemptId, operationId} = claim;

  if (!claim.claimed) {
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
    const recoveredCustomerId = await findStripeCustomer(stripe, studentId);
    if (recoveredCustomerId) {
      const now = new Date().toISOString();
      await db.ref().update({
        [`stripeCustomers/${studentId}`]: {
          customerId: recoveredCustomerId,
          recoveredAt: now,
          updatedAt: now,
        },
        [`stripeCustomerIndex/${recoveredCustomerId}`]: {
          userId: studentId,
          updatedAt: now,
        },
        [`stripeCustomerReservations/${studentId}`]: {
          status: "ready",
          attemptId,
          operationId,
          customerId: recoveredCustomerId,
          updatedAt: now,
        },
      });
      return recoveredCustomerId;
    }
    const customer = await stripe.customers.create({
      email: authUser.email || undefined,
      name: name || undefined,
      metadata: {userId: studentId},
    }, {idempotencyKey: `customer-${studentId}-${operationId}`});
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
        operationId,
        customerId: customer.id,
        updatedAt: now,
      },
    });
    return customer.id;
  } catch (error) {
    await reservationRef.transaction((current) => {
      if (!current || current.attemptId !== attemptId) return;
      return {...current, status: "retryable",
        failedAt: new Date().toISOString()};
    });
    throw error;
  }
}

async function claimCheckoutReservation(ref, planType, nowMs = Date.now()) {
  const attemptId = crypto.randomUUID();
  const proposedOperationId = crypto.randomUUID();
  let operationId = proposedOperationId;
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
    const operationExpiresAt = Date.parse(current && current.expiresAt || "");
    const operationIsLive = Number.isFinite(operationExpiresAt) &&
      operationExpiresAt > nowMs;
    if (current && current.status === "creating" &&
        Number.isFinite(createdAt) &&
        createdAt > nowMs - CREATION_LOCK_MS) {
      decision = current.planType === planType ? "busy" : "conflict";
      return;
    }
    if (current && ["creating", "retryable"].includes(current.status) &&
        operationIsLive) {
      if (current.planType !== planType) {
        decision = "conflict";
        return;
      }
      decision = "claimed";
      operationId = String(current.operationId || current.attemptId ||
        proposedOperationId);
      return {
        ...current,
        status: "creating",
        attemptId,
        operationId,
        claimedAt: new Date(nowMs).toISOString(),
      };
    }
    decision = "claimed";
    operationId = proposedOperationId;
    return {
      status: "creating",
      planType,
      attemptId,
      operationId,
      createdAt: new Date(nowMs).toISOString(),
      claimedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + RESERVATION_MS).toISOString(),
    };
  });
  const value = (await ref.once("value")).val() || {};
  return {decision, attemptId, operationId, value};
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
    const [licenseSnap, stripeEntitlementSnap] = await Promise.all([
      db.ref(`users/${studentId}/testdata/${bootcamp}/license`)
          .once("value"),
      db.ref(`userEntitlements/${studentId}/${bootcamp}/stripe`)
          .once("value"),
    ]);
    const currentLicense = licenseSnap.val() || {};
    const stripeEntitlement = stripeEntitlementSnap.val() || {};
    const currentExpiry = Date.parse(currentLicense.expirationDate || "");
    if (Number.isFinite(currentExpiry) && currentExpiry > Date.now()) {
      return res.status(409).json({
        error: "Active access already exists for this bootcamp",
      });
    }
    const currentStripeStatus = String(stripeEntitlement.status ||
      (currentLicense.source === "stripe" ? currentLicense.status : ""));
    const currentStripeSubscriptionId = stripeSubscriptionIdFromEntitlement(
        stripeEntitlement,
        currentLicense,
    );
    const recoverableStripeStatuses = new Set([
      "active",
      "incomplete",
      "past_due",
      "paused",
      "trialing",
      "unpaid",
    ]);
    if (currentStripeSubscriptionId &&
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
    const metadata = {
      userId: studentId,
      bootcamp,
      planType,
      operationId: claim.operationId,
    };
    const returnPath = `/app/bootcamps/${bootcamp}/subscription`;
    try {
      const recoveredSession = await findOpenCheckoutSession(
          stripe, customerId, claim.operationId,
      );
      const session = recoveredSession ||
        await stripe.checkout.sessions.create({
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
          expires_at: Math.floor(Date.parse(claim.value.expiresAt) / 1000),
        }, {idempotencyKey: `checkout-${studentId}-${bootcamp}-` +
          claim.operationId});
      const openedAt = new Date().toISOString();
      await reservationRef.set({
        status: "open",
        planType,
        sessionId: session.id,
        checkoutUrl: session.url,
        createdAt: claim.value.createdAt || openedAt,
        expiresAt: session.expires_at ?
          new Date(session.expires_at * 1000).toISOString() :
          claim.value.expiresAt,
        attemptId: claim.attemptId,
        operationId: claim.operationId,
      });
      return res.status(200).json({ok: true, url: session.url});
    } catch (error) {
      await reservationRef.transaction((current) => {
        if (!current || current.attemptId !== claim.attemptId) return;
        return {...current, status: "retryable", checkoutUrl: "",
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
  claimCustomerReservation,
  claimCheckoutReservation,
  ensureCustomer,
  findOpenCheckoutSession,
  findStripeCustomer,
  handler,
  waitForValue,
};
