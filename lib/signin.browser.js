/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
'use strict';
// @stage tested
// @stage-note [TILL-183] The rules of signing a PERSON in, with no surface attached. The counter calls them
// @stage-note through window.CBSignin; the back office can call the same file; tests/signin.test.js runs every
// @stage-note branch with no browser and no network. The HTTP calls themselves belong to whoever is painting.
/**
 * lib/signin.js — SIGNING A PERSON IN. One rule set, no surface, callable from anywhere.
 *
 * ── ⚠️⚠️⚠️ WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * Athi, on clicking "Sign in" at a counter and getting a name picker: *"the counter is empty, now it has to
 * allow the user and provide a counter number? the user could be entity or employee, what we need is a user id
 * screen same as our back office, much simpler, so someone can sign-in? where is the problem here?"*
 *
 * The problem was that three different things shared one word.
 *   · PAIRING A DEVICE — user id and a code, once, and what it leaves behind is a KEY on that PC ([TILL-121]).
 *     A person arriving for a shift should never meet it.
 *   · A NAME ON A BILL — openWho(), a picker whose own last line admits *"it is not a sign-in"*. The header
 *     button was wired to this, so the most prominent control on the screen was mislabelled.
 *   · SIGNING A PERSON IN — which had never been built at all. There was no authenticated person anywhere in
 *     the counter, only a label typed onto bills.
 *
 * ── ⭐⭐⭐ AND IT IS NOT THE BACK OFFICE'S ───────────────────────────────────────────────────────────────────
 *
 * Athi: *"we should not think backoffice engine, tightly coupled, it should be independent and also can be
 * called from the backoffice."*
 *
 * So the rules live here and the SURFACE decides what to keep afterwards — which is the only part that really
 * differs between the two, and it differs for a reason worth stating:
 *   · the back office keeps a SESSION, because it is a thing you use while connected.
 *   · a counter keeps the IDENTITY AND NO SESSION, because a session that expires at noon would stop a shop
 *     billing at noon. Signing in fetches who you are; it does not leave a thing that can lapse.
 *     [[project-counter-identity]] [[project-user-id-rule]]
 *
 * ⚠️ NOTHING HERE MAKES A REQUEST. It says what to ask for and what an answer means; the page or the server
 * does the asking. That is what lets the identical rules run in a browser, on a shop PC and in node.
 */

/** ⭐ the stages, in order. Each is a thing a person is looking at, and each has one sentence. */
const STAGES = ['who', 'code', 'in', 'refused'];

/**
 * ⚠️⚠️ ONE RULE FOR A USER ID AND AN EMAIL, because the person typing does not know which of the two they
 * have — a network-minted store is issued a user_id and no email at all, and requiring an address would make
 * that credential unable to log in. /api/entities/verify already accepts either; this decides which was typed.
 */
function who(input) {
  const v = String(input == null ? '' : input).trim();
  if (!v) return { kind: '', value: '', ok: false, why: 'Type your user ID or the email you signed up with.' };
  if (v.indexOf('@') >= 0) {
    /* ⚠️ not a full address grammar — the server owns that. This only decides which field to send it in. */
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)) return { kind: 'email', value: v, ok: false, why: 'That email does not look complete.' };
    return { kind: 'email', value: v.toLowerCase(), ok: true, field: 'email' };
  }
  if (v.length < 3) return { kind: 'user_id', value: v, ok: false, why: 'A user ID is at least three characters.' };
  return { kind: 'user_id', value: v, ok: true, field: 'user_id' };
}

/** ⭐ what to send, in the shape /api/entities/register and /verify already take — no second vocabulary */
function ask(input) {
  const w = who(input);
  if (!w.ok) return { ok: false, why: w.why };
  const body = {};
  body[w.field] = w.value;
  return { ok: true, body: body, kind: w.kind,
           say: w.kind === 'email' ? ('A code is on its way to ' + w.value + '.')
                                   : ('A code is on its way to the address registered for ' + w.value + '.') };
}

