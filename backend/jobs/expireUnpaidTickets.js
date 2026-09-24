/**
 * Expire unpaid OPEN tickets once the earliest leg has kicked off.
 *
 * Runs on the `expire-unpaid-tickets` repeatable queue every few minutes.
 *
 * @module jobs/expireUnpaidTickets
 */
import { runExpireUnpaidTickets } from "../lib/ticketExpiry.js";

export default runExpireUnpaidTickets;
