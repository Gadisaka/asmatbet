import { useEffect, useMemo, useState } from "react";
import {
  buildSelectionPayloadFromOddClick,
  fetchFixturesByDate,
  mapFixtureToCashierMatch,
} from "../../services/footballFixtures";

function formatKickoff(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeMatchName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+v\s+/g, " vs ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectionMatchLabel(selection) {
  const home = selection.match?.homeTeam ?? "";
  const away = selection.match?.awayTeam ?? "";
  if (home && away) return `${home} vs ${away}`;
  return "";
}

export default function FixturesSelectionPanel({
  open,
  ticket,
  onAddSelection,
  adding = false,
  error = "",
}) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const ticketMatchNames = useMemo(() => {
    const names = new Set();
    for (const selection of ticket?.selections || []) {
      const label = normalizeMatchName(selectionMatchLabel(selection));
      if (label) names.add(label);
    }
    return names;
  }, [ticket?.selections]);

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    setLoading(true);
    setLoadError("");

    fetchFixturesByDate()
      .then((fixtures) => {
        if (cancelled) return;
        setMatches(fixtures.map(mapFixtureToCashierMatch));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err?.message || "Failed to load fixtures");
        setMatches([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const handleOddClick = async (match, marketId) => {
    const payload = buildSelectionPayloadFromOddClick(match, marketId);
    if (!payload || adding) return;
    await onAddSelection?.(payload);
  };

  const isMatchOnTicket = (match) =>
    ticketMatchNames.has(normalizeMatchName(match.match));

  return (
    <div className="mt-3 rounded-sm border border-[var(--border)] bg-[var(--surfaceMuted)]">
      <div className="border-b border-[var(--border)] px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Add selections from fixtures
        </p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Click an odd to add it to the loaded ticket. One selection per match.
        </p>
      </div>

      {loading ? (
        <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">
          Loading fixtures...
        </p>
      ) : loadError ? (
        <p className="px-3 py-4 text-xs text-[var(--danger)]">{loadError}</p>
      ) : matches.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">
          No fixtures available for today.
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto divide-y divide-[var(--border)]">
          {matches.map((match) => {
            const onTicket = isMatchOnTicket(match);
            return (
              <div key={match.id} className="px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-[var(--muted)]">
                      {match.league}
                    </p>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {match.match}
                    </p>
                    <p className="text-[10px] text-[var(--muted)]">
                      {formatKickoff(match.kickoffAt)}
                    </p>
                  </div>
                  {onTicket ? (
                    <span className="rounded-sm bg-emerald-600/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                      On ticket
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 sm:grid-cols-6">
                  {match.markets.map((market) => (
                    <button
                      key={`${match.id}-${market.id}`}
                      type="button"
                      disabled={!market.value || adding || onTicket}
                      onClick={() => void handleOddClick(match, market.id)}
                      className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-center text-[11px] font-semibold disabled:opacity-40"
                    >
                      <span className="block text-[10px] uppercase text-[var(--muted)]">
                        {market.id}
                      </span>
                      <span className="font-mono text-[var(--foreground)]">
                        {market.value || "-"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error ? (
        <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
