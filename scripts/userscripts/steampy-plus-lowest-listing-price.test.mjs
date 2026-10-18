import assert from "node:assert/strict";
import test from "node:test";

import {
  isPriceInRange,
  normalizeSteamPyRegion,
  parseInRangeListing,
  parseLowestInStockListing,
  parseThreshold,
} from "../../src/lib/steampy/steampy-plus-lowest-listing-price.js";

test("normalizeSteamPyRegion accepts supported regions and falls back to cn", () => {
  assert.equal(normalizeSteamPyRegion("cn"), "cn");
  assert.equal(normalizeSteamPyRegion("CN"), "cn");
  assert.equal(normalizeSteamPyRegion("us"), "us");
  assert.equal(normalizeSteamPyRegion("RU"), "ru");
  assert.equal(normalizeSteamPyRegion("tl"), "tl");
  assert.equal(normalizeSteamPyRegion(""), "cn");
  assert.equal(normalizeSteamPyRegion(null), "cn");
  assert.equal(normalizeSteamPyRegion("xx"), "cn");
  assert.equal(normalizeSteamPyRegion(undefined), "cn");
});

test("parseLowestInStockListing returns the cheapest in-stock listing", () => {
  const result = parseLowestInStockListing([
    { keyPrice: "63.95", stock: 2, sold: 5 },
    { keyPrice: "64.00", stock: 1, sold: 0 },
  ]);
  assert.deepEqual(result, { lowestPrice: 63.95, stock: 2, sold: 5 });
});

test("parseLowestInStockListing skips out-of-stock listings before choosing the lowest price", () => {
  const result = parseLowestInStockListing([
    { keyPrice: "10.00", stock: 0, sold: 100 },
    { keyPrice: "12.50", stock: 3, sold: 1 },
    { keyPrice: "11.00", stock: 1, sold: 0 },
  ]);
  assert.deepEqual(result, { lowestPrice: 11, stock: 1, sold: 0 });
});

test("parseLowestInStockListing returns null when every listing is out of stock", () => {
  const result = parseLowestInStockListing([
    { keyPrice: "10.00", stock: 0 },
    { keyPrice: "12.50", stock: 0 },
  ]);
  assert.equal(result, null);
});

test("parseLowestInStockListing treats a missing stock field as in stock", () => {
  const result = parseLowestInStockListing([
    { keyPrice: "8.80" },
    { keyPrice: "9.90", stock: 0 },
  ]);
  assert.deepEqual(result, { lowestPrice: 8.8, stock: 1, sold: 0 });
});

test("parseLowestInStockListing ignores invalid prices", () => {
  const result = parseLowestInStockListing([
    { keyPrice: "0", stock: 1 },
    { keyPrice: "-1", stock: 1 },
    { keyPrice: "not-a-price", stock: 1 },
    { keyPrice: "7.70", stock: 2 },
  ]);
  assert.deepEqual(result, { lowestPrice: 7.7, stock: 2, sold: 0 });
});

test("parseLowestInStockListing handles empty and invalid inputs", () => {
  assert.equal(parseLowestInStockListing([]), null);
  assert.equal(parseLowestInStockListing(null), null);
  assert.equal(parseLowestInStockListing(undefined), null);
  assert.equal(parseLowestInStockListing({}), null);
});

test("parseThreshold accepts non-negative numbers and rejects invalid input", () => {
  assert.equal(parseThreshold("0.32"), 0.32);
  assert.equal(parseThreshold("0"), 0);
  assert.equal(parseThreshold(1.5), 1.5);
  assert.equal(parseThreshold(""), null);
  assert.equal(parseThreshold(null), null);
  assert.equal(parseThreshold(undefined), null);
  assert.equal(parseThreshold("-1"), null);
  assert.equal(parseThreshold("abc"), null);
});

test("isPriceInRange checks both ends of the coupon range", () => {
  assert.equal(isPriceInRange(0.32, 0.32, 0.62), true);
  assert.equal(isPriceInRange(0.4, 0.32, 0.62), true);
  assert.equal(isPriceInRange(0.62, 0.32, 0.62), true);
  assert.equal(isPriceInRange(0.31, 0.32, 0.62), false);
  assert.equal(isPriceInRange(0.63, 0.32, 0.62), false);
});

test("parseInRangeListing returns the cheapest in-stock listing inside the range", () => {
  const result = parseInRangeListing([
    { keyPrice: "0.10", stock: 9 },
    { keyPrice: "0.40", stock: 2 },
    { keyPrice: "0.50", stock: 1 },
    { keyPrice: "1.00", stock: 5 },
  ], 0.32, 0.62);
  assert.deepEqual(result, { price: 0.4, stock: 2 });
});

test("parseInRangeListing ignores out-of-stock listings inside the range", () => {
  const result = parseInRangeListing([
    { keyPrice: "0.40", stock: 0 },
    { keyPrice: "0.45", stock: 3 },
  ], 0.32, 0.62);
  assert.deepEqual(result, { price: 0.45, stock: 3 });
});

test("parseInRangeListing returns null when no listing falls inside the range", () => {
  const below = parseInRangeListing([
    { keyPrice: "0.10", stock: 9 },
    { keyPrice: "0.20", stock: 1 },
  ], 0.32, 0.62);
  assert.equal(below, null);

  const above = parseInRangeListing([
    { keyPrice: "0.70", stock: 1 },
    { keyPrice: "1.00", stock: 2 },
  ], 0.32, 0.62);
  assert.equal(above, null);
});

test("parseInRangeListing handles empty and invalid inputs", () => {
  assert.equal(parseInRangeListing([], 0.32, 0.62), null);
  assert.equal(parseInRangeListing(null, 0.32, 0.62), null);
  assert.equal(parseInRangeListing({}, 0.32, 0.62), null);
});