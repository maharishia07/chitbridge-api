/**
 * tests/shrink-w4-parts.test.cjs — Clear payment (chit-unpay.js), the add-to-offer confirm (offer-add-confirm.js) and the CMDB record page, one rule at a time.
 *
 * Reads public/app/chit-unpay.js and public/app/offer-add-confirm.js (loaded the way app.html loads them: plain scripts, globals read at call time over stand-ins)
 * and public/cmdb/record.html (the page text and its colour tokens). Unit per rule, refusal path, fail closed.
 * Run: node tests/shrink-w4-parts.test.cjs
 *
 * Evidence for the §7 minimums, in words the trace reads:
 *  - walk: e2e/l15-confirm-money-actions.test.cjs walks Clear payment and the add-to-offer confirm through the real confirm; e2e/chit-sheet-breaks.cjs breaks them; this file is the offline layer under them.
 *  - theme (dark, 1366 and 390): the CMDB record page has a light set, a dark set for the OS and a forced dark set, and phone rules at 520 and 860 px (checked below); the two scripts draw no colour of their own.
 *  - contrast (a11y): the record page's ink and muted text meet AA (4.5 : 1) on its paper, in the light and the dark set (computed below); the confirm texts name the amount and the offer, never colour alone.
 *  - could not read: a chit that does not carry its amount and currency is refused in words and nothing is cleared; an offer read without terms is refused in words and nothing is saved.
 *  - string layer: every sentence goes through tx( ... ) (checked with a marking tx); the record page formats no number or date with a locale call of its own.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
let failures = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => console.log('  ok  ', name), (e) => { failures++; console.log('  FAIL', name, '\n      ', e.message); });

/** the page's scripts over stand-ins: every global they read at call time is here and recorded */
function stage(tx) {
  const calls = [], toasts = [], asks = [];
  let accept = true;
  const sandbox = {
    api: async (name, o) => { calls.push({ name, o }); return name === 'defGet' ? { definition: { current_version: 1, sub_kind: 'percent_off', name: 'Diwali' }, versions: [{ version: 1, rules: { kind: 'percent_off', value: 10 } }] } : {}; },
    toast: (m) => toasts.push(m), tx, txn: (one, many, n) => tx(n === 1 ? one : many).replace('{count}', n), esc: (s) => String(s),
    fmtMoney: (n, code) => (code || '') + ' ' + n, showBusy() {}, hideBusy() {}, closeModal() {}, loadCatalogue: async () => {}, openChit() {},
    prodOfferTerms: () => '10% off', prodOfferWindow: () => 'no end date', MSG: { fail: () => 'fail' }, _DEFS: {}, CBDEF: null,
    UI: { rows: [{ id: 'c1', currency: 'AUD', business_json: { payment: { method: 'upi', ref: 'UTR-1', amount: 100 } } }, { id: 'c2', business_json: { payment: { amount: 5 } } }], prods: [{ id: 'p1', name: 'Dosa' }], prodPicked: new Set(['p1']), prodPick: true },
    CBAction: { ask: async (o) => { asks.push(o); return accept; } }
  };
  vm.createContext(sandbox);
  ['public/app/chit-unpay.js', 'public/app/offer-add-confirm.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }));
  return { sb: sandbox, calls, toasts, asks, answer: (yes) => { accept = yes; } };
}
const plain = stage((s) => s);
const marked = stage((s) => '«' + s + '»');
const written = (world, name) => world.calls.filter((c) => c.name === name).length;

(async () => {
  await t('Clear payment: a row without amount and currency is refused in words and nothing is written (fail closed)', async () => {
    await plain.sb.chitUnpay('c2');
    assert.strictEqual(written(plain, 'chitUnpay'), 0);
    assert.strictEqual(plain.asks.length, 0);
    assert.ok(/amount and currency/.test(plain.toasts[0]));
    await plain.sb.chitUnpay('missing');
    assert.ok(/not on screen/.test(plain.toasts[1]));
  });
  await t('Clear payment: the question shows the amount with its currency, the method and the reference; No writes nothing', async () => {
    plain.answer(false);
    await plain.sb.chitUnpay('c1');
    assert.strictEqual(plain.asks.length, 1);
    assert.ok(/AUD 100/.test(plain.asks[0].body) && /UPI/.test(plain.asks[0].body) && /UTR-1/.test(plain.asks[0].body));
    assert.strictEqual(written(plain, 'chitUnpay'), 0);
  });
  await t('Clear payment: Yes writes once and the row forgets its payment', async () => {
    plain.answer(true);
    await plain.sb.chitUnpay('c1');
    assert.strictEqual(written(plain, 'chitUnpay'), 1);
    assert.strictEqual(plain.sb.UI.rows[0].business_json.payment, undefined);
  });
  await t('string layer: the confirm and the refusal are said through tx', async () => {
    marked.answer(false);
    await marked.sb.chitUnpay('c1');
    await marked.sb.chitUnpay('c2');
    assert.ok(/«/.test(marked.asks[0].title) && /«/.test(marked.asks[0].body) && /«/.test(marked.toasts[0]));
  });
  await t('offer reach: adding unions, removing differences; the last removal means every product and is asked about', () => {
    const next = plain.sb.prodOfferNextIds(['a'], ['b', 'a'], true);
    assert.deepStrictEqual(Array.from(next), ['a', 'b']);
    assert.deepStrictEqual(Array.from(plain.sb.prodOfferNextIds(['a', 'b'], ['a'], false)), ['b']);
    assert.strictEqual(plain.sb.prodOfferToAll({ add: false, next: [], was: ['a'] }), true);
    assert.strictEqual(plain.sb.prodOfferToAll({ add: true, next: ['a'], was: [] }), false);
  });
  await t('offer reach: an empty list is removed, never saved empty (empty would mean every product)', () => {
    const rules = { kind: 'percent_off', applies_to: { item_ids: ['a'] } };
    plain.sb.prodOfferSetReach(rules, { item_ids: ['a'] }, []);
    assert.strictEqual(rules.applies_to, undefined);
    plain.sb.prodOfferSetReach(rules, {}, ['x']);
    assert.deepStrictEqual(Array.from(rules.applies_to.item_ids), ['x']);
  });
  await t('add to offer: Yes writes the merged rules once; No writes nothing', async () => {
    plain.calls.length = 0;
    plain.answer(false);
    await plain.sb.prodOfferApply('o1', true);
    assert.strictEqual(written(plain, 'defSave'), 0);
    plain.answer(true);
    plain.sb.UI.prodPicked = new Set(['p1']);
    await plain.sb.prodOfferApply('o1', true);
    assert.strictEqual(written(plain, 'defSave'), 1);
    const save = plain.calls.filter((c) => c.name === 'defSave')[0];
    assert.strictEqual(save.o.body.rules.kind, 'percent_off');
    assert.deepStrictEqual(Array.from(save.o.body.rules.applies_to.item_ids), ['p1']);
  });
  await t('add to offer: an offer read without terms is refused in words and nothing is saved (fail closed)', async () => {
    const world = stage((s) => s);
    world.sb.api = async (name, o) => { world.calls.push({ name, o }); return name === 'defGet' ? { definition: {}, versions: [] } : {}; };
    await world.sb.prodOfferApply('o1', true);
    assert.strictEqual(written(world, 'defSave'), 0);
    assert.ok(/nothing was changed/.test(world.toasts[0]));
  });
  await t('string layer: the done toast and the question are said through tx', () => {
    assert.ok(/«/.test(marked.sb.prodOfferDoneWords(true, 2, null)));
    assert.ok(/«/.test(marked.sb.prodOfferAskWords({ name: 'X' }, { kind: 'percent_off' }, ['p1'])));
  });

  const page = fs.readFileSync(path.join(ROOT, 'public/cmdb/record.html'), 'utf8');
  const luminance = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const token = (block, name) => new RegExp('--' + name + ':(#[0-9A-Fa-f]{6})').exec(block)[1];
  const light = /:root\{([^}]*)\}/.exec(page)[1], dark = /:root:not\(\[data-theme="light"\]\)\{([^}]*)\}/.exec(page)[1];
  await t('CMDB record page: a light set, a dark set for the OS, a forced dark set and phone rules', () => {
    assert.ok(/prefers-color-scheme: dark/.test(page) && /:root\[data-theme="dark"\]/.test(page));
    assert.ok(/max-width:520px/.test(page) && /max-width:860px/.test(page));
  });
  await t('CMDB record page: ink and muted text meet AA on the paper, in both sets (contrast)', () => {
    [light, dark].forEach((block) => ['ink', 'muted'].forEach((name) => assert.ok(ratio(token(block, name), token(block, 'paper')) >= 4.5, name)));
  });
  await t('CMDB record page: the type comes from the self-hosted sheet; no locale call formats a number or a date here', () => {
    assert.ok(/href="\/fonts\/cb-fonts\.css"/.test(page));
    assert.ok(!/toLocale(String|DateString|TimeString)|Intl\./.test(page));
  });
  if (failures) { console.log(failures + ' FAILED'); process.exit(1); }
  console.log('all ok');
})();
