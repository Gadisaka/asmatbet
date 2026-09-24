import { describe, expect, it } from "vitest";
import {
  isSelectionExpired,
  pruneExpiredSelections,
  pruneExpiredSlips,
} from "./selectionExpiry";

describe("selectionExpiry", () => {
  const now = Date.parse("2026-08-02T12:00:00.000Z");

  it("marks prematch selections expired after kickoff", () => {
    expect(
      isSelectionExpired(
        { kickoffAt: "2026-08-02T11:59:00.000Z", fromLive: false },
        now,
      ),
    ).toBe(true);
    expect(
      isSelectionExpired(
        { kickoffAt: "2026-08-02T12:01:00.000Z", fromLive: false },
        now,
      ),
    ).toBe(false);
  });

  it("keeps live selections until terminal status", () => {
    expect(
      isSelectionExpired(
        { kickoffAt: "2026-08-02T11:00:00.000Z", fromLive: true },
        now,
      ),
    ).toBe(false);
    expect(
      isSelectionExpired(
        {
          kickoffAt: "2026-08-02T11:00:00.000Z",
          fromLive: true,
          matchStatus: "FT",
        },
        now,
      ),
    ).toBe(true);
  });

  it("prunes expired rows from slips", () => {
    const slips = {
      betslip1: [
        { id: "a", kickoffAt: "2026-08-02T11:00:00.000Z", fromLive: false },
        { id: "b", kickoffAt: "2026-08-02T13:00:00.000Z", fromLive: false },
      ],
      betslip2: [],
      betslip3: [
        { id: "c", kickoffAt: "2026-08-02T11:00:00.000Z", fromLive: true },
      ],
    };
    const next = pruneExpiredSlips(slips, now);
    expect(next.betslip1.map((s) => s.id)).toEqual(["b"]);
    expect(next.betslip3.map((s) => s.id)).toEqual(["c"]);
    expect(pruneExpiredSelections(slips.betslip1, now)).not.toBe(
      slips.betslip1,
    );
  });
});
