'use strict';
/**
 * lib/actor-areas.js — THE OWNER OPENS AN AREA FOR A PERSON, AND EVERYONE READS WHAT THEY HOLD (W15-66).
 * OWNS      readAreas(req) (what the caller holds, and for the owner every person's areas and the notice) · changeArea(req) (the owner opens, changes or closes one area for one person, with an end day) · the notice words · the lapse record.
 * CALLED BY routes/actors.js (GET /areas and PATCH /:id/areas: the route answers, with its own problem() calls, from what these return) · lib/actors-contract.js (the two rows).
 * FLOW      change: the area must be enforced (lib/areas.GRANTABLE) → the end day must be a real day not yet past → the column must exist (else 503 in words, nothing changed) → the person is one of this business's →
 *           ONE jsonb UPDATE of identities.area_grants → ONE access_events row `area_changed` (before and after, who, reason) in its own transaction (a lost row is said in the answer, never fails the change).
 *           read: the people rows read once → lib/areas.areasOf (THE SAME judgement the gate uses) → the notice (the people the books are closed to whom the owner has not yet acted on) → a lapse is written to the trail once, here.
 * CARD      18-identity-sign-in-and-access/access-levels
 * ⭐ THE NOTICE IS A QUERY, NOT A STORED NUMBER: it names every active person who holds no accounts level and has no `area_changed` row yet, so it stays until the owner acted on each (opened an area, or confirmed it stays closed
 *    with level `none`), and it survives a dismissed screen. A person added after this landed is named too until the owner acts (there is no stored cut-over date).
 * ⚠️ BEFORE THE MIGRATION (b868) the column is missing: every read treats it as no grants (middleware/auth), the PATCH answers 503 in words ("arrives after the next update"), never a 500.
 */
const { withEntity } = require('../db');
const schema = require('./schema');
const access = require('./access');
const areas = require('./areas');
const accessEvents = require('./access-events');
const { waiting } = require('./not-migrated');
const { isOwner } = require('./owner');
const auth = require('../middleware/auth');

const EVENT = 'area_changed';
/** the areas the owner may open, with what each level lets the person do (the confirm popup says it before the owner agrees) */
const AREAS = Object.freeze([
  {
    id: 'accounts',
    label: 'Accounts',
    levels: areas.LEVELS,
    see: 'Read the day book, ledgers, trial balance, profit and loss, balance sheet and the bank reconciliation.',
    work: 'Read all of that, and add bank statements and bank marks. Payments, journals and closing stay with the owner.'
  }
]);
const NOT_GRANTABLE = 'That area cannot be opened for a person yet. Only the accounts can be.';
const PAST_WORDS = 'The last day is already past. Pick today or a later day, or leave it empty for no end.';
const BAD_DAY_WORDS = 'Give the last day as a date, like 2026-12-31, or leave it empty for no end.';
const NOT_THERE_WORDS = waiting('Opening an area for a person', false, 'Until then only the owner and the preset roles see the books. Nothing was changed.');

/** the sentence the owner reads on Home and in Employees for the people the books closed on */
const noticeWords = (count) => `${count} ${count === 1 ? 'person' : 'people'} could read your books. They can't now. Open it again for anyone who needs it.`;

/** the columns of `identities` this database has among the access ones (the code deploys before the migration) */
async function accessColumns() {
  const [level, costs, grants] = await Promise.all([schema.hasColumn('identities', 'access_level'), schema.hasColumn('identities', 'can_see_costs'), schema.hasColumn('identities', 'area_grants')]);
  return { level, costs, grants };
}

/** the owner's reading of every person the books could matter to (active people of this business), as the gate reads them */
async function peopleOf(entity, columns) {
  const select = ['identity_id', 'display_name', 'actor_role', 'hat'].concat(columns.level ? ['access_level', 'whole_entity'] : [], columns.costs ? ['can_see_costs'] : [], columns.grants ? ['area_grants'] : []).join(', ');
  const found = await withEntity(entity, (shop) =>
    shop.query(`SELECT ${select} FROM identities WHERE parent_entity_id = $1 AND identity_type = 'actor' AND (break_status IS NULL OR break_status NOT IN ('removed', 'deactivated')) ORDER BY display_name`, [entity])
  );
  return found.rows;
}

