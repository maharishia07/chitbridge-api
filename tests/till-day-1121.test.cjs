/* Walk B 21 Nov (B-F-23..30): the till and its day. Lifts the page's own functions (follow ctr-242). Break check per case: put the old line back and the case fails. */
// CARD      09-counter/day-close
'use strict';
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const h = fs.readFileSync(__dirname + '/../tools/tally-connector/till.html', 'utf8').replace(/\r\n/g, '\n');
function grabAt(at, label) { assert.ok(at >= 0, label + ' is gone from till.html'); let i = h.indexOf('{', at), d = 0; for (; i < h.length; i++) { if (h[i] === '{') d++; else if (h[i] === '}' && --d === 0) break; } return h.slice(at, i + 1); }
const grab = (n) => { const at = h.indexOf('function ' + n + '('); return (h.slice(at - 6, at) === 'async ' ? 'async ' : '') + grabAt(at, n); };
const lift = (names, ctx) => { vm.createContext(ctx); vm.runInContext(names.map(grab).join('\n'), ctx); return ctx; };
let n = 0; const ok = async (what, fn) => { await fn(); n++; console.log('  ok  ' + what); };
const base = { tx: (e) => e, txf: (e, v) => String(e).replace(/\{(\w+)\}/g, (w, k) => (v && k in v ? v[k] : w)), cbQuiet() {}, rmoney: (v) => Math.round(v * 100) / 100, r2: (v) => Math.round(v * 100) / 100, Math, Number, String, Object, Array, JSON, isFinite, isNaN, Date, Intl };

