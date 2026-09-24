import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppIcon from "../common/AppIcon";
import LogoImg from "../common/LogoImg";
import ExpansionMarketSection from "../common/ExpansionMarketSection";
import Panel from "../common/Panel";
import {
  MARKET_FILTER_CHIPS,
  MARKET_FILTER_ALL_CHIP_ID,
  filterCategoriesByChipId,
} from "../../data/footballMarketsByCategory";
import { resolveCompactMarketToken } from "../../utils/compactMarketToken";
import {
  getMarketDisplayName,
  sortMarketsByPriority,
  sortOddsWithinMarket,
} from "../../utils/marketDisplay";

/** Fluid tracks so the center column fits lg/xl without page-level side scroll. */
const TABLE_GRID_COLS =
  "grid-cols-[44px_minmax(0,1.3fr)_repeat(6,minmax(0,1fr))_36px_14px] xl:grid-cols-[52px_minmax(0,1.5fr)_repeat(6,minmax(0,1fr))_40px_16px]";
const MATCH_MARKETS = ["1", "x", "2", "1x", "x2", "12"];

function parseDate(date) {
  const [datePart = "", timePart = ""] = String(date || "").split(" ");
  return { datePart, timePart };
}

function formatLeagueLabel(league) {
  const [zone, name] = String(league || "").split(" - ");
  if (!name) return zone || "";
  return `${zone} · ${name}`;
}

function splitMatchTeams(matchName) {
  const [home = "Home", away = "Away"] = String(matchName || "").split(" V ");
  return { home, away };
}

