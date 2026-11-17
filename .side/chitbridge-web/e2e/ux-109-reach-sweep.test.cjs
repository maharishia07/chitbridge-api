/**
 * e2e/ux-109-reach-sweep.test.cjs — UX-109 (proof 2026-11-14, the part of the sweep that holds): broad reach is said and asked first.
 * @type regression
 * OWNS      the proof, on the REAL code lifted into vm sandboxes, of three of the UX-109 reach places (Offer Lab is covered by e2e/walk-offer-lab.cjs):
 *           (1) Marketing group send (public/app/cap-crm-groups.js crmSendGo): a send never starts before the dry count ("Check who may be sent first."), never for
 *               0 people, and then asks a CONFIRM stating the count and the words: title "Send this WhatsApp offer to 3 customers?", body = the message, yes "Send to 3";
 *           (2) select-all in the catalogue (public/app.html prodPickAll): ALL = ALL VISIBLE, never the whole catalogue — with 2 of 5 products shown, the first press
 *               ticks exactly those 2 (a hidden, already-ticked third is untouched), the second press unticks only those 2;
 *           (3) the no-target offer (public/app.html offersForProduct): an offer that names no product or category reaches EVERY line and is LISTED on a product with its
 *               provenance "whole catalogue" (never silent); a targeted offer for another category is not listed.
 *           NOT proven here, reopened on the item: cap-categories whole-category attach has no confirm (e2e/ux-109-categories-attach-confirm.test.cjs proves it),
 *           and the save of a no-target offer from the offer form (no confirm test exists for it).
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 * FLOW      press → real handler → CBAction.run / confirmAsk options captured → assertions
 *   node e2e/ux-109-reach-sweep.test.cjs
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 400) : '')); } };

/* (1) Marketing group send */
const runs = [], apiCalls = [];
const g = {
  tx: (s) => s, esc: (s) => String(s), txf: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => v[k]),
  crmPlural: (n, one, many) => n + ' ' + (n === 1 ? one : many),
  GROUPS: { channel: 'whatsapp', purpose: 'offer' },
  document: { getElementById: (id) => (id === 'crm_send_text' ? { value: ' 10% off tiffin this week ' } : id === 'crm_send_out' ? out : null) },
  api: async (name) => { apiCalls.push(name); return {}; },
  CBAction: { run: (btn, fn, opts) => { runs.push(opts); return opts; } }
};
const out = { innerHTML: '' };
vm.createContext(g);
vm.runInContext('var SEND = { row: { key: "regulars" }, dry: null, done: null };\n' + liftFns('public/app/cap-crm-groups-send.js', ['crmSendBody', 'crmSendGo']), g);
g.crmSendGo({});
ok('send BEFORE the dry count: nothing runs, the person is told "Check who may be sent first."', runs.length === 0 && /Check who may be sent first/.test(out.innerHTML), out.innerHTML + ' runs=' + runs.length);
vm.runInContext('SEND.dry = { may: 0 };', g);
g.crmSendGo({});
ok('send when nobody may be sent (0): nothing runs', runs.length === 0);
vm.runInContext('SEND.dry = { may: 3, refused_n: 1 };', g);
g.crmSendGo({});
const c = runs[0] && runs[0].confirm;
ok('send to 3 who may: the one run carries a CONFIRM (the money promise: any send, any size, asks first)', runs.length === 1 && !!c, JSON.stringify(runs[0] && Object.keys(runs[0])));
ok('…its title states the count: "Send this WhatsApp offer to 3 customers?"; the yes button "Send to 3"', !!c && c.title === 'Send this WhatsApp offer to 3 customers?' && c.yes === 'Send to 3', c && c.title + ' | ' + c.yes);
ok('…its body repeats the words that will go out ("10% off tiffin this week", trimmed) and the channel/consent line', !!c && /“10% off tiffin this week”/.test(c.body) && /only to those who agreed/.test(c.body), c && c.body);

/* (2) select-all = all visible */
const picks = { painted: 0 };
const p = { UI: { prods: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }], prodPicked: new Set(['d']) }, prodId: (x) => x.id,
  prodVisible: () => [{ id: 'a' }, { id: 'b' }], paintProdList() { picks.painted++; }, prodPickBarPaint() {}, Set };
vm.createContext(p);
vm.runInContext(liftFns('public/app.html', ['prodPickAll']), p);
p.prodPickAll();
ok('select-all with 2 of 5 shown ticks exactly those 2: picked = {a, b} plus the hidden d it already had (never c or e)', [...p.UI.prodPicked].sort().join(',') === 'a,b,d', [...p.UI.prodPicked].sort().join(','));
p.prodPickAll();
ok('pressed again it unticks only the visible 2: picked = {d}', [...p.UI.prodPicked].sort().join(',') === 'd', [...p.UI.prodPicked].sort().join(','));

/* (3) the no-target offer is listed on a product with its provenance */
const d = { id: 'p1', categories: ['cat-tiffin'] };
const o = { UI: { _ctOffers: [
  { id: 'o-all', name: '2% above 5000', rules: { applies_to: {} } },
  { id: 'o-other', name: 'Snacks 5%', rules: { applies_to: { category_ids: ['cat-snacks'] } } },
  { id: 'o-mine', name: 'Tiffin 10%', rules: { applies_to: { category_ids: ['cat-tiffin'] } } }
] }, tx: (s) => s, catgIdsOf: (x) => x.categories || [], catgWithAncestors: (ids) => ids, cbDefsCached: () => [{ id: 'cat-tiffin', name: 'Tiffin' }], prodOfferExcluded: () => [] };
vm.createContext(o);
vm.runInContext(liftFns('public/app.html', ['offersForProduct', 'prodOfferExcluded']), o);
o.prodOfferExcluded = () => [];
const listed = o.offersForProduct(d, 'p1');
ok('an offer with no target is listed on every product, provenance "whole catalogue"; the category offer for THIS product by its category (Tiffin); the other category\'s offer is not listed', listed.length === 2 && listed.some((x) => x.id === 'o-all' && x._via === 'whole catalogue') && listed.some((x) => x.id === 'o-mine' && x._via === 'Tiffin') && !listed.some((x) => x.id === 'o-other'), JSON.stringify(listed.map((x) => [x.id, x._via])));

console.log('\n' + pass + ' ok, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
