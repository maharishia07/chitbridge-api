/**
 * e2e/locale-map.cjs — the two-way map between Settings controls and Profile rows, MEASURED.
 *
 * Athi, 2026-08-21: *"each one in profile needs to be mapped vice versa. Create a checklist for the profile
 * controls and what is being referred in settings, so it will be easier that we have not missed any."*
 *
 * ⭐⭐ SO IT DRIVES EACH CONTROL AND WATCHES WHAT MOVES. The guard this replaces held a hand-written table
 * saying which profile row reflected which setter — and a declared mapping is exactly as trustworthy as the
 * person who last edited it. This one sets a real value through the real locale layer, re-renders the real
 * profile, and diffs the rows. Nothing is claimed; everything is observed.
 *
 * TWO DIRECTIONS, TWO FAILURES:
 *   Settings → Profile   a control that moves NO row is invisible: changed, saved, and unconfirmable.
 *   Profile  → Settings  a row no control moves must be a BUSINESS fact (it comes from the entity record).
 *                        Anything else is an orphan — a value with no way to change it and no owner.
 *
 * ⚠️ "DEMONSTRATED" IS NOT GOOD ENOUGH ON ITS OWN, which is what this whole exercise proved. Athi held the two
 * screens side by side: Profile said COUNTRY: IN while Settings said PRESENTATION: United States, and the only
 * trace of the setting anywhere was that 12,345,678.9 grouped the American way. A sample shows a setting's
 * EFFECT and never lets a reader CHECK it. So a row moving is necessary — and the row that moves must NAME it.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { makeDocument } = require('./lib/dom-stub.cjs');

const W = path.join(__dirname, '..', 'public');
const store = {};
const sb = {
  console, Intl,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  document: makeDocument(),
  setTimeout: () => 0, clearTimeout(){}, fetch: async () => ({ ok: false }),
  navigator: { language: 'en-IN', languages: ['en-IN'] },
  location: { origin: '', host: 'h', search: '' },
};
sb.window = sb; sb.globalThis = sb;
const ctx = vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(W, 'engine', 'locale.js'), 'utf8'), ctx, { filename: 'locale.js' });
Object.assign(sb, {
  esc: (x) => String(x == null ? '' : x), tx: (x) => x,
  txf: (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => v[k]),
  UI: { _iamOpen: { regional: 1 } }, SESSION: { token: 't', currency: 'INR' }, val: () => '',
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

const ENTITY = {
  identity_id: 'e', bridge_id: 'B', display_name: 'mystorex', user_id: 'mystorex',
  identity_type: 'entity', country: 'IN', currency_code: 'INR', timezone: 'Asia/Kolkata', governance: {},
};

/**
 * Every profile row as label -> "value [note]".
 *
 * ⚠️ THE NOTE IS PART OF THE VALUE HERE. For the time zone and the format, the note is where the setting is
 * actually named — a diff that compared only the value would miss the exact fix this guard exists to protect.
 */
function rows() {
  const html = ctx.iamMeHTML(ENTITY);
  const seg = html.slice(html.indexOf('iam-sec-regional'));
  /* ⚠⚠ MATCH THE STRUCTURE, NOT THE EXACT PIXELS. This pinned margin-top:1px, and adding the source mark
     changed it to 2px — so the guard silently stopped capturing NOTES, and reported 'First day of week moves
     nothing' when the note was the only place it appears. A guard that goes half-blind still prints a verdict,
     which is worse than one that crashes. The row label and the flex value box are the load-bearing shapes;
     the note is now taken as whatever grey block follows, whatever its spacing. */
  const LBL  = 'letter-spacing:.04em;line-height:1.7">';
  const NOTE = 'color:var(--grey);margin-top:';
  const out = {}; let i = 0;
  while (true) {
    const a = seg.indexOf(LBL, i); if (a < 0) break;
    const le = seg.indexOf('<', a + LBL.length);
    const label = seg.slice(a + LBL.length, le).trim();
    const vs = seg.indexOf('<div>', le); if (vs < 0) break;
    const ve = seg.indexOf('</div>', vs);
    let val = seg.slice(vs + 5, ve).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    /* the note is the grey block immediately after, if there is one before the next row starts */
    const nxt = seg.indexOf(LBL, ve);
    const ns = seg.indexOf(NOTE, ve);
    if (ns >= 0 && (nxt < 0 || ns < nxt)) {
      const gs = seg.indexOf('>', ns);
      const ge = seg.indexOf('</div></div>', gs);
      if (ge > gs) val += '  [' + seg.slice(gs + 1, ge).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() + ']';
    }
    out[label] = val;
    i = ve;
  }
  return out;
}
const diff = (a, b) => Object.keys(Object.assign({}, a, b)).filter((k) => a[k] !== b[k]);

