/**
 * Unpaid prebook tickets expire at the earliest leg kickoff.
 * Shared helpers for the expiry job, settlement guards, and API flows.
 *
 * @module lib/ticketExpiry
 */

/** Prisma include for kickoff resolution in batch expiry. */
export const TICKET_EXPIRY_SELECTION_INCLUDE = {
  selections: {
    include: {
      match: { select: { start_time: true } },
      fixture: { select: { start_time: true } },
    },
  },
};

function parseKickoff(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function selectionKickoffTime(selection) {
  return (
    selection?.match?.start_time ?? selection?.fixture?.start_time ?? null
  );
}

/**
 * @param {{ selections?: Array<unknown>, selection_snapshot?: unknown }} ticket
 * @returns {Date | null}
 */
export function getEarliestKickoff(ticket) {
  const selections = ticket?.selections || [];
  const snapshot = Array.isArray(ticket?.selection_snapshot)
    ? ticket.selection_snapshot
    : [];
  const count = Math.max(selections.length, snapshot.length);

  let earliest = null;
  for (let i = 0; i < count; i++) {
    const kickoff = parseKickoff(
      selectionKickoffTime(selections[i]) ||
        (snapshot[i]?.kickoffAt != null ? snapshot[i].kickoffAt : null),
    );
    if (kickoff && (!earliest || kickoff < earliest)) {
      earliest = kickoff;
    }
  }
  return earliest;
}

/**
 * @param {{ status?: string, receipt_number?: string | null }} ticket
 */
export function isUnpaidOpenTicket(ticket) {
  return (
    ticket?.status === "OPEN" && !String(ticket?.receipt_number || "").trim()
  );
}

/**
 * @param {{ status?: string, receipt_number?: string | null, selections?: Array<unknown>, selection_snapshot?: unknown }} ticket
 * @param {Date} [now]
 */
export function shouldExpireUnpaidTicket(ticket, now = new Date()) {
  if (!isUnpaidOpenTicket(ticket)) return false;
  const earliest = getEarliestKickoff(ticket);
  if (!earliest) return false;
  return now >= earliest;
}

/**
 * Tickets that may be graded and status-recomputed by settlement.
 *
 * @param {{ status?: string, receipt_number?: string | null }} ticket
 */
export function isTicketSettleable(ticket) {
  if (!ticket) return false;
  if (ticket.status === "EXPIRED") return false;
  if (!["OPEN", "PRINTED"].includes(String(ticket.status || ""))) return false;
  if (isUnpaidOpenTicket(ticket)) return false;
  return true;
}

/**
 * @param {{ coupon_number?: string | null }} [ticket]
 */
export function ticketExpiredResponse(ticket) {
  return {
    code: "TICKET_EXPIRED",
    message: "Coupon expired — not paid before kickoff",
    couponNumber: ticket?.coupon_number ?? null,
  };
}

/**
 * Hide EXPIRED and CANCELED tickets from operational lists unless that status is requested.
 *
 * @param {Record<string, unknown>} where
 * @param {string} [statusFilter]
 */
export function applyExcludeExpiredFilter(where, statusFilter = "") {
  const status = String(statusFilter || "").trim();
  if (status === "EXPIRED" || status === "CANCELED") return where;
  if (status) return where;
  if (where.status != null) return where;
  where.status = { notIn: ["EXPIRED", "CANCELED"] };
  return where;
}

/** Prisma NOT clause: OPEN drafts/prebooks with no receipt_number. */
export const UNPAID_OPEN_FILTER = {
  status: "OPEN",
  OR: [
    { receipt_number: null },
    { receipt_number: { isSet: false } },
    { receipt_number: "" },
  ],
};

/**
 * Hide unpaid OPEN tickets (no receipt_number) from reportable metrics.
 *
 * @param {Record<string, unknown>} where
 */
export function applyExcludeUnpaidOpenFilter(where) {
  where.NOT = where.NOT
    ? { AND: [where.NOT, UNPAID_OPEN_FILTER] }
    : UNPAID_OPEN_FILTER;
  return where;
}

/**
 * Standard filter for dashboard/report ticket queries.
 *
 * @param {Record<string, unknown>} where
 * @param {string} [statusFilter]
 */
export function applyReportableTicketFilter(where, statusFilter = "") {
  applyExcludeExpiredFilter(where, statusFilter);
  applyExcludeUnpaidOpenFilter(where);
  return where;
}

/**
 * Flip OPEN unpaid ticket to EXPIRED when kickoff has passed.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} client
 * @param {{ id: string, status?: string, receipt_number?: string | null, selections?: Array<unknown>, selection_snapshot?: unknown }} ticket
 * @param {Date} [now]
 */
export async function expireTicketIfDue(client, ticket, now = new Date()) {
  if (ticket?.status === "EXPIRED") return ticket;
  if (!shouldExpireUnpaidTicket(ticket, now)) return ticket;

  const { count } = await client.ticket.updateMany({
    where: { id: ticket.id, status: "OPEN" },
    data: { status: "EXPIRED" },
  });
  if (count === 0) {
    const fresh = await client.ticket.findUnique({ where: { id: ticket.id } });
    return fresh || ticket;
  }
  return { ...ticket, status: "EXPIRED" };
}

/**
 * @param {import("@prisma/client").PrismaClient} [client]
 * @returns {Promise<{ scanned: number, expired: number }>}
 */
export async function runExpireUnpaidTickets(client) {
  const prismaClient = client;
  if (!prismaClient) {
    throw new Error("runExpireUnpaidTickets requires a Prisma client");
  }

  const batch = Number(process.env.EXPIRE_UNPAID_TICKETS_BATCH || 200);
  const tickets = await prismaClient.ticket.findMany({
    where: {
      status: "OPEN",
      OR: [{ receipt_number: null }, { receipt_number: { isSet: false } }],
    },
    include: TICKET_EXPIRY_SELECTION_INCLUDE,
    take: batch,
    orderBy: { created_at: "asc" },
  });

  const now = new Date();
  let expired = 0;
  for (const ticket of tickets) {
    if (!shouldExpireUnpaidTicket(ticket, now)) continue;
    const { count } = await prismaClient.ticket.updateMany({
      where: { id: ticket.id, status: "OPEN" },
      data: { status: "EXPIRED" },
    });
    if (count > 0) expired += 1;
  }

  console.log(
    `[expireUnpaidTickets] scanned=${tickets.length} expired=${expired}`,
  );
  return { scanned: tickets.length, expired };
}
