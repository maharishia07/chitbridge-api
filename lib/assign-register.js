// @stage tested
// @stage-note The ASSIGN capability's register: VALUES and NAMES only, one entry per plug-in, plus the one new read holds()/holdsAmong() ("is this person the holder of this subject?").
'use strict';
/**
 * CARD 01-rail-core-the-chit/assign
 * assign-register.js — ⭐ THE GENERIC ASSIGN CAPABILITY'S REGISTER (ASSIGN-1, Athi 17 Nov: ADOPT what is built; one capability, no second assignment construct).
 *
 * OWNS      REGISTER (a frozen code table: values and names only) · KEYS · levelOf · entryOf · holds · holdsAmong · clientAccessSql · mayReadJobThread
 * CALLED BY lib/books-grant.js (finalOutcome → holdsOutcome) · lib/assign-bulk.js · routes/chits-jobs.js · routes/actors.js (the job-chit gate) · routes/chits.js (autoAssignReceived: the copy)
 * FLOW      a door asks entryOf(plug) for its values → the existing writer (lib/assign-chit) does the work; a gate asks holds(db, …) for "is this person the holder"
 *
 * WHAT IT IS. Assign is a capability attached to a SUBJECT: one person of my business holds this piece of work, privately, and it can be taken, handed over, returned,
 * auto-distributed and re-routed. It grants nothing: it narrows who inside the business does, or may open, what the business already has. The subject is always carried by
 * a chit copy (or a line of one); a subject with no chit gets a JOB chit (purpose general, business_json.job), the only new object.
 *
 * WHY A CODE TABLE (cb-capability, CAP-REVIEW §2): every plug-in carries a gate, a selector and a subject matcher, which are code and need a deploy anyway. So an entry holds
 * VALUES and NAMES only (keys into one map of functions, never inline logic); a register test fails if a plug lacks a key; each entry is listed in the CAP-11 function
 * register. It becomes a ROW the first time a business (not us) must add a kind with no deploy: widen the `register_attachable` pattern, never a second table.
 *
 * NOT in an entry (the same for every plug-in, the business's existing settings and code): mode, cap, default assignee, round robin, reroute, audit, notice.
 *
 * The holder lives only in chit_status.assigned_to_actor_id (carrier chit) and chit_line_assignment (carrier line). The job marker is `business_json.job` ({ plug, role, period }),
 * sealed at send in chit_hash and never edited; it carries no holder and no money (docs/FIELDS.md).
 */
const { CLOSED_SQL } = require('./rail-actions');

/** every key an entry must carry (the register test fails on a missing one) */
const KEYS = Object.freeze(['plug', 'subject_kind', 'carrier', 'copy', 'opens', 'selector', 'roles', 'assignable', 'may_assign', 'gate', 'listed_in', 'subject_match', 'built']);
/** the levels of may_assign, weakest first (lib/owner mayAt reads them) */
const LEVELS = Object.freeze(['any', 'manager', 'owner']);
/** the words an entry may use for the keys that name a function in the one map (see FUNCTIONS in the doors) */
const WORDS = Object.freeze({
  subject_kind: ['chit', 'chit_line', 'entity', 'product'],
  carrier: ['chit', 'line'],
  copy: ['received', 'sent'],
  selector: ['ids', 'practice_filter', 'product_ids'],
  assignable: ['act_or_manager', 'team', 'seat'],
  gate: [null, 'holds'],
  listed_in: ['worklist', 'own'],
  subject_match: [null, 'party', 'line_product']
});

/**
 * `built: false` = designed, not yet built (slice 2): holds() refuses it by name instead of answering a guess.
 * `opens` = how the job chit is opened when the subject has none: { purpose, ref } (the ref is the idempotency key's pattern; the subject is the chit's own `to` party).
 */
