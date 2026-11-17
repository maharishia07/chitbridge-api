/**
 * till-all.cjs — RUN EVERY COUNTER HARNESS, AND SAY ONE NUMBER.
 *
 * Athi, 2026-09-19: *"tonight you can run the playwright script"* → *"chain them into one script"*.
 *
 * The counter now has a harness per thing that has gone wrong on it, and the way to run them was to remember
 * fourteen filenames. This is the same shape as `chitbridge-api/scripts/guards.cjs` and for the same reasons.
 *
 * ⚠️⚠️ A DECLARED LIST, NOT A GLOB. `till-*.cjs` would also pull in the SHOT-ONLY files — till-demo seeds a
 * shop, till-render and till-modes exist to produce pictures — and a runner that reports red for the wrong
 * reason gets ignored within a week, after which it is reporting nothing. Everything below is here because
 * somebody chose it, with a line saying what it defends. `--shots` runs the picture ones too.
 *
 * ⚠️⚠️⚠️ AND IT DOES NOT TRUST EXIT CODES. Eleven of the twenty-one counter harnesses print "✗ FAILED" and
 * then exit 0 — they were written to be read by a person, not by a runner. A chain that believed the exit
 * code would have reported green over a real failure, which is the one thing a nightly run must never do.
 * So a harness fails here if ANY of these is true:
 *     the exit code is not 0
 *     the output contains a failure mark
 *     the output contains no success mark at all  ← "it said nothing" is a failure, not a pass
 * [[feedback-silence-is-the-bug]] [[feedback-whitelist-drops-silently]]
 *
 *   node e2e/till-all.cjs            the asserting set
 *   node e2e/till-all.cjs --shots    also the ones that only take pictures
 *   node e2e/till-all.cjs --only fits   just the ones whose name contains "fits"
 *   node e2e/till-all.cjs --bite    prove the runner still catches the three ways to fail
 */
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const HERE = __dirname;

