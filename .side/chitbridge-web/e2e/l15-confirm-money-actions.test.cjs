/**
 * e2e/l15-confirm-money-actions.test.cjs — web #744 critic: money actions fire with no confirm (DISCIPLINES: confirm before commit; money promise = deliberate confirm showing its reach).
 * @type regression
 * OWNS      the check, on the REAL chitUnpay and prodOfferApply (public/app.html) through the page's one promise-form confirm (CBAction.ask, accounts-shell.js, over confirmAsk) (title, body, ok label, onOk, danger, onCancel),
 *           that (a) Clear payment writes nothing (no chitUnpay request) until the confirm is accepted, the confirm shows the amount WITH its currency, the method and the reference,
 *           and Cancel, Escape or the backdrop (onCancel) writes nothing; (b) adding products to an offer reads (defGet) but does not write (defSave) until the confirm is accepted, the
 *           confirm names the products and the offer terms, and Cancel writes nothing; taking products OFF asks nothing (narrows reach); (c) a danger confirmAsk focuses Cancel; removing the LAST product (the offer then reaches ALL products) asks too and Cancel keeps the product;
 *           (d) the wizard's last step names what it does (source check on cap-workforce.js).
 * STATUS    was RED on 2026-11-15 (both wrote at once); GREEN with the confirms.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 * FLOW      press -> chitUnpay / prodOfferApply -> CBAction.ask -> confirmAsk -> yes -> api write
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const { liftFns } = require('./lib/lift-fn.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 400) : '')); } };

const calls = [], asks = [], toasts = [];
let focused = 0;
const offer = { definition: { current_version: 1, sub_kind: 'percent_off', name: 'Diwali 10' }, versions: [{ version: 1, rules: { kind: 'percent_off', value: 10 } }] };
const sb = {
  api: async (name, o) => { calls.push({ name, o }); return name === 'defGet' ? JSON.parse(JSON.stringify(offer)) : {}; },
  toast(m) { toasts.push(m); }, tx: (s) => s, txn: (one, many, n) => (n === 1 ? one : many).replace('{count}', n), esc: (s) => String(s),
  fmtMoney: (n, code) => (n == null ? '-' : (code || '') + ' ' + n), showBusy() {}, hideBusy() {}, closeModal() {}, loadCatalogue: async () => {},
  prodOfferTerms: () => '10% off', prodOfferWindow: () => 'no end date', MSG: { fail: () => 'fail' },
  openChit() {}, _DEFS: {}, CBDEF: null,
  document: { querySelector: (q) => (q === '[data-testid="confirm-cancel"]' ? { focus() { focused++; } } : null) },
  UI: { rows: [{ id: 'c1', currency: 'AUD', business_json: { payment: { method: 'upi', ref: 'UTR-42', amount: 118.5 } } }],
        prods: [{ id: 'p1', name: 'Masala Dosa' }, { id: 'p2', name: 'Filter Coffee' }], prodPicked: new Set(['p1', 'p2']), prodPick: true, nav: 'x' },
  confirmAsk: function () { asks.push(Array.prototype.slice.call(arguments)); }
};
/* the page's real promise-form confirm, lifted from accounts-shell.js */
sb.CBAction = { ask: null };
vm.createContext(sb);
vm.runInContext(liftFns('public/app/accounts-shell.js', ['actAsk'], '  ') + '\nthis.CBAction = { ask: actAsk };', sb);
vm.runInContext(liftFns('public/app/chit-unpay.js', ['chitUnpayPay', 'chitUnpayCode', 'chitUnpayRefusal', 'chitUnpayWords', 'chitUnpay']), sb);
vm.runInContext(liftFns('public/app/offer-add-confirm.js', ['prodOfferAskWords', 'prodOfferAllWords', 'prodOfferNextIds', 'prodOfferToAll', 'prodOfferMoved', 'prodOfferConfirm', 'prodOfferRead', 'prodOfferSetReach', 'prodOfferNetworkWas', 'prodOfferDoneWords', 'prodOfferAfterSave', 'prodOfferApply']), sb);
const writes = (n) => calls.filter((c) => c.name === n).length;
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  /* (a) Clear payment */
  const run = sb.chitUnpay('c1');
  await tick();
  ok('Clear payment opens a confirm first', asks.length === 1, 'asks ' + asks.length);
  ok('no chitUnpay request before the confirm', writes('chitUnpay') === 0);
  const said = asks.length ? asks[0][0] + ' ' + asks[0][1] : '';
  ok('the confirm shows the amount with its currency, the method and the reference', /AUD 118\.5/.test(said) && /UPI/.test(said) && /UTR-42/.test(said), said);
  ok('it is the danger style', asks[0] && asks[0][4] === true);
  asks[0][5](); await run;
  ok('Cancel / Escape / backdrop (onCancel): nothing written', writes('chitUnpay') === 0);
  const run2 = sb.chitUnpay('c1'); await tick();
  asks[1][3](); await run2;
  ok('after yes: exactly one chitUnpay request', writes('chitUnpay') === 1);

  /* (a2) money is a value type: no currency on the row, or no row, refuses without a confirm */
  asks.length = 0; calls.length = 0; toasts.length = 0;
  const saved = sb.UI.rows;
  sb.UI.rows = [{ id: 'c2', business_json: { payment: { method: 'cash', amount: 5 } } }];
  await sb.chitUnpay('c2');
  ok('a row with no currency: refused in words, no confirm, no write', asks.length === 0 && writes('chitUnpay') === 0 && toasts.length === 1 && /amount and currency/.test(toasts[0]), toasts.join('|'));
  await sb.chitUnpay('missing');
  ok('a row missing from the screen: refused in words, no confirm, no write', asks.length === 0 && writes('chitUnpay') === 0 && toasts.length === 2 && /not on screen/.test(toasts[1]), toasts.join('|'));
  sb.UI.rows = saved;

  /* (b) offer apply */
  calls.length = 0; asks.length = 0; focused = 0;
  const go = sb.prodOfferApply('o1', true);
  await tick(); await tick();
  ok('adding products opens a confirm after the read', asks.length === 1 && writes('defGet') === 1, 'asks ' + asks.length);
  ok('no defSave before the confirm', writes('defSave') === 0);
  const said2 = asks.length ? asks[0][0] + ' ' + asks[0][1] : '';
  ok('the confirm names the offer, its terms and the products it reaches', /Diwali 10/.test(said2) && /10% off/.test(said2) && /Masala Dosa/.test(said2) && /Filter Coffee/.test(said2) && /2 products/.test(said2), said2);
    asks[0][5](); await go;
  ok('Cancel: nothing written', writes('defSave') === 0);
  sb.UI.prodPicked = new Set(['p1', 'p2']);
  const go2 = sb.prodOfferApply('o1', true); await tick(); await tick();
  asks[1][3](); await go2;
  ok('after yes: exactly one defSave carrying the item ids', writes('defSave') === 1 && JSON.stringify(calls.find((c) => c.name === 'defSave').o.body.rules.applies_to.item_ids) === '["p1","p2"]');
  asks.length = 0; calls.length = 0;
  sb.UI.prodPicked = new Set(['p1']); offer.versions[0].rules.applies_to = { item_ids: ['p1', 'p2'] };
  await sb.prodOfferApply('o1', false);
  ok('taking products OFF asks nothing and saves once', asks.length === 0 && writes('defSave') === 1);

  /* (b1) the offer moved while the question was up: nothing is saved */
  asks.length = 0; calls.length = 0; toasts.length = 0;
  sb.UI.prodPicked = new Set(['p1', 'p2']); offer.versions[0].rules.applies_to = {};
  const go5 = sb.prodOfferApply('o1', true); await tick(); await tick();
  offer.definition.current_version = 2; asks[0][3](); await go5;
  ok('version moved while confirming: no defSave and the words say so', writes('defSave') === 0 && toasts.some((m) => /changed while you were confirming/.test(m)), toasts.join('|') + ' saves ' + writes('defSave'));
  offer.definition.current_version = 1;

  /* (b2) the LAST product off: the offer would reach ALL products */
  asks.length = 0; calls.length = 0;
  sb.UI.prodPicked = new Set(['p1', 'p2']); offer.versions[0].rules.applies_to = { item_ids: ['p1', 'p2'] };
  const go3 = sb.prodOfferApply('o1', false); await tick(); await tick();
  const said3 = asks.length ? asks[0][0] + ' ' + asks[0][1] : '';
  ok('removing the last product asks, worded ALL products, with terms and window', asks.length === 1 && /ALL products/.test(said3) && /Diwali 10/.test(said3) && /10% off/.test(said3) && /no end date/.test(said3), said3);
  ok('no defSave before yes', writes('defSave') === 0);
  asks[0][5](); await go3;
  ok('Cancel keeps the last product (nothing written)', writes('defSave') === 0);
  sb.UI.prodPicked = new Set(['p1', 'p2']);
  const go4 = sb.prodOfferApply('o1', false); await tick(); await tick();
  asks[1][3](); await go4;
  ok('after yes: one defSave with the product list gone', writes('defSave') === 1 && !(calls.find((c) => c.name === 'defSave').o.body.rules.applies_to || {}).item_ids);

  /* (c) a danger confirmAsk focuses Cancel */
  let fcs = 0; const cx = { modal() {}, tx: (x) => x, esc: (x) => String(x), UI: {}, closeModal() {}, document: { getElementById: () => ({}), querySelector: () => ({ focus() { fcs++; } }) } };
  vm.createContext(cx); vm.runInContext(liftFns('public/app.html', ['confirmAsk']), cx);
  cx.confirmAsk('t', 'b', 'ok', () => {}, true); cx.confirmAsk('t', 'b', 'ok', () => {}, false);
  ok('a danger confirm focuses Cancel; a plain one does not', fcs === 1, 'focus ' + fcs);

  /* (d) the wizard's last step */
  const w = fs.readFileSync('public/app/cap-workforce.js', 'utf8');
  ok("the wizard's last step says Create or See result through tx", /tx\(rdy \? 'Create' : 'See result'\)/.test(w));
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
