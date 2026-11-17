'use strict';
// @type: unit
/**
 * rate-sources.test.cjs — F5 W1b: a rate from the CATEGORY or the SHOP DEFAULT, and the hsn slot (2026-10-24; walk R85, critic 12).
 *
 * The page scripts load the way a page loads them (classic scripts in one global scope — vm.runInThisContext, never require), over a DOM stub, so
 * the cases a screen cannot prove on its own are proved here:
 *   · the item form's category chips (cap-catalogue.js ctCategoryChips, MOVED from app.html) and their read at save through core.js's one writer;
 *   · the "Code / HSN" field: 4 / 6 / 8 digits → `hsn` under a pack with HSN, a shop code stays `code`, other digit runs are refused IN WORDS;
 *   · the catalogue default in Catalogue setup (cap-catsetup.js): the picker is a draft, Save is greyed for an editor WITH the sentence, enabled for an
 *     owner only once something changed, and the write goes through CBAction with a CONFIRM naming the rate — nothing is PUT before "Set rate";
 *   · the chip's three source words come from the engine's resolve() (product · category · catalogue).
 *
 * Run: node e2e/rate-sources.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0,
  fail = 0;
/* a case may be async (the Save under CBAction): t() awaits it, and the async section below runs its cases one after another */
const t = async (name, fn) => {
  try {
    await fn();
    console.log('  ✓ ' + name);
    pass++;
  } catch (e) {
    console.log('  ✗ ' + name + '\n      ' + e.message);
    fail++;
  }
};

/* ── a page's globals: window, a DOM that answers nothing, the session of an India shop ── */
const PUB = path.join(__dirname, '..', 'public');
const noop = () => {};
const fakeEl = () => ({
  style: {},
  classList: { add: noop, remove: noop, toggle: () => true, contains: () => false },
  appendChild: noop,
  setAttribute: noop,
  getAttribute: () => null,
  removeAttribute: noop,
  remove: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  innerHTML: '',
  textContent: ''
});
const DOM = { byId: {}, bySel: {} }; /* what getElementById / querySelector answer, set per test */
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.document = {
  getElementById: (id) => DOM.byId[id] || null,
  querySelector: (sel) => DOM.bySel[sel] || null,
  querySelectorAll: () => [],
  createElement: fakeEl,
  body: fakeEl(),
  head: fakeEl(),
  documentElement: fakeEl(),
  addEventListener: noop,
  readyState: 'complete'
};
globalThis.location = { href: 'http://localhost/', hostname: 'localhost', search: '', hash: '', pathname: '/', origin: 'http://localhost' };
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.history = { pushState: noop, replaceState: noop };
globalThis.UI = {};
globalThis.SESSION = { country: 'IN' };
globalThis.EP = {};
require(path.join(PUB, 'engine', 'tax.js'));
/* the modules under test, named by path (the knowledge graph's tested-by edge reads these strings): core.js's writers and loaders, the shell's CBAction, the
   helpers' packHasHsn, the one slab UI, the categories' writers, the catalogue primitives and app, the setup */
for (const f of ['app/core.js', 'app/accounts-shell.js', 'app/helpers.js', 'app/tax-slab-ui.js', 'app/cap-categories.js', 'app/cap-catalogue.js', 'app/cap-catsetup.js'])
  require('vm').runInThisContext(fs.readFileSync(path.join(PUB, f), 'utf8'), { filename: f });
Object.assign(EP, CB_SHOP_EP, CB_DEFS_EP, CB_CATALOGUE_EP);
const S = globalThis.CBTaxSlab;

const SLABS = [
  { definition_id: 's5', kind: 'tax', name: 'GST 5%', status: 'live', rules: { rate: 5 } },
  { definition_id: 's18', kind: 'tax', name: 'GST 18%', status: 'live', rules: { rate: 18 } }
];
const CATS = [{ definition_id: 'c1', name: 'Meals', rules: { default_slab: 's5' } }];

