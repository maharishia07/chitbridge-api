'use strict';
/**
 * signin.test.js — SIGNING A PERSON IN, WITH NO SURFACE ATTACHED ([TILL-183]).
 *
 * Athi: *"what we need is a user id screen same as our back office, much simpler, so someone can sign-in?
 * where is the problem here?"* and *"we should not think backoffice engine, tightly coupled, it should be
 * independent and also can be called from the backoffice."*
 *
 * ⭐ THE CHECK THAT MATTERS MOST IS THE LAST SECTION. The counter and the back office get the SAME answer from
 * the SAME endpoint and keep different halves of it — and a counter that kept the session would inherit its
 * expiry, so a shop would stop billing in the middle of an afternoon for no reason anybody could see.
 *
 * Run: node tests/signin.test.js   · no DB, no browser, no network.
 */
const assert = require('assert');
const S = require('../lib/signin');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); }
  catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

console.log('\nWHO IS TYPING\n');

/**
 * ⚠️⚠️ ONE FIELD FOR BOTH, because the person typing does not know which they have. A network-minted store is
 * issued a user_id and NO email — requiring an address would make that credential unable to log in at all.
 */
it('⚠️⚠️ a user ID and an email go in the same box', () => {
  assert.strictEqual(S.who('bala').kind, 'user_id');
  assert.strictEqual(S.who('bala@mayur.in').kind, 'email');
  assert.strictEqual(S.who('  Bala@Mayur.IN  ').value, 'bala@mayur.in', 'an address was not tidied');
  assert.strictEqual(S.who('bala').ok, true);
});

it('and an empty one says what to type', () => {
  const r = S.who('   ');
  assert.strictEqual(r.ok, false);
  assert.ok(/user ID or the email/.test(r.why), r.why);
});

it('a half-typed address is caught before it is sent', () => {
  assert.strictEqual(S.who('bala@').ok, false);
  assert.strictEqual(S.who('bala@mayur').ok, false);
  assert.ok(/does not look complete/.test(S.who('bala@').why));
});

it('and a two-letter user ID is not one', () => {
  assert.strictEqual(S.who('ba').ok, false);
  assert.ok(/three characters/.test(S.who('ba').why));
});

console.log('\nWHAT IS SENT\n');

/** ⭐ the shape /api/entities/register and /verify already take — no second vocabulary invented here */
it('⭐ it sends the field the server already expects', () => {
  assert.deepStrictEqual(S.ask('bala').body, { user_id: 'bala' });
  assert.deepStrictEqual(S.ask('bala@mayur.in').body, { email: 'bala@mayur.in' });
});

it('and says where the code is going', () => {
  assert.ok(/on its way to bala@mayur.in/.test(S.ask('bala@mayur.in').say));
  /* ⚠️ a user ID has no visible address, so it must not promise one it cannot name */
  assert.ok(/registered for bala/.test(S.ask('bala').say));
});

/**
 * ⚠️⚠️ [capability: sign-in] MOVED, NOT DELETED — the codebase's own rule when behaviour changes on purpose.
 * These asserted the OLD wording, "six digits", as the only length code() would ever accept. Since
 * lib/identity-auth.js learned to accept a coassist's own PIN in place of a first-time OTP (2026-09-23), one
 * box now serves two lengths — four for a PIN, six for a code — and code() tells them apart by length alone,
 * because that is all a shopkeeper types before the server ever says which one this identity needed.
 * Five digits is still not a wrong code, it is an unfinished one either way, and saying "wrong" would send
 * somebody hunting.
 */
it('⚠️ an unfinished code is told apart from a wrong one', () => {
  assert.strictEqual(S.code('12345').ok, false);
  assert.ok(/four digits.*six/.test(S.code('12345').why));
  assert.strictEqual(S.code('123456').ok, true);
  assert.strictEqual(S.code('123 456').value, '123456', 'a space made a good code unusable');
  assert.ok(/PIN.*code/i.test(S.code('').why));
});

/** ⭐⭐ [capability: sign-in] THE NEW BRANCH — a 4-digit PIN is recognised as one, distinctly from a 6-digit
 *  first-time code, and neither is mistaken for "an unfinished" other. */
it('⭐⭐ a PIN and a first-time code are told apart by length, not guessed', () => {
  const pin = S.code('1234'), otp = S.code('123456');
  assert.strictEqual(pin.ok, true); assert.strictEqual(pin.isPin, true);
  assert.strictEqual(otp.ok, true); assert.strictEqual(otp.isPin, false);
});

it('and verify puts the two together', () => {
  assert.deepStrictEqual(S.verify('bala', '123456').body, { user_id: 'bala', otp: '123456' });
  assert.strictEqual(S.verify('bala', '12').ok, false);
  assert.strictEqual(S.verify('', '123456').ok, false);
});

