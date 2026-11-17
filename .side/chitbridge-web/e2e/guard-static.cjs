#!/usr/bin/env node
'use strict';
/**
 * guard-static.cjs — the checks a parser will never make for you.
 *
 * Athi, 2026-08-15: *"go one by one, check industry standard and provide a best outcome."*
 *
 * Every defect below cost real time today and EVERY ONE OF THEM PASSED `node -c`. That is the point of this file:
 * syntax checking proves a file parses, not that it means what it says.
 *
 *   1. DUPLICATE OBJECT KEYS — `EP` declared `restore` and `entitySearch` twice. An object literal silently keeps
 *      the last, so one definition never existed at runtime. Same class as the `MSG` collision that made a
 *      finished screen render as "on the build roadmap".
 *   2. GLOBAL COLLISIONS ACROSS FILES — a `var X` in a cap-*.js that app.html already declares as `const X`
 *      throws at load; the script tag still fires onload, CAP_LOADED says true, and the screen falls through to
 *      a stub with nothing anywhere saying why.
 *   3. A `.btn` INSIDE A FLEX ROW — global CSS sets `.btn { width:100% }`, which swallows the row and squeezes
 *      the field beside it to nothing. Found three times by eye before it was found by cause.
 *   4. TEXT BELOW 11px — the legibility floor.
 *
 * Run:  node e2e/guard-static.cjs        (exit 1 on any hard failure)
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const APP = path.join(WEB, 'app.html');
const CAPS = fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js'));

let hard = 0, soft = 0;
const fail = (m) => { hard++; console.log('  ✗ ' + m); };
const warn = (m) => { soft++; console.log('  ⚠ ' + m); };
const pass = (m) => console.log('  ✓ ' + m);

const app = fs.readFileSync(APP, 'utf8');

// ── 1 · duplicate keys in EP ─────────────────────────────────────────────────────────────────────────────────
console.log('\n1 · duplicate EP keys');
{
  const m = app.match(/const EP = \{[\s\S]*?\n\};/);
  const keys = m ? [...m[0].matchAll(/^\s{2}([A-Za-z_][\w]*)\s*:/gm)].map((x) => x[1]) : [];
  const seen = {}, dup = [];
  keys.forEach((k) => { if (seen[k]) dup.push(k); seen[k] = 1; });
  if (dup.length) fail('EP declares these twice — the later silently wins: ' + [...new Set(dup)].join(', '));
  else pass(keys.length + ' EP keys, all unique');
}

// ── 2 · global collisions between app.html and any cap-*.js ─────────────────────────────────────────────────
console.log('\n2 · global name collisions');
{
  const declOf = (src) => new Set([...src.matchAll(/^(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((x) => x[1]));
  const appDecl = declOf(app);
  let clashes = 0;
  CAPS.forEach((f) => {
    const src = fs.readFileSync(path.join(WEB, 'app', f), 'utf8');
    [...declOf(src)].forEach((n) => {
      /* ⚠️ Only a TOP-LEVEL redeclaration throws, and only for const/let. A `function` or `var` reassignment is
         legal-but-suspicious, so it warns rather than fails. */
      const asConst = new RegExp('^(?:const|let)\\s+' + n + '\\b', 'm');
      if (appDecl.has(n)) {
        if (asConst.test(app) || asConst.test(src)) { fail(f + ' declares `' + n + '`, which app.html also declares — this throws at load'); clashes++; }
        else { warn(f + ' redeclares `' + n + '` from app.html (legal, but one of them is dead)'); clashes++; }
      }
    });
  });
  if (!clashes) pass('no cap-*.js global collides with app.html');
}

// ── 3 · .btn inside a flex row without the width override ───────────────────────────────────────────────────
/**
 * ⚠️ THIS CHECK WAS FLAGGING THE CURE AS THE DISEASE, and produced 24 warnings that were mostly noise.
 *
 * The old rule was "a line with `class="btn"` that also mentions flex". That matched `<button class="btn"
 * style="flex:1">` — which is CORRECT — and 2-button rows, which are harmless. A warning list that is mostly
 * false positives is a list nobody reads, so it was hiding whatever real instances it contained.
 *
 * Measured in a live page on 2026-08-15, row 400px wide, with the global `.btn{width:100%}`:
 *
 *   <input style="flex:1"> + <button class="btn">              INPUT 27px · BUTTON 367px   ← THE BUG
 *   <input style="flex:1"> + <button class="btn" width:auto>   INPUT 349px · BUTTON 45px   ← correct
 *   <input>                + <button class="btn">              INPUT 197px · BUTTON 197px  ← harmless
 *   <button class="btn" flex:1> ×2                             197px · 197px               ← harmless
 *
 * So the fault is NARROW: a `.btn` that overrides neither `width` nor `flex` on ITSELF, standing beside a
 * sibling that grows. As a flex item its `width:100%` becomes a 100% flex-basis and it takes the whole row,
 * crushing the field next to it to nothing. That — not "flex was mentioned nearby" — is what to warn about.
 */
console.log('\n3 · .btn in a flex row');
{
  let found = 0;
  /* The button's OWN style attribute, not the whole line — the line contains its siblings' styles too, which is
     exactly how `<input style="flex:1">` next door made a bare button look guarded. */
  const BTN = /<button[^>]*class=\\?"btn[^"\\]*\\?"[^>]*>/g;
  [['app.html', app]].concat(CAPS.map((f) => [f, fs.readFileSync(path.join(WEB, 'app', f), 'utf8')]))
    .forEach(([name, src]) => {
      src.split('\n').forEach((line, i) => {
        /**
         * ⚠️ THE TRIGGER IS A GROWING SIBLING, NOT `display:flex`. Two bare `.btn`s in a flex row measure
         * 197/197 in a 400px row — they split it evenly and nothing is crushed. It is only when something
         * ELSE on the row wants to grow that an unguarded 100%-wide button starves it. Stripping the buttons
         * out first is what makes "a sibling grows" answerable: `<input style="flex:1">` next door was
         * previously making a bare button look guarded, because the flex was on the same LINE.
         */
        const siblings = line.replace(BTN, '');
        if (!/flex:\s*1/.test(siblings)) return;
        (line.match(BTN) || []).forEach((tag) => {
          const own = (tag.match(/style=\\?"([^"\\]*)/) || [])[1] || '';
          if (/width:\s*auto/.test(own) || /flex:/.test(own)) return;   // guarded on itself — fine
          found++;
          warn(name + ':' + (i + 1) + ' — .btn beside a growing sibling with no width:auto or flex: of its own'
            + ' (it takes the row and crushes the field)');
        });
      });
    });
  if (!found) pass('no unguarded .btn beside a growing sibling');
}

// ── 6 · TWO FILES MUST NOT CLAIM THE SAME GLOBAL ────────────────────────────────────────────────────────────
/**
 * ⭐⭐ THIS CHECK EXISTS BECAUSE I SHIPPED EXACTLY THIS BUG, FOUR TIMES, ON 2026-08-15.
 *
 * `catalogue-ui.js` assigned `root.CBCatalogue` — the same global `catalogue-model.js` has always exported. Both
 * are loaded by app.html, mine loads second, so it OVERWROTE the other. `CBCatalogue.STANDARDS`, `.PALETTE`,
 * `.ensure`, `.toJSONSchema`, `.upsertItem` all became undefined, which silently broke the catalogue setup screen
 * (cap-catalogue.js calls four of those). Nothing threw at load. It rode through four pushes.
 *
 * ⚠️ CHECK 2 DID NOT CATCH IT and could not: it compares each cap file against app.html's own declarations, not
 * cap files against each other. A collision between two lazily-loaded modules is invisible to it.
 *
 * ⚠️ AND IT IS INVISIBLE TO EVERY OTHER GATE TOO. `node --check` passes — the code is valid. The e2e suite
 * passed 25/25 — nothing it drives touches the catalogue setup screen. A screen nobody's spec opens is a screen
 * that can be dead for a week.
 *
 * The rule: exactly one file may assign any given `root.X` / `window.X`.
 */
