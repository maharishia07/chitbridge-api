'use strict';
/**
 * till-who-signin.test.cjs — R132 (walk 24 Oct): PICKING A NAME CARRIES WHO THEY ARE. Runs the page's OWN whoPick() (+ whoAsk), whoHandle(),
 * usignAnswer() (+ its helpers), usignRefusalWords(), usignAfterIn() and usignCounterLine() text (sliced out of till.html) against stubs.
 * The rules: a picked person is not asked to type an ID; a refusal names what to use instead (never the typed value, Q19);
 * a PIN chosen in the sign-in is the counter PIN (one ask); "sign in to connect" only when no shop is held.
 * Run: node tests/till-who-signin.test.cjs
 */
const assert = require('assert'), fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const PAGE = read('tools/tally-connector/till.html');
function fn(sig) { const a = PAGE.indexOf(sig); assert.ok(a >= 0, sig + ' is gone'); return PAGE.slice(a, PAGE.indexOf('\n}\n', a) + 3); }
const src = ['function usignRefusalWords(', 'function usignAnswer(', 'function usignDoor(', 'function usignWasOk(', 'function usignWasRefused(', 'function usignAskedFirstCode(',
  'function whoHandle(', 'function whoPick(', 'function whoAsk(', 'function whoNoPinWords(', 'async function usignAfterIn(', 'async function usignKeepChosenPin(', 'function usignCounterLine(', 'function usignInWords(']
  .map(fn).join('\n');
let pass = 0;
const it = (w, f) => Promise.resolve().then(f).then(() => { pass++; console.log('  ok  ' + w); }, (e) => { console.log('  FAIL ' + w + '\n      ' + e.message); process.exitCode = 1; });

