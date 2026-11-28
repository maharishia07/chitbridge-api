// OWNS      the shop's people list: each person with what this login may do to them and why (view · addView · accessWords · payrollWord · stateOf · peopleSql)
'use strict';
/**
 * lib/people.js — P1: THE SHOP'S PEOPLE, WITH WHAT THIS LOGIN MAY DO TO EACH. Pure; no DB, no network.
 *
 * Athi, 2026-10-10: *"hide the hard part and make it very easy."* The screen shows five actions on every person and the
 * SERVER says which are open and why not. It decides nothing new: the rules below are the ones routes/actors.js already
 * enforces (owner only · a person who is off cannot be given a code · cover needs someone else on) — read once, here, so
 * the screen never carries a copy. routes/actors.js still refuses on its own; this only tells the screen first.
 * Reuses: lib/access.js (levelOf · PRESETS), lib/employee-code.js (refusal — the sealed/no-e-mail case), lib/owner.js.
 
 * FLOW   rows (identities + the last code_issued trail row) → view() → people[] with may/why per action
 * CARD 17-people-employees-hr-and-payroll/people-list-with-may-why
 * CALLED BY lib/home-facts.js, routes/people.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
const access = require('./access');
const empCode = require('./employee-code');
const handle = require('./handle'); // typedForm: the display form of a sign-in name (O4)
const mintuserid = require('./mintuserid'); // the ONE builder of an employee id — a stored one is shown as is, a missing one is built the same way

const LEVEL_WORDS = { viewer: 'Looks only', commenter: 'Looks and notes', editor: 'Does the work' };
const OWNER_ONLY = 'Only the owner can change people.';
const ok = () => ({ ok: true, why: null });
const no = (why) => ({ ok: false, why });

/** the words for what a person can do: a named preset when the three facts match one, else the level */
function accessWords(level, whole, costs, firm, hat) {
  const preset = access.presetFor(level, whole, costs, firm, hat) || (firm ? access.presetFor(level, whole, costs, false, hat) : null);
  return preset ? preset.label : LEVEL_WORDS[level] || LEVEL_WORDS.editor;
}

/** on · away (short break / leave) · off (switched off) */
function stateOf(breakStatus) {
  if (breakStatus === 'deactivated') return 'off';
  if (breakStatus === 'short_break' || breakStatus === 'leave') return 'away';
  return 'on';
}

/** may.reset_pin for a person who is on: open, unless a sealed shop with no e-mail sender cannot mail a code to an address on file (no e-mail on file = the owner is shown the code, R112) */
function resetWord(hasEmail) {
  const refused = empCode.refusal(hasEmail ? 'x@x.x' : '');
  return refused ? no(refused.body.message) : ok();
}

/** the last code_issued trail row of a person: who gave it, when, and how ('screen' = read off the owner's screen, 'email' = mailed); null when none — never the code */
/** the stored sign-in name of a row: the column, or the one builder's answer when the row has none yet */
const storedHandle = (item) =>
  item.user_id ||
  (item.actor_key && item.entity_handle ? mintuserid.employee(item.actor_key, { user_id: item.entity_handle }).handle || null : item.actor_key || null);
const codeGiven = (item) => (item.code_at ? { by: item.code_by || null, at: item.code_at, channel: item.code_channel || null } : null);

/**
 * view(rows, { owner, sealed }) → { people, may, counts }
 * rows: identities rows (human actors of one shop, not removed) with `entity_handle` (the owner's user_id) and `has_email`.
 * owner: is this login the owner (lib/owner.isOwner) — everything else is greyed with the owner-only sentence.
 */
