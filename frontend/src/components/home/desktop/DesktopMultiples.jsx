import { useMemo, useRef, useState } from "react";
import { useSteppingCarousel } from "../../../hooks/useSteppingCarousel.js";
import { Link, useNavigate } from "react-router-dom";
import AppIcon from "../../common/AppIcon";
import { hasAuthToken } from "../../../services/api";
import { useActiveBonuses } from "../../../hooks/useActiveBonuses";
import { useTranslation } from "../../../i18n/LanguageContext.jsx";
import {
  buildMultipleOfTheDayTickets,
  ticketToSlipSelections,
} from "../../../utils/multipleOfTheDay.js";

function ticketOdds(legs) {
  return legs.reduce((acc, leg) => acc * Number(leg.value || 1), 1);
}

function formatOdds(value) {
  if (!Number.isFinite(value)) return "0.000";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function displayMatch(match) {
  return String(match || "").replace(/\s+V\s+/i, " - ");
}

function displayMarket(market) {
  return String(market || "").replace(/\s+—\s+/g, " - ");
}

function MultipleCard({ ticket, onLoadTicket }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stake, setStake] = useState("");
  const loggedIn = hasAuthToken();

  const totalOdds = useMemo(() => ticketOdds(ticket.legs), [ticket.legs]);
  const boosted = totalOdds * (1 + (ticket.bonusPercent || 0) / 100);
  const stakeNum = Number(stake);
  const possibleWin =
    Number.isFinite(stakeNum) && stakeNum > 0 ? stakeNum * boosted : 0;

  const requireAuth = (path) => {
    if (!loggedIn) {
      navigate(path);
      return false;
    }
    return true;
  };

  const loadTicket = () => {
    onLoadTicket?.(ticketToSlipSelections(ticket));
  };

  return (
    <article
      className="relative flex h-full w-full snap-start flex-col overflow-hidden rounded-[14px] border border-[#3b3731] bg-[radial-gradient(circle_at_86%_34%,rgba(89,78,45,0.42),transparent_34%),linear-gradient(110deg,#1b1919_0%,#211f1f_48%,#2a241b_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_28px_rgba(0,0,0,0.36)] lg:p-3.5"
    >
      <div className="pointer-events-none absolute -bottom-8 -right-10 h-36 w-36 rounded-full border-[16px] border-white/[0.025]" />

      {ticket.bonusPercent ? (
        <span className="absolute right-[-4px] top-3 z-10 rounded-md bg-[#ffb329] px-2 py-1 text-[11px] font-black tracking-wide text-black shadow-[0_5px_10px_rgba(0,0,0,0.25)]">
          + {ticket.bonusPercent}% {t("home.bonus")}
          <span className="absolute right-0 top-full h-0 w-0 border-l-[8px] border-t-[8px] border-l-transparent border-t-[#a86b12]" />
        </span>
      ) : null}

      <p className="m-0 border-b border-white/10 pb-2 pr-20 text-[14px] font-semibold leading-snug text-[#d8d8d8]">
        {ticket.titleKey ? t(ticket.titleKey) : ticket.title}
      </p>

      <ul className="m-0 max-h-[140px] flex-1 overflow-y-auto bg-black/20 px-0 py-2 [scrollbar-color:#8e8a83_transparent] [scrollbar-width:thin]">
        {ticket.legs.map((leg, index) => (
          <li key={leg.id} className="relative flex list-none gap-2 px-0 pb-2.5 last:pb-0">
            <span className="relative z-10 mt-0.5 flex w-5 shrink-0 justify-start pl-0">
              {index < ticket.legs.length - 1 ? (
                <span className="absolute left-[9px] top-5 bottom-[-12px] w-px bg-[#46413d]" />
              ) : null}
              <span className="relative flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black text-[#171717]">
                ⚽
              </span>
            </span>
            <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3">
              <p className="m-0 truncate text-[13px] font-semibold leading-tight text-[#cfcfcf]">
                {displayMatch(leg.match)}
              </p>
              <p className="m-0 text-right text-[12px] font-semibold leading-tight text-[#c6c2bd]">
                {leg.date}
              </p>
              <p className="m-0 mt-0.5 truncate text-[12px] font-semibold leading-tight text-[#eeeeee]">
                {displayMarket(leg.market)}
              </p>
              <p className="m-0 mt-0.5 text-right text-[14px] font-semibold leading-tight text-[#d6d3cf]">
                {leg.value}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex items-center justify-between text-[13px]">
        <span className="font-semibold text-[#b8b5b1]">
          {ticket.legs.length} {t("home.events")}
        </span>
        <span className="font-semibold text-[#c9c5c0]">
          {t("home.totalOdds")}:{" "}
          <span className="ml-1 font-black text-[#ffe81a]">
            {formatOdds(boosted)}
          </span>
        </span>
      </div>

      <input
        type="number"
        min="0"
        inputMode="decimal"
        value={stake}
        onChange={(event) => setStake(event.target.value)}
        placeholder={t("home.enterStake")}
        className="mt-2.5 h-9 w-full rounded-md border border-[#696662] bg-[#3a3636]/75 px-3 text-[13px] font-medium text-white outline-none placeholder:text-[#d4d0cb]"
      />

      <div className="mt-2 flex items-center justify-between text-[13px]">
        <span className="font-semibold text-white">{t("home.possibleWin")}:</span>
        <span className="font-black text-[#48c9b7]">
          {possibleWin.toFixed(0)} ETB
        </span>
      </div>

      {!loggedIn ? (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-md bg-[#493a16]/90 px-2.5 py-1.5 text-[12px] text-[#f4f1ea]">
          <AppIcon
            name="triangleAlert"
            size={14}
            className="shrink-0 fill-[#c79a00] text-[#c79a00]"
          />
          <p className="m-0">
            {t("home.signInToBetLead")}{" "}
            <Link
              to="/login"
              className="font-semibold text-white underline underline-offset-2"
            >
              {t("header.login")}
            </Link>{" "}
            {t("home.or")}{" "}
            <Link
              to="/register"
              className="font-semibold text-white underline underline-offset-2"
            >
              {t("header.register")}
            </Link>
          </p>
        </div>
      ) : null}

      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            if (!requireAuth("/login")) return;
            loadTicket();
          }}
          className="h-9 cursor-pointer rounded-md border-0 bg-[#49c5b6] text-[12px] font-black uppercase tracking-wide text-[#071716]"
        >
          {t("home.getBetId")}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!requireAuth("/login")) return;
            loadTicket();
          }}
          className="h-9 cursor-pointer rounded-md border-0 bg-[#343230]/90 text-[12px] font-black uppercase tracking-wide text-[#8f8b88]"
        >
          {t("home.betNow")}
        </button>
      </div>
    </article>
  );
}