const C = ctx.CBLocale;
function reset() {
  C.setRegion('IN'); C.setLangs(['en']);
  ['nu', 'hc', 'ca', 'fw'].forEach((k) => C.setExt(k, ''));
  C.setWorkdays([]); C.setTimezone('');
}

/**
 * Each Settings control, and a value that must visibly change something.
 *
 * ⚠️ THE VALUE HAS TO BE A REAL ALTERNATIVE, not merely a different string. Setting nu=latn against an en-IN
 * baseline changes nothing — latn is ALREADY what en-IN uses — so the guard would report an invisible control
 * when the truth is "already applied". Every value below is chosen to differ from the IN baseline.
 */
/**
 * ⭐⭐ DRIVEN THROUGH THE REAL HANDLERS, THEN SAVED — not through CBLocale directly. Settings now STAGES:
 * clicking a picker records the change and nothing applies until Save. Calling CBLocale.setExt() here would
 * bypass the staging entirely and test a path no person can take, so the guard would stay green even if the
 * Save button were wired to nothing.
 */
const CONTROLS = [
  { setter: 'localeSetRegion',      what: 'Region',            run: () => ctx.localeSetRegion('US') },
  { setter: 'localeSetFormat',      what: 'Format',            run: () => ctx.localeSetFormat('de-DE') },
  /* ⚠⚠ TWO CLICKS, BECAUSE THE TOGGLE APPENDS. My earlier version called setLangs(['ar','en']) directly and
     put Arabic FIRST; the real control adds it LAST, since the list is a priority order and a toggle cannot
     express rank. So one click leaves Language 1 as English and direction as LTR, and this guard called both
     rows orphans. Adding Arabic and then removing English is what a person actually does, and it is the only
     sequence that reaches the state the earlier test had assumed. */
  { setter: 'localeToggleLang',     what: 'Languages',         run: () => { ctx.localeToggleLang('ar'); ctx.localeToggleLang('en'); } },
  { setter: 'localeSetNu',          what: 'Numbering system',  run: () => ctx.localeSetNu('deva') },
  { setter: 'localeSetHc',          what: 'Hour cycle',        run: () => ctx.localeSetHc('h23') },
  { setter: 'localeSetCa',          what: 'Calendar',          run: () => ctx.localeSetCa('indian') },
  { setter: 'localeSetFw',          what: 'First day of week', run: () => ctx.localeSetFw('sun') },
  { setter: 'localeToggleWorkday',  what: 'Working days',      run: () => ctx.localeToggleWorkday(6) },
  /* ⚠⚠ THE TENTH CONTROL, INVISIBLE TO THIS GUARD UNTIL TODAY — the scan pattern was localeSet*|localeToggle*,
     so a function named localeReset* was never looked for.
     ⚠️ AND IT IS MEASURED AGAINST THE STATE IT UNDOES, NOT AGAINST BASE. Its whole job is to return to the
     region's answer, so comparing it to base correctly finds no difference — a true observation answering the
     wrong question. `against: 'pre'` asks the question that means something: did clearing the override move
     the screen back? */
  { setter: 'localeResetWorkdays',  what: 'Working days',      against: 'pre',
    pre: () => { ctx.localeToggleWorkday(6); ctx.localeSaveLocale(); },
    run: () => ctx.localeResetWorkdays() },
  { setter: 'localeSetTz',          what: 'Time zone',         run: () => ctx.localeSetTz('Europe/London') },
  /* ⚠️ NOT DRIVEN, AND THE REASON IS THE POINT. Currency is the only control on that screen which PATCHes the
     BUSINESS record rather than this browser's storage, so driving it would need a server. Its row is asserted
     to exist instead — which is the whole claim being made about it: that it is NAMED on the profile. */
  { setter: 'localeSetCurrency',    what: 'Currency',          expectRow: 'Currency' },
];

/* ⚠️ A NEW CONTROL MUST NOT SLIP IN UNLISTED — and the scan is over the whole FILE, not one function. When the
   currency menu moved into its own _curPicker() helper, a scan limited to localeSettingsHTML went blind and
   reported "aligned" with a completely unreflected control sitting on the screen.

   ⚠️⚠️ AND IT MATCHES DECLARATIONS, NOT A NAMING CONVENTION. The pattern was localeSet*|localeToggle*, so
   localeResetWorkdays — a real control with a real button — was invisible to this guard from the day it was
   written. A guard that finds controls by guessing their verb finds only the verbs you thought of. Every
   function declared as locale<Something> is a candidate now, and the renderer is the one named exception.

   ⚠️ THE PATTERN CARRIES NO BACKSLASHES ON PURPOSE. [(] rather than an escaped paren, a space class rather
   than the whitespace escape: six separate times this session a generated edit has eaten one backslash out of
   a regex, and a regex that silently matches nothing is a guard that silently passes. Nothing here to eat. */
