import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppIcon from "../common/AppIcon";
import { homeCategoryTiles } from "../../data/homepageData";
import { useTranslation } from "../../i18n/LanguageContext.jsx";
import { fetchCasinoGames, fetchCasinoStatus } from "../../services/api";
import kenoThumb from "../../assets/games/keno.png";
import aviatorThumb from "../../assets/games/aviator.png";
import bingoThumb from "../../assets/games/bingo.png";

const MRX_THUMBS = {
  keno: kenoThumb,
  aviator: aviatorThumb,
  bingo: bingoThumb,
};

function TileArt({ tile, imageUrl }) {
  if (tile.kind === "brand") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_35%,rgba(143,207,74,0.22),transparent_70%)]">
        <span className="text-[15px] font-black lowercase tracking-tight text-[#8FCF4A] sm:text-[17px]">
          inout
        </span>
      </div>
    );
  }

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center text-[#3a3a3a]">
      <AppIcon name={tile.icon || "gamepad"} size={26} />
    </div>
  );
}

/**
 * Promoted quick-play tiles shown under the home hero banner.
 *
 * Tiles are declared in `homeCategoryTiles`; InOut-backed ones are reconciled
 * against the live catalog so a game disabled in admin (or the casino master
 * switch being off) removes the tile instead of leaving a dead link. Catalog
 * failures fail open on the bundled config so the row always renders.
 */
function CategoryTiles() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState(null);
  const [casinoEnabled, setCasinoEnabled] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const [status, games] = await Promise.allSettled([
        fetchCasinoStatus({ signal: ac.signal }),
        fetchCasinoGames({ signal: ac.signal }),
      ]);
      if (ac.signal.aborted) return;
      if (status.status === "fulfilled") {
        setCasinoEnabled(status.value.enabled !== false);
      }
      if (games.status === "fulfilled") {
        setCatalog(
          new Map(games.value.map((game) => [game.gameMode, game])),
        );
      }
    })();
    return () => ac.abort();
  }, []);

  const tiles = useMemo(() => {
    return homeCategoryTiles
      .map((tile) => {
        if (tile.kind === "mrx") {
          return { ...tile, imageUrl: MRX_THUMBS[tile.asset] };
        }
        if (tile.kind !== "inout" && tile.kind !== "brand") return tile;
        if (!casinoEnabled) return null;
        if (tile.kind === "brand") return tile;

        // Catalog not loaded yet: keep the tile with its bundled artwork.
        const game = catalog?.get(tile.gameMode);
        if (catalog && !game) return null;
        return {
          ...tile,
          imageUrl: game?.iconUrl || tile.iconUrl,
          path: `/casino?launch=${tile.gameMode}`,
        };
      })
      .filter(Boolean);
  }, [casinoEnabled, catalog]);

  const allTiles = useMemo(() => {
    const allGames = tiles.filter((tile) => tile.id === "allGames");
    const featured = tiles.filter((tile) => tile.id !== "allGames");
    return [...featured, ...allGames];
  }, [tiles]);

  if (allTiles.length === 0) return null;

  return (
    <section className="mb-3" aria-label={t("categories.title")}>
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {allTiles.map((tile) => {
          const label = tile.title || t(`categories.${tile.id}`);
          const to =
            tile.path ||
            (tile.launch ? `/casino?launch=${tile.launch}` : "/casino");

          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => navigate(to)}
              title={label}
              className={`group relative flex w-[86px] shrink-0 snap-start cursor-pointer flex-col items-center gap-1.5 overflow-hidden rounded-2xl border bg-[#0a0a0a] p-2 pt-3 transition-all hover:ring-1 hover:ring-[#8FCF4A]/60 sm:w-[100px] ${
                tile.pinned
                  ? "border-[#8FCF4A]"
                  : "border-(--sb-accent-border) hover:border-[#8FCF4A]/50"
              }`}
            >
              {tile.pinned ? (
                <span className="absolute left-0 top-0 flex items-center gap-0.5 rounded-br-lg bg-[#8FCF4A] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-[#000000]">
                  <AppIcon name="star" size={8} />
                  {t("categories.pinned")}
                </span>
              ) : null}

              <span className="mt-1 h-11 w-11 overflow-hidden rounded-xl sm:h-12 sm:w-12">
                <TileArt tile={tile} imageUrl={tile.imageUrl} />
              </span>

              <span className="line-clamp-2 w-full text-center text-[10px] font-semibold leading-tight text-[#f6f9ff] sm:text-[11px]">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default CategoryTiles;