/** ⭐⭐⭐ [capability: sign-in] AND A PIN GOES IN UNDER ITS OWN NAME — `pin`, never `otp`. The server tells
 *  the two apart by which key arrived, not by length a second time; this is the one place that decision is
 *  made, so it can never disagree with what usignPaint() drew on screen a moment earlier. */
it('⭐⭐⭐ a PIN is sent as pin, never as otp', () => {
  assert.deepStrictEqual(S.verify('bala', '1234').body, { user_id: 'bala', pin: '1234' });
});

/* ══ ⭐⭐⭐ THE PART THE TWO SURFACES DISAGREE ABOUT ═══════════════════════════════════════════════════════ */
console.log('\nWHAT EACH SURFACE KEEPS\n');

const answer = { token: 'sess_abc', entity_id: 'e1',
  identity: { user_id: 'bala', display_name: 'Bala', identity_type: 'coassist', identity_id: 'i1' } };

it('both get the same person out of the same answer', () => {
  const a = S.keep('session', answer), b = S.keep('counter', answer);
  assert.deepStrictEqual(a.person, b.person);
  assert.strictEqual(a.person.id, 'bala');
  assert.strictEqual(a.person.name, 'Bala');
});

/**
 * ⚠️⚠️⚠️ AND THE COUNTER KEEPS NO SESSION. Not an oversight — it must not exist there. A token that expires at
 * noon would stop a shop billing at noon, and the counter's entire reason for existing is that it does not stop.
 * [[project-counter-identity]]
 */
it('⚠️⚠️⚠️ the back office keeps a session and the counter does NOT', () => {
  assert.strictEqual(S.keep('session', answer).session, 'sess_abc');
  assert.strictEqual(S.keep('counter', answer).session, null, 'a counter was handed something that can expire');
});

/** ⭐ an owner and an employee are the same path — both are identities with a user id */
it('⭐ entity and employee both sign in, and are told apart', () => {
  const owner = S.keep('counter', { identity: { user_id: 'mayur', display_name: 'Mayur Bhavan', identity_type: 'entity' } });
  assert.strictEqual(owner.person.kind, 'entity');
  assert.strictEqual(S.keep('counter', answer).person.kind, 'coassist');
});

it('⚠️ and an answer with nobody in it is refused rather than stored', () => {
  const r = S.keep('counter', { token: 'sess_abc' });
  assert.strictEqual(r.ok, false);
  assert.ok(/without saying who you are/.test(r.why), r.why);
});

console.log('\nWHEN IT DOES NOT WORK\n');

/**
 * ⚠️⚠️ FOUR DIFFERENT PROBLEMS, FOUR DIFFERENT SENTENCES. "Sign-in failed" is the same useless word for a
 * mistyped code, an unknown user, too many tries and a dead line — and only one of those is the person's fault.
 */
it('⚠️⚠️ a refusal says which problem it is', () => {
  assert.ok(/Wait a minute/.test(S.refusal({ status: 429 })));
  assert.ok(/No account here/.test(S.refusal({ status: 404 })));
  assert.ok(/did not match/.test(S.refusal({ status: 401 })));
  assert.ok(/Check the line/.test(S.refusal({ status: 0 })));
});

it('and an unexpected one passes the server\'s own words through', () => {
  assert.strictEqual(S.refusal({ status: 500, message: 'The shop is suspended.' }), 'The shop is suspended.');
  assert.ok(S.refusal({}).length > 0, 'a refusal with nothing in it said nothing at all');
});

console.log('\nWHAT THE SCREEN IS SHOWING\n');

/** ⭐ the stage is DERIVED from what is held, never a variable a screen has to remember to set */
it('⭐ the stage is read, not set', () => {
  assert.strictEqual(S.stage({}), 'who');
  assert.strictEqual(S.stage({ sent: true }), 'code');
  assert.strictEqual(S.stage({ sent: true, refused: 'That code did not match.' }), 'refused');
  assert.strictEqual(S.stage({ sent: true, person: { id: 'bala', name: 'Bala' } }), 'in');
});

it('and every stage has a sentence', () => {
  S.STAGES.forEach((st) => {
    const s = st === 'in' ? { person: { id: 'bala', name: 'Bala' } }
            : st === 'refused' ? { refused: 'no' } : st === 'code' ? { sent: true } : {};
    assert.ok(S.say(s).length > 0, st + ' says nothing');
  });
  assert.ok(/Bala is signed in/.test(S.say({ person: { id: 'bala', name: 'Bala' } })));
});

/* ══ ⭐⭐⭐ WHICH DOOR THE BUTTON OPENS ([TILL-187]) ══════════════════════════════════════════════════════════
 *
 * Athi: *"There is a real confusion in sign-in procedure in the counter application... can you bring it as a
 * single module and create a flow chart, so it is well understood and can be tested."* This section is the
 * "can be tested" half: every branch of the flow chart in docs/counter-signin.md is a check below, and it
 * runs with no browser — which is the whole reason the rule was taken out of the page.
 */
console.log('\nWHICH DOOR THE BUTTON OPENS\n');