/** the page as whoPick / usignAfterIn see it */
function world(o) {
  o = Object.assign({ online: true, book: {}, staff: [{ id: 'w1', name: 'Asha Devi', user_id: 'asha01@mayur.br' }], assign: { action: 'keep', why: 'Counter 1' }, S: { entity_id: 'E1', shop: { name: 'Mayur' } } }, o);
  const calls = { typed: [], go: 0, refuse: [], saved: null, closed: 0, later: 0, offered: 0 };
  const m = { words: { code: 'The code we sent' }, typed: (v) => calls.typed.push(v), go: () => { calls.go++; }, refuse: (w) => calls.refuse.push(w), offerPin: () => { calls.offered++; } };
  const USIGN = { win: { machine: m }, floatAsk: false, closeWhenIn: false, newPin: '', person: { id: 'w1', name: 'Asha Devi' }, idn: null, pickName: '' };
  const S = o.S ? Object.assign({ staff: o.staff }, o.S) : { staff: o.staff };
  const SIGN = () => ({ pinFind: (b, id) => b[id] || null, pinLocked: (e) => !!e.locked, pinAfter: () => ({ why: 'Locked.' }) });
  const usignLocal = () => ({ save: async (s, pin) => { calls.saved = pin; } });
  const make = new Function('S', 'USIGN', 'SIGN', 'pinBook', 'lineUp', 'usignOpen', 'usignClose', 'cbQuiet', 'pinLaterOffer', 'pinUsableFor', 'usignLocal',
    'DAY', 'dayState', 'paired', 'document', 'window', 'crypto', 'ask', 'whoFloat', 'curSym',
    src + '; return { whoPick, usignAnswer, usignRefusalWords, usignAfterIn, usignCounterLine, usignInWords, whoHandle };');
  const api = make(S, USIGN, SIGN, () => o.book, () => o.online, () => {}, () => { calls.closed++; }, () => {}, () => { calls.later++; },
    () => false, usignLocal, () => ({ assign: () => o.assign }), () => ({}), () => !!o.paired,
    { getElementById: () => ({ close() {}, open: true }) }, { crypto: {} }, { subtle: {} }, async () => '', () => {}, () => '$');
  return { api, calls, USIGN };
}
(async () => {
  console.log('\nR132 · the counter who-pick\n');
  await it('1 · a picked worker with no PIN is asked for the code, NOT to type an ID: her user ID goes to the window', () => {
    const w = world(); w.api.whoPick('w1', 'Asha Devi');
    assert.deepStrictEqual(w.calls.typed, ['asha01@mayur.br']); assert.strictEqual(w.calls.go, 1); assert.deepStrictEqual(w.calls.refuse, []);
    assert.strictEqual(w.USIGN.pickName, 'Asha Devi');
  });
  await it('1 · the code box is named for what it is: shown by the owner, not sent', () => {
    const w = world(); w.api.whoPick('w1', 'Asha Devi');
    assert.strictEqual(w.USIGN.win.machine.words.code, 'First code from the owner');
  });
  await it('1 · with a counter PIN, the pick opens the PIN box (unchanged)', () => {
    const w = world({ book: { w1: { id: 'w1' } } }); w.api.whoPick('w1', 'Asha Devi');
    assert.deepStrictEqual(w.calls.typed, ['w1']); assert.strictEqual(w.calls.go, 1);
  });
  await it('1 · an older server (no user ID on the row) says who to ask, never "type your user ID"', () => {
    const w = world({ staff: [{ id: 'w1', name: 'Asha Devi' }] }); w.api.whoPick('w1', 'Asha Devi');
    assert.strictEqual(w.calls.go, 0); assert.ok(/Ask the owner for a first code: People › Asha Devi › Reset code/.test(w.calls.refuse[0]), w.calls.refuse[0]);
    assert.ok(!/type your user ID/i.test(w.calls.refuse[0]));
  });
  await it('1 · offline with no PIN stays the line sentence', () => {
    const w = world({ online: false }); w.api.whoPick('w1', 'Asha Devi');
    assert.ok(/needs the internet/.test(w.calls.refuse[0]));
  });
  await it('1 · the shop itself keeps its old door (its owner types their own ID)', () => {
    const w = world(); w.api.whoPick('entity', 'Mayur', 'entity');
    assert.strictEqual(w.calls.go, 0); assert.ok(/type your user ID/.test(w.calls.refuse[0]));
  });
  await it('1 · a locked PIN is not bypassed by the first-code door', () => {
    const w = world({ book: { w1: { id: 'w1', locked: true } } }); w.api.whoPick('w1', 'Asha Devi');
    assert.strictEqual(w.calls.go, 0); assert.ok(/^Locked\./.test(w.calls.refuse[0]));
  });

  const refusedAsk = { status: 400, body: { error: 'Sign-in failed', message: "That sign-in didn't work. Check the details and try again." } };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  await it('2 · the refusal names what to use and how to get it, for the picked person', () => {
    const w = world(); const r = w.api.usignAnswer('/api/signin/ask', { id: '9000000004' }, copy(refusedAsk), 'Asha Devi');
    assert.ok(/Asha Devi signs in with a counter PIN, or the first code from the owner\./.test(r.body.message), r.body.message);
    assert.ok(/People › Asha Devi › Reset code/.test(r.body.message));
  });
  await it('2 · Q19 + no pick: the owner or a typed ID keeps the server sentence, and the typed mobile never comes back in it', () => {
    const w = world(); const r = w.api.usignAnswer('/api/signin/ask', { id: '9000000004' }, copy(refusedAsk), '');
    assert.ok(!/9000000004/.test(r.body.message)); assert.ok(/^That sign-in didn.t work/.test(r.body.message)); assert.ok(!/Staff|counter PIN/.test(r.body.message));
  });
  await it('2 · a wrong first code says so and where a new one comes from', () => {
    const w = world(); const r = w.api.usignAnswer('/api/signin/verify', { id: 'x', otp: '123456' }, copy(refusedAsk), 'Asha Devi');
    assert.ok(/code did not work/.test(r.body.message) && /Reset code/.test(r.body.message)); assert.ok(!/123456/.test(r.body.message));
  });
  await it('2 · only the sign-in refusal is re-worded: another 400 and a 429 pass through untouched', () => {
    const w = world();
    const a = w.api.usignAnswer('/api/signin/ask', {}, { status: 429, body: { message: 'Slow down.' } }, 'Asha Devi');
    const b = w.api.usignAnswer('/api/signin/ask', {}, { status: 400, body: { message: 'Type your mobile number, email or User ID.' } }, '');
    assert.strictEqual(a.body.message, 'Slow down.'); assert.strictEqual(b.body.message, 'Type your mobile number, email or User ID.');
  });
  await it('R112 · a first code is SHOWN by the owner: the ask answer says so, and no "Co-assists" or "sent"', () => {
    const w = world(); const r = w.api.usignAnswer('/api/signin/ask', {}, { status: 200, body: { kind: 'actor', need: 'code', message: 'First sign-in — enter the one-time code your admin shared, then set a PIN in Co-assists.' } }, 'Asha Devi');
    assert.ok(/first code the owner gave you/.test(r.body.message) && /Counter PIN/.test(r.body.message)); assert.ok(!/Co-assists|sent/.test(r.body.message));
  });
  await it('R112 · an owner e-mailed code keeps the server words', () => {
    const w = world(); const r = w.api.usignAnswer('/api/signin/ask', {}, { status: 200, body: { kind: 'entity', need: 'code', message: 'Verification code sent to your email' } }, '');
    assert.strictEqual(r.body.message, 'Verification code sent to your email');
  });

  await it('3 · the PIN chosen in the first sign-in is the counter PIN: kept, dialog closed, no second ask', async () => {
    const w = world(); w.USIGN.closeWhenIn = true;
    w.api.usignAnswer('/api/signin/pin', { pin: '2468', confirm_pin: '2468' }, { status: 200, body: { ok: true } }, 'Asha Devi');
    assert.strictEqual(w.USIGN.newPin, '2468');
    await w.api.usignAfterIn({ id: 'w1', name: 'Asha Devi' }, { user_id: 'asha01@mayur.br' });
    assert.strictEqual(w.calls.saved, '2468'); assert.strictEqual(w.calls.offered, 0); assert.strictEqual(w.calls.closed, 1); assert.strictEqual(w.USIGN.newPin, '');
  });
  await it('3 · a refused PIN save is not chosen: nothing is kept', () => {
    const w = world(); w.api.usignAnswer('/api/signin/pin', { pin: '2468' }, { status: 400, body: { message: 'No.' } }, '');
    assert.strictEqual(w.USIGN.newPin, '');
  });
  await it('3 · with no PIN chosen the counter still offers its own (unchanged)', async () => {
    const w = world();
    await w.api.usignAfterIn({ id: 'w1', name: 'Asha Devi' }, { user_id: 'asha01@mayur.br' });
    assert.strictEqual(w.calls.saved, null); assert.strictEqual(w.calls.offered, 1);
  });

  await it('4 · "Sign in to connect this counter to a shop" is not said under a box that says the person is in', () => {
    const w = world({ assign: { action: 'shop', why: 'Sign in to connect this counter to a shop. It needs the internet once, to fetch the shop.' } });
    assert.strictEqual(w.api.usignCounterLine(), '');
  });
  await it('4 · the signed-in note never goes blank (an empty box is invisible: seven till walks waited on it)', () => {
    const w = world({ assign: { action: 'shop', why: 'Sign in to connect this counter to a shop.' } });
    assert.strictEqual(w.api.usignInWords({ id: 'w1', name: 'Asha Devi' }), 'Asha Devi is signed in at this counter.');
    assert.strictEqual(w.api.usignInWords(null), 'Signed in at this counter.');
    assert.strictEqual(world({ assign: { action: 'keep', why: 'Counter 1 carries on' } }).api.usignInWords({ name: 'Asha Devi' }), 'Counter 1 carries on');
  });
  await it('4 · it IS said when no shop is held', () => {
    const w = world({ S: null, assign: { action: 'shop', why: 'Sign in to connect this counter to a shop.' } });
    assert.ok(/connect this counter/.test(w.api.usignCounterLine()));
  });
  await it('4 · other counter lines are untouched', () => {
    const w = world({ assign: { action: 'keep', why: 'Counter 1 carries on' } });
    assert.strictEqual(w.api.usignCounterLine(), 'Counter 1 carries on');
  });

  await it('wire · the snapshot staff row carries the sign-in user ID, and still no contact detail', () => {
    const R = read('routes/till.js');
    assert.ok(/SELECT identity_id, display_name, hat, user_id FROM identities/.test(R));
    assert.ok(/staff = st\.rows\.map\(\(item\) => \(\{ id: item\.identity_id, name: item\.display_name, hat: item\.hat \|\| null, user_id: item\.user_id \|\| null \}\)\)/.test(R));
    const sel = R.slice(R.indexOf('let staff = [];'), R.indexOf('let all = (itemRows'));
    assert.ok(!/email|phone|mobile/i.test(sel), 'a contact column joined the staff row');
  });
  await it('copy · the F7 panel promises PIN or first code, in words that match', () => {
    assert.ok(PAGE.includes('Picking a name asks that person for their counter PIN, or the first code from the owner.'));
  });
  console.log('\n' + pass + ' passed' + (process.exitCode ? ' · FAILURES above' : ''));
})();
