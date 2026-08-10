"use strict";

const Stripe = require("stripe");
const {getDatabase} = require("firebase-admin/database");
const {defineSecret} = require("firebase-functions/params");
const {allowCors, requireBearerUid} = require("./_auth");
const {resolveStudent} = require("./_studentDrill");
const {
  SUPPORTED_BOOTCAMPS,
  cleanSegment,
  priceIdFor,
  webAppUrl,
} = require("./_stripeBilling");

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");

/**
 * Return an object id whether Stripe supplied an id string or expanded object.
 *
 * @param {*} value Stripe expandable field
 * @return {string} Object id
 */
function stripeObjectId(value) {
  return cleanSegment(
      typeof value === "string" ? value : value && value.id,
      180,
  );
}

/**
 * Validate that a subscription is eligible for an immediate annual upgrade.
 *
 * @param {Object} subscription Stripe subscription
 * @param {Object} expected Expected ownership and price details
 * @return {{itemId:string, customerId:string}}
 */
function validateAnnualUpgrade(subscription, expected) {
  const metadata = subscription && subscription.metadata || {};
  if (cleanSegment(metadata.userId, 160) !== expected.studentId ||
      cleanSegment(metadata.bootcamp, 20).toLowerCase() !==
      expected.bootcamp) {
    throw new Error("UPGRADE_OWNERSHIP_MISMATCH");
  }
  if (!["active", "trialing"].includes(String(subscription.status || ""))) {
    throw new Error("UPGRADE_STATUS_INVALID");
  }
  if (subscription.cancel_at_period_end === true) {
    throw new Error("UPGRADE_CANCELLATION_SCHEDULED");
  }
  const items = subscription && subscription.items &&
    Array.isArray(subscription.items.data) ? subscription.items.data : [];
  if (items.length !== 1) throw new Error("UPGRADE_ITEMS_INVALID");
  const itemId = stripeObjectId(items[0]);
  const currentPriceId = stripeObjectId(items[0] && items[0].price);
  if (!itemId || currentPriceId !== expected.monthlyPriceId) {
    throw new Error("UPGRADE_NOT_MONTHLY");
  }
  const customerId = stripeObjectId(subscription.customer);
  if (!customerId || customerId !== expected.customerId) {
    throw new Error("UPGRADE_CUSTOMER_MISMATCH");
  }
  return {itemId, customerId};
}

/**
 * Build the Portal product allowlist for either shared or separate Products.
 *
 * @param {Object} input Stripe Product and Price ids
 * @return {Array<Object>} Portal product configuration
 */
function annualUpgradeProducts(input) {
  if (input.monthlyProductId === input.annualProductId) {
    return [{
      product: input.monthlyProductId,
      prices: [input.monthlyPriceId, input.annualPriceId],
      adjustable_quantity: {enabled: false},
    }];
  }
  return [
    {
      product: input.monthlyProductId,
      prices: [input.monthlyPriceId],
      adjustable_quantity: {enabled: false},
    },
    {
      product: input.annualProductId,
      prices: [input.annualPriceId],
      adjustable_quantity: {enabled: false},
    },
  ];
}

/**
 * Create or reuse the narrowly scoped Portal configuration for a bootcamp.
 *
 * @param {Object} stripe Stripe client
 * @param {Object} db Firebase database
 * @param {Object} input Configuration inputs
 * @return {Promise<string>} Portal configuration id
 */
async function annualUpgradeConfiguration(stripe, db, input) {
  const fingerprint = [
    input.monthlyProductId,
    input.annualProductId,
    input.monthlyPriceId,
    input.annualPriceId,
  ].join("|");
  const ref = db.ref(`stripePortalConfigurations/${input.bootcamp}`);
  const saved = (await ref.once("value")).val() || {};
  if (saved.fingerprint === fingerprint &&
      cleanSegment(saved.configurationId, 180)) {
    return cleanSegment(saved.configurationId, 180);
  }

  const configuration = await stripe.billingPortal.configurations.create({
    name: `${input.bootcamp.toUpperCase()} subscription management`,
    default_return_url: input.returnUrl,
    metadata: {
      bootcamp: input.bootcamp,
      purpose: "monthly_to_annual_upgrade",
    },
    features: {
      invoice_history: {enabled: true},
      payment_method_update: {enabled: true},
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        proration_behavior: "none",
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        products: annualUpgradeProducts(input),
        proration_behavior: "always_invoice",
        billing_cycle_anchor: "now",
        trial_update_behavior: "end_trial",
      },
    },
  });
  await ref.set({
    configurationId: configuration.id,
    fingerprint,
    updatedAt: new Date().toISOString(),
  });
  return configuration.id;
}

