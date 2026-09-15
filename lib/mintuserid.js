'use strict';
/**
 * ── ⭐⭐⭐ MINT A USER ID — EVERY COMBINATION, IN ONE PLACE ────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-15: *"mint user id should be a module, and it should have these combinations in one place,
 * similarly, resolve user id should be a module."*
 *
 * ⚠️⚠️ AND HE IS RIGHT BECAUSE IT WAS ALREADY SPREAD OUT AND IT ALREADY COST SOMETHING. The customer builder
 * lived as a private function inside `routes/catalogue.js` — used at six call sites, exported at the bottom
 * "for unit tests", and invisible to anyone who did not open that route. Asked where the `.cr` id was built, I
 * searched for the literal `.cr`, found nothing, and told him twice it had never been built. It had been, since
 * b170. **A builder that lives in a route file is a builder nobody can find.**
 *
 * ── THE THREE KINDS THAT SHARE ONE COLUMN ──────────────────────────────────────────────────────────────────────
 *
 *     acmetraders                  an ENTITY     registered; no separator
 *     ravi@acmetraders.br          an EMPLOYEE   .br — the person, and the business they belong to
 *     9876512345@alpha-timers.cr   a CUSTOMER    .cr — the contact, and the shop they are a customer of
 *     ~acmetraders.sup-0001        a MINTED party — a fourth, older kind; delegated to lib/handle
 *
 * Each row also carries its OWN bridge id, and crossing an installation boundary uses `bridge_id@domain`. The
 * suffix says which KIND a name is; the bridge id says WHICH ONE. See docs/NAMESPACE.md.
 *
 * ── ⚠️⚠️ THE THREE RULES EVERY BUILDER HERE OBEYS, LEARNED FROM crHandle ────────────────────────────────────────
 *
 * 1. **ONE builder per kind, used at every call site.** A returning person must regenerate the SAME string.
 *    Two builders is two spellings of one identity, and nobody finds out until a login fails.
 * 2. **The handle is COMPARED, never PARSED** by the code that stores it. Reading one back is
 *    `lib/resolveuserid.js`'s job, and it is deliberately a different file.
 * 3. ⚠️ **The fallback to a bridge id is load-bearing, not padding.** An entity registered before b170 has a
 *    NULL `user_id`, so its people and customers hang off `CBZQK5DAH9` instead. Unreadable, and the only value
 *    guaranteed non-null and stable. Both forms exist at once, which rule 2 is what makes safe.
 *
 * ⚠️ NOTHING HERE TOUCHES THE DATABASE. It builds strings. Uniqueness is the unique index on lower(user_id);
 * whether a name is free is a question for the caller, at the moment it writes.
 */

const handle = require('./handle');

/**
 * the shop or business a name hangs from — its handle if it has one, else its bridge id (see rule 3)
 *
 * ⚠️⚠️ IT DOES NOT LOWERCASE, AND THAT IS NOT AN OVERSIGHT. My first version did, and tests/userid.test.cjs § 0
 * caught it immediately: a `user_id` is already lowercase by construction, but a BRIDGE ID is upper case, so
 * the fallback form became `9876512345@cbzqk5dah9.cr` where every row in production holds
 * `9876512345@CBZQK5DAH9.cr`. The storefront looks that key up with `WHERE email = $1` — an exact match — so
 * every returning customer of a pre-b170 shop would have failed to be recognised and been minted as a SECOND
 * identity, with their order history stranded on the first.
 *
 * ⭐ That is the whole reason § 0 writes the original formula out by hand instead of importing it: a second
 * opinion is the only thing that can catch a builder quietly improving itself.
 */
function ownerOf(entity) {
  if (!entity) return '';
  return String(entity.user_id || entity.bridge_id || '').trim();
}

/**
 * ⭐ AN ENTITY — the one kind with no separator, because it is the root everything else hangs from.
 * Registration chooses this; we only say whether it is allowed. Set once (routes/entities.js).
 */
function entity(chosen) {
  const c = handle.checkRoot(chosen);
  return c.ok ? { handle: c.value, kind: 'entity' } : { error: c.reason };
}

/**
 * ⭐ AN EMPLOYEE — `ravi@acmetraders.br`.
 *
 * @param actorKey the name they sign in with, as typed at creation
 * @param ent      the parent business — { user_id, bridge_id }
 *
 * ⚠️ THE SUFFIX IS STORED, NOT DEMANDED AT A KEYBOARD. A person types `ravi@acmetraders`, and always could;
 * `.br` is what the row holds so that one column can carry three kinds of name without ambiguity.
 */
