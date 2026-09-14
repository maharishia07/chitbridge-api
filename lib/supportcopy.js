'use strict';
/**
 * ── ⭐⭐⭐ A SHOP'S INCIDENT HAS TO REACH US ────────────────────────────────────────────────────────────────────
 *
 * DESIGN-SUPPORT-LIFECYCLE.md §5.2. Today an incident is written into the entity that raised it and nowhere
 * else — which is correct for the shop and useless for support: our queue is empty, and a shop that reported a
 * fault is waiting on somebody who was never told.
 *
 * ⭐ SO THE RAISER KEEPS THEIRS AND WE GET A COPY. Not a move, and not a shared row:
 *
 *   · the shop's copy is THEIRS — it is about their business, in their words, and they close it
 *   · ours is OUR QUEUE — triaged, assigned, cited by a change, and marked resolved when a release ships
 *
 * ⚠️ A SHARED ROW WOULD BE THE OBVIOUS SHORTCUT AND IT IS WRONG. lib/testboard.js already argues this at
 * length: an incident is free text and screenshots about somebody's trade, and the board is visible to every
 * signed-in user. Two copies, one id, is the same shape per-copy replication uses for a chit.
 *
 * ── ⚠️ THE COPY REMEMBERS WHERE IT CAME FROM ───────────────────────────────────────────────────────────────────
 *
 * `origin` carries the raiser's entity and definition id, because at release time there is no other way to find
 * the shop's copy and tell them their fault shipped. Captured at write time, never looked up later — by then the
 * chain has to be walked backwards through data nobody stored.
 *
 * ⭐ AND IT CARRIES THEIR POPULATION (b249). cbincroot serves every population, so a test shop's incident
 * legitimately lands in our live queue — and without this field we could not tell a real customer's fault from
 * an e2e run's, which is the distinction the whole of b246–b249 exists to draw.
 */

const { withEntity } = require('../db');
const platformroot = require('./platformroot');

/**
 * Post a copy of a finding into the operator's entity.
 *
 * ⚠️ NEVER THROWS, and never blocks the raiser's write — but it does REPORT. A shop whose incident recorded
 * must not see a failure because our queue was unreachable; equally, "it was recorded" with no word about
 * whether anybody was told is the silence this codebase keeps producing. The caller answers `support` either
 * way. [[feedback-silence-is-the-bug]]
 *
 * @param kind        'incident' | 'spec'
 * @param origin      { entity_id, definition_id, ref, sub_kind, note, rules, population, shop }
 * @param who         { id, name } — the actor who raised it
 * @returns {Promise<{copied:boolean, why?:string, definition_id?:string}>}
 */
async function toOperator(kind, origin, who) {
  const root = platformroot.root();
  if (!root) return { copied: false, why: 'no operator entity is configured (PLATFORM_ROOT_ENTITY)' };
  /* ⭐ the operator raising something on its own board does not need a copy of itself. */
  if (String(origin.entity_id) === String(root)) return { copied: false, why: 'raised by the operator' };

  try {
    const id = await withEntity(root, async (db) => {
      /* ⚠️ IDEMPOTENT ON THE REF. A retry, a double-submit or a replayed request must not open the same fault
         twice on our queue — a duplicate in a support queue is worked twice and closed once. */
      const seen = await db.query(
        `SELECT definition_id FROM definition
          WHERE entity_id = $1 AND kind = $2 AND name = $3 LIMIT 1`, [root, kind, origin.ref]);
      if (seen.rows[0]) return seen.rows[0].definition_id;

      const rules = Object.assign({}, origin.rules || {}, {
        origin: {
          entity_id: origin.entity_id,
          definition_id: origin.definition_id,
          ref: origin.ref,
          shop: origin.shop || null,
          /* ⚠️ b249: which set of books this came from. Without it a real customer's fault and an e2e run's
             look identical in our queue. */
          population: origin.population || null,
        },
        /* ⭐ OUR copy starts untriaged. The raiser's state is theirs and must not be mirrored — the two
           lifecycles are genuinely different: they close it, we resolve it. */
        state: 'raised',
        history: [{ state: 'raised', by: origin.shop || 'a shop', at: new Date().toISOString(),
                    why: 'copied to support' }],
      });

      const ins = await db.query(
        `INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
         VALUES ($1,$2,$3,$4,$5,'draft',1,$6) RETURNING definition_id`,
        [root, kind, origin.sub_kind || null, origin.ref, (origin.note || '').slice(0, 200), who && who.id]);
      const copyId = ins.rows[0].definition_id;
      await db.query(
        `INSERT INTO definition_version (definition_id, version, entity_id, rules, created_by)
         VALUES ($1,1,$2,$3,$4)`, [copyId, root, JSON.stringify(rules), who && who.id]);
      return copyId;
    });

    /* ⚠️ our board is told, and `for` is deliberately NULL: it is nobody's in particular until it is triaged.
       Naming the raiser here would tell a shopkeeper that their own report is theirs to action. */
    try {
      require('./testnews').testRaised(root, kind, origin.ref,
        { state: 'raised', byName: origin.shop || null });
    } catch (_) { /* a queue that recorded must not fail because a tab could not be told */ }

    return { copied: true, definition_id: id };
  } catch (e) {
    return { copied: false, why: e.code ? (e.code + ' ' + e.message) : String(e.message || e) };
  }
}

module.exports = { toOperator };
