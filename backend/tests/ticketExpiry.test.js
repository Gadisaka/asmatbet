/**
 * Unit tests for unpaid ticket expiry helpers.
 *
 * Run: node --test backend/tests/ticketExpiry.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getEarliestKickoff,
  isUnpaidOpenTicket,
  shouldExpireUnpaidTicket,
  isTicketSettleable,
  applyExcludeExpiredFilter,
  applyExcludeUnpaidOpenFilter,
  applyReportableTicketFilter,
  UNPAID_OPEN_FILTER,
} from "../lib/ticketExpiry.js";

describe("getEarliestKickoff", () => {
  it("returns earliest kickoff from selections", () => {
    const ticket = {
      selections: [
        {
          fixture: { start_time: new Date("2026-06-20T15:00:00.000Z") },
        },
        {
          fixture: { start_time: new Date("2026-06-20T12:00:00.000Z") },
        },
      ],
      selection_snapshot: [],
    };
    const earliest = getEarliestKickoff(ticket);
    assert.equal(earliest?.toISOString(), "2026-06-20T12:00:00.000Z");
  });

  it("falls back to snapshot kickoffAt", () => {
    const ticket = {
      selections: [],
      selection_snapshot: [{ kickoffAt: "2026-06-21T10:00:00.000Z" }],
    };
    const earliest = getEarliestKickoff(ticket);
    assert.equal(earliest?.toISOString(), "2026-06-21T10:00:00.000Z");
  });
});

describe("shouldExpireUnpaidTicket", () => {
  it("expires unpaid OPEN ticket after earliest kickoff", () => {
    const ticket = {
      status: "OPEN",
      receipt_number: null,
      selections: [
        {
          fixture: { start_time: new Date("2026-06-20T12:00:00.000Z") },
        },
      ],
      selection_snapshot: [],
    };
    assert.equal(
      shouldExpireUnpaidTicket(ticket, new Date("2026-06-20T12:00:01.000Z")),
      true,
    );
    assert.equal(
      shouldExpireUnpaidTicket(ticket, new Date("2026-06-20T11:59:00.000Z")),
      false,
    );
  });

  it("does not expire paid PRINTED tickets", () => {
    const ticket = {
      status: "PRINTED",
      receipt_number: "12345-67890",
      selections: [
        {
          fixture: { start_time: new Date("2026-06-20T12:00:00.000Z") },
        },
      ],
    };
    assert.equal(
      shouldExpireUnpaidTicket(ticket, new Date("2026-06-20T13:00:00.000Z")),
      false,
    );
  });
});

describe("isTicketSettleable", () => {
  it("skips unpaid OPEN and EXPIRED tickets", () => {
    assert.equal(
      isTicketSettleable({ status: "OPEN", receipt_number: null }),
      false,
    );
    assert.equal(isTicketSettleable({ status: "EXPIRED" }), false);
    assert.equal(
      isTicketSettleable({ status: "PRINTED", receipt_number: "12345-67890" }),
      true,
    );
    assert.equal(
      isTicketSettleable({ status: "OPEN", receipt_number: "12345-67890" }),
      true,
    );
  });
});

describe("applyExcludeExpiredFilter", () => {
  it("excludes EXPIRED and CANCELED by default", () => {
    const where = {};
    applyExcludeExpiredFilter(where);
    assert.deepEqual(where, { status: { notIn: ["EXPIRED", "CANCELED"] } });
  });

  it("allows explicit CANCELED filter", () => {
    const where = { status: "CANCELED" };
    applyExcludeExpiredFilter(where, "CANCELED");
    assert.deepEqual(where, { status: "CANCELED" });
  });

  it("allows explicit EXPIRED filter", () => {
    const where = { status: "OPEN" };
    applyExcludeExpiredFilter(where, "EXPIRED");
    assert.deepEqual(where, { status: "OPEN" });
  });
});

describe("applyExcludeUnpaidOpenFilter", () => {
  it("adds NOT clause to empty where", () => {
    const where = {};
    applyExcludeUnpaidOpenFilter(where);
    assert.deepEqual(where, { NOT: UNPAID_OPEN_FILTER });
  });

  it("composes with existing NOT clause", () => {
    const existing = { id: "abc" };
    const where = { NOT: existing };
    applyExcludeUnpaidOpenFilter(where);
    assert.deepEqual(where, {
      NOT: { AND: [existing, UNPAID_OPEN_FILTER] },
    });
  });

  it("works after applyExcludeExpiredFilter", () => {
    const where = {};
    applyReportableTicketFilter(where);
    assert.deepEqual(where, {
      status: { notIn: ["EXPIRED", "CANCELED"] },
      NOT: UNPAID_OPEN_FILTER,
    });
  });
});

describe("isUnpaidOpenTicket", () => {
  it("detects OPEN without receipt", () => {
    assert.equal(isUnpaidOpenTicket({ status: "OPEN", receipt_number: null }), true);
    assert.equal(
      isUnpaidOpenTicket({ status: "OPEN", receipt_number: "12345-67890" }),
      false,
    );
  });
});
