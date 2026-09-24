import { useEffect, useMemo, useRef, startTransition, useState } from "react";
import Panel from "../common/Panel";
import { collectLeagueItems, getTopLeagueOrder } from "../../utils/topLeagues";
import AppIcon from "../common/AppIcon";
import LogoImg from "../common/LogoImg";
import { useTranslation } from "../../i18n/LanguageContext.jsx";
import { timeOptionDisplayLabel } from "../../i18n/coreTranslations.js";

function SelectStub({ label }) {
  return (
    <button
      type="button"
      className="flex h-8 w-full cursor-pointer items-center justify-between rounded bg-[#0a0a0a] px-2.5 text-[11px] font-semibold text-[rgba(255,255,255,0.72)]"
    >
      <span>{label}</span>
      <AppIcon name="chevronDown" size={12} />
    </button>
  );
}

const selectClassName =
  "h-8 w-full cursor-pointer rounded bg-[#0a0a0a] px-2 text-[11px] font-semibold text-[#ffffff] outline-none";

function isCalendarDayTimeId(id) {
  return (
    id === "today" || id === "tomorrow" || /^day\d+$/i.test(String(id || ""))
  );
}

const REGION_ICONS = {
  international: "globe",
  europe: "flag",
  asia: "flag",
  america: "flag",
  africa: "flag",
};

function NameWithCount({ name, count }) {
  const n = Number(count);
  const show = Number.isFinite(n) && n > 0;
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="truncate">{name}</span>
      {show ? (
        <span className="shrink-0 font-normal text-[#8b95b2]">({n})</span>
      ) : null}
    </span>
  );
}

function groupComingCount(group) {
  if (Number.isFinite(group?.matchCount)) return group.matchCount;
  return (group?.leagues || []).reduce((sum, league) => sum + (league.count || 0), 0);
}