/** the people the owner has already acted on: subject → the reasons already on the trail (an absent trail table is nobody) */
async function trailOf(entity) {
  try {
    const found = await withEntity(entity, (shop) => shop.query(`SELECT subject_identity_id, reason FROM access_events WHERE entity_id = $1 AND action = $2`, [entity, EVENT]));
    const trail = new Map();
    for (const row of found.rows) trail.set(row.subject_identity_id, (trail.get(row.subject_identity_id) || []).concat(row.reason || ''));
    return trail;
  } catch (failure) {
    require('./logger').fellBack('actor-areas: the access trail could not be read, so every person reads as not yet acted on', failure);
    return new Map();
  }
}

/** a grant ended by its own end day is written to the trail once (a lapse has no job: it is noticed when the owner next reads this) */
async function recordLapses(entity, people, trail, now) {
  for (const person of people) {
    for (const { area, grant } of areas.lapsedGrants(person, now)) {
      const reason = `ended ${grant.until}`;
      if ((trail.get(person.identity_id) || []).includes(reason)) continue;
      const written = await withEntity(entity, (shop) =>
        accessEvents.record((sql, args) => shop.query(sql, args), { entity_id: entity, subject_identity_id: person.identity_id, action: EVENT, before: { area, level: grant.level, until: grant.until }, after: { area, level: null, until: grant.until }, changed_by: null, reason })
      );
      if (written) trail.set(person.identity_id, (trail.get(person.identity_id) || []).concat(reason));
    }
  }
}

/** one person as the owner's screen reads them */
function personView(person, now) {
  const preset = access.presetFor(access.levelOf({ identity_type: 'actor', access_level: person.access_level, hat: person.hat }), person.whole_entity === true, person.can_see_costs === true);
  return {
    identity_id: person.identity_id,
    display_name: person.display_name,
    actor_role: person.actor_role || null,
    preset: preset ? preset.key : null,
    access: areas.areasOf(Object.assign({ identity_type: 'actor' }, person), now),
    ended: areas.lapsedGrants(person, now).map(({ area, grant }) => ({ area, until: grant.until }))
  };
}

/** GET /api/actors/areas — anyone signed in reads what THEY hold (`mine`); the owner also reads every person and the notice → the answer body */
async function readAreas(req) {
  const entity = auth.entityOf(req);
  const now = Date.now();
  const columns = await accessColumns();
  const owner = isOwner(req);
  const mine = owner ? Object.fromEntries(areas.GRANTABLE.map((area) => [area, { level: 'work', source: 'owner', until: null, by: null, at: null }])) : areas.areasOf(req.identity, now);
  const answer = { available: columns.grants, is_owner: owner, areas: AREAS, mine, people: [], notice: null };
  if (!owner) return answer;
  const people = await peopleOf(entity, columns);
  const trail = await trailOf(entity);
  if (columns.grants) await recordLapses(entity, people, trail, now);
  answer.people = people.map((person) => personView(person, now));
  const closed = answer.people.filter((person) => !trail.has(person.identity_id) && areas.GRANTABLE.every((area) => person.access[area] === null));
  if (closed.length) answer.notice = { count: closed.length, words: noticeWords(closed.length), people: closed.map((person) => ({ identity_id: person.identity_id, display_name: person.display_name })) };
  return answer;
}

/** the end day the body asks for: { until } (null = no end), or { refusal } */
function endDayOf(body, now) {
  const until = body.until === undefined || body.until === null || body.until === '' ? null : String(body.until);
  if (until === null) return { until: null };
  if (!areas.realDay(until)) return { refusal: 'day_invalid' };
  if (until < areas.dayOf(now)) return { refusal: 'day_past' };
  return { until };
}

