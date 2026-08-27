"use strict";
/* eslint-disable require-jsdoc, max-len */

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

function appleProduct(productId) {
  return APPLE_PRODUCTS[String(productId || "")] || null;
}

function googleProduct(productId, basePlanId) {
  const product = GOOGLE_PRODUCTS[String(productId || "")];
  if (!product) return null;
  const planType = product.basePlans[String(basePlanId || "")];
  return planType ? {bootcamp: product.bootcamp, planType} : null;
}

module.exports = {
  APPLE_PRODUCTS,
  GOOGLE_PRODUCTS,
  appleProduct,
  googleProduct,
};
