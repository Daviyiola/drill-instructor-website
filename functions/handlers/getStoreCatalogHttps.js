"use strict";
/* eslint-disable require-jsdoc */

const {allowCors} = require("./_auth");
const {APPLE_PRODUCTS, GOOGLE_PRODUCTS} = require("./_storeCatalog");

async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({error: "Method not allowed"});
  }
  return res.status(200).json({
    ok: true,
    apple: Object.entries(APPLE_PRODUCTS).map(([productId, row]) => ({
      productId, ...row,
    })),
    google: Object.entries(GOOGLE_PRODUCTS).map(([productId, row]) => ({
      productId,
      bootcamp: row.bootcamp,
      basePlans: Object.keys(row.basePlans),
    })),
    pricesAreStoreProvided: true,
  });
}

module.exports = {handler};
