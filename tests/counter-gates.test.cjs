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

console.log('\nM08 · A PHONE IS A PERSON ON A DEVICE — the session is kept, never spent on a key\n');

it('⭐⭐⭐ the person session (cb_till_person) is written only by the door, and read once at start-up', () => {
  const w = outside(PAGE, /ls\.set\(\s*'cb_till_person'|localStorage\.setItem\(\s*'cb_till_person'/, G1);
  assert.deepStrictEqual(w, [], 'another writer of the person session — a second door:\n      ' + w.join('\n      '));
  const r = outside(PAGE, /CloudHost\.person\s*=(?!=)/, G1, ['CloudHost.person = personLoad();']);
  assert.deepStrictEqual(r, [], 'the session held in memory is changed outside the door:\n      ' + r.join('\n      '));
  assert.ok(/ls\.set\('cb_till_person'/.test(G1.text), 'becomeShop no longer keeps the session — the door is empty');
});

it('⭐⭐⭐ a browser never calls /api/till/enrol and never asks for a counter — only the shop-PC program enrols', () => {
  assert.ok(!/['"`]\/api\/till\/enrol['"`]/.test(PAGE), 'the page still reaches /api/till/enrol');
  assert.ok(!/function enrolBrowser\(|function counterFree\(|function usignNewCounter\(/.test(PAGE), 'the browser enrol helpers are back');
  assert.ok(!/'\/api\/counters'/.test(PAGE), 'the page still asks /api/counters for a number');
  assert.ok(/\/api\/till\/enrol/.test(PROG), 'the program no longer enrols — the shop PC path moved');
});

it('⭐⭐ "Take counter … here" is painted for the shop PC only — a phone can never knock the PC off', () => {
  const m = PAGE.match(/onAgent\(\) \? '<button data-testid="till-signin-takeover"/);
  assert.ok(m, 'the takeover button is offered on a browser');
  assert.strictEqual((PAGE.match(/till-signin-takeover/g) || []).length, 1, 'a second takeover button');
});

it('⭐ the device id is device-wide and made once; every cloud call carries it; the store is per shop + device', () => {
  assert.ok(/ls\.get\('cb_device_id'/.test(body(PAGE, 'function deviceId(').text), 'deviceId() does not read cb_device_id');
  assert.ok(/o\.headers\['X-Device-Id'\] = deviceId\(\)/.test(body(PAGE, 'async function fetchBy_(').text), 'fetchBy_ does not send X-Device-Id');
  const ts = body(PAGE, 'function tillStore(').text;
  assert.ok(/CloudHost\.person\.entity_id[\s\S]{0,120}deviceId\(\)/.test(ts), 'the person store is not named per shop + device');
  assert.ok(ts.indexOf('CloudHost.person') < ts.indexOf("'cb-till-' + h.toString(36)"), 'the key store is tried before the person store');
  assert.ok(/'cb-till-' \+ h\.toString\(36\)/.test(ts), 'the OLD key store name changed — every phone holding a key loses its queue');
});

it('⭐ one place signs a cloud call (CloudHost.auth) — no hand-written key header is left', () => {
  const hand = (PAGE.match(/'X-Api-Key': this\.key \}/g) || []).length;
  assert.strictEqual(hand, 0, hand + ' hand-written X-Api-Key header(s) beside CloudHost.auth()');
  assert.ok(/h\['Authorization'\] = 'Bearer ' \+ this\.person\.token/.test(PAGE), 'a person session is not sent as Bearer');
});

it('⭐ a person is never told "Due to maintenance" — words per code, and nothing is deleted on a 4xx', () => {
  const rf = body(PAGE, 'function refreshFailed(').text;
  assert.ok(/if \(personOn\(\) && \(status === 401 \|\| status === 403\)\)/.test(rf) && rf.indexOf('personOn()') < rf.indexOf("'Due to maintenance'"), 'refreshFailed asks the key story before the person one');
  const pr = body(PAGE, 'function personRefused(').text;
  ['DEVICE_REVOKED', 'DEVICE_MISMATCH', 'Sign in to send '].forEach((w) => assert.ok(pr.indexOf(w) >= 0, 'personRefused lost ' + w));
  assert.ok(!/maintenance/i.test(pr), 'personRefused says "maintenance"');
  const dr = PAGE.slice(PAGE.indexOf('async drain('), PAGE.indexOf('async drain(') + 20000);
  assert.ok(/if \(personOn\(\)\) \{ var pr = personRefused\(code/.test(dr), 'drain names a person refusal as "the key"');
});

it('⭐ the page checks its own build and the check touches no store (history is never cleared by a version check)', () => {
  const ps = body(PAGE, 'function pageStale(').text;
  assert.ok(/TILL_BUILD/.test(ps) && /location\.reload\(\)/.test(ps), 'pageStale does not compare and reload');
  assert.ok(!/localStorage\.(removeItem|clear)|indexedDB|deleteDatabase|caches\./.test(ps), 'the version check touches what the shop keeps');
  assert.ok(/sessionStorage\.getItem\('cb_till_reloaded_for'\)/.test(ps), 'a lagging CDN could loop the reload');
  assert.ok(/var TILL_BUILD = '\d{4}-\d{2}-\d{2}[^']*'/.test(PAGE), 'TILL_BUILD is not a dated build mark');
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
  const pinAt = ask.indexOf('SIGN().pinFind('), netAt = ask.indexOf("usignPost(usignPath('ask')");
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
  /* ⚠️ MOVED, NOT DELETED (2026-09-29, critic H1): one more caller — lockStranded(), the way out when NO sign-in is
     possible (line down, no usable PIN). The next check pins that it can only run in that state. */
  const w = outsideAll(PAGE, /\blockLift\(\)/, ['function personIn(', 'function lockLift(', 'async function lockStranded(']);
  assert.deepStrictEqual(w, [], 'the lock comes off without a sign-in:\n      ' + w.join('\n      '));
  const w2 = outsideAll(PAGE, /\bpersonIn\(\w/, ['async function usignVerify(', 'async function usignVerifyLocal(', 'function personIn(']);
  assert.deepStrictEqual(w2, [], 'something other than the sign-in lets a person in:\n      ' + w2.join('\n      '));
});

it('⚠️⚠️ nothing behind the cover is reachable by keyboard ([TILL-30]: Escape once cleared a bill)', () => {
  assert.ok(/window\.addEventListener\('keydown', function\(e\)\{\n  if \(!LOCK\) return;[\s\S]{0,300}e\.stopImmediatePropagation\(\);\n\}, true\);/.test(PAGE),
    'the capture-phase key guard is gone');
});

it('⚠️⚠️ H1: never lock into a state nobody can leave; the unproven way out exists ONLY in that state', () => {
  assert.ok(/if \(!lockSafe\(\)\) \{/.test(body(PAGE, 'function lockNow(').text), 'lockNow locks with the line down and no PIN');
  assert.ok(/if \(!lockSafe\(\)\) \{ AUTOLOCK_T = setTimeout\(autoLockFire, 60000\); return; \}/.test(body(PAGE, 'function autoLockFire(').text),
    'auto-lock fires with the line down and no PIN');
  const st = body(PAGE, 'async function lockStranded(').text;
  assert.ok(/if \(lockSafe\(\)\) return lockOpen\(\);/.test(st) && /if \(!ok \|\| lockSafe\(\)\) return;/.test(st),
    'the unproven unlock is reachable while a sign-in is possible');
  assert.ok(/return lineUp\(\) \|\| pinsUsable\(\);/.test(PAGE), 'lockSafe no longer means "a sign-in is possible"');
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
  /* MOVED 2026-09-29: the tag list gained R (money received, BOOKS v2) after EXP — CN and EXP are still their own runs */
  assert.ok(/kind === 'CN' \|\| kind === 'EXP'( \|\| kind === 'R')?\) \? kind : ''/.test(PROG), 'CN/EXP are not their own series in nextNumberOf');
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

/**
 * ⭐⭐ BOOKS v2 (2026-09-29) — MONEY RECEIVED IS NOT A SALE, AND CREDIT NEEDS SOMEBODY. The day's totals (CBRollup)
 * count every row of the bills store / bills file as a sale, so a payment filed there would inflate the day's sales
 * by exactly the money collected on old bills. And a credit bill addressed to nobody is money nobody can be asked for.
 * [SPEC-books-v2 §4 · e2e/till-books-offline.cjs proves the behaviour; these pin the source]
 */
console.log('\nB2 · money received, and credit\n');

it('the browser files a payment received in its own list — never the bills store', () => {
  const at = PAGE.indexOf('\n  async payment(p){');
  assert.ok(at > 0, 'CloudHost.payment is gone — this guard is measuring nothing');
  const p = { text: PAGE.slice(at, PAGE.indexOf('\n  },\n', at)) };   /* a method ends at its own "  }," */
  assert.ok(/nextNumber\('R'\)/.test(p.text), 'payments are not numbered in their own R series');
  assert.ok(/DB\.put\('queue'/.test(p.text), 'a payment is not queued');
  assert.ok(!/DB\.put\('bills'/.test(p.text), 'a payment was written into the bills store — the day would count it as a sale');
});
it('the shop PC files a payment received with the day\'s documents — never the bills file', () => {
  assert.ok(/doc\.kind === 'payment' \? 'R'/.test(PROG), '/api/record no longer knows a payment');
  assert.ok(/appendLine\(want === 'R' \? F\.docs\(today\(\)\) : F\.bills\(today\(\)\), rec\)/.test(PROG), 'a payment may land in the bills file');
  assert.ok(/payment: function\(p\)\{ return this\.record\('R'[\s\S]{0,80}chitOfPayment\)/.test(PAGE), 'AgentHost does not build with chitOfPayment');
});
it('a receipt number cannot take the shape of a sale number (tag first, for a kind the engine does not know)', () => {
  assert.ok(/R: 'payment'/.test(PAGE), 'DOC_TAGS lost the R series');
  assert.ok(/hasOwnProperty\.call\(D\.KINDS, docKindOf\(kind\)\)\)\) return tag \+ '\/' \+ body;/.test(PAGE), 'an unknown kind would be composed like a sale');
});
it('On credit is offered only for ONE known customer, and a credit bill without one is refused', () => {
  assert.ok(/if \(credCust\) ways\.push\(\{ id:'credit', label:'On credit' \}\);\n  else if \(PICKED === 'On credit'\) PICKED = ways\[0\]\.label;/.test(PAGE), 'the credit tender is offered without a known customer, or stays picked after one is cleared');
  assert.ok(/if \(!cust\) \{ say\('On credit needs a customer/.test(PAGE), 'finish() lets a credit bill through with nobody on it');
  assert.ok(/return hits\.length === 1 \? hits\[0\] : null;/.test(body(PAGE, 'function custKnown(').text), 'custKnown() no longer insists on exactly one match');
});
/**
 * ⚠️⚠️ 2026-09-30 (review M5): both controls were offered to a shop whose ledger is OFF — the server posts nothing, so
 * the debt existed only as words on a chit. The snapshot says whether it is on; ONE function reads that, and every
 * control asks it. A second reader of the flag, or a control that asks custKnown() directly, fails here by name.
 */
it('On credit and Received need the shop\'s ledger ON — one reader of the flag, asked by every control', () => {
  const on = body(PAGE, 'function booksOn(');
  assert.ok(/snap\.books === true \|\| \(snap\.shop && snap\.shop\.books === true\) \|\| \(snap\.settings && snap\.settings\.books === true\)/.test(on.text), 'booksOn() no longer reads the snapshot\'s flag (top level, shop, settings)');
  assert.ok(/function creditCust\(\)\{ return booksOn\(\) \? custKnown\(\) : null; \}/.test(PAGE), 'creditCust() no longer asks booksOn()');
  const others = outside(PAGE, /\.books === true/, on);
  assert.deepStrictEqual(others, [], 'a second reader of the ledger flag:\n      ' + others.join('\n      '));
  assert.ok(/var credCust = creditCust\(\);/.test(PAGE), 'the On credit tender is offered without asking whether the ledger is on');
  assert.ok(/var c = creditCust\(\);\n  b\.hidden = !c;/.test(body(PAGE, 'function paintRcvPayBtn(').text), 'Received is shown without asking whether the ledger is on');
  assert.ok(/if \(!booksOn\(\)\) \{ say\(/.test(body(PAGE, 'function rcvPayOpen(').text), 'rcvPayOpen() opens with the ledger off');
  assert.ok(/var c = creditCust\(\); if \(!c\) return;/.test(body(PAGE, 'async function rcvPaySave(').text), 'rcvPaySave() records with the ledger off');
  assert.ok(/if \(credit\) \{\n[^\n]*\n    if \(!booksOn\(\)\) \{ say\(/.test(PAGE), 'finish() lets a credit bill through with the ledger off');
});
it('the offline limit counts credit bills not yet confirmed sent, whatever the snapshot\'s age (review F4)', () => {
  const c = body(PAGE, 'async function creditSinceRefresh(');
  assert.ok(/<= snapAt && !unsent\(b\)\) return;/.test(c.text), 'a bill older than the snapshot is dropped even when it never reached the shop');
  const u = body(PAGE, 'async function creditUnsentTest(');
  assert.ok(/queue_kinds\.oldest/.test(u.text) && /!b\._sent/.test(u.text), 'unsent is no longer read from the program\'s queue / the _sent stamp');
});
it('over the limit, only the OWNER\'s counter PIN allows it', () => {
  const o = body(PAGE, 'async function ownerApprove(');
  assert.ok(/e\.kind === 'entity'/.test(o.text), 'the override is no longer limited to the owner');
  assert.ok(/SIGN\(\)\.pinAfter\(/.test(o.text), 'a wrong PIN no longer counts against the PIN');
});

console.log('\n' + pass + ' checks passed\n');