(async () => {
  await ok('B-F-23: the bill warning "Open the day" runs beginDay, not only opens the menu', () => {
    let began = 0, menu = 0;
    const c = lift(['billWarnDoor'], Object.assign({}, base, { openMenuAt: () => { menu++; }, beginDay: () => { began++; } }));
    assert.strictEqual(c.billWarnDoor('day'), true); assert.strictEqual(menu, 1); assert.strictEqual(began, 1);
  });
  const closeCtx = (answers, sureAnswer) => {
    const out = { committed: null, asked: [] }, ans = answers.slice();
    const c = lift(['dayCloseDo'], Object.assign({}, base, { DAY_D: { expected_cash: 100, server: null }, money: (v) => 'A$' + v.toFixed(2), curSym: () => 'A$', toastLine() {},
      ask: async (m) => { out.asked.push(m); return ans.shift(); }, sure: async (m) => { out.sure = m; return sureAnswer; }, dayCloseCommit: (x) => { out.committed = x; } }));
    return { c, out };
  };
  await ok('B-F-24: closing asks the counted cash, shows expected against counted, records the difference, then confirms', async () => {
    const { c, out } = closeCtx(['96.5'], true); await c.dayCloseDo();
    assert.ok(/Should be there: A\$100\.00/.test(out.asked[0])); assert.ok(/short by A\$3\.50/.test(out.sure));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(out.committed)), { counted: 96.5, expected: 100, difference: -3.5 });
  });
  await ok('B-F-24: cancelling the count, a blank, or the confirm leaves the day open', async () => {
    for (const [a, s] of [[[null], true], [[''], true], [['100'], false]]) { const { c, out } = closeCtx(a, s); await c.dayCloseDo(); assert.strictEqual(out.committed, null); }
  });
  await ok('B-F-25: the day sheet keeps sold, returned and net apart (2 sold, 1 returned = net 1, not 3)', () => {
    const sale = { no: 'A', kind: 'tax', total: 26, taxable: 24, tax: 2, lines: [{ name: 'Flat White', qty: 2, net: 26 }], payments: [{ how: 'Cash', amount: 26 }] };
    const ret = { no: 'C', kind: 'credit_note', total: -13, taxable: 0, tax: 0, lines: [{ name: 'Flat White', qty: 1, net: 13 }], refunds: [{ how: 'Cash', amount: 13 }] };
    const c = lift(['dayAddTotals', 'dayAddTaxApart', 'dayAddItem', 'dayAddTenders', 'dayAddPerson', 'dayAddIssued', 'dayAddSplit', 'dayCloseSheet', 'returnedFigures', 'creditNoteSplit', 'isReturnRow', 'isExpenseRow'],
      Object.assign({}, base, { window: {}, WHO: { name: 'T', float: 0 }, CBTax: { splitLineTax: () => ({ assessable: 0, tax: 0 }) }, taxIncluded: () => true }));
    const d = c.dayCloseSheet([sale, ret]), it = d.items['Flat White'];
    assert.strictEqual(it.sold, 2); assert.strictEqual(it.returned, 1); assert.strictEqual(it.qty, 1); assert.strictEqual(it.net, 13);
    assert.strictEqual(d.taxable_sold, 24); assert.strictEqual(d.taxable_back, 0);
  });
  await ok('B-F-25: the report prints sold, returned and net in words', () => {
    assert.ok(/'sold ' \+ item\.sold \+ ', returned '/.test(h)); assert.ok(/Taxable on sales/.test(h) && /Taxable returned/.test(h) && h.indexOf("schemeWord() + ', net'") > 0); /* batch 1126 read: the row is dayMostSoldRow(item, name) */
  });
  await ok('B-F-26: the report date is the shop country\'s order (AU 21/11/2026), not the PC\'s', () => {
    const c = lift(['shopDate', 'shopFmt', 'tzOpt', 'shopTz', 'shopOwnTz'], Object.assign({}, base, { window: { CBLocale: { REGIONS: { AU: { format: 'en-AU' }, US: { format: 'en-US' } }, timezone: () => 'Australia/Sydney' } }, docCountry: () => 'AU', shopPack: () => null }));
    assert.strictEqual(c.shopDate(Date.UTC(2026, 10, 21, 5)), '21/11/2026');
    assert.ok(/t\(esc\(shopDate\(Date\.now\(\)\)\)/.test(h) && !/esc\(new Date\(\)\.toLocaleDateString\(\)\)/.test(h));
  });
  await ok('AE-F-05/20: the counter writes the shop zone from the snapshot (Perth 08:30 for 00:30Z, not the PC Sydney), English words, the shop order, Latin digits for an AE shop', () => {
    const at = Date.UTC(2026, 10, 21, 0, 30);
    const perth = lift(['shopDate', 'shopFmt', 'tzOpt', 'shopTz', 'shopOwnTz', 'hhmm'], Object.assign({}, base, { S: { shop: { timezone: 'Australia/Perth' } }, window: { CBLocale: { timezone: () => 'Australia/Sydney' } }, docCountry: () => 'AU', shopPack: () => null }));
    assert.strictEqual(perth.hhmm(at), '08:30');
    const dubai = lift(['shopDate', 'shopFmt', 'tzOpt', 'shopTz', 'shopOwnTz'], Object.assign({}, base, { S: { shop: { timezone: 'Asia/Dubai' } }, window: { CBLocale: { REGIONS: { AE: { format: 'ar-AE' } }, timezone: () => 'Asia/Kolkata' } }, docCountry: () => 'AE', shopPack: () => null }));
    const said = dubai.shopDate(Date.UTC(2026, 10, 21, 22, 30));
    assert.strictEqual(said, '22/11/2026'); assert.ok(!/[؀-ۿ]/.test(said));
    assert.ok(fs.readFileSync(__dirname + '/../routes/till.js', 'utf8').includes('timezone: countrySetup.clockOf({ country, timezone: row.timezone }).zone'), 'the snapshot carries shop.timezone');
  });
  await ok('B-F-27: the bill table\'s money columns shrink before Value is cut', () => {
    assert.ok(/minmax\(84px,94px\)/.test(h) && /minmax\(88px,112px\)/.test(h));
  });
  await ok('B-F-28: after a part, an empty amount box takes the rest in the picked way (what the line says)', () => {
    const c = lift(['tenderParts'], Object.assign({}, base, { PICKED: 'Card', cashDue: (v) => v, payWayId: () => 'card', say() {}, creditCust: () => null }));
    const parts = c.tenderParts([{ how: 'Cash', amount: 5 }], 11, 0);
    assert.strictEqual(parts.length, 2); assert.strictEqual(parts[1].how, 'Card'); assert.strictEqual(parts[1].amount, 6);
  });
  await ok('B-F-29: row buttons and the Day popup carry words in sentence case; Esc hint says it parks', () => {
    assert.ok(/CTR008-B16">View<\/button>/.test(h) && /CTR008-B28">Print<\/button>/.test(h) && />Return<\/button>/.test(h) && !/>return<\/button>/.test(h));
    assert.ok(/📊 Day report<\/button>/.test(h) && /✕ Close<\/button>/.test(h)); assert.ok(!/Esc<\/b> clear/.test(h) && /Esc<\/b> park the bill/.test(h));
  });
  await ok('B-F-30: a bill number already used says what to do next', () => { assert.ok(/nothing was changed\. Press Save again: the counter takes the next number\./.test(h)); });
  await ok('B-F-22: the owner signed in as the shop may set a rate at the till', () => {
    const mk = (who) => lift(['rateMay'], Object.assign({}, base, { cbRateMay: (f) => ({ ok: !!(f && f.owner) }), personOn: () => false, S: { staff: [] }, WHO: who, CloudHost: {} })).rateMay();
    assert.strictEqual(mk({ kind: 'entity' }).ok, true); assert.strictEqual(mk({ kind: 'coassist' }).ok, false);
  });
  await ok('B-F-24: ask then sure — the first dialog late close event must not cancel the confirm that opens right after it', async () => {
    const el = () => ({ hidden: false, textContent: '', value: '', style: {}, innerHTML: '', appendChild() {}, focus() {}, select() {} });
    const els = {}; ['askbody', 'askinput', 'asklabel', 'askno', 'askok', 'asktitle'].forEach((k) => { els[k] = el(); });
    let lateClose = null;
    const dlg = { open: false, onclose: null, showModal() { this.open = true; }, close() { this.open = false; const self = this; lateClose = () => self.onclose && self.onclose(); } };   /* the real event is a queued task: it fires AFTER the next dialog is open */
    els.askdlg = dlg;
    const c = lift(['_askClose', '_askOpen', 'sure', 'ask'], Object.assign({}, base, { _askResolve: null, pictureModeOn: () => false, voiceSay() {}, toastLine() {}, setTimeout: () => 0, Promise,
      document: { getElementById: (k) => els[k], createElement: () => el() } }));
    const first = c.ask('count', '', 'Cash', 'Close the day'); els.askinput.value = '0'; els.askok.onclick();
    assert.strictEqual(await first, '0');
    const second = c.sure('close?', 'Close the day', 't', 'Not yet');   /* what dayCloseDo does next */
    assert.strictEqual(dlg.open, true); lateClose();                    /* the first dialog's close event arrives now */
    let settled = false; second.then(() => { settled = true; }); await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(settled, false, 'the late close event cancelled the confirm'); els.askok.onclick(); assert.strictEqual(await second, true);
  });
  console.log(n + ' ok');
})().catch((e) => { console.error(e); process.exit(1); });
