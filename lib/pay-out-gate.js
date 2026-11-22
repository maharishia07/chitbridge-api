'use strict';
/**
 * CARD 04-books/books-payments
 * pay-out-gate.js — who may pay a supplier (AK-F-02, RC-7), split out of routes/books.js so that file does not grow (rule: split, don't raise).
 * OWNER     cb-accounting
 * RISK      security money
 * OWNS      directionOf (the direction a payment body names) · payOut(from) (the seat gate of POST /payments, /payments/:id/propose, /payments/:id/confirm)
 * CALLED BY routes/books.js (make(deps) once, at load; the route's own isOwner / isInHouseAccountant / ctx / withEntity / store / problem / refusalOf are passed in, never copied)
 * FLOW      a request ──▶ the owner or the shop's accountant or bookkeeper passes ──▶ any other seat: the direction is read (from the body for a new payment, from the stored payment for propose and confirm) ──▶ money in passes, money out is a 403 OWNER_ONLY
 *
 * Paying a supplier is the OWNER's alone (Athi, 22 Nov, DECISIONS item 5: pay-outs stay owner-only; before it the accountant seat paid too, RC-7); the accountant and a counter seat record money IN. The gate asks after `on` has loaded the ledger; money in is unchanged.
 * LV-05: the shop's own Bookkeeper seat, with the owner-approves flag on, is refused a payment out (OWNER_APPROVES, 403): a payment is not a Day book entry, so it cannot yet be held in the owner's queue; refusing is the closed side. Fails closed on a thrown flag read.
 * Not tagged roleGate: the seat it refuses depends on the body (a payment out), which the one-role BFLA scenes cannot send; tests/ak-f02-seat-gates.test.cjs proves it.
 */
const PAY_OUT_WORDS = 'Only the owner may pay a supplier. This seat records money in.'; /* DECISIONS 22 Nov item 5: pay-outs stay owner-only, the accountant's seat too */

const HELD_WORDS = "This shop's owner approves what the bookkeeper posts, and a payment out cannot wait in the queue yet. Ask the owner to record this payment.";

/** FIN-79: the direction a payment body names — in or out; left out it is in; anything else (both) is null, a question */
const directionOf = (body) => (body.direction == null || body.direction === 'in' ? 'in' : body.direction === 'out' ? 'out' : null);

/** make(deps) → { directionOf, payOut }: payOut('body' | 'stored') is the Express gate; 'stored' reads the direction off the stored payment named by :id */
function make({ UUID, isOwner, isInHouseAccountant, ctx, withEntity, store, problem, refusalOf }) {
  /** the direction of the payment this request is about: the body's own, or the stored payment's */
  async function directionAsked(req, from) {
    if (from === 'body') return directionOf(req.body || {});
    if (!UUID.test(String(req.params.id))) return undefined;
    const e = ctx(req);
    const stored = await withEntity(e, (h) => store.payment(h, e, String(req.params.id)));
    return stored && stored.direction;
  }
  const payOut = (from) => async (req, res, next) => {
    try {
      if (isOwner(req)) return next();
      if ((await directionAsked(req, from)) !== 'out') return next();
      /* LV-05: the shop's own Bookkeeper in a shop that asked to approve gets the queue words; every other non-owner seat the plain ones (one flag read, only for that seat) */
      const approval = require('./books-approval');
      const held = isInHouseAccountant(req) && approval.isBookkeeperSeat(req) && (await approval.approvalOn(require('../middleware/auth').entityOf(req)));
      const words = held ? HELD_WORDS : PAY_OUT_WORDS;
      return problem(req, res, { status: 403, code: 'OWNER_ONLY', detail: words, legacy: { error: words, message: words, may: false, why: words } });
    } catch (err) {
      problem(req, res, refusalOf(err, req));
    }
  };
  return { directionOf, payOut };
}
module.exports = { make, directionOf, PAY_OUT_WORDS, HELD_WORDS };
