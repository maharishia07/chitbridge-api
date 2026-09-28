'use strict';
/**
 * one-rounding-rule.test.cjs — ⭐⭐⭐ ONE COPY OF THE MONEY ROUNDING RULE IN EVERYTHING THIS PLATFORM OWNS
 *
 * The loader step of SPEC-one-engine.md (2026-09-28): the rounding rule lives in chitbridge-engines' money engine,
 * adopted as lib/money.js here and engine/money.js on the web. Until today FOUR files the platform owns carried a
 * second copy "in case money.js failed to load" — till.html's r2, cart.js and pick.js in the web app, and
 * lib/inventory.js — and tests/money-round had to hold each copy equal forever. The copies are retired:
 *   · till.html rounds through MONEY(), which SAYS "CBMoney is not loaded" — and the shop-PC kit now carries
 *     money.js, so an unpaired PC has it too;
 *   · cart.js / pick.js throw the same sentence, and every page that loads them loads engine/money.js first;
 *   · inventory.js takes ./money (Tier B now, as convert.js is).
 *
 * ⚠️ THIS FAILS IF A SECOND RULE APPEARS in any platform-owned file — a `.toPrecision(15)` rounding or a
 * `roundMoney_` that does its own Math.round. The ADOPTED engines' own internal fallbacks are not the platform's to
 * change; they carry "ADOPTED from chitbridge-engines" on their first line and only an engines release retires them.
 *
 * Run: node tests/one-rounding-rule.test.cjs   · no DB, no network.
 */
const assert = require('assert'), fs = require('fs'), path = require('path');

const API = path.join(__dirname, '..');
const WEB = path.join(API, '..', 'chitbridge-web', 'public');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

const list = (dir, re) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => re.test(n)).map((n) => path.join(dir, n)) : []);
const OWNED = [
  ...list(path.join(API, 'lib'), /\.js$/),
  ...list(path.join(API, 'routes'), /\.js$/),
  ...list(path.join(API, 'tools', 'tally-connector'), /\.(js|html)$/),
  ...list(path.join(WEB, 'app'), /\.js$/),
  ...list(WEB, /\.html$/),
].filter((f) => {
  const head = fs.readFileSync(f, 'utf8').slice(0, 400);
  if (/ADOPTED from chitbridge-engines/.test(head)) return false;            /* the engines' own — an engines release */
  if (path.resolve(f) === path.resolve(API, 'lib', 'money.js')) return false; /* the rule itself */
  return true;
});

/** a function's body by bracket-matching, from its signature */
function cut(src, at) {
  let d = 0, i = src.indexOf('{', at);
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); } }
  return src.slice(at);
}
const lineOf = (src, k) => src.slice(0, k).split('\n').length;

console.log('\nONE ROUNDING RULE — the platform-owned files\n');

it('the scan reaches the files that used to carry a copy (a guard that reads nothing proves nothing)', () => {
  const names = OWNED.map((f) => path.basename(f));
  ['till.html', 'cart.js', 'pick.js', 'inventory.js'].forEach((n) => assert.ok(names.indexOf(n) >= 0, n + ' is not scanned'));
  assert.ok(OWNED.length > 40, 'only ' + OWNED.length + ' files scanned');
});

it('⚠️⚠️ no platform-owned file rounds money with its own copy of the rule (.toPrecision(15))', () => {
  const bad = [];
  OWNED.forEach((f) => {
    const s = fs.readFileSync(f, 'utf8');
    let k = -1;
    while ((k = s.indexOf('.toPrecision(15)', k + 1)) >= 0) {
      const ls = s.lastIndexOf('\n', k) + 1, text = s.slice(ls, s.indexOf('\n', k)).trim();
      if (/^(\*|\/\/|\/\*)/.test(text)) continue;                               /* prose about the rule, not the rule */
      bad.push(path.relative(path.join(API, '..'), f) + ':' + lineOf(s, k) + '  ' + text.slice(0, 90));
    }
  });
  assert.deepStrictEqual(bad, [], 'a second rounding rule:\n      ' + bad.join('\n      '));
});

it('⚠️ no roundMoney_ in a platform-owned file does its own arithmetic — it asks money.round or says it cannot', () => {
  const bad = [];
  OWNED.forEach((f) => {
    const s = fs.readFileSync(f, 'utf8');
    let k = -1;
    while ((k = s.indexOf('function roundMoney_(', k + 1)) >= 0) {
      const b = cut(s, k);
      if (/Math\.round/.test(b)) bad.push(path.relative(path.join(API, '..'), f) + ':' + lineOf(s, k));
    }
  });
  assert.deepStrictEqual(bad, [], 'a fallback copy is back:\n      ' + bad.join('\n      '));
});

it('till.html rounds through MONEY(), which names the missing engine rather than guessing', () => {
  const s = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.html'), 'utf8');
  assert.ok(/var r2 = function\(n\)\{ return MONEY\(\)\.round\(Number\(n\) \|\| 0\); \};/.test(s), 'r2 no longer goes through MONEY()');
  assert.ok(/CBMoney is not loaded — \/engine\/money\.js is missing from this page/.test(cut(s, s.indexOf('function MONEY('))), 'MONEY() no longer says what is missing');
});

it('⭐ every web page that loads cart.js or pick.js loads engine/money.js BEFORE it', () => {
  const bad = [];
  list(WEB, /\.html$/).forEach((f) => {
    const s = fs.readFileSync(f, 'utf8');
    const uses = s.search(/<script[^>]*src="\/?app\/(cart|pick)\.js"/);
    if (uses < 0) return;
    const money = s.search(/<script[^>]*src="\/?engine\/money\.js"/);
    if (money < 0 || money > uses) bad.push(path.basename(f) + (money < 0 ? ' — no money.js at all' : ' — money.js AFTER cart/pick'));
  });
  assert.deepStrictEqual(bad, [], 'a page rounds with nothing to round with:\n      ' + bad.join('\n      '));
});

it('⭐ the shop-PC kit CARRIES money.js, so an unpaired PC has the rule before it has a shop', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(API, 'engines.lock.json'), 'utf8'));
  const files = (lock.files && lock.files.money) || (lock.engines && lock.engines.money && lock.engines.money.files) || JSON.stringify(lock);
  assert.ok(JSON.stringify(files).indexOf('tools/tally-connector/money.js') >= 0, 'the lock no longer adopts money.js into the kit');
  assert.ok(fs.existsSync(path.join(API, 'tools', 'tally-connector', 'money.js')), 'the kit has no money.js');
  const route = fs.readFileSync(path.join(API, 'routes', 'integrations.js'), 'utf8');
  assert.ok(/KIT_NAMES = \[[^\]]*'money\.js'/.test(route), 'the server does not offer money.js to a kit');
  const prog = fs.readFileSync(path.join(API, 'tools', 'tally-connector', 'till.js'), 'utf8');
  assert.ok(/const STAGED = \[[^\]]*'money\.js'/.test(prog), 'a shop PC never refreshes its money.js');
});

console.log('\n' + pass + ' checks passed\n');
