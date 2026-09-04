"use strict";
/* eslint-disable require-jsdoc */

const STRIPE_PRICE_ENV_KEYS = Object.freeze({
  act: Object.freeze({
    monthly: "STRIPE_PRICE_ACT_MONTHLY",
    annual: "STRIPE_PRICE_ACT_ANNUAL",
  }),
  sat: Object.freeze({
    monthly: "STRIPE_PRICE_SAT_MONTHLY",
    annual: "STRIPE_PRICE_SAT_ANNUAL",
  }),
});

const APPLE_PRODUCTS = Object.freeze({
  "com.drillinstructor.app.act.monthly": {bootcamp: "act", planType: "monthly"},
  "com.drillinstructor.app.act.annual": {bootcamp: "act", planType: "annual"},
  "com.drillinstructor.app.sat.monthly": {bootcamp: "sat", planType: "monthly"},
  "com.drillinstructor.app.sat.annual": {bootcamp: "sat", planType: "annual"},
});

const GOOGLE_PRODUCTS = Object.freeze({
  act_premium: {
    bootcamp: "act",
    basePlans: {monthly: "monthly", annual: "annual"},
  },
  sat_premium: {
    bootcamp: "sat",
    basePlans: {monthly: "monthly", annual: "annual"},
  },
});

function stripePriceEnvKey(bootcamp, planType) {
  const bootcampCatalog = STRIPE_PRICE_ENV_KEYS[String(bootcamp || "")];
  return bootcampCatalog && bootcampCatalog[String(planType || "")] || "";
}

module.exports = {
  APPLE_PRODUCTS,
  GOOGLE_PRODUCTS,
  STRIPE_PRICE_ENV_KEYS,
  stripePriceEnvKey,
};
