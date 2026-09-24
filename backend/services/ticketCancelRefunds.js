/**
 * Idempotent wallet credits when canceling tickets.
 *
 * Player refunds restore balance only (not withdrawable) so deposit→bet→cancel
 * cannot turn deposits into cashable funds.
 *
 * @module services/ticketCancelRefunds
 */

import {
  creditWallet,
  restoreWallet,
  walletSnapshot,
} from "../lib/walletBalance.js";

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ walletId: string, amount: number, reference: string }} params
 */
export async function creditWalletIfNotRefunded(tx, { walletId, amount, reference }) {
  if (!walletId || !reference || !(Number(amount) > 0)) {
    return null;
  }

  const existing = await tx.transaction.findFirst({
    where: { reference },
    select: { id: true },
  });
  if (existing) {
    return { skipped: true, reason: "already_refunded" };
  }

  const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) return null;

  const numericAmount = Number(amount);
  const beforeSnap = walletSnapshot(wallet);
  // Refunds are never withdrawable — prevents deposit/bet/cancel laundering.
  const credited = await creditWallet(tx, wallet, numericAmount, {
    withdrawable: false,
  });

  try {
    await tx.transaction.create({
      data: {
        wallet_id: wallet.id,
        type: "DEPOSIT",
        amount: numericAmount,
        balance_before: credited.balanceBefore,
        balance_after: credited.balanceAfter,
        reference,
      },
    });
  } catch (err) {
    if (err?.code === "P2002") {
      await restoreWallet(tx, wallet, beforeSnap);
      return { skipped: true, reason: "already_refunded_race" };
    }
    throw err;
  }

  return {
    amount: numericAmount,
    walletId: wallet.id,
    balanceAfter: credited.balanceAfter,
    walletType: wallet.wallet_type,
  };
}

/**
 * Reverse cashier `ticket-print:*` stake on cancel.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ id: string, stake?: unknown }} ticket
 */
export async function refundCashierPrintStakeInTx(tx, ticket) {
  const printTx = await tx.transaction.findFirst({
    where: { type: "BET", reference: `ticket-print:${ticket.id}` },
    select: { wallet_id: true, amount: true },
  });
  if (!printTx?.wallet_id) return null;

  const amount = Number(printTx.amount) || Number(ticket.stake) || 0;
  return creditWalletIfNotRefunded(tx, {
    walletId: printTx.wallet_id,
    amount,
    reference: `cancel-refund-cashier:${ticket.id}`,
  });
}

/**
 * Reverse online player BET on cancel (same ref as player self-cancel).
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ id: string, user_id?: string | null, stake?: unknown, receipt_number?: string | null, coupon_number?: string | null, idempotency_key?: string | null }} ticket
 */
export async function refundPlayerOnlineBetInTx(tx, ticket) {
  if (!ticket.user_id) return null;

  const refundRef = `bet-cancel:${ticket.id}`;
  const existing = await tx.transaction.findFirst({
    where: { reference: refundRef },
    select: { id: true },
  });
  if (existing) {
    return { skipped: true, reason: "already_refunded" };
  }

  const wallet = await tx.wallet.findFirst({
    where: { user_id: ticket.user_id, wallet_type: "PLAYER" },
    select: { id: true },
  });
  if (!wallet) return null;

  const refCandidates = [
    ticket.receipt_number ? `ticket:${ticket.receipt_number}` : null,
    ticket.coupon_number ? `ticket:${ticket.coupon_number}` : null,
    ticket.idempotency_key
      ? `idem:${ticket.user_id}:${ticket.idempotency_key}`
      : null,
  ].filter(Boolean);

  if (refCandidates.length === 0) return null;

  const betTx = await tx.transaction.findFirst({
    where: {
      type: "BET",
      wallet_id: wallet.id,
      reference: { in: refCandidates },
    },
    select: { amount: true },
  });
  if (!betTx) return null;

  const amount = Number(ticket.stake) || Number(betTx.amount) || 0;
  return creditWalletIfNotRefunded(tx, {
    walletId: wallet.id,
    amount,
    reference: refundRef,
  });
}

/**
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @param {{ id: string, user_id?: string | null, stake?: unknown, receipt_number?: string | null, coupon_number?: string | null, idempotency_key?: string | null }} ticket
 */
export async function refundTicketWalletsOnCancelInTx(tx, ticket) {
  const cashierRefund = await refundCashierPrintStakeInTx(tx, ticket);
  const playerRefund = await refundPlayerOnlineBetInTx(tx, ticket);
  return { cashierRefund, playerRefund };
}
