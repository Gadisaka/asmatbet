import { describe, expect, it } from "vitest";
import {
  eatLocalToUtc,
  formatBettingDateDdMm,
  formatBettingDateDdMmFromInstant,
  getBettingDateYmd,
  getSportsbookAnchorYmd,
  getSportsbookDayOffset,
  getZonedParts,
  sportsbookAnchorAtOffset,
  utcYmdDatesForPrematchHorizon,
  utcYmdDatesForSportsbookOffset,
} from "./sportsbookDay.js";

/** 26/06 18:00 EAT */
const JUN26_6PM = new Date("2026-06-26T15:00:00.000Z");

/** 27/06 00:45 EAT = 26/06 21:45 UTC */
const JUN27_1245AM = new Date("2026-06-26T21:45:00.000Z");

/** 27/06 06:59 EAT = 27/06 03:59 UTC */
const JUN27_659AM = new Date("2026-06-27T03:59:00.000Z");

/** 27/06 07:00 EAT = 27/06 04:00 UTC */
const JUN27_7AM = new Date("2026-06-27T04:00:00.000Z");

/** 27/06 08:00 EAT = 27/06 05:00 UTC */
const JUN27_8AM = new Date("2026-06-27T05:00:00.000Z");

/** now = 26/06 12:00 EAT */
const NOW_JUN26_NOON = new Date("2026-06-26T09:00:00.000Z");

describe("sportsbookDay (07:00 → 06:59 EAT betting day)", () => {
  it("assigns betting date per business rule", () => {
    expect(getBettingDateYmd(JUN26_6PM)).toBe("2026-06-26");
    expect(getBettingDateYmd(JUN27_1245AM)).toBe("2026-06-26");
    expect(getBettingDateYmd(JUN27_659AM)).toBe("2026-06-26");
    expect(getBettingDateYmd(JUN27_7AM)).toBe("2026-06-27");
    expect(getBettingDateYmd(JUN27_8AM)).toBe("2026-06-27");
  });

  it("formats betting date dd/mm without changing kickoff display helpers", () => {
    expect(formatBettingDateDdMm("2026-06-26")).toBe("26/06");
    expect(formatBettingDateDdMmFromInstant(JUN27_1245AM)).toBe("26/06");
  });

  it("tab offsets from fixed now on 26/06 noon EAT", () => {
    expect(getSportsbookDayOffset(JUN26_6PM, NOW_JUN26_NOON)).toBe(0);
    expect(getSportsbookDayOffset(JUN27_1245AM, NOW_JUN26_NOON)).toBe(0);
    expect(getSportsbookDayOffset(JUN27_659AM, NOW_JUN26_NOON)).toBe(0);
    expect(getSportsbookDayOffset(JUN27_7AM, NOW_JUN26_NOON)).toBe(1);
    expect(getSportsbookDayOffset(JUN27_8AM, NOW_JUN26_NOON)).toBe(1);
  });

  it("user example: midnight–06:59 belong to previous betting day", () => {
    const now = new Date("2026-06-26T18:00:00.000Z"); // 26/06 21:00 EAT
    const atMidnight = new Date("2026-06-26T21:00:00.000Z"); // 27/06 00:00 EAT
    const at645 = new Date("2026-06-27T03:45:00.000Z"); // 27/06 06:45 EAT
    const at8 = new Date("2026-06-27T05:00:00.000Z"); // 27/06 08:00 EAT

    expect(getSportsbookDayOffset(atMidnight, now)).toBe(0);
    expect(getSportsbookDayOffset(at645, now)).toBe(0);
    expect(getSportsbookDayOffset(at8, now)).toBe(1);
  });

  it("sportsbookAnchorAtOffset advances betting days", () => {
    expect(sportsbookAnchorAtOffset(0, NOW_JUN26_NOON)).toBe("2026-06-26");
    expect(sportsbookAnchorAtOffset(1, NOW_JUN26_NOON)).toBe("2026-06-27");
  });

  it("utcYmdDatesForSportsbookOffset spans two UTC days", () => {
    const dates = utcYmdDatesForSportsbookOffset(0, NOW_JUN26_NOON);
    expect(dates).toContain("2026-06-26");
    expect(dates).toContain("2026-06-27");
  });

  it("utcYmdDatesForPrematchHorizon includes backfill day", () => {
    const dates = utcYmdDatesForPrematchHorizon(3, 1);
    expect(dates.length).toBeGreaterThanOrEqual(5);
  });

  it("eatLocalToUtc matches getZonedParts for noon EAT", () => {
    const utc = eatLocalToUtc(2026, 6, 26, 12, 0, 0);
    const parts = getZonedParts(utc);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(6);
    expect(parts.day).toBe(26);
    expect(parts.hour).toBe(12);
  });
});