/* every case runs after the one before it (they share the page's globals): one async run, in file order */
(async () => {
console.log('\nrate-sources · the item chip\'s three source words are the engine\'s resolve()');
await t('on this item · from category Meals · from shop default — and none', () => {
  const words = (item_data, face) => globalThis.cbSlabSourceWords(S.resolve({ item_data, face: face || {}, slabs: SLABS, categories: CATS }));
  assert.strictEqual(words({ tax_slab: 's18' }), 'on this item');
  assert.strictEqual(words({ categories: ['c1'] }), 'from category Meals');
  assert.strictEqual(words({}, { tax: { default_slab: 's18' } }), 'from shop default');
  assert.strictEqual(words({}), '', 'nobody answered: no source words (the chip is amber)');
});

console.log('\nrate-sources · the item form\'s category chips (ctCategoryChips, MOVED from app.html) and their read at save');
const LIVE = [
  { id: 'c1', name: 'Meals' },
  { id: 'c2', name: 'Drinks' }
];
await t('every live category is a chip, ✓ on the ones the item sits in; the shelf not read yet → nothing (the host fills the block later)', () => {
  const h = globalThis.ctCategoryChips({ categories: ['c1'] }, LIVE, {});
  assert.ok(/data-testid="cat-catg-c1"[^>]*onclick="ctToggleCatg\(this\)">✓ Meals</.test(h), 'Meals ticked');
  assert.ok(/class="ctcatg" data-cid="c2"[^>]*>Drinks</.test(h), 'Drinks not ticked');
  assert.ok(h.indexOf('id="ct_categories"') >= 0 && h.indexOf('cat-category-new') < 0, 'no "＋ New" unless the host has a door');
  assert.strictEqual(globalThis.ctCategoryChips({}, null, {}), '');
});
await t('the workshop\'s "＋ New" door rides only when given; a retired-but-cited category is kept amber, never stripped unasked', () => {
  const h = globalThis.ctCategoryChips({ categories: ['c1', 'gone1'], category_names: ['Meals', 'Old shelf'] }, LIVE, { newAction: 'ctNewCategory()' });
  assert.ok(/data-testid="cat-category-new" onclick="ctNewCategory\(\)"/.test(h));
  assert.ok(/class="ctcatg on gone" data-cid="gone1"[^>]*>✓ Old shelf</.test(h));
  assert.ok(/1 no longer live/.test(h));
});
await t('ctCategoriesFromForm reads the ticked chips off the DOM into core.js catgSetOn (ids + travelling names; the legacy single key gone); no chips on screen → untouched', () => {
  globalThis._CATG = LIVE;
  const chip = (id) => ({ getAttribute: () => id });
  DOM.byId.ct_categories = { querySelectorAll: () => [chip('c2')] };
  const next = globalThis.ctCategoriesFromForm({ name: 'Tea', category: 'c1', category_name: 'Meals' });
  assert.deepStrictEqual(next, { name: 'Tea', categories: ['c2'], category_names: ['Drinks'] });
  DOM.byId.ct_categories = { querySelectorAll: () => [] };
  assert.deepStrictEqual(globalThis.ctCategoriesFromForm({ name: 'Tea', categories: ['c1'] }), { name: 'Tea' }, 'every chip unticked → the keys go (the Save nulls them)');
  /* ⚠️ unchanged chips (any order) write NOTHING — no category_names stamped into a patch whose only change is another field (walk-catalogue C5) */
  DOM.byId.ct_categories = { querySelectorAll: () => [chip('c2'), chip('c1')] };
  const untouched = { name: 'Tea', desc: 'walked', categories: ['c1', 'c2'] };
  assert.strictEqual(globalThis.ctCategoriesFromForm(untouched), untouched, 'the same object back');
  assert.deepStrictEqual(untouched, { name: 'Tea', desc: 'walked', categories: ['c1', 'c2'] }, 'no category key added or changed');
  assert.deepStrictEqual(globalThis.prodDiff({ categories: ['c1', 'c2'] }, globalThis.ctCategoriesFromForm({ categories: ['c1', 'c2'], desc: 'walked' })), { desc: 'walked' }, 'the patch carries ONLY the changed key');
  delete DOM.byId.ct_categories;
  assert.deepStrictEqual(globalThis.ctCategoriesFromForm({ name: 'Tea', categories: ['c1'] }), { name: 'Tea', categories: ['c1'] }, 'absent is not cleared');
});

console.log('\nrate-sources · the "Code / HSN" field (critic 12): an HSN lands in hsn, a shop code stays code, other digit runs are refused in words');
await t('under India\'s pack: 996331 → hsn; 1905 and 19059010 → hsn; D01 → code; 12345 → refused "An HSN has 4, 6 or 8 digits."; empty → nothing', () => {
  assert.deepStrictEqual(globalThis.ctCodeSlots('996331'), { hsn: '996331' });
  assert.deepStrictEqual(globalThis.ctCodeSlots(' 1905 '), { hsn: '1905' });
  assert.deepStrictEqual(globalThis.ctCodeSlots('19059010'), { hsn: '19059010' });
  assert.deepStrictEqual(globalThis.ctCodeSlots('D01'), { code: 'D01' });
  assert.deepStrictEqual(globalThis.ctCodeSlots('12345'), { why: 'An HSN has 4, 6 or 8 digits.' });
  assert.deepStrictEqual(globalThis.ctCodeSlots(''), {});
});
await t('under a pack without HSN (AU) six digits are a shop code', () => {
  SESSION.country = 'AU';
  assert.deepStrictEqual(globalThis.ctCodeSlots('996331'), { code: '996331' });
  SESSION.country = 'IN';
});
await t('ctCodeApply: the slot the field SHOWED is replaced; an HSN typed over a shop code lands in hsn and the code goes; a hidden hsn survives a new code', () => {
  assert.deepStrictEqual(globalThis.ctCodeApply({ name: 'Veg Meals', code: '996331' }, { code: '996331' }, { hsn: '996331' }), { name: 'Veg Meals', hsn: '996331' });
  assert.deepStrictEqual(globalThis.ctCodeApply({ name: 'Tea', hsn: '0902' }, { hsn: '0902' }, { code: 'T1' }), { name: 'Tea', code: 'T1' }, 'the field showed the hsn, a code replaces it');
  assert.deepStrictEqual(globalThis.ctCodeApply({ name: 'Tea', code: 'T1', hsn: '0902' }, { code: 'T1', hsn: '0902' }, { code: 'T2' }), { name: 'Tea', hsn: '0902', code: 'T2' }, 'the hidden hsn is not erased');
  assert.deepStrictEqual(globalThis.ctCodeApply({ name: 'Tea', code: 'T1' }, { code: 'T1' }, {}), { name: 'Tea' }, 'emptied → the shown slot goes');
});

console.log('\nrate-sources · the shop default in Catalogue setup: a draft, Save + confirm, enabled by role (DECISIONS 2026-10-24 14:20)');
const CALLS = [];
globalThis.api = (name, o) => {
  CALLS.push({ name, body: o && o.body });
  if (name === 'catFacePut') return Promise.resolve({ ok: true });
  return new Promise(() => {}); /* anything else (the products, the live slabs) never answers here: Save must not need it */
};
globalThis.toast = (words) => CALLS.push({ name: 'toast', words });
globalThis.CATSET_DEFS.tax = SLABS.map((row) => ({ id: row.definition_id, name: row.name, status: row.status, rules: row.rules }));
globalThis.catsetFaceSet({ tax: { default_slab: 's5', treatment: 'old words' }, units: ['kg'] });
const ASK = { last: null, answer: true };
globalThis.confirmAsk = (title, body, yes, onOk, danger, onCancel) => {
  ASK.last = { title, body, yes };
  if (ASK.answer) onOk();
  else onCancel();
};
const button = () => Object.assign(fakeEl(), { isConnected: true, disabled: false });
await t('an editor (is_owner false, no may_set_rate): the picker and Save are SHOWN, greyed, with the api\'s sentence', () => {
  globalThis.CATSET_MAY = { can_see_costs: true, is_owner: false };
  const h = globalThis.catsetTaxHTML();
  assert.ok(/<select[^>]*data-testid="catset-tax-default"[^>]*disabled title="Ask the owner or a manager to set the tax rate\."/.test(h), 'the picker greyed, the reason in its title');
  assert.ok(/data-testid="catset-tax-save"[^>]*disabled/.test(h), 'Save greyed');
  assert.ok(/data-testid="catset-tax-why"[^>]*>Ask the owner or a manager to set the tax rate\.</.test(h), 'the sentence beside it');
});
await t('a manager the server vouches for (may_set_rate true, api #429): enabled; Save greyed until something changes, then enabled on a pick', () => {
  globalThis.CATSET_MAY = { can_see_costs: true, is_owner: false, may_set_rate: true };
  const h = globalThis.catsetTaxHTML();
  assert.ok(/<select[^>]*data-testid="catset-tax-default" onchange="catsetTaxPick\(this\.value\)">/.test(h), 'the picker enabled and a DRAFT (no write on change)');
  assert.ok(/data-testid="catset-tax-save"[^>]*disabled/.test(h), 'nothing changed yet → Save greyed');
  assert.ok(h.indexOf('catset-tax-why') < 0);
  const save = button();
  DOM.bySel['[data-testid="catset-tax-save"]'] = save;
  globalThis.catsetTaxPick('s18');
  assert.strictEqual(save.disabled, false, 'a pick enables Save');
  assert.strictEqual(CALLS.filter((c) => c.name === 'catFacePut').length, 0, 'and writes NOTHING');
  globalThis.catsetTaxPick('s5');
  assert.strictEqual(save.disabled, true, 'picked back to the stored one → nothing to save');
});
await t('⭐ Save → the CONFIRM names the rate ("Every item with no rate of its own: GST 18%?") BEFORE the one PUT; the face keeps its other keys', async () => {
  globalThis.catsetTaxPick('s18');
  ASK.answer = true;
  const res = await globalThis.catsetTaxSave(button());
  assert.ok(res && res.ok, 'the action ran: ' + JSON.stringify(res && (res.error ? String(res.error.message) : res)));
  assert.strictEqual(ASK.last.title, 'Every item with no rate of its own: GST 18%?');
  assert.strictEqual(ASK.last.yes, 'Set rate');
  const puts = CALLS.filter((c) => c.name === 'catFacePut');
  assert.strictEqual(puts.length, 1, 'ONE PUT');
  assert.deepStrictEqual(puts[0].body.face, { tax: { default_slab: 's18', treatment: 'old words' }, units: ['kg'] }, 'merged onto face.tax, the rest of the face kept');
  assert.strictEqual(globalThis.CATSET_FACE.tax.default_slab, 's18', 'the local face follows');
});
await t('Cancel on the confirm → nothing is written; clearing the default removes the key (inherit nothing, never nil-rated)', async () => {
  CALLS.length = 0;
  ASK.answer = false;
  globalThis.catsetTaxPick('');
  const res = await globalThis.catsetTaxSave(button());
  assert.ok(res && res.cancelled, 'cancelled');
  assert.strictEqual(CALLS.filter((c) => c.name === 'catFacePut').length, 0, 'nothing sent');
  assert.strictEqual(ASK.last.title, 'Every item with no rate of its own: no default?');
  ASK.answer = true;
  await globalThis.catsetTaxSave(button());
  const put = CALLS.filter((c) => c.name === 'catFacePut')[0];
  assert.deepStrictEqual(put.body.face.tax, { treatment: 'old words' }, 'default_slab removed, the old treatment kept');
});
await t('who-may could not be read (can-see-costs fails) → Save stays greyed, nothing is guessed, the reason is logged in words', async () => {
  const logged = [];
  globalThis.cblog = (level, words) => logged.push(level + ': ' + words);
  globalThis.CATSET_MAY = null;
  globalThis.api = (name) => (name === 'canSeeCosts' ? Promise.reject(new Error('no answer')) : new Promise(() => {}));
  await globalThis.catsetMayLoad();
  assert.deepStrictEqual(globalThis.CATSET_MAY, {}, 'unknown, not an owner');
  assert.ok(/data-testid="catset-tax-save"[^>]*disabled/.test(globalThis.catsetTaxHTML()), 'Save greyed');
  assert.ok(logged.some((l) => /^warn: catsetup: can-see-costs could not be read/.test(l)), 'said in the log, in words: ' + logged.join(' | '));
  globalThis.api = (name, o) => {
    CALLS.push({ name, body: o && o.body });
    return name === 'catFacePut' ? Promise.resolve({ ok: true }) : new Promise(() => {});
  };
});
await t('cream and dark themes at 1366 and 390 (rule 13): the card paints with theme tokens only — AA contrast comes from the tokens — no fixed colour, no fixed width', () => {
  globalThis.CATSET_MAY = { can_see_costs: true, is_owner: true };
  const h = globalThis.catsetTaxHTML();
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(h), 'no hex colour: ' + h.slice(0, 80));
  assert.ok(!/rgb\(/.test(h), 'no rgb colour');
  assert.ok(!/width\s*:\s*\d+px/.test(h), 'no fixed width (390px fits)');
  assert.ok(/var\(--fs-1\)/.test(h) && /var\(--grey\)/.test(h) && /var\(--ok-2\)/.test(h), 'the tokens the themes define');
});
await t('an editor who reaches Save anyway (the belt to the brace): the sentence, nothing sent', async () => {
  CALLS.length = 0;
  globalThis.CATSET_MAY = { can_see_costs: true, is_owner: false };
  globalThis.catsetTaxPick('s18');
  const res = await globalThis.catsetTaxSave(button());
  assert.strictEqual(res, undefined);
  assert.strictEqual(CALLS.filter((c) => c.name === 'catFacePut').length, 0);
  assert.ok(CALLS.some((c) => c.name === 'toast' && /Ask the owner or a manager/.test(c.words)));
});

console.log('\nrate-sources · the rate has ONE door on the item form (CAT-212): a declared gst_rate column is not a free box');
await t('the declared gst_rate / tax_slab / tax_slab_name / cess_rate columns are not editable fields; other columns still are; the chip still shows', () => {
  UI._catFields = ['gst_rate', 'tax_slab', 'tax_slab_name', 'cess_rate', 'fineness'].map((k) => ({ field_key: k, field_name: k, field_type: 'text' }));
  assert.deepStrictEqual(globalThis.ctDeclaredList().map((f) => f.field_key), ['fineness']);
  const rows = globalThis.ctDeclaredRows({ gst_rate: 5, fineness: 999 });
  assert.ok(rows.indexOf('data-key="fineness"') >= 0 && !/data-key="(gst_rate|tax_slab|tax_slab_name|cess_rate)"/.test(rows), 'no input for a rate column');
  assert.ok(globalThis.ctDeclaredViewRows({ gst_rate: 5 }, (a, b) => a + b) === '', 'not repeated as a view row');
  const chip = globalThis.cbSlabChipHTML(S.resolve({ item_data: { gst_rate: 5, tax_slab: 's5' }, face: {}, slabs: SLABS, categories: CATS }), {});
  assert.ok(/GST 5%/.test(chip), 'the chip still shows the rate: ' + chip.slice(0, 120));
});
await t('a Save that leaves the rate alone never sends it: the form starts from the stored record and the patch holds only the changed key', () => {
  const orig = { name: 'Veg Meals', gst_rate: 5, tax_slab: 's5', fineness: '999' };
  DOM.byId.ct_declared = { querySelectorAll: () => [{ getAttribute: (a) => ({ 'data-key': 'fineness', 'data-type': 'text' })[a], value: '916' }] };
  const next = Object.assign({}, orig);
  globalThis.readDeclared ? globalThis.readDeclared(next) : Object.assign(next, { fineness: '916' });
  assert.deepStrictEqual(globalThis.prodDiff(orig, next), { fineness: '916' }, 'no gst_rate in the patch');
  delete DOM.byId.ct_declared;
});

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
