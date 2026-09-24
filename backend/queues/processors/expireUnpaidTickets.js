/**
 * Processor for the `expire-unpaid-tickets` queue.
 *
 * @module queues/processors/expireUnpaidTickets
 */
import prisma from "../../Config/db.js";
import { runExpireUnpaidTickets } from "../../lib/ticketExpiry.js";

export async function processExpireUnpaidTickets(job) {
  const result = await runExpireUnpaidTickets(prisma);
  return { job: job.name, ...result };
}
