/**
 * tests/chunk0-web-proofs2.test.cjs — Chunk 0 proofs, second set, web controls extracted from the shipped source (no browser).
 * NET-13 owner sees the network storefront status line (cap-admin.js) · NET-44 a remote supplier's refusal is said in the server's words (app.html supEmptyAllWords)
 * NET-45 a failed catalogue fetch is tried once more and the reason logged (app.html supCatalogueFetch) · UX-123 message times show in the shop's zone (helpers.js shopDateTime)
 * CTR-79 the kitchen surface is gated by tillOpt().kot (till.html kotOn).
 * Run: node tests/chunk0-web-proofs2.test.cjs
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');
const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const fnText = (src, head, end) => {
  const i = src.indexOf(head); assert(i >= 0, 'not found: ' + head);
  const j = src.indexOf(end || '\n}\n', i); assert(j > i, 'end not found: ' + head);
  return src.slice(i, j + (end ? end.length : 3));
};
let n = 0; const jobs = [];
const ok = (name, f) => jobs.push(Promise.resolve().then(f).then(() => { n++; console.log('ok - ' + name); }));
const run = (code, ctx) => { vm.createContext(ctx); vm.runInContext(code, ctx); return ctx; };

ok('NET-13 cap-admin: a network store shows how many stores under it are public, or "nothing under you is public"; a null count shows no line', () => {
  const src = read('app/cap-admin.js');
  const i = src.indexOf("vis === 'network' && e.network_public_count != null");
  assert(i > 0, 'the status line must be guarded by "count is not null" (null is not zero)');
  const block = src.slice(i, i + 700);
  assert(/network_public_count > 0/.test(block) && /store\(s\) under you are public/.test(block), 'a positive count says how many are public');
  assert(/nothing under you is public/.test(block), 'zero says nothing under you is public');
});

ok('NET-44 a remote supplier that refused answers in the server\'s own words, a local empty catalogue says "has not published"', () => {
  const src = read('app.html');
  const f = fnText(src, 'function supEmptyAllWords(', '\n}\n');
  const mk = (remote) => run(f, { UI: { supDet: { cat: { remote } } }, txf: (s, o) => s.replace('{name}', o.name), supName: () => 'Acme' });
  assert.strictEqual(mk({ ok: false, why: 'Acme sells only on their own ChitBridge.' }).supEmptyAllWords({}), 'Acme sells only on their own ChitBridge.');
  assert.strictEqual(mk(null).supEmptyAllWords({}), 'Acme has not published anything you can order yet.');
  assert.strictEqual(mk({ ok: true }).supEmptyAllWords({}), 'Acme has not published anything you can order yet.');
});

ok('NET-45 a catalogue fetch that fails before reaching the api is tried once more, logged each time, then said in words', async () => {
  const src = read('app.html');
  const f = fnText(src, 'async function supCatalogueFetch(', '\n}\n');
  const mk = (fails) => {
    const c = { calls: 0, warns: [], CFG: { API_BASE: 'http://x' }, SESSION: { token: 't' }, tx: (s) => s, encodeURIComponent,
      console: { warn: (m) => c.warns.push(m) }, setTimeout: (fn) => fn(), Promise, Error,
      fetch: async () => { c.calls++; if (c.calls <= fails) throw new Error('Failed to fetch'); return { ok: true }; } };
    return run(f, c);
  };
  let c = mk(1); const res = await c.supCatalogueFetch('s1');
  assert.deepStrictEqual([res.ok, c.calls, c.warns.length], [true, 2, 1], 'one failure, one retry, one warning');
  c = mk(2);
  await assert.rejects(() => c.supCatalogueFetch('s1'), /Could not reach the server to read their catalogue/);
  assert.deepStrictEqual([c.calls, c.warns.length], [2, 2], 'never more than two attempts, both logged');
});

ok('UX-123 shopDateTime formats in the shop\'s own zone, ignores an unknown zone, and leaves the person\'s zone when none is stated', () => {
  const src = read('app/helpers.js');
  const f = fnText(src, 'function shopDateTime(', '\n}\n');
  const seen = [];
  const mk = (tz) => run(f, { window: { CB_SHOP_TZ: tz }, console: { warn() {} }, Intl, Object, String, CBLocale: { datetime: (ts, o) => { seen.push(o); return 'x'; } } });
  mk('Australia/Sydney').shopDateTime('2026-11-14T10:00:00Z');
  mk('Not/AZone').shopDateTime('2026-11-14T10:00:00Z');
  mk('').shopDateTime('2026-11-14T10:00:00Z');
  assert.strictEqual(seen[0].timeZone, 'Australia/Sydney');
  assert.strictEqual(seen[1].timeZone, undefined, 'an unknown zone is not passed on');
  assert.strictEqual(seen[2].timeZone, undefined, 'no zone stated: nothing guessed');
});

ok('CTR-79 the kitchen surface is declared as an option: kotOn() is true only when tillOpt().kot === true, and the order strip is hidden otherwise', () => {
  const src = read('till.html');
  const f = fnText(src, 'function kotOn(){', '}\n');
  const on = (opt) => run(f, { tillOpt: () => opt }).kotOn();
  assert.deepStrictEqual([on({ kot: true }), on({ kot: false }), on({}), on({ kot: 'yes' })], [true, false, false, false]);
  assert(/MODE !== 'sell' \|\| \(!kotOn\(\) && !purposeHas\('open_orders'\)\)\) \{ el\.innerHTML = ''; return; \}/.test(src), 'the kitchen strip is emptied unless kot is on or the purpose has open orders');
});

ok('NET-19 shop/store/embed/network read the session only to show the login state: one getItem of cb_sess in shop.html, no writes in any of the four', () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  const pages = { 'shop.html': strip(read('shop.html')), 'store.html': strip(read('store.html')), 'embed.html': strip(read('embed.html')), 'network.html': strip(read('network.html')) };
  Object.keys(pages).forEach((p) => {
    assert(!/(localStorage|sessionStorage)\s*\.\s*(setItem|removeItem|clear)\s*\(\s*['"]cb_sess/.test(pages[p]), p + ' writes the session');
    assert(!/SESSION\s*(\.\w+)?\s*=[^=]/.test(pages[p]), p + ' assigns to a SESSION');
    if (p !== 'shop.html') assert(!/cb_sess/.test(pages[p]), p + ' reads the session key');
  });
  const reads = pages['shop.html'].match(/getItem\(\s*['"]cb_sess['"]/g) || [];
  assert.strictEqual(reads.length, 1, 'shop.html reads cb_sess exactly once (the owner preview token)');
  assert(/function _ownerToken\(\)\s*\{\s*try \{\s*var parsed = JSON\.parse\(localStorage\.getItem\('cb_sess'\)/.test(pages['shop.html']), 'and that read is _ownerToken()');
});

ok('CAT-154 / CAT-155 a category offers no members field (the relationship lives on the product)', () => {
  const src = read('app/cap-definitions.js');
  const f = fnText(src, 'function cbDefRuleFields(', '\n}\n');
  const rules = run(f, { cbDefRuleFields: null }).cbDefRuleFields('category');
  assert.strictEqual(JSON.stringify(rules), '[]', 'category has no rule fields at all');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert(!/key\s*:\s*['"]members['"]/.test(code), 'no field keyed members is declared in cap-definitions.js');
});

ok('OPS-29 the supplier list splits Trade (things we sell) and Other (things we use) by supply_kind, with a count on each tab', () => {
  const kinds = fnText(read('app/cap-suppliers.js'), 'function supKindOf(', '\n}\n');
  const app = read('app.html');
  const code = [fnText(app, 'function supKind(', '\n}\n'), fnText(app, 'function supKindCount(', '\n}\n'), fnText(app, 'function supKindTabsHTML(', '\n}\n')].join('\n');
  const ctx = run(kinds + '\n' + code, { UI: { supKind: 'resale', sups: [{ supply_kind: 'resale' }, { supply_kind: 'own_use' }, { supply_kind: 'own_use' }, {}] }, tx: (s) => s });
  assert.strictEqual(ctx.supKindCount('resale'), 2, 'an unset kind counts as Trade');
  assert.strictEqual(ctx.supKindCount('own_use'), 2);
  const html = ctx.supKindTabsHTML();
  assert(/data-testid="sup-tab-trade"[^>]*>[^<]*Trade <span[^>]*>2</.test(html) && /data-testid="sup-tab-other"[^>]*>[^<]*Other <span[^>]*>2</.test(html), 'two tabs, each with its count');
  ctx.UI.supKind = 'own_use';
  assert(/class="on" data-testid="sup-tab-other"/.test(ctx.supKindTabsHTML()), 'the selected kind is the one marked on');
  assert(/Things we sell/.test(app) && /Things we use/.test(app), 'the per-supplier switch names both kinds in words');
});

ok('OPS-34 required certificates sit beside suppliers: the Suppliers tab strip carries Required certificates and opens supReqOpen', () => {
  const app = read('app.html');
  assert(/data-testid="sup-tab-req" onclick="supReqOpen\(\)">[^<]*Required certificates<\/button>/.test(app));
  assert(/function supReqOpen\(\)/.test(app));
  assert(/function supRequiredScope\(/.test(app), 'and the match reads the same list (proved in chunk0-proofs.test.cjs)');
});

Promise.all(jobs).then(() => console.log(n + ' passed'), (e) => { console.error('FAIL', e.message); process.exit(1); });
