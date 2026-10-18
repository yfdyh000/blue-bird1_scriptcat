import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSteamPyRegion,
  parseLowestInStockListing,
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