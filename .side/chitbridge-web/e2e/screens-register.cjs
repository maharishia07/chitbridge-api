'use strict';
/**
 * screens-register.cjs — THE REGISTER THE BROWSER GETS IS THE REGISTER ON DISK.
 *
 * ── ⭐⭐ WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"maybe a table that remembers the codes and the system should use it to refer. It is like a
 * CMDB kind of."* — so `C:\dev\SCREENS.json` is the register, and `public/app/screens.js` is a GENERATED copy of
 * it for the browser.
 *
 * ⚠️⚠️ A GENERATED FILE THAT NOBODY REGENERATES IS THE SAME BUG AS A HAND-MAINTAINED ONE, and it is quieter: the
 * app keeps working, showing codes that were true last week. The whole value of a code is that it means exactly
 * one thing, so the two copies disagreeing is the one failure this system cannot absorb.
 *
 * ⚠️ Same shape as the cache-buster and the CORS header list before it: two places, one fact, nothing joining
 * them. This is the join.
 *
 * Run: node e2e/screens-register.cjs
 */
const fs = require('fs');
const path = require('path');

const DEV = process.env.CB_DOCS_DIR || path.join(__dirname, '..', '..');
const REG = process.env.SCREENS_JSON || path.join(DEV, 'SCREENS.json'); /* SCREENS_JSON: check against another copy (a docs worktree) */
const JS = path.join(__dirname, '..', 'public', 'app', 'screens.js');

let pass = 0;
const fails = [];
const ok = (what, cond) => { if (cond) { pass++; console.log('  ✓ ' + what); } else { fails.push(what); } };

if (!fs.existsSync(REG)) {
  console.log('\n── screen register ──\n  skipped: SCREENS.json not present (docs repo not checked out)\n');
  process.exit(0);
}

console.log('\n══ the screen register ══');

const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
const live = Object.entries(reg.screens).filter(([, s]) => !s.retired);

ok('the browser copy exists at all — it is generated and committed, not built at runtime', fs.existsSync(JS));
if (!fs.existsSync(JS)) { fails.forEach((f) => console.error('  ✗ ' + f)); process.exit(1); }

const sandbox = { window: {} };
try { new Function('window', fs.readFileSync(JS, 'utf8'))(sandbox.window); }
catch (e) { console.error('  ✗ the generated copy does not evaluate: ' + e.message); process.exit(1); }
const CB = sandbox.window.CBSCREENS || {};
const rows = CB.rows || [];

/* one home per row: the register rows the browser copy carries are decided by ONE predicate, the docs repo's
   toolset/ui-identity/browser-keeps.cjs (the writer, screens.cjs --browser-from-register, uses the same). Without that file
   (docs not beside this repo) nothing is excluded. */
let keeps = () => true;
try { keeps = require(path.join(DEV, 'toolset', 'ui-identity', 'browser-keeps.cjs')).browserKeeps(path.join(__dirname, '..')); } catch (e) { /* docs checkout without the module: the old rule */ }
const carried = live.filter(([, sc]) => keeps(sc));
ok('every live screen the browser reads reaches it (' + carried.length + ' of ' + live.length + ' live; the rest are screen-id.js families and ui-stamp rows)', rows.length === carried.length);

const codes = new Set(rows.map((r) => r.code));
const missing = carried.filter(([, s]) => !codes.has(s.code)).map(([k, s]) => s.code + ' ' + k);
ok('none is missing' + (missing.length ? ': ' + missing.slice(0, 4).join(' · ') : ''), missing.length === 0);

/* ⚠️ A RETIRED SCREEN MUST NOT BE OFFERED. Its code stays reserved forever, but showing it would say the screen
   still exists — the opposite of what retiring it recorded. */
const retired = Object.entries(reg.screens).filter(([, s]) => s.retired).map(([, s]) => s.code);
const leaked = retired.filter((c) => codes.has(c));
ok('no retired screen is offered' + (leaked.length ? ': ' + leaked.join(' · ') : ''), leaked.length === 0);

/* ⚠️ A RETIRED CONTROL CODE MUST NOT COME BACK ON AN ELEMENT (UX-137 wave 0b). A control row retired with an alias_of was replaced by a library
   component; a data-cbsid that still names the retired row would count one element under two codes. Reads every public page and script. */
{
  const retiredControls = new Set(Object.values(reg.screens).filter((s) => s.retired && s.alias_of).map((s) => s.code));
  const back = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return walk(f);
    if (!/\.(html|js)$/.test(e.name)) return;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/data-cbsid=["']([A-Z]{3}[0-9]{3}-[A-Z][0-9]{2,3}|CTL[0-9]+)["']/g)) if (retiredControls.has(m[1])) back.push(m[1] + ' in ' + path.relative(process.cwd(), f));
  });
  walk(path.join(__dirname, '..', 'public'));
  ok('no retired control code is on an element (' + retiredControls.size + ' retired)' + (back.length ? ': ' + back.slice(0, 4).join(' · ') : ''), back.length === 0);
}

/* ⚠️ THE SHAPE IS THE STANDARD: three letters, three digits, six characters. A code that does not fit is a code
   somebody typed by hand into a register that is supposed to be generated. */
const wrong = rows.filter((r) => !/^[A-Z]{3}[0-9]{3}$/.test(r.code)).map((r) => r.code);
ok('every code is AAA### — three letters, three digits' + (wrong.length ? ': ' + wrong.join(' · ') : ''),
   wrong.length === 0);

/* ⚠️⚠️ THE RULE THE WHOLE DESIGN RESTS ON: one code, one screen, for ever. */
const seen = {}, dup = [];
rows.forEach((r) => { if (seen[r.code]) dup.push(r.code); seen[r.code] = r.path; });
ok('no code is claimed by two screens' + (dup.length ? ': ' + dup.join(' · ') : ''), dup.length === 0);

/* the panel and the app both read this — if the lookup by nav key is empty, the code never appears on a screen */
ok('screens are reachable by nav key, or the code can never be shown on the screen it names',
   Object.keys(CB.byNav || {}).length > 10);

/**
 * ── ⚠️⚠️ THE DECLARED SUB-VIEWS MUST STILL BE WHAT THE APP CALLS THEM ────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"the detail page should be having the screen name?"* — it was showing the code of the LIST
 * he had left, because opening a chit does not change the nav key. The fix reads `_fineScreen()`, which has
 * always distinguished `chit-detail`, `chit-messages` and the three cockpits.
 *
 * ⭐ Those five rows are the only DECLARED ones in the register — every other screen is derived from the live
 * rail. ⚠️ So they are the only ones that can quietly stop matching the product: rename a branch inside
 * `_fineScreen()` and the register keeps describing a screen the app no longer has, with nothing to say so.
 */
{
  /* ⚠️ read here rather than assumed: this file guards two registers and had no app.html to hand */
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  const reg2 = JSON.parse(fs.readFileSync(REG, 'utf8'));
  /* ⭐ `sub` is stamped by screens.cjs on every declared sub-view, wherever it is filed — a chit detail lives
     under DTL because it is SHARED, a product detail under CAT because the catalogue owns it, and neither
     placement is something this guard should have to know about. */
  const subs = Object.entries(reg2.screens).filter(([, v]) => v.sub && !v.retired && v.nav);
  ok('the register declares the sub-views (' + subs.length + ')', subs.length >= 4);
  const orphan = subs.filter(([, v]) => app.indexOf("'" + v.nav + "'") < 0).map(([k, v]) => v.nav + ' (' + v.code + ')');
  ok('every declared sub-view is a name _fineScreen() still returns'
     + (orphan.length ? ': ' + orphan.join(' · ') : ''), orphan.length === 0);
  /* ⚠️ and the reverse: a sub-view the app returns and the register has never heard of shows NO code at all */
  const fine = app.slice(app.indexOf('function _fineScreen'), app.indexOf('function _screenChain'));
  const returned = [...fine.matchAll(/return\s*\(?[^;]*?'([a-z][a-z-]{3,})'/g)].map((m) => m[1]);
  const known = new Set(subs.map(([, v]) => v.nav).concat(['task']));
  const missing2 = [...new Set(returned)].filter((n) => !known.has(n) && n.indexOf('-') > 0);
  ok('no sub-view the app can report is missing from the register'
     + (missing2.length ? ': ' + missing2.join(' · ') : ''), missing2.length === 0);
}

/**
 * ── ⭐⭐⭐ ONE PLACEMENT, EVERYWHERE: ICON, SCREEN-ID, SCREEN NAME ────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"POP067 — the name comes before the screen number?"*, then *"everywhere it has to be
 * unique"*, then the rule itself: *"icon, screen-id, screen name."*
 *
 * ⚠️⚠️ FOUR STAMPS HAD DRIFTED INTO THREE ANSWERS — a screen read "📥 WRK003 Intake", a panel read
 * "PNL004 🧪 Test lab" and a dialog read "📋 Register POP067". Each fix had solved its own surface and none
 * of them looked sideways. Three placements is worse than one wrong one: a reader learns where to look on one
 * screen and is wrong on the next.
 *
 * ⚠️ THIS IS THE CHECK THAT KEEPS IT ONE. Not that the placement is correct — a source check cannot see a
 * rendered line — but that there is exactly ONE function deciding it, and that no stamp has quietly gone back
 * to inserting for itself. That is the shape of the fault, so that is what is guarded.
 */
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  ok('there is exactly one function that places a code',
     app.split('function placeCodeTag(').length - 1 === 1);
  /* the four surfaces: screen heading, panel title, detail title, dialog title */
  const calls = app.split('placeCodeTag(').length - 2;   /* minus its own definition */
  ok('all four stamps go through it (' + calls + ')', calls === 4);
  /**
   * ⚠️ AND NONE OF THEM INSERTS ITS OWN TAG ANY MORE. `insertBefore(tag` outside the placer is how a fifth
   * answer gets in — it is what each of the three wrong ones looked like before this.
   */
  /* ⚠️ counted OUTSIDE the placer, not against a magic total: three of these live inside placeCodeTag itself
     (the split, the no-icon path, its catch) and counting them all just encodes today number. */
  const fi = app.indexOf('function placeCodeTag(');
  const fj = app.indexOf('function screenHeadEl(', fi);
  const outside = app.slice(0, fi) + app.slice(fj);
  const own = outside.split('insertBefore(tag').length - 1;
  /* the one that remains is the loose line: a screen whose title cannot be identified at all */
  ok('no stamp places its own tag outside the placer (' + own + ')', own <= 1);
}

/**
 * ── ⭐⭐ EVERY PANEL HAS A NAME, AND THE PRODUCT IS ASKED, NOT THE REGISTER ───────────────────────────────────
 *
 * Athi, 2026-09-12: *"now the same way each panel has to get the name."*
 *
 * ⚠️ THE REGISTER AGREEING WITH ITSELF PROVES NOTHING. The question is whether a panel that EXISTS has a code
 * — so the panels are found in the source the same way screens.cjs finds them, and the register is checked
 * against that. A panel added next month fails this line rather than shipping unnamed.
 */
{
  const pub = path.join(__dirname, '..', 'public');
  let srcs = [];
  try {
    srcs = ['app.html'].concat(fs.readdirSync(path.join(pub, 'app'))
      .filter((f) => f.endsWith('.js')).map((f) => 'app/' + f));
  } catch (_) {}
  const found = {};
  for (const f of srcs) {
    let src = '';
    try { src = fs.readFileSync(path.join(pub, f), 'utf8'); } catch (_) { continue; }
    for (const fn of ['makeMovable(', 'modal(']) {
      let i = 0;
      while ((i = src.indexOf(fn, i)) >= 0) {
        const m = src.slice(i, i + 300).match(/key:\s*'(cb_[A-Za-z0-9_]+)'/);
        if (m && m[1].indexOf('cb_mv_') !== 0) found[m[1]] = f;
        i += fn.length;
      }
    }
  }
  const keys = Object.keys(found);
  const byPanel = CB.byPanel || {};
  const unnamed = keys.filter((k) => !byPanel[k]);
  ok('every panel in the source has a code (' + keys.length + ')'
     + (unnamed.length ? ': ' + unnamed.join(' · ') : ''), keys.length > 0 && unnamed.length === 0);
  ok('every panel code is AAA### like the rest',
     Object.values(byPanel).every((c) => /^[A-Z]{3}[0-9]{3}$/.test(c)));
  /* ⚠️ a panel and a screen sharing a code would make both meaningless */
  const screenCodes = new Set(rows.map((r) => r.code));
  const clash = Object.entries(byPanel).filter(([, c]) => {
    const r = rows.filter((x) => x.code === c)[0];
    return r && r.group !== 'Panel';
  }).map(([k, c]) => k + String.fromCharCode(61) + c);
  ok('no panel code is also a screen code' + (clash.length ? ': ' + clash.join(' · ') : ''),
     screenCodes.size > 0 && clash.length === 0);

  const app2 = fs.readFileSync(path.join(pub, 'app.html'), 'utf8');
  /* ⭐ ONE PLACE, and the guard says so: the stamp is inside makeMovable, which is the only function in the
     product that holds a panel and its key at the same moment. Five call sites would be five to forget. */
  ok('the stamp is inside makeMovable, not at the call sites',
     app2.indexOf('function stampPanelCode') > 0 && app2.indexOf('stampPanelCode(head, key)') > 0);
  /* ⚠️ a panel repaints its own header, which wipes the stamp — proved, not assumed */
  ok('the panel is watched, because its own repaint removes the code',
     app2.indexOf('function watchPanelHead') > 0);
}

