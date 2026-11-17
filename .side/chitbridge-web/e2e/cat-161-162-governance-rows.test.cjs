/**
 * cat-161-162-governance-rows.test.cjs — CAT-161 and CAT-162 (proof 2026-11-14): Profile > Storefront writes catalogue visibility to the server; the Governance rows read it and point at Definitions.
 * OWNS      CAT-161: saveProfile('governed') (cap-admin.js, with profFieldsBody from cap-shop.js) sends the visibility chosen in pf_vis as catalogue_visibility through
 *           api('saveProfile') — and a capped (disabled) control sends nothing; the Governance row "Catalogue visibility" is the FUNCTION govCatVis (resolved at render, no
 *           literal stub) and answers the real value with its cap ("public", "private · capped at private by the operator"), or a pointer to Profile when /me is not read.
 *           CAT-162: the Standards rows (units, code standards) are declared as govUnits / govCodeStandards, read the catalogue model's registries, and the code-standards row ends
 *           "— see Definitions"; an empty registry says so rather than a number.
 *           Real functions lifted from public/app/cap-admin.js and cap-shop.js into a vm sandbox.
 * CALLED BY .github/workflows/ci.yml (Offline guards). No browser, no network, no sibling repo.
 *   node e2e/cat-161-162-governance-rows.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { liftFns } = require('./lib/lift-fn.cjs');

const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-admin.js'), 'utf8');
const profStart = adminSrc.indexOf('var PROF_FIELDS = {');
const profBlock = adminSrc.slice(profStart, adminSrc.indexOf('\n};', profStart) + 3);
if (profStart < 0) throw new Error('PROF_FIELDS not found');

const els = {};
const sent = [];
const sandbox = {
  console, UI: {}, esc: (v) => String(v), govKlass: (k) => k, MSG: { profileSaved: () => 'Saved' }, SHOP_FIELDS: [], toast() {}, loadProfile() {}, tx: (s) => s,
  document: { getElementById: (id) => els[id] || null },
  val: (id) => (els[id] ? String(els[id].value) : ''),
  api: (name, opts) => { sent.push({ name, body: opts && opts.body }); return Promise.resolve({}); }
};
vm.createContext(sandbox);
vm.runInContext(
  profBlock + '\n' + liftFns('public/app/cap-admin.js', ['saveProfile', 'govCatVis', 'govCodeStandards', 'govUnits', 'govRowHtml', 'govOwnedElsewhere', 'govCatVisWhy']) + '\n' + liftFns('public/app/cap-shop.js', ['profFieldsBody']) +
  '\nthis.saveProfile = saveProfile; this.govCatVis = govCatVis; this.govCodeStandards = govCodeStandards; this.govUnits = govUnits; this.govRowHtml = govRowHtml; this.PROF_FIELDS = PROF_FIELDS;', sandbox);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad++; };
(async () => {
  /* CAT-161 — the write */
  ok(sandbox.PROF_FIELDS.governed.some((p) => p[0] === 'pf_vis' && p[1] === 'catalogue_visibility'), 'the Storefront section maps pf_vis to catalogue_visibility');
  els.pf_vis = { value: 'public', disabled: false };
  els.pf_bs = { value: 'open', disabled: false };
  await sandbox.saveProfile('governed');
  ok(sent.length === 1 && sent[0].name === 'saveProfile' && sent[0].body.catalogue_visibility === 'public' && sent[0].body.business_status === 'open', 'saving Storefront sends { catalogue_visibility: "public", business_status: "open" } to the server (' + JSON.stringify(sent[0]) + ')');
  sent.length = 0;
  els.pf_vis.disabled = true;
  await sandbox.saveProfile('governed');
  ok(!sent[0].body.catalogue_visibility, 'a capped (disabled) visibility control is not sent');
  /* CAT-161 — the Governance row is the real value */
  ok(/\['Catalogue visibility', govCatVis, 'chosen'\]/.test(adminSrc), 'the Governance row "Catalogue visibility" is the function govCatVis, not a literal');
  sandbox.UI._me = null;
  ok(/Profile/.test(sandbox.govCatVis()), 'before /me is read the row points at Profile > Storefront (' + sandbox.govCatVis() + ')');
  sandbox.UI._me = { catalogue_visibility: 'public' };
  ok(sandbox.govCatVis() === 'public', 'a public shop reads "public" (' + sandbox.govCatVis() + ')');
  sandbox.UI._me = { catalogue_visibility: 'public', visibility_cap: { max: 'private', by: 'the operator' } };
  ok(sandbox.govCatVis() === 'public · capped at private by the operator', 'a capped shop reads its cap and who set it (' + sandbox.govCatVis() + ')');
  /* CAT-162 — the Standards rows point at Definitions */
  ok(/\['Units of measure', govUnits, 'free'\]/.test(adminSrc) && /\['Code standards \(HSN \/ SKU\)', govCodeStandards, 'free'\]/.test(adminSrc), 'the Standards section declares the units and code-standards rows as functions');
  sandbox.CBCatalogue = { STD_SCHEMES: ['HS', 'GS1 GPC', 'Schema.org', 'UNSPSC', 'custom'], UNITS: ['kg', 'g', 'l', 'ml', 'pc', 'box'] };
  ok(sandbox.govCodeStandards() === 'HS · GS1 GPC · Schema.org · UNSPSC +1 — see Definitions', 'code standards: first four schemes, +1, and "— see Definitions" (' + sandbox.govCodeStandards() + ')');
  ok(sandbox.govUnits() === '6 declared · kg · g · l · ml · pc +1', 'units: the count and the first five (' + sandbox.govUnits() + ')');
  const units = sandbox.govRowHtml('Units of measure', sandbox.govUnits(), 'free'), codes = sandbox.govRowHtml('Code standards (HSN / SKU)', sandbox.govCodeStandards(), 'free');
  ok(units.includes('change in Catalogue setup → Definitions') && units.includes("navTo('catsetup')"), 'the Units row carries the pointer "change in Catalogue setup → Definitions"');
  ok(codes.includes('change in Catalogue setup → Definitions') && codes.includes("navTo('catsetup')"), 'the Code standards row carries the same pointer to Definitions');
  sandbox.CBCatalogue = { STD_SCHEMES: [], UNITS: [] };
  ok(/no scheme registry loaded/.test(sandbox.govCodeStandards()) && /no units registry loaded/.test(sandbox.govUnits()), 'an empty registry says so, never a number');
  process.exitCode = bad ? 1 : 0;
})();
