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
