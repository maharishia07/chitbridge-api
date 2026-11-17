'use strict';
// @type: unit
/**
 * tax-slab-ui.test.cjs — the ONE slab UI module (public/app/tax-slab-ui.js), loaded the way a page loads it (F5 W1a, 2026-10-24).
 *
 * Critic 3 on F5: *"the slab UI already exists. Move it, do not build it."* cbSlabOptionsHTML (app.html) and cbcatSlabPickHTML (cap-categories.js)
 * MOVED into one classic script that app.html, catalogue.html and the counter all load. So the cases here are the ones a screen could not catch on
 * its own: both pickers render from the one builder; the chip says the engine's words and never "GST" typed here; the ask-once menu offers only
 * slabs on TODAY'S menu (the pack's dated rate_menu — a dead 12% never appears) with the pack's suggestion first; the charges predicate is the
 * api's twin (a composition shop with a GSTIN charges nothing).
 *
 * Run: node e2e/tax-slab-ui.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0,
  fail = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  ✓ ' + name);
    pass++;
  } catch (e) {
    console.log('  ✗ ' + name + '\n      ' + e.message);
    fail++;
  }
};

/* a page's globals, as the three pages give them: window, esc (helpers.js), tx/txf (accounts-shell.js — the counter has NONE, so one run without) */
globalThis.window = globalThis.window || globalThis;
require(path.join(__dirname, '..', 'public', 'engine', 'tax.js'));
globalThis.esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/* ⚠️ a CLASSIC script, not a module: its top-level functions are the page's globals, so it runs in this context (require() would scope them away) */
require('vm').runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'tax-slab-ui.js'), 'utf8'), { filename: 'tax-slab-ui.js' });
const S = globalThis.CBTaxSlab,
  P = globalThis.CBTaxPacks;
const IN = P.packFor('IN');

const SLABS = [
  { definition_id: 's5', kind: 'tax', name: 'GST 5%', status: 'live', rules: { rate: 5 } },
  { definition_id: 's12', kind: 'tax', name: 'GST 12%', status: 'live', rules: { rate: 12 } },
  { definition_id: 's18', kind: 'tax', name: 'GST 18%', status: 'live', rules: { rate: 18 } },
  { definition_id: 'sdraft', kind: 'tax', name: 'GST 40% (draft)', status: 'draft', rules: { rate: 40 } },
  { id: 'IN-GST-0', name: 'Nil', rules: { rate: 0 }, governance: { jurisdiction: 'IN', scheme: 'GST' } }
];

console.log('\ntax-slab-ui · the module loads like a <script> and publishes its functions');
t('the eight functions are globals; nothing private leaks', () => {
  for (const f of ['cbSlabOptionsHTML', 'cbcatSlabPickHTML', 'cbTaxCharges', 'cbSlabChipHTML', 'cbSlabMenu', 'cbSlabMenuHTML', 'cbRateMay', 'cbRateButtonHTML']) assert.strictEqual(typeof globalThis[f], 'function', f);
});

console.log('\ntax-slab-ui · both pickers render from the ONE builder');
t('cbSlabOptionsHTML: governed first, own after, the chosen one selected', () => {
  const h = globalThis.cbSlabOptionsHTML(SLABS, 's12');
  assert.ok(h.indexOf('IN GST · governance') >= 0, 'the governed group label');
  assert.ok(h.indexOf('IN-GST-0') < h.indexOf('value="s5"'), 'governed before own');
  assert.ok(/<option value="s12" selected>GST 12% · 12%<\/option>/.test(h), 'the selected option');
});
t('cbcatSlabPickHTML reads the same builder (its select holds the same options)', () => {
  globalThis.cbDefsCached = () => SLABS;
  const h = globalThis.cbcatSlabPickHTML({ default_slab: 's5' });
  assert.ok(h.indexOf('data-testid="catg-slab"') >= 0, 'the category form select');
  assert.ok(h.indexOf(globalThis.cbSlabOptionsHTML(SLABS, 's5')) >= 0, 'the options are the one builder\'s output, byte for byte');
  assert.ok(/inherit the catalogue default/.test(h), 'blank means inherit');
});
t('no slabs yet → the picker says where to make one, never a lone blank option', () => {
  globalThis.cbDefsCached = () => [];
  assert.match(globalThis.cbcatSlabPickHTML({}), /No live slab yet/);
  assert.ok(globalThis.cbcatSlabPickHTML({}).indexOf('<select') < 0);
});