function TableOddButton({ value, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-full min-h-[32px] w-full items-center justify-center rounded-lg border text-[12px] font-semibold transition-all duration-200 xl:min-h-[36px] xl:rounded-xl xl:text-[14px] ${
        selected
          ? "border-(--sb-accent-border) bg-(--sb-accent-surface-deep) text-(--sb-accent-fill)"
          : "border-transparent bg-(--sb-bg-card-elevated) text-(--sb-text) hover:bg-(--sb-bg-card)"
      }`.trim()}
    >
      {value ?? "-"}
    </button>
  );
}

function MatchRow({
  match,
  isExpanded,
  onToggle,
  onOddsClick,
  selectedOdds,
  children,
  rowRef,
}) {
  const marketMap = useMemo(
    () =>
      (match.markets || []).reduce((acc, market) => {
        acc[String(market.id).toLowerCase()] = market.value;
        return acc;
      }, {}),
    [match.markets],
  );
  const { datePart, timePart } = parseDate(match.date);
  const { home, away } = splitMatchTeams(match.match);

  return (
    <article
      ref={rowRef}
      className={`min-w-0 overflow-hidden rounded-xl transition-all duration-300 ${
        isExpanded
          ? "bg-(--sb-bg-card) shadow-[0_8px_28px_-8px_rgba(143,207,74,0.12)]"
          : "bg-(--sb-bg-card) shadow-[0_4px_14px_-6px_rgba(0,0,0,0.35)] hover:bg-(--sb-bg-card-elevated)"
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className="cursor-pointer border-b border-white/8 px-2.5 py-2 md:hidden hover:bg-[#0a0a0a]/35"
      >
        <div className="flex items-start gap-2.5">
          <div className="flex min-w-[46px] flex-col text-[10px]">
            <span className="font-medium text-(--sb-text-muted)">{datePart}</span>
            <span className="font-bold text-(--sb-positive)">{timePart}</span>
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              {match.homeTeamLogo ? (
                <LogoImg
                  src={match.homeTeamLogo}
                  alt=""
                  size={20}
                  className="border border-transparent bg-[#000000]"
                />
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-transparent bg-[#111111]">
                  <AppIcon name="flag" size={11} className="text-(--sb-text-muted)" />
                </span>
              )}
              <div className="truncate text-[13px] font-semibold text-(--sb-text)">
                {home}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {match.awayTeamLogo ? (
                <LogoImg
                  src={match.awayTeamLogo}
                  alt=""
                  size={20}
                  className="border border-transparent bg-[#000000]"
                />
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-transparent bg-[#111111]">
                  <AppIcon name="flag" size={11} className="text-(--sb-text-muted)" />
                </span>
              )}
              <div className="truncate text-[13px] font-semibold text-(--sb-text)">
                {away}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-(--sb-positive)">
              +{match.sideBets}
            </span>
            <AppIcon name="chevronDown" size={12} className="text-(--sb-text-muted)" />
          </div>
        </div>

        <div className="mt-2 grid grid-cols-6 gap-1 text-center text-[10px] font-bold text-(--sb-text-muted)">
          {MATCH_MARKETS.map((marketId) => (
            <span key={`mobile-label-${match.id}-${marketId}`}>
              {marketId.toUpperCase()}
            </span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-6 gap-1">
          {MATCH_MARKETS.map((marketId) => {
            const value = marketMap[marketId];
            const selectionId = `${match.match}-${marketId.toUpperCase()}`;
            return (
              <TableOddButton
                key={`mobile-odd-${match.id}-${marketId}`}
                value={value ?? "-"}
                selected={selectedOdds?.has(selectionId)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!value) return;
                  onOddsClick?.({
                    id: selectionId,
                    apiFixtureId: match.apiFixtureId,
                    matchName: match.match,
                    league: match.league,
                    ...resolveCompactMarketToken(marketId),
                    value,
                    kickoffAt: match.kickoffAt,
                    matchStatus: match.status,
                    fromLive: false,
                  });
                }}
              />
            );
          })}
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        className={`hidden min-w-0 md:grid ${TABLE_GRID_COLS} min-h-[46px] cursor-pointer items-stretch border-b border-white/8 px-1.5 py-1 hover:bg-[#0a0a0a]/35 xl:px-2`}
      >
        <div className="flex min-w-0 flex-col justify-center border-r border-white/8 pr-1.5 text-center text-[10px]">
          <span className="font-medium text-(--sb-text-muted)">{datePart}</span>
          <span className="font-bold text-(--sb-positive)">{timePart}</span>
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-0.5 border-r border-white/8 px-1.5 py-0.5 text-[12px] font-semibold text-(--sb-text) xl:px-2 xl:text-[14px]">
          <div className="flex min-h-[20px] min-w-0 items-center gap-1.5 xl:min-h-[22px] xl:gap-2">
            {match.homeTeamLogo ? (
              <LogoImg
                src={match.homeTeamLogo}
                alt=""
                size={16}
                className="shrink-0 border border-transparent bg-[#000000]"
              />
            ) : null}
            <span className="min-w-0 truncate">{home}</span>
          </div>
          <div className="flex min-h-[20px] min-w-0 items-center gap-1.5 text-(--sb-text) xl:min-h-[22px] xl:gap-2">
            {match.awayTeamLogo ? (
              <LogoImg
                src={match.awayTeamLogo}
                alt=""
                size={16}
                className="shrink-0 border border-transparent bg-[#000000]"
              />
            ) : null}
            <span className="min-w-0 truncate">{away}</span>
          </div>
        </div>
        {MATCH_MARKETS.map((marketId) => {
          const value = marketMap[marketId];
          const selectionId = `${match.match}-${marketId.toUpperCase()}`;
          return (
            <div key={marketId} className="min-w-0 px-0.5 xl:px-1">
              <TableOddButton
                value={value ?? "-"}
                selected={selectedOdds?.has(selectionId)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!value) return;
                  onOddsClick?.({
                    id: selectionId,
                    apiFixtureId: match.apiFixtureId,
                    matchName: match.match,
                    league: match.league,
                    ...resolveCompactMarketToken(marketId),
                    value,
                    kickoffAt: match.kickoffAt,
                    matchStatus: match.status,
                    fromLive: false,
                  });
                }}
              />
            </div>
          );
        })}
        <div className="flex min-w-0 items-center justify-end px-0.5 text-[10px] font-bold text-(--sb-positive) xl:px-1 xl:text-[11px]">
          +{match.sideBets}
        </div>
        <div className="flex items-center justify-center text-[#33456b]">
          <AppIcon name="chevronDown" size={12} />
        </div>
      </div>
      {children}
    </article>
  );
}

function matchHasExpansionCategories(match) {
  const d = match?.detailedOdds;
  return (
    (Array.isArray(d?.main) && d.main.length > 0) ||
    (Array.isArray(d?.extra) && d.extra.length > 0)
  );
}

function MatchExpansionSkeleton({ onClose }) {
  return (
    <div
      className="border-t border-white/6 bg-gradient-to-b from-[#000000]/98 to-[#0a0a0a]/98"
      aria-busy="true"
      aria-label="Loading odds"
    >
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-5 w-24 shrink-0 animate-pulse rounded bg-[#1a243c]" />
          <div className="h-4 w-40 max-w-[50%] animate-pulse rounded bg-[#1a243c]" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-[#0a0a0a]/80 text-[rgba(255,255,255,0.72)] transition-all duration-200 hover:bg-[#111111]"
        >
          <AppIcon name="x" size={14} />
        </button>
      </div>

      <div className="border-b border-white/8 bg-[#000000]/92 px-3 py-3">
        <div className="mx-auto mb-2 h-3 w-24 animate-pulse rounded bg-[#1a243c]" />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-2">
            <div className="h-9 w-9 animate-pulse rounded-full bg-[#1a243c]" />
            <div className="h-3 w-20 animate-pulse rounded bg-[#1a243c]" />
          </div>
          <div className="h-3 w-6 animate-pulse rounded bg-[#1a243c]" />
          <div className="flex flex-col items-center gap-2">
            <div className="h-9 w-9 animate-pulse rounded-full bg-[#1a243c]" />
            <div className="h-3 w-20 animate-pulse rounded bg-[#1a243c]" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-white/8 px-3 py-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-7 w-16 shrink-0 animate-pulse rounded-full bg-[#1a243c]"
          />
        ))}
      </div>

      <div className="space-y-2 p-2.5">
        {[1, 2, 3].map((block) => (
          <div
            key={block}
            className="overflow-hidden rounded-xl bg-[#0a0a0a]/35"
          >
            <div className="border-b border-white/8 px-3 py-2">
              <div className="h-3 w-28 animate-pulse rounded bg-[#1a243c]" />
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, j) => (
                <div
                  key={j}
                  className="h-9 animate-pulse rounded bg-[#1a243c]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchExpansionEmpty({ match, onClose }) {
  const { datePart, timePart } = parseDate(match.date);
  return (
    <div className="border-t border-white/6 bg-gradient-to-b from-[#000000]/98 to-[#0a0a0a]/98">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
        <span className="text-[11px] font-semibold text-(--sb-text-muted)">
          {datePart} {timePart}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl bg-[#0a0a0a]/80 text-[rgba(255,255,255,0.72)] transition-all duration-200 hover:bg-[#111111]"
        >
          <AppIcon name="x" size={14} />
        </button>
      </div>
      <p className="px-3 py-8 text-center text-sm text-(--sb-text-muted)">
        No odds available for this match yet.
      </p>
    </div>
  );
}

function MatchExpansion({ match, onClose, onOddsClick, selectedOdds }) {
  const handleOddsInExpansion = useCallback(
    (payload) => {
      onOddsClick?.(payload);
      onClose();
    },
    [onOddsClick, onClose],
  );

  const [activeChipId, setActiveChipId] = useState(MARKET_FILTER_ALL_CHIP_ID);
  const detail = match.detailedOdds;
  const categories = [...(detail?.main || []), ...(detail?.extra || [])];
  const filteredCategories = filterCategoriesByChipId(
    categories,
    activeChipId,
  );
  const showFilteredEmpty =
    activeChipId !== MARKET_FILTER_ALL_CHIP_ID &&
    filteredCategories.length === 0;
  const visibleCategories = sortMarketsByPriority(filteredCategories).map(
    (category) => ({
      ...category,
      odds: sortOddsWithinMarket(category.category, category.odds || []),
    }),
  );
  const split = splitMatchTeams(match.match);
  const home = match.homeTeam || split.home;
  const away = match.awayTeam || split.away;
  const { datePart, timePart } = parseDate(match.date);

  if (!categories.length) {
    return <MatchExpansionEmpty match={match} onClose={onClose} />;
  }

  return (
    <div className="border-t border-white/6 bg-gradient-to-b from-[#000000]/98 to-[#0a0a0a]/98">
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-(--sb-text-muted)">
          {match.countryFlag ? (
            <LogoImg
              src={match.countryFlag}
              alt=""
              size={18}
              rounded="rounded-[2px]"
              className="border border-transparent"
            />
          ) : null}
          {match.leagueLogo ? (
            <LogoImg
              src={match.leagueLogo}
              alt=""
              size={20}
              className="border border-transparent bg-[#000000]"
            />
          ) : null}
          <span className="truncate">{formatLeagueLabel(match.league)}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl bg-[#0a0a0a]/80 text-[rgba(255,255,255,0.72)] transition-all duration-200 hover:bg-[#111111]"
        >
          <AppIcon name="x" size={14} />
        </button>
      </div>

      <div className="border-b border-white/8 bg-[#000000]/92 px-3 py-3">
        <div className="mb-1 text-center text-[11px] font-semibold text-(--sb-text-muted)">
          {datePart} {timePart}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-transparent bg-[#111111]">
              {match.homeTeamLogo ? (
                <LogoImg
                  src={match.homeTeamLogo}
                  alt=""
                  size={36}
                  className="h-9 w-9 max-w-none rounded-full object-cover"
                  rounded="rounded-full"
                />
              ) : (
                <AppIcon name="flag" size={14} className="text-(--sb-text-muted)" />
              )}
            </div>
            <div className="text-xs font-semibold text-(--sb-text)">{home}</div>
          </div>
          <div className="text-xs font-semibold tracking-wider text-(--sb-text-muted)">
            VS
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-transparent bg-[#111111]">
              {match.awayTeamLogo ? (
                <LogoImg
                  src={match.awayTeamLogo}
                  alt=""
                  size={36}
                  className="h-9 w-9 max-w-none rounded-full object-cover"
                  rounded="rounded-full"
                />
              ) : (
                <AppIcon name="flag" size={14} className="text-(--sb-text-muted)" />
              )}
            </div>
            <div className="text-xs font-semibold text-(--sb-text)">{away}</div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-white/8 px-3 py-2">
        {MARKET_FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setActiveChipId(chip.id)}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 ${
              chip.id === activeChipId
                ? "border-(--sb-accent) bg-(--sb-accent-surface) text-(--sb-accent-text-soft) shadow-[0_4px_12px_-4px_rgba(143,207,74,0.25)]"
                : "border-transparent bg-(--sb-bg-2) text-(--sb-text) hover:bg-(--sb-bg-card-elevated)"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="space-y-2 p-2.5">
        {showFilteredEmpty ? (
          <p className="rounded-xl bg-[#0a0a0a]/45 px-3 py-8 text-center text-xs text-(--sb-text-muted)">
            No markets in this category for this match.
          </p>
        ) : null}
        {!showFilteredEmpty
          ? visibleCategories.map((category) => (
              <ExpansionMarketSection
                key={category.category}
                marketLabel={category.category}
                displayMarketLabel={getMarketDisplayName(category.category)}
                odds={category.odds}
                matchName={match.match}
                apiFixtureId={match.apiFixtureId}
                kickoffAt={match.kickoffAt}
                matchStatus={match.status}
                fromLive={false}
                home={home}
                away={away}
                onOddsClick={handleOddsInExpansion}
                selectedOdds={selectedOdds}
              />
            ))
          : null}
      </div>
    </div>
  );
}

function MatchesTable({
  matches,
  onMatchClick,
  onOddsClick,
  selectedOdds,
  expandedMatchId,
  oddsDetailByFixtureId,
}) {
  const groupedMatches = useMemo(() => {
    const groups = new Map();
    matches.forEach((match) => {
      const key = match.league || "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(match);
    });

    const rankOf = (leagueMatches) => leagueMatches[0]?.leagueRank ?? 9999;
    const earliestKickMs = (leagueMatches) => {
      let min = Infinity;
      for (const m of leagueMatches) {
        const ts = m.kickoffAt ? new Date(m.kickoffAt).getTime() : NaN;
        if (Number.isFinite(ts) && ts < min) min = ts;
      }
      return min;
    };

    return Array.from(groups.entries())
      .map(([league, leagueMatches]) => {
        const sorted = [...leagueMatches].sort((a, b) => {
          const ka = a.kickoffAt ? new Date(a.kickoffAt).getTime() : 0;
          const kb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : 0;
          return ka - kb || Number(a.apiFixtureId) - Number(b.apiFixtureId);
        });
        return [league, sorted];
      })
      .sort(([la, ma], [lb, mb]) => {
      const ra = rankOf(ma);
      const rb = rankOf(mb);
      if (ra !== rb) return ra - rb;
      const ka = earliestKickMs(ma);
      const kb = earliestKickMs(mb);
      if (ka !== kb) return ka - kb;
      return String(la).localeCompare(String(lb));
    });
  }, [matches]);

  const matchRowRefs = useRef(new Map());
  const prevExpandedMatchIdRef = useRef(expandedMatchId);

  useEffect(() => {
    const prev = prevExpandedMatchIdRef.current;
    prevExpandedMatchIdRef.current = expandedMatchId;

    const scrollToExpanded = (matchId) => {
      const el = matchRowRefs.current.get(matchId);
      if (!el) return;
      requestAnimationFrame(() => {
        el.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "smooth",
        });
      });
    };

    if (expandedMatchId != null && expandedMatchId !== prev) {
      scrollToExpanded(expandedMatchId);
      return;
    }

    if (expandedMatchId != null || prev == null) return;

    scrollToExpanded(prev);
  }, [expandedMatchId]);

  return (
    <Panel className="animate-deposit-panel min-w-0 overflow-hidden">
      <div className="min-w-0 space-y-2 p-2">
        {groupedMatches.map(([league, leagueMatches]) => {
          const head = leagueMatches[0];
          return (
            <section
              key={league}
              className="min-w-0 overflow-hidden rounded-xl"
            >
              <header className="border-b border-white/8 bg-[#0a0a0a]/40">
                <div className="flex items-center gap-2 border-b border-white/8 px-2.5 py-2 text-sm font-semibold text-(--sb-text)">
                  {head?.countryFlag ? (
                    <LogoImg
                      src={head.countryFlag}
                      alt=""
                      size={18}
                      rounded="rounded-[2px]"
                      className="border border-transparent"
                    />
                  ) : null}
                  {head?.leagueLogo ? (
                    <LogoImg
                      src={head.leagueLogo}
                      alt=""
                      size={20}
                      className="border border-transparent bg-[#000000]"
                    />
                  ) : (
                    <AppIcon
                      name="circleDot"
                      size={12}
                      className="text-(--sb-accent)"
                    />
                  )}
                  <span className="min-w-0 truncate">
                    {formatLeagueLabel(league)} [{leagueMatches.length}]
                  </span>
                </div>
                <div
                  className={`hidden min-w-0 md:grid ${TABLE_GRID_COLS} px-1.5 py-1 text-[10px] font-bold text-(--sb-text) xl:px-2 xl:text-[11px]`}
                >
                  <span />
                  <span />
                  {MATCH_MARKETS.map((marketId) => (
                    <span
                      key={`header-${league}-${marketId}`}
                      className="min-w-0 px-0.5 text-center xl:px-1"
                    >
                      {marketId.toUpperCase()}
                    </span>
                  ))}
                  <span className="text-center text-[#8b95b2]">+</span>
                  <span />
                </div>
              </header>

              <div className="min-w-0 space-y-0 bg-[#0a0f1c]/50 py-0.5">
                {leagueMatches.map((match) => {
                  const isExpanded = expandedMatchId === match.id;
                  return (
                    <MatchRow
                      key={match.id}
                      match={match}
                      isExpanded={isExpanded}
                      onToggle={() => onMatchClick?.(match)}
                      onOddsClick={onOddsClick}
                      selectedOdds={selectedOdds}
                      rowRef={(el) => {
                        if (el) matchRowRefs.current.set(match.id, el);
                        else matchRowRefs.current.delete(match.id);
                      }}
                    >
                      {isExpanded ? (
                        !oddsDetailByFixtureId?.has?.(match.apiFixtureId) ? (
                          <MatchExpansionSkeleton
                            onClose={() => onMatchClick?.(match)}
                          />
                        ) : matchHasExpansionCategories(match) ? (
                          <MatchExpansion
                            match={match}
                            onClose={() => onMatchClick?.(match)}
                            onOddsClick={onOddsClick}
                            selectedOdds={selectedOdds}
                          />
                        ) : (
                          <MatchExpansionEmpty
                            match={match}
                            onClose={() => onMatchClick?.(match)}
                          />
                        )
                      ) : null}
                    </MatchRow>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}

export default MatchesTable;
