import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import MainLayout from "../components/layout/MainLayout";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import PageContainer from "../components/layout/PageContainer";
import SiteFooter from "../components/layout/SiteFooter";
import TopHeader from "../components/layout/TopHeader";
import MatchesPagination from "../components/common/MatchesPagination";
import BetSlipPanel from "../components/sections/BetSlipPanel";
import HeroBanner from "../components/sections/HeroBanner";
import CategoryTiles from "../components/sections/CategoryTiles";
import SuggestedBets from "../components/home/desktop/DesktopSuggestedBets";
import MultipleOfTheDay from "../components/home/desktop/DesktopMultiples";
import MatchesTable from "../components/sections/MatchesTable";
import MatchesTabs from "../components/sections/MatchesTabs";
import NextCalendarDayFooter from "../components/sections/NextCalendarDayFooter";
import SportsSidebar from "../components/sections/SportsSidebar";
import TopLeaguesSidebar from "../components/sections/TopLeaguesSidebar";
import {
  sportsList,
  sportsbookToolbar,
  topHeaderData,
} from "../data/homepageData";
import useMatches, { PREMATCH_HORIZON_DAYS } from "../hooks/useMatches";
import { useFootballSidebarCatalog } from "../hooks/useFootballSidebarCatalog";
import {
  buildLeagueSidebarGroups,
  buildLeagueTabOptions,
} from "../utils/buildLeagueSidebarGroups";
import { buildSportsbookTimeOptions } from "../utils/sportsbookTimeOptions";
import {
  enrichSlipsFromMatches,
  loadBetSlipState,
  persistBetSlipState,
} from "../utils/betSlipPersistence";
import { pruneExpiredSlips } from "../utils/selectionExpiry";
import { usePlayerSiteBranding } from "../hooks/usePlayerSiteBranding";
import { normalizeApiFixtureId } from "../utils/fixtureId";
import {
  filtersToRevealMatch,
  findMatchByFixtureId,
  matchIdFromFixtureId,
} from "../utils/openSlipSelectionOnHome";
import { slicePageItems } from "../utils/pagination";

/** History keys for SPA back handling on Home (fixture expand + scroll). */
const HISTORY_HOME_FIXTURE = "__home_fixture_drop";
const HISTORY_HOME_SCROLL_PIN = "__home_scroll_pin";
const SCROLL_PIN_THRESHOLD_PX = 56;
const BET_SLIP_PRUNE_MS = 15_000;

