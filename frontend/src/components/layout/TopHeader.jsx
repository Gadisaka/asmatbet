import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import AppIcon from "../common/AppIcon";
import DesktopUserSidebar from "./DesktopUserSidebar";
import MobileMenu from "./MobileMenu";
import { fetchNotifications, fetchPlayerWallet } from "../../services/api";
import NotificationsDialog from "../notifications/NotificationsDialog";
import { usePlayerSiteBranding } from "../../hooks/usePlayerSiteBranding";
import { useTelegramContact } from "../../hooks/useTelegramContact";
import { useLanguage, useTranslation } from "../../i18n/LanguageContext.jsx";
import { SUPPORTED_LANGUAGES } from "../../i18n/coreTranslations.js";
import { useTheme } from "../../theme/ThemeProvider.jsx";
import PrimaryNav from "./PrimaryNav";
import { topNavItems } from "../../data/homepageData";
import cbeBankLogo from "../../assets/banks/cbe.jpg";
import cbebirrBankLogo from "../../assets/banks/cbebirr.png";
import telebirrBankLogo from "../../assets/banks/telebirr.png";

const DEPOSIT_METHOD_LOGOS = [
  { src: telebirrBankLogo, label: "Telebirr" },
  { src: cbeBankLogo, label: "CBE" },
  { src: cbebirrBankLogo, label: "CBE Birr" },
];

function DepositMethodReel() {
  const frames = [...DEPOSIT_METHOD_LOGOS, DEPOSIT_METHOD_LOGOS[0]];

  return (
    <span
      className="relative inline-block h-4 w-8 shrink-0 overflow-hidden rounded-[5px] bg-white"
      aria-hidden
    >
      <span className="deposit-method-reel flex w-full flex-col">
        {frames.map((logo, index) => (
          <span
            key={`${logo.label}-${index}`}
            className="flex h-4 w-8 shrink-0 items-center justify-center px-0.5"
          >
            <img
              src={logo.src}
              alt=""
              className="max-h-3.5 w-full object-contain"
            />
          </span>
        ))}
      </span>
    </span>
  );
}

/** Small flag assets (GB = English UI, ET = Amharic / Afaan Oromoo). */
const LANG_FLAG = Object.freeze({
  en: { code: "gb", label: "English", short: "EN", ariaKey: "header.langEnglish" },
  am: { code: "et", label: "አማርኛ", short: "አማ", ariaKey: "header.langAmharic" },
  om: { code: "et", label: "Afaan Oromoo", short: "OM", ariaKey: "header.langOromo" },
});

function flagSrc(iso2) {
  return `https://flagcdn.com/w40/${iso2}.png`;
}