const REGISTER = Object.freeze({
  task: Object.freeze({ plug: 'task', subject_kind: 'chit', carrier: 'chit', copy: 'received', opens: null, selector: 'ids', roles: Object.freeze([]), assignable: 'act_or_manager', may_assign: 'any', gate: null, listed_in: 'worklist', subject_match: null, built: true }),
  line: Object.freeze({ plug: 'line', subject_kind: 'chit_line', carrier: 'line', copy: 'received', opens: null, selector: 'ids', roles: Object.freeze([]), assignable: 'team', may_assign: 'any', gate: null, listed_in: 'worklist', subject_match: null, built: true }),
  client: Object.freeze({
    plug: 'client',
    subject_kind: 'entity',
    carrier: 'chit',
    copy: 'sent',
    opens: Object.freeze({ purpose: 'general', ref: 'job:{plug}:{role}:{subject}:{period}' }),
    selector: 'practice_filter',
    roles: Object.freeze(['adviser', 'auditor']),
    assignable: 'seat',
    may_assign: 'manager',
    gate: 'holds',
    listed_in: 'own',
    subject_match: 'party',
    built: true
  }),
  product_set: Object.freeze({ plug: 'product_set', subject_kind: 'product', carrier: 'chit', copy: 'received', opens: null, selector: 'product_ids', roles: Object.freeze([]), assignable: 'act_or_manager', may_assign: 'manager', gate: 'holds', listed_in: 'worklist', subject_match: 'line_product', built: false })
});

/** the entry of a plug, or null (an unknown word is never guessed) */
const entryOf = (plug) => (typeof plug === 'string' && Object.prototype.hasOwnProperty.call(REGISTER, plug) ? REGISTER[plug] : null);
/** the plugs that can OPEN a job chit (they carry `opens`) */
const OPENERS = Object.freeze(Object.keys(REGISTER).filter((name) => REGISTER[name].opens && REGISTER[name].built));
/** may_assign of a plug (an unknown plug is the strictest level: fail closed) */
const levelOf = (plug) => (entryOf(plug) ? entryOf(plug).may_assign : 'owner');
/** the stricter of two levels */
const stricter = (first, second) => (LEVELS.indexOf(first) >= LEVELS.indexOf(second) ? first : second);

/* ── the one gate read: holds() ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/**
 * clientAccessSql(entityParam) — the firm switch `firm.client_access` (working name; cb-settings names the key and the FIELDS row) as a boolean SQL expression that is TRUE when the
 * switch is OFF: absent = `all`; the value `all` = `all`; ANY other value, readable or not, = `assigned` (fail closed). Read from the firm's own settings row through to_jsonb, so a column that
 * is not there yet (the migration is Athi's) reads as absent and today's behaviour stands. ONE statement with the gate: a CASE answers true before any chit table is touched.
 */
const clientAccessSql = (entityParam) =>
  `COALESCE((SELECT (to_jsonb(s) ->> 'client_access') IS NULL OR (to_jsonb(s) ->> 'client_access') = 'all' FROM entity_actor_settings s WHERE s.entity_id = ${entityParam}::uuid), true)`;

/**
 * the statement fragments an entry expands to: only literals from WORDS reach the SQL text, every value is a $n placeholder.
 * copy (which of my copies holds it) · carrier chit (the copy's holder) · subject_match party (the sealed recipient list, never the sender's own entry)
 */
function expansionOf(entry) {
  if (!entry || !entry.built) throw new Error('assign-register: plug ' + JSON.stringify(entry && entry.plug) + ' is not built yet');
  if (!WORDS.copy.includes(entry.copy)) throw new Error('assign-register: copy must be received or sent');
  if (entry.carrier !== 'chit') throw new Error('assign-register: holds() reads a chit carrier; a line carrier waits for D-3');
  if (entry.subject_match !== 'party') throw new Error('assign-register: holds() has no subject_match ' + JSON.stringify(entry.subject_match) + ' yet');
  return { copy: entry.copy };
}

/** the held-chit read shared by holds(), holdsAmong() and holdersAmong() (anyHolder: every holder, not one actor; byOther: a holder who is NOT this actor, an unassigned chit never counts: STAFFPICK): $1 firm · $2 actor · $3 plug · $4 role ('' = any); every recipient of the sealed list except the sender's own entry is a candidate subject (r) */
function heldFrom(copy, anyHolder, byOther) {
  const holderTest = byOther ? 'cs.assigned_to_actor_id IS NOT NULL AND cs.assigned_to_actor_id <> $2::uuid' : anyHolder ? 'cs.assigned_to_actor_id IS DISTINCT FROM $2::uuid' : 'cs.assigned_to_actor_id = $2::uuid';
  return `FROM chit_status cs
            JOIN chit_header ch ON ch.chit_id = cs.chit_id AND ch.entity_id = cs.entity_id
            CROSS JOIN LATERAL jsonb_array_elements(ch.all_recipients) r
           WHERE ${holderTest} AND cs.entity_id = $1::uuid AND cs.direction = '${copy}'
             AND cs.deleted_at IS NULL AND cs.current_status NOT IN (${CLOSED_SQL})
             AND ch.business_json -> 'job' ->> 'plug' = $3 AND ($4::text = '' OR ch.business_json -> 'job' ->> 'role' = $4)
             AND r ->> 'role' IS DISTINCT FROM 'sender'`;
}

