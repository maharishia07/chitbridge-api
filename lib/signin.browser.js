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

/**
 * ⭐ what to send, in the shape /api/entities/register and /verify already take — no second vocabulary
 *
 * ⚠️⚠️⚠️ [capability: sign-in] mode:'login' — Athi, 2026-09-23: *"even if i give the wrong id, it is not
 * verifying the user id... it is not the same logic we have in the backend sign in procedure."*
 *
 * He is exactly right, and the backend already HAS the right logic — it was simply never asked for. /register
 * is a REGISTER-OR-LOGIN endpoint: an email it does not recognise is treated as a brand-new business signing
 * up, and one is silently created (`else if (req.body.mode === 'login') { refuse } else { create }`). Signing
 * a PERSON IN at a counter is never that — a mistyped id should say so, not spin up a phantom empty shop.
 * `req.body.mode === 'login'` is the ONE flag that turns "create if missing" into "refuse if missing", and it
 * has been sitting in routes/entities.js unused by this file since the day it was written. This is the sign-in
 * dialog's only caller of ask() (usignAsk() in till.html) — the device-connect dialog builds its own body via
 * a completely separate path (signinSend(), /api/signin/start) and is unaffected by this change.
 */
function ask(input) {
  const w = who(input);
  if (!w.ok) return { ok: false, why: w.why };
  const body = { mode: 'login' };
  body[w.field] = w.value;
  return { ok: true, body: body, kind: w.kind,
           say: w.kind === 'email' ? ('A code is on its way to ' + w.value + '.')
                                   : ('A code is on its way to the address registered for ' + w.value + '.') };
}

/**
 * ⚠️⚠️ [capability: sign-in] FOUR DIGITS OR SIX, AND NOTHING ELSE COUNTS AS TRYING. A coassist who already
 * set a PIN types 4; a first sign-in, entity or coassist, types the 6-digit code the shop shared. One box on
 * screen serves both — see lib/identity-auth.js's verifyCredential(), which decides server-side which one a
 * given identity actually needs. The length typed here is enough to say which this is; nothing here guesses,
 * a 5-digit string is simply unfinished, whichever one it turns out to be.
 */
function code(input) {
  const d = String(input == null ? '' : input).replace(/[^0-9]/g, '');
  if (!d) return { ok: false, value: '', why: 'Type your PIN, or the code if this is a first sign-in.' };
  if (d.length !== 4 && d.length !== 6) return { ok: false, value: d, why: 'A PIN is four digits; a first-time code is six.' };
  return { ok: true, value: d, isPin: d.length === 4 };
}