console.log('\ntax-slab-ui · the chip is the engine\'s words');
t('a rate: the short describe plus four words of source', () => {
  const r = S.resolve({ item_data: { tax_slab: 's5' }, face: {}, slabs: SLABS, categories: [] });
  const h = globalThis.cbSlabChipHTML(r, { country: 'IN', tid: 'chip' });
  assert.ok(/class="tag green"/.test(h), 'green');
  assert.ok(h.indexOf('GST 5%') >= 0, 'GST 5%');
  assert.ok(h.indexOf('on this item') >= 0, 'the source');
  assert.ok(h.indexOf('data-testid="chip"') >= 0);
});
t('the source words follow resolve(): category · shop default', () => {
  const cats = [{ definition_id: 'c1', name: 'Meals', rules: { default_slab: 's5' } }];
  const byCat = S.resolve({ item_data: { categories: ['c1'] }, face: {}, slabs: SLABS, categories: cats });
  assert.strictEqual(globalThis.cbSlabSourceWords(byCat), 'from category Meals');
  const byFace = S.resolve({ item_data: {}, face: { tax: { default_slab: 's18' } }, slabs: SLABS, categories: [] });
  assert.strictEqual(globalThis.cbSlabSourceWords(byFace), 'from shop default');
});
t('⚠️ none: an amber chip, the engine\'s "No GST rate yet", and the HOST\'s one action beside it', () => {
  const r = S.resolve({ item_data: {}, face: {}, slabs: SLABS, categories: [] });
  const h = globalThis.cbSlabChipHTML(r, { country: 'IN', action: '<button>Set rate</button>' });
  assert.ok(/class="tag amber"/.test(h));
  assert.ok(h.indexOf('No GST rate yet') >= 0, 'the engine phrases it');
  assert.ok(h.indexOf('<button>Set rate</button>') >= 0, 'the action rides beside it');
});
t('an AE shop reads VAT — the scheme word is the pack\'s, never typed here', () => {
  const r = S.resolve({ item_data: {}, face: {}, slabs: [], categories: [] });
  assert.ok(globalThis.cbSlabChipHTML(r, { country: 'AE' }).indexOf('No VAT rate yet') >= 0);
});

console.log('\ntax-slab-ui · the ask-once menu');
t('⭐ only slabs on TODAY\'S menu: 12% (dead since 22 Sep 2025) and a draft are never offered; sorted by rate', () => {
  const m = globalThis.cbSlabMenu(SLABS, IN, '');
  assert.deepStrictEqual(
    m.rows.map((r) => r.rate),
    [0, 5, 18]
  );
  assert.strictEqual(m.suggestion, null, 'no code, no suggestion');
  assert.strictEqual(m.scheme, 'GST');
  assert.ok(m.cite, 'the menu row\'s citation travels');
});
t('⭐ 996331 (a restaurant) suggests 5% and the 5% slab moves first, marked', () => {
  const m = globalThis.cbSlabMenu(SLABS, IN, '996331');
  assert.ok(m.suggestion, 'a suggestion');
  assert.strictEqual(m.suggestion.slab_id, 's5');
  assert.strictEqual(m.suggestion.words, '996331 · restaurant · 5%');
  assert.ok(/specified premises/.test(m.suggestion.note), 'the one short line that says when 18% applies');
  assert.ok(/Notification 11\/2017/.test(m.suggestion.cite), 'the citation');
  assert.strictEqual(m.rows[0].id, 's5');
  assert.strictEqual(m.rows[0].suggested, true);
});
t('a regulation pack (the counter\'s shopPack) is read through its .tax', () => {
  const reg = globalThis.CBRegulation.packFor('IN');
  assert.strictEqual(globalThis.cbSlabMenu(SLABS, reg, '996331').suggestion.slab_id, 's5');
});
t('a shop code "D01" suggests nothing (never read as an HSN — critic 12); AU offers no suggestion at all', () => {
  assert.strictEqual(globalThis.cbSlabMenu(SLABS, IN, 'D01').suggestion, null);
  assert.strictEqual(globalThis.cbSlabMenu(SLABS, P.packFor('AU'), '996331').suggestion, null);
});
t('the buttons: suggestion first with "Use", the citation behind ⓘ, each with the host\'s own onclick', () => {
  const m = globalThis.cbSlabMenu(SLABS, IN, '996331');
  const h = globalThis.cbSlabMenuHTML(m, { cls: 'choice', pick: (id) => "pick('" + id + "')" });
  assert.ok(h.indexOf('data-testid="rate-pick-s5"') < h.indexOf('data-testid="rate-pick-s18"'), 'suggested first');
  assert.ok(/class="choice suggested"[^>]*onclick="pick\(&#39;s5&#39;\)"/.test(h), 'the host\'s onclick, escaped');
  assert.ok(h.indexOf('996331 · restaurant · 5%') >= 0 && h.indexOf('>Use · GST 5%<') >= 0, 'Use');
  assert.ok(/<details class="slab-cite"[^>]*><summary[^>]*>ⓘ<\/summary>/.test(h), 'ⓘ');
  assert.strictEqual((h.match(/<button /g) || []).length, 3, 'three buttons for three slabs on the menu');
});
t('no slab on the menu → one sentence saying where a slab is made', () => {
  const h = globalThis.cbSlabMenuHTML(globalThis.cbSlabMenu([], IN, ''), {});
  assert.ok(/No GST slab yet — Catalogue setup › Tax/.test(h));
  assert.ok(h.indexOf('<button') < 0);
});

