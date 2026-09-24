import { useMemo, useState } from "react";
import PanelCard from "../ui/PanelCard";
import PrimaryButton from "../ui/PrimaryButton";
import { useBonusesQuery, useUpdateBonusMutation } from "../../hook/useSettingsQuery";

const DEFAULT_TRACKS = [
  {
    lostLegs: 1,
    minSelections: "5",
    minStakeOnline: "5",
    minStakeOffline: "10",
    maxCashback: "250000",
    tiers: [
      { minResult: "19", maxResult: "40", stakeMultiplier: "1" },
      { minResult: "40", maxResult: "60", stakeMultiplier: "2" },
      { minResult: "60", maxResult: "90", stakeMultiplier: "4" },
      { minResult: "90", maxResult: "200", stakeMultiplier: "6" },
      { minResult: "200", maxResult: "500", stakeMultiplier: "12" },
      { minResult: "500", maxResult: "1000", stakeMultiplier: "20" },
      { minResult: "1000", maxResult: "2000", stakeMultiplier: "30" },
      { minResult: "2000", maxResult: "3000", stakeMultiplier: "50" },
      { minResult: "3000", maxResult: "", stakeMultiplier: "100" },
    ],
  },
  {
    lostLegs: 2,
    minSelections: "10",
    minStakeOnline: "5",
    minStakeOffline: "5",
    maxCashback: "10000",
    tiers: [
      { minResult: "20", maxResult: "45", stakeMultiplier: "1" },
      { minResult: "45", maxResult: "60", stakeMultiplier: "2.5" },
      { minResult: "60", maxResult: "90", stakeMultiplier: "3.5" },
      { minResult: "90", maxResult: "450", stakeMultiplier: "6" },
      { minResult: "450", maxResult: "1000", stakeMultiplier: "12" },
      { minResult: "1000", maxResult: "1800", stakeMultiplier: "21" },
      { minResult: "1800", maxResult: "", stakeMultiplier: "50" },
    ],
  },
  {
    lostLegs: 3,
    minSelections: "15",
    minStakeOnline: "20",
    minStakeOffline: "20",
    maxCashback: "5000",
    tiers: [
      { minResult: "50", maxResult: "150", stakeMultiplier: "0.5" },
      { minResult: "150", maxResult: "300", stakeMultiplier: "1" },
      { minResult: "300", maxResult: "", stakeMultiplier: "2" },
    ],
  },
];

const MAX_TIERS = 10;

function listToText(list, fallback) {
  if (Array.isArray(list) && list.length > 0) return list.join(", ");
  return fallback;
}