/**
 * holds(db, { plug, entity_id, actor_id, subject_id, role }) → true | false — may this person open this subject? STAFFPICK (Athi 21 Nov): under switch `assigned` a seat reaches the clients it holds AND the ones nobody holds (to pick up); only a client another person holds is refused. A caller with no actor is refused (fail closed).
 * NEUTRAL: it names no direction and no party; it reads `copy` and `subject_match` from the register entry. `db` is a connection bound to the firm (inside the look's transaction).
 * ONE statement; the switch rides in it: `all` (or absent) answers true before a chit table is read; any other word asks the chit. The owner never reaches it (the caller skips).
 */
async function holds(db, { plug, entity_id, actor_id, subject_id, role }) {
  const { copy } = expansionOf(entryOf(plug));
  const found = await db.query(
    `SELECT CASE WHEN ${clientAccessSql('$1')} THEN true ELSE ($2::uuid IS NOT NULL AND NOT EXISTS (SELECT 1 ${heldFrom(copy, false, true)} AND r ->> 'entity_id' = $5 LIMIT 1)) END AS ok`,
    [entity_id, actor_id, plug, role || '', String(subject_id)]
  );
  return !!(found.rows[0] && found.rows[0].ok === true);
}

/**
 * holdsAmong(db, { plug, entity_id, actor_id, members, role }) → { all: boolean, held: Set<string> } — the same read for a LIST (a read that spans clients): ONE statement per page.
 * `all` true = the switch is off, nothing is excluded. Otherwise `held` is the subset of `members` the actor holds an open job for; the rest are EXCLUDED by the caller from rows, totals and counts, never masked.
 */
async function holdsAmong(db, { plug, entity_id, actor_id, members, role }) {
  const { copy } = expansionOf(entryOf(plug));
  const found = await db.query(
    `SELECT ${clientAccessSql('$1')} AS everyone,
            CASE WHEN ${clientAccessSql('$1')} THEN ARRAY[]::text[]
                 ELSE CASE WHEN $2::uuid IS NULL THEN ARRAY[]::text[] ELSE ARRAY(SELECT m FROM unnest($5::text[]) m WHERE m NOT IN (SELECT r ->> 'entity_id' ${heldFrom(copy, false, true)} AND r ->> 'entity_id' = ANY($5::text[]))) END END AS held`,
    [entity_id, actor_id, plug, role || '', (members || []).map(String)]
  );
  const row = found.rows[0] || {};
  return { all: row.everyone !== false, held: new Set(row.held || []) };
}

/**
 * holdersAmong(db, { plug, entity_id, members, role }) → { all: boolean, holders: Map<subject, [{ actor_id, name }]> } — WHO holds each of a list of subjects (the practice list's holder column): ONE statement, the switch riding in it
 * (`all` true = the switch is off; the holders are read ALL THE SAME since 18 Nov, A1: who holds a client is not the fact "staff see only theirs"). A subject with no open held job is absent from the map (the page says "Unassigned"). The holder's name is the identity's own display_name.
 */
async function holdersAmong(db, { plug, entity_id, members, role }) {
  const { copy } = expansionOf(entryOf(plug));
  const found = await db.query(
    `SELECT ${clientAccessSql('$1')} AS everyone,
            (SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('subject', r ->> 'entity_id', 'actor_id', cs.assigned_to_actor_id::text, 'name', (SELECT display_name FROM identities WHERE identity_id = cs.assigned_to_actor_id))), '[]'::jsonb)
                       ${heldFrom(copy, true)} AND r ->> 'entity_id' = ANY($5::text[])) AS holders`,
    [entity_id, null, plug, role || '', (members || []).map(String)]
  );
  const row = found.rows[0] || {};
  const holders = new Map();
  for (const one of row.holders || []) { if (!holders.has(one.subject)) holders.set(one.subject, []); holders.get(one.subject).push({ actor_id: one.actor_id, name: one.name }); }
  return { all: row.everyone !== false, holders };
}

/** the plugs whose chits are read only by their holder under switch `assigned` (every built entry with gate 'holds'): the job chit of a client */
const GATED_PLUGS = Object.freeze(Object.keys(REGISTER).filter((name) => REGISTER[name].built && REGISTER[name].gate === 'holds'));

