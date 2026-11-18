// @stage built
// @stage-note The people answer's two assign facts: each person's open load and the ONE suggested holder (Fable review I4/I9, lane L5). Reads only; writes nothing.
'use strict';
/**
 * CARD 01-rail-core-the-chit/assign
 * assign-people.js — ⭐ "WHO SHOULD TAKE THIS" (I4) AND "WHAT DOES EACH PERSON HOLD" (I9).
 *
 * OWNS      loadsOf · lastHolderOf · suggestAmong · parseFor  (reads and one pure ranking; no write, no second count)
 * CALLED BY routes/actors.js GET / (the picker's source: ?for=<plug>:<subject>)
 * FLOW      the page's people → loadsOf (open holdings) → lastHolderOf (who held this subject before) → suggestAmong (one id) → the row carries open_load + suggested
 *
 * ONE COUNT. open_load is lib/assign-chit openHeldWhere, the SAME spelling the auto door ranks by and the leave gate counts (tasks AND job chits); the task counter is not read here.
 * ONE RULE. Who may hold is lib/assign-chit mayHold (A5: a view-only seat holds nothing); the ranking is auto-assign's least_loaded: fewest open holdings first.
 * TIE. Equal load → the one who held this subject before; no such person → name order (then id, so the answer never flickers).
 */
const { openHeldWhere, mayHold } = require('./assign-chit');
const { entryOf, expansionOf } = require('./assign-register');
const log = require('./logger');

/** parseFor('client:<subject>') → { plug, subject_id } or null; a word that is no plug or has no subject names nobody (no error: the bonus is only a tie-break) */
function parseFor(word) {
  if (typeof word !== 'string') return null;
  const at = word.indexOf(':');
  if (at < 1 || at === word.length - 1) return null;
  const plug = word.slice(0, at);
  return entryOf(plug) ? { plug, subject_id: word.slice(at + 1).slice(0, 80) } : null;
}

/** loadsOf(db, entity_id, ids) → Map<identity_id, open holdings> (every id asked is present, 0 when it holds nothing) */
async function loadsOf(db, entity_id, ids) {
  const loads = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return loads;
  const found = await db(
    `SELECT i.identity_id, (SELECT COUNT(*) FROM chit_status cs WHERE ${openHeldWhere('i.identity_id', 'i.parent_entity_id')}) AS open_held
       FROM identities i WHERE i.parent_entity_id = $1 AND i.identity_type = 'actor' AND i.identity_id = ANY($2::uuid[])`,
    [entity_id, ids]
  );
  for (const row of found.rows) loads.set(row.identity_id, parseInt(row.open_held, 10) || 0);
  return loads;
}

/** lastHolderOf(db, { entity_id, plug, subject_id }) → the identity_id of whoever last held a job for this subject (open or closed), or null; a plug with no party subject answers null */
async function lastHolderOf(db, { entity_id, plug, subject_id }) {
  let copy;
  try {
    ({ copy } = expansionOf(entryOf(plug)));
  } catch (notBuilt) {
    log.fellBack('assign-people lastHolderOf: this plug has no party subject yet — no previous holder', notBuilt);
    return null;
  }
  const found = await db(
    `SELECT cs.assigned_to_actor_id AS actor_id
       FROM chit_status cs JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id
       CROSS JOIN LATERAL jsonb_array_elements(ch.all_recipients) r
      WHERE cs.entity_id = $1::uuid AND cs.direction = '${copy}' AND cs.deleted_at IS NULL AND cs.assigned_to_actor_id IS NOT NULL
        AND ch.business_json -> 'job' ->> 'plug' = $2 AND r ->> 'entity_id' = $3 AND r ->> 'role' IS DISTINCT FROM 'sender'
      ORDER BY cs.assigned_at DESC NULLS LAST LIMIT 1`,
    [entity_id, plug, String(subject_id)]
  );
  return (found.rows[0] && found.rows[0].actor_id) || null;
}

/**
 * suggestAmong(people, loads, plug, previousId) → identity_id | null. people = rows with identity_id, display_name, break_status, hat, access_level.
 * Only an ACTIVE person who may hold this plug is a candidate; fewest open holdings wins; a tie goes to the previous holder, then name order.
 */
function suggestAmong(people, loads, plug, previousId) {
  const holders = people.filter((person) => person.break_status === 'active' && mayHold(plug, person));
  const rank = (person) => [loads.get(person.identity_id) || 0, person.identity_id === previousId ? 0 : 1, String(person.display_name || '').toLowerCase(), String(person.identity_id)];
  holders.sort((first, second) => {
    const [firstRank, secondRank] = [rank(first), rank(second)];
    for (let slot = 0; slot < firstRank.length; slot++) if (firstRank[slot] !== secondRank[slot]) return firstRank[slot] < secondRank[slot] ? -1 : 1;
    return 0;
  });
  return holders.length ? holders[0].identity_id : null;
}

/** factsOf(db, entity_id, people, forWord) → { loads, suggested } — the two reads and the one ranking for the whole people list (default plug 'client': the seat rule, the widest who-may-hold) */
async function factsOf(db, entity_id, people, forWord) {
  const target = parseFor(forWord);
  const plug = target ? target.plug : 'client';
  const loads = await loadsOf(db, entity_id, people.map((person) => person.identity_id));
  const previous = target ? await lastHolderOf(db, { entity_id, plug, subject_id: target.subject_id }) : null;
  return { loads, suggested: suggestAmong(people, loads, plug, previous) };
}
/** withFacts(row, facts) → the person's row with open_load and suggested (true for the one) */
const withFacts = (row, facts) => Object.assign(row, { open_load: facts.loads.get(row.identity_id) || 0, suggested: row.identity_id === facts.suggested });

module.exports = { parseFor, loadsOf, lastHolderOf, suggestAmong, factsOf, withFacts };