console.log('\ntax-slab-ui · who may set a rate (the api\'s setsRate; DECISIONS 2026-10-24 14:20: owner or manager ONLY, on every door)');
t('the owner and a manager may; a cashier (hat act), a viewer, a key (nobody) may not, and hear the api\'s own sentence', () => {
  assert.deepStrictEqual(globalThis.cbRateMay({ owner: true }), { ok: true, why: '' });
  assert.deepStrictEqual(globalThis.cbRateMay({ owner: false, hat: 'manager' }), { ok: true, why: '' });
  for (const who of [{ owner: false, hat: 'act' }, { owner: false, hat: 'view_only' }, { owner: false, hat: null }, null]) {
    assert.deepStrictEqual(globalThis.cbRateMay(who), { ok: false, why: 'Ask the owner or a manager to set the tax rate.' }, JSON.stringify(who));
  }
});
t('⭐ the catalogue row: an editor/cashier SEES Set rate greyed WITH the sentence; the owner and a manager see it enabled', () => {
  const button = (who) => globalThis.cbRateButtonHTML(globalThis.cbRateMay(who), { word: 'Set rate', onclick: 'go()', tid: 'cat-rate-set' });
  const greyed = button({ owner: false, hat: 'act' });
  assert.ok(/<button[^>]*data-testid="cat-rate-set"[^>]*disabled title="Ask the owner or a manager to set the tax rate\."/.test(greyed), 'disabled, the reason in the title');
  assert.ok(/data-testid="cat-rate-set-why">Ask the owner or a manager to set the tax rate\.</.test(greyed), 'the sentence beside it');
  assert.ok(/>Set rate</.test(greyed), 'still shown — never hidden');
  for (const who of [{ owner: true }, { owner: false, hat: 'manager' }]) {
    const enabled = button(who);
    assert.ok(enabled.indexOf('disabled') < 0 && enabled.indexOf('-why') < 0 && /onclick="go\(\)"/.test(enabled), 'enabled for ' + JSON.stringify(who));
  }
});
t('a rated item carries the action too ("Change"), after the chip and its source', () => {
  const r = S.resolve({ item_data: { tax_slab: 's5' }, face: {}, slabs: SLABS, categories: [] });
  const h = globalThis.cbSlabChipHTML(r, { country: 'IN', action: globalThis.cbRateButtonHTML({ ok: true }, { word: 'Change', onclick: 'go()' }) });
  assert.ok(h.indexOf('GST 5%') < h.indexOf('on this item') && h.indexOf('on this item') < h.indexOf('>Change<'), 'chip · source · action');
});

console.log('\ntax-slab-ui · does the shop charge its tax (the api\'s tax-shelf.chargesTax twin; critic 11: never "has a GSTIN")');
t('regular + GSTIN charges; composition with a GSTIN does not; regular without one does not; a US seller charges with no id', () => {
  assert.strictEqual(globalThis.cbTaxCharges({ gstin: '33AAAAA0000A1Z5', reg_type: 'regular' }, IN), true);
  assert.strictEqual(globalThis.cbTaxCharges({ gstn: '33AAAAA0000A1Z5' }, IN), true, 'the /me column name and a blank reg_type (regular)');
  assert.strictEqual(globalThis.cbTaxCharges({ gstin: '33AAAAA0000A1Z5', reg_type: 'composition' }, IN), false);
  assert.strictEqual(globalThis.cbTaxCharges({ gstin: '', reg_type: 'regular' }, IN), false);
  assert.strictEqual(globalThis.cbTaxCharges({ gstin: '' }, P.packFor('US')), !!P.packFor('US').collect_without_tax_id);
});