/**
 * ── ⭐⭐⭐ THE RULE ATHI CHOSE, GUARDED ───────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-12: *"follow the standard, so live by standard"* — and then, on what happens when the scheme
 * itself needs to change: *"we just need a reference; assuming we do an overhaul, as a bulk we can do the
 * overhaul and renumber according to that day."*
 *
 * Which is two rules, and the second is what makes the first affordable:
 *
 *   1. WITHIN AN EDITION a published code is never reused, whatever happens to the screen.
 *   2. A BULK RENUMBER IS A NEW EDITION — dated, with a crosswalk — never an edit of the old one.
 *
 * ⚠️ The failure this prevents is silent by construction: a reused code makes an old report READ CORRECTLY
 * and mean something false. Nothing throws. Nobody notices. So it is checked on every run instead.
 */
{
  const reg3 = JSON.parse(fs.readFileSync(REG, 'utf8'));
  const ed = reg3.edition || null;
  ok('the register declares which edition it is' + (ed ? ' (' + ed.n + ', since ' + ed.since + ')' : ''),
     !!(ed && ed.n >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(String(ed.since))));
  /* ⚠️ a code stored without its edition is a guess the day a second edition exists */
  ok('the browser is told the edition too', !!(CB.edition && CB.edition.n === (ed && ed.n)));

  const gone = Object.entries(reg3.screens).filter(([, v]) => v.retired);
  const liveCodes = new Set(Object.entries(reg3.screens).filter(([, v]) => !v.retired).map(([, v]) => v.code));
  const reused = gone.filter(([, v]) => liveCodes.has(v.code)).map(([, v]) => v.code);
  /**
   * ⚠️⚠️ THE ONE THAT MATTERS. ISO 3166 reserves a withdrawn country code for fifty years because CS was
   * reused — Czechoslovakia, then Serbia and Montenegro — and broke data in systems nobody could enumerate.
   */
  ok('no withdrawn code has been handed out again' + (reused.length ? ': ' + reused.join(' · ') : ''),
     reused.length === 0);

  /* ⭐ A GAP MUST BE ABLE TO ANSWER FOR ITSELF. Athi asked "which one is DTL002?" within hours of it being
     withdrawn, and a mute gap is the only thing that makes this rule expensive to live with. */
  /* the withdrawn list is filtered by the same predicate as the live rows */
  const goneKept = gone.filter(([, v]) => keeps(v));
  const mute = gone.filter(([, v]) => !v.retired_why).map(([, v]) => v.code);
  ok('every withdrawn code says why it went (' + gone.length + ')'
     + (mute.length ? ': ' + mute.slice(0, 4).join(' · ') : ''), mute.length === 0);
  ok('the withdrawn codes reach the browser, so the question can be asked there',
     Array.isArray(CB.withdrawn) && CB.withdrawn.length === goneKept.length);

  /* the lookup itself, driven rather than read: it is the thing a person actually uses */
  let answered = null;
  try { answered = sandbox.window.cbScreenBy(goneKept.length ? goneKept[0][1].code : 'NONE00'); } catch (_) {}
  ok('a withdrawn code still resolves, and says it names nothing now',
     !goneKept.length || !!(answered && answered.live === false && answered.why));
}

