/**
 * e2e/prof-dirty.cjs — "you edited and did not save" must fire when it should, and never when it should not.
 *
 * Athi, 2026-08-20: *"if the user edit something and came out without saving, we have to ask confirmation —
 * you have edited but not saved — and a confirmation message for both save and cancel."*
 *
 * ⚠️⚠️ THE FAILURE THAT MATTERS IS THE FALSE POSITIVE. A guard that asks on every navigation gets clicked
 * through without reading within a day, and then it protects nothing — so the real assertions here are the
 * negative ones: a fresh screen is clean, a COLLAPSED section is not dirty (its inputs do not exist, so it
 * cannot have been edited), and discarding resets the baseline rather than leaving the prompt armed forever.
 *
 * The baseline is the DOM at paint, not the server payload — comparing against the API row would call a field
 * dirty whenever the server normalised it, and ask a person to save something they never typed.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeDocument } = require('./lib/dom-stub.cjs');

const fields = {};
const mk = (id, v) => (fields[id] = { value: v, disabled: false });

const sandbox = {
  console,
  document: makeDocument({ getElementById: (id) => fields[id] || null, createElement: () => ({ style: {} }) }),
  UI: { _iamOpen: {} }, SESSION: { actorId: null },
  val: (id) => (fields[id] ? String(fields[id].value).trim() : ''),
  tx: (s) => s, esc: (s) => String(s), toast(){}, modal(){}, closeModal(){},
  renderApp(){}, loadProfile(){}, _capShowDetail(){}, api: async () => ({}),
  MSG: { profileSaved: () => 'ok' }, opt: () => '', CBLocale: { region: () => 'IN' },
  govCardHTML: () => '', location: { origin: '', host: '' }, setTimeout: () => 0,
  localStorage: { getItem: () => null }, fetch: async () => ({ ok: false }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
/* CAP_WITH.admin (app.html): helpers.js (taxIdWord · packWord), cap-shop.js (SET1) and cap-settings.js (T3-SETTINGS) load before cap-admin.js */
for (const f of ['helpers.js', 'cap-shop.js', 'cap-settings.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', f), 'utf8'), ctx, { filename: f });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'cap-admin.js'), 'utf8'), ctx,
                { filename: 'cap-admin.js' });

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + '\n      got ' + a + '  want ' + b); }
};

mk('pf_name', 'mystorex'); mk('pf_gstn', ''); mk('pf_addr', ''); mk('pf_bs', 'open'); mk('pf_vis', 'private');
ctx.profSnapshot();

console.log('\n── nothing typed ──');
eq('a freshly painted screen is clean', ctx.profDirtySections(), []);

console.log('\n── one field, one section ──');
fields.pf_name.value = 'mystorex2';
eq('editing NAME dirties only Identity', ctx.profDirtySections(), ['ident']);

console.log('\n── two sections at once ──');
fields.pf_vis.value = 'public';
eq('editing visibility adds Storefront', ctx.profDirtySections(), ['ident', 'governed']);

console.log('\n── a collapsed section cannot be dirty ──');
fields.pf_addr.value = 'somewhere';           // edited…
eq('…while rendered, it counts', ctx.profDirtySections(), ['ident', 'profile', 'governed']);
delete fields.pf_addr; delete fields.pf_gstn;  // …then the section is collapsed away
eq('collapsed away, it no longer counts', ctx.profDirtySections(), ['ident', 'governed']);

console.log('\n── discard resets the baseline ──');
ctx.profSnapshot();
eq('after re-snapshot, clean again', ctx.profDirtySections(), []);

console.log('\n── typing the SAME value is not a change ──');
fields.pf_name.value = 'mystorex2';
eq('unchanged value stays clean', ctx.profDirtySections(), []);

console.log('\n── a disabled control is never sent ──');
mk('pf_gstn', '27AAAAA0000A1Z5'); fields.pf_gstn.disabled = true;
ctx.profSnapshot();
fields.pf_gstn.value = '27BBBBB0000B1Z5';
eq('a capped/disabled field still reports dirty (it IS different)…', ctx.profDirtySections(), ['profile']);
/* …but saveProfile skips disabled controls, which is the half that matters — a capped value must never be
   sent back as though the person chose it. Asserted at the call boundary rather than here. */

/**
 * ── THE SAME HELPERS, DRIVING SETTINGS ─────────────────────────────────────────────────────────────────────
 *
 * ⭐ Settings reuses profSnapshot / profDirtySections with its OWN field map rather than copying them — a
 * second pair would drift from the first the moment either changed. These assertions exist to prove the two
 * maps stay INDEPENDENT: a Settings edit must never report a Profile section dirty, or the guard would offer
 * to save the wrong screen.
 */
console.log('\n── the same helpers, driven by SET_FIELDS ──');
mk('st_am', 'least'); mk('st_mt', '10'); mk('st_aam', 'off'); mk('st_ada', '');
ctx.setSnapshot();
eq('settings clean after snapshot',    ctx.profDirtySections(ctx.SET_FIELDS), []);
fields.st_mt.value = '25';
eq('editing max tasks dirties Work',   ctx.profDirtySections(ctx.SET_FIELDS), ['work']);
fields.st_aam.value = 'round';
eq('…and the mode adds Auto-assign',   ctx.profDirtySections(ctx.SET_FIELDS), ['work', 'assign']);
eq('the PROFILE map stays clean',      ctx.profDirtySections(ctx.PROF_FIELDS), []);
ctx.setSnapshot();
eq('settings clean after re-snapshot', ctx.profDirtySections(ctx.SET_FIELDS), []);

console.log(`\n══ ${pass} passed · ${fail} failed ══\n`);
process.exit(fail ? 1 : 0);