/** what each one defends — every line is a thing that has actually gone wrong on this counter */
const HARNESSES = [
  ['till-fits.cjs',        'the counter fits its screen and nothing overlaps, at every shape and height'],
  ['till-hub-shape.cjs',   'one hub, one shape per width — no empty panel beside a floating card'],
  ['till-hub-look.cjs',    'every hub section has a hue of its own, and the strip agrees with it'],
  ['till-menu-steady.cjs', 'the hub holds its place when a section opens (it once jumped 1367px)'],
  ['till-overlay-dialog.cjs', 'the Menu and Check overlays are native modal dialogs: keyboard open, Tab kept inside, Esc closes, focus returns'],
  ['till-style-shot.cjs',  'the style preview shows the WHOLE screen — five settings used to change nothing'],
  ['till-keysize.cjs',     'the preview counts the keys the counter actually fits, exactly, at 16 combinations'],
  ['till-apply-again.cjs', 'apply works again and again, and a held change says so'],
  ['till-catorder.cjs',    'one category order, and the shop sets it'],
  /* ⭐⭐⭐ "MOST USED FIRST" IS A LIVE MODE (design-handoff/02-category-order §2/§5, Phase 4.6) — real
     30-day sales rank, not product count; switching to a fixed order freezes exactly what was showing. */
  ['till-category-mostused.cjs', 'most used first is real 30-day sales, and switching to a fixed order freezes exactly what was showing'],
  /* ⭐⭐⭐ HIDING A CATEGORY (Phase 4.3) — leaves the chips and the keys, ungrouped and grouped, and nothing
     else: search still sells it. The risk the item names by itself, driven end to end through the real
     dialog, Save, and back again with Show. */
  ['till-category-hide.cjs', 'a hidden category leaves the chips and the keys and nothing else — search still sells it'],
  ['till-combo.cjs',       'the combo chooser answers the real 1-9 keys'],
  ['till-modedit.cjs',     'a combination can be changed on the bill, and the money follows'],
  ['till-dayimg.cjs',      'the shop’s own picture is resized, kept, shown — and a refusal is said'],
  ['till-shelf-row.cjs',   'nothing in a shelf row wraps onto its own line'],
  /* ⭐⭐ THE TWO DIMENSIONS THE COUNTER HAD NEVER BEEN RUN IN ([TILL-103], [TILL-104]). Every other harness
     here seeds currency:'INR' and a tiffin shop — so 'the till works' has only ever meant 'in rupees, for a
     hotel'. Athi: *'if we change the currency, does the till behave correctly… we have to ensure end to end
     hotel is working and end to end veg shop is working.'* */
  ['till-currency.cjs',    'the counter bills in AED, USD and JPY — and yen carries no minor unit'],
  ['till-verticals.cjs',   'one counter, two trades: plates counted, vegetables weighed'],
  /* ⭐⭐ THE FRONT DOOR ([TILL-105]). A shop setting itself up from the counter — validated where it is typed,
     then synced. Athi: *'counter has no password, use the till key alone for the time being.'* */
  ['till-shopedit.cjs',    'the counter sets up its own shop, checks the GSTIN, and refuses what it may not set'],
  /* ⚠️⚠️⚠️ THE ONE THE WHOLE PITCH RESTS ON ([TILL-106]). Every other harness here serves the page from a
     RUNNING server, so 'works offline' was an assertion for as long as the counter has existed. This one stops
     the server dead and opens the page again. Athi: *'do the cold offline harness first.'* */
  ['till-cold.cjs',        'with the server stopped: it opens, prices, numbers a bill and banks it'],
  ['till-blank.cjs',       'a counter connected to nothing says so — and never that everything arrived'],
  ['till-pair.cjs',        'a blank counter signs in, gets its key, and two shops never share a folder'],
  ['till-summary.cjs',     'day, week and month summary chits — folded, sent, and stamped only when they land'],
  ['till-purge.cjs',       'the 90-day floor: old detail goes, the summary stays, and an unsent bill holds its day'],
  ['till-rollup-page.cjs', 'the page, the program and the server agree on what a day took'],
  ['till-ready.cjs',       'an unready counter says so, and signing out never strands a sale'],
  /* ⭐⭐ THE LINE, TURNED DOWN ON PURPOSE ([TILL-116]). Athi: *'switch off network, reduce the speed to 2g
     and so on, so we can see how it works.'* Faithful because navigator.onLine is overridden too — almost
     every belief/gate now asks lineUp() (Phase 4.1) rather than the flag directly, but lineUp() still bottoms
     out on it, so a simulator that only slowed fetch would still leave the whole page fooled. */
  ['till-netsim.cjs',      'the line can be turned down, and it says so while it is'],
  /* ⭐⭐⭐ PHASE 4.7 — pretending is loud, timed and reversible: a real countdown that always ends on its
     own, held while a bill is in hand, and "Full speed" IS Stop, not a second control beside it. */
  ['till-netsim-autostop.cjs', 'pretending is loud, timed and reversible — it cannot be left on'],
  /* ⭐⭐⭐ PHASE 4.8 — "columns may change on a turn; shape and size must not." A turn-and-back never
     crosses the two-second grace window; a genuine, held remount still re-decides with no reload. */
  ['till-shape-stable.cjs', 'shape and size hold through a turn, and still re-decide themselves once a move genuinely sticks'],
  /* ⭐⭐⭐ THE LINE, BELIEVED FROM WHAT GOT THROUGH ([TILL-151]/Phase 4.1). navigator.onLine can say "online"
     for ever on wifi with a dead upstream link — this proves lineUp() catches that where the flag alone
     never would, and that a real interface drop still overrides a good recent run. */
  ['till-lineup.cjs',      'the line is judged by what got through, not by the interface'],
  ['till-selfheal.cjs',    'the line went, the shop kept selling, and the counter put itself right'],
  ['till-bell.cjs',        'a quiet bell is told from a dead one, and rebuilt by itself'],
  ['till-offers-live.cjs', 'a live offer reaches the next bill, never the open one; the bar says so; offline keeps the last list'],
  ['till-confirm.cjs',     'the caution travels with the action, and carries the numbers'],
  ['till-devbar.cjs',      'the ribbon names the screen, frames the size, and times the line'],
  ['till-orderpad.cjs',    'the pad holds many orders open, and a billing shop never sees it'],
  /* ⭐⭐⭐ ADD WORKED, REVIEW AND CLOSE DID NOT ([TILL-187]). Athi: *"in the table option, i could add item
     to the tables, but not able to review or close the table."* Drives the real "+"/"=" buttons a waiter
     presses, not the engine functions orderpad.cjs already proved correct — the wiring between them was the
     actual gap. */
  ['till-order-review-close.cjs', 'a table can be added to, reviewed, and closed — all from the screen'],
  /* ⭐⭐⭐ THE FLOOR, PROVED ([TILL-178b]). Athi: *"how do we prove without internet the entire cycle works,
     as a local network?"* Three browser contexts — a waiter's phone, a kitchen screen and a till — run a whole
     table with every request to the cloud aborted at the network layer and counted. The last line it prints is
     the count, and the count is zero. */
  /* ⭐⭐ THE MORNING ([TILL-182]). It reads the WORDS on the screen, not the state behind them — a counter
     that settles everything silently would pass any test written against state alone, and silence is exactly
     what Athi objected to. */
  ['till-morning.cjs',     'the counter sets itself up out loud, names its number, and stops when somebody else holds it'],
  /* ⭐⭐ THE VEG SHOP'S SCALE ([TILL-185]). The decoding is proved without a browser; what is proved here is
     that a DAMAGED label and an UNKNOWN item code stop the counter and say so, which is what the page-side
     reader used to get wrong by returning null and falling through to the ordinary product search. */
  ['till-scale.cjs',       'the scale is read, the wrong label is refused out loud, and an ordinary barcode is untouched'],
  ['till-lan.cjs',         'three devices ran a whole table — seated, fired, cooked, billed — and not one byte left the shop'],
  /* ⭐⭐⭐ THE FRONT DOOR ([TILL-107]) — and the first block of it is where AXIOM = name + price came from:
     strip a product field by field and see where the counter stops being able to sell. */
  ['till-catalogue.cjs',   'the axiom, the two trades, and a shop that opens and sells'],
  /* ⚠️⚠️ THE REPORT IS THE FEATURE ([TILL-108]). csv-preflight exists because the old import mapped headers
     silently and made Rate / Price (INR) / price into three different fields. A screen that did the same behind
     a progress bar would rebuild that bug, so what is asserted is what it ASKS and what it REFUSES. */
  ['till-upload.cjs',      'a product list read before it becomes data, and approved a column at a time'],
  ['till-settings.cjs',    'no visual control has two homes'],
  /* ⭐⭐⭐ EVERY ROW SAVES ITSELF ([TILL-187], Phase 4.2). The printer, the counter key and the ChitBridge
     address were the last three staged until Close in one batched saveSettings() — proves each now saves on
     change, before Close is ever pressed, and that the counter key saves on change (blur/Enter) and never on
     a keystroke, or DB.reopen()+S=null would fire on a key half typed. */
  ['till-settings-perrow.cjs', 'everything saves as you change it, and closing loses nothing'],
  /* ⭐⭐⭐ SETTINGS DECLUTTERED (design-handoff/04-settings §3, 00-CORRECTIONS.md #18, Phase 4.5). Quick keys
     and the shop's tax block are one line each with a link out, and "Clear and reload" has left Settings
     entirely — its only home is Counter health's confirm sheet. */
  ['till-settings-declutter.cjs', 'Quick keys and the shop are one line each in Settings, and Clear and reload has left it entirely'],
  /* ⭐ OFFER LAB, ONE LINK OUT OF THE TILL ([TILL-187]). Proves the op opens the real page in a new tab with
     no fragment (Offer Lab authenticates a person, never a paired counter's key) and never touches MODE/CART. */
  ['till-labs-link.cjs', 'Offer Lab and Combo Lab are one link each out of the till, never a second implementation inside it'],   /* renamed from till-offerlab-link.cjs at the Labs split, 2026-09-26 */
  ['till-todo.cjs',        'the to-do is one list, and it never asks the browser for permission'],
  ['till-category.cjs',    'categories are shown the way quick keys are'],
  ['till-contrast.cjs',    'the counter’s own palette, measured'],
  ['till-pay-shot.cjs',    'pay is a card that comes to you, and there is still one way to take money'],
  /* ⭐⭐⭐ BOOKS v2 (2026-09-29): Athi — "we are running offline and we have to have a bullet proof system". */
  ['till-books-offline.cjs', 'a day at two counters taken OFFLINE arrives exactly once, balanced to the paisa; late bill = supplementary; restart and replay lose and double nothing'],
];

