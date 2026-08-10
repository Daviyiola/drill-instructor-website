"use strict";

const crypto = require("crypto");
const Stripe = require("stripe");
const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const {sendSubscriptionSuccessEmail} = require("./_email");
const {
  SUPPORTED_BOOTCAMPS,
  cleanSegment,
  licenseFromSubscription,
  planFromSubscription,
  stripeLedgerEvent,
} = require("./_stripeBilling");

const LICENSE_SALT = defineSecret("LICENSE_SALT");
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const WEBHOOK_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Atomically claim an event while allowing stale failed attempts to retry.
 *
 * @param {Object} db Firebase database
 * @param {Object} event Stripe event
 * @param {number=} nowMs Current time
 * @return {Promise<string>} Attempt id, or empty when already claimed
 */
async function claimWebhookEvent(db, event, nowMs = Date.now()) {
  const attemptId = crypto.randomUUID();
  const ref = db.ref(`stripeWebhookEvents/${event.id}`);
  const result = await ref.transaction((current) => {
    if (current && (current.status === "processed" || current.processedAt)) {
      return;
    }
    const claimedAtMs = Date.parse(current && current.claimedAt || "");
    if (current && current.status === "processing" &&
        Number.isFinite(claimedAtMs) &&
        claimedAtMs > nowMs - WEBHOOK_CLAIM_TIMEOUT_MS) {
      return;
    }
    return {
      status: "processing",
      attemptId,
      type: event.type,
      claimedAt: new Date(nowMs).toISOString(),
    };
  });
  const value = result.snapshot && result.snapshot.val();
  return result.committed && value && value.attemptId === attemptId ?
    attemptId : "";
}

/**
 * Release only the caller's failed event claim.
 *
 * @param {Object} db Firebase database
 * @param {string} eventId Stripe event id
 * @param {string} attemptId Claim owner
 * @return {Promise<void>}
 */
async function releaseWebhookClaim(db, eventId, attemptId) {
  await db.ref(`stripeWebhookEvents/${eventId}`).transaction((current) => {
    if (!current || current.attemptId !== attemptId ||
        current.status !== "processing") return;
    return null;
  });
}

/**
 * Return a Stripe object id from either an expanded object or string.
 *
 * @param {*} value Stripe expandable field
 * @return {string} Object id
 */
function objectId(value) {
  return cleanSegment(
      value && typeof value === "object" ? value.id : value,
      180,
  );
}

/**
 * Read a subscription id from invoice shapes across Stripe API versions.
 *
 * @param {Object} invoice Stripe invoice
 * @return {string} Subscription id
 */
function invoiceSubscriptionId(invoice) {
  return objectId(invoice && invoice.subscription) ||
    objectId(
        invoice && invoice.parent &&
        invoice.parent.subscription_details &&
        invoice.parent.subscription_details.subscription,
    );
}

/**
 * Resolve a custom student id from trusted metadata or customer mapping.
 *
 * @param {Object} db Firebase database
 * @param {Object} object Stripe object
 * @return {Promise<string>} Student id
 */
async function resolveUserId(db, object) {
  const metadataId = cleanSegment(
      object && object.metadata && object.metadata.userId,
      160,
  );
  if (metadataId) return metadataId;
  const customerId = objectId(object && object.customer);
  if (!customerId) return "";
  const mapping = (await db.ref(`stripeCustomerIndex/${customerId}`)
      .once("value")).val() || {};
  return cleanSegment(mapping.userId, 160);
}

/**
 * Keep customer and subscription indexes current.
 *
 * @param {Object} db Firebase database
 * @param {string} userId Student id
 * @param {Object} subscription Stripe subscription
 * @param {string} recordedAt ISO timestamp
 * @return {Promise<void>}
 */