/** ⚠️ six digits, and nothing else counts as trying — a five-digit code is not a wrong code, it is unfinished */
function code(input) {
  const d = String(input == null ? '' : input).replace(/[^0-9]/g, '');
  if (!d) return { ok: false, value: '', why: 'Type the six-digit code.' };
  if (d.length !== 6) return { ok: false, value: d, why: 'The code is six digits.' };
  return { ok: true, value: d };
}

function verify(input, otp) {
  const a = ask(input);
  if (!a.ok) return a;
  const c = code(otp);
  if (!c.ok) return { ok: false, why: c.why };
  return { ok: true, body: Object.assign({}, a.body, { otp: c.value }) };
}

/**
 * ── ⭐⭐⭐ WHAT EACH SURFACE KEEPS ───────────────────────────────────────────────────────────────────────────
 *
 * The same answer, read two ways. A counter that stored the session would inherit its expiry, and the first
 * thing a shop would notice is billing stopping in the middle of an afternoon for no reason a shopkeeper can
 * see. So the counter takes the identity out of the answer and drops the rest on the floor, deliberately.
 */
function keep(surface, answer) {
  const a = answer || {};
  const id = a.identity || a.user || {};
  const person = {
    id: id.user_id || id.handle || id.identity_id || null,
    name: id.display_name || id.name || id.user_id || null,
    /* ⭐ entity or employee is the SAME PATH — both are identities with a user id. The kind is recorded
       because a day close that cannot tell "the owner ran the counter" from "Kumar ran it" is answering a
       different question from the one being asked. */
    kind: (id.identity_type === 'entity' || a.kind === 'entity') ? 'entity' : 'coassist',
    entity: a.entity_id || id.entity_id || null,
    at: a.at || null,
  };
  if (!person.id) return { ok: false, why: 'The shop answered, but without saying who you are.' };
  if (surface === 'session') return { ok: true, person: person, session: a.token || a.session || null };
  /* ⚠️ THE COUNTER'S ANSWER CARRIES NO TOKEN. Not "we forgot to store it" — it must not exist here. */
  return { ok: true, person: person, session: null };
}

/**
 * ⚠️⚠️ WHAT A REFUSAL MEANS, in a sentence somebody can act on. A code, a rate limit and an unknown user are
 * three different problems and "sign-in failed" is the same useless word for all three.
 * [[feedback-write-for-the-shopkeeper]]
 */
function refusal(r) {
  const s = Number((r && r.status) || 0);
  const m = String((r && (r.message || r.error)) || '');
  if (s === 429) return 'Too many tries. Wait a minute and ask for a new code.';
  if (s === 404 || /not found|no such/i.test(m)) return 'No account here with that user ID. Check it, or ask the owner to add you.';
  if (s === 401 || s === 403 || /otp|code/i.test(m)) return 'That code did not match. Ask for a new one.';
  if (s === 0) return 'Could not reach ChitBridge. Check the line and try again.';
  return m || 'That did not work. Try again.';
}

/** ⭐ the stage a screen should be painting, decided from what it holds rather than from a variable it sets */
function stage(s) {
  const st = s || {};
  if (st.person && st.person.id) return 'in';
  if (st.refused) return 'refused';
  if (st.sent) return 'code';
  return 'who';
}

/** ⭐ and the one sentence that goes with it */
function say(s) {
  const st = s || {};
  const at = stage(st);
  if (at === 'in') return (st.person.name || st.person.id) + ' is signed in.';
  if (at === 'refused') return st.refused;
  if (at === 'code') return 'A code was sent. It is six digits and it expires shortly.';
  return 'Sign in with your user ID or email.';
}

var EXPORTS = { STAGES, who, ask, code, verify, keep, refusal, stage, say };

window.CBSignin = EXPORTS;
})();