/**
 * mayReadJobThread(db, { entity_id, chit_id, req }) → true | false — RC2 (R3e, 19 Nov): may this person read the thread of one chit of their firm? Under switch `all` (or absent) every chit is readable, as ever;
 * under `assigned` a JOB chit (business_json.job.plug is a gated plug: the client job) is read only by its CURRENT holder, so a person handed off a client stops reading that client's thread at once, the same moment
 * the books close to them (holdsOutcome). Any other chit is no job chit and is readable. The owner, a manager (they see every client) and a firm reading under a grant skip it. ONE statement; the switch rides in it.
 */
async function mayReadJobThread(db, { entity_id, chit_id, req }) {
  const owner = require('./owner');
  if (owner.isOwner(req) || owner.isManager(req) || req.acting_for_grant) return true;
  const found = await db.query(
    `SELECT CASE WHEN ${clientAccessSql('$1')} THEN true
                 ELSE NOT EXISTS (SELECT 1 FROM chit_header ch WHERE ch.chit_id = $2::uuid AND ch.entity_id = $1::uuid AND ch.business_json -> 'job' ->> 'plug' = ANY($4::text[]))
                   OR EXISTS (SELECT 1 FROM chit_status cs WHERE cs.chit_id = $2::uuid AND cs.entity_id = $1::uuid AND cs.assigned_to_actor_id = $3::uuid AND cs.deleted_at IS NULL) END AS ok`,
    [entity_id, chit_id, (req.identity && req.identity.identity_id) || null, GATED_PLUGS]
  );
  return !!(found.rows[0] && found.rows[0].ok === true);
}

/** the switch's stored word as the page and the settings answer say it: absent or 'all' = 'all'; any other word = 'assigned' (the same fail-closed reading as clientAccessSql) */
const clientAccessOf = (stored) => (stored === null || stored === undefined || stored === 'all' ? 'all' : 'assigned');

/**
 * pickUpOn(db, entity_id) → boolean — W17 (Athi 19 Nov): the firm switch `firm.staff_pick_up` (column staff_pick_up, b883): may a SEAT of the firm assign clients nobody holds, to itself or to a colleague. Absent column, no row or NULL = ON (the default);
 * 'on' = ON; ANY other word = OFF (fail closed). Read through to_jsonb so a database before b883 reads ON and the api is correct before the migration runs. The partner and a manager never ask it.
 */
async function pickUpOn(db, entity_id) {
  const found = await db.query("SELECT (to_jsonb(s) ->> 'staff_pick_up') AS v FROM entity_actor_settings s WHERE s.entity_id = $1::uuid", [entity_id]);
  const v = found.rows[0] ? found.rows[0].v : null;
  return v === null || v === undefined || v === 'on';
}
const pickUpOf = (stored) => (stored === null || stored === undefined || stored === 'on' ? 'on' : 'off');

/** a seat of the firm that may hold client work (an actor of the practice, not view-only): the person the pick-up switch speaks of */
function isHoldingSeat(req) {
  const id = req && req.identity;
  return !!id && !req.api_key && id.identity_type === 'actor' && !!id.parent_entity_id && !id.acting_for_grant && require('./access').canEdit(id) && require('./assign-chit').mayHold('client', id); /* H-mx-005: taking is a write, so a comment-only seat (reviewer, reports) is no taker, though a manager may still assign it work (A5) */
}

/**
 * verdictOf(req, { pickUp }) → { may_assign, may_take } — the server's answer to "may THIS caller assign / take a client?", sent on GET /practice and GET /api/actors so no page reads a token (A2, Fable review 18 Nov).
 * may_assign = the SAME gate the opener and assign-bulk use (mayAt at the client plug's level: the partner or a manager). may_take = a manager's own row, or (W17) a holding seat while the firm's pick-up switch is ON
 * (`pickUp` = pickUpOn, read by the caller; absent = off: the old answer); the partner holds nothing (not an actor row).
 */
function verdictOf(req, { pickUp = false } = {}) {
  const { mayAt, isManager } = require('./owner');
  return { may_assign: mayAt(req, levelOf('client')).ok, may_take: isManager(req) || (pickUp === true && isHoldingSeat(req)) };
}
/** verdictOf with the switch read (its own shop-bound read) for a seat of the firm: one statement, only for a person who is neither partner nor manager */
async function verdictFor(req) {
  const { isManager } = require('./owner');
  const entity = req.identity && (req.identity.parent_entity_id || req.identity.identity_id);
  const seat = !isManager(req) && isHoldingSeat(req);
  return verdictOf(req, { pickUp: seat ? await require('../db').withEntity(entity, (db) => pickUpOn(db, entity)) : false });
}

