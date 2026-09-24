import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppIcon from "../common/AppIcon";
import MobileBetSlip from "../sections/MobileBetSlip";
import MobileLeaguesSheet from "../sections/MobileLeaguesSheet";
import MobileMenu from "./MobileMenu";
import { usePlatformSettings } from "../../hooks/usePlatformSettings";
import { coerceStakeDisplayToLimits } from "../../utils/stakeLimits";
import { useTranslation } from "../../i18n/LanguageContext.jsx";

const navItems = [
  { id: "leagues", icon: "trophy" },
  { id: "live", icon: "radio" },
  { id: "menu", icon: "menu" },
  { id: "slip", icon: "ticket" },
  { id: "games", icon: "gamepad" },
];

function MobileBottomBar({
  selections = [],
  onRemoveSelection = () => {},
  onClearSelections = () => {},
  onReplaceSelections = () => {},
  onSelectionClick,
  leaguesSidebarProps = null,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [slipOpen, setSlipOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaguesOpen, setLeaguesOpen] = useState(false);
  const [stakeInput, setStakeInput] = useState("20");
  const { limits, winningsTax } = usePlatformSettings();

  useEffect(() => {
    if (!limits) return;
    setStakeInput((prev) => coerceStakeDisplayToLimits(prev, limits));
  }, [limits?.MIN_BET_AMOUNT, limits?.MAX_BET_AMOUNT]);

  const mobileLeaguesSidebarProps = useMemo(() => {
    if (!leaguesSidebarProps) return null;
    const { onSelectLeague } = leaguesSidebarProps;
    return {
      ...leaguesSidebarProps,
      onSelectLeague: (id) => {
        onSelectLeague?.(id);
        setLeaguesOpen(false);
      },
    };
  }, [leaguesSidebarProps, setLeaguesOpen]);

  const safeSelections = Array.isArray(selections) ? selections : [];
  const selectionCount = safeSelections.length;

  const [, bumpAuth] = useState(0);
  useEffect(() => {
    const onSession = () => bumpAuth((n) => n + 1);
    window.addEventListener("authSessionUpdated", onSession);
    return () => window.removeEventListener("authSessionUpdated", onSession);
  }, []);

  const token =
    localStorage.getItem("token") || sessionStorage.getItem("token");
  const isLoggedIn = !!token;

  const visibleNavItems = useMemo(
    () =>
      isLoggedIn
        ? navItems
        : navItems.filter((item) => item.id !== "menu"),
    [isLoggedIn],
  );

  const defaultSelectionClick = useCallback(
    (sel) => {
      if (sel?.apiFixtureId == null) return;
      setSlipOpen(false);
      navigate("/", {
        state: {
          openFixtureId: sel.apiFixtureId,
          kickoffAt: sel.kickoffAt ?? null,
        },
      });
    },
    [navigate],
  );

  const handleSelectionClick = onSelectionClick ?? defaultSelectionClick;

  const bottomNav = (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex items-stretch justify-around border-t border-(--sb-border) bg-(--sb-header-bg) lg:hidden">
      {visibleNavItems.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={
            item.id === "slip"
              ? `${t("mobileBar.slip")}${selectionCount > 0 ? `, ${selectionCount} selections` : ""}`
              : undefined
          }
          onClick={() => {
            if (item.id === "menu") setMenuOpen(true);
            if (item.id === "live") navigate("/live");
            if (item.id === "games") navigate("/casino");
            if (item.id === "slip") setSlipOpen(true);
            if (item.id === "leagues") {
              if (leaguesSidebarProps) setLeaguesOpen(true);
              else navigate("/");
            }
          }}
          className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 border-0 bg-transparent py-2.5 text-[10px] font-bold text-(--sb-header-fg) ${
            item.id === "menu" ? "relative -mt-8 rounded-full" : ""
          }`}
        >
          {item.id === "menu" ? (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-(--sb-accent-fill) text-(--sb-on-accent)">
              <AppIcon name={item.icon} size={22} strokeWidth={2.5} />
            </span>
          ) : (
            <span className="relative inline-flex">
              <AppIcon
                name={item.icon}
                size={20}
                strokeWidth={1.8}
                className="text-(--sb-header-fg)"
              />
              {item.id === "slip" && selectionCount > 0 ? (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-(--sb-accent-fill) px-1 text-[9px] font-extrabold leading-none text-(--sb-on-accent)">
                  {selectionCount > 99 ? "99+" : selectionCount}
                </span>
              ) : null}
            </span>
          )}
          <span>{t(`mobileBar.${item.id}`)}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <>
      <MobileBetSlip
        open={slipOpen}
        onClose={() => setSlipOpen(false)}
        selections={safeSelections}
        onRemoveSelection={onRemoveSelection}
        onClearSelections={onClearSelections}
        onReplaceSelections={onReplaceSelections}
        onSelectionClick={handleSelectionClick}
        stakeInput={stakeInput}
        onStakeInputChange={setStakeInput}
        limits={limits}
        winningsTax={winningsTax}
      />
      <MobileLeaguesSheet
        open={leaguesOpen}
        onClose={() => setLeaguesOpen(false)}
        sidebarProps={mobileLeaguesSidebarProps}
      />
      {isLoggedIn && (
        <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      )}
      {bottomNav}
      <div className="h-16 lg:hidden" />
    </>
  );
}

export default MobileBottomBar;
