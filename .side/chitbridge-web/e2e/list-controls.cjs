#!/usr/bin/env node
/**
 * ── ⭐⭐⭐ THE WATCHER — every list screen offers the same five controls ──────────────────────────────────────────
 *
 * Athi, 2026-09-14, after finding search silent and the list truncated at 100 for the third time:
 *
 *   *"create a watcher and check all those have been handled every time when you are writing the control. this
 *    becomes very bad. i could have worked with human engineers — once I say, they follow and no drift. here my
 *    fingers are paining."*
 *
 * He is right, and the fault is not that any one of these was hard. It is that he had to say it again for each
 * new panel: *"almost every panel is missing this information"* (2026-09-14), *"we need to have a sort mechanism
 * based on field like we have it in the task"*, *"it has to be lazy loaded"*, *"search also not working?"*.
 *
 * ⭐ A RULE HE HAS TO RESTATE IS NOT A RULE. This file is where it gets stated once.
 *
 * ── THE FIVE ───────────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   search    an input that filters the list, and it must be LIVE (oninput). Enter-only is how "search is
 *             broken" happens: the box accepts typing and the list does not move, with nothing saying why.
 *   filters   at least one <select> — a list you cannot narrow is a list you scroll.
 *   sort      a sort control. "most recent, most oldest, whatever" — Athi, 2026-09-14.
 *   paging    page numbers, or an onscroll that loads more. A list that stops at its limit and says
 *             "100 of 2,259" is reporting a number it cannot reach.
 *   count     a line that says how many matched, not how many fitted.
 *
 * ⭐ AND IF IT RENDERS A <table>, four more — see TABLE_CONTROLS below.
 *
 * ── ⚠️⚠️ WHY THIS IS A RATCHET AND NOT A PASS/FAIL ──────────────────────────────────────────────────────────────
 *
 * Turned on as a flat rule it would fail a dozen screens at once, and a guard that is red on arrival gets
 * skipped — which would leave Athi exactly where he started, only with an extra file. So the CURRENT gaps are
 * recorded in BASELINE below and the rule is:
 *
 *     a screen may never LOSE a control it has, and a screen not in BASELINE must have all five.
 *
 * The number can only go down. Every run prints what is still outstanding, so the debt is visible rather than
 * remembered. When a line reaches zero gaps, delete it — the guard then holds that screen to all five forever.
 *
 * ── ⭐⭐⭐ AND AS OF 2026-09-15 BASELINE IS EMPTY. 55 → 47 → 0. ──────────────────────────────────────────────────
 *
 * Every list screen now has all five, so the rule is no longer a ratchet with exceptions — it is simply the
 * rule. **Do not add a name back without Athi.** A line here is a decision to ship a panel he will have to ask
 * about, and the whole point of reaching zero is that the next one is caught before it ships, not after he
 * finds it.
 *
 * ⚠️⚠️ AND "0 GAPS" MEANS NOTHING UNLESS REMOVING A CONTROL FAILS THE RUN, which was checked by removing one
 * from four screens: customers' sorts, customers' filters, the catalogue's sort control, intake's filters and
 * disputes' lazy rows. The first attempt reported all of them SILENT — because the breaks were too weak, not
 * because the guard was. Two of them genuinely were silent and are fixed (see `filters` below). All five fire.
 *
 * ⚠️ THREE TIMES THIS FILE HAS BEEN WRONG ABOUT WHAT IT IS READING, and each time it invented debt rather than
 * missing it: the four table habits demanded of a passport and a markdown renderer; the five controls demanded
 * of fixed rails and a loading spinner; and a screen read as only its own body when half this app paints
 * through a loader. A guard that cries wolf is on its way to being ignored, which is the same end state as no
 * guard at all. [[feedback-silence-is-the-bug]]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const FILES = [path.join(ROOT, 'app.html')].concat(
  fs.readdirSync(path.join(ROOT, 'app')).filter((f) => f.endsWith('.js')).map((f) => path.join(ROOT, 'app', f)));

/**
 * ── what a screen must offer, and how to see it in the source ──────────────────────────────────────────────────
 *
 * ⭐ A HELPER NAME IS A LEGITIMATE DETECTOR, and this file has always worked that way — `PagerHTML`, `CountHTML`
 * and `sortPresetSelect` are all somebody else's function. `app/list-ctl.js` is the newest of them: it holds the
 * five controls for a list the browser already has, so a screen that calls it has them.
 *
 * ⚠️ AND THE CONFIG IS WHAT IS CHECKED, NOT THE CALL, for the two that are optional. `listCtlToolbarHTML` always
 * draws a search box, so calling it proves search. It draws filters and sorts only if it was GIVEN some — so
 * those look for `filters: [{` and `sorts: [{` in the screen's own declaration, which is where a screen says
 * what a customer may be narrowed and ordered by. An empty `filters: []` matches neither, on purpose.
 */
