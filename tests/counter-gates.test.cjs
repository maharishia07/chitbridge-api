'use strict';
/**
 * counter-gates.test.cjs — ⭐⭐⭐ G1: ONE DOOR TO A SHOP. [SPEC-counter-identity.md §2]
 *
 * Athi, 2026-09-28, after signing in as a second shop and still seeing the first shop's products: *"i can't trust
 * the till application at all … we should be having any number of inlet and many exit, but all should lead to
 * same path."*
 *
 * The count that day: FOUR pieces of page code wrote the counter's key (the background enrol, the shop PC's own
 * connect dialog, the ⚙ key box, the #key= link), three sign-outs removed it, and three of the writers repainted
 * in place — so the bill in hand, the day and the person carried into the next shop. becomeShop() is now the
 * only one, and it always reloads (browser) or restarts (shop PC).
 *
 * ⚠️ THESE READ THE SOURCE, AND SAY SO. The fault was never one write being wrong; each was right on its own.
 * It was there being MANY, and only a count of writers can see that. A new inlet that writes the key itself
 * fails here, by name, before it can open a second path.
 *
 * Run: node tests/counter-gates.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

const API = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8').replace(/\r\n/g, '\n');
const PROG = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** a top-level function's whole body, from its signature to the first line that is a bare `}` */
function body(src, sig) {
  const at = src.indexOf(sig);
  assert.ok(at >= 0, sig + ' is gone — this guard is measuring nothing');
  const end = src.indexOf('\n}\n', at);
  return { at: at, end: end + 3, text: src.slice(at, end + 3) };
}
/** every match of re in src that is NOT inside [gate.at, gate.end), with its line, for a readable failure */
function outside(src, re, gate, allow) {
  const out = [];
  let m; const g = new RegExp(re.source, 'g');
  while ((m = g.exec(src))) {
    if (m.index >= gate.at && m.index < gate.end) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const text = src.split('\n')[line - 1].trim();
    if (allow && allow.some((a) => text.indexOf(a) >= 0)) continue;
    out.push('line ' + line + ': ' + text.slice(0, 110));
  }
  return out;
}

const G1 = body(PAGE, 'async function becomeShop(');

console.log('\nG1 · ONE DOOR TO A SHOP — the page\n');