console.log('\n6 · one global, one owner');
{
  /**
   * ⚠️ COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT FUSSINESS — this check flagged ITSELF within an hour of being
   * written. cap-definitions.js explains the collision it was written after, quoting `root.CBCatalogue = M` in
   * prose, and the guard read the quotation as an assignment. A check that cannot tell code from a comment ABOUT
   * code will punish exactly the files that document their own history, which is the opposite of what we want.
   *
   * ⚠️ Strings are deliberately NOT stripped: a global assigned via `window['X'] =` is rare here, but a real
   * assignment hidden in a template literal is a genuine collision and should still be caught.
   */
  const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  /**
   * ⚠️ ONLY FILES THAT CAN SHARE A PAGE WITH app.html (2026-09-27). This read every app/*.js as if one page loaded them
   * all, and reported `CBTax` assigned by tax-engine.js AND tax.js — but nothing loads tax-engine.js: it is the SOURCE
   * vendor-tax.cjs builds the counter's engine/tax.js from, and both are generated from the same lib/tax.js. A file
   * counts as loadable when app.html, or another script (not the assets.js INVENTORY, which lists every file), names it
   * — capabilities load on demand, so a static <script> list alone would miss them.
   */
  const srcOf = {}; CAPS.forEach((f) => { srcOf[f] = fs.readFileSync(path.join(WEB, 'app', f), 'utf8'); });
  const loadable = (f) => app.includes(f) || CAPS.some((o) => o !== f && o !== 'assets.js' && srcOf[o].includes(f));
  const files = [['app.html', app]].concat(CAPS.filter(loadable).map((f) => [f, srcOf[f]]))
    .map(([name, src]) => [name, decomment(src)]);
  const owners = {};
  files.forEach(([name, src]) => {
    /* `root.X = `, `window.X = `, `globalThis.X = ` at an assignment, not a read. */
    [...src.matchAll(/\b(?:root|window|globalThis)\.([A-Z][A-Za-z0-9_$]*)\s*=(?!=)/g)].forEach((m) => {
      (owners[m[1]] = owners[m[1]] || new Set()).add(name);
    });
  });
  const clashes = Object.keys(owners).filter((k) => owners[k].size > 1);
  if (clashes.length) {
    clashes.forEach((k) => fail('`' + k + '` is assigned by ' + [...owners[k]].join(' AND ')
      + ' — whichever loads last wins and the other file\'s API silently disappears'));
  } else {
    pass(Object.keys(owners).length + ' globals, each with exactly one owner');
  }
}

// ── 5 · a REPLACEMENT RENDERER MUST EMIT EVERY HOOK THE ONE IT REPLACES DOES ────────────────────────────────
/**
 * ⭐⭐ THIS CHECK EXISTS BECAUSE I DROPPED THREE HOOKS IN ONE AFTERNOON, ONE SPEC AT A TIME.
 *
 * catalogue-ui.js renders the same rows cart-ui.js does, into the same elements, for the same specs. On
 * 2026-08-15 it shipped without `cbcart-bar` (render-smoke clicks the class), without `cart-count-<ns>`
 * (order-steps asserts the badge), and without `cart-add` (order-steps clicks it — and that one timed out for
 * 15 seconds waiting for a button that was on screen the whole time under a different name).
 *
 * Each was found by a different failing test, twenty minutes apart. None of them fails loudly: a renamed hook
 * looks exactly like a feature that is missing, and a spec that cannot find a control cannot tell you whether
 * the control is broken or merely renamed.
 *
 * So the sets are compared mechanically. If cart-ui emits a testid, catalogue-ui must too — or the omission has
 * to be stated here, deliberately, with a reason.
 */
console.log('\n5 · renderer hook parity (cart-ui → catalogue-ui)');
{
  const rd = (p) => { try { return fs.readFileSync(path.join(WEB, 'app', p), 'utf8'); } catch (e) { return ''; } };
  const cart = rd('cart-ui.js'), cat = rd('catalogue-ui.js');
  if (!cat) { pass('catalogue-ui.js not present — nothing to compare'); }
  else {
    /* Literal testids only. The interpolated ones (`cart-' + ns`) are compared by their stable prefix. */
    const ids = (src) => new Set([...src.matchAll(/data-testid="([a-z-]+)(?:'|")/g)].map((m) => m[1]));
    /**
     * ⭐ DELEGATION COUNTS AS PARITY, and it is the OUTCOME THIS CHECK SHOULD PREFER.
     *
     * catalogue-ui may render a shared piece by calling `CBCart.<export>(…)` instead of re-emitting the markup.
     * That is strictly better than copying it — one definition of what the thing is — but a literal text scan
     * sees an absent testid and fails. Before this, the only way to quiet it was the allowlist, which is how a
     * correct failure got waved through for an afternoon.
     *
     * So: for every `CBCart.x(` that catalogue-ui calls, resolve `x` through cart-ui's export block to the
     * function it names, take that function's body, and credit the testids it emits.
     */
    const delegated = new Set();
    {
      const calls = [...cat.matchAll(/CBCart\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
      for (const name of new Set(calls)) {
        // `categoriesHTML: catgsHTML,` — the export name may differ from the function name.
        const map = new RegExp('\\b' + name + '\\s*:\\s*([A-Za-z_$][\\w$]*)').exec(cart);
        const fn = (map && map[1]) || name;
        const at = cart.search(new RegExp('function\\s+' + fn + '\\s*\\('));
        if (at < 0) continue;
        /* Body = up to the next top-level `function ` declaration. Crude, and deliberately so: over-crediting a
           neighbouring helper is a far smaller sin here than failing a file that genuinely delegates. */
        const next = cart.slice(at + 8).search(/\n  function\s+[A-Za-z_$]/);
        const body = cart.slice(at, next < 0 ? undefined : at + 8 + next);
        for (const m of body.matchAll(/data-testid="([a-z-]+)(?:'|")/g)) delegated.add(m[1]);
      }
    }
    const missing = [...ids(cart)].filter((k) => !ids(cat).has(k) && !delegated.has(k));
    /* Classes a spec addresses directly. */
    const classes = ['cbcart-bar'];
    const missingCls = classes.filter((c) => cart.includes(c) && !cat.includes(c));
    const gone = missing.concat(missingCls);
    /**
     * `cart-checkout` lives in cart-ui's POPUP, which catalogue-ui does not replace — the popup is still
     * cart-ui's. Declared here so it is a decision rather than an oversight.
     *
     * ⚠️⚠️ `pick-catg` WAS ON THIS LIST FOR AN AFTERNOON AND THAT WAS A MISTAKE. I justified it as "the category
     * strip is in the sticky search chrome, and a renderer only swaps the list and the bar". False —
     * catalogue-ui has its OWN pickerHTML and replaces the chrome wholesale, and compose uses that one. So the
     * chips were invisible on the busiest order surface in the product, and this check had said so.
     *
     * ⭐ THE LESSON IS ABOUT THE LIST, NOT THE HOOK: an allowlist entry is a claim about the code, and a wrong
     * claim here converts a correct failure into permanent silence. Anything added must be verified by READING
     * the other file, not by reasoning about what a renderer "should" replace.
     */
    const OK_TO_OMIT = ['cart-checkout'];
    const real = gone.filter((k) => OK_TO_OMIT.indexOf(k) < 0);
    if (real.length) {
      fail('catalogue-ui.js does not emit hooks cart-ui.js does: ' + real.join(', ')
        + '  — a renamed hook is indistinguishable from a missing feature');
    } else {
      pass('catalogue-ui emits every hook cart-ui does (omitting only: ' + OK_TO_OMIT.join(', ') + ')');
    }
  }
}