function TopHeader() {
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();
  const { openPicker } = useTheme();
  const telegram = useTelegramContact();
  const { navbarWide: logoWide, navbarCompact: logoCompact } =
    usePlayerSiteBranding();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef(null);
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [, forceUpdate] = useState(0);
  const [walletBalance, setWalletBalance] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationsOpenRef = useRef(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [arrivalToast, setArrivalToast] = useState(null);
  const seenNotificationIdRef = useRef(null);
  const notificationsReadyRef = useRef(false);
  const notificationBellRef = useRef(null);
  const arrivalToastRef = useRef(null);
  const arrivalDismissRef = useRef(null);
  const [arrivalToastPos, setArrivalToastPos] = useState(null);

  const token =
    localStorage.getItem("token") || sessionStorage.getItem("token");
  const userStr =
    localStorage.getItem("user") || sessionStorage.getItem("user");
  const user = userStr ? JSON.parse(userStr) : null;
  const isLoggedIn = !!token;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!isLoggedIn) {
        setWalletBalance(null);
        return;
      }
      const wallet = await fetchPlayerWallet();
      if (!cancelled) setWalletBalance(wallet?.balance ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  const refreshUnreadCount = useCallback(async () => {
    if (!isLoggedIn) {
      notificationsReadyRef.current = false;
      seenNotificationIdRef.current = null;
      setUnreadCount(0);
      setArrivalToast(null);
      return;
    }
    try {
      const listResult = await fetchNotifications({ page: 1, limit: 50 });
      const items = Array.isArray(listResult.items) ? listResult.items : [];
      const latest = items[0] ?? null;
      setUnreadCount(items.filter((item) => !item.readAt).length);

      const isBaseline = !notificationsReadyRef.current;
      notificationsReadyRef.current = true;
      const previousId = seenNotificationIdRef.current;
      if (latest?.id) seenNotificationIdRef.current = latest.id;

      if (
        isBaseline ||
        notificationsOpenRef.current ||
        !latest ||
        latest.readAt ||
        !latest.id ||
        latest.id === previousId
      ) {
        return;
      }
      setArrivalToast(latest);
    } catch {
      setUnreadCount(0);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    const handler = () => {
      forceUpdate((n) => n + 1);
      (async () => {
        const wallet = await fetchPlayerWallet();
        setWalletBalance(wallet?.balance ?? 0);
      })();
      void refreshUnreadCount();
      window.setTimeout(() => void refreshUnreadCount(), 800);
    };
    window.addEventListener("balanceUpdated", handler);
    return () => window.removeEventListener("balanceUpdated", handler);
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!isLoggedIn) {
      setUnreadCount(0);
      return undefined;
    }
    notificationsReadyRef.current = false;
    seenNotificationIdRef.current = null;
    setArrivalToast(null);
    void refreshUnreadCount();
    const id = setInterval(() => void refreshUnreadCount(), 15_000);
    return () => clearInterval(id);
  }, [isLoggedIn, refreshUnreadCount]);

  useEffect(() => {
    notificationsOpenRef.current = notificationsOpen;
    if (notificationsOpen) setArrivalToast(null);
  }, [notificationsOpen]);

  useEffect(() => {
    if (!arrivalToast) {
      if (arrivalDismissRef.current) {
        clearTimeout(arrivalDismissRef.current);
        arrivalDismissRef.current = null;
      }
      return undefined;
    }

    arrivalDismissRef.current = setTimeout(() => {
      setArrivalToast(null);
      arrivalDismissRef.current = null;
    }, 6000);

    return () => {
      if (arrivalDismissRef.current) {
        clearTimeout(arrivalDismissRef.current);
        arrivalDismissRef.current = null;
      }
    };
  }, [arrivalToast]);

  useEffect(() => {
    if (!arrivalToast) {
      setArrivalToastPos(null);
      return undefined;
    }

    const place = () => {
      const rect = notificationBellRef.current?.getBoundingClientRect();
      if (!rect) return;
      setArrivalToastPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [arrivalToast]);

  useEffect(() => {
    if (!arrivalToast) return undefined;

    const onDocPointer = (e) => {
      const inBell = notificationBellRef.current?.contains(e.target);
      const inToast = arrivalToastRef.current?.contains(e.target);
      if (!inBell && !inToast) setArrivalToast(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setArrivalToast(null);
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [arrivalToast]);

  useEffect(() => {
    const onSession = () => forceUpdate((n) => n + 1);
    window.addEventListener("authSessionUpdated", onSession);
    return () => window.removeEventListener("authSessionUpdated", onSession);
  }, []);

  useEffect(() => {
    if (!langMenuOpen) return undefined;
    const onDocPointer = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setLangMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") setLangMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [langMenuOpen]);

  const selectLang = useCallback(
    (code) => {
      setLanguage(code);
      setLangMenuOpen(false);
    },
    [setLanguage],
  );

  const displayName = user?.name || user?.phone || user?.username || "";
  const displayBalance =
    walletBalance === null ? "—" : Number(walletBalance).toLocaleString();

  return (
    <>
      <header className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 border-b border-(--sb-border) bg-(--sb-header-bg) px-2.5 py-1.5 max-lg:gap-1.5 max-lg:px-2 sm:flex-nowrap lg:gap-3">
        <Link
          to="/"
          className="inline-flex min-w-0 max-w-[4.5rem] shrink-0 flex-col justify-center rounded bg-transparent px-1 py-1 leading-none no-underline max-sm:order-1 max-sm:mr-auto sm:max-w-[7.5rem] sm:px-1.5 lg:max-w-[11rem]"
        >
          <div className="flex h-10 max-h-[44px] w-full items-center justify-start overflow-hidden sm:h-11 lg:h-12 lg:max-h-[56px] xl:h-14 xl:max-h-[64px]">
            <picture className="flex h-full max-h-full w-full min-w-0 items-center">
              <source media="(min-width: 1024px)" srcSet={logoWide} />
              <img
                src={logoCompact}
                alt="AsmatBet"
                decoding="async"
                className="h-full w-auto max-h-full max-w-full object-contain object-left"
              />
            </picture>
          </div>
        </Link>

        <PrimaryNav items={topNavItems} />

        {isLoggedIn ? (
          <div className="relative flex min-w-0 shrink-0 items-center gap-2 text-sm text-(--sb-header-fg) max-lg:gap-1.5 max-sm:order-2">
            <div className="mr-1 flex min-w-0 max-w-[9rem] flex-col items-end leading-[1.12] max-lg:mr-0">
              <span className="truncate text-xs font-bold">{displayBalance} ETB</span>
              <small className="max-w-full truncate text-[10px] font-bold text-(--sb-header-fg)/72">
                {displayName}
              </small>
            </div>
            <Link
              to="/deposit"
              aria-label={t("header.deposit")}
              title={t("header.deposit")}
              className="inline-flex min-h-[30px] min-w-[30px] cursor-pointer items-center justify-center rounded-2xl border-0 bg-(--sb-accent-fill) px-3.5 text-xs font-bold text-(--sb-on-accent) no-underline hover:bg-(--sb-accent-fill-hover) max-lg:h-8 max-lg:min-h-0 max-lg:min-w-0 max-lg:rounded-full max-lg:px-1.5"
            >
              <span className="lg:hidden">
                <DepositMethodReel />
              </span>
              <span className="hidden items-center gap-1.5 lg:inline-flex">
                {t("header.deposit")}
                <DepositMethodReel />
              </span>
            </Link>
            <div
              ref={notificationBellRef}
              className="relative max-lg:hidden"
            >
              <button
                type="button"
                onClick={() => {
                  setArrivalToast(null);
                  setNotificationsOpen(true);
                }}
                aria-label={
                  unreadCount > 0
                    ? `${t("header.notifications")} (${unreadCount})`
                    : t("header.notifications")
                }
                aria-expanded={Boolean(arrivalToast)}
                className="relative inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-transparent text-(--sb-header-fg)/72 hover:bg-(--sb-bg-2) hover:text-(--sb-header-fg)"
              >
                <AppIcon
                  name="bell"
                  size={16}
                  className={unreadCount > 0 ? "notification-bell-ring" : ""}
                />
                {unreadCount > 0 ? (
                  <span
                    className="absolute right-0.5 top-0.5 size-2 rounded-full bg-red-500 ring-2 ring-(--sb-header-bg)"
                    aria-hidden
                  />
                ) : null}
              </button>

              {arrivalToast && !notificationsOpen && arrivalToastPos
                ? createPortal(
                    <button
                      ref={arrivalToastRef}
                      type="button"
                      onClick={() => {
                        setArrivalToast(null);
                        setNotificationsOpen(true);
                      }}
                      style={{
                        top: arrivalToastPos.top,
                        right: arrivalToastPos.right,
                      }}
                      className="fixed z-[2147483647] w-[min(calc(100vw-1rem),18rem)] cursor-pointer rounded-xl border border-white/10 bg-[#111111] px-3 py-2.5 text-left shadow-[0_12px_32px_-8px_rgba(0,0,0,0.55)]"
                    >
                      <p className="m-0 line-clamp-1 text-xs font-bold text-[#e8edf8]">
                        {arrivalToast.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[rgba(255,255,255,0.72)]">
                        {arrivalToast.body}
                      </p>
                    </button>,
                    document.body,
                  )
                : null}
            </div>

            {/* User icon - triggers menus */}
            <button
              type="button"
              onClick={() => {
                setDesktopMenuOpen((p) => !p);
                setMobileMenuOpen((p) => !p);
              }}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-(--sb-bg-2) text-(--sb-header-fg)/72"
            >
              <AppIcon name="user" size={16} />
            </button>

            {/* Desktop sidebar */}
            <DesktopUserSidebar
              open={desktopMenuOpen}
              onClose={() => setDesktopMenuOpen(false)}
            />
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2 max-sm:order-2">
            <Link
              to="/login"
              className="flex h-[30px] items-center rounded-[14px] bg-(--sb-bg-2) px-3 text-xs font-extrabold text-(--sb-header-fg) no-underline hover:opacity-90"
            >
              {t("header.login")}
            </Link>
            <Link
              to="/register"
              className="flex h-[30px] items-center rounded-[14px] border-0 bg-(--sb-accent-fill) px-3 text-xs font-extrabold text-(--sb-on-accent) no-underline hover:bg-(--sb-accent-fill-hover)"
            >
              {t("header.register")}
            </Link>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1.5 max-lg:gap-1 max-sm:order-3">
          <button
            type="button"
            onClick={openPicker}
            aria-label={t("header.theme")}
            title={t("header.theme")}
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-(--sb-bg-2) text-(--sb-header-fg) max-lg:h-7 max-lg:w-7"
          >
            <AppIcon name="palette" size={15} strokeWidth={2.2} />
          </button>
          {telegram?.link ? (
            <a
              href={telegram.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#229ED9] text-white no-underline max-lg:h-7 max-lg:w-7"
              aria-label={t("header.telegram")}
            >
              {telegram.logo ? (
                <img
                  src={telegram.logo}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <AppIcon name="send" size={15} strokeWidth={2.2} />
              )}
            </a>
          ) : null}
          <div className="relative z-20 shrink-0" ref={langMenuRef}>
            <button
              type="button"
              id="lang-menu-button"
              aria-haspopup="listbox"
              aria-expanded={langMenuOpen}
              aria-controls="lang-menu-list"
              aria-label={t("header.languageMenu")}
              onClick={() => setLangMenuOpen((o) => !o)}
              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full bg-(--sb-bg-2) py-0.5 pl-1 pr-1.5 max-lg:h-7"
              title={LANG_FLAG[language]?.label ?? ""}
            >
              <span className="inline-flex h-6 w-6 shrink-0 overflow-hidden rounded-full max-lg:h-5 max-lg:w-5">
                <img
                  src={flagSrc(LANG_FLAG[language].code)}
                  alt=""
                  width={24}
                  height={24}
                  className="h-full w-full object-cover"
                  decoding="async"
                />
              </span>
              <span className="pr-0.5 text-[10px] font-extrabold tracking-wide text-(--sb-header-fg)">
                {LANG_FLAG[language].short}
              </span>
              <AppIcon
                name="chevronDown"
                size={12}
                strokeWidth={2.4}
                className={`shrink-0 text-[rgba(255,255,255,0.72)] transition-transform ${langMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {langMenuOpen ? (
              <ul
                id="lang-menu-list"
                role="listbox"
                aria-labelledby="lang-menu-button"
                className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[5.5rem] overflow-hidden rounded-xl bg-[#111111] py-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.55)]"
              >
                {SUPPORTED_LANGUAGES.map((code) => {
                  const meta = LANG_FLAG[code];
                  const selected = language === code;
                  return (
                    <li key={code} role="none">
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={t(meta.ariaKey)}
                        onClick={() => selectLang(code)}
                        className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 transition-colors ${
                          selected
                            ? "bg-[#111111]"
                            : "hover:bg-[#111111]/90"
                        }`}
                      >
                        <span className="inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-full">
                          <img
                            src={flagSrc(meta.code)}
                            alt=""
                            width={32}
                            height={32}
                            className="h-full w-full object-cover"
                            decoding="async"
                          />
                        </span>
                        <span className="text-xs font-extrabold tracking-wide text-white">
                          {meta.short}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      {isLoggedIn && (
        <MobileMenu
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
        />
      )}

      {isLoggedIn ? (
        <NotificationsDialog
          open={notificationsOpen}
          onClose={() => {
            setNotificationsOpen(false);
            void refreshUnreadCount();
          }}
          onReadChange={() => void refreshUnreadCount()}
        />
      ) : null}
    </>
  );
}

export default TopHeader;
