'use strict';
/**
 * lib/people.js — P1: THE SHOP'S PEOPLE, WITH WHAT THIS LOGIN MAY DO TO EACH. Pure; no DB, no network.
 *
 * Athi, 2026-10-10: *"hide the hard part and make it very easy."* The screen shows five actions on every person and the
 * SERVER says which are open and why not. It decides nothing new: the rules below are the ones routes/actors.js already
 * enforces (owner only · a person who is off cannot be given a code · cover needs someone else on) — read once, here, so
 * the screen never carries a copy. routes/actors.js still refuses on its own; this only tells the screen first.
 * Reuses: lib/access.js (levelOf · PRESETS), lib/employee-code.js (refusal — the sealed/no-e-mail case), lib/owner.js.
 
 * CALLED BY lib/home-facts.js, routes/people.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
const access = require('./access');
const empCode = require('./employee-code');
const mintuserid = require('./mintuserid'); // the ONE builder of an employee id — a stored one is shown as is, a missing one is built the same way

const LEVEL_WORDS = { viewer: 'Looks only', commenter: 'Looks and notes', editor: 'Does the work' };
const OWNER_ONLY = 'Only the owner can change people.';
const ok = () => ({ ok: true, why: null });
const no = (why) => ({ ok: false, why });

/** the words for what a person can do: a named preset when the three facts match one, else the level */
function accessWords(level, whole, costs) {
  const p = access.PRESETS.find((x) => x.level === level && x.whole_entity === !!whole && x.can_see_costs === !!costs);
  return p ? p.label : LEVEL_WORDS[level] || LEVEL_WORDS.editor;
}

/** on · away (short break / leave) · off (switched off) */
function stateOf(breakStatus) {
  if (breakStatus === 'deactivated') return 'off';
  if (breakStatus === 'short_break' || breakStatus === 'leave') return 'away';
  return 'on';
}

/**
 * view(rows, { owner, sealed }) → { people, may, counts }
 * rows: identities rows (human actors of one shop, not removed) with `entity_handle` (the owner's user_id) and `has_email`.
 * owner: is this login the owner (lib/owner.isOwner) — everything else is greyed with the owner-only sentence.
 */
function view(rows, { owner, country }) {
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
    let pin = ok();
    if (off) pin = no('Switched off. Switch on first.');
    else {
      const refused = empCode.refusal(item.has_email ? 'x@x.x' : '');
      if (refused) pin = no(refused.body.message); // R112: only a person WITH an e-mail can be refused (a sealed shop with no sender); no e-mail = the owner is shown the code
    }
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
      user_id:
        item.user_id ||
        (item.actor_key && item.entity_handle ? mintuserid.employee(item.actor_key, { user_id: item.entity_handle }).handle || null : item.actor_key || null),
      actor_key: item.actor_key,
      role: item.actor_role || null,
      phone: item.phone || null,
      /* SEC2: the address is the owner's to see and change — a colleague reading this list gets null (has_email still says whether one is on file) */
      email: owner ? item.email || null : null,
      has_email: !!item.has_email,
      /* R112: who gave the last first code, and when — read from the code_issued trail row, the owner's to see ('screen' = read off the owner's screen, 'email' = mailed); never the code */
      code_given: owner && item.code_at ? { by: item.code_by || null, at: item.code_at, channel: item.code_channel || null } : null,
      state,
      /* G6: which kind of away — 'short_break' or 'leave' (identities.break_status), null when on or off */
      away: state === 'away' ? item.break_status : null,
      access: { level, label: accessWords(level, whole, costs), whole_entity: whole, can_see_costs: costs },
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
  const access_choices = access.PRESETS.map((x) => ({
    key: x.key,
    label: x.label,
    level: x.level,
    whole_entity: x.whole_entity,
    can_see_costs: x.can_see_costs,
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

/** the Add-a-person form's whole read: may.add + the picker, no people (GET /api/people?for=add — no query at all) */
function addView({ owner }) {
  const v = view([], { owner });
  return { may: v.may, access_choices: v.access_choices };
}

/**
 * peopleSql(a) — WHO "THE SHOP'S PEOPLE" ARE, one SQL fragment on identities alias `a`: human co-assists not removed (a connector
 * or AI actor is not a person; a removed person is history). GET /api/people (routes/people.js) and the Home card
 * (lib/home-facts people) both read it, so the card's count is the list's length. The shop is filtered by the caller.
 */
const peopleSql = (a) => `${a}.identity_type = 'actor' AND COALESCE(${a}.actor_type, 'human') = 'human' AND ${a}.break_status IS DISTINCT FROM 'removed'`;

module.exports = { view, addView, payrollWord, accessWords, stateOf, peopleSql, OWNER_ONLY };