function verify(input, credential) {
  const a = ask(input);
  if (!a.ok) return a;
  const c = code(credential);
  if (!c.ok) return { ok: false, why: c.why };
  const key = c.isPin ? 'pin' : 'otp';
  return { ok: true, body: Object.assign({}, a.body, { [key]: c.value }) };
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

/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
 * ── ⭐⭐⭐ FOUR DOORS, AND THE SAME TWO WORDS WERE PAINTED ON THREE OF THEM ([TILL-187]) ────────────────────
 *
 * Athi: *"There is a real confusion in sign-in procedure in the counter application, can you find out in how
 * many places this procedure exists."*
 *
 * The audit is in docs/counter-signin.md. The short version is that a counter has FOUR acts, all of which a
 * shopkeeper would call "signing in", and until this section existed each one decided for itself what to call
 * itself and which screen to open. Pressing the header button, the ⚙ Settings button and the alert strip —
 * all three labelled "Sign in" — opened three different dialogs, and the morning's own who-is-here step
 * opened a fourth thing that is not a sign-in at all.
 *
 *   ┌ connect ─ a DEVICE is given a KEY.  Once per PC, needs the line, ends in a restart.        [TILL-121]
 *   ├ key ───── a KEY is PASTED in.       The browser counter's only way in — it cannot pair.
 *   ├ signin ── a PERSON proves who they are. Every shift, needs the line, leaves no session.    [TILL-183]
 *   └ handover─ a PERSON hands to another.    Every shift, needs NOTHING, the counter keeps its number.
 *
 * ⚠️⚠️⚠️ WHICH ONE A BUTTON MEANS IS NOT A PROPERTY OF THE BUTTON. It is decided by what the counter is
 * holding at that moment — a key or not, a person or not, a browser or a shop PC — which is exactly why it
 * cannot be written into the label at design time, and exactly why three labels drifted apart. The page asks
 * door() and paints the answer. One rule, one place, and it can be tested without a browser.
 * [[feedback-ui-replaceable-logic-in-engines]] [[feedback-no-duplicate-functions]]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ⭐ the four acts, each with the word that belongs on it. `line` is whether it can be done with the internet
 * down — and the two that CAN are the two that a shop needs in the middle of a busy afternoon, which is not a
 * coincidence: [[project-counter-identity]] the counter fetches an identity, never a session.
 */
const ACTS = {
  connect:  { id: 'connect',  subject: 'device', label: 'Connect this counter', how: 'per PC, once',
              line: true,  leaves: 'a key on this PC', then: 'the counter program restarts' },
  /**
   * ⚠️⚠️⚠️ [TILL-193] THE LABEL SAYS WHAT A SHOPKEEPER DOES, NOT WHAT THE PAGE DOES. Athi, live: "we cannot
   * showcase paste a key at all to the user, he will not understand... if it is not mapping, then say that
   * due to maintenance, signout and sign-in again is required... sign-in again and upload a new key as long
   * as the user is authorised." The button never actually opened a paste box — clicking it has always called
   * pairAgain(), which opens the SAME email/OTP sign-in as 'signin' and re-mints the key behind it
   * ([TILL-192]). "Paste a key" described a manual step this door has not been for some time; the label now
   * describes the step the person actually takes.
   */
  key:      { id: 'key',      subject: 'device', label: 'Sign in again',        how: 'per browser, once',
              line: false, leaves: 'a key in this browser', then: 'the page starts again' },
  signin:   { id: 'signin',   subject: 'person', label: 'Sign in',              how: 'every shift',
              line: true,  leaves: 'who you are, and no session', then: 'the counter keeps its number' },
  handover: { id: 'handover', subject: 'person', label: 'Hand over',            how: 'every shift',
              line: false, leaves: 'the next person on the bills', then: 'the counter keeps its number' },
};

/** ⭐ and the two ways out, which were also one word over two different acts */
const LEAVES = {
  person: { id: 'person', subject: 'person', label: 'Sign out', how: 'end of a shift',
            line: false, costs: 'nothing — the counter stays open and keeps billing' },
  device: { id: 'device', subject: 'device', label: 'Sign this PC out of the shop', how: 'rare',
            line: true,  costs: 'this PC stops billing; unsent bills must go first' },
};

/**
 * ⚠️⚠️ WHAT THE ONE BUTTON MEANS, read from what the counter holds.
 *
 * `state` is everything it takes, and it is deliberately four plain facts rather than a page object:
 *   host    'agent' (the shop PC program) or 'browser'   — a browser cannot pair, so its door is different
 *   paired  is there a key on this device at all
 *   till    does that key carry the `till` scope        — a connector key is not a counter key ([TILL-117])
 *   person  is somebody standing here                   — decides person-door vs device-door
 *   online  is the line up right now
 *
 * ⚠️ THE ORDER IS THE RULE. A counter with no key has a bigger problem than a counter with nobody on it, and
 * offering a shift handover to a counter that cannot bill would be the same dead end in a new coat.
 */
function door(state) {
  const s = state || {};
  const browser = s.host === 'browser';
  const online = s.online !== false;
  const out = (act, why) => {
    const a = ACTS[act];
    return { act: act, label: a.label, subject: a.subject, how: a.how, why: why || '',
             /* ⚠️ blocked is not "hidden". A door that cannot be opened is still the right door, and saying
                which one it is beats a screen that offers nothing. [[feedback-silence-is-the-bug]] */
             blocked: !!(a.line && !online),
             stop: (a.line && !online) ? 'This needs the internet. Once this counter is set up it bills without it.' : '' };
  };
  /**
   * ⚠️⚠️⚠️ [TILL-193] NEITHER "why" BELOW SAYS THE WORD KEY ANY MORE — a shopkeeper never typed one and
   * would not know what it meant if refused. Both explanations say the same plain thing on purpose: whether
   * this browser has never connected or is holding one the shop just refused, the fix is identical (sign in
   * again), and a shopkeeper does not need to tell the two apart to act on it. [[feedback-assume-they-cannot-read]]
   */
  if (!s.paired) {
    return browser
      ? out('key', 'Due to maintenance, please sign in again to reconnect this counter.')
      : out('connect', 'This counter has no key yet, so there is nothing to sell and nowhere to send a bill.');
  }
  if (s.till === false) {
    return browser
      ? out('key', 'Due to maintenance, please sign in again to reconnect this counter.')
      : out('connect', 'This key is not a till key, so it cannot read the shop or send a bill.');
  }
  if (!s.person) return out('signin', 'Nobody is signed in, so every bill would be recorded against no one.');
  return out('handover', 'Somebody is on this counter. The counter number stays; only the person changes.');
}

/**
 * ⚠️ AND WHICH WAY OUT. "Sign out" on the person block ends a shift; "Sign out" in ⚙ Settings hands the whole
 * PC back. One of those stops a shop billing and the other does not, and they were the same two words.
 */
function leave(state) {
  const s = state || {};
  const l = (s.subject === 'device') ? LEAVES.device : LEAVES.person;
  return { act: l.id, label: l.label, subject: l.subject, costs: l.costs,
           blocked: !!(l.line && s.online === false),
           stop: (l.line && s.online === false)
             ? 'Sending anything still waiting needs the internet. Bills would be left on this PC.' : '' };
}

var EXPORTS = { STAGES, ACTS, LEAVES, who, ask, code, verify, keep, refusal, stage, say, door, leave };

window.CBSignin = EXPORTS;
})();
