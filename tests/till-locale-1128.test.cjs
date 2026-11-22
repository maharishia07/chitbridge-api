'use strict';
/**
 * tillLocale 1128 — the till speaks through the app's ONE string door and ONE packs (no second table), and keeps working offline.
 * The walk-locale till case counted 13 → 24 plain-English words at 390 because the page loaded no pack. Here: the page loads the door,
 * the door is on the service worker's shelf and in the kit, every till string that goes through tx() has an entry in the Hindi and Arabic packs,
 * and a missing pack or door is English, never an error.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API = path.join(__dirname, '..');
const KIT = path.join(API, 'tools', 'tally-connector');
const page = fs.readFileSync(path.join(KIT, 'till.html'), 'utf8');
const vendor = fs.readFileSync(path.join(API, 'scripts', 'vendor-till.cjs'), 'utf8');
const tillJs = fs.readFileSync(path.join(KIT, 'till.js'), 'utf8');
const integrations = fs.readFileSync(path.join(API, 'routes', 'integrations.js'), 'utf8');

test('the page loads the string door after the locale engine, with a stand-in for a kit that lacks it', () => {
  const at = (needle) => page.indexOf(needle);
  assert.ok(at('/engine/locale.js') > 0 && at('/app/cb-words.js') > at('/engine/locale.js'), 'cb-words.js must load after locale.js');
  assert.ok(/src="\/app\/cb-words\.js" onerror="engineMissed\('cb-words'\)"/.test(page), 'a missing door is reported, never thrown');
  assert.ok(/if \(typeof tx !== 'function'\)/.test(page) && /CBLocale\.apply\(\)/.test(page), 'the stand-in and the pack request are on the boot path');
  assert.ok(/function renderApp\(\)/.test(page), 'the pack calls renderApp() on arrival: the till must have one');
});

test('the service worker shelf, the kit list and the kit server carry the door and both packs', () => {
  for (const f of ['cb-words.js', 'strings-hi.js', 'strings-ar.js']) {
    assert.ok(vendor.includes("'/app/" + f + "'"), f + ' is not on the shelf');
    assert.ok(tillJs.includes("'/app/" + f + "'"), f + ' is not served by the kit');
    assert.ok(tillJs.includes("'" + f + "'") && integrations.includes("'" + f + "'"), f + ' is not in the kit update lists');
    assert.ok(fs.existsSync(path.join(KIT, f)), f + ' has no kit copy');
  }
  assert.ok(/const SHELF = 'cb-till-v10'/.test(vendor), 'the shelf was not bumped');
});

/** every tx('…') / txf('…') / txn('…','…') English key the till page now uses */
function keysOfPage() {
  const out = new Set();
  const grab = (re) => { let m; while ((m = re.exec(page))) out.add(m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'")); };
  grab(/\btx\('((?:[^'\\]|\\.)*)'\)/g);
  grab(/\btxf\('((?:[^'\\]|\\.)*)'/g);
  let m; const re = /\btxn\('((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'/g;
  while ((m = re.exec(page))) { out.add(m[1]); out.add(m[2]); }
  return out;
}

function door(lang) {
  const ls = { cb_lang: lang };
  const ctx = vm.createContext({ localStorage: { getItem: (k) => ls[k] || null }, document: { documentElement: { getAttribute: () => 'ltr' } }, CBLocale: { locale: () => 'en-IN', number: (n) => String(n) } });
  vm.runInContext(fs.readFileSync(path.join(KIT, 'cb-words.js'), 'utf8') + '\n;this.tx = tx; this.txf = txf; this.txn = txn;', ctx);
  return ctx;
}

for (const lang of ['hi', 'ar']) {
  test('every till string through tx() has an entry in the ' + lang + ' pack, and the pack says it', () => {
    const ctx = door(lang);
    vm.runInContext(fs.readFileSync(path.join(KIT, 'strings-' + lang + '.js'), 'utf8'), ctx);
    const keys = [...keysOfPage()].filter((k) => !/^(?:\{[a-z]+\}|)$/.test(k));
    const missing = keys.filter((k) => ctx.tx(k) === k && !/^\W*$/.test(k));
    assert.deepStrictEqual(missing, [], lang + ' pack lacks: ' + missing.join(' | '));
    assert.notStrictEqual(ctx.txf('Give back {total}', { total: '10.00' }), 'Give back 10.00');
    assert.ok(ctx.txf('Give back {total}', { total: '10.00' }).includes('10.00'), 'the figure survives the sentence');
  });
}

test('a language with no pack (or no door) is English, never an error', () => {
  const ctx = door('xx');
  assert.strictEqual(ctx.tx('Nothing matches.'), 'Nothing matches.');
  assert.strictEqual(ctx.txf('Give back {total}', { total: '5.00' }), 'Give back 5.00');
  assert.strictEqual(ctx.txn('You had a bill open with {count} item', 'You had a bill open with {count} items', 3), 'You had a bill open with 3 items');
});

test('the kit copies are byte-equal to the web packs (vendor-till --check holds them; here the pair is read)', () => {
  const web = process.env.CB_WEB_DIR || path.join(API, '..', 'chitbridge-web');
  for (const f of ['cb-words.js', 'strings-hi.js', 'strings-ar.js']) {
    const w = path.join(web, 'public', 'app', f);
    if (fs.existsSync(w)) assert.strictEqual(fs.readFileSync(path.join(KIT, f), 'utf8'), fs.readFileSync(w, 'utf8'), f);
  }
});