it('becomeShop() stores the key, and nothing else in the page does', () => {
  assert.ok(/ls\.set\('cb_till_key'/.test(G1.text), 'becomeShop no longer stores the key — the door is empty');
  const w = outside(PAGE, /ls\.set\(\s*'cb_till_key'|localStorage\.setItem\(\s*'cb_till_key'/, G1);
  assert.deepStrictEqual(w, [], 'another writer of the key — a second door:\n      ' + w.join('\n      '));
});

it('nothing else REMOVES the key either (signing out is a change of shop)', () => {
  const w = outside(PAGE, /(?:ls\.del|localStorage\.removeItem)\(\s*'cb_till_key'/, G1);
  assert.deepStrictEqual(w, [], 'a sign-out that bypasses the door:\n      ' + w.join('\n      '));
});

it('CloudHost.key is assigned only by the door — and read once, at start-up', () => {
  const w = outside(PAGE, /CloudHost\.key\s*=(?!=)/, G1, ["CloudHost.key = ls.get('cb_till_key'"]);
  assert.deepStrictEqual(w, [], 'the key held in memory is changed outside the door:\n      ' + w.join('\n      '));
});

it('the page asks the shop-PC program to enrol or sign out ONLY through the door', () => {
  const w = outside(PAGE, /fetch\(\s*(?:enrol \? )?'\/api\/(?:signin\/finish|signout)'/, G1);
  assert.deepStrictEqual(w, [], 'a second way to change the program\'s shop:\n      ' + w.join('\n      '));
  assert.ok(/'\/api\/signin\/finish' : '\/api\/signout'/.test(G1.text), 'the door no longer reaches the program');
});

it('⭐⭐ the door never repaints — it reloads, or waits for the restart', () => {
  assert.ok(/location\.reload\(\)/.test(G1.text), 'the browser half no longer reloads');
  assert.ok(/counterRestarted\(/.test(G1.text), 'the shop-PC half no longer waits for the new process');
  assert.ok(!/\bS = null\b/.test(G1.text) && !/\brefresh\(\)/.test(G1.text), 'the door repaints in place — the fault, back');
});

it('⚠️ the old shop\'s copy is never deleted by a change of shop (a queued sale is money)', () => {
  assert.ok(!/deleteDatabase/.test(G1.text), 'the door deletes a shop\'s store');
});

it('the person crosses the reload as a PENDING sign-in, adopted only onto their own shop', () => {
  const adopt = body(PAGE, 'function whoAdoptPending(').text;
  assert.ok(/String\(p\.entity\) !== String\(S\.entity_id\)/.test(adopt), 'a pending person is adopted onto any shop');
  assert.ok(/usignAdopt\(p\)/.test(adopt), 'the pending person is not handed to the one person writer');
});

it('every inlet goes through the door: sign-in, #key= link, ⚙ key box, both sign-outs, closing the counter', () => {
  const need = [
    ['usignBecome', /becomeShop\(\{ token: p\.token/],
    ['pickHost', /becomeShop\(\{ key: k, marker/],
    ['settingsKeySave', /becomeShop\(\{ key: val \}\)/],
    ['signoutDo', /becomeShop\(\{ key: null, force: !!force/],
    ['signoutCloudDo', /return becomeShop\(\{ key: null \}\)/],
  ];
  need.forEach(([fn, re]) => {
    const b = body(PAGE, (fn === 'signoutCloudDo' || fn === 'settingsKeySave') ? 'function ' + fn + '(' : 'async function ' + fn + '(').text;
    assert.ok(re.test(b), fn + ' no longer goes through becomeShop()');
  });
  assert.ok(/else becomeShop\(\{ key: null \}\)/.test(PAGE), 'closing the counter no longer goes through the door');
});

it('the shop PC has ONE sign-in: its own connect dialog is retired, "sign in again" opens the shared one', () => {
  assert.ok(!/function signinSend\(|function signinDo\(/.test(PAGE), 'the second connect dialog is back');
  assert.ok(/function pairAgain\(\)\{[\s\S]{0,400}return usignOpen\(true\);\n\}/.test(PAGE), 'pairAgain opens something else on some host');
});

console.log('\nS1b · WHAT BELONGS TO A SHOP IS STORED UNDER THE SHOP — on the shop PC too\n');

it('the shop PC names its slot after the shop the program reports (it holds no key to hash)', () => {
  const ts = body(PAGE, 'function tillStore(').text;
  assert.ok(/HOST === AgentHost[\s\S]{0,200}STATE\.shop\.bridge_id/.test(ts), 'tillStore() still gives every shop on a PC the same name');
});

it('the page learns the PC\'s shop BEFORE anything reads a shop-scoped value', () => {
  const ph = body(PAGE, 'async function pickHost(').text;
  assert.ok(/STATE = st; HOST = AgentHost; shopSlotMove\(\); return AgentHost;/.test(ph), 'pickHost returns the agent before the shop is known');
});

it('every name shopLs() is asked for is in SHOP_KEYS — or the one-time move leaves it behind', () => {
  const m = PAGE.match(/var SHOP_KEYS = \[([^\]]*)\]/);
  assert.ok(m, 'SHOP_KEYS is gone');
  const listed = m[1].match(/'[a-z_]+'/g).map((x) => x.slice(1, -1));
  const used = Array.from(new Set((PAGE.match(/shopLs\('[a-z_]+'\)/g) || []).map((x) => x.slice(8, -2))));
  const draft = (PAGE.match(/DRAFT_KEY = '([a-z_]+)'/) || [])[1]; if (draft) used.push(draft);
  const missing = used.filter((k) => listed.indexOf(k) < 0);
  assert.deepStrictEqual(missing, [], 'shop-scoped names not in SHOP_KEYS: ' + missing.join(', '));
});

it('⚠️ the move happens ONCE and only into an EMPTY slot — a later switch never sweeps anything into a shop', () => {
  const mv = body(PAGE, 'function shopSlotMove(').text;
  assert.ok(/localStorage\.getItem\('cb_till_slotmoved'\)\) return/.test(mv), 'the move is not once-only');
  assert.ok(/if \(!filled\)/.test(mv), 'the move writes into a slot that already has values');
});

it('⚠️⚠️ parked bills are read again once the shop is known (they were read before the key and then saved over)', () => {
  const ld = body(PAGE, 'async function load(').text;
  assert.ok(/whoLoad\(\); breakLoad\(\); changedLoad\(\); parkedLoad\(\);/.test(ld), 'load() does not re-read parked bills after pickHost');
});

console.log('\nG2 · ONE DOOR FOR A PERSON — who is on is set only by the sign-in\n');

/** matches of re outside ALL of the named functions */
function outsideAll(src, re, names) {
  const gates = names.map((n) => body(src, n));
  let hits = null;
  gates.forEach((g, i) => {
    const h = outside(src, re, g);
    hits = hits === null ? h : hits.filter((x) => h.indexOf(x) >= 0);
  });
  return hits || [];
}

it('WHO is assigned only by the sign-in (usignAdopt), the sign-out (usignOut) and the start-up read (whoLoad)', () => {
  const w = outsideAll(PAGE, /\bWHO = (?!=)/, ['function usignAdopt(', 'function usignOut(', 'function whoLoad(']);
  const real = w.filter((x) => x.indexOf('var WHO = null') < 0);
  assert.deepStrictEqual(real, [], 'somebody is put on the counter outside the gate:\n      ' + real.join('\n      '));
});

it('the stored person is written only by the gate (adopt, sign out, the drawer\'s float, the break log)', () => {
  const w = outsideAll(PAGE, /ls\.set\(shopLs\('cb_till_who'\)/,
    ['function usignAdopt(', 'function usignOut(', 'function whoFloat(', 'function endBreak(']);
  assert.deepStrictEqual(w, [], 'a second writer of who is on:\n      ' + w.join('\n      '));
});

it('⚠️⚠️ picking a name no longer signs anybody in — the picker opens the gate', () => {
  assert.ok(!/function setWho\(/.test(PAGE), 'setWho() is back: a name set on one tap, no proof');
  assert.ok(!/onclick="setWho\(/.test(PAGE), 'the picker still calls setWho');
  const wp = body(PAGE, 'function whoPick(').text;
  assert.ok(/usignOpen\(\)/.test(wp) && !/WHO\s*=/.test(wp), 'whoPick sets WHO itself instead of opening the gate');
});

it('the hand-over frees the counter through the gate\'s own exit', () => {
  assert.ok(/SHIFT = null; usignOut\(\);/.test(body(PAGE, 'function shiftDone(').text), 'shiftDone clears WHO itself');
});

console.log('\nG2 · THE COUNTER PIN — kept per shop, never the PIN itself\n');

it('the PIN book is written in ONE place, under the shop', () => {
  const w = outside(PAGE, /shopLs\('cb_till_pins'\)/, body(PAGE, 'function pinBookSave('), ['function pinBook(){']);
  assert.deepStrictEqual(w, [], 'the PIN book is touched outside pinBook/pinBookSave:\n      ' + w.join('\n      '));
  assert.ok(/'cb_till_pins'[,\]]/.test(PAGE.match(/var SHOP_KEYS = \[[^\]]*\]/)[0]), 'the PIN book is not a SHOP key');
});

it('⚠️⚠️ what goes into the book comes from the engine (pinEntry / pinAfter) — a salt and a hash, never the PIN', () => {
  const save = body(PAGE, 'async function usignPinSave(').text, loc = body(PAGE, 'async function usignVerifyLocal(').text;
  assert.ok(/SIGN\(\)\.pinEntry\(/.test(save) && /await pinMake\(a\.value\)/.test(save), 'a PIN is saved without the engine\'s record');
  assert.ok(/SIGN\(\)\.pinAfter\(/.test(loc), 'a local PIN is judged here, not by the engine');
  assert.ok(/PBKDF2/.test(body(PAGE, 'async function pinDerive(').text), 'the PIN is no longer derived with PBKDF2');
});

it('⭐ the counter\'s own PIN is tried FIRST, and it works with the line down', () => {
  const ask = body(PAGE, 'async function usignAsk(').text;
  const pinAt = ask.indexOf('SIGN().pinFind('), netAt = ask.indexOf("usignPost('/api/entities/register'");
  assert.ok(pinAt > 0 && netAt > pinAt, 'the network is asked before this counter\'s own PIN');
  assert.ok(/if \(!lineUp\(\)\)/.test(ask.slice(pinAt, netAt)), 'offline with no PIN is not refused in words');
});

console.log('\nS3/S4 · 🔒 LOCK · 🔓 UNLOCK — the lock is the one sign-in over a covered screen\n');

it('a lock is written only by lockNow and lifted only by lockLift, under the shop', () => {
  const w = outsideAll(PAGE, /ls\.set\(lockKey\(\)/, ['function lockNow(', 'function lockLift(']);
  assert.deepStrictEqual(w, [], 'another writer of the lock:\n      ' + w.join('\n      '));
  assert.ok(/'cb_till_lock'[,\]]/.test(PAGE.match(/var SHOP_KEYS = \[[^\]]*\]/)[0]), 'the lock is not a SHOP key — it would not survive a reload per shop');
});

it('⭐ only a PROVED person lifts it: lockLift is called by personIn, and personIn by the sign-in alone', () => {
  const w = outsideAll(PAGE, /\blockLift\(\)/, ['function personIn(', 'function lockLift(']);
  assert.deepStrictEqual(w, [], 'the lock comes off without a sign-in:\n      ' + w.join('\n      '));
  const w2 = outsideAll(PAGE, /\bpersonIn\(\w/, ['async function usignVerify(', 'async function usignVerifyLocal(', 'function personIn(']);
  assert.deepStrictEqual(w2, [], 'something other than the sign-in lets a person in:\n      ' + w2.join('\n      '));
});

it('⚠️⚠️ nothing behind the cover is reachable by keyboard ([TILL-30]: Escape once cleared a bill)', () => {
  assert.ok(/window\.addEventListener\('keydown', function\(e\)\{\n  if \(!LOCK\) return;[\s\S]{0,300}e\.stopImmediatePropagation\(\);\n\}, true\);/.test(PAGE),
    'the capture-phase key guard is gone');
});

it('⭐ signing out LOCKS the counter (Athi: "simply if we lock the screen and ask for sign-in")', () => {
  assert.ok(/lockNow\(\);\n\}/.test(body(PAGE, 'function usignOut(').text), 'signing out leaves the counter open with nobody on it');
});

it('the engine\'s unlock door opens the one sign-in', () => {
  assert.ok(/if \(d\.act === 'unlock'\)  return lockOpen\(\);/.test(PAGE), 'whoAct does not route the unlock door');
  assert.ok(/usignOpen\(\);/.test(body(PAGE, 'function lockOpen(').text), 'unlock is its own dialog instead of the sign-in');
});

it('☕ a break IS a lock: taking one locks, and only a sign-in (personIn) ends it', () => {
  assert.ok(/lockNow\('break'\);\n\}/.test(body(PAGE, 'function takeBreak(').text), 'a break no longer locks');
  const w = outsideAll(PAGE, /\bendBreak\(\)/, ['function personIn(', 'function endBreak(']);
  assert.deepStrictEqual(w, [], 'a break ends without a sign-in:\n      ' + w.join('\n      '));
  assert.ok(!/onclick="endBreak\(\)"/.test(PAGE), 'a button ends the break on a tap again');
});

it('⏱ auto-lock: 5 minutes by default, per shop, and it locks through lockNow — no second lock path', () => {
  assert.ok(/raw === '' \|\| raw == null \? 5/.test(body(PAGE, 'function autoLockMins(').text), 'the default is no longer 5 minutes');
  assert.ok(/'cb_till_autolock'[,\]]/.test(PAGE.match(/var SHOP_KEYS = \[[^\]]*\]/)[0]), 'the auto-lock minutes are not a SHOP key');
  const fire = body(PAGE, 'function autoLockFire(').text;
  assert.ok(/lockNow\(\);\n\}/.test(fire), 'auto-lock does not lock through lockNow()');
  assert.ok(/dialog\[open\]/.test(fire), 'auto-lock no longer waits for an open dialog');
  assert.ok(/autoLockPoke\(\);/.test(body(PAGE, 'function idlePoke(').text), 'activity no longer restarts the lock clock');
});

console.log('\nM10 · RETURNS AND EXPENSES ON THE SHOP PC — the program numbers, the page builds, one queue\n');

it('the program numbers a credit note and an expense in their OWN series, never the sales run', () => {
  assert.ok(/kind === 'CN' \|\| kind === 'EXP'\) \? kind : ''/.test(PROG), 'CN/EXP are not their own series in nextNumberOf');
  const num = PROG.slice(PROG.indexOf("url.pathname === '/api/number'"), PROG.indexOf("url.pathname === '/api/record'"));
  assert.ok(/nextNumberOf\(b\.kind\)/.test(num) && !/nextNumber\(\)/.test(num), '/api/number takes from the sales series');
});

it('⚠️ /api/record files ONLY a number this program issued for that kind — a record cannot invent its own', () => {
  const rec = PROG.slice(PROG.indexOf("url.pathname === '/api/record'"), PROG.indexOf("url.pathname === '/api/doc'"));
  assert.ok(/ISSUED\[doc\.no\] !== want/.test(rec), 'the issued-number check is gone');
  assert.ok(/chitBody\.client_ref !== doc\.no/.test(rec), 'a record and its chit can carry different numbers');
});

it('ONE chit builder: the program never builds a credit-note or expense chit of its own', () => {
  assert.ok(!/function chitOfCN|function chitOfExpense/.test(PROG), 'the program grew a second builder');
  assert.ok(/creditNote: function\(cn\)\{ return this\.record\('CN'[\s\S]{0,80}chitOfCN\)/.test(PAGE), 'AgentHost does not build with chitOfCN');
  assert.ok(/expense: function\(e\)\{ return this\.record\('EXP'[\s\S]{0,80}chitOfExpense\)/.test(PAGE), 'AgentHost does not build with chitOfExpense');
});

console.log('\nG1 · the program\n');

it('connector.json\'s key is written in ONE place (enrol) and removed in ONE place (sign out)', () => {
  assert.strictEqual((PROG.match(/cfgNow\.key = /g) || []).length, 1, 'the program writes its key in more than one place');
  assert.strictEqual((PROG.match(/delete cfgNow\.key/g) || []).length, 1, 'the program drops its key in more than one place');
  const fin = PROG.indexOf("url.pathname === '/api/signin/finish'"), out = PROG.indexOf("url.pathname === '/api/signout'");
  const w = PROG.indexOf('cfgNow.key = '), d = PROG.indexOf('delete cfgNow.key');
  assert.ok(fin > 0 && w > fin && w < fin + 6000, 'the key is written outside /api/signin/finish');
  assert.ok(out > 0 && d > out && d < out + 4000, 'the key is removed outside /api/signout');
});

it('both restart the program, so the shop\'s folder is chosen again from the new key ([TILL-120])', () => {
  const fin = PROG.slice(PROG.indexOf("url.pathname === '/api/signin/finish'"));
  const out = PROG.slice(PROG.indexOf("url.pathname === '/api/signout'"));
  assert.ok(/process\.exit\(0\)/.test(fin.slice(0, 6000)), 'enrolling no longer restarts');
  assert.ok(/process\.exit\(0\)/.test(out.slice(0, 4000)), 'signing out no longer restarts');
});

console.log('\n' + pass + ' checks passed\n');
