/**
 * e2e/ux-109-categories-attach-confirm.red.cjs — UX-109 (proof 2026-11-14): attaching an OFFER to a WHOLE CATEGORY asks first, stating the reach with the count.
 * @type regression
 * REQUIREMENT (UX-109, Athi 22 Oct, widened): "every control that reaches a whole category / catalogue / all customers shows its reach in words with the count
 *           ('all 214 items in Breakfast') and asks in a confirm popup before saving; never a quiet default"; known place: cap-categories.js attach to a whole category.
 * OWNS      the check, on the REAL cbcatOfferToggle (public/app/cap-categories.js, the tick that writes applies_to.category_ids on the offer), that the first press on
 *           an un-attached offer (a) opens a confirm (confirmAsk) whose words name the category (Tiffin) and its product count (12), and (b) writes NOTHING (no defSave)
 *           until that confirm is accepted; (c) after yes, exactly one defSave carries category_ids [c1].
 *           Also: (d) Cancel (yes never called) writes nothing; (e) taking the offer OFF does not ask (narrows reach); (f) a partial tally claims no number.
 * STATUS    was RED on 2026-11-14 (cbcatOfferToggle called defSave straight away); GREEN with the confirm in cbcatOfferToggle, enrolled in ci.yml.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network.
 * FLOW      tick pressed → cbcatOfferToggle → (requirement) confirmAsk → yes → defSave
 */
'use strict';
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (info ? '\n          ' + String(info).slice(0, 400) : '')); } };

const calls = [], asks = [];
const offer = { definition: { current_version: 2, sub_kind: 'percent_off' }, versions: [{ version: 2, rules: { kind: 'percent_off', value: 10, applies_to: {} } }] };
const sb = {
  api: async (name, o) => { calls.push({ name, o }); return name === 'defGet' ? offer : {}; },
  toast() {}, tx: (s) => s, inr: (n) => String(n), esc: (s) => String(s), cbcatPaintDetail() {}, _DEFS: {}, UI: {},
  CBCAT_UI: { list: [{ id: 'c1', name: 'Tiffin' }], counts: { by: { c1: 12 } } },
  confirmAsk: function () { asks.push(Array.prototype.slice.call(arguments)); }
};
vm.createContext(sb);
vm.runInContext(liftFns('public/app/cap-categories.js', ['cbcatOfferCats', 'cbcatCount', 'cbcatOfferToggle', 'cbcatOfferReach', 'cbcatOfferRulesOf', 'cbcatRulesWithCategory', '_cbcatOfferSave']), sb);

(async () => {
  const btn = { className: 'chip', disabled: false };
  await sb.cbcatOfferToggle('c1', 'offer-1', btn);
  const saves = () => calls.filter((c) => c.name === 'defSave');
  ok('the first press opens a confirm (confirmAsk) — a whole category is a deliberate act', asks.length === 1, 'confirmAsk calls: ' + asks.length + ', defSave calls: ' + saves().length);
  const said = asks.length ? String(asks[0][0]) + ' ' + String(asks[0][1]) : '';
  ok('the confirm names the category (Tiffin) and its count (12 products)', /Tiffin/.test(said) && /\b12\b/.test(said), said.slice(0, 200));
  ok('nothing is written before the person says yes (no defSave yet)', saves().length === 0, 'defSave already called ' + saves().length + 'x');
  const yes = asks.length && asks[0].find((a) => typeof a === 'function');
  if (yes) { await yes(); }
  ok('after yes: exactly one defSave, carrying applies_to.category_ids [c1]', saves().length === 1 && JSON.stringify(((saves()[0] || {}).o || {}).body && saves()[0].o.body.rules.applies_to.category_ids) === '["c1"]', JSON.stringify(saves().map((c) => c.o.body.rules.applies_to)));
  /* (d) cancel: a fresh press opens the confirm; never calling yes writes nothing */
  calls.length = 0; asks.length = 0;
  await sb.cbcatOfferToggle('c1', 'offer-1', { className: 'chip', disabled: false });
  ok('Cancel: the confirm opened and was not accepted, so nothing was attached (no defGet, no defSave)', asks.length === 1 && calls.length === 0, JSON.stringify(calls.map((c) => c.name)));
  /* (e) off does not ask */
  calls.length = 0; asks.length = 0;
  offer.versions[0].rules.applies_to = { category_ids: ['c1'] };
  await sb.cbcatOfferToggle('c1', 'offer-1', { className: 'ctcatg on', disabled: false });
  ok('taking it OFF a category does not ask, and saves once without c1', asks.length === 0 && saves().length === 1 && !((saves()[0].o.body.rules.applies_to || {}).category_ids), JSON.stringify(saves().map((c) => c.o.body.rules)));
  /* (f) a partial tally claims no number */
  asks.length = 0; sb.CBCAT_UI.counts.partial = true;
  await sb.cbcatOfferToggle('c1', 'offer-1', { className: 'chip', disabled: false });
  ok('a partial tally is not quoted as a count (still asks)', asks.length === 1 && !/\b12\b/.test(String(asks[0][1])), String(asks[0] && asks[0][1]));
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