const CONTROLS = {
  /* ⚠️ oninput, not onkeydown. The Platform search accepted Enter and nothing else for a day. */
  search:  (b) => /listCtlToolbarHTML\(/.test(b)
                  || (/placeholder="[^"]*[Ss]earch|id="[a-z]{2}_q"|data-testid="[a-z-]*search/.test(b)
                      && /oninput=/.test(b)),
  /**
   * ── ⚠️⚠️ THE ONE DETECTOR THAT COULD NOT BITE, AND HOW FAR IT IS SAFE TO FIX TODAY ────────────────────────────
   *
   * `<select>` ANYWHERE in the screen and its helpers satisfied this — including one in the DETAIL pane. So
   * deleting the customers filters entirely still passed, on the strength of the group picker on a customer
   * card; deleting intake's passed on the channel dropdown in its "record a message" form. Found by removing
   * them and watching the guard stay green, with BASELINE empty and nothing else left to catch it.
   *
   * ⭐ THE PART THAT NEEDS NO DECISION: a screen that uses `app/list-ctl.js` has DECLARED what its list may be
   * narrowed by, so for those screens the declaration is the answer and a stray `<select>` elsewhere is not.
   * That closes the hole on customers, suppliers, intake and disputes, and changes no verdict — all four
   * declare filters today. Both breaks now fire.
   *
   * ⚠️ THE PART THAT IS ATHI'S CALL, AND IS IN THE BACKLOG: for a screen NOT on the engine, `<select>` anywhere
   * still counts. Tightening that would record a NEW gap against `categoriesScreen`, which has a search but no
   * filter — and this file's own rule is that adding a name to BASELINE is a decision to take with him.
   */
  filters: (b) => (/listCtlToolbarHTML\(/.test(b)
                    ? /\bfilters\s*:\s*\[\s*\{/.test(b)
                    : (/<select/.test(b) || /\bfilters\s*:\s*\[\s*\{/.test(b))),
  sort:    (b) => /pl_sort|sortPresetSelect|data-testid="[a-z-]*sort|onchange="[a-zA-Z]*[Ss]ort/.test(b)
                  || /\bsorts\s*:\s*\[\s*\{/.test(b),
  /* ⚠️ EITHER SHAPE COUNTS. Athi asked for page numbers on the Platform screen, not an endless scroll:
     *'give the page numbers so the next page can be moved.'* A detector that only knows about onscroll would
     have failed the screen for doing the better thing. What matters is that the list can REACH its total. */
  /**
   * ⚠️⚠️ AND `lazyWrap` IS THE THIRD SHAPE, which this file did not know — so it was recording a gap against
   * the catalogue and the disputes list, both of which have had a working lazy renderer since August.
   * `lazyWrap(id, items, cardFn)` draws 50, reveals the rest on an IntersectionObserver AND on a *"↓ Show 50
   * more"* button, and prints *"50 of 812"* and *"812 total · end of list"* in its own sentinel. It reaches the
   * total, which is the whole question. ⭐ Found while building `app/list-ctl.js` — I wrote a second lazy
   * renderer before noticing the first, and this detector is the other half of undoing that.
   */
  paging:  (b) => /onscroll=|PagerHTML|data-testid="[a-z-]*page-|lazyWrap\(|listCtlRowsHTML\(/.test(b),
  count:   (b) => /CountHTML|listtotal|pgTotalText|of\s*'\s*\+/.test(b),
};

/**
 * ── ⭐⭐⭐ A SCREEN THAT MOUNTS A CBList (app/list-ctl.js) IS GIVEN THREE OF THE FIVE, AND MUST DECLARE THE OTHER TWO ───────────
 *
 * Athi, 2026-10-02: one list control everywhere. The unit's tools row carries SEARCH and the TRUE COUNT, and it draws 50 rows at a
 * time and reveals the rest (PAGING) — a page cannot forget them because it does not write them. What a page still writes is
 * WHAT TO NARROW BY and WHAT TO ORDER BY, so those two are held to the declaration exactly as they are for listCtl: `filters: [{`
 * and `sorts: [{`. A SERVER-paged mount (`remote:`) keeps the page's own filter bar, so a `<select>` is its filter.
 *
 * ⚠️ "MOUNTS" IS READ FROM THE SCREEN AND THE PAINTERS THAT FILL ITS HOLES, NOT TWO HOPS OUT: a catalogue that calls a helper that
 * calls a helper that repaints the Task rows has not become a CBList screen. [[feedback-silence-is-the-bug]]
 */
const UNIT_GIVES = {
  search: () => true,
  filters: (b) => /\bfilters\s*:\s*\[\s*\{/.test(b) || (/\bremote\s*:/.test(b) && /<select/.test(b)),
  sort: CONTROLS.sort,
  paging: () => true,
  count: () => true,
};
const judge = (s, k) => s.mount && UNIT_GIVES[k] ? UNIT_GIVES[k](s.body + '\n' + s.mount) : CONTROLS[k](s.body);

/**
 * ── ⭐⭐ AND WHAT A TABLE OWES ON TOP ────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"we have to have adjustable column headers and usual stuff, all cannot be explained."*
 *
 * ⭐ HE IS RIGHT THAT IT CANNOT BE EXPLAINED, AND THAT IS THE POINT OF WRITING IT DOWN ONCE. A data table is a
 * thing people already know how to use, and every habit it is missing costs him a sentence. These four are the
 * habits: sort by a heading, choose which columns, drag a heading wider, and get back to the default.
 *
 * ⚠️ ONLY SCREENS THAT ACTUALLY RENDER A <table>. A card list owes none of this, and holding it to "you must
 * offer column widths" would be noise — which is how a guard teaches people to ignore it.
 */
const TABLE_CONTROLS = {
  'sort by heading': (b) => /SortBy\(|onclick="[a-zA-Z]*[Ss]ortBy/.test(b),
  'column chooser':  (b) => /ToggleColMenu|colChooser|ColMenuHTML/.test(b),
  'resizable':       (b) => /ColResizeStart|colResizeStart|col-resize/.test(b),
  'reset to default':(b) => /ResetCols|resetCols/.test(b),
};

/**
 * ── THE DEBT, AS IT STOOD WHEN THE WATCHER WAS WRITTEN ─────────────────────────────────────────────────────────
 * screen → the controls it is ALLOWED to be missing. Shrink these; never grow them.
 * ⚠️ Adding a name here is a decision to ship a panel Athi will have to ask about. Do it only with him.
 */
/**
 * ── ⭐⭐⭐ NOT EVERY `<div class="rows">` IS A LIST ────────────────────────────────────────────────────────────────
 *
 * ⚠️⚠️ 18 OF THE 47 RECORDED GAPS WERE THIS FILE MISREADING ITS OWN RULE — for the second time. The earlier
 * miss was the four table habits demanded of a passport and a markdown renderer; this is the same mistake one
 * level up. The detector asks "does it render `class="rows"`", and four screens do while holding no records:
 *
 *   · `capScreen`               is the lazy-load DISPATCHER. When the real screen is loaded it delegates; when it
 *                               is not, it returns a SPINNER — and that placeholder is what carries the markup.
 *                               The guard was demanding paging of a loading message.
 *   · `settingsScreen`          a fixed rail built from `SET_SECS`, with sub-rows for the 7 governance layers.
 *   · `misScreen`               a fixed rail of `MIS_BANDS`; its own code says "FIVE FIXED ROWS".
 *   · `catalogueSetupHubScreen` its own code says "a fixed menu of seven and never needs more".
 *
 * ⭐ THE DIFFERENCE THAT MATTERS: a LIST holds records the shop can grow without limit, so it will one day be
 * longer than the screen and Athi will have to ask for search. A RAIL is a menu whose length is decided here, in
 * code. Paging a menu of five is not a missing control, it is a category error — and 18 phantom gaps buried the
 * 29 real ones, which is how a watcher stops being read.
 *
 * ── ⚠️ AND AN EXEMPTION LIST IS THE EASIEST THING IN THIS FILE TO ABUSE ────────────────────────────────────────
 *
 * So it is checked, every run, and each check can FAIL the guard — see the block below the loop. A name here
 * that is not a screen any more, a name that is also in BASELINE, or a rail that has grown a <table> all stop
 * the run. An exemption nobody re-tests is just a deletion with extra steps. [[feedback-silence-is-the-bug]]
 */
const NOT_A_LIST = {
  capScreen:
    'the lazy-load dispatcher — its "rows" is the LOADING SPINNER shown until the real screen arrives',
  settingsScreen:
    'a fixed rail of SET_SECS (plus the 7 governance layers as sub-rows) — a menu, not records',
  ledgerScreen:
    'a fixed rail of BK_TABS (ten views: day book, ledgers, trial balance …) — a menu, not records; each view is a dated report',
  misScreen:
    'a fixed rail of MIS_BANDS — its own comment reads "FIVE FIXED ROWS"',
  catalogueSetupHubScreen:
    'a fixed rail of CATSET_SECS — its own comment reads "a fixed menu of seven and never needs more"',
  /**
   * ⚠️ NOT A FIXED RAIL — A DESIGN SURFACE, which is a second reason to be exempt and worth naming separately.
   * The network screen has two modes and neither is a record list:
   *
   *   DESIGN  a tree of nodes the owner DRAWS — branches, depots, partners — plus the outstanding plan
   *           ("NEW …", "CHANGE …", *"Nothing above has happened yet"*). Its order IS the structure, so sorting
   *           it would not reorder rows, it would misstate the business. Filtering or paging it would hide part
   *           of a diagram whose whole point is to be seen entire.
   *   FIND    *"Where is it?"* — a QUERY across the network, grouped by product. The box IS the search; the
   *           rows are one answer to one question, bounded by the network, not a list that accumulates.
   *
   * ⭐ THE HONEST RESIDUE IS IN THE BACKLOG, not hidden here: a chain with 200 nodes would want to FIND a node
   * in its own design. That is a feature somebody should ask for, not one of the five standard controls, and
   * pretending this exemption covers it would be the rationalisation this category is most at risk of.
   */
  networkScreen:
    'a DESIGN SURFACE and a query result — its order is the structure, and hiding part of a diagram misstates it',
};

const BASELINE = {
  /* ⚠️ THIS IS THE DEBT, MEASURED 2026-09-14 — 12 of 13 list screens. It is the quantified version of Athi's
     *"almost every panel is missing this information"*, and it is not a licence: every line here is a panel he
     will eventually have to ask about. Shrink them. `settingsScreen` and `catalogueSetupHubScreen` are the two
     most likely to be legitimate exemptions (a settings page is a form, not a list) — check before fixing. */
  /* ⭐ TIGHTENED 2026-09-15. Five screens had quietly EARNED a control and the baseline still forgave it — so
     each could have lost it again without a word. A ratchet nobody tightens is a list of excuses. The guard
     prints "now HAS x — remove it from BASELINE" for exactly this; it had been printing it for five. */
  /**
   * ⚠️⚠️ THESE TWO OWED THE FOUR TABLE HABITS FOR A DAY AND NEVER SHOULD HAVE. The guard was expanding helpers
   * twice — three calls deep — and finding a <table> inside `viewSupplierPassport` (a read-only credentials
   * view), `misTax`/`misFriction` (summary bands of a handful of rows) and `_aiMd` (the MARKDOWN RENDERER for
   * an AI answer). None is a list anybody sorts. Eight of the 55 recorded gaps were the watcher misreading its
   * own rule, and I was one commit from building a column chooser onto a passport to satisfy it.
   *
   * ⭐ THE DEBT THAT IS LEFT IS REAL: search, filters, sort, paging, count. Those they genuinely owe.
   */
  /* ⭐ platformScreen is deliberately ABSENT — it has all five, and leaving it out is what holds it there. */
};

/* ── find the screens ─────────────────────────────────────────────────────────────────────────────────────── */
function blank(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const n = e < 0 ? src.length : e; out += ' '.repeat(n - i); i = n; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const n = e < 0 ? src.length : e + 2; out += src.slice(i, n).replace(/[^\n]/g, ' '); i = n; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1).replace(/[{}]/g, ' ');
      i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * ── ⚠️⚠️ A SCREEN IS NOT ONLY ITS OWN BODY ──────────────────────────────────────────────────────────────────────
 *
 * This guard checked the *Screen() function and nothing else, and it was WRONG in a way that made it agree with
 * broken screens: platformScreen() renders its table by calling platScopeTableHTML(), so the <table>, every
 * heading and every control lived in a function the guard never opened. Removing the resize handler changed
 * nothing it could see.
 *
 * ⭐ SO THE BODY IS THE SCREEN PLUS THE HELPERS IT CALLS, one level deep and same-file only. One level is
 * enough in practice (a screen calls its renderer; the renderer does the work) and stops well short of
 * inlining the entire file, which would make every rule pass on the strength of some unrelated code.
 */
function fnBodies(safe) {
  const map = new Map();
  const re = /function\s+([A-Za-z0-9_$]+)\s*\(/g;
  let m;
  while ((m = re.exec(safe))) {
    let i = safe.indexOf('{', m.index);
    if (i < 0) continue;
    let depth = 0, j = i;
    for (; j < safe.length; j++) {
      if (safe[j] === '{') depth++;
      else if (safe[j] === '}' && --depth === 0) break;
    }
    if (!map.has(m[1])) map.set(m[1], safe.slice(i, j + 1));
  }
  return map;
}

/**
 * ── ⭐⭐⭐ A SCREEN IS ALSO WHATEVER PAINTS INTO IT ────────────────────────────────────────────────────────────────
 *
 * ⚠️⚠️ THE THIRD TIME THIS FILE HAS BEEN WRONG ABOUT WHAT IT IS READING, and this one was invisible because the
 * screen it misjudged is a single line. `disputesScreen()` renders `<div id="disprows">loading…</div>` and
 * NOTHING else — every row, both counts and two `lazyWrap` calls live in `loadDisputes()`, which the call graph
 * never reaches because the screen does not call it. The screen just leaves a hole, and something else fills it.
 *
 * ⭐ THAT IS NOT A QUIRK OF DISPUTES, IT IS HOW THIS APP PAINTS. `paintCustList` → `#cu_rows`,
 * `paintSupList` → `#sup_rows`, `paintProdList` → `#ct_rows`, `loadDisputes` → `#disprows`. So: take every id
 * the screen renders, and fold in any same-file function that writes into one of them. The list a person sees
 * is the union of the two, and reading only half of it records debt against controls that are already there.
 *
 * ⚠️ IT IS DELIBERATELY NARROW — only ids the screen ITSELF renders, only functions in the same file, and only
 * `getElementById` of that exact id. It is not a licence to inline the file: a guard that passes because of
 * something unrelated elsewhere is a guard agreeing with itself.
 */
function withPainters(body, all, src) {
  let out = body;
  const ids = new Set([...body.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  if (!ids.size) return out;
  for (const [name, fnBody] of all) {
    for (const id of ids) {
      if (fnBody.includes('getElementById("' + id + '")') || fnBody.includes("getElementById('" + id + "')")) {
        /**
         * ⚠️ AND THE PAINTER'S OWN HELPERS COME WITH IT — one hop, the same courtesy the screen gets.
         * `paintDisputes` fills `#disprows` and calls `dispCtl()`, which is where that screen says what a
         * dispute may be narrowed and ordered by. Stopping at the painter found the search and the count and
         * missed the filters and the sort, which is half an answer and reads exactly like a real gap.
         */
        out += '\n' + withHelpers(fnBody, all, 1);
        break;
      }
    }
  }
  return out;
}

/**
 * ⭐ TWO LEVELS, AND THE SECOND ONE EARNED ITS PLACE. A screen calls its renderer (one) and the renderer calls
 * the thing that draws the controls (two) — platformScreen → platScopeTableHTML → platColMenuHTML is exactly
 * that shape, and at depth 1 the guard could not see the column menu at all.
 *
 * ⚠️ IT STOPS AT TWO ON PURPOSE. Every level inlines more code, and a rule that passes because of something
 * unrelated three calls away is a guard agreeing with itself. Two is the shape this codebase actually uses.
 *
 * ⚠️ VISITED SET, not a depth counter alone: two helpers that call each other would otherwise append forever.
 */
const HELPER_DEPTH = 2;
function withHelpers(body, all, depth) {
  let out = body;
  const seen = new Set();
  let frontier = [body];
  for (let d = 0; d < (depth === undefined ? HELPER_DEPTH : depth); d++) {
    const next = [];
    for (const b of frontier) {
      for (const m of b.matchAll(/\b([A-Za-z0-9_$]+)\s*\(/g)) {
        const name = m[1];
        if (seen.has(name) || !all.has(name)) continue;
        seen.add(name);
        out += '\n' + all.get(name);
        next.push(all.get(name));
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * does this screen MOUNT a CBList? Read from the screen itself and the painters it NAMES (`setTimeout(paintCustList, 0)`, `paintPlatList`),
 * each with two hops of its own helpers (paintPlatList → paintPlatKeepScroll → platTablePaint → CBList.mount) — never from the two-hop `body`, which reaches the Task painter from the
 * catalogue through loadList() and would make a catalogue a CBList screen it is not.
 */
function mountsAList(raw, helpers) {
  let text = raw;
  for (const m of raw.matchAll(/\b([A-Za-z0-9_$]+)\b/g)) if (helpers.has(m[1]) && /^paint|Paint$/.test(m[1])) text += '\n' + withHelpers(helpers.get(m[1]), helpers, 2);
  return /\bCBList\.mount\(/.test(text) ? text : '';   /* the text a mount was found in: where its declaration (filters, sorts, remote) is read */
}

function screens(src, file) {
  const safe = blank(src), found = [];
  const helpers = fnBodies(safe);
  const re = /function\s+([A-Za-z0-9_$]*Screen)\s*\(/g;
  let m;
  while ((m = re.exec(safe))) {
    let i = safe.indexOf('{', m.index);
    if (i < 0) continue;
    let depth = 0, j = i;
    for (; j < safe.length; j++) {
      if (safe[j] === '{') depth++;
      else if (safe[j] === '}' && --depth === 0) break;
    }
    /**
     * ⚠️⚠️ THE BODY IS THE BLANKED SOURCE, NOT THE RAW SLICE — and this guard passed a screen it should have
     * failed before that was true. A comment I had written saying *"platQuery() has been reading `pl_sort` off
     * an element that does not exist"* satisfied the `pl_sort` detector, so removing the actual control changed
     * nothing. A watcher that can be satisfied by PROSE ABOUT the control is worse than no watcher: it reports
     * green for the exact fault it exists to catch. blank() keeps string contents — the markup lives in
     * strings — and erases every comment. [[feedback-silence-is-the-bug]]
     */
    const raw = safe.slice(i, j + 1);
    /* ⭐ the screen, the helpers it calls, AND whatever paints into the holes it leaves — see withPainters */
    const body = withPainters(withHelpers(raw, helpers), helpers, safe);
    /**
     * ⚠️⚠️ THE TABLE HABITS ARE ASKED OF THE SCREEN'S *LIST*, AND ONLY ONE HOP OUT.
     *
     * `body` expands TWICE, which reaches three calls deep — and at three calls deep this guard was demanding a
     * column chooser and draggable widths of:
     *
     *   · `viewSupplierPassport`  a read-only credentials view (suppliersScreen)
     *   · `misTax` / `misFriction`  small summary bands of a handful of rows (misScreen)
     *   · `_aiMd`                 the MARKDOWN RENDERER for an AI answer (misScreen)
     *
     * None of those is a list of records anybody sorts. Athi asked for the four habits on the entity table —
     * *"adjustable column headers and usual stuff"* — and platformScreen → platScopeTableHTML is that shape, at
     * ONE hop. A guard that demands the right thing of the wrong element is one people learn to ignore, and
     * then it is reporting nothing. [[feedback-silence-is-the-bug]]
     *
     * ⚠️ The other five controls still look two hops out: search and paging legitimately live in a helper's
     * helper, and nothing is lost by finding them there.
     */
    const listBody = withHelpers(raw, helpers, 1);
    /* ⭐ only screens that actually render a LIST. A detail-only or form-only screen has no list to control,
       and holding it to "you must offer sorting" would be noise that teaches people to ignore this file. */
    if (!/class="list"|class="rows"|id="[a-z_]*rows"/.test(body)) continue;
    found.push({ name: m[1], file: path.basename(file), line: src.slice(0, m.index).split('\n').length,
                 body, listBody, mount: mountsAList(raw, helpers) });
  }
  return found;
}

const all = [];
for (const f of FILES) all.push(...screens(fs.readFileSync(f, 'utf8'), f));

const gaps = {};
for (const s of all) {
  const missing = Object.keys(CONTROLS).filter((k) => !judge(s, k));
  /* ⚠️ the table test reads `listBody` — the screen and ONE hop — so a passport, a summary band or a markdown
     renderer three calls away cannot conjure a demand for a column chooser. See the note beside listBody. */
  if (/<table|<thead|<tbody/.test(s.listBody)) {
    for (const k of Object.keys(TABLE_CONTROLS)) if (!TABLE_CONTROLS[k](s.body)) missing.push(k);
  }
  if (missing.length) gaps[s.name] = missing;
}

/* ── --baseline prints the block to paste into BASELINE above ─────────────────────────────────────────────── */
if (process.argv.includes('--baseline')) {
  console.log('const BASELINE = {');
  for (const [n, m] of Object.entries(gaps).sort()) console.log("  " + n + ": [" + m.map((x) => "'" + x + "'").join(', ') + "],");
  console.log('};');
  process.exit(0);
}

console.log('\n══ LIST CONTROLS — search · filters · sort · paging · count ══\n');

let fails = 0, debt = 0, exempt = 0;

/**
 * ── ⚠️⚠️ THE EXEMPTION LIST IS AUDITED BEFORE ANYTHING ELSE IS JUDGED ──────────────────────────────────────────
 *
 * Both of these are silent rot, and both are how a list like this turns into a place to put inconvenient
 * screens. A name that no longer matches a screen forgives nothing and nobody notices; a name in both lists
 * gives one screen two different answers, and which one wins is an accident of the code below.
 */
for (const name of Object.keys(NOT_A_LIST)) {
  if (!all.some((s) => s.name === name)) {
    fails++;
    console.log('  ✗ NOT_A_LIST names ' + name + ', which is not a screen this guard can find.');
    console.log('       It was renamed or deleted. Remove the line — a stale exemption forgives nothing and');
    console.log('       hides the fact that nobody has re-read this list.');
  }
  if (BASELINE[name]) {
    fails++;
    console.log('  ✗ ' + name + ' is in BOTH NOT_A_LIST and BASELINE.');
    console.log('       Those say different things — "it owes nothing" and "it owes these, later". Pick one.');
  }
}

/* ⚠️ a table is detected by what it RENDERS, not by what it is called: a screen that merely mentions tables in
   a comment owes nothing, and blank() has already removed the comments anyway. */
const isTable = (b) => /<table|<thead|<tbody/.test(b);

for (const s of all.sort((a, b) => a.name.localeCompare(b.name))) {
  /**
   * ⚠️ AN EXEMPT SCREEN IS NOT SKIPPED, IT IS CHECKED DIFFERENTLY. It owes none of the five, because a menu of
   * five fixed rows owes nothing — but it must still BE a menu, and the moment it grows a data table it is not
   * one any more. That is a failure, not a note: the exemption would then be hiding a real list.
   */
  if (NOT_A_LIST[s.name]) {
    if (isTable(s.listBody)) {
      fails++;
      console.log('  ✗ ' + s.name + '  (' + s.file + ':' + s.line + ')  is exempt as "' + NOT_A_LIST[s.name] + '"');
      console.log('       — but it now renders a <table>. A rail does not. Either it has become a real list, in');
      console.log('       which case remove it from NOT_A_LIST and give it the controls, or the table belongs');
      console.log('       somewhere else.');
      continue;
    }
    /**
     * ⭐ PAGING IS THE TELL, AND IT IS THE ONLY ONE WORTH A NOTE. A menu or a design surface may perfectly well
     * gain a search — the network screen's "Where is it?" box is a real one and always was, and settings would
     * be entitled to a filter. But NOTHING pages except a list of records that grows, so an exempt screen that
     * starts paging has stopped being what its exemption says it is.
     *
     * ⚠️ The first version of this noted `search` too, and immediately printed a permanent note about a screen
     * whose search is deliberate and documented — which is how output stops being read. A warning that is
     * always on is not a warning. [[feedback-silence-is-the-bug]]
     */
    if (CONTROLS.paging(s.body)) {
      console.log('  ⭐ ' + s.name + ' is exempt as "' + NOT_A_LIST[s.name] + '", yet it now PAGES.');
      console.log('       Only a growing list of records needs that. Re-read NOT_A_LIST — it may have become one.');
    }
    exempt++;
    continue;
  }
  const missing = gaps[s.name] || [];
  const allowed = BASELINE[s.name] || [];
  const regressed = allowed.filter((k) => !missing.includes(k));   /* it had it, per baseline, and lost it */
  const unexpected = missing.filter((k) => !allowed.includes(k));

  if (unexpected.length) {
    fails++;
    console.log('  ✗ ' + s.name + '  (' + s.file + ':' + s.line + ')  missing: ' + unexpected.join(', '));
    console.log('       Athi has asked for these on every panel. Add them, or agree the gap with him and put');
    console.log('       the screen in BASELINE — never silently.');
  } else if (missing.length) {
    debt += missing.length;
    console.log('  ·  ' + s.name + '  — still owes: ' + missing.join(', ') + '   (recorded debt)');
  }
  if (regressed.length) { /* a baseline that is now wrong in our favour: tighten it */
    console.log('  ⭐ ' + s.name + ' now HAS ' + regressed.join(', ') + ' — remove it from BASELINE so it stays.');
  }
}

/* ⭐ the exempt count is PRINTED, not hidden. An exemption nobody sees is one nobody revisits, and the whole
   reason this category exists is that 18 invisible phantom gaps were burying 29 real ones. */
console.log('\n  ' + (all.length - exempt) + ' list screen(s) · ' + exempt + ' fixed rail(s), not lists · '
  + fails + ' with unagreed gaps · ' + debt + ' recorded gap(s) outstanding');
if (exempt) {
  console.log('\n  Not lists, and why:');
  for (const [n, why] of Object.entries(NOT_A_LIST).sort()) console.log('    · ' + n.padEnd(24) + why);
}
console.log('');
process.exit(fails ? 1 : 0);