function view(rows, { owner, country, firm }) {
  const standIns = rows.filter(
    (item) => stateOf(item.break_status) !== 'off' && access.canEdit({ identity_type: 'actor', access_level: item.access_level, hat: item.hat })
  );
  const people = rows.map((item) => {
    const state = stateOf(item.break_status);
    const level = access.levelOf({ identity_type: 'actor', access_level: item.access_level, hat: item.hat });
    const whole = item.whole_entity === true;
    const costs = item.can_see_costs === true;
    const off = state === 'off';
    const options = standIns.filter((o) => o.identity_id !== item.identity_id).map((entry) => ({ id: entry.identity_id, name: entry.display_name }));
    const covered = item.delegate_actor_id ? rows.find((o) => o.identity_id === item.delegate_actor_id) : null;
    const pin = off ? no('Switched off. Switch on first.') : resetWord(item.has_email);
    const may = {
      access: ok(),
      email: ok(), // SEC2 · PEOPLE-EMAIL: where the first code and every reset go (PATCH /api/actors/:id { email })
      reset_pin: pin,
      switch: Object.assign(ok(), { to: off ? 'on' : 'off' }),
      cover: off ? no('Switched off.') : options.length ? ok() : no('No one else to stand in.'),
      /* PEOPLE-SRV1 (G6): the owner marks someone away / back (PUT /api/actors/break { actor_id }); a switched-off person is neither */
      away: off ? Object.assign(no('Switched off.'), { to: null }) : Object.assign(ok(), { to: state === 'away' ? 'on' : 'away' }),
      /* PEOPLE-SRV1 (G4): Remove (PUT /api/actors/:id/status { action:'remove', confirm:'REMOVE' }) — signs them out everywhere;
         their name stays on the work they did, and their sign-in name is never given to anyone else */
      remove: ok()
    };
    if (!owner) for (const k of Object.keys(may)) may[k] = Object.assign(no(OWNER_ONLY), 'to' in may[k] ? { to: may[k].to } : {});
    return {
      id: item.identity_id,
      name: item.display_name,
      user_id: storedHandle(item),
      sign_in_as: handle.typedForm(storedHandle(item)) /* O4: what they type at sign-in, no .br — the one field every screen shows */,
      actor_key: item.actor_key,
      role: item.actor_role || null,
      phone: item.phone || null,
      /* SEC2: the address is the owner's to see and change — a colleague reading this list gets null (has_email still says whether one is on file) */
      email: owner ? item.email || null : null,
      has_email: !!item.has_email,
      /* R112: who gave the last first code, and when — read from the code_issued trail row, the owner's to see ('screen' = read off the owner's screen, 'email' = mailed); never the code */
      code_given: owner ? codeGiven(item) : null,
      state,
      /* G6: which kind of away — 'short_break' or 'leave' (identities.break_status), null when on or off */
      away: state === 'away' ? item.break_status : null,
      access: { level, label: accessWords(level, whole, costs, firm, item.hat), whole_entity: whole, can_see_costs: costs },
      last_at: item.last_active_at || null,
      jobs: Number(item.current_task_count) || 0,
      cover: covered ? { id: covered.identity_id, name: covered.display_name } : null,
      cover_options: may.cover.ok ? options : [],
      may
    };
  });
  const counts = {
    on: people.filter((item) => item.state !== 'off').length,
    off: people.filter((item) => item.state === 'off').length,
    away: people.filter((item) => item.state === 'away').length
  }; /* G5: away is inside `on` (not switched off) — the Home card says it */
  /* what the 'What they can do' picker offers — the PRESETS the IAM lib already names, so the screen carries no list of its own */
  const access_choices = (firm ? access.PRACTICE_PRESETS : access.PRESETS).map((x) => ({
    key: x.key,
    label: x.label,
    level: x.level,
    whole_entity: x.whole_entity,
    can_see_costs: x.can_see_costs,
    ...(x.hat ? { hat: x.hat } : {}) /* a pinned seat (Bookkeeper): the screen sends this hat beside the level */,
    why: x.why
  }));
  return { people, may: { add: owner ? ok() : no(OWNER_ONLY) }, counts, access_choices, payroll: payrollWord(country) };
}