/**
 * ⭐⭐ BREAK IT BEFORE TRUSTING IT. Three files that fail in the three ways that matter, kept in the repo so
 * --bite can prove this runner still notices. The middle one is the reason the runner exists: it prints
 * ✗ FAILED and exits 0, exactly like eleven of the real harnesses.
 * [[feedback-whitelist-drops-silently]]
 */
const BITE = [
  ['bite/says-failed.cjs',  'prints ✗ FAILED and exits 0'],
  ['bite/says-nothing.cjs', 'prints nothing and exits 0'],
  ['bite/not-here.cjs',     'is on the list and not on disk'],
];

/** ⚠️ these produce PICTURES and assert nothing — useful, and not a pass/fail signal. --shots includes them. */
const SHOTS = [
  ['till-maint-shot.cjs',  'the maintenance screen, drawn'],
  ['till-panels-shot.cjs', 'the panel presets, drawn'],
  ['till-modes.cjs',       'each operation, drawn'],
  ['till-render.cjs',      'the day close, drawn'],
];

/**
 * ⚠️⚠️ "SAID NOTHING" MEANS NOTHING, NOT "did not use my words". The first cut looked for OK / ok / wrote
 * and reported till-keysize as silent — a harness that had just printed sixteen lines of "agree" and ended
 * with "all sixteen: the preview counts what the counter counts". A runner that demands a house style will
 * fail the one harness that writes plainly, and the fix is not a longer word list: it is to ask the honest
 * question, which is whether the process produced any output at all.
 */