async function updateIndexes(db, userId, subscription, recordedAt) {
  const customerId = objectId(subscription.customer);
  const subscriptionId = objectId(subscription.id);
  const updates = {};
  if (customerId) {
    updates[`stripeCustomers/${userId}/customerId`] = customerId;
    updates[`stripeCustomers/${userId}/updatedAt`] = recordedAt;
    updates[`stripeCustomerIndex/${customerId}`] = {
      userId,
      updatedAt: recordedAt,
    };
  }
  if (subscriptionId) {
    updates[`stripeSubscriptions/${subscriptionId}`] = {
      userId,
      customerId,
      bootcamp: String(subscription.metadata &&
        subscription.metadata.bootcamp || ""),
      planType: planFromSubscription(subscription),
      status: String(subscription.status || ""),
      updatedAt: recordedAt,
    };
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
}

/**
 * Synchronize one Stripe subscription into the signed license record.
 *
 * @param {Object} db Firebase database
 * @param {Object} subscription Stripe subscription
 * @param {Object} stripeEvent Stripe event
 * @param {boolean=} recordEvent Whether to add a subscription ledger entry
 * @return {Promise<Object|null>} Sync context
 */
async function syncSubscription(
    db,
    subscription,
    stripeEvent,
    recordEvent = true,
) {
  const userId = await resolveUserId(db, subscription);
  const bootcamp = cleanSegment(
      subscription && subscription.metadata &&
      subscription.metadata.bootcamp,
      20,
  ).toLowerCase();
  if (!userId || !SUPPORTED_BOOTCAMPS.has(bootcamp)) {
    console.warn("STRIPE_SUBSCRIPTION_METADATA_MISSING", {
      stripeEventId: stripeEvent.id,
      subscriptionId: objectId(subscription && subscription.id),
    });
    return null;
  }

  const recordedAt = new Date(
      Number(stripeEvent.created || Math.floor(Date.now() / 1000)) * 1000,
  ).toISOString();
  const licenseRef = db.ref(
      `users/${userId}/testdata/${bootcamp}/license`,
  );
  const previousLicense = (await licenseRef.once("value")).val() || {};
  const license = licenseFromSubscription(
      subscription,
      userId,
      LICENSE_SALT.value(),
      Date.now(),
      previousLicense,
  );
  const updates = {
    [`users/${userId}/testdata/${bootcamp}/license`]: license,
  };
  if (recordEvent) {
    const history = stripeLedgerEvent({
      stripeEventId: stripeEvent.id,
      type: license.status === "canceled" ?
        "subscription_ended" : "subscription_updated",
      status: license.status,
      userId,
      bootcamp,
      planType: license.planType,
      activationDate: license.activationDate,
      expirationDate: license.expirationDate,
      stripeSubscriptionId: license.stripeSubscriptionId,
      cancelAtPeriodEnd: license.cancelAtPeriodEnd,
      recordedAt,
    });
    updates[
        `subscriptionEvents/${userId}/${bootcamp}/${history.eventId}`
    ] = history.event;
  }
  await db.ref().update(updates);
  await updateIndexes(db, userId, subscription, recordedAt);
  return {userId, bootcamp, license, recordedAt};
}

/**
 * Record an invoice payment or failure and refresh its subscription state.
 *
 * @param {Object} stripe Stripe client
 * @param {Object} db Firebase database
 * @param {Object} invoice Stripe invoice
 * @param {Object} event Stripe event
 * @return {Promise<void>}
 */
async function handleInvoice(stripe, db, invoice, event) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const context = await syncSubscription(db, subscription, event, false);
  if (!context) return;
  const eventTypes = {
    "invoice.paid": ["invoice_paid", "paid"],
    "invoice.payment_failed": ["invoice_payment_failed", "failed"],
    "invoice.payment_action_required": [
      "payment_action_required",
      "action_required",
    ],
    "invoice.finalization_failed": [
      "invoice_finalization_failed",
      "finalization_failed",
    ],
  };
  const [historyType, historyStatus] = eventTypes[event.type] || [
    "invoice_updated",
    "updated",
  ];
  const paid = event.type === "invoice.paid";
  const history = stripeLedgerEvent({
    stripeEventId: event.id,
    type: historyType,
    status: historyStatus,
    userId: context.userId,
    bootcamp: context.bootcamp,
    planType: context.license.planType,
    activationDate: context.license.activationDate,
    expirationDate: context.license.expirationDate,
    amount: paid ? invoice.amount_paid : invoice.amount_due,
    currency: invoice.currency,
    invoiceId: invoice.id,
    receiptUrl: invoice.hosted_invoice_url,
    invoicePdf: invoice.invoice_pdf,
    stripeSubscriptionId: subscriptionId,
    cancelAtPeriodEnd: context.license.cancelAtPeriodEnd,
    recordedAt: context.recordedAt,
  });
  await db.ref(
      `subscriptionEvents/${context.userId}/${context.bootcamp}/` +
      history.eventId,
  ).set(history.event);
  if (paid) {
    try {
      await sendSubscriptionSuccessEmail({
        db,
        apiKey: process.env.RESEND_API_KEY,
        from: process.env.SUPPORT_FROM_EMAIL,
        userId: context.userId,
        bootcamp: context.bootcamp,
        planType: context.license.planType,
        expirationDate: context.license.expirationDate,
        source: "stripe",
        idempotencyKey: `stripe-payment-${event.id}`,
      });
    } catch (emailError) {
      console.error("STRIPE_SUBSCRIPTION_EMAIL_FAILED", {
        stripeEventId: event.id,
        message: emailError && emailError.message,
      });
    }
  }
}

/**
 * Resolve the invoice associated with a refund or legacy charge event.
 *
 * @param {Object} stripe Stripe client
 * @param {Object} object Stripe refund or charge
 * @return {Promise<string>} Invoice id
 */