function DesktopMultiples({ matches = [], onLoadTicket, onMore }) {
  const { t } = useTranslation();
  const { bonuses } = useActiveBonuses();
  const scrollerRef = useRef(null);
  const tickets = useMemo(
    () => buildMultipleOfTheDayTickets(matches, { bonuses }),
    [matches, bonuses],
  );
  const loopTickets = useMemo(
    () => (tickets.length > 1 ? [...tickets, ...tickets] : tickets),
    [tickets],
  );
  useSteppingCarousel(scrollerRef, tickets.length);

  const scrollByPage = (direction) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ left: node.clientWidth * direction, behavior: "smooth" });
  };

  return (
    <section className="mt-4 px-3 lg:mt-8 lg:px-0">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="m-0 text-[16px] font-semibold uppercase tracking-wide text-white">
          {t("home.multipleOfDay")}
        </h2>
        {onMore ? (
          <button
            type="button"
            onClick={onMore}
            className="inline-flex cursor-pointer items-center gap-0.5 border-0 bg-transparent p-0 text-[13px] text-(--sb-text-muted) hover:text-white"
          >
            {t("common.more")}
            <AppIcon name="chevronRight" size={13} />
          </button>
        ) : null}
      </div>
      {tickets.length === 0 ? (
        <p className="m-0 py-10 text-center text-[13px] text-(--sb-text-muted)">
          {t("home.noMultiples")}
        </p>
      ) : (
        <div className="relative">
          <div
            ref={scrollerRef}
            className="grid w-full snap-x snap-mandatory auto-cols-[260px] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain pb-1 sm:auto-cols-[280px] lg:auto-cols-[calc((100%-1.5rem)/3)] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {loopTickets.map((ticket, index) => (
              <div
                key={`${ticket.id}-${index}`}
                data-carousel-card
                className="h-full snap-start"
              >
                <MultipleCard ticket={ticket} onLoadTicket={onLoadTicket} />
              </div>
            ))}
          </div>
          {tickets.length > 3 ? (
            <>
              <button
                type="button"
                aria-label="Previous multiples"
                onClick={() => scrollByPage(-1)}
                className="absolute left-0 top-1/2 z-10 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-[#2a2a2a] text-white lg:inline-flex"
              >
                <AppIcon name="chevronLeft" size={16} />
              </button>
              <button
                type="button"
                aria-label="Next multiples"
                onClick={() => scrollByPage(1)}
                className="absolute right-0 top-1/2 z-10 hidden h-8 w-8 translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-[#2a2a2a] text-white lg:inline-flex"
              >
                <AppIcon name="chevronRight" size={16} />
              </button>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

export default DesktopMultiples;