console.log('\ntax-slab-ui · W1b: the server\'s verdict decides, the category picker is enabled by role, the exempt button exists only with an exempt slab');
t('cbRateMay reads the server\'s may_set_rate FIRST (api #429): a manager it vouches for is ok, an owner it refuses is not; absent → is_owner (main\'s api today)', () => {
  assert.deepStrictEqual(globalThis.cbRateMay({ can_see_costs: true, is_owner: false, may_set_rate: true }), { ok: true, why: '' });
  assert.strictEqual(globalThis.cbRateMay({ is_owner: true, may_set_rate: false }).ok, false, 'the server said no: no');
  assert.strictEqual(globalThis.cbRateMay({ can_see_costs: true, is_owner: true }).ok, true, 'no verdict yet: the owner');
  assert.strictEqual(globalThis.cbRateMay({ can_see_costs: true, is_owner: false }).ok, false, 'no verdict yet: an editor is greyed');
  assert.strictEqual(globalThis.cbRateMay(null).ok, false, 'nothing read yet: greyed');
});
t('cbcatSlabPickHTML: greyed WITH the sentence for an editor, enabled for an owner; onReady is the HOST\'s repaint once the slabs land', () => {
  globalThis.cbDefsCached = () => SLABS;
  const greyed = globalThis.cbcatSlabPickHTML({ default_slab: 's5' }, { may: globalThis.cbRateMay({ is_owner: false }) });
  assert.ok(/<select[^>]*data-testid="catg-slab"[^>]*disabled title="Ask the owner or a manager to set the tax rate\."/.test(greyed), 'disabled, the reason in its title');
  assert.ok(/data-testid="catg-slab-why">Ask the owner or a manager to set the tax rate\.</.test(greyed), 'the sentence under it');
  const enabled = globalThis.cbcatSlabPickHTML({ default_slab: 's5' }, { may: globalThis.cbRateMay({ is_owner: true }) });
  assert.ok(enabled.indexOf('disabled') < 0 && enabled.indexOf('catg-slab-why') < 0, 'the owner sees it enabled');
  let repainted = 0;
  globalThis.cbDefsCached = () => null;
  globalThis.cbDefsLive = () => ({ then: (fn) => fn([]) }); /* the shelf lands at once */
  assert.match(globalThis.cbcatSlabPickHTML({}, { onReady: () => repainted++ }), /reading your slabs/);
  assert.strictEqual(repainted, 1, 'the host\'s own repaint ran (catalogue.html has no cbcatPaint target)');
  globalThis.cbDefsCached = () => SLABS;
});
t('⭐ "No GST (exempt)" is the shop\'s 0% slab whose nil_kind is exempt, on today\'s menu; a 0% slab without the word reads "GST 0%"; no such slab → no such button', () => {
  const exempt = { definition_id: 'sx', kind: 'tax', name: 'Exempt goods', status: 'live', rules: { rate: 0, nil_kind: 'exempt' } };
  const m = globalThis.cbSlabMenu(SLABS.concat([exempt]), IN, '');
  assert.strictEqual(m.rows.filter((r) => r.id === 'sx')[0].words, 'No GST (exempt)');
  assert.strictEqual(m.rows.filter((r) => r.id === 'IN-GST-0')[0].words, 'GST 0%', 'nil without a word stays a plain 0%');
  assert.ok(/data-testid="rate-pick-sx"[^>]*>No GST \(exempt\)</.test(globalThis.cbSlabMenuHTML(m, {})), 'the button');
  const without = globalThis.cbSlabMenu(SLABS, IN, '');
  assert.ok(without.rows.every((r) => r.words.indexOf('exempt') < 0), 'no exempt slab authored → no exempt button, nothing invented');
  assert.strictEqual(globalThis.cbSlabMenu([exempt], P.packFor('AE'), '').rows[0].words, 'No VAT (exempt)', 'the pack\'s word');
});

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