/**
 * ── ⚠️ THE THREE WAYS THE STAMP HAS ALREADY GONE WRONG ───────────────────────────────────────────────────────
 *
 * Every one of these shipped, passed every guard there was, and was found by opening the app and looking:
 *
 *   1. the heading was picked with `querySelector('.sec, h1, h2, b')`, which is not a priority list -- it
 *      returns the first match in DOCUMENT ORDER, so on Intake the code was painted into a sentence:
 *      "A message is a WRK003 notice".
 *   2. the detail title was asked for as `.dh .dt`; design 2 writes `.dt` with no `.dh`, so the one screen
 *      that had just been given its own code was the one screen not showing it.
 *   3. `UI.chit2` was read as "design 2 is on screen" when it is really "the last chit read that way", and it
 *      is never cleared -- so a product detail was headed DTL006, a chit that had left the page.
 *
 * ⚠️ THESE ARE SOURCE CHECKS AND THEY PROVE LESS THAN THEY LOOK: they show the fix is still written, not that
 * the code appears on the screen. Only opening the app proves that. They are here so a later edit cannot
 * quietly undo a fix that cost an hour to find.
 */
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  ok('the heading is found by what it says, not by the first bold word',
     app.indexOf('function screenHeadEl') > 0 && app.indexOf(".querySelector('.sec, h1, h2, b')") < 0);
  ok('the detail title is not required to sit in a .dh -- design 2 has none',
     app.indexOf(".querySelector('#detailpane .dh .dt')") < 0
     && app.indexOf(".querySelector('#detailpane .dt')") > 0);
  ok('design 2 is only reported while its own chit is open',
     app.indexOf("U.chit2 && U.sel && U.chit2 === U.sel") > 0);
  ok('the pane is watched, so a painter nobody has written yet still gets a code',
     app.indexOf('function watchDetailPane') > 0);
}

/**
 * ── ⭐ THE ASSET REGISTER, UNDER THE SAME RULES ───────────────────────────────────────────────────────────────
 *
 * ASSETS.json is the software half (ITIL 4 SACM · ISO/IEC 19770) and public/app/assets.js is its generated copy.
 * ⚠️ The same rot applies as to the screens: a generated file nobody regenerates keeps the app working while it
 * shows last week's truth — and a register is exactly the thing people stop double-checking.
 */
const AREG = path.join(DEV, 'ASSETS.json');
const AJS = path.join(__dirname, '..', 'public', 'app', 'assets.js');
if (fs.existsSync(AREG)) {
  ok('the asset register has a browser copy', fs.existsSync(AJS));
  if (fs.existsSync(AJS)) {
    const w = {};
    try { new Function('window', fs.readFileSync(AJS, 'utf8'))(w); }
    catch (e) { fails.push('assets.js does not evaluate: ' + e.message); }
    const A = (w.CBASSETS && w.CBASSETS.rows) || [];
    const areg = JSON.parse(fs.readFileSync(AREG, 'utf8'));
    const aliveA = Object.values(areg.assets || {}).filter((x) => !x.retired);
    ok('every live asset reaches the browser (' + aliveA.length + ')', A.length === aliveA.length);
    ok('every asset code is AAA### too', A.every((x) => /^[A-Z]{3}[0-9]{3}$/.test(x.code)));
    /**
     * ⚠️⚠️ THE LINK IS THE WHOLE POINT OF THE REGISTER. If it ever reads zero the chain is broken — and broken
     * silently, because every row still renders and only the last column goes quiet.
     */
    ok('screens are linked to the capability that draws them',
       Object.keys((w.CBASSETS && w.CBASSETS.drawnBy) || {}).length > 10);
    /* ⭐ the lifecycle is REPORTED, never assumed: a register where everything said "tested" without any file
       declaring it would mean the reader had started guessing on our behalf. */
    ok('the lifecycle stage is only ever what a file declared',
       A.every((x) => x.stage === null || /^[a-z][a-z-]*$/.test(x.stage)));
  }
}

if (fails.length) {
  fails.forEach((f) => console.error('  ✗ ' + f));
  console.error('\n  Run `node C:\\dev\\screens.cjs` and `node C:\\dev\\assets.cjs`, then commit — the copies have parted.\n');
}
if (!fails.length) console.log('\n  ' + pass + ' passed\n');
process.exit(fails.length ? 1 : 0);