/** the grant a body asks for, stamped with who and when (null = close the area) */
const grantOf = (body, until, by, now) => (body.level === 'none' ? null : { level: body.level, until, by, at: new Date(now).toISOString() });

/** the answer of a change: what was done, to whom, by whom, and whether the trail row was kept */
const answerOf = ({ personId, person, area, grant, by, now, written }) => ({
  message: grant ? 'Area opened' : 'Area closed',
  person: { identity_id: personId, display_name: person.display_name },
  area,
  level: grant ? grant.level : 'none',
  until: grant ? grant.until : null,
  by,
  at: new Date(now).toISOString(),
  audit: { recorded: written ? 1 : 0, failed: written ? 0 : 1 }
});

/** the one jsonb UPDATE of a person's own grants (the key set, or removed when `grant` is null) → the person's row as it was BEFORE, or null when they are not one of this business's people */
async function storeGrant(entity, personId, area, grant) {
  return withEntity(entity, async (shop) => {
    const before = await shop.query(`SELECT display_name, area_grants FROM identities WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor' AND (break_status IS NULL OR break_status <> 'removed')`, [personId, entity]);
    if (!before.rows.length) return null;
    const sql = grant
      ? `UPDATE identities SET area_grants = COALESCE(area_grants, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb) WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`
      : `UPDATE identities SET area_grants = COALESCE(area_grants, '{}'::jsonb) - $3::text WHERE identity_id = $1 AND parent_entity_id = $2 AND identity_type = 'actor'`;
    await shop.query(sql, grant ? [personId, entity, area, JSON.stringify(grant)] : [personId, entity, area]);
    return before.rows[0];
  });
}

/** the trail row of one change, in its OWN transaction (a failed insert inside the update's transaction would undo the change): true when it was written */
function recordChange(entity, personId, { area, previous, grant, by, reason }) {
  return withEntity(entity, (shop) =>
    accessEvents.record((sql, args) => shop.query(sql, args), {
      entity_id: entity,
      subject_identity_id: personId,
      action: EVENT,
      before: { area, level: previous ? previous.level : null, until: previous ? previous.until || null : null },
      after: { area, level: grant ? grant.level : null, until: grant ? grant.until : null },
      changed_by: by,
      reason: String(reason || '').trim().slice(0, 300) || null
    })
  );
}

/**
 * PATCH /api/actors/:id/areas { area, level: see|work|none, until?, reason? } — the owner alone (the route's ownerWrite) → { refusal } or { answer }; refusal is one of
 * 'area' (not enforced yet, 400) · 'day_invalid' (400) · 'day_past' (400) · 'not_migrated' (503) · 'gone' (404): the route words each with its own status and code.
 */
async function changeArea(req) {
  const entity = auth.entityOf(req);
  const body = req.body || {};
  const now = Date.now();
  if (!areas.GRANTABLE.includes(body.area)) return { refusal: 'area' };
  const end = body.level === 'none' ? { until: null } : endDayOf(body, now);
  if (end.refusal) return { refusal: end.refusal };
  if (!(await schema.hasColumn('identities', 'area_grants'))) return { refusal: 'not_migrated' };
  const by = (req.identity && req.identity.identity_id) || null;
  const grant = grantOf(body, end.until, by, now);
  const person = await storeGrant(entity, req.params.id, body.area, grant);
  if (!person) return { refusal: 'gone' };
  const written = await recordChange(entity, req.params.id, { area: body.area, previous: areas.grantsOf(person)[body.area] || null, grant, by, reason: body.reason });
  return { answer: answerOf({ personId: req.params.id, person, area: body.area, grant, by, now, written }) };
}

module.exports = { readAreas, changeArea, AREAS, EVENT, NOT_GRANTABLE, PAST_WORDS, BAD_DAY_WORDS, NOT_THERE_WORDS, noticeWords };
