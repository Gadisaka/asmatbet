/**
 * Shop-level financial aggregates from cashier wallet transactions.
 * Matches cashier dashboard metrics (sold, paid, deposit, withdraw, grand net).
 *
 * @module services/shopReportStats
 */
import { prisma } from "../Config/db.js";

/** @param {{ selection_snapshot?: unknown }} ticket */
export function isJackpotTicket(ticket) {
  const snap = ticket.selection_snapshot;
  if (snap == null) return false;
  if (typeof snap === "object" && !Array.isArray(snap)) {
    if (snap.isJackpot === true) return true;
    if (snap.gameMode === "jackpot" || snap.type === "jackpot") return true;
    if (snap.product === "jackpot") return true;
  }
  return false;
}

export function emptyShopStats() {
  return {
    totalTicketsSold: 0,
    totalSoldPrice: 0,
    totalDepositAmount: 0,
    totalWithdrawAmount: 0,
    totalPaidTickets: 0,
    totalPaidAmount: 0,
    totalCancelledTickets: 0,
    totalCancelledAmount: 0,
    grandNet: 0,
  };
}

/**
 * Aggregate shop stats for one or more cashier wallet IDs within a date range.
 *
 * @param {string[]} walletIds
 * @param {{ start: Date, end: Date }} range
 */
export async function aggregateShopStatsForWalletIds(walletIds, { start, end }) {
  const ids = [...new Set((walletIds || []).filter(Boolean))];
  if (ids.length === 0) {
    return emptyShopStats();
  }

  const dateWhere = { gte: start, lte: end };

  const betTxs = await prisma.transaction.findMany({
    where: {
      wallet_id: { in: ids },
      type: "BET",
      reference: { startsWith: "ticket-print:" },
      created_at: dateWhere,
    },
  });

  const betTicketIds = betTxs
    .map((tx) => {
      const ref = String(tx.reference || "");
      return ref.startsWith("ticket-print:") ? ref.slice("ticket-print:".length) : null;
    })
    .filter(Boolean);

  const betTickets =
    betTicketIds.length > 0
      ? await prisma.ticket.findMany({
          where: { id: { in: betTicketIds } },
          select: { id: true, selection_snapshot: true, status: true },
        })
      : [];

  const betTicketById = new Map(betTickets.map((t) => [t.id, t]));

  const jackpotSoldIds = new Set(
    betTickets.filter((t) => isJackpotTicket(t)).map((t) => t.id),
  );

  const soldBets = betTxs.filter((tx) => {
    const ref = String(tx.reference || "");
    const tid = ref.startsWith("ticket-print:") ? ref.slice("ticket-print:".length) : "";
    if (!tid || jackpotSoldIds.has(tid)) return false;
    const ticket = betTicketById.get(tid);
    return ticket?.status !== "CANCELED";
  });

  const totalTicketsSold = soldBets.length;
  const totalSoldPrice = soldBets.reduce((s, tx) => s + Number(tx.amount), 0);

  const payoutTxs = await prisma.transaction.findMany({
    where: {
      wallet_id: { in: ids },
      type: "PAYOUT",
      reference: { startsWith: "ticket:" },
      created_at: dateWhere,
    },
  });

  const payoutTicketIds = payoutTxs
    .map((tx) => {
      const ref = String(tx.reference || "");
      return ref.startsWith("ticket:") ? ref.slice("ticket:".length) : null;
    })
    .filter(Boolean);

  const payoutTickets =
    payoutTicketIds.length > 0
      ? await prisma.ticket.findMany({
          where: { id: { in: payoutTicketIds } },
          select: { id: true, selection_snapshot: true },
        })
      : [];

  const jackpotPaidIds = new Set(
    payoutTickets.filter((t) => isJackpotTicket(t)).map((t) => t.id),
  );

  const payoutsNonJackpot = payoutTxs.filter((tx) => {
    const ref = String(tx.reference || "");
    const tid = ref.startsWith("ticket:") ? ref.slice("ticket:".length) : "";
    return tid && !jackpotPaidIds.has(tid);
  });

  const totalPaidTickets = payoutsNonJackpot.length;
  const totalPaidAmount = payoutsNonJackpot.reduce((s, tx) => s + Number(tx.amount), 0);

  const depositTxs = await prisma.transaction.findMany({
    where: {
      wallet_id: { in: ids },
      type: "WITHDRAW",
      created_at: dateWhere,
      reference: { startsWith: "cashier-deposit:" },
    },
  });
  const totalDepositAmount = depositTxs.reduce((s, tx) => s + Number(tx.amount), 0);

  const withdrawTxs = await prisma.transaction.findMany({
    where: {
      wallet_id: { in: ids },
      type: "DEPOSIT",
      created_at: dateWhere,
      reference: { startsWith: "cashier-withdraw-approve:" },
    },
  });
  const totalWithdrawAmount = withdrawTxs.reduce((s, tx) => s + Number(tx.amount), 0);

  const cancelRefundTxs = await prisma.transaction.findMany({
    where: {
      wallet_id: { in: ids },
      type: "DEPOSIT",
      reference: { startsWith: "cancel-refund-cashier:" },
      created_at: dateWhere,
    },
  });

  const totalCancelledTickets = cancelRefundTxs.length;
  const totalCancelledAmount = cancelRefundTxs.reduce(
    (s, tx) => s + Number(tx.amount),
    0,
  );

  const grandNet =
    totalSoldPrice - totalPaidAmount - totalDepositAmount + totalWithdrawAmount;

  return {
    totalTicketsSold,
    totalSoldPrice,
    totalDepositAmount,
    totalWithdrawAmount,
    totalPaidTickets,
    totalPaidAmount,
    totalCancelledTickets,
    totalCancelledAmount,
    grandNet,
  };
}