/**
 * jobRefusalOf(db, req, { entity_id, chit_id, action, holder_id }) → null | { status: 403, code: 'CHIT_NOT_PERMITTED', words } — the SAME rule as the bulk door, at the single door PUT /actors/assign/:chit_id (DECISIONS-SLICE1 §1):
 * for a JOB chit (business_json.job) whose plug's may_assign is above `any`: pull = self only, by any person who may take work (A claims a client); push, hand-over or return to the pool = the partner, a manager,
 * or the CURRENT holder (A hands to B with a note). A task chit (no marker) is untouched: today's rule. One read of the marker; the hat is read from req.identity, never from the body.
 */
async function jobRefusalOf(db, req, { entity_id, chit_id, action, holder_id }) {
  const found = await db.query(`SELECT business_json -> 'job' ->> 'plug' AS plug FROM chit_header WHERE chit_id = $1 AND entity_id = $2 AND business_json ? 'job' LIMIT 1`, [chit_id, entity_id]);
  if (!found.rows.length) return null;
  const level = levelOf(found.rows[0].plug);
  if (level === 'any') return null;
  const { mayAt, MANAGER_ONLY_WORDS } = require('./owner');
  if (action === 'pull') return mayAt(req, level).ok || (await pickUpOn(db, entity_id)) ? null : { status: 403, code: 'ASSIGN_PICKUP_OFF', words: 'Your practice has turned off picking up clients. Ask the partner or a manager to assign.' }; /* W17: the one switch, at the single door too */
  if (mayAt(req, level).ok || (holder_id && String(holder_id) === String(req.identity.identity_id))) return null;
  return { status: 403, code: 'CHIT_NOT_PERMITTED', words: MANAGER_ONLY_WORDS };
}

/**
 * jobMarkerRefusal(business_json, viaJobsOpen) → null | { status: 403, code: 'CHIT_NOT_PERMITTED', words } — the job marker is minted ONLY by lib/jobs-open (its send runs under the shop's own 60-second kind 'auto' token),
 * never taken from a person's input: a chit a person sends that carries `business_json.job` is refused whole (PULLFIX, Fable review 1118V2 finding 1). `viaJobsOpen` = res.locals.kind === 'auto'.
 */
function jobMarkerRefusal(business_json, viaJobsOpen) {
  if (viaJobsOpen || !business_json || typeof business_json !== 'object' || !Object.prototype.hasOwnProperty.call(business_json, 'job')) return null;
  return { status: 403, code: 'CHIT_NOT_PERMITTED', words: 'A job is opened with Open jobs, not sent as a chit.' };
}

/**
 * Athi 21 Nov: a NEW firm (its settings row made now) starts on client_access = 'assigned' (a seat sees its own clients and the unassigned); a row that was
 * already there keeps its stored value. The column default stays 'all' (b881, no SQL here), so the new row is set right after it is made. Reads the column list first:
 * a database before b881 has no column and the firm runs as before (a failed UPDATE would abort the transaction).
 */
async function newFirmAccess(shop, entityId) {
  const has = (await shop.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'entity_actor_settings' AND column_name = 'client_access'`)).rows.length > 0;
  if (has) await shop.query(`UPDATE entity_actor_settings SET client_access = 'assigned' WHERE entity_id = $1`, [entityId]);
  return has;
}
/** the first read of a firm's settings makes the default row, a new firm on assigned; answers the row as a query result */
async function newFirmRow(shop, entityId) {
  await shop.query(`INSERT INTO entity_actor_settings (entity_id) VALUES ($1)`, [entityId]);
  await newFirmAccess(shop, entityId);
  return shop.query(`SELECT * FROM entity_actor_settings WHERE entity_id = $1`, [entityId]);
}
module.exports = { newFirmAccess, newFirmRow, pickUpOn, pickUpOf, verdictFor, jobMarkerRefusal, jobRefusalOf, REGISTER, KEYS, LEVELS, WORDS, OPENERS, entryOf, levelOf, stricter, holds, holdsAmong, holdersAmong, clientAccessSql, clientAccessOf, mayReadJobThread, GATED_PLUGS, verdictOf, expansionOf };