function Home() {
  const initialBet = loadBetSlipState();
  const location = useLocation();
  const navigate = useNavigate();
  const { loadingLogo } = usePlayerSiteBranding();
  const defaultSportId = sportsbookToolbar.sports?.[0]?.id || "football";
  const allLeaguesId = "all-leagues";

  const timeOptions = useMemo(
    () => buildSportsbookTimeOptions(undefined, PREMATCH_HORIZON_DAYS),
    [],
  );
  const defaultTimeId =
    timeOptions.find((time) => time.id === "today")?.id || "today";

  const [selectedSportId, setSelectedSportId] = useState(defaultSportId);
  const [selectedTimeId, setSelectedTimeId] = useState(defaultTimeId);
  const [selectedLeagueId, setSelectedLeagueId] = useState(allLeaguesId);
  const [clubSearch, setClubSearch] = useState("");
  const [matchesPage, setMatchesPage] = useState(1);
  const [expandedMatchId, setExpandedMatchId] = useState(null);
  const [pendingOpenFixtureId, setPendingOpenFixtureId] = useState(null);
  const pendingOpenKickoffRef = useRef(null);
  const [activeSlip, setActiveSlip] = useState(initialBet.activeSlip);
  const [slips, setSlips] = useState(initialBet.slips);
  const selectedOdds = useMemo(
    () => new Set((slips[activeSlip] || []).map((selection) => selection.id)),
    [activeSlip, slips],
  );

  const {
    matches,
    allMatches,
    loading,
    error,
    refreshAll,
    hydrateMatchOdds,
    oddsDetailByFixtureId,
    resolvedTimeId,
    dateDropdownOptions,
  } = useMatches({
    includeLive: true,
    filters: {
      sportId: selectedSportId,
      timeId: selectedTimeId,
      leagueId: selectedLeagueId,
      clubSearch,
    },
  });

  const { catalogItems } = useFootballSidebarCatalog();

  const suggestedMatches = useMemo(
    () =>
      [...allMatches]
        .filter(
          (match) => String(match.sportId || "").toLowerCase() === "football",
        )
        .sort(
          (a, b) =>
            (a.leagueRank ?? 9999) - (b.leagueRank ?? 9999) ||
            new Date(a.kickoffAt || 0) - new Date(b.kickoffAt || 0),
        )
        .slice(0, 8),
    [allMatches],
  );

  const selections = slips[activeSlip];

  useEffect(() => {
    setMatchesPage(1);
  }, [selectedSportId, selectedTimeId, selectedLeagueId, clubSearch]);

  const matchesPagination = useMemo(
    () => slicePageItems(matches, matchesPage),
    [matches, matchesPage],
  );

  useEffect(() => {
    if (matchesPagination.page !== matchesPage) {
      setMatchesPage(matchesPagination.page);
    }
  }, [matchesPagination.page, matchesPage]);

  const handleMatchesPageChange = useCallback((nextPage) => {
    setMatchesPage(nextPage);
    setExpandedMatchId(null);
  }, []);

  const expandedMatchIdRef = useRef(expandedMatchId);
  useEffect(() => {
    expandedMatchIdRef.current = expandedMatchId;
  }, [expandedMatchId]);

  const ignoreNextPopRef = useRef(false);
  const fixtureClosedByPopRef = useRef(false);
  const prevExpandedMatchIdRef = useRef(expandedMatchId);
  const scrollPinActiveRef = useRef(false);

  // Push/sync history entries when a fixture row opens, closes, or switches.
  useEffect(() => {
    const prev = prevExpandedMatchIdRef.current;
    const curr = expandedMatchId;

    if (curr && !prev) {
      const s = window.history.state || {};
      window.history.pushState({ ...s, [HISTORY_HOME_FIXTURE]: true }, "");
    } else if (!curr && prev) {
      if (fixtureClosedByPopRef.current) {
        fixtureClosedByPopRef.current = false;
      } else {
        ignoreNextPopRef.current = true;
        window.history.go(-1);
      }
    } else if (curr && prev && curr !== prev) {
      const s = window.history.state || {};
      window.history.replaceState({ ...s, [HISTORY_HOME_FIXTURE]: true }, "");
    }

    prevExpandedMatchIdRef.current = curr;
  }, [expandedMatchId]);

  // When scrolled down without an open fixture, add a stack entry so Back scrolls up first.
  useEffect(() => {
    let rafId = null;
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (expandedMatchIdRef.current) return;
        const y =
          window.scrollY ||
          document.documentElement.scrollTop ||
          window.pageYOffset ||
          0;
        if (y <= SCROLL_PIN_THRESHOLD_PX) return;
        if (scrollPinActiveRef.current) return;
        scrollPinActiveRef.current = true;
        const s = window.history.state || {};
        window.history.pushState({ ...s, [HISTORY_HOME_SCROLL_PIN]: true }, "");
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }

      if (expandedMatchIdRef.current) {
        fixtureClosedByPopRef.current = true;
        expandedMatchIdRef.current = null;
        setExpandedMatchId(null);
        return;
      }

      if (!scrollPinActiveRef.current) {
        return;
      }

      scrollPinActiveRef.current = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- enrich persisted slips when fixture metadata refreshes
    setSlips((prev) =>
      pruneExpiredSlips(enrichSlipsFromMatches(prev, allMatches)),
    );
  }, [allMatches]);

  useEffect(() => {
    const tick = () => {
      setSlips((prev) => pruneExpiredSlips(prev));
    };
    tick();
    const id = window.setInterval(tick, BET_SLIP_PRUNE_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    persistBetSlipState(slips, activeSlip);
  }, [slips, activeSlip]);

  const handleMatchClick = useCallback(
    async (match) => {
      setExpandedMatchId((prev) => (prev === match.id ? null : match.id));
      if (!match?.apiFixtureId) return;
      try {
        await hydrateMatchOdds(match.apiFixtureId);
      } catch (err) {
        console.error("Failed to hydrate match odds:", err);
      }
    },
    [hydrateMatchOdds],
  );

  const handleOddsClick = useCallback(
    (oddData) => {
      setSlips((prev) => {
        const current = prev[activeSlip];
        const exists = current.find((s) => s.id === oddData.id);
        if (exists) {
          return {
            ...prev,
            [activeSlip]: current.filter((s) => s.id !== oddData.id),
          };
        }
        const withoutSameMatch = current.filter(
          (s) => s.matchName !== oddData.matchName,
        );
        return {
          ...prev,
          [activeSlip]: [...withoutSameMatch, oddData],
        };
      });
    },
    [activeSlip],
  );

  const handleRemoveSelection = useCallback(
    (id) => {
      setSlips((prev) => ({
        ...prev,
        [activeSlip]: prev[activeSlip].filter((s) => s.id !== id),
      }));
    },
    [activeSlip],
  );

  const handleClearSelections = useCallback(() => {
    setSlips((prev) => ({
      ...prev,
      [activeSlip]: [],
    }));
  }, [activeSlip]);

  const handleReplaceSlipSelections = useCallback(
    (nextSelections) => {
      setSlips((prev) => ({
        ...prev,
        [activeSlip]: Array.isArray(nextSelections) ? nextSelections : [],
      }));
    },
    [activeSlip],
  );

  const applyFiltersToRevealMatch = useCallback((match, kickoffAt) => {
    const filters = filtersToRevealMatch(match, kickoffAt);
    if (filters.sportId) setSelectedSportId(filters.sportId);
    setSelectedLeagueId(filters.leagueId);
    if (filters.timeId) setSelectedTimeId(filters.timeId);
    setClubSearch(filters.clubSearch);
  }, []);

  const openFixtureOnHome = useCallback(
    async (fixtureId, kickoffAt, match) => {
      const normalized = normalizeApiFixtureId(fixtureId);
      if (normalized == null) return;

      applyFiltersToRevealMatch(match, kickoffAt);

      const matchId = matchIdFromFixtureId(normalized);
      if (matchId) setExpandedMatchId(matchId);

      try {
        await hydrateMatchOdds(normalized);
      } catch (err) {
        console.error("Failed to hydrate match odds:", err);
      }
    },
    [applyFiltersToRevealMatch, hydrateMatchOdds],
  );

  const handleOpenSelectionOnHome = useCallback(
    (selection) => {
      const fixtureId = normalizeApiFixtureId(selection?.apiFixtureId);
      if (fixtureId == null) return;

      const kickoffAt = selection?.kickoffAt ?? null;
      const match = findMatchByFixtureId(allMatches, fixtureId);

      if (match) {
        setPendingOpenFixtureId(null);
        pendingOpenKickoffRef.current = null;
        void openFixtureOnHome(fixtureId, kickoffAt, match);
        return;
      }

      pendingOpenKickoffRef.current = kickoffAt;
      setPendingOpenFixtureId(fixtureId);
      applyFiltersToRevealMatch(null, kickoffAt);
    },
    [allMatches, applyFiltersToRevealMatch, openFixtureOnHome],
  );

  useEffect(() => {
    if (pendingOpenFixtureId == null) return;
    const match = findMatchByFixtureId(allMatches, pendingOpenFixtureId);
    if (!match) return;

    const fixtureId = pendingOpenFixtureId;
    const kickoffAt = pendingOpenKickoffRef.current;
    setPendingOpenFixtureId(null);
    pendingOpenKickoffRef.current = null;
    void openFixtureOnHome(fixtureId, kickoffAt, match);
  }, [allMatches, openFixtureOnHome, pendingOpenFixtureId]);

  useEffect(() => {
    const fixtureId = location.state?.openFixtureId;
    if (fixtureId == null) return;

    handleOpenSelectionOnHome({
      apiFixtureId: fixtureId,
      kickoffAt: location.state?.kickoffAt ?? null,
    });
    navigate(".", { replace: true, state: {} });
  }, [handleOpenSelectionOnHome, location.state?.openFixtureId, location.state?.kickoffAt, navigate]);

  const sportCounts = useMemo(() => {
    const counts = new Map();
    allMatches.forEach((match) => {
      const key = String(match.sportId || "").toLowerCase();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [allMatches]);

  const sidebarSports = useMemo(
    () =>
      sportsList.map((sport) => {
        const dynamicCount = sportCounts.get(
          String(sport.id || "").toLowerCase(),
        );
        return {
          ...sport,
          count: Number.isFinite(dynamicCount) ? dynamicCount : sport.count,
        };
      }),
    [sportCounts],
  );

  const leagueCounts = useMemo(() => {
    const counts = new Map();
    allMatches.forEach((match) => {
      const id = String(match.league || "").trim();
      if (!id) return;
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    catalogItems.forEach((item) => {
      const id = String(item?.id || "").trim();
      if (!id) return;
      const n = Number(item.count);
      if (Number.isFinite(n)) counts.set(id, n);
    });
    return counts;
  }, [allMatches, catalogItems]);

  const leagueMetaByKey = useMemo(() => {
    const m = new Map();
    allMatches.forEach((match) => {
      const id = String(match.league || "").trim();
      if (!id || m.has(id)) return;
      m.set(id, {
        leagueLogo: match.leagueLogo || null,
        countryFlag: match.countryFlag || null,
      });
    });
    return m;
  }, [allMatches]);

  const leagueOptions = useMemo(
    () =>
      buildLeagueTabOptions({
        allLeaguesId,
        allMatchesLength: allMatches.length,
        catalogItems,
        counts: leagueCounts,
        leagueMetaByKey,
      }),
    [
      allLeaguesId,
      allMatches.length,
      catalogItems,
      leagueCounts,
      leagueMetaByKey,
    ],
  );

  const { regionGroups, countryGroups } = useMemo(
    () => buildLeagueSidebarGroups(catalogItems, leagueCounts, leagueMetaByKey),
    [catalogItems, leagueCounts, leagueMetaByKey],
  );

  const totalLeagueCount = Math.max(leagueOptions.length - 1, 0);

  const topLeaguesSidebarProps = useMemo(
    () => ({
      regionGroups,
      countryGroups,
      catalogItems,
      allLeaguesId,
      totalLeagueCount,
      selectedLeagueId,
      onSelectLeague: setSelectedLeagueId,
      selectedTimeId: resolvedTimeId,
      onTimeChange: setSelectedTimeId,
      timeOptions,
      dateDropdownOptions,
      searchQuery: clubSearch,
      onSearchChange: setClubSearch,
    }),
    [
      regionGroups,
      countryGroups,
      catalogItems,
      allLeaguesId,
      totalLeagueCount,
      selectedLeagueId,
      resolvedTimeId,
      timeOptions,
      dateDropdownOptions,
      clubSearch,
    ],
  );

  const handleNextCalendarDay = useCallback((timeId) => {
    setSelectedTimeId(timeId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  return (
    <PageContainer>
      <div className="sticky top-0 z-50 w-full min-w-0 max-w-full">
        <TopHeader data={topHeaderData} />
      </div>
      <div className="relative overflow-x-clip">
        <div
          className="pointer-events-none absolute left-1/2 top-[-1rem] h-80 w-[min(100%,56rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(143,207,74,0.1),transparent_68%)] blur-2xl"
          aria-hidden
        />
        <MainLayout
          left={
            <>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
                <TopLeaguesSidebar {...topLeaguesSidebarProps} />
              </div>
              <SportsSidebar
                sports={sidebarSports}
                selectedSportId={selectedSportId}
                onSportChange={setSelectedSportId}
              />
            </>
          }
          center={
            <>
              <div className="hidden gap-2 md:grid lg:hidden md:grid-cols-2">
                <TopLeaguesSidebar {...topLeaguesSidebarProps} />
                <SportsSidebar
                  sports={sidebarSports}
                  selectedSportId={selectedSportId}
                  onSportChange={setSelectedSportId}
                />
              </div>
              <HeroBanner />
              <SuggestedBets
                matches={suggestedMatches}
                onOddsClick={handleOddsClick}
                selectedOdds={selectedOdds}
              />
              <MultipleOfTheDay
                matches={allMatches}
                onLoadTicket={handleReplaceSlipSelections}
              />
              <CategoryTiles />
              <MatchesTabs
                times={timeOptions}
                leagues={leagueOptions}
                selectedTimeId={resolvedTimeId}
                selectedLeagueId={selectedLeagueId}
                onTimeChange={setSelectedTimeId}
                onLeagueChange={setSelectedLeagueId}
                searchQuery={clubSearch}
                onSearchChange={setClubSearch}
              />
              {!loading && error ? (
                <div
                  className="mb-3 flex flex-col items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-50 sm:flex-row sm:items-center sm:justify-between"
                  role="alert"
                >
                  <p>
                    {error?.message ||
                      "Couldn't load matches. Please try again."}
                  </p>
                  <button
                    type="button"
                    onClick={() => refreshAll()}
                    className="shrink-0 rounded-lg bg-(--sb-accent-fill) px-3 py-1.5 text-xs font-semibold text-(--sb-on-accent) hover:bg-(--sb-accent-fill-hover)"
                  >
                    Retry
                  </button>
                </div>
              ) : null}
              <MatchesTable
                matches={matchesPagination.items}
                onMatchClick={handleMatchClick}
                onOddsClick={handleOddsClick}
                selectedOdds={selectedOdds}
                expandedMatchId={expandedMatchId}
                oddsDetailByFixtureId={oddsDetailByFixtureId}
              />
              <MatchesPagination
                page={matchesPagination.page}
                totalPages={matchesPagination.totalPages}
                onPageChange={handleMatchesPageChange}
              />
              {!loading && !String(clubSearch).trim() ? (
                <NextCalendarDayFooter
                  resolvedTimeId={resolvedTimeId}
                  timeOptions={timeOptions}
                  horizonDays={PREMATCH_HORIZON_DAYS}
                  onSelectDay={handleNextCalendarDay}
                />
              ) : null}
            </>
          }
          right={
            <BetSlipPanel
              selections={selections}
              onRemoveSelection={handleRemoveSelection}
              onClearSelections={handleClearSelections}
              onReplaceSelections={handleReplaceSlipSelections}
              activeSlip={activeSlip}
              onChangeSlip={setActiveSlip}
              onSelectionClick={handleOpenSelectionOnHome}
              slipCounts={{
                betslip1: slips.betslip1.length,
                betslip2: slips.betslip2.length,
                betslip3: slips.betslip3.length,
              }}
            />
          }
        />
      </div>
      {loading ? (
        <div
          className="pointer-events-auto fixed inset-0 z-80 flex items-center justify-center bg-black/35 backdrop-blur-md"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label="Loading"
        >
          <div className="relative flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64">
            <div className="absolute h-52 w-52 animate-pulse rounded-full bg-(--sb-accent-fill)/30 blur-3xl sm:h-56 sm:w-56" />
            <div className="absolute h-36 w-36 animate-ping rounded-full border border-(--sb-accent-fill)/55" />
            <div className="absolute h-28 w-28 animate-spin rounded-full border-2 border-transparent border-t-(--sb-accent-fill) border-r-(--sb-accent-fill)/35 sm:h-32 sm:w-32" />
            <img
              src={loadingLogo}
              alt=""
              decoding="async"
              className="relative z-10 h-[min(7.5rem,42vmin)] w-[min(7.5rem,42vmin)] object-contain drop-shadow-[0_8px_24px_rgba(0,0,0,0.45)] sm:h-[min(8.5rem,38vmin)] sm:w-[min(8.5rem,38vmin)]"
            />
          </div>
        </div>
      ) : null}
      <SiteFooter />
      <MobileBottomBar
        selections={selections}
        onRemoveSelection={handleRemoveSelection}
        onClearSelections={handleClearSelections}
        onReplaceSelections={handleReplaceSlipSelections}
        onSelectionClick={handleOpenSelectionOnHome}
        leaguesSidebarProps={topLeaguesSidebarProps}
      />
      <div className="h-16 lg:hidden" />
    </PageContainer>
  );
}

export default Home;
