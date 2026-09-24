import AppIcon from "../common/AppIcon";
import LogoImg from "../common/LogoImg";

import { useTranslation } from "../../i18n/LanguageContext.jsx";
import { timeOptionDisplayLabel } from "../../i18n/coreTranslations.js";

const chipScrollClass =
  "flex min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

function MatchesTabs({
  times = [],
  leagues = [],
  selectedTimeId,
  selectedLeagueId,
  onTimeChange,
  onLeagueChange,
  searchQuery = "",
  onSearchChange,
}) {
  const { t } = useTranslation();

  return (
    <section className="sb-card animate-deposit-panel overflow-hidden rounded-[1.15rem] backdrop-blur-sm">
      <div className="border-b border-white/8 px-2 py-1.5">
        <div className={`${chipScrollClass} text-[11px] font-bold md:gap-1.5 md:text-[10px]`}>
          {times.map((time) => (
            <button
              key={time.id}
              type="button"
              onClick={() => onTimeChange?.(time.id)}
              className={`h-8 min-h-[32px] shrink-0 cursor-pointer rounded-xl border px-3 transition-all duration-200 md:h-6 md:min-h-0 md:px-2.5 ${
                time.id === selectedTimeId
                  ? "border-transparent bg-(--sb-accent-fill) text-(--sb-on-accent)"
                  : "border-transparent bg-(--sb-bg-page) text-(--sb-text-muted) hover:bg-(--sb-bg-card-elevated)"
              }`}
            >
              {timeOptionDisplayLabel(time, t)}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-white/8 px-2 py-1.5">
        <div className={`${chipScrollClass} text-[10px] font-semibold`}>
          {leagues.map((league) => (
            <button
              key={league.id}
              type="button"
              onClick={() => onLeagueChange?.(league.id)}
              className={`flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-xl border px-2.5 transition-all duration-200 ${
                league.id === selectedLeagueId
                  ? "border-transparent bg-(--sb-accent-fill) text-(--sb-on-accent)"
                  : "border-transparent bg-(--sb-bg-page) text-(--sb-text-muted) hover:bg-(--sb-bg-card-elevated)"
              }`}
            >
              {league.countryFlag ? (
                <LogoImg src={league.countryFlag} alt="" size={14} rounded="rounded-[2px]" />
              ) : null}
              {league.logo ? (
                <LogoImg src={league.logo} alt="" size={14} className="max-h-[14px]" />
              ) : null}
              <span className="truncate">{league.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-2">
        <div className="flex h-9 items-center rounded-2xl bg-(--sb-bg-page) px-3 text-(--sb-text-muted) shadow-inner shadow-black/20">
          <AppIcon name="search" size={13} className="mr-2 shrink-0" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder={t("sidebar.searchClubsPlaceholder")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[12px] font-semibold text-(--sb-text) placeholder:text-(--sb-text-muted) outline-none"
            aria-label={t("sidebar.searchClubsAria")}
          />
          {searchQuery ? (
            <button
              type="button"
              className="ml-1 shrink-0 text-[10px] font-bold uppercase text-(--sb-accent)"
              onClick={() => onSearchChange?.("")}
            >
              {t("common.clear")}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default MatchesTabs;
