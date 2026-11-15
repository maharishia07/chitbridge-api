'use strict';
// OWNS      the POLICY FORMS of an adopter's `set` / `read` / `reply` lists (MARK-AND-QUERY 3.2): answer(forms, ctx) → { ok, form, onWrite? }
// CALLED BY lib/review-mark.js (set, reply, actions) · routes/marks.js (the person's context) · tests/mark-policies.test.cjs
// FLOW      ctx = { owner, via: { kind: 'self' | 'grant', id, preset } } built by the route from the request → the first form that admits the person wins → { ok: true, form } or { ok: false }
// CARD      capability/MARK-AND-QUERY-CAPABILITY
/**
 * Each form is an EXISTING gate read as a value, never a second access engine: `level:owner` is lib/owner's test, `grant:<preset>` is the live grant the request already passed (middleware/books-grant), `subject` is
 * "whoever reads the record": the owner or a live grant. A form nobody answers fails closed (ok false) and the adopter CI check (lib/mark-adopters.checkAdopters) refuses to list it.
 * `onWrite(db)` (optional) runs in the SAME transaction after the row is written: the grant forms need none here (the grant's look row is written by the door, lib/mark-door.js).
 */
const forms = {
  subject: (ctx) => ctx.owner || ctx.via.kind === 'grant',
  'level:owner': (ctx) => ctx.owner && ctx.via.kind === 'self',
  'level:editor': (ctx) => ctx.owner && ctx.via.kind === 'self',
  'grant:auditor': (ctx) => ctx.via.kind === 'grant' && ctx.via.preset === 'auditor',
  'grant:adviser': (ctx) => ctx.via.kind === 'grant' && ctx.via.preset === 'adviser'
};

/** answer(list, ctx) → { ok, form } : the first form of the list that admits this person */
function answer(list, ctx) {
  for (const form of list || []) {
    const test = forms[form];
    if (test && test(ctx)) return { ok: true, form };
  }
  return { ok: false, form: null };
}

module.exports = { answer, forms };
