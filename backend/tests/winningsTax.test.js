import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeWinningsTaxBreakdown,
  estimateWinningsTaxBreakdown,
  formatWinningsTaxHelperText,
  ticketWinningsTaxApiFields,
  ticketWinningsTaxBreakdown,
} from "../lib/winningsTax.js";

test("computeWinningsTaxBreakdown applies rate to gross", () => {
  const { taxAmount, netPayout } = computeWinningsTaxBreakdown(100, true, 0.15);
  assert.equal(taxAmount, 15);
  assert.equal(netPayout, 85);
});

test("computeWinningsTaxBreakdown skips when apply false", () => {
  const { taxAmount, netPayout } = computeWinningsTaxBreakdown(100, false, 0.15);
  assert.equal(taxAmount, 0);
  assert.equal(netPayout, 100);
});

test("ticketWinningsTaxBreakdown taxes only WON tickets from winning amount", () => {
  const won = ticketWinningsTaxBreakdown({
    potential_win: 200,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.1,
    status: "WON",
  });
  assert.equal(won.taxAmount, 20);
  assert.equal(won.netPayout, 180);

  const paid = ticketWinningsTaxBreakdown({
    potential_win: 200,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.1,
    status: "PAID",
  });
  assert.equal(paid.taxAmount, 20);
  assert.equal(paid.netPayout, 180);
});

test("ticketWinningsTaxBreakdown does not tax open, lost, or void tickets", () => {
  const base = {
    potential_win: 200,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.15,
  };

  for (const status of ["OPEN", "PRINTED", "HELD", "LOST", "VOID", "CANCELED"]) {
    const b = ticketWinningsTaxBreakdown({ ...base, status });
    assert.equal(b.taxAmount, 0, status);
    assert.equal(b.netPayout, 200, status);
  }
});

test("estimateWinningsTaxBreakdown shows helper estimate on open tickets", () => {
  const open = estimateWinningsTaxBreakdown({
    potential_win: 200,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.15,
    status: "OPEN",
  });
  assert.equal(open.taxAmount, 30);
  assert.equal(open.netPayout, 170);

  const lost = estimateWinningsTaxBreakdown({
    potential_win: 0,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.15,
    status: "LOST",
  });
  assert.equal(lost.taxAmount, 0);

  const voided = estimateWinningsTaxBreakdown({
    potential_win: 100,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.15,
    status: "VOID",
  });
  assert.equal(voided.taxAmount, 0);
  assert.equal(voided.netPayout, 100);
});

test("formatWinningsTaxHelperText matches Tax 15% - xxx Birr", () => {
  assert.equal(
    formatWinningsTaxHelperText(0.15, 12.5),
    "Tax 15% - 12.50 Birr",
  );
  assert.equal(formatWinningsTaxHelperText(0.15, 0), null);
});

test("ticketWinningsTaxApiFields exposes helper without applying tax on OPEN", () => {
  const open = ticketWinningsTaxApiFields({
    potential_win: 100,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.15,
    status: "OPEN",
  });
  assert.equal(open.winningsTaxAmount, 0);
  assert.equal(open.estimatedWinningsTaxAmount, 15);
  assert.equal(open.netPayout, 100);
  assert.equal(open.winningsTaxHelper, "Tax 15% - 15.00 Birr");

  const won = ticketWinningsTaxApiFields({
    potential_win: 100,
    apply_winnings_tax: true,
    winnings_tax_rate: 0.15,
    status: "WON",
  });
  assert.equal(won.winningsTaxAmount, 15);
  assert.equal(won.netPayout, 85);
  assert.equal(won.winningsTaxHelper, "Tax 15% - 15.00 Birr");
});