const AT = (o) => Object.assign({ host: 'agent', paired: true, till: true, person: true, online: true }, o);

/**
 * ⚠️⚠️⚠️ THE ORDER OF THE QUESTIONS IS THE RULE. A counter with no key has a bigger problem than a counter
 * with nobody on it — and the page used to ask only "is somebody on?", so an unpaired counter was offered a
 * shift handover between people it had never heard of.
 */
it('⚠️⚠️⚠️ a counter with no key is not offered a handover', () => {
  assert.strictEqual(S.door(AT({ paired: false, person: true })).act, 'connect');
  assert.strictEqual(S.door(AT({ paired: false, person: false })).act, 'connect');
});

it('⭐ a browser counter is given the key door, because it cannot pair', () => {
  assert.strictEqual(S.door(AT({ host: 'browser', paired: false })).act, 'key');
  assert.strictEqual(S.door(AT({ host: 'agent', paired: false })).act, 'connect');
});

/** ⚠️ a connector key is not a counter key — the only symptom used to be a 403 in a log nobody opens */
it('⚠️ a key of the wrong kind sends them back to the device door', () => {
  assert.strictEqual(S.door(AT({ till: false })).act, 'connect');
  assert.ok(/not a till key/.test(S.door(AT({ till: false })).why));
});

/** ⚠️⚠️ "we cannot tell from here" is not "the wrong kind of key" — offline, scopes are simply unknown */
it('⚠️⚠️ an unknown scope does not accuse the key', () => {
  assert.strictEqual(S.door(AT({ till: true, person: false })).act, 'signin');
});

it('⭐⭐ nobody on a working counter means SIGN IN, and somebody on means HAND OVER', () => {
  assert.strictEqual(S.door(AT({ person: false })).act, 'signin');
  assert.strictEqual(S.door(AT({ person: true })).act, 'handover');
});

/**
 * ⭐⭐⭐ THE FOUR LABELS ARE FOUR DIFFERENT WORDS. This is the defect itself: three of these read "Sign in"
 * on the screen, over three dialogs that do three unrelated things.
 */
it('⭐⭐⭐ no two doors carry the same word', () => {
  const words = Object.keys(S.ACTS).map((k) => S.ACTS[k].label);
  assert.strictEqual(new Set(words).size, words.length, words.join(' / '));
});

/**
 * ⚠️⚠️ THE TWO THAT WORK WITH THE LINE DOWN ARE THE TWO A SHOP NEEDS MID-AFTERNOON. Not a coincidence — it
 * is the counter-identity rule holding: an identity is fetched once, a shift changes all day.
 */
it('⚠️⚠️ handing over never needs the internet, and signing in does', () => {
  assert.strictEqual(S.door(AT({ person: true, online: false })).blocked, false);
  assert.strictEqual(S.door(AT({ person: false, online: false })).blocked, true);
  assert.ok(/needs the internet/.test(S.door(AT({ person: false, online: false })).stop));
});

/** ⚠️ blocked is not hidden. A door that cannot be opened yet is still the right door to name. */
it('⚠️ a blocked door still says which door it is', () => {
  const d = S.door(AT({ paired: false, online: false }));
  assert.strictEqual(d.act, 'connect');
  assert.strictEqual(d.blocked, true);
  assert.ok(d.label && d.why);
});

/** ⭐ and the way OUT was one word over two acts as well — one ends a shift, one stops the PC billing */
it('⭐ signing a person out and signing the PC out are told apart', () => {
  assert.strictEqual(S.leave({ subject: 'person' }).act, 'person');
  assert.strictEqual(S.leave({ subject: 'device' }).act, 'device');
  assert.notStrictEqual(S.leave({ subject: 'person' }).label, S.leave({ subject: 'device' }).label);
  assert.ok(/stays open/.test(S.leave({ subject: 'person' }).costs));
});

it('and only the one that sends bills is stopped by a dead line', () => {
  assert.strictEqual(S.leave({ subject: 'person', online: false }).blocked, false);
  assert.strictEqual(S.leave({ subject: 'device', online: false }).blocked, true);
});

/** ⚠️ nothing handed in at all must still answer — a door is asked for before the page knows anything */
it('⚠️ it answers for a counter that knows nothing about itself', () => {
  assert.ok(S.door().act);
  assert.ok(S.leave().act);
});

console.log('\nAND IT BELONGS TO NEITHER SURFACE\n');

/**
 * ⭐⭐⭐ Athi: *"it should be independent and also can be called from the backoffice."* If this file ever
 * reaches for a browser or makes its own request, it has picked a side — and the other surface gets a copy.
 */
it('⭐⭐⭐ it touches no DOM, no window, and makes no request of its own', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'signin.js'), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ['document', 'window', 'localStorage', 'fetch(', 'axios', 'require(\'http'].forEach((w) => {
    assert.ok(body.indexOf(w) < 0, 'lib/signin.js mentions ' + w + ' — it has picked a surface');
  });
});

console.log('\n' + pass + ' checks passed\n');
