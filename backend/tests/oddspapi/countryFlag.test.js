import test from "node:test";
import assert from "node:assert/strict";
import {
  flagCodeForCategory,
  flagUrlForCategory,
} from "../../services/providers/oddspapi/countryFlag.js";

test("england maps to the England flag, not GB", () => {
  assert.equal(flagCodeForCategory("england"), "gb-eng");
  assert.equal(
    flagUrlForCategory("England"),
    "https://flagcdn.com/w40/gb-eng.png",
  );
});

test("home nations and Europe use special codes", () => {
  assert.equal(flagCodeForCategory("scotland"), "gb-sct");
  assert.equal(flagCodeForCategory("wales"), "gb-wls");
  assert.equal(flagCodeForCategory("northern-ireland"), "gb-nir");
  assert.equal(flagCodeForCategory("europe"), "eu");
  assert.equal(flagCodeForCategory("international"), "eu");
  assert.equal(flagCodeForCategory("world"), "eu");
});

test("regular country slugs map to ISO codes", () => {
  assert.equal(flagCodeForCategory("denmark"), "dk");
  assert.equal(flagCodeForCategory("south-korea"), "kr");
  assert.equal(flagCodeForCategory("usa"), "us");
  assert.equal(flagUrlForCategory("denmark"), "https://flagcdn.com/w40/dk.png");
});

test("unknown slugs return null", () => {
  assert.equal(flagCodeForCategory("not-a-country"), null);
  assert.equal(flagUrlForCategory(""), null);
  assert.equal(flagUrlForCategory(null), null);
});
