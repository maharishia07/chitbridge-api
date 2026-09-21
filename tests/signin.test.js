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

/** ⚠️ five digits is not a wrong code, it is an unfinished one, and saying "wrong" would send somebody hunting */
it('⚠️ an unfinished code is told apart from a wrong one', () => {
  assert.strictEqual(S.code('12345').ok, false);
  assert.ok(/six digits/.test(S.code('12345').why));
  assert.strictEqual(S.code('123456').ok, true);
  assert.strictEqual(S.code('123 456').value, '123456', 'a space made a good code unusable');
  assert.ok(/Type the six-digit code/.test(S.code('').why));
});

it('and verify puts the two together', () => {
  assert.deepStrictEqual(S.verify('bala', '123456').body, { user_id: 'bala', otp: '123456' });
  assert.strictEqual(S.verify('bala', '12').ok, false);
  assert.strictEqual(S.verify('', '123456').ok, false);
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