/**
 * Create an authenticated Stripe Billing Portal session.
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
    const action = cleanSegment(req.body && req.body.action, 40) || "manage";
    if (!SUPPORTED_BOOTCAMPS.has(bootcamp)) {
      return res.status(400).json({error: "Invalid bootcamp"});
    }
    if (!["manage", "upgrade_annual"].includes(action)) {
      return res.status(400).json({error: "Invalid billing action"});
    }
    const secret = STRIPE_SECRET_KEY.value();
    const appUrl = webAppUrl();
    if (!secret || !appUrl) {
      return res.status(503).json({
        error: "Online billing is not configured yet",
      });
    }

    const db = getDatabase();
    const {studentId} = await resolveStudent(db, uid);
    const customer = (await db.ref(`stripeCustomers/${studentId}`)
        .once("value")).val() || {};
    const customerId = cleanSegment(customer.customerId, 180);
    if (!customerId) {
      return res.status(404).json({error: "No web billing account was found"});
    }

    const stripe = new Stripe(secret);
    const returnUrl =
      `${appUrl}/app/bootcamps/${bootcamp}/subscription`;
    if (action === "upgrade_annual") {
      const license = (await db.ref(
          `users/${studentId}/testdata/${bootcamp}/license`,
      ).once("value")).val() || {};
      if (license.source !== "stripe" || license.planType !== "monthly" ||
          !cleanSegment(license.stripeSubscriptionId, 180)) {
        return res.status(409).json({
          error: "Only an active monthly web subscription can be upgraded",
        });
      }

      const monthlyPriceId = priceIdFor(bootcamp, "monthly");
      const annualPriceId = priceIdFor(bootcamp, "annual");
      if (!monthlyPriceId || !annualPriceId) {
        return res.status(503).json({
          error: "Annual upgrades are not configured yet",
        });
      }
      const subscription = await stripe.subscriptions.retrieve(
          cleanSegment(license.stripeSubscriptionId, 180),
      );
      let upgrade;
      try {
        upgrade = validateAnnualUpgrade(subscription, {
          studentId,
          bootcamp,
          customerId,
          monthlyPriceId,
        });
      } catch (validationError) {
        console.warn("STRIPE_UPGRADE_REJECTED", {
          reason: validationError.message,
          studentId,
          bootcamp,
        });
        return res.status(409).json({
          error: "This subscription is not eligible for an annual upgrade",
        });
      }

      const [monthlyPrice, annualPrice] = await Promise.all([
        stripe.prices.retrieve(monthlyPriceId),
        stripe.prices.retrieve(annualPriceId),
      ]);
      const monthlyProductId = stripeObjectId(monthlyPrice.product);
      const annualProductId = stripeObjectId(annualPrice.product);
      if (!monthlyProductId || !annualProductId) {
        throw new Error("Configured Stripe products are invalid");
      }
      const configuration = await annualUpgradeConfiguration(stripe, db, {
        bootcamp,
        monthlyProductId,
        annualProductId,
        monthlyPriceId,
        annualPriceId,
        returnUrl,
      });
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        configuration,
        return_url: returnUrl,
        flow_data: {
          type: "subscription_update_confirm",
          subscription_update_confirm: {
            subscription: subscription.id,
            items: [{
              id: upgrade.itemId,
              price: annualPriceId,
              quantity: 1,
            }],
          },
          after_completion: {
            type: "redirect",
            redirect: {
              return_url: `${returnUrl}?upgrade=success`,
            },
          },
        },
      });
      return res.status(200).json({ok: true, url: session.url});
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return res.status(200).json({ok: true, url: session.url});
  } catch (error) {
    const code = Number(error && error.code);
    const authCode = String(error && error.code || "");
    if (code === 401 || authCode.startsWith("auth/")) {
      return res.status(401).json({error: "Authentication failed"});
    }
    console.error("STRIPE_PORTAL_FAILED", {
      message: error && error.message || "Unknown error",
    });
    return res.status(500).json({error: "Unable to open billing management"});
  }
}

module.exports = {
  annualUpgradeConfiguration,
  annualUpgradeProducts,
  handler,
  stripeObjectId,
  validateAnnualUpgrade,
};