const admin = fs.readFileSync(path.join(W, 'app', 'cap-admin.js'), 'utf8');
const found = [...new Set([...admin.matchAll(/function (locale[A-Z][A-Za-z]*)[ ]*[(]/g)].map((m) => m[1]))]
  /* ⚠️ THE RENDERER AND THE TWO COMMIT ACTIONS ARE NOT SETTINGS. Save and Discard do not change a value;
     they decide the fate of values already staged, so demanding that each 'moves a profile row' would be
     asking the wrong thing of them. Named individually rather than pattern-matched away, so a real control
     cannot hide behind a loose exception. */
  .filter((n) => ['localeSettingsHTML', 'localeSaveLocale', 'localeDiscardLocale'].indexOf(n) < 0);
const known = new Set(CONTROLS.map((c) => c.setter));

let fail = 0;
const movedBy = {};

reset();
const BASE = rows();

console.log('\n  SETTINGS → PROFILE   (what each control visibly moves)\n');
for (const c of CONTROLS) {
  if (!c.run) {
    if (!Object.prototype.hasOwnProperty.call(BASE, c.expectRow)) {
      fail++; console.error('  ✗ ' + c.what.padEnd(18) + 'no "' + c.expectRow + '" row on the profile');
    } else {
      console.log('  ✓ ' + c.what.padEnd(18) + c.expectRow + '   (server-side — row asserted, not driven)');
      (movedBy[c.expectRow] = movedBy[c.expectRow] || []).push(c.what);
    }
    continue;
  }
  reset();
  var basis = BASE;
  if (c.pre) { c.pre(); if (c.against === 'pre') basis = rows(); }
  c.run();
  /* ⚠️ AND SAVE — staging alone moves nothing on the profile, by design. A guard that stopped at run() would
     now report every control as invisible, which is the correct answer to the wrong question. */
  ctx.localeSaveLocale();
  const moved = diff(basis, rows());
  moved.forEach((r) => { (movedBy[r] = movedBy[r] || []).push(c.what); });
  if (!moved.length) {
    fail++;
    console.error('  ✗ ' + c.what.padEnd(18) + 'moves NOTHING — it can be changed and never confirmed');
  } else {
    console.log('  ✓ ' + c.what.padEnd(18) + moved.join(' · '));
  }
}
reset();

/**
 * ⚠️ THESE THREE COME FROM THE ENTITY RECORD, NOT FROM THIS BROWSER, which is why no locale control moves them.
 * Country and Currency are columns on `identities`; Time zone is the BUSINESS's zone (b176) — the reader's own
 * zone appears only as a NOTE on the timestamp. A locale setter that ever started moving one of these would
 * mean a reader's preference had begun overwriting a fact about the business.
 */
const BUSINESS_FACTS = {
  'Country':   'identities.country',
  'Currency':  'identities.currency_code',
  'Time zone': 'identities.timezone (b176)',
};
/* Theme and text size are real settings with a real owner — just a different screen. */
const ELSEWHERE = { 'Theme': 'Settings › Appearance', 'Text size': 'Settings › Appearance' };

console.log('\n  PROFILE → SETTINGS   (what governs each row)\n');
for (const row of Object.keys(BASE)) {
  const by = movedBy[row];
  if (by && by.length) { console.log('  ✓ ' + row.padEnd(18) + by.join(' + ')); continue; }
  if (Object.prototype.hasOwnProperty.call(BUSINESS_FACTS, row)) {
    console.log('  · ' + row.padEnd(18) + BUSINESS_FACTS[row] + '   (business fact — no locale control)'); continue;
  }
  if (Object.prototype.hasOwnProperty.call(ELSEWHERE, row)) {
    console.log('  · ' + row.padEnd(18) + ELSEWHERE[row]); continue;
  }
  fail++;
  console.error('  ✗ ' + row.padEnd(18) + 'ORPHAN — no control moves it and it is not a declared business fact');
}

const unlisted = found.filter((n) => !known.has(n));
const stale = CONTROLS.filter((c) => !found.includes(c.setter)).map((c) => c.setter);
if (unlisted.length) {
  fail++;
  console.error('\n  ✗ Settings has a control this map does not know: ' + unlisted.join(', ')
    + '\n    Add it above WITH a value that visibly changes the profile.');
}
if (stale.length) console.log('\n  ⚠ listed here but no longer in Settings: ' + stale.join(', '));

console.log('\n  ══ ' + (fail ? fail + ' UNMAPPED' : 'every control moves a row, every row has an owner') + ' ══\n');
process.exit(fail ? 1 : 0);