const FAILED = ['✗', 'FAILED', 'MISS ', 'AMBIGUOUS ', 'DISAGREE', 'threw:', 'Error:', 'error TS'];

const args = process.argv.slice(2);
const only = (args.indexOf('--only') >= 0) ? args[args.indexOf('--only') + 1] : null;
const list = HARNESSES.concat(args.indexOf('--bite')>=0?BITE:[]).concat(args.indexOf('--shots') >= 0 ? SHOTS : [])
  .filter((h) => !only || h[0].indexOf(only) >= 0);

if (!list.length) { console.log('nothing matches --only ' + only); process.exit(1); }

console.log('─ the counter, end to end ─ ' + list.length + ' harnesses\n');
const started = Date.now();
const bad = [];
for (const [file, what] of list) {
  const full = path.join(HERE, file);
  /* ⚠️ A MISSING FILE IS A FAILURE, NOT A SKIP. A renamed harness that quietly stops running is how a guard
     dies without anybody noticing — the same reason guards.cjs declares its list. */
  if (!fs.existsSync(full)) {
    console.log('  ✗ ' + file.padEnd(24) + 'NOT FOUND — renamed or deleted, and still on the list');
    bad.push([file, 'not found', '']); continue;
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [full], { cwd: HERE, encoding: 'utf8', timeout: 5 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const said = out.trim().length > 0;
  const cried = FAILED.some((m) => out.indexOf(m) >= 0);
  const why = r.status !== 0 ? ('exit ' + r.status) : cried ? 'said FAILED' : !said ? 'said nothing at all' : '';

  if (why) {
    console.log('  ✗ ' + file.padEnd(24) + secs.padStart(5) + 's  ' + why);
    bad.push([file, why, out]);
  } else {
    /* the harness's own last sentence — each one ends by saying what it proved */
    const lines = out.trim().split(/\r?\n/).filter((l) => l.trim());
    console.log('  ok ' + file.padEnd(24) + secs.padStart(5) + 's  ' + (lines[lines.length - 1] || what).trim().slice(0, 62));
  }
}

const took = ((Date.now() - started) / 1000).toFixed(0);
console.log('\n  ' + '─'.repeat(58));
if (!bad.length) {
  console.log('  ' + list.length + ' harnesses · ' + took + 's · all passed\n');
  process.exit(0);
}
/* ⚠️ THE OUTPUT OF WHAT FAILED, not just its name — a runner that says "3 failed" and nothing else sends
   somebody back to run all three by hand, which is what this script exists to stop. */
console.log('  ' + list.length + ' harnesses · ' + took + 's · ' + bad.length + ' FAILED\n');
for (const [file, why, out] of bad) {
  console.log('── ' + file + ' — ' + why + ' ' + '─'.repeat(Math.max(0, 50 - file.length)));
  const lines = out.trim().split(/\r?\n/);
  const marked = lines.filter((l) => FAILED.some((m) => l.indexOf(m) >= 0));
  (marked.length ? marked : lines.slice(-12)).slice(0, 14).forEach((l) => console.log('   ' + l.trim()));
  console.log('');
}
process.exit(1);