function TopLeaguesSidebar({
  regionGroups = [],
  countryGroups = [],
  catalogItems = [],
  allLeaguesId = "all-leagues",
  totalLeagueCount,
  selectedLeagueId,
  onSelectLeague,
  selectedTimeId,
  onTimeChange,
  timeOptions = [],
  dateDropdownOptions = [],
  searchQuery = "",
  onSearchChange,
  panelClassName = "",
  /** When true, only “All leagues” and the league list (no search / time / date UI). */
  leaguesListOnly = false,
}) {
  const { t } = useTranslation();
  const [expandedSections, setExpandedSections] = useState(() => new Set());
  const searchRef = useRef(null);

  const { topLeagueItems, topIdsSet } = useMemo(() => {
    const allItems = collectLeagueItems(regionGroups, countryGroups);
    const countById = new Map(allItems.map((item) => [item.id, item.count]));

    const hasApiSections = catalogItems.some((item) => item.section === "top");
    if (hasApiSections) {
      const tops = catalogItems
        .filter((item) => item.section === "top")
        .map((item) => {
          const id = String(item.id || "").trim();
          const sep = id.indexOf(" - ");
          const labelFromId = sep === -1 ? id : id.slice(sep + 3);
          return {
            id,
            label: String(item.label || "").trim() || labelFromId,
            count:
              countById.get(id) ||
              (Number.isFinite(Number(item.count)) ? Number(item.count) : 0),
            leagueLogo: item.leagueLogo ?? null,
            countryFlag: item.countryFlag ?? null,
            rank: Number(item.rank) || 9999,
          };
        })
        .sort(
          (a, b) =>
            a.rank - b.rank || String(a.label).localeCompare(String(b.label)),
        );
      return {
        topLeagueItems: tops,
        topIdsSet: new Set(tops.map((l) => l.id)),
      };
    }

    const tops = allItems
      .map((item) => ({ item, order: getTopLeagueOrder(item.id) }))
      .filter((x) => x.order !== null)
      .sort(
        (a, b) =>
          a.order - b.order ||
          String(a.item.label).localeCompare(String(b.item.label)),
      );
    const ordered = tops.map((x) => x.item);
    return {
      topLeagueItems: ordered,
      topIdsSet: new Set(ordered.map((l) => l.id)),
    };
  }, [catalogItems, regionGroups, countryGroups]);

  const expandedInitializedRef = useRef(false);

  useEffect(() => {
    if (expandedInitializedRef.current) return;
    const keys = new Set();
    for (const g of regionGroups) {
      if (g.leagues.some((l) => !topIdsSet.has(l.id))) keys.add(g.region);
    }
    if (keys.size === 0) return;
    setExpandedSections((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
    expandedInitializedRef.current = true;
  }, [regionGroups, countryGroups, topIdsSet]);

  const todayOption = leaguesListOnly
    ? null
    : timeOptions.find((item) => item.id === "today") || timeOptions[0];
  const tomorrowOption = leaguesListOnly
    ? null
    : timeOptions.find((item) => item.id === "tomorrow") ||
      timeOptions.find((item) => item.id !== todayOption?.id);

  const dateSelectValue = (() => {
    if (leaguesListOnly) return "";
    if (!dateDropdownOptions.length) return "";
    if (isCalendarDayTimeId(selectedTimeId)) {
      const found = dateDropdownOptions.some((o) => o.id === selectedTimeId);
      return found ? selectedTimeId : "";
    }
    return "";
  })();

  useEffect(() => {
    if (selectedLeagueId === allLeaguesId || !selectedLeagueId) return;

    for (const rg of regionGroups) {
      if (rg.leagues.some((l) => l.id === selectedLeagueId)) {
        startTransition(() => {
          setExpandedSections((prev) => {
            if (prev.has(rg.region)) return prev;
            const next = new Set(prev);
            next.add(rg.region);
            return next;
          });
        });
        return;
      }
    }

    for (const cg of countryGroups) {
      if (cg.leagues.some((l) => l.id === selectedLeagueId)) {
        startTransition(() => {
          setExpandedSections((prev) => {
            if (prev.has(cg.country)) return prev;
            const next = new Set(prev);
            next.add(cg.country);
            return next;
          });
        });
        return;
      }
    }
  }, [allLeaguesId, countryGroups, regionGroups, selectedLeagueId]);

  const toggleSection = (key) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Panel
      className={`flex flex-col gap-2 overflow-hidden p-2 lg:max-h-[calc(95vh-60px)] ${panelClassName}`.trim()}
    >
      {!leaguesListOnly ? (
        <>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="flex h-8 items-center rounded bg-[#0a0a0a] px-2.5">
              <AppIcon
                name="search"
                size={12}
                className="mr-1.5 shrink-0 text-[#5b6a8f]"
              />
              <input
                ref={searchRef}
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange?.(e.target.value)}
                placeholder={t("sidebar.searchClubsPlaceholder")}
                className="min-w-0 flex-1 border-0 bg-transparent text-[11px] font-semibold text-[#dce2f0] placeholder:text-[#5b6a8f] outline-none"
                aria-label={t("sidebar.searchClubsAria")}
              />
            </div>
            <button
              type="button"
              className="h-8 shrink-0 rounded border-0 bg-(--sb-accent-fill) px-2 text-[10px] font-bold uppercase tracking-wide text-(--sb-on-accent) transition-colors hover:bg-(--sb-accent-fill-hover) active:brightness-95"
              onClick={() => searchRef.current?.focus()}
            >
              {t("sidebar.searchButton")}
            </button>
          </div>

          {/* <SelectStub label="View" /> */}

          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => todayOption?.id && onTimeChange?.(todayOption.id)}
              className={`h-7 cursor-pointer rounded border text-[11px] font-bold ${
                selectedTimeId === todayOption?.id
                  ? "border-transparent bg-(--sb-accent-fill) text-(--sb-on-accent)"
                  : "border-transparent bg-[#111111] text-[rgba(255,255,255,0.72)]"
              }`}
            >
              {timeOptionDisplayLabel(todayOption, t) || t("time.today")}
            </button>
            <button
              type="button"
              onClick={() =>
                tomorrowOption?.id && onTimeChange?.(tomorrowOption.id)
              }
              className={`h-7 cursor-pointer rounded border text-[11px] font-bold ${
                selectedTimeId === tomorrowOption?.id
                  ? "border-transparent bg-(--sb-accent-fill) text-(--sb-on-accent)"
                  : "border-transparent bg-[#111111] text-[rgba(255,255,255,0.72)]"
              }`}
            >
              {timeOptionDisplayLabel(tomorrowOption, t) || t("time.tomorrow")}
            </button>
          </div>

          <label className="block text-[10px] font-bold uppercase tracking-wide text-(--sb-text)">
            {t("sidebar.filterByTime")}
            <select
              className={`${selectClassName} mt-0.5`}
              value={selectedTimeId}
              onChange={(e) => onTimeChange?.(e.target.value)}
            >
              {timeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {timeOptionDisplayLabel(opt, t)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[10px] font-bold uppercase tracking-wide text-(--sb-text)">
            {t("sidebar.dateWithGames")}
            <select
              className={`${selectClassName} mt-0.5`}
              value={dateSelectValue}
              disabled={dateDropdownOptions.length === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (v) onTimeChange?.(v);
              }}
            >
              <option value="">
                {dateDropdownOptions.length === 0
                  ? t("sidebar.noFixtures")
                  : t("sidebar.selectDay")}
              </option>
              {dateDropdownOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {timeOptionDisplayLabel(o, t)} ({o.count})
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => onSelectLeague?.(allLeaguesId)}
        className={`flex w-full cursor-pointer items-center justify-between border-b border-white/8 pb-1 text-left text-[11px] font-bold uppercase tracking-wide ${
          selectedLeagueId === allLeaguesId
            ? "text-(--sb-accent-text-on-dark)"
            : "text-(--sb-text) hover:text-(--sb-text)"
        }`}
      >
        <span>All Leagues</span>
        <span className="text-(--sb-text-muted)">{totalLeagueCount ?? 0}</span>
      </button>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
        {topLeagueItems.length > 0 ? (
          <>
            <div className="flex items-center gap-2 px-1 pt-0.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-(--sb-text)">
              <AppIcon name="trophy" size={10} />
              <span>Top leagues</span>
            </div>
            {topLeagueItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectLeague?.(item.id)}
                className={`flex w-full cursor-pointer items-center justify-between gap-1.5 rounded bg-[#0a0a0a] px-2 py-1.5 text-left text-[10px] font-semibold ${
                  item.id === selectedLeagueId
                    ? "bg-(--sb-accent-fill) text-(--sb-on-accent)"
                    : "text-[rgba(255,255,255,0.72)] hover:bg-[#111111]"
                }`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {item.leagueLogo ? (
                    <LogoImg
                      src={item.leagueLogo}
                      alt=""
                      size={16}
                      className="border border-transparent bg-[#000000]"
                    />
                  ) : (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-transparent bg-[#000000]">
                      <AppIcon
                        name="circleDot"
                        size={8}
                        className="text-[#5b6a8f]"
                      />
                    </span>
                  )}
                  <NameWithCount name={item.label} count={item.count} />
                </span>
              </button>
            ))}
          </>
        ) : null}

        {regionGroups.map((group) => {
          const leagues = group.leagues.filter((l) => !topIdsSet.has(l.id));
          if (leagues.length === 0) return null;
          const groupMatchCount = groupComingCount(group);
          const open = expandedSections.has(group.region);
          const icon = REGION_ICONS[group.region] || "globe";
          return (
            <div
              key={group.region}
              className="rounded border border-transparent bg-[#000000]"
            >
              <button
                type="button"
                onClick={() => toggleSection(group.region)}
                className="flex w-full cursor-pointer items-center justify-between px-2 py-1.5 text-left text-[11px] font-semibold text-[#ffffff] hover:bg-[#0f1930]"
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <AppIcon
                    name={open ? "chevronDown" : "chevronRight"}
                    size={11}
                    className="shrink-0 text-[#5b6a8f]"
                  />
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border border-transparent bg-[#000000]">
                    <AppIcon
                      name={icon}
                      size={10}
                      className="text-(--sb-accent)"
                    />
                  </span>
                  <NameWithCount name={group.label} count={groupMatchCount} />
                </span>
              </button>
              {open ? (
                <div className="border-t border-white/8 px-1 pb-1 pt-0.5">
                  {leagues.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectLeague?.(item.id)}
                      className={`flex w-full cursor-pointer items-center justify-between gap-1.5 rounded px-2 py-1 text-left text-[10px] font-semibold ${
                        item.id === selectedLeagueId
                          ? "border border-(--sb-accent-border) bg-(--sb-accent-surface) text-(--sb-accent-text-on-dark)"
                          : "border border-transparent text-[rgba(255,255,255,0.72)] hover:bg-[#0f1930]"
                      }`}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        {item.leagueLogo ? (
                          <LogoImg
                            src={item.leagueLogo}
                            alt=""
                            size={16}
                            className="border border-transparent bg-[#000000]"
                          />
                        ) : (
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-transparent bg-[#000000]">
                            <AppIcon
                              name="circleDot"
                              size={8}
                              className="text-[#5b6a8f]"
                            />
                          </span>
                        )}
                        <NameWithCount name={item.label} count={item.count} />
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {countryGroups.some((g) =>
          g.leagues.some((l) => !topIdsSet.has(l.id)),
        ) ? (
          <>
            <div className="flex items-center gap-2 px-1 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-(--sb-text)">
              <AppIcon name="flag" size={10} />
              <span>Countries</span>
            </div>

            {countryGroups.map((group) => {
              const leagues = group.leagues.filter((l) => !topIdsSet.has(l.id));
              if (leagues.length === 0) return null;
              const groupMatchCount = groupComingCount(group);
              const open = expandedSections.has(group.country);
              return (
                <div
                  key={group.country}
                  className="rounded border border-transparent bg-[#000000]"
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(group.country)}
                    className="flex w-full cursor-pointer items-center justify-between px-2 py-1.5 text-left text-[11px] font-semibold text-[#ffffff] hover:bg-[#0f1930]"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <AppIcon
                        name={open ? "chevronDown" : "chevronRight"}
                        size={11}
                        className="shrink-0 text-[#5b6a8f]"
                      />
                      {group.countryFlag ? (
                        <LogoImg
                          src={group.countryFlag}
                          alt=""
                          size={16}
                          className="border border-transparent bg-[#000000]"
                          rounded="rounded-[2px]"
                        />
                      ) : (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] border border-transparent bg-[#000000]">
                          <AppIcon
                            name="flag"
                            size={10}
                            className="text-[#5b6a8f]"
                          />
                        </span>
                      )}
                      <NameWithCount name={group.country} count={groupMatchCount} />
                    </span>
                  </button>
                  {open ? (
                    <div className="border-t border-white/8 px-1 pb-1 pt-0.5">
                      {leagues.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelectLeague?.(item.id)}
                          className={`flex w-full cursor-pointer items-center justify-between gap-1.5 rounded px-2 py-1 text-left text-[10px] font-semibold ${
                            item.id === selectedLeagueId
                              ? "border border-(--sb-accent-border) bg-(--sb-accent-surface) text-(--sb-accent-text-on-dark)"
                              : "border border-transparent text-[rgba(255,255,255,0.72)] hover:bg-[#0f1930]"
                          }`}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            {item.leagueLogo ? (
                              <LogoImg
                                src={item.leagueLogo}
                                alt=""
                                size={16}
                                className="border border-transparent bg-[#000000]"
                              />
                            ) : (
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-transparent bg-[#000000]">
                                <AppIcon
                                  name="circleDot"
                                  size={8}
                                  className="text-[#5b6a8f]"
                                />
                              </span>
                            )}
                            <NameWithCount name={item.label} count={item.count} />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </>
        ) : null}
      </div>
    </Panel>
  );
}

export default TopLeaguesSidebar;
