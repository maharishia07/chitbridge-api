/* ADOPTED from chitbridge-engines v1.29.0 · rail · sha256 62146650c1ae4e0aa47c16625026f2d29039c4d05261c191f899bd0213f1b698 — DO NOT EDIT HERE. Change it in chitbridge-engines, release a version, then run tools/adopt.cjs. */
/* chitbridge-engines · rail. Edited ONLY in chitbridge-engines/src/rail.js; every platform adopts a released version of it. */
(function (root) {
'use strict';
/**
 * ── ⭐⭐⭐ rail.js — MAY I DO THIS ON MY COPY OF THIS CHIT? ONE ANSWER, EVERY HOST (R01, 2026-10-07) ─────────────────────
 *
 * DESIGN-rail-modules-2026-10-05 §2.0: "eligibility is decided in three places and returned by none." The server routes
 * refused (participant / comment-only / transition table), the page pre-decided, and nothing answered "may I do X" before
 * X was tried. This file is the one place that decides. The api returns its answer as `chit.actions` on GET /chits/:id,
 * and every writing rail route asks the SAME functions before it writes — so a door that shows ✓ is a door that opens.
 *
 * ⚠️⚠️ NOTHING HERE IS A NEW PERMISSION. Every rule is a route's check that already existed, moved here with the SAME
 * outcome (R01 scope control):
 *   level ladder  lib/access.js canMessage / canRaiseDispute + the hat gate (viewer reads · commenter replies internally ·
 *                 editor writes) — access.js now asks byLevel() below
 *   held          "I hold a copy" — the participant / own-copy reads of PUT /status, POST /messages, /assign-lines, /amend
 *   received      PUT /status moves only MY RECEIVED copy (a sender's copy has none → 404 there)
 *   TRANSITIONS   the validTransitions table that lived inside routes/chits.js moveStatus, verbatim
 *
 * ⭐ PURE: no database, no clock, no require. Facts in, a verdict out:
 *   chit = { held: bool, received: '<status>' | null, sender: bool }   — facts about MY copy, read by the host
 *   me   = { level: 'viewer' | 'commenter' | 'editor', holder?: { holder, kind } }   — level from lib/access.levelOf;
 *          holder (req.till, M04) rides along so a future rule can name the key/person; no rule reads it today.
 *
 * ⭐ A VERDICT IS { ok: true } OR { ok: false, why } — `why` is ALWAYS a key of WHY. A host may not invent a refusal word;
 * the vocabulary is this table (tests/rail.test.js holds every refusal to it).
 */

/** the refusal words — the ONLY ones a rail route or the actions answer may use. Each with the sentence a person reads. */
const WHY = {
  not_participant: 'You do not hold a copy of this chit.',
  read_only:       'Your access is view-only. You can read this chit but not change it.',
  comment_only:    'Your access is comment-only. You can reply internally, but not act or answer the other party.',
  not_received:    'Only the copy you received moves through these steps.',
  wrong_step:      'This chit cannot move to that step from where it is now.',
  already_done:    'This chit is already at that step.',
};

/** the actions answered today — each one a route that already enforced it (see the header) */
const ACTIONS = ['accept', 'reject', 'complete', 'dispute', 'assign', 'amend', 'message_external', 'message_internal'];

/** the three status steps the action bar offers, and the status each moves my received copy to */
const STEP_OF = { accept: 'accepted', reject: 'rejected', complete: 'completed' };

/** from → the statuses my received copy may move to. Moved VERBATIM from routes/chits.js moveStatus (validTransitions). */
const TRANSITIONS = {
  pending:     ['in_progress', 'completed', 'accepted', 'rejected', 'cancelled'],
  delivered:   ['in_progress', 'completed', 'accepted', 'rejected', 'cancelled', 'pending'],
  read:        ['in_progress', 'completed', 'accepted', 'rejected', 'cancelled', 'pending'],
  accepted:    ['in_progress', 'completed', 'pending', 'rejected', 'cancelled'],
  in_progress: ['partial', 'completed', 'pending', 'accepted', 'cancelled'],
  partial:     ['in_progress', 'completed', 'pending', 'cancelled'],
  completed:   ['in_progress', 'pending'],
  rejected:    ['accepted', 'pending', 'in_progress', 'completed'],
  cancelled:   ['accepted', 'pending', 'in_progress', 'completed'],
};

const LEVELS = ['viewer', 'commenter', 'editor'];
const no = (why, extra) => Object.assign({ ok: false, why }, extra || {});
const YES = Object.freeze({ ok: true });

/**
 * byLevel(level, action) → null when the access level permits the action, else the refusal word.
 * ⚠️ An unknown level is a viewer (lib/access.levelOf never returns one; fail closed if a host ever passes one).
 *   viewer     reads; says nothing                         → read_only for every action
 *   commenter  replies INTERNALLY; acts on nothing         → message_internal only; the rest comment_only
 *   editor     everything
 */
function byLevel(level, action) {
  const lvl = LEVELS.includes(level) ? level : 'viewer';
  if (lvl === 'editor') return null;
  if (lvl === 'viewer') return 'read_only';
  return action === 'message_internal' ? null : 'comment_only';
}

/**
 * move(chit, me, to) — may MY received copy move to status `to`?
 *   { ok: true }                    write it
 *   { ok: true, noop: true }        it is already there (the route answers 200 "Already <to>" — idempotent)
 *   { ok: false, why, allowed? }    wrong_step carries the statuses it could move to
 * Order = the order the server refused in: the level (hat gate), then the copy, then the table.
 */
function move(chit, me, to) {
  const c = chit || {};
  const lv = byLevel(me && me.level, 'move');
  if (lv) return no(lv);
  if (!c.held) return no('not_participant');
  if (!c.received) return no('not_received');
  if (to === c.received) return { ok: true, noop: true };
  const allowed = TRANSITIONS[c.received] || [];
  return allowed.includes(to) ? YES : no('wrong_step', { allowed: allowed.slice() });
}

/** can(chit, me, action) — one action's verdict. An action not in ACTIONS is refused, never assumed. */
function can(chit, me, action) {
  const c = chit || {};
  if (!ACTIONS.includes(action)) throw new Error('rail.can: unknown action "' + action + '" — the actions are ' + ACTIONS.join(', '));
  if (STEP_OF[action]) {
    const m = move(c, me, STEP_OF[action]);
    return m.noop ? no('already_done') : (m.ok ? YES : no(m.why));
  }
  const lv = byLevel(me && me.level, action);
  if (lv) return no(lv);
  if (!c.held) return no('not_participant');
  return YES;
}

/** actions(chit, me) — the whole answer, one verdict per action: what GET /chits/:id returns as `actions`. */
function actions(chit, me) {
  const out = {};
  for (const a of ACTIONS) out[a] = can(chit, me, a);
  return out;
}

/** say(why) — the sentence for a refusal word; an unknown word is a bug in the host, said as one. */
function say(why) {
  if (!Object.prototype.hasOwnProperty.call(WHY, why)) throw new Error('rail.say: "' + why + '" is not a rail refusal word');
  return WHY[why];
}

const EXPORTS = { actions, can, move, byLevel, say, ACTIONS, WHY, TRANSITIONS, STEP_OF };

/* ⭐ ONE FILE, EVERY HOST: node takes module.exports; a page takes window.CBRail. */
if (typeof module !== 'undefined' && module.exports) module.exports = EXPORTS;
if (root && typeof root.window !== 'undefined') root.window.CBRail = EXPORTS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
