import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer";
import SiteFooter from "../components/layout/SiteFooter";
import TopHeader from "../components/layout/TopHeader";
import MobileBottomBar from "../components/layout/MobileBottomBar";
import AppIcon from "../components/common/AppIcon";
import GameFrame from "../components/casino/GameFrame";
import { topHeaderData } from "../data/homepageData";
import { useTranslation } from "../i18n/LanguageContext.jsx";
import {
  fetchCasinoGames,
  fetchCasinoStatus,
  fetchInoutLaunchUrl,
  generateMrxSsoToken,
  hasAuthToken,
} from "../services/api";
import {
  findMockInoutGame,
  MOCK_GAMES_ENABLED,
  MOCK_INOUT_GAMES,
} from "../data/mockGames.js";
import kenoThumb from "../assets/games/keno.png";
import aviatorThumb from "../assets/games/aviator.png";
import bingoThumb from "../assets/games/bingo.png";

const GAME_BASE_URL =
  import.meta.env.VITE_GAME_BASE_URL || "https://games.asmatbet.com";

const MRX_GAMES = [
  {
    id: "keno",
    nameKey: "casino.kenoName",
    iconUrl: kenoThumb,
    ssoTarget: GAME_BASE_URL,
    path: "/game/keno",
  },
  {
    id: "bingo",
    nameKey: "casino.bingoName",
    iconUrl: bingoThumb,
    ssoTarget: GAME_BASE_URL,
    path: "/game/bingo",
  },
  {
    id: "aviator",
    nameKey: "casino.aviatorName",
    iconUrl: aviatorThumb,
    ssoTarget: GAME_BASE_URL,
    path: "/game/aviator",
  },
];

/** InOut gameModes launched from the top nav / home tiles (no catalog wait). */
const NAV_INOUT_LAUNCHES = {
  "chicken-road-two-bonus": { title: "Chicken Road 2" },
  "chicken-coin": { title: "Chicken Coin" },
  megablock: { title: "Mega Block" },
};