function employee(actorKey, ent) {
  const k = String(actorKey == null ? '' : actorKey).trim().toLowerCase();
  if (!k) return { error: 'An employee id needs the name they sign in with.' };
  if (!/^[a-z0-9]+$/.test(k)) return { error: '"' + actorKey + '" must be letters and numbers only.' };
  const at = ownerOf(ent);
  if (!at) return { error: 'The business has no User ID or bridge id to hang the name from.' };
  const h = k + '@' + at + handle.EMPLOYEE;
  if (h.length > handle.MAX_TOTAL) return { error: 'That business handle is too long to make employee ids under.' };
  return { handle: h, kind: 'employee', actor_key: k, at };
}

/**
 * ⭐ A STOREFRONT CUSTOMER — `9876512345@alpha-timers.cr`, `xyz=gmail.com@alpha-timers.cr`.
 *
 * ⚠️⚠️ AN EMAIL KEEPS ITS FULL ADDRESS, with `@` swapped for `=`. The local part alone would collapse
 * `xyz@gmail.com` and `xyz@yahoo.com` at the same shop into ONE identity — cross-customer order visibility and
 * a misrouted OTP. That decision is older than this file and is the reason it is a builder and not a template.
 *
 * ⚠️ MOVED HERE FROM routes/catalogue.js VERBATIM. `crHandle` there now delegates, so every existing storefront
 * call site keeps producing the byte-identical string a returning customer was matched on. That equality is
 * asserted in tests/userid.test.cjs — if this ever drifts, every existing customer fails to be recognised and
 * silently becomes a second identity.
 */
function customer(channel, raw, ent) {
  const contact = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!contact) return { error: 'A customer id needs a phone number or an email.' };
  const local = channel === 'email' ? contact.replace('@', '=') : contact;
  const at = ownerOf(ent);
  const h = local + '@' + at + handle.CUSTOMER;
  return { handle: h, kind: 'customer', contact, channel: channel === 'email' ? 'email' : 'phone', at };
}

/**
 * ⭐ A MINTED PARTY — `~acmetraders.sup-0001`. Delegated, not reimplemented: `lib/handle` has owned this since
 * 2026-09-10 and a dozen call sites import it directly. This is the front door, not a second implementation.
 */
function minted(ent, kind, n) {
  return handle.minted(ownerOf(ent), kind, n);
}

/**
 * ⭐ A NETWORK STORE — `acmetraders.clothing`. Athi, 2026-09-15: *"similarly for others as well, network naming
 * and so on. so it will be easier to maintain."*
 *
 * ⚠️ ALWAYS COMPOSED FROM THE ROOT, never from the handle passed in — `child('acmetraders.clothing', 'Mens')`
 * is `acmetraders.mens`, not a third level. A handle is exactly two labels because a co-assist login hangs off
 * it, and five levels of structure would make that unsayable. Depth lives in the ltree, where it is queried.
 * Delegated to `handle.child()`, which has owned the rule since 2026-08-07.
 */
function network(anyHandleInTheNetwork, name) {
  const r = handle.child(anyHandleInTheNetwork, name);
  return r.error ? r : { handle: r.handle, kind: 'network', label: r.label };
}

/**
 * ⭐ AND THE BRIDGE ID, from the same door — because minting an identity needs BOTH names and going to two
 * files to get them is how one of them gets forgotten.
 * ⚠️ IT IS A DIFFERENT NAMESPACE, not a user id: flat, no grammar, `CB` + 8 from an alphabet that omits I, O, 0
 * and 1 because it is read down a phone. It is what crosses an installation boundary (`bridge_id@domain`).
 */
function bridge() {
  return { handle: require('./bridgeid').generateBridgeId(), kind: 'bridge_id' };
}

/**
 * ⭐ ONE FRONT DOOR, so a caller that does not care which kind it is minting does not have to branch.
 * `mint('employee', { actor_key: 'ravi', entity })`
 */
function mint(kind, opts) {
  const o = opts || {};
  switch (String(kind)) {
    case 'entity':   return entity(o.user_id);
    case 'employee': return employee(o.actor_key, o.entity);
    case 'customer': return customer(o.channel, o.raw, o.entity);
    case 'minted':   return minted(o.entity, o.minted_kind, o.n);
    case 'network':  return network(o.in || o.entity_handle, o.name);
    case 'bridge_id':return bridge();
    default: return { error: '"' + kind + '" is not a kind of user id. See docs/namespace.yaml.' };
  }
}

/** every kind this module can mint — the register asserts this list, so a new kind cannot arrive undocumented */
const KINDS = ['entity', 'network', 'employee', 'customer', 'minted', 'bridge_id'];

module.exports = { mint, entity, network, employee, customer, minted, bridge, ownerOf, KINDS };