async function refundInvoiceId(stripe, object) {
  const legacyInvoiceId = objectId(object && object.invoice);
  if (legacyInvoiceId) return legacyInvoiceId;
  const paymentIntentId = objectId(object && object.payment_intent);
  if (!paymentIntentId) return "";
  const payments = await stripe.invoicePayments.list({
    payment: {
      type: "payment_intent",
      payment_intent: paymentIntentId,
    },
    limit: 1,
  });
  return objectId(
      payments && payments.data && payments.data[0] &&
      payments.data[0].invoice,
  );
}

/**
 * Record a refund while leaving access to subscription-state webhooks.
 *
 * @param {Object} stripe Stripe client
 * @param {Object} db Firebase database
 * @param {Object} object Stripe refund or legacy charge
 * @param {Object} event Stripe event
 * @return {Promise<void>}
 */
async function handleRefund(stripe, db, object, event) {
  const invoiceId = await refundInvoiceId(stripe, object);
  if (!invoiceId) return;
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = await resolveUserId(db, subscription);
  const bootcamp = cleanSegment(
      subscription.metadata && subscription.metadata.bootcamp,
      20,
  ).toLowerCase();
  if (!userId || !SUPPORTED_BOOTCAMPS.has(bootcamp)) return;
  const recordedAt = new Date(event.created * 1000).toISOString();
  const history = stripeLedgerEvent({
    stripeEventId: event.id,
    type: "payment_refunded",
    status: event.type === "refund.created" ?
      String(object.status || "created") :
      (object.refunded === true ? "refunded" : "partially_refunded"),
    userId,
    bootcamp,
    planType: planFromSubscription(subscription),
    amount: event.type === "refund.created" ?
      object.amount : object.amount_refunded,
    currency: object.currency,
    invoiceId,
    receiptUrl: invoice.hosted_invoice_url,
    invoicePdf: invoice.invoice_pdf,
    stripeSubscriptionId: subscriptionId,
    recordedAt,
  });
  await db.ref(
      `subscriptionEvents/${userId}/${bootcamp}/${history.eventId}`,
  ).set(history.event);
}

/**
 * Stripe webhook. Signature validation must use the untouched raw body.
 *
 * @param {Object} req Express request
 * @param {Object} res Express response
 * @return {Promise<Object|void>} Response
 */
async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }
  const stripeSecret = STRIPE_SECRET_KEY.value();
  const webhookSecret = STRIPE_WEBHOOK_SECRET.value();
  if (!stripeSecret || !webhookSecret) {
    console.error("STRIPE_WEBHOOK_CONFIGURATION_MISSING");
    return res.status(503).send("Webhook is not configured");
  }

  const stripe = new Stripe(stripeSecret);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers["stripe-signature"],
        webhookSecret,
    );
  } catch (error) {
    console.warn("STRIPE_WEBHOOK_SIGNATURE_REJECTED", {
      message: error && error.message || "Invalid signature",
    });
    return res.status(400).send("Invalid webhook signature");
  }

  try {
    const db = getDatabase();
    const attemptId = await claimWebhookEvent(db, event);
    if (!attemptId) {
      return res.status(200).json({received: true, duplicate: true});
    }
    const object = event.data.object;
    try {
      if (event.type === "checkout.session.completed") {
        const subscriptionId = objectId(object.subscription);
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(
              subscriptionId,
          );
          await syncSubscription(db, subscription, event);
        }
      } else if ([
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type)) {
        const subscription = await stripe.subscriptions.retrieve(
            objectId(object.id),
        );
        await syncSubscription(db, subscription, event);
      } else if ([
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.payment_action_required",
        "invoice.finalization_failed",
      ].includes(event.type)) {
        await handleInvoice(stripe, db, object, event);
      } else if (["refund.created", "charge.refunded"].includes(event.type)) {
        await handleRefund(stripe, db, object, event);
      }
      await db.ref(`stripeWebhookEvents/${event.id}`).set({
        status: "processed",
        type: event.type,
        processedAt: new Date().toISOString(),
      });
      return res.status(200).json({received: true});
    } catch (error) {
      await releaseWebhookClaim(db, event.id, attemptId);
      throw error;
    }
  } catch (error) {
    console.error("STRIPE_WEBHOOK_PROCESSING_FAILED", {
      stripeEventId: event.id,
      type: event.type,
      message: error && error.message || "Unknown error",
    });
    return res.status(500).send("Webhook processing failed");
  }
}

module.exports = {
  claimWebhookEvent,
  handleInvoice,
  handleRefund,
  handler,
  invoiceSubscriptionId,
  objectId,
  refundInvoiceId,
  releaseWebhookClaim,
  resolveUserId,
  syncSubscription,
};