function GameCard({ game, onPlay, launching = false, size = "lg" }) {
  const aspect =
    size === "sm"
      ? "aspect-square"
      : size === "md"
        ? "aspect-[4/5]"
        : "aspect-[3/4]";
  const titleClass =
    size === "lg"
      ? "truncate text-[12px] font-semibold text-[#f6f9ff]"
      : "truncate text-[11px] font-semibold text-[#f6f9ff] sm:text-[12px]";
  return (
    <button
      type="button"
      disabled={launching}
      onClick={() => onPlay(game)}
      className={`relative ${aspect} w-full cursor-pointer overflow-hidden rounded-2xl border border-(--sb-accent-border) bg-[#0a0a0a] p-0 text-left transition-all hover:ring-1 hover:ring-(--sb-accent-fill)/60 disabled:cursor-wait disabled:opacity-70`}
    >
      {game.iconUrl ? (
        <img
          src={game.iconUrl}
          alt={game.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[#3a3a3a]">
          <AppIcon name="gamepad" size={40} />
        </div>
      )}

      {launching ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2 pb-2 pt-8">
        <h3 className={titleClass}>{game.title}</h3>
      </div>
    </button>
  );
}

function Casino() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const launchId = searchParams.get("launch");
  const handledLaunchRef = useRef(null);

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // null = still checking; false = InOut lobby off (Instant Games still shown).
  const [casinoEnabled, setCasinoEnabled] = useState(null);

  const [frame, setFrame] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [mrxLaunching, setMrxLaunching] = useState(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchCasinoStatus({ signal: ac.signal })
      .then((s) => setCasinoEnabled(s.enabled))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setCasinoEnabled(true);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (casinoEnabled !== true) {
      setLoading(false);
      setGames([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    fetchCasinoGames({ signal: ac.signal })
      .then((list) => {
        setGames(list);
        setError(null);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err.message || "Failed to load games");
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [casinoEnabled]);

  const clearLaunchParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("launch");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const handleMrxPlay = useCallback(
    async (game) => {
      setError(null);
      if (!hasAuthToken()) {
        navigate("/login");
        return;
      }
      if (mrxLaunching) return;
      setMrxLaunching(game.id);
      try {
        const ssoToken = await generateMrxSsoToken();
        const targetUrl = new URL(game.path || "/", game.ssoTarget);
        targetUrl.searchParams.set("sso_token", ssoToken);
        window.location.assign(targetUrl.toString());
      } catch (err) {
        if (err.message === "NOT_LOGGED_IN") {
          navigate("/login");
          return;
        }
        setError(err.message || "Could not launch game. Please try again.");
      } finally {
        setMrxLaunching(null);
      }
    },
    [mrxLaunching, navigate],
  );

  const handlePlay = useCallback(
    async (game) => {
      if (game?.mock) {
        setFrame({ title: game.title, poster: game.iconUrl });
        return;
      }
      if (!hasAuthToken()) {
        navigate("/login");
        return;
      }
      if (launching) return;
      setLaunching(true);
      try {
        const url = await fetchInoutLaunchUrl(game.gameMode, { lang: language });
        setFrame({ url, title: game.title });
      } catch (err) {
        setError(err.message || "Failed to launch game");
      } finally {
        setLaunching(false);
      }
    },
    [launching, language, navigate],
  );

  // Deep links (`/casino?launch=<id>`) come from the top nav and the home tiles.
  // MRX ids resolve from the static list; anything else is matched against the
  // synced InOut catalog, so promoting a new game needs no frontend change.
  useEffect(() => {
    if (!launchId) {
      handledLaunchRef.current = null;
      return;
    }
    if (handledLaunchRef.current === launchId) return;

    const mrxGame = MRX_GAMES.find((g) => g.id === launchId);
    if (mrxGame) {
      handledLaunchRef.current = launchId;
      clearLaunchParam();
      handleMrxPlay(mrxGame);
      return;
    }

    const mockInout = findMockInoutGame(launchId);
    if (mockInout) {
      handledLaunchRef.current = launchId;
      clearLaunchParam();
      setFrame({ title: mockInout.title, poster: mockInout.iconUrl });
      return;
    }

    // Promoted InOut tiles/nav items launch immediately — same gameMode the
    // provider expects, without waiting on catalog reconciliation.
    const navInout = NAV_INOUT_LAUNCHES[launchId];
    if (navInout) {
      handledLaunchRef.current = launchId;
      clearLaunchParam();
      handlePlay({ gameMode: launchId, title: navInout.title });
      return;
    }

    // Wait until casino status (and catalog, when enabled) have settled —
    // otherwise we clear ?launch= against an empty games list and never retry.
    if (casinoEnabled === null) return;
    if (casinoEnabled === true && loading) return;

    const inoutGame =
      casinoEnabled === true
        ? games.find((g) => g.gameMode === launchId)
        : null;
    handledLaunchRef.current = launchId;
    clearLaunchParam();
    if (inoutGame) handlePlay(inoutGame);
  }, [
    launchId,
    casinoEnabled,
    loading,
    games,
    clearLaunchParam,
    handleMrxPlay,
    handlePlay,
  ]);

  const inoutGames = useMemo(() => {
    const live = casinoEnabled === true ? games : [];
    if (!MOCK_GAMES_ENABLED) return live;
    const seen = new Set(live.map((game) => game.gameMode));
    return [
      ...live,
      ...MOCK_INOUT_GAMES.filter((game) => !seen.has(game.gameMode)),
    ];
  }, [casinoEnabled, games]);

  const showInout = casinoEnabled === true || MOCK_GAMES_ENABLED;

  return (
    <PageContainer>
      <div className="sticky top-0 z-50">
        <TopHeader data={topHeaderData} />
      </div>

      <div className="mx-auto w-full max-w-6xl px-2 pt-2 sm:px-3">
        {error ? (
          <div className="mx-1 mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="animate-deposit-panel px-1 pt-1">
          <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
            {t("casino.instantEyebrow")}
          </p>
          <h1 className="m-0 bg-gradient-to-r from-[#ffffff] via-[#d4f5a8] to-[#ffffff] bg-clip-text text-xl font-black tracking-tight text-transparent sm:text-2xl">
            {t("casino.instantTitle")}
          </h1>
        </div>

        <div className="mt-3 grid max-w-3xl grid-cols-3 gap-2.5 pb-4">
          {MRX_GAMES.map((game) => (
            <GameCard
              key={game.id}
              game={{ ...game, title: t(game.nameKey) }}
              launching={mrxLaunching === game.id}
              onPlay={handleMrxPlay}
              size="md"
            />
          ))}
        </div>

        {showInout ? (
          <>
            <div className="animate-deposit-panel px-1 pt-2">
              <div className="flex items-center gap-2">
                <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.2em] text-[rgba(255,255,255,0.72)]">
                  {t("casino.inoutEyebrow")}
                </p>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#8FCF4A] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-[#000000]">
                  <AppIcon name="star" size={9} />
                  {t("categories.pinned")}
                </span>
              </div>
              <h2 className="m-0 bg-gradient-to-r from-[#ffffff] via-[#d4f5a8] to-[#ffffff] bg-clip-text text-lg font-black tracking-tight text-transparent sm:text-xl">
                {t("casino.inoutTitle")}
              </h2>
            </div>

            {loading && inoutGames.length === 0 ? (
              <div className="flex items-center justify-center px-4 py-12 text-[rgba(255,255,255,0.72)]">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#8FCF4A] border-t-transparent" />
                <span className="ml-3 text-sm font-semibold">
                  {t("casino.loading")}
                </span>
              </div>
            ) : inoutGames.length === 0 ? (
              <div className="mx-1 mb-3 mt-3 rounded-[1.25rem] bg-gradient-to-br from-[#111111]/88 to-[#000000]/92 px-4 py-14 text-center">
                <p className="m-0 text-sm font-medium text-[rgba(255,255,255,0.72)]">
                  {t("casino.empty")}
                </p>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 pb-6 md:grid-cols-3 lg:grid-cols-4">
                {inoutGames.map((game) => (
                  <GameCard
                    key={game.gameMode}
                    game={game}
                    onPlay={handlePlay}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      <SiteFooter />
      <MobileBottomBar />
      <div className="h-16 lg:hidden" />

      {frame ? (
        <GameFrame
          url={frame.url}
          poster={frame.poster}
          title={frame.title}
          onClose={() => setFrame(null)}
        />
      ) : null}
    </PageContainer>
  );
}

export default Casino;
