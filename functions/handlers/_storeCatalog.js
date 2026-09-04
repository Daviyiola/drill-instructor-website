"use strict";
/* eslint-disable require-jsdoc, max-len */

const {APPLE_PRODUCTS, GOOGLE_PRODUCTS} = require("./_billingCatalog");

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