// ── 4 · text below the legibility floor ─────────────────────────────────────────────────────────────────────
console.log('\n4 · font-size floor (11px)');
{
  const tiny = {};
  [['app.html', app]].concat(CAPS.map((f) => [f, fs.readFileSync(path.join(WEB, 'app', f), 'utf8')]))
    .forEach(([name, src]) => {
      const hits = [...src.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => parseFloat(m[1]) < 11);
      if (hits.length) tiny[name] = hits.length;
    });
  const total = Object.values(tiny).reduce((a, b) => a + b, 0);
  /* ⚠️ A WARNING, NOT A FAILURE, and deliberately so: there are hundreds today. Failing the build on a number
     nobody can fix in one sitting turns the guard into something people disable. It reports and it does not
     grow — tighten this to a hard fail once the count is down. */
  if (total) warn(total + ' inline font-sizes below 11px — ' + Object.entries(tiny).map(([k, v]) => k + ':' + v).join(', '));
  else pass('nothing below 11px');
}

// ── 7 · FILE INTEGRITY — control bytes that survive a syntax check ───────────────────────────────────────────
/**
 * ⚠️ WRITTEN BECAUSE IT HAPPENED (2026-08-16). A NUL byte landed inside a string literal in cap-admin.js where a
 * space was meant. `node --check` PASSED. The browser ran the file. The app worked. The only symptom was that
 * grep started reporting "Binary file … matches", and it was found by accident during an unrelated search.
 *
 * A syntax check is not an integrity check: JS parsers accept control characters inside string literals happily,
 * so the corruption is invisible to every tool that only asks "does this parse". It breaks grep, diff, blame and
 * review — the tools you reach for when something else is already wrong.
 */
console.log('\n7 · file integrity (control bytes)');
{
  const bad = [];
  [['app.html', APP]].concat(CAPS.map((f) => [f, path.join(WEB, 'app', f)]))
    .forEach(([name, file]) => {
      const buf = fs.readFileSync(file);
      /* Tab (9), LF (10), CR (13) are legitimate. Everything else below 0x20, and 0x7F, is not. */
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        if (b === 9 || b === 10 || b === 13) continue;
        if (b < 0x20 || b === 0x7f) {
          const line = buf.slice(0, i).toString('utf8').split('\n').length;
          bad.push(name + ':' + line + ' byte 0x' + b.toString(16).padStart(2, '0'));
          break;   // one report per file is enough to send someone looking
        }
      }
    });
  if (bad.length) fail('control byte in source (invisible to node --check) — ' + bad.join(', '));
  else pass(1 + CAPS.length + ' files, no stray control bytes');
}

// ── 8 · ONE data-testid, ONE ELEMENT ─────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ ALSO WRITTEN BECAUSE IT HAPPENED. `sup-remove` was emitted twice — once on the supplier record panel, once
 * on the order footer — and Playwright's strict mode rejects an ambiguous locator, so the spec died with
 * "resolved to 2 elements". It cost three full suite runs to find, because the failure surfaced as a timeout on
 * an unrelated step rather than as "you have two of these".
 *
 * ⚠️ A WARNING, NOT A FAILURE, for two separate reasons.
 *
 * First, precedent: there are 14 today, and check 4 already records why failing the build on pre-existing debt
 * nobody can clear in one sitting turns a guard into something people switch off.
 *
 * Second, and more important — THIS CHECK CANNOT PROVE A VIOLATION. Two emit sites for one testid are perfectly
 * legal when they are branches of the same conditional: only one is ever in the document, so Playwright sees
 * exactly one. `sup-remove` was a real bug because BOTH rendered at once; `reg-submit` may well be an if/else.
 * Static analysis cannot tell those apart, so this points at candidates and a person decides. Do not promote it
 * to a hard fail — it would fail correct code.
 */
