import { describe, expect, it } from "vitest";
import { mapLegUiStatus, mapTicketUiStatus } from "./ticketDisplayStatus.js";

describe("mapTicketUiStatus", () => {
  it("maps settled and open ticket statuses", () => {
    expect(mapTicketUiStatus("WON")).toEqual({ key: "won", label: "WON" });
    expect(mapTicketUiStatus("PAID")).toEqual({ key: "won", label: "WON" });
    expect(mapTicketUiStatus("LOST")).toEqual({ key: "lost", label: "LOST" });
    expect(mapTicketUiStatus("REFUND")).toEqual({
      key: "refund",
      label: "REFUND",
    });
    expect(
      mapTicketUiStatus("PAID", { cashbackAmount: 50 }),
    ).toEqual({ key: "refund", label: "REFUND" });
    expect(mapTicketUiStatus("OPEN")).toEqual({
      key: "pending",
      label: "PENDING",
    });
    expect(mapTicketUiStatus("PRINTED")).toEqual({
      key: "pending",
      label: "PENDING",
    });
  });

  it("maps voided tickets to cancelled", () => {
    expect(mapTicketUiStatus("VOID")).toEqual({
      key: "cancelled",
      label: "CANCELLED",
    });
    expect(mapTicketUiStatus("CANCELED")).toEqual({
      key: "cancelled",
      label: "CANCELLED",
    });
    expect(mapTicketUiStatus("CASHED_OUT")).toEqual({
      key: "cancelled",
      label: "CANCELLED",
    });
  });
});

describe("mapLegUiStatus", () => {
  it("maps settled leg results", () => {
    expect(mapLegUiStatus({ result: "WON" })).toEqual({
      key: "won",
      label: "WON",
    });
    expect(mapLegUiStatus({ result: "LOST" })).toEqual({
      key: "lost",
      label: "LOST",
    });
  });

  it("maps upcoming legs to notplayed (no highlight)", () => {
    expect(mapLegUiStatus({ result: "PENDING", status: "NS" })).toEqual({
      key: "notplayed",
      label: "PENDING",
    });
  });

  it("maps in-progress and postponed legs to yellow postponed bucket", () => {
    expect(mapLegUiStatus({ result: "PENDING", status: "LIVE" })).toEqual({
      key: "postponed",
      label: "PENDING",
    });
    expect(mapLegUiStatus({ result: "PENDING", status: "PST" })).toEqual({
      key: "postponed",
      label: "POSTPONED",
    });
    expect(mapLegUiStatus({ result: "VOID" })).toEqual({
      key: "postponed",
      label: "PENDING",
    });
  });
});
