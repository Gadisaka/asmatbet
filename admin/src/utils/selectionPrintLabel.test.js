/**
 * Run: node --test admin/src/utils/selectionPrintLabel.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatSelectionLabelForPrint,
  sortSelectionsByOdds,
} from "../components/ticket/receiptFormat.js";

describe("formatSelectionLabelForPrint", () => {
  it("maps match-winner tokens", () => {
    assert.equal(formatSelectionLabelForPrint("1"), "Home");
    assert.equal(formatSelectionLabelForPrint("2"), "Away");
    assert.equal(formatSelectionLabelForPrint("X"), "Draw");
    assert.equal(formatSelectionLabelForPrint("x"), "Draw");
  });

  it("maps combo segments split by slash", () => {
    assert.equal(formatSelectionLabelForPrint("1/over2.5"), "Home/over2.5");
    assert.equal(formatSelectionLabelForPrint("1/1"), "Home/Home");
    assert.equal(formatSelectionLabelForPrint("2/under1.5"), "Away/under1.5");
  });

  it("maps double-chance tokens", () => {
    assert.equal(formatSelectionLabelForPrint("1X"), "Home or Draw");
    assert.equal(formatSelectionLabelForPrint("1x"), "Home or Draw");
    assert.equal(formatSelectionLabelForPrint("12"), "Home or Away");
    assert.equal(formatSelectionLabelForPrint("X2"), "Draw or Away");
    assert.equal(formatSelectionLabelForPrint("x2"), "Draw or Away");
    assert.equal(
      formatSelectionLabelForPrint("1X/over2.5"),
      "Home or Draw/over2.5",
    );
  });

  it("leaves human labels unchanged", () => {
    assert.equal(formatSelectionLabelForPrint("Home"), "Home");
    assert.equal(formatSelectionLabelForPrint("Away"), "Away");
    assert.equal(formatSelectionLabelForPrint("Over 2.5"), "Over 2.5");
  });

  it("handles empty input", () => {
    assert.equal(formatSelectionLabelForPrint(""), "-");
    assert.equal(formatSelectionLabelForPrint(null), "-");
  });
});

describe("sortSelectionsByOdds", () => {
  it("sorts by odds ascending and keeps equal odds stable", () => {
    const rows = [
      { id: "c", odds: 3.1 },
      { id: "a", odds: 1.4 },
      { id: "b1", odds: 2 },
      { id: "b2", odds: 2 },
    ];
    assert.deepEqual(
      sortSelectionsByOdds(rows).map((row) => row.id),
      ["a", "b1", "b2", "c"],
    );
  });

  it("sorts missing or invalid odds last", () => {
    const rows = [{ id: "missing" }, { id: "ok", odds: 1.8 }, { id: "bad", odds: "n/a" }];
    assert.deepEqual(
      sortSelectionsByOdds(rows).map((row) => row.id),
      ["ok", "missing", "bad"],
    );
  });
});