console.log('\n8 · duplicate data-testid');
{
  const seen = {};
  [['app.html', app]].concat(CAPS.map((f) => [f, fs.readFileSync(path.join(WEB, 'app', f), 'utf8')]))
    .forEach(([name, src]) => {
      /**
       * ⚠️ A SELECTOR IS NOT AN EMISSION. `document.querySelector('[data-testid="cat-search"]')` LOOKS FOR a
       * testid; it does not create one. Counting those inflated the duplicate list — cat-search and
       * sup-add-input each reported ×3 when exactly one element of each is rendered, and the two extras were
       * the keyboard shortcut looking them up.
       *
       * ⚠️ WORTH FIXING RATHER THAN TOLERATING, because this check already says its hits are "candidates, not
       * proof". A check that is known to over-report AND is padded with false ones stops being read at all —
       * and it was my own new code that padded it, which is how a guard quietly becomes decorative.
       */
      const emitted = src.split('\n').filter((l) => !/querySelector|querySelectorAll|\.locator\(|getByTestId/.test(l)).join('\n');
      [...emitted.matchAll(/data-testid\s*=\s*["']([^"'${}+]+)["']/g)].forEach((m) => {
        const id = m[1].trim();
        if (!id) return;
        (seen[id] = seen[id] || []).push(name);
      });
    });
  const dupes = Object.entries(seen).filter(([, where]) => where.length > 1);
  if (dupes.length) {
    warn(dupes.length + ' data-testid emitted more than once — candidates, not proof (see note above); '
      + 'a strict-mode failure only occurs when two render TOGETHER — '
      + dupes.slice(0, 6).map(([id, w]) => id + ' ×' + w.length + ' (' + [...new Set(w)].join(', ') + ')').join('; ')
      + (dupes.length > 6 ? ' …' : ''));
  } else pass(Object.keys(seen).length + ' literal testids, each emitted once');
}


// ── 9 · UNPAIRED SURFACES — a themed background with hardcoded text, or the reverse ──────────────
//
// Athi, 2026-08-17: *"we should use couple of colors per theme and should have a definition of where it is
// supposed to be used, so it will be consistent across design pattern."*
//
// ⚠️ THIS IS THE SHAPE OF EVERY CONTRAST BUG FOUND THAT DAY, without exception. The category chip set its
// background from a token and its colour from a literal, so the surface followed the theme and the letters did
// not — in dark the chip went dark while the text stayed dark, 1.63:1, invisible. The reverse is just as broken:
// a literal background under themed text is a surface that CANNOT follow the theme while its letters do.
//
// A declaration that sets both must set them THE SAME WAY. Mixing a token with a literal is the bug.
console.log('\n9 · unpaired surfaces (themed background + hardcoded text, or the reverse)');
{
  const unpaired = {};
  const THEMED_BG_LITERAL_TEXT = /background(?:-color)?:\s*var\(--[a-z0-9-]+\)\s*;\s*color:\s*#[0-9a-fA-F]{3,6}/g;
  const LITERAL_BG_THEMED_TEXT = /background(?:-color)?:\s*#[0-9a-fA-F]{3,6}\s*;\s*color:\s*var\(--[a-z0-9-]+\)/g;
  [['app.html', app]].concat(CAPS.map((f) => [f, fs.readFileSync(path.join(WEB, 'app', f), 'utf8')]))
    .forEach(([name, src]) => {
      const n = [...src.matchAll(THEMED_BG_LITERAL_TEXT)].length + [...src.matchAll(LITERAL_BG_THEMED_TEXT)].length;
      if (n) unpaired[name] = n;
    });
  const total = Object.values(unpaired).reduce((a, b) => a + b, 0);
  /* ⚠️ A WARNING WHILE THE BACKLOG IS WORKED, for the same reason as the font-size floor: a hard fail on a
     number nobody can clear in one sitting is a guard people switch off. What matters is that it does not GROW. */
  if (total) warn(total + ' unpaired surface/text pairs — ' + Object.entries(unpaired).map(([k, v]) => k + ':' + v).join(', '));
  else pass('every background sets its text the same way it sets itself');
}

/**
 * 10 · A TOKEN USED IN THE WRONG ROLE.
 *
 * ⚠️ THIS IS THE ONE THE OTHER CHECKS CANNOT CATCH, BECAUSE NOTHING IS HARDCODED. `background:var(--ink)` is
 * fully tokenised and follows the theme perfectly — into a wall. `--ink` is the BODY TEXT colour. On a light
 * theme it is near-black, so a "dark selected segment" looks deliberate; in dark it inverts to near-WHITE and
 * that segment becomes a white box with white text on it. Measured at 1.21:1 on the catalogue View/Edit toggle
 * and again on the workforce one — the exact thing Athi photographed as "the letter inside the box is not
 * visible at all".
 *
 * ⚠️ THE FIX IS NEVER TO PICK A DIFFERENT SHADE — it is to use a SURFACE token (--card/--accent/--chrome/a tint)
 * and its declared partner. A palette only works if each token keeps one job.
 */
console.log('\n10 · tokens used in the wrong role (a text colour as a surface)');
{
  const TEXT_ONLY = ['--ink', '--ink-2', '--grey-2', '--grey-3', '--grey-4', '--on-card', '--on-bg', '--on-accent', '--on-sel', '--chrome-ink', '--chrome-on', '--on-ok', '--on-warn', '--on-danger', '--on-gold', '--on-purple'];
  const bad = {};
  [['app.html', app]].concat(CAPS.map((f) => [f, fs.readFileSync(path.join(WEB, 'app', f), 'utf8')]))
    .forEach(([name, src]) => {
      /* strip comments — this file DOCUMENTS the bug in prose, and a guard that trips on its own explanation
         teaches people to ignore it */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
      let n = 0;
      for (const t of TEXT_ONLY) {
        /* ⚠️ ONLY WHEN THE DECLARATION ALSO SETS `color:` — i.e. the surface provably CARRIES TEXT.
           A text token's VALUE is perfectly legitimate for a mark that holds no letters: cap-legend paints a 10px
           status dot with --grey-4, and that is a muted dot, not a surface. Flagging it would make this check cry
           wolf on correct code, and a guard that cries wolf is a guard that gets ignored — which costs more than
           the one bug it would have caught. Text on the surface is what makes the pairing rule apply at all. */
        /* ⚠️ `var(--ink)` AND `var(--ink,#1c1a17)` ARE THE SAME MISTAKE, and matching only the first let the
           chit detail's Them/Us toggle through: `background: on ? 'var(--ink,#1c1a17)' : 'transparent'` with
           white text on it — near-white on white in every dark theme. A fallback does not change what the token
           MEANS, so the check must not care whether one is present. Athi found that box by eye, twice. */
        n += [...code.matchAll(new RegExp('background(?:-color)?\\s*:\\s*[^;]{0,160}?var\\(\\s*' + t + '\\s*[,)][^;{}]{0,60};[^;{}]{0,200}?color\\s*:', 'g'))].length;
      }
      if (n) bad[name] = n;
    });
  const total = Object.values(bad).reduce((a, b) => a + b, 0);
  if (total) warn(total + ' text tokens used as a background — ' + Object.entries(bad).map(([k, v]) => k + ':' + v).join(', '));
  else pass('no text colour is being used as a surface');
}

/**
 * 11 · A SURFACE THAT NAMES NO TEXT COLOUR.
 *
 * ⚠️ THE HALF-WRITTEN DECLARATION — the one checks 9 and 10 cannot see, because there is no wrong colour to
 * find, only a missing one. An element paints its own background and says nothing about its text, so the text
 * inherits from an ancestor that has a DIFFERENT background.
 *
 * That is how the avatar menu broke: `background:var(--card)` and no colour, so Profile / Settings inherited
 * `--chrome-ink` from the topbar — a pale grey that is correct on dark navy and invisible on a white card. In
 * the dark theme --card is itself dark, so it looked right and the bug hid completely. Athi found it by eye,
 * in a menu he opens every day, after three passes had reported the app clean.
 *
 * ⚠️ INHERITANCE ACROSS A SURFACE CHANGE IS NOT A PAIRING. The moment an element paints its own ground it stops
 * being part of its parent's surface, and any colour still arriving from the parent was chosen for a different
 * background. It is right only until one of the two moves.
 */
console.log('\n11 · surfaces that name no text colour (inline styles)');
{
  const SURF = ['--card','--paper','--chrome','--sel','--sel-2','--picked','--hover','--accent','--blue','--blue-2',
    '--blue-d','--disp','--disp-2','--ok','--ok-2','--ok-3','--purple','--purple-2','--gold','--prog','--warn',
    '--blue-tint-bg','--blue-tint','--ok-tint','--danger-tint','--warn-tint','--purple-tint','--neutral-tint','--gold-soft'];
  const bad = {};
  /* UX-28 debt, named and only allowed to fall: three files whose readability debt (no module header / CARD / §7 tests) fails the touch gate until
     cb-maintainability clears it; each still has ONE surface that inherits its text colour. A file not listed here has none. */
  const DEBT_FILES = { 'cap-adopt.js': 1, 'cap-readiness.js': 1, 'cap-traceability.js': 1 };
  [['app.html', app]].concat(CAPS.map((f) => [f, fs.readFileSync(path.join(WEB, 'app', f), 'utf8')]))
    .forEach(([name, src]) => {
      let n = 0;
      /* ⚠️ JOIN CONCATENATED FRAGMENTS FIRST. Most styles in this codebase are built as `'a;' + 'b'`, so a rule
         that reads one quoted string at a time sees `background:var(--card);` in one fragment and `color:...` in
         the next, and reports a pair that is perfectly fine. It over-reports rather than under-reports, which is
         the safe direction for a guard — but a check that cries wolf is one people learn to skip, and this one
         cried wolf on the very commit that added it. Collapsing `' + '` makes it read what actually ships. */
      src = src.replace(/'\s*\+\s*'/g, '').replace(/"\s*\+\s*"/g, '');
      for (const m of src.matchAll(/style\s*=\s*(["'`])((?:(?!\1)[\s\S]){0,320}?)\1/g)) {
        const st = m[2];
        const bg = /background(?:-color)?\s*:\s*var\((--[a-z0-9-]+)\)/.exec(st);
        if (!bg || !SURF.includes(bg[1])) continue;
        if (/(^|[;'"`\s])color\s*:/.test(st)) continue;   /* a colour set inside a ternary fragment ('color:..' after a quote) is still a colour */
        n++;
      }
      const allowed = DEBT_FILES[name] || 0;
      if (n > allowed) bad[name] = n;
      else if (n < allowed) bad[name + ' (below its allowance of ' + allowed + ': lower DEBT_FILES)'] = n;
      else if (allowed) warn(name + ': ' + n + ' inline surface(s) still inherit their text colour (named debt)');
    });
  const total = Object.keys(bad).length;   /* files over or under their allowance (a below-allowance entry counts even at 0 surfaces) */
  if (total) fail(total + ' files with inline surfaces that inherit their text colour, or fewer than their DEBT_FILES allowance (UX-28) — ' + Object.entries(bad).map(([k, v]) => k + ':' + v).join(', '));
  else pass('every painted surface names its own text');
}

/**
 * 12 · THE SHARED MODEL IS ACTUALLY REQUIRE()-ABLE.
 *
 * ⚠️ ITS FAILURE MODE IS SILENT, WHICH IS WHY IT IS WORTH A CHECK. catalogue-model.js says in its own header
 * that it is "require()-able in Node (module.exports)" and names headless consumers that MUST route through it.
 * The web package sets "type":"module", so every .js was ESM, the UMD wrapper's CJS branch never ran, and
 * require() handed back an EMPTY OBJECT rather than throwing. The first consumer to believe the header would
 * get `undefined` from every lookup and compute from nothing while appearing to run — no exception, plausible
 * output, wrong. The same class as a vault that reads back empty.
 *
 * Fixed by a package.json scoped to public/app declaring commonjs, which is what those 29 plain browser scripts
 * already are. This check exists because deleting that file would break nothing visible.
 */
console.log('\n12 · the shared catalogue model is require()-able');
{
  try {
    const p = require.resolve(path.join(WEB, 'app', 'catalogue-model.js'));
    delete require.cache[p];
    const M = require(p);
    const n = Object.keys(M || {}).length;
    if (n > 20) pass('catalogue-model.js exports ' + n + ' symbols to Node');
    else warn('catalogue-model.js require() yields ' + n + ' exports — its header promises Node consumers can use it');
  } catch (e) {
    warn('catalogue-model.js cannot be required: ' + (e && e.message));
  }
}

/**
 * 13 · EVERY TOKEN REFERENCED IS ACTUALLY DEFINED.
 *
 * ⚠️⚠️ `var(--wash, #f6f4f0)` LOOKS TOKENISED AND IS NOT. If `--wash` is never defined, the HARDCODED FALLBACK
 * is what renders — in every theme, for ever. Five such names existed (--wash · --soft · --mut · --line-soft ·
 * --line-strong), used ~30 times, and every colour sweep I ran walked straight past them because each one
 * contained the string `var(`.
 *
 * ⚠️ IT IS THE PERFECT DISGUISE: a reviewer greps for hardcoded hex, sees `var(`, and moves on. Athi found it by
 * eye instead — the chit cost box painted `var(--wash,…)`, so it stayed cream on a dark theme and "Invoiced" and
 * "Margin" vanished into it.
 *
 * A fallback is legitimate ONLY as a defence for a token that exists. One for a token that does not is a literal
 * with extra syntax.
 */
console.log('\n13 · every token referenced is defined');
{
  const defined = new Set(), used = new Map();
  const srcs = [['app.html', app]].concat(CAPS.map((f) => [f, fs.readFileSync(path.join(WEB, 'app', f), 'utf8')]));
  srcs.forEach(([, src]) => {
    for (const m of src.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);        // :root, themes, any declaration
    for (const m of src.matchAll(/'(--[a-z0-9-]+)'\s*:/g)) defined.add(m[1]);      // theme maps: '--paper':'#fff'
  });
  /**
   * ⚠️ ONLY A **LITERAL** FALLBACK IS THE BUG. `var(--cbst-accent, var(--blue))` is a deliberate host-overridable
   * hook: undefined by design, and if nobody overrides it the value still comes from a real token and still
   * follows the theme. `var(--wash, #f6f4f0)` is the opposite — a hex that renders for ever while wearing a
   * token's syntax. Flagging both would bury the one that matters under three that do not, which is how a check
   * gets ignored; I nearly shipped it that way.
   */
  srcs.forEach(([name, src]) => {
    for (const m of src.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,\s*([^)]*))?\)/g)) {
      const tok = m[1], fallback = (m[3] || '').trim();
      if (fallback && /var\(/.test(fallback)) continue;                 // falls back to a real token — fine
      if (!/^--[a-z][a-z0-9-]*$/.test(tok)) continue;                   // `--fs-*`, `--x` etc: selector text, not a reference
      if (!used.has(tok)) used.set(tok, name + (fallback ? ' → ' + fallback : ' → no fallback'));
    }
  });
  const missing = [...used.keys()].filter((t) => !defined.has(t));
  if (missing.length) {
    warn(missing.length + ' token(s) referenced but never defined — the hardcoded fallback is what renders: '
      + missing.map((t) => t + ' (' + used.get(t) + ')').join(', '));
  } else pass('no var(--…) refers to a token that does not exist');
}

/**
 * 14 · NO PHYSICAL DIRECTION PROPERTIES.
 *
 * ⚠️ `margin-left` is a promise about the SCREEN. `margin-inline-start` is a promise about the READING ORDER —
 * it follows `dir`, so one attribute on <html> mirrors the whole interface instead of 378 hand-edits. That
 * conversion is done; this check is what stops it being undone one convenient `margin-left` at a time.
 *
 * ⚠️ IT IS THE PREREQUISITE FOR ARABIC, and for Hebrew, Urdu and Farsi at no extra cost. A single physical
 * property does not look like a bug in English and never will — which is exactly why it needs a machine to
 * notice it rather than a reviewer.
 *
 * ⚠️ COMMENTS ARE EXCLUDED. Several of them legitimately DISCUSS `padding-left` — including the note explaining
 * why an indent was removed. A guard that trips on the record of a decision teaches people to delete the record.
 */
console.log('\n14 · direction is logical, not physical (RTL-ready)');
{
  const PHYS = /\b(margin|padding|border)-(left|right)\b|text-align\s*:\s*(left|right)\b/g;
  const bad = {};
  [['app.html', app]].concat(CAPS.map((f) => [f, fs.readFileSync(path.join(WEB, 'app', f), 'utf8')]))
    .forEach(([name, src]) => {
      /* ⚠️ ALSO STRIP <code> SPANS. The Standards page DOCUMENTS this anti-pattern — "margin-left would have
         needed a second stylesheet nobody maintains" — and the guard flagged its own explanation as a
         violation. A checker that cannot tell a USE from a MENTION teaches people to ignore it, which is worse
         than not having the check at all. */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
                      .replace(/<code>[\s\S]*?<\/code>/g, ' ');
      const n = (code.match(PHYS) || []).length;
      if (n) bad[name] = n;
    });
  const total = Object.values(bad).reduce((a, b) => a + b, 0);
  if (total) warn(total + ' physical direction properties — these do not mirror in RTL: '
    + Object.entries(bad).map(([k, v]) => k + ':' + v).join(', '));
  else pass('no margin/padding/border-left|right or text-align:left|right outside comments');
}
/**
 * ⭐⭐ 15 · HARDCODED INK ON A THEMED GROUND — the class that produced the bug Athi found in Work patterns.
 *
 * A chip written as `color:#9a6d1a; background:var(--warn-tint)` has ONE HALF THAT MOVES and one that does
 * not. The ground follows the theme into a dark palette; the ink stays exactly where it was typed. It measured
 * 3.91:1 on every light theme and 3.36:1 on Dark — below AA in all fifteen — and no amount of theme work would
 * ever have fixed it, because a11y-contrast.cjs measures TOKENS and this colour is not one. It took a person
 * looking at the screen, which is precisely the check we are trying not to depend on.
 *
 * ⚠️ #fff IS EXEMPT, DELIBERATELY. White text on a coloured FILL must stay white in every theme — that rule is
 * stated in app.html's own token block and is why --on-accent exists. Flagging it would bury the real cases
 * under 36 correct ones.
 *
 * ⚠️ A WARNING, NOT A FAILURE, TODAY. There are dozens of these and clearing them is a sweep rather than a
 * line, so this reports the count and the worst files instead of blocking every commit until the backlog is
 * done. It should become a hard failure the day the count reaches zero; until then its job is to stop the
 * number growing unnoticed, which is how it got to dozens in the first place.
 */
console.log('\n15 · hardcoded ink on a themed ground');
{
  const NEAR = 140;
  const bad = {};
  [['app.html', app]].concat(CAPS.map((f) => [f, fs.readFileSync(path.join(WEB, 'app', f), 'utf8')]))
    .forEach(([name, src]) => {
      /**
       * ⚠️ POPUP STYLESHEETS ARE EXEMPT, AND THEIR LITERALS ARE CORRECT. A window opened with window.open() is
       * a DIFFERENT DOCUMENT with none of our custom properties, so a token there resolves to nothing and the
       * declaration is silently dropped. (_AI_MDCSS was setting font-size:var(--fs-2) in exactly that position
       * and had therefore never had a controlled font size at all — found by this check.)
       *
       * Flagging them would make the count un-clearable, and a check that can never reach zero never gets
       * promoted to a hard failure — it would sit at "5 warnings" forever and be ignored.
       */
      /**
       * ⚠️ BLANK OUT, DO NOT COLLAPSE. Replacing a multi-line comment with a single space JOINS the code either
       * side of it, so a `background:var(--x)` above a long comment lands within the proximity window of a
       * `color:#hex` below it — two declarations that are nowhere near each other in the real file. That is
       * where four of these "findings" came from, and a checker that invents its own evidence is worse than
       * none. Preserving the newlines keeps every offset honest.
       */
      const blank = (m) => m.replace(/[^\n]/g, ' ');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^([ \t]*)\/\/.*$/gm, blank)
                      .replace(/var _AI_MDCSS[\s\S]*?';/g, blank)
                      .replace(/var css\s*=\s*'@page[\s\S]*?';/g, blank);
      let n = 0;
      /**
       * ⚠️ `border-color:` IS NOT INK, and the first version of this check counted it as such — `color\s*:`
       * matches the tail of `border-color:`, `outline-color:` and `caret-color:` alike. A border is a
       * NON-TEXT concern (1.4.11, 3:1), not a text one (1.4.3, 4.5:1), so lumping them together both
       * overstated the count and pointed the reader at the wrong fix. The lookbehind requires the property to
       * actually BE `color`.
       */
      const re = /(?<![-a-zA-Z])color\s*:\s*(#[0-9a-fA-F]{3,8})/g;
      let m;
      while ((m = re.exec(code))) {
        const ink = m[1].toLowerCase();
        if (ink === '#fff' || ink === '#ffffff') continue;   // white on a fill is the documented rule
        /* Only flag it when a THEMED ground is declared nearby — a hardcoded ink on a hardcoded background is
           a self-consistent (if unthemed) pair, and lumping the two together would make the count meaningless. */
        const around = code.slice(Math.max(0, m.index - NEAR), m.index + NEAR);
        if (/background\s*:\s*(var\(|linear-gradient\([^)]*var\()/.test(around)) n++;
      }
      if (n) bad[name] = n;
    });
  const total = Object.values(bad).reduce((a, b) => a + b, 0);
  /**
   * ⭐ NOW A HARD FAILURE, because the count reached zero on 2026-08-18. It shipped as a warning while there
   * were 29 of these; a check that can never pass is a check people learn to scroll past. Holding the line at
   * zero is cheap — reaching zero was the work.
   */
  if (total) {
    fail(total + ' hardcoded text colours on a var() background — one half moves with the theme, the other does '
      + 'not, so this is invisible until someone opens the wrong theme: '
      + Object.entries(bad).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => k + ':' + v).join(', '));
  } else pass('every text colour on a themed ground is itself a token');
}

/**
 * ⭐⭐ 16 · A SPEC READING `window.X` FOR A SCRIPT-SCOPED GLOBAL — a test that passes for the wrong reason.
 *
 * `UI`, `SESSION`, `STORE` and `CAP_LOADED` are declared with `let`/`const` at the top level of app.html. Only
 * `var` and function declarations become properties of `window`; `let` and `const` live in script scope. So
 * `page.evaluate(() => window.UI && window.UI.nav)` returns **undefined**, always.
 *
 * ⚠️ AND UNDEFINED COMPARES EQUAL TO UNDEFINED. keymap.spec's KEY-06 asserted "a digit must not navigate the
 * screen underneath an open modal" by comparing nav before and after — both undefined, so it passed no matter
 * what the key actually did. It has been green since it was written and was protecting nothing.
 *
 * A test that passes for the wrong reason is worse than no test: it occupies the slot where a real check would
 * go, and reports green while the behaviour it names is unguarded. Reading the BARE identifier is what actually
 * reaches script scope from page.evaluate.
 */
console.log('\n16 · specs must not read window.X for a script-scoped global');
{
  const SPECS = path.join(__dirname, 'tests');
  const SCOPED = [];
  /* Which top-level names are let/const in app.html — computed, not listed, so a new one is covered for free. */
  const re = /^(?:let|const)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(app))) SCOPED.push(m[1]);

  const bad = [];
  if (fs.existsSync(SPECS)) {
    fs.readdirSync(SPECS).filter((f) => f.endsWith('.js')).forEach((f) => {
      const src = fs.readFileSync(path.join(SPECS, f), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, ' '))
                      .replace(/^([ \t]*)\/\/.*$/gm, (x) => x.replace(/[^\n]/g, ' '));
      SCOPED.forEach((name) => {
        const hit = new RegExp('window\\.' + name + '\\b', 'g');
        const n = (code.match(hit) || []).length;
        if (n) bad.push(f + ' touches window.' + name + ' ×' + n);
      });
    });
  }
  if (bad.length) fail(bad.length + ' spec reference(s) to a script-scoped global via window — these are always '
    + 'undefined, and an assertion comparing two of them passes whatever the product does: ' + bad.slice(0, 6).join('; '));
  else pass('no spec reads or writes a let/const global off window (' + SCOPED.length + ' script-scoped names checked)');
}

// ── 17 · no platform host in the site (HX1) ────────────────────────────────────────────────────────────────────────────
/* The api's address lives in ONE file, public/config.js (window.CB_API), written per deploy from CB_API_BASE; a page that names
   *.railway.app or *.vercel.app itself is a site that cannot move (api docs/HOSTING-COUPLING.md). ALLOWED names the only exceptions and
   why; the master of till.html is the api's tools/tally-connector/till.html, held by the api's tests/hosting-neutral.test.cjs too. */
console.log('\n17 · no platform host in the site');
{
  const ROOT = path.join(__dirname, '..');
  const ALLOWED = {
    'public/config.js': 1,      // THE one place: the production api, as Vercel serves this file (rewritten per deploy elsewhere)
    'public/till.html': 1,      // cbHome's fallback for a shop PC whose till.js predates HX1 (no /config.js there yet) — vendored, named debt
    'vercel.json': 3,           // CO2's CSP (report-only) connect-src + K-SEC PR A's report-uri and Reporting-Endpoints (where violations go): the Vercel deploy's own headers name the api it talks to — per-deploy config, like config.js (INT4)
  };
  const HOST = /[a-z0-9-]+\.(?:up\.)?railway\.app|[a-z0-9-]+\.vercel\.app/gi;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name))
    : (/\.(html|js|cjs|mjs|json|css|sh|conf)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const files = walk(WEB).concat(['index.html', 'vercel.json', 'Dockerfile', 'deploy/nginx.conf', 'deploy/40-cb-api-base.sh'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)));
  const bad = [];
  files.forEach((f) => {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const n = (fs.readFileSync(f, 'utf8').match(HOST) || []).length;
    if (n > (ALLOWED[rel] || 0)) bad.push(rel + ' ×' + n + (ALLOWED[rel] ? ' (allowed ' + ALLOWED[rel] + ')' : ''));
  });
  if (bad.length) fail(bad.length + ' file(s) name a platform host — read window.CB_API (public/config.js) instead: ' + bad.slice(0, 8).join('; '));
  else pass(files.length + ' site files name no *.railway.app / *.vercel.app host outside public/config.js');
  const pagesNeed = walk(WEB).filter((f) => /\.html$/.test(f) && /window\.CB_API\b|CBShell\.apiBase|app\/shell\.js/.test(fs.readFileSync(f, 'utf8')))
    .concat([path.join(ROOT, 'index.html')])
    .filter((f) => !/bank-demo.html$/.test(f) /* the no-login bank page mounts the header anonymous: no api base is read, and it must NOT load config.js */ && !/<script src="\/config\.js"><\/script>/.test(fs.readFileSync(f, 'utf8')));
  if (pagesNeed.length) fail('page(s) read the api base but do not load /config.js first: ' + pagesNeed.map((f) => path.relative(ROOT, f)).join(', '));
  else pass('every page that reads the api base loads /config.js');

  /* SEC0 (14 Oct): the Supabase PROJECT REF is the api's env (the host in DATABASE_URL / S3_ENDPOINT), never a literal in a public repo —
     the api had it in 7 files, this repo in none. The pattern is gitleaks' own rule in .gitleaks.toml (id cb-supabase-project-ref), read
     here so CI's gitleaks and this offline guard run ONE regex. Every tracked file is held to it; the api and engines beside this
     checkout are read too and reported (their own guard fails them: api tests/hosting-neutral.test.cjs §6). */
  const { execFileSync } = require('child_process');
  const ruleOf = (dir) => {
    const toml = fs.readFileSync(path.join(dir, '.gitleaks.toml'), 'utf8');
    const m = /\[\[rules\]\]\s*\nid = "cb-supabase-project-ref"[\s\S]*?\nregex = '''([^\n]+)'''/.exec(toml);
    return m ? new RegExp(m[1], 'g') : null;
  };
  const refHits = (dir, R) => execFileSync('git', ['-C', dir, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean)
    .flatMap((f) => {
      let s; try { s = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { return []; }   // tracked but absent from this checkout
      if (s.indexOf('\0') >= 0) return [];                                                     // binary
      const m = s.match(R);
      return m ? [f + ' (' + m[0].slice(0, 40) + ')'] : [];
    });
  const own = ruleOf(ROOT);
  if (!own) fail('.gitleaks.toml has no rule cb-supabase-project-ref — the Supabase project ref would pass secret scanning');
  else {
    const ref20 = 'bcdfg'.repeat(4);   // the shape, built here: never a literal ref in this file
    const catches = ['db.' + ref20 + '.supabase.co', 'supabase.com/dashboard/project/' + ref20, 'cb_app.' + ref20, 'Supabase `' + ref20 + '`'].every((s) => s.match(own));
    const spares = ['db.example-host.supabase.co', 'https://<ref>.supabase.co', 'postgres.<project-ref>'].every((s) => !s.match(own));
    if (!catches || !spares) fail('rule cb-supabase-project-ref ' + (catches ? 'trips on the placeholders <ref> / db.example-host.supabase.co' : 'misses a shape the ref was found in'));
    const bad = refHits(ROOT, own);
    if (bad.length) fail(bad.length + ' tracked file(s) carry a Supabase project ref — it is env only (api DATABASE_URL / S3_ENDPOINT): ' + bad.slice(0, 8).join('; '));
    else pass('no tracked file carries a Supabase project ref (rule cb-supabase-project-ref from .gitleaks.toml)');
    ['chitbridge-api', 'chitbridge-engines'].forEach((r) => {
      const d = path.join(ROOT, '..', r);
      if (!fs.existsSync(path.join(d, '.git'))) return;
      let h = [];
      try { h = refHits(d, (fs.existsSync(path.join(d, '.gitleaks.toml')) && ruleOf(d)) || own); } catch (_) { return; }
      if (h.length) warn(r + ' (beside) carries a Supabase project ref in ' + h.length + ' file(s): ' + h.slice(0, 8).join('; '));
      else pass(r + ' (beside): no Supabase project ref');
    });
  }
}

/* 18 · FIX-INT5a (13 Oct): docs/process/PRN.md was tracked — PRN is a Windows device name, and `git checkout` failed on the owner's PC.
   Windows reserves CON · PRN · AUX · NUL · COM1–9 · LPT1–9 as a file's name before ANY extension, in any case. Every tracked path is held
   to it; the api and engines beside this checkout are read too and reported (`node e2e/guard-static.cjs` there is not theirs to fail). */
console.log('\n18 · no tracked path a Windows checkout cannot write');
{
  const { execFileSync } = require('child_process');
  const ROOT = path.join(__dirname, '..');
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const hits = (dir) => execFileSync('git', ['-C', dir, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean)
    .filter((p) => p.split('/').some((seg) => RESERVED.test(seg.split('.')[0])));
  const own = hits(ROOT);
  if (own.length) fail(own.length + ' tracked path(s) Windows cannot check out (a reserved device name): ' + own.slice(0, 8).join(', '));
  else pass('no tracked path is named CON · PRN · AUX · NUL · COM1–9 · LPT1–9');
  ['chitbridge-api', 'chitbridge-engines'].forEach((r) => {
    const d = path.join(ROOT, '..', r);
    if (!fs.existsSync(path.join(d, '.git'))) return;
    let h = [];
    try { h = hits(d); } catch (_) { return; }
    if (h.length) warn(r + ' (beside) tracks ' + h.length + ' path(s) Windows cannot check out: ' + h.slice(0, 8).join(', '));
    else pass(r + ' (beside): no reserved device name');
  });
}

/* 19 · T2-WEBPRIMS (14 Oct): ONE HOME PER PRIMITIVE — esc · money · the month words live in app/helpers.js. 79 definitions outside it on 14 Oct
   (esc 41 · renamed escapers 9 · money 25 · Jan…Dec 3); 7 remain, each named in e2e/prim-homes.cjs ALLOW with its reason. A new copy fails here. */
console.log('\n19 · one esc · one money formatter · one month list (app/helpers.js)');
{
  const { scan, HOME } = require('./prim-homes.cjs');
  const { found, bad } = scan();
  const n = found.reduce((a, x) => a + x.lines.length, 0);
  bad.forEach((b) => fail(b.file + ' defines `' + b.name + '` ×' + b.lines.length + ' (line ' + b.lines.join(', ') + ') — call the one in ' + HOME + ' (esc · fmtMoney · monthNames)'
    + (b.may ? '; allowed ' + b.may : '')));
  if (!bad.length) pass(n + ' definition(s) outside ' + HOME + ', every one named in e2e/prim-homes.cjs ALLOW');
}

/* 20 · T2-POLICY (14 Oct): the policy flags are DEFINED once — chitbridge-api lib/policy.js FLAGS (+ its CARD rows, sent as schema[key].ui).
   This repo held a second table (cap-admin.js POLICY_FLAGS: label · help · level · gov) and the two drifted. Ratchet at zero: no file in
   public/ declares a list of flag rows (`{ key:'…', label:…, type:'enum'|'number' … }`) or a POLICY_FLAGS table. */
console.log('\n20 · one definition of the policy flags (the server\'s)');
{
  const ROW = /\{\s*key\s*:\s*'[a-z_]+'\s*,\s*label\s*:[^}]*\btype\s*:\s*'(enum|number|set)'/;
  const hits = [];
  const files = ['app.html'].concat(CAPS.map((f) => 'app/' + f));
  for (const f of files) {
    const src = fs.readFileSync(path.join(WEB, f), 'utf8');
    if (/\bPOLICY_FLAGS\s*=/.test(src) || ROW.test(src)) hits.push(f);
  }
  if (hits.length) fail(hits.length + ' file(s) define policy flag rows of their own (read schema[key].ui from GET /api/entities/policy instead): ' + hits.join(', '));
  else pass('no policy flag rows defined in the web — the card paints the server\'s schema (0, was 1)');
}

/* 21 · T2-ENGONCE (14 Oct): eight engines were adopted TWICE — public/app/X.js AND public/engine/X.js (6,191 duplicated lines, MAINT-1 D3).
   public/engine/ is the one home of an adopted engine; every page loads that copy. An engine stamped ADOPTED in two web files (a bundle
   counts each part it carries), a lock entry with two paths, or a page that loads /app/<adopted engine>.js fails. Ratchet: zero. */
console.log('\n21 · each adopted engine has ONE home in web (public/engine)');
{
  const ROOT = path.join(__dirname, '..');
  const STAMP = /^\/\* ADOPTED from chitbridge-engines v\d+\.\d+\.\d+ · ([a-z0-9-]+) · sha256 /gm;
  const where = {};
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f); return; }
    if (!/\.(js|cjs|mjs)$/.test(e.name)) return;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(STAMP)) (where[m[1]] = where[m[1]] || new Set()).add(path.relative(ROOT, f).replace(/\\/g, '/'));
  });
  walk(WEB);
  const twice = Object.keys(where).filter((n) => where[n].size > 1);
  if (twice.length) fail(twice.length + ' engine(s) adopted in more than one web file: ' + twice.map((n) => n + ' (' + [...where[n]].join(' + ') + ')').join(' · '));
  else pass(Object.keys(where).length + ' adopted engines, each in exactly one web file');
  const outside = Object.keys(where).filter((n) => [...where[n]].some((f) => !/^public\/(engine|app)\//.test(f)));
  if (outside.length) fail('adopted engine(s) outside public/engine or public/app: ' + outside.join(', '));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'engines.lock.json'), 'utf8'));
  const paths = {};
  Object.entries(lock.adopt || {}).forEach(([n, ps]) => ps.forEach((p) => (paths[n] = paths[n] || []).push(p)));
  Object.entries(lock.bundles || {}).forEach(([p, ns]) => ns.forEach((n) => (paths[n] = paths[n] || []).push(p)));
  const lockTwice = Object.keys(paths).filter((n) => paths[n].length > 1);
  if (lockTwice.length) fail('engines.lock.json gives ' + lockTwice.length + ' engine(s) more than one path: ' + lockTwice.map((n) => n + ' → ' + paths[n].join(' + ')).join(' · '));
  else pass('engines.lock.json lists one path per engine (' + Object.keys(paths).length + ')');
  /* a load of /app/<engine>.js whose app/ copy is gone (the deleted second copies) — app/units.js is NOT an adopted engine (a hand-vendored
     CBUnits, custodian finding T2-ENGONCE), so it is judged by whether the file exists, not by its name */
  const gone = Object.keys(where).filter((n) => !fs.existsSync(path.join(WEB, 'app', n + '.js')));
  const LOADS = new RegExp('src=["\']\\.?\\/?app\\/(' + gone.join('|') + ')\\.js["\']', 'g');
  const loads = [];
  [ROOT, WEB].forEach((d) => fs.readdirSync(d).filter((f) => f.endsWith('.html')).forEach((f) => {
    for (const m of fs.readFileSync(path.join(d, f), 'utf8').matchAll(LOADS)) loads.push(path.relative(ROOT, path.join(d, f)) + ' → app/' + m[1] + '.js');
  }));
  if (loads.length) fail(loads.length + ' page load(s) of an engine that lives in public/engine, not app/: ' + loads.slice(0, 8).join(', '));
  else pass('no page loads an adopted engine from app/');
}