/**
 * CX6 (E1) · PAYROLL IS SAID, NOT SILENT. Every country pack lists payroll under `scope.out` (reg-in PF·ESI·TDS, reg-au PAYG·super·STP,
 * reg-ae) — the pack decides; this file names no country. Its sentence is written for developers, so the screen gets one shopkeeper line;
 * a pack that one day runs payroll drops `scope.out.payroll` and the line goes. No pack known (country unset) = payroll is nowhere yet: said.
 */
const PAYROLL_OUT = 'Pay and payroll filings are not done in ChitBridge yet. Keep paying your people the way you do now.';
function payrollWord(country) {
  const p = country ? require('./regulation').packFor(String(country)) : null;
  const out = !p || !!(p.scope && p.scope.out && p.scope.out.payroll);
  return out ? { here: false, said: PAYROLL_OUT } : { here: true, said: null };
}

/**
 * ownTradeSql(entityRef) — THE ONE "this entity trades for itself" test (a SQL boolean on an entity id expression): it has a chit of its own that is NOT a job (a practice's own client jobs are chits it SENT, business_json.job, and are its work, not a trade: W13, walk 19 Nov: once a firm assigned a client it was read as a shop and offered Counter staff) or a payment of its own.
 * Read by firmSql (the Add-a-person words) and by lib/books-practice (own_trade on the practice list): one rule, never two.
 */
const ownTradeSql = (entityRef) => `(EXISTS (SELECT 1 FROM chit_header oh WHERE oh.entity_id = ${entityRef} AND NOT (oh.business_json ? 'job')) OR EXISTS (SELECT 1 FROM books_payment ob WHERE ob.entity_id = ${entityRef}))`;

/**
 * firmSql(a) — A PRACTICE, as one SQL fragment on the entity row alias `a`: it holds clients by books grants and has no trade of its own (the same data rule as lib/books-practice own_trade).
 * Decides only which WORDS the picker uses (PRACTICE_PRESETS); the levels and every check are unchanged.
 */
const firmSql = (a) => `(${require('./books-grant').heldAnyGrantSql(a + '.identity_id')} AND NOT ${ownTradeSql(a + '.identity_id')})`;

/** the Add-a-person form's whole read: may.add + the picker, no people (GET /api/people?for=add — no query at all) */
function addView({ owner, firm }) {
  const v = view([], { owner, firm });
  return { may: v.may, access_choices: v.access_choices };
}

/**
 * peopleSql(a) — WHO "THE SHOP'S PEOPLE" ARE, one SQL fragment on identities alias `a`: human co-assists not removed (a connector
 * or AI actor is not a person; a removed person is history). GET /api/people (routes/people.js) and the Home card
 * (lib/home-facts people) both read it, so the card's count is the list's length. The shop is filtered by the caller.
 */
const peopleSql = (a) => `${a}.identity_type = 'actor' AND COALESCE(${a}.actor_type, 'human') = 'human' AND ${a}.break_status IS DISTINCT FROM 'removed'`;

/**
 * practiceOf(entity_id, identity_id) → true when this shop is a PRACTICE (a firm: holds books grants, no trade of its own: firmSql, the ONE rule) — a small read in the shop's own scope (R112). Used by the Add-a-person view and by GET /api/entities/me (`is_practice`, so a practice employee can land on the practice list). A failed read is null, never a guess.
 */
async function practiceOf(entity_id, identity_id) {
  try {
    const [answer] = await require('../db').readBatch(entity_id, identity_id, [{ text: `SELECT ${firmSql('e')} AS firm FROM identities e WHERE e.identity_id = $1`, params: [entity_id] }]);
    return !!(answer.rows[0] && answer.rows[0].firm);
  } catch (err) {
    require('./logger').fellBack('people: the practice read failed, answered unknown', err);
    return null;
  }
}

module.exports = { ownTradeSql, practiceOf, view, addView, firmSql, payrollWord, accessWords, stateOf, peopleSql, OWNER_ONLY };