function textToList(text) {
  return text
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function tiersToForm(tiers) {
  return (Array.isArray(tiers) ? tiers : []).map((t) => ({
    minResult: String(t.minResult ?? ""),
    maxResult: t.maxResult == null ? "" : String(t.maxResult),
    stakeMultiplier: String(t.stakeMultiplier ?? ""),
  }));
}

function trackToForm(track, fallback) {
  const base = fallback ?? DEFAULT_TRACKS.find((t) => t.lostLegs === track?.lostLegs);
  return {
    lostLegs: Number(track?.lostLegs ?? base.lostLegs),
    minSelections:
      track?.minSelections != null
        ? String(track.minSelections)
        : base.minSelections,
    minStakeOnline:
      track?.minStakeOnline != null
        ? String(track.minStakeOnline)
        : base.minStakeOnline,
    minStakeOffline:
      track?.minStakeOffline != null
        ? String(track.minStakeOffline)
        : base.minStakeOffline,
    maxCashback:
      track?.maxCashback != null ? String(track.maxCashback) : base.maxCashback,
    tiers:
      Array.isArray(track?.tiers) && track.tiers.length > 0
        ? tiersToForm(track.tiers)
        : base.tiers.map((t) => ({ ...t })),
  };
}

function rowToForm(row) {
  const rules = row?.rules && typeof row.rules === "object" ? row.rules : {};
  const tracks = Array.isArray(rules.tracks) ? rules.tracks : [];
  return {
    status: Boolean(row?.status),
    maxHours: rules.maxHours != null ? String(rules.maxHours) : "48",
    fixtureStatuses: listToText(
      rules.disqualifyFixtureStatuses,
      "PST, CANC, ABD",
    ),
    matchStatuses: listToText(rules.disqualifyMatchStatuses, "SUSPENDED"),
    tracks: DEFAULT_TRACKS.map((def) => {
      const found = tracks.find((t) => Number(t.lostLegs) === def.lostLegs);
      return trackToForm(found ?? def, def);
    }),
  };
}

export default function CashbackPanel() {
  const query = useBonusesQuery();
  const updateMut = useUpdateBonusMutation();
  const [form, setForm] = useState(null);
  const [syncedId, setSyncedId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [openTracks, setOpenTracks] = useState({ 1: true, 2: true, 3: true });

  const cashbackRow = useMemo(() => {
    const list = query.data?.items;
    if (!Array.isArray(list)) return null;
    return list.find((b) => b.type === "CASHBACK") ?? null;
  }, [query.data]);

  if (cashbackRow && cashbackRow.id !== syncedId) {
    setSyncedId(cashbackRow.id);
    setForm(rowToForm(cashbackRow));
  }

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setTrackField(trackIdx, key, value) {
    setForm((f) => {
      const tracks = f.tracks.map((t, i) =>
        i === trackIdx ? { ...t, [key]: value } : t,
      );
      return { ...f, tracks };
    });
  }

  function setTier(trackIdx, tierIdx, key, value) {
    setForm((f) => {
      const tracks = f.tracks.map((track, i) => {
        if (i !== trackIdx) return track;
        const tiers = track.tiers.map((t, j) =>
          j === tierIdx ? { ...t, [key]: value } : t,
        );
        return { ...track, tiers };
      });
      return { ...f, tracks };
    });
  }

  function addTier(trackIdx) {
    setForm((f) => {
      const tracks = f.tracks.map((track, i) => {
        if (i !== trackIdx || track.tiers.length >= MAX_TIERS) return track;
        return {
          ...track,
          tiers: [
            ...track.tiers,
            { minResult: "", maxResult: "", stakeMultiplier: "" },
          ],
        };
      });
      return { ...f, tracks };
    });
  }

  function removeTier(trackIdx, tierIdx) {
    setForm((f) => {
      const tracks = f.tracks.map((track, i) => {
        if (i !== trackIdx || track.tiers.length <= 1) return track;
        return {
          ...track,
          tiers: track.tiers.filter((_, j) => j !== tierIdx),
        };
      });
      return { ...f, tracks };
    });
  }

  function validateTrackTiers(tiers, trackLabel) {
    const parsed = tiers.map((t) => ({
      minResult: Number(t.minResult),
      maxResult: t.maxResult.trim() === "" ? null : Number(t.maxResult),
      stakeMultiplier: Number(t.stakeMultiplier),
    }));
    for (const t of parsed) {
      if (!Number.isFinite(t.minResult) || t.minResult < 0) {
        return `${trackLabel}: each tier needs a min result >= 0.`;
      }
      if (
        t.maxResult !== null &&
        (!Number.isFinite(t.maxResult) || t.maxResult <= t.minResult)
      ) {
        return `${trackLabel}: each tier max must be blank or > its min (half-open).`;
      }
      if (!Number.isFinite(t.stakeMultiplier) || t.stakeMultiplier < 0) {
        return `${trackLabel}: each tier needs a stake multiplier >= 0.`;
      }
    }
    parsed.sort((a, b) => a.minResult - b.minResult);
    for (let i = 0; i < parsed.length; i++) {
      if (parsed[i].maxResult === null && i !== parsed.length - 1) {
        return `${trackLabel}: only the last tier may have a blank (open-ended) max.`;
      }
      if (i > 0) {
        const prev = parsed[i - 1];
        if (prev.maxResult === null) {
          return `${trackLabel}: open-ended tier must be last.`;
        }
        if (parsed[i].minResult !== prev.maxResult) {
          return `${trackLabel}: tiers must be contiguous (next min = previous max).`;
        }
      }
    }
    return null;
  }

  function validateClient(formState) {
    for (const track of formState.tracks) {
      const label = `${track.lostLegs}-loss track`;
      const minSelections = Number(track.minSelections);
      if (!Number.isInteger(minSelections) || minSelections < 1) {
        return `${label}: min selections must be an integer >= 1.`;
      }
      for (const [key, labelKey] of [
        ["minStakeOnline", "min stake (online)"],
        ["minStakeOffline", "min stake (offline)"],
        ["maxCashback", "max cashback"],
      ]) {
        const n = Number(track[key]);
        if (!Number.isFinite(n) || n < 0) {
          return `${label}: ${labelKey} must be >= 0.`;
        }
      }
      const tierErr = validateTrackTiers(track.tiers, label);
      if (tierErr) return tierErr;
    }
    const maxHours = Number(formState.maxHours);
    if (!Number.isFinite(maxHours) || maxHours < 0) {
      return "Max hours must be >= 0.";
    }
    return null;
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!cashbackRow || !form) return;
    setError("");
    setSaved(false);

    const clientErr = validateClient(form);
    if (clientErr) {
      setError(clientErr);
      return;
    }

    const body = {
      status: form.status,
      maxHours: Number(form.maxHours),
      disqualifyFixtureStatuses: textToList(form.fixtureStatuses),
      disqualifyMatchStatuses: textToList(form.matchStatuses),
      cashbackTracks: form.tracks.map((track) => ({
        lostLegs: Number(track.lostLegs),
        minSelections: Number(track.minSelections),
        minStakeOnline: Number(track.minStakeOnline),
        minStakeOffline: Number(track.minStakeOffline),
        maxCashback: Number(track.maxCashback),
        tiers: track.tiers.map((t) => ({
          minResult: Number(t.minResult),
          maxResult: t.maxResult.trim() === "" ? null : Number(t.maxResult),
          stakeMultiplier: Number(t.stakeMultiplier),
        })),
      })),
    };

    try {
      await updateMut.mutateAsync({ id: cashbackRow.id, body });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.message || "Failed to save");
    }
  }

  if (query.isLoading) {
    return <p className="text-sm text-[var(--muted)]">Loading cashback…</p>;
  }
  if (query.isError) {
    return (
      <p className="text-sm text-[var(--danger)]">
        {query.error?.message || "Failed to load"}
      </p>
    );
  }
  if (!cashbackRow) {
    return (
      <PanelCard className="p-6">
        <p className="text-sm text-[var(--muted)]">
          No cashback program found. Run{" "}
          <code className="text-xs">npm run db:seed</code> in the backend folder
          to create the preset, then reload.
        </p>
        <button
          type="button"
          className="mt-3 text-xs font-semibold text-[var(--accent)] underline"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          {query.isFetching ? "Loading…" : "Reload"}
        </button>
      </PanelCard>
    );
  }
  if (!form) return null;

  return (
    <PanelCard className="p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide">
        Cashback on losses
      </h3>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Multi-track refund for tickets that lose exactly 1, 2, or 3 selections.
        Amount = <strong>stake × multiplier</strong>, where{" "}
        <code className="text-xs">
          result = total odds ÷ sum of lost-leg odds
        </code>
        . Online credits the player wallet; offline stores a claimable amount
        for cashier redemption. Example: total 46, lost leg 1.2, stake 10 → 46 ÷
        1.2 ≈ 38.33 → 1-loss 19–40 tier → ×1 → 10 birr.
      </p>

      <form onSubmit={handleSave} className="mt-4 space-y-5">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={form.status}
            onChange={(e) => setField("status", e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)]"
          />
          <span className="text-sm font-semibold text-[var(--text)]">
            Active (turn cashback on)
          </span>
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Max hours (from placement)" hint="0 = no time limit">
            <input
              type="number"
              min="0"
              step="any"
              value={form.maxHours}
              onChange={(e) => setField("maxHours", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field
            label="Disqualifying fixture statuses"
            hint="Any leg with these statuses voids cashback (system-managed)"
          >
            <div className={readOnlyClass}>{form.fixtureStatuses}</div>
          </Field>
          <Field
            label="Disqualifying match statuses"
            hint="Admin-managed match statuses that void cashback (system-managed)"
          >
            <div className={readOnlyClass}>{form.matchStatuses}</div>
          </Field>
        </div>

        {form.tracks.map((track, trackIdx) => {
          const open = openTracks[track.lostLegs];
          return (
            <div
              key={track.lostLegs}
              className="rounded-sm border border-[var(--border)] p-4"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() =>
                  setOpenTracks((o) => ({
                    ...o,
                    [track.lostLegs]: !o[track.lostLegs],
                  }))
                }
              >
                <span className="text-sm font-semibold text-[var(--text)]">
                  {track.lostLegs}-loss track
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {open ? "Hide" : "Show"}
                </span>
              </button>

              {open && (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field
                      label="Min selections"
                      hint="Inclusive (≥ this many non-VOID legs)"
                    >
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={track.minSelections}
                        onChange={(e) =>
                          setTrackField(
                            trackIdx,
                            "minSelections",
                            e.target.value,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Min stake (online)">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={track.minStakeOnline}
                        onChange={(e) =>
                          setTrackField(
                            trackIdx,
                            "minStakeOnline",
                            e.target.value,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Min stake (offline)">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={track.minStakeOffline}
                        onChange={(e) =>
                          setTrackField(
                            trackIdx,
                            "minStakeOffline",
                            e.target.value,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Max cashback">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={track.maxCashback}
                        onChange={(e) =>
                          setTrackField(trackIdx, "maxCashback", e.target.value)
                        }
                        className={inputClass}
                      />
                    </Field>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        Payout tiers (half-open: min ≤ result &lt; max)
                      </span>
                      {track.tiers.length < MAX_TIERS && (
                        <button
                          type="button"
                          onClick={() => addTier(trackIdx)}
                          className="text-xs font-semibold text-[var(--accent)]"
                        >
                          + Add tier
                        </button>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <thead>
                          <tr className="text-[var(--muted)]">
                            <th className="pb-2 pr-3 text-xs font-semibold uppercase">
                              Min result
                            </th>
                            <th className="pb-2 pr-3 text-xs font-semibold uppercase">
                              Max result (blank = ∞)
                            </th>
                            <th className="pb-2 pr-3 text-xs font-semibold uppercase">
                              Stake ×
                            </th>
                            <th className="pb-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {track.tiers.map((tier, tierIdx) => (
                            <tr key={tierIdx} className="align-middle">
                              <td className="py-1 pr-3">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={tier.minResult}
                                  onChange={(e) =>
                                    setTier(
                                      trackIdx,
                                      tierIdx,
                                      "minResult",
                                      e.target.value,
                                    )
                                  }
                                  className={inputClass}
                                />
                              </td>
                              <td className="py-1 pr-3">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={tier.maxResult}
                                  onChange={(e) =>
                                    setTier(
                                      trackIdx,
                                      tierIdx,
                                      "maxResult",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="∞"
                                  className={inputClass}
                                />
                              </td>
                              <td className="py-1 pr-3">
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={tier.stakeMultiplier}
                                  onChange={(e) =>
                                    setTier(
                                      trackIdx,
                                      tierIdx,
                                      "stakeMultiplier",
                                      e.target.value,
                                    )
                                  }
                                  className={inputClass}
                                />
                              </td>
                              <td className="py-1">
                                {track.tiers.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removeTier(trackIdx, tierIdx)
                                    }
                                    className="text-xs text-[var(--danger)]"
                                  >
                                    Remove
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <PrimaryButton
          type="submit"
          disabled={updateMut.isPending}
          className="w-auto"
        >
          {updateMut.isPending ? "Saving…" : "Save cashback settings"}
        </PrimaryButton>

        {saved && (
          <p className="text-xs font-medium text-green-600">
            Saved successfully.
          </p>
        )}
        {error && (
          <p className="text-xs font-medium text-[var(--danger)]">{error}</p>
        )}
      </form>
    </PanelCard>
  );
}

const inputClass =
  "w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]";

const readOnlyClass =
  "w-full rounded-sm border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--muted)] cursor-not-allowed select-none";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[10px] text-[var(--muted)]">{hint}</span>
      )}
    </label>
  );
}
