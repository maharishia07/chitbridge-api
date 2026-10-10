'use strict';
/**
 * lib/people.js — P1: THE SHOP'S PEOPLE, WITH WHAT THIS LOGIN MAY DO TO EACH. Pure; no DB, no network.
 *
 * Athi, 2026-10-10: *"hide the hard part and make it very easy."* The screen shows five actions on every person and the
 * SERVER says which are open and why not. It decides nothing new: the rules below are the ones routes/actors.js already
 * enforces (owner only · a person who is off cannot be given a code · cover needs someone else on) — read once, here, so
 * the screen never carries a copy. routes/actors.js still refuses on its own; this only tells the screen first.
 * Reuses: lib/access.js (levelOf · PRESETS), lib/employee-code.js (refusal — the sealed/no-e-mail case), lib/owner.js.
 */
const access = require('./access');
const empCode = require('./employee-code');
const mintuserid = require('./mintuserid');   // the ONE builder of an employee id — a stored one is shown as is, a missing one is built the same way

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
function view(rows, { owner }) {
  const standIns = rows.filter((r) => stateOf(r.break_status) !== 'off' && access.canEdit({ identity_type: 'actor', access_level: r.access_level, hat: r.hat }));
  const people = rows.map((r) => {
    const state = stateOf(r.break_status);
    const level = access.levelOf({ identity_type: 'actor', access_level: r.access_level, hat: r.hat });
    const whole = r.whole_entity === true;
    const costs = r.can_see_costs === true;
    const off = state === 'off';
    const options = standIns.filter((o) => o.identity_id !== r.identity_id).map((o) => ({ id: o.identity_id, name: o.display_name }));
    const covered = r.delegate_actor_id ? rows.find((o) => o.identity_id === r.delegate_actor_id) : null;
    let pin = ok();
    if (off) pin = no('Switched off. Switch on first.');
    else { const refused = empCode.refusal(r.has_email ? 'x@x.x' : ''); if (refused) pin = no('Add an e-mail first, the code is sent there.'); }
    const may = {
      access: ok(),
      reset_pin: pin,
      switch: Object.assign(ok(), { to: off ? 'on' : 'off' }),
      cover: off ? no('Switched off.') : options.length ? ok() : no('No one else to stand in.'),
    };
    if (!owner) for (const k of Object.keys(may)) may[k] = Object.assign(no(OWNER_ONLY), k === 'switch' ? { to: may[k].to } : {});
    return {
      id: r.identity_id,
      name: r.display_name,
      user_id: r.user_id || (r.actor_key && r.entity_handle ? mintuserid.employee(r.actor_key, { user_id: r.entity_handle }).handle || null : r.actor_key || null),
      actor_key: r.actor_key,
      role: r.actor_role || null,
      phone: r.phone || null,
      state,
      access: { level, label: accessWords(level, whole, costs), whole_entity: whole, can_see_costs: costs },
      last_at: r.last_active_at || null,
      jobs: Number(r.current_task_count) || 0,
      cover: covered ? { id: covered.identity_id, name: covered.display_name } : null,
      cover_options: may.cover.ok ? options : [],
      may,
    };
  });
  const counts = { on: people.filter((p) => p.state !== 'off').length, off: people.filter((p) => p.state === 'off').length };
  /* what the 'What they can do' picker offers — the PRESETS the IAM lib already names, so the screen carries no list of its own */
  const access_choices = access.PRESETS.map((x) => ({ key: x.key, label: x.label, level: x.level, whole_entity: x.whole_entity, can_see_costs: x.can_see_costs, why: x.why }));
  return { people, may: { add: owner ? ok() : no(OWNER_ONLY) }, counts, access_choices };
}

/** the Add-a-person form's whole read: may.add + the picker, no people (GET /api/people?for=add — no query at all) */
function addView({ owner }) {
  const v = view([], { owner });
  return { may: v.may, access_choices: v.access_choices };
}

module.exports = { view, addView, accessWords, stateOf, OWNER_ONLY };
