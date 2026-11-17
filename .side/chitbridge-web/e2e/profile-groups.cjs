/**
 * e2e/profile-groups.cjs — no group on the profile may grow into a list.
 *
 * Athi, 2026-08-21: *"if we can group them together that would be great. A small list is always good, human
 * brain cannot take multiple things in one go. So small groups like identity, business — if too many in one
 * single group, split it with a subgroup."*
 *
 * ⭐⭐ THAT IS A LIMIT A TEST CAN HOLD, AND IT IS THE KIND THAT DECAYS SILENTLY. Nobody adds seven rows to a
 * group; somebody adds the fifth, and later the sixth, and each one is individually reasonable. "How you read
 * it" reached seven that way — it began as language and direction, then became the group that existed when
 * timestamp, numbers, working week, theme and text size each needed a home.
 *
 * ⚠️ THE LIMIT IS PER GROUP, NOT PER SECTION. A section with twelve rows in four named groups is easier to read
 * than one with seven in a single list, so counting the section would fail the wrong screens and pass this bug.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { makeDocument } = require('./lib/dom-stub.cjs');

const W = path.join(__dirname, '..', 'public');
const MAX = 6;   /* ⚠️ Six is where a group stops being scannable. Not a measured constant — a stated one. */

const store = {};
const sb = {
  console, Intl,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: makeDocument(),
  setTimeout: () => 0, clearTimeout(){}, fetch: async () => ({ ok: false }),
  navigator: { language: 'en-IN', languages: ['en-IN'] }, location: { origin: '', host: 'h', search: '' },
};
sb.window = sb; sb.globalThis = sb;
const ctx = vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(W, 'engine', 'locale.js'), 'utf8'), ctx, { filename: 'locale.js' });
Object.assign(sb, {
  esc: (x) => String(x == null ? '' : x), tx: (x) => x,
  txf: (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => v[k]),
  UI: { _iamOpen: { identity: 1, business: 1, regional: 1, channels: 1, storefront: 1, trade: 1, rights: 1, docs: 1 } },
  SESSION: { token: 't', currency: 'INR' }, val: () => '',
  opt: (l) => l.map((o) => '<option>' + o + '</option>').join(''),
  toast(){}, renderApp(){}, loadProfile(){}, _capShowDetail(){}, api: async () => ({}),
  MSG: { profileSaved: () => '' }, navTo(){}, setSetSec(){}, helpQ: () => '', _CARD: '',
  govCardHTML: () => '', menuAssist: () => '', _misHead: () => '', _capEnd: () => '',
  THEMES: { cream: { name: 'Cream', a11y: { level: 'AA' } } }, themeGet: () => 'cream',
  TEXT_SIZES: [['s','Small',0.92],['m','Medium',1],['l','Large',1.15],['xl','Extra large',1.32]],
  textSize: () => 'm', motionPref: () => 'auto', apGet: (k, d) => (k in store ? store[k] : d),
  STANDARDS: [], GOV: [],
});
/* CAP_WITH.admin (app.html): helpers.js (taxIdWord · packWord), cap-shop.js (SET1) and cap-settings.js (T3-SETTINGS) load before cap-admin.js */
for (const f of ['helpers.js', 'cap-shop.js', 'cap-settings.js']) vm.runInContext(fs.readFileSync(path.join(W, 'app', f), 'utf8'), ctx, { filename: f });
vm.runInContext(fs.readFileSync(path.join(W, 'app', 'cap-admin.js'), 'utf8'), ctx, { filename: 'cap-admin.js' });

const html = ctx.iamMeHTML({
  identity_id: 'e', bridge_id: 'B', display_name: 'mystorex', user_id: 'mystorex', identity_type: 'entity',
  country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata', governance: {},
  gstn: '29ABCDE1234F1Z5', address: 'x', business_status: 'open',
});

/* A group heading is profGroup's rule; a row label is profRow's uppercase <b>. Both are matched on the exact
   inline style they render with — if either primitive is restyled this guard stops finding anything, which is
   why it fails on a zero total rather than reporting a clean run. */
const HEAD = 'border-block-end:1px solid var(--line)">';
const ROW  = 'letter-spacing:.04em;line-height:1.7">';

const groups = [];
let loose = 0, cursor = null;
for (let i = 0; i < html.length; ) {
  const h = html.indexOf(HEAD, i);
  const r = html.indexOf(ROW, i);
  if (h < 0 && r < 0) break;
  if (h >= 0 && (r < 0 || h < r)) {
    const end = html.indexOf('<', h + HEAD.length);
    cursor = { name: html.slice(h + HEAD.length, end).trim(), rows: [] };
    groups.push(cursor);
    i = h + HEAD.length;
  } else {
    const end = html.indexOf('<', r + ROW.length);
    const label = html.slice(r + ROW.length, end).trim();
    if (cursor) cursor.rows.push(label); else loose++;
    i = r + ROW.length;
  }
}

console.log('\n  profile groups (max ' + MAX + ' rows each):\n');
groups.forEach((g) => console.log('    ' + (g.rows.length > MAX ? '\u2717 ' : '  ')
  + g.name.padEnd(26) + String(g.rows.length).padStart(2) + '  ' + g.rows.join(' \u00b7 ')));

const total = groups.reduce((s, g) => s + g.rows.length, 0) + loose;
const over = groups.filter((g) => g.rows.length > MAX);

let fail = 0;
if (!total) { fail++; console.error('\n  \u2717 no rows found at all \u2014 profRow/profGroup markup changed and this guard went blind.'); }
if (over.length) {
  fail++;
  console.error('\n  \u2717 ' + over.length + ' group(s) over ' + MAX + ' rows: '
    + over.map((g) => g.name + ' (' + g.rows.length + ')').join(', ')
    + '\n    Split by the QUESTION each row answers, not at the midpoint \u2014 a subgroup nobody can name is not a fix.');
}
if (loose) console.log('\n  \u26a0 ' + loose + ' row(s) render outside any group heading.');

console.log('\n  \u2550\u2550 ' + (fail ? 'TOO DENSE' : total + ' rows in ' + groups.length + ' groups, none over ' + MAX) + ' \u2550\u2550\n');
process.exit(fail ? 1 : 0);
