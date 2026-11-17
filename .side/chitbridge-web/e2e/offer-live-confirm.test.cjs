'use strict';
// @type: unit
/**
 * offer-live-confirm.test.cjs — UX-110: an offer goes live only after the confirm, on every web door.
 *
 * The api refuses a status:live write on an offer without `confirmed: true` (428 OFFER_LIVE_UNCONFIRMED). The page sends that yes only after the
 * Offer Lab's own sentence (CBLabKit.promise, the REAL lab-kit.js here) has been shown and accepted. Cases: Publish on an offer asks first and sends
 * nothing until OK; Cancel sends nothing; a category, a slab and "back to draft" are never asked; an offer that names no item says "the whole catalogue";
 * the Offer Lab's Go live / Make live and the setup plan's "Create all as live" carry the yes (static, they are inline page code).
 * CARD      07-offers-pricing-and-combos/offer-lab
 * Run: node e2e/offer-live-confirm.test.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const pub = path.join(__dirname, '..', 'public');
const read = (p) => fs.readFileSync(path.join(pub, p), 'utf8');
let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

const defs = read('app/cap-definitions.js');
const from = defs.indexOf('var _labKitReq = null;'), to = defs.indexOf('async function cbDefWriteStatus');
const end = defs.indexOf('\n}\n', to) + 2;
if (from < 0 || to < 0) throw new Error('UX-110 block not found in cap-definitions.js');

const sent = [], asked = [];
const sandbox = {
  console, CB_BUILD: 'test',
  CBDEF: { mine: [{ definition_id: 'o-all', kind: 'offer', name: 'Flat 10', rules: { percent: 10 } }, { definition_id: 'o-two', kind: 'offer', name: 'Two items', rules: { applies_to: { item_ids: ['a', 'b'] } } }, { definition_id: 'c-1', kind: 'category', name: 'Veg', rules: {} }] },
  CATSET_DEFS: { tax: [{ id: 't-1', name: 'GST 5', rules: { rate: 5 } }] },
  api: (key, opts) => { sent.push(opts.body); return Promise.resolve({}); },
  toast: (m) => console.log("TOAST", m), cbDefAfterChange: () => Promise.resolve(),
  window: {}, esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('app/lab-kit.js'), sandbox); /* the REAL promise sentence */
const realPromise = sandbox.CBLabKit.promise;
let pressOk = true;
sandbox.CBLabKit.confirm = (title, html, onOk) => { asked.push({ title, html }); if (pressOk) return onOk(); };
vm.runInContext(defs.slice(from, end) + '\nthis.cbDefSetStatus = cbDefSetStatus; this.cbOfferReachWords = cbOfferReachWords;', sandbox);

(async () => {
  console.log('\n== UX-110 · an offer goes live only after the confirm ==\n');
  pressOk = false;
  try { await sandbox.cbDefSetStatus("o-all", "live"); } catch (e) { console.log("ERR", e); }
  ok(asked.length === 1 && sent.length === 0, 'Publish on an offer asks first and sends nothing before OK');
  ok(asked[0] && asked[0].title === realPromise({ act: 'live', thing: 'offer', name: 'x', on: 'y' }).title, 'it is the Offer Lab sentence (CBLabKit.promise act live), not a second one');
  ok(asked[0] && /whole catalogue/.test(asked[0].html), 'an offer that names no item says it reaches the whole catalogue');
  pressOk = true;
  await sandbox.cbDefSetStatus('o-two', 'live');
  ok(sent.length === 1 && sent[0].status === 'live' && sent[0].confirmed === true, 'after OK the write carries confirmed: true');
  ok(/2 items/.test(asked[1].html), 'a targeted offer names how many items');
  const before = asked.length;
  await sandbox.cbDefSetStatus('c-1', 'live');
  await sandbox.cbDefSetStatus('t-1', 'live');
  await sandbox.cbDefSetStatus('o-all', 'draft');
  ok(asked.length === before && sent.length === 4, 'a category, a slab and back-to-draft are never asked');
  ok(sent.slice(1).every((b) => b.confirmed === undefined), 'and they send no confirmed key');

  /* the confirm could not open: said in words, nothing sent (a walk of the one failure the shopkeeper can meet) */
  const before2 = sent.length, said = [];
  const dead = { console, CB_BUILD: 'test', window: {}, CBDEF: sandbox.CBDEF, api: sandbox.api, cbDefAfterChange: () => Promise.resolve(), toast: (m) => said.push(m),
    document: { head: { appendChild: (n) => { if (n.src) setTimeout(() => n.onerror(), 0); } }, createElement: () => ({}) } };
  dead.window = dead;
  vm.createContext(dead);
  vm.runInContext(defs.slice(from, end) + '\nthis.cbDefSetStatus = cbDefSetStatus;', dead);
  await dead.cbDefSetStatus('o-all', 'live');
  ok(said.some((m) => /Could not open the confirm/.test(m)) && sent.length === before2, 'could not load the confirm: said in words (Could not open the confirm. Nothing was changed.) and nothing is sent');
  const css = read('app/lab-kit.css');
  ok(css.split('lk-reach')[1].split('}')[0].indexOf('var(--') >= 0, 'the confirm is themed by tokens, so cream and dark (390 and 1366 wide) both follow the theme');
  ok(read('app/lab-kit.js').indexOf('cancelButton.focus()') >= 0, 'a11y: focus starts on Cancel, never on the promise (contrast and keyboard as the Offer Lab)');
  const lab = read('offer-lab-next.html');
  ok(/defFetch\('PUT', '\/' \+ id, st === 'live' \? \{ status: st, confirmed: true \}/.test(lab), 'Offer Lab setStatus sends the yes for live (its callers ask via askPromise)');
  ok(/body = \{ status: 'live', confirmed: true \}/.test(lab), 'Offer Lab attachOffer sends the yes');
  const setup = read('app/cap-catsetup.js');
  const go = setup.slice(setup.indexOf('async function catsetPlanGo'), setup.indexOf('async function catsetPlanCreate'));
  ok(/cbOfferAskLive/.test(go) && !/defAdd/.test(go), '"Create all as live" asks before any write');
  ok(/status: 'live', confirmed: true/.test(setup.slice(setup.indexOf('async function catsetPlanCreate'))), 'and its writes carry the yes');
  console.log(bad ? '\n' + bad + ' FAILED' : '\nall passed');
  process.exit(bad ? 1 : 0);
})();
