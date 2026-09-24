import { useMemo, useRef } from "react";
import { useSteppingCarousel } from "../../../hooks/useSteppingCarousel.js";
import AppIcon from "../../common/AppIcon";
import LogoImg, { LogoSlot } from "../../common/LogoImg";
import { useTranslation } from "../../../i18n/LanguageContext.jsx";
import { resolveCompactMarketToken } from "../../../utils/compactMarketToken";
import { SPORTSBOOK_TIMEZONE } from "../../../utils/sportsbookDay.js";

const COUNTRY_FLAG = Object.freeze({
  australia: "au",
  england: "gb",
  spain: "es",
  italy: "it",
  germany: "de",
  france: "fr",
  portugal: "pt",
  usa: "us",
  brazil: "br",
  japan: "jp",
  india: "in",
  poland: "pl",
  "czech republic": "cz",
  europe: "eu",
});

function countryFromLeague(league) {
  return String(league || "").split(" - ")[0]?.trim() || "";
}

function leagueName(league) {
  const parts = String(league || "").split(" - ");
  return parts[1]?.trim() || parts[0] || "";
}

function flagSrc(league) {
  const iso = COUNTRY_FLAG[countryFromLeague(league).toLowerCase()];
  return iso ? `https://flagcdn.com/w40/${iso}.png` : null;
}

function formatKickoff(kickoffAt) {
  if (!kickoffAt) return "";
  const date = new Date(kickoffAt);
  const day = date.toLocaleDateString("en-GB", {
    timeZone: SPORTSBOOK_TIMEZONE,
    day: "2-digit",
    month: "short",
  });
  const time = date.toLocaleTimeString("en-GB", {
    timeZone: SPORTSBOOK_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${time}`;
}

function marketMapOf(match) {
  return (match.markets || []).reduce((acc, market) => {
    acc[String(market.id).toLowerCase()] = market.value;
    return acc;
  }, {});
}

function DesktopSuggestedBets({
  matches = [],
  onOddsClick,
  selectedOdds,
  className = "",
}) {
  const { t } = useTranslation();
  const scrollerRef = useRef(null);
  const cards = useMemo(
    () =>
      matches.filter((match) => {
        const map = marketMapOf(match);
        return map["1"] && map.x && map["2"];
      }),
    [matches],
  );
  const loopCards = useMemo(
    () => (cards.length > 1 ? [...cards, ...cards] : cards),
    [cards],
  );
  useSteppingCarousel(scrollerRef, cards.length);

  const scrollByCard = (direction) => {
    const node = scrollerRef.current;
    if (!node) return;
    const delta = Math.max(node.clientWidth * 0.7, 280) * direction;
    node.scrollBy({ left: delta, behavior: "smooth" });
  };

  return (
    <section className={`relative mt-6 ${className}`.trim()}>
      <h2 className="m-0 mb-3 text-[16px] font-semibold text-white">
        {t("home.suggestedBets")}
      </h2>

      {cards.length === 0 ? (
        <p className="m-0 py-10 text-center text-[13px] text-(--sb-text-muted)">
          {t("home.noFeaturedGames")}
        </p>
      ) : (
        <>
          <div
            ref={scrollerRef}
            className="flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {loopCards.map((match, index) => {
              const map = marketMapOf(match);
              const flag = match.countryFlag || flagSrc(match.league);
              const selections = [
                { id: "1", label: "W1", value: map["1"] },
                { id: "x", label: "X", value: map.x },
                { id: "2", label: "W2", value: map["2"] },
              ];
              return (
                <article
                  key={`${match.id}-${index}`}
                  data-carousel-card
                  className="w-[280px] shrink-0 rounded-xl bg-(--sb-bg-card) p-3"
                >
                  <div className="mb-3 flex items-center gap-1.5 text-[12px] text-(--sb-text-muted)">
                    <AppIcon name="circleDot" size={12} />
                    {flag ? (
                      <LogoImg
                        src={flag}
                        alt=""
                        size={14}
                        rounded="rounded-[2px]"
                      />
                    ) : null}
                    <span className="min-w-0 truncate">
                      {leagueName(match.league)}
                    </span>
                  </div>

                  <div className="mb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div className="flex min-w-0 flex-col items-center gap-1.5">
                      <LogoSlot src={match.homeTeamLogo} size={28} />
                      <span className="w-full truncate text-center text-[13px] font-medium text-white">
                        {match.homeTeam}
                      </span>
                    </div>
                    <span className="shrink-0 text-[11px] font-medium text-(--sb-text-muted)">
                      {formatKickoff(match.kickoffAt)}
                    </span>
                    <div className="flex min-w-0 flex-col items-center gap-1.5">
                      <LogoSlot src={match.awayTeamLogo} size={28} />
                      <span className="w-full truncate text-center text-[13px] font-medium text-white">
                        {match.awayTeam}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {selections.map((sel) => {
                      const selectionId = `${match.match}-${sel.id.toUpperCase()}`;
                      const selected = selectedOdds?.has(selectionId);
                      return (
                        <button
                          key={sel.id}
                          type="button"
                          disabled={!sel.value}
                          onClick={() => {
                            if (!sel.value) return;
                            onOddsClick?.({
                              id: selectionId,
                              apiFixtureId: match.apiFixtureId,
                              matchName: match.match,
                              league: match.league,
                              ...resolveCompactMarketToken(sel.id),
                              value: sel.value,
                              kickoffAt: match.kickoffAt,
                              matchStatus: match.status,
                              fromLive: false,
                            });
                          }}
                          className={`flex cursor-pointer flex-col items-center rounded-md border-0 px-1 py-1.5 disabled:cursor-default ${
                            selected
                              ? "bg-(--sb-accent-fill) text-(--sb-on-accent)"
                              : "bg-(--sb-bg-0) text-(--sb-text) hover:bg-(--sb-bg-2)"
                          }`}
                        >
                          <span
                            className={`text-[11px] ${
                              selected ? "text-(--sb-on-accent)" : "text-(--sb-text-muted)"
                            }`}
                          >
                            {sel.label}
                          </span>
                          <span
                            className={`text-[14px] font-bold ${
                              selected ? "text-(--sb-on-accent)" : "text-(--sb-text)"
                            }`}
                          >
                            {sel.value ?? "-"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="Previous suggested bets"
            onClick={() => scrollByCard(-1)}
            className="absolute left-0 top-1/2 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-[#2a2a2a] text-white xl:inline-flex"
          >
            <AppIcon name="chevronLeft" size={16} />
          </button>
          <button
            type="button"
            aria-label="Next suggested bets"
            onClick={() => scrollByCard(1)}
            className="absolute right-0 top-1/2 hidden h-8 w-8 translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-[#2a2a2a] text-white xl:inline-flex"
          >
            <AppIcon name="chevronRight" size={16} />
          </button>
        </>
      )}
    </section>
  );
}

export default DesktopSuggestedBets;