// ── 22 · a shared popup keeps its header: no page scrolls the frame (UX-112 / UX-113) ────────────────────────────────────────
/**
 * Athi, 2026-10-23 (Country Lab row detail): the title and the x scrolled away with the text. country-lab.html put overflow:auto on
 * .lk-pop.cl-detail, so the whole frame scrolled. The rule (DISCIPLINES §3, "the header stays"): only app/lab-kit.css styles the frame, and
 * there the BODY (.lk-pop-body) scrolls, never the frame. A page may size or colour its popup; a page that gives the frame its own overflow
 * fails here. e2e/walk-country-lab.cjs (step D5) scrolls a real popup and checks the header is still in view.
 */
console.log('\n22 · a shared popup keeps its header (no overflow on the .lk-pop frame outside app/lab-kit.css)');
{
  const OWNER = path.join(WEB, 'app', 'lab-kit.css');
  const FRAME = /\.lk-pop(?![\w-])/;   /* the frame itself: not .lk-pop-body, -x or -back */
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(html|css)$/.test(e.name) && p !== OWNER) files.push(p);
  });
  walk(WEB);
  const bad = [];
  files.forEach((p) => {
    const src = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const frame = m[1].split(',').some((s) => FRAME.test(s.trim().split(/\s+/).pop() || ''));
      if (!frame || !/(^|;|\s)overflow(-y)?\s*:\s*(auto|scroll)/.test(m[2])) continue;
      const at = m.index + m[1].search(/\S/);
      bad.push(path.relative(WEB, p) + ':' + src.slice(0, at).split('\n').length + ' ' + m[1].trim());
    }
  });
  if (bad.length) fail(bad.length + ' page rule(s) scroll the shared popup frame, so its title and x scroll away (only .lk-pop-body may scroll, in app/lab-kit.css): ' + bad.join(' · '));
  else pass(files.length + ' pages and stylesheets: none gives the .lk-pop frame an overflow; the body scrolls, the header stays');
}

console.log('\n== GUARD ==  ' + hard + ' failure(s) · ' + soft + ' warning(s)');
process.exit(hard ? 1 : 0);
