/**
 * Cashier dashboard aggregates — date range, scoped to logged-in cashier.
 * Jackpot-style tickets are excluded when `selection_snapshot` marks them (no jackpot model yet).
 *
 * @module controllers/cashierDashboardController
 */
import { prisma } from "../Config/db.js";
import { aggregateShopStatsForWalletIds } from "../services/shopReportStats.js";

function parseDateOnlyStart(value) {
  if (!value || typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseDateOnlyEnd(value) {
  if (!value || typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function resolveCashierByUserId(userId) {
  if (!userId) return null;
  return prisma.cashier.findUnique({
    where: { user_id: userId },
    include: { user: { select: { name: true } } },
  });
}

function formatDateOnlyLabel(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * GET /api/cashier/wallet/dashboard-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Cashier-only. Uses local calendar-day bounds for `from` / `to`.
 */
export async function getCashierDashboardStats(req, res) {
  try {
    if (req.user.role !== "CASHIER") {
      return res.status(403).json({ message: "Cashier only" });
    }

    const cashier = await resolveCashierByUserId(req.user.sub);
    if (!cashier) {
      return res.status(404).json({
        message:
          "Cashier profile not found. Ask admin to create this cashier in Agents & Cashiers.",
      });
    }

    const fromRaw = req.query.from;
    const toRaw = req.query.to;
    const today = new Date();
    const defaultFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const defaultTo = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const from =
      typeof fromRaw === "string" && fromRaw.trim()
        ? parseDateOnlyStart(fromRaw)
        : defaultFrom;
    const to =
      typeof toRaw === "string" && toRaw.trim() ? parseDateOnlyEnd(toRaw) : defaultTo;

    if (!from || !to || from > to) {
      return res.status(400).json({ message: "Valid from and to dates (YYYY-MM-DD) are required" });
    }

    const shopStats = await aggregateShopStatsForWalletIds([cashier.wallet_id], {
      start: from,
      end: to,
    });

    return res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      fromLabel:
        typeof fromRaw === "string" && fromRaw.trim()
          ? fromRaw.trim()
          : formatDateOnlyLabel(from),
      toLabel:
        typeof toRaw === "string" && toRaw.trim()
          ? toRaw.trim()
          : formatDateOnlyLabel(to),
      cashierId: cashier.id,
      cashierName: String(cashier.user?.name || "").trim(),
      branchName: String(cashier.branch_name || "").trim(),
      branchLocation: String(cashier.branch_location || "").trim(),
      ...shopStats,
    });
  } catch (error) {
    console.error("getCashierDashboardStats error:", error);
    return res.status(500).json({ message: "Failed to load dashboard stats" });
  }
}
