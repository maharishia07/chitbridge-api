'use strict';
/**
 * modal-safe-repaint.cjs — A BACKGROUND READ MUST NEVER REPAINT OVER SOMEONE'S OPEN WORK.
 *
 * ⚠️⚠️ THIS BUG HAS NOW HAPPENED THREE TIMES, and the codebase already documented it after the first:
 *
 *   > "renderApp() rebuilds the whole shell, and the shell template contains an EMPTY `<div id="modalhost">`.
 *   > So any renderApp while a modal is open deletes that modal — and everything typed into it… Reproduced:
 *   > modalhost went from 3.7kB to 0 while idling inside compose."
 *
 * `bgRenderApp()` was written in answer to it and yields while a modal is up. But it was applied to the two
 * call sites known at the time, and **thirteen loaders kept calling `renderApp()` directly** — including one I
 * added myself the day before writing this. A fix applied to the instances rather than to the CLASS is a fix
 * with a shelf life.
 *
 * ⭐ THE RULE, and why it is exactly this narrow: a LOADER resolves whenever the network feels like it, which
 * may be a second after the person opened a modal and started typing. A navigation, a send or a screen change
 * is different — the person just asked for it, so it must always paint. That distinction is why this forbids
 * `renderApp()` in `load*` functions and nowhere else.
 *
 * ⚠️ `bgRenderApp()` is not a weaker paint: with no modal open it repaints identically. It only declines to
 * destroy something a person is in the middle of.
 *
 * Athi, 2026-08-23, on the third occurrence: *"add the guard."*
 */
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const files = ['app.html'].concat(
  fs.readdirSync(path.join(WEB, 'app')).filter((f) => f.endsWith('.js')).map((f) => 'app/' + f));

const fails = [];
let scanned = 0;

for (const rel of files) {
  const src = fs.readFileSync(path.join(WEB, rel), 'utf8');
  for (const m of src.matchAll(/(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    const name = m[1];
    /* Loaders only: `loadFoo`, `iamLoadBar`, `acLoadDocs`. */
    if (!/^(load|.*Load)/.test(name)) continue;
    scanned++;

    /* Brace-match the body. Crude on purpose — an over-long body can only over-report, which fails loudly. */
    const open = src.indexOf('{', m.index);
    let d = 0;
    let end = -1;
    for (let i = open; i < src.length && i < open + 40000; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (!d) { end = i; break; } }
    }
    if (end < 0) continue;
    /**
     * ⚠️⚠️ COMMENT BODIES ARE BLANKED BEFORE SCANNING, AND THIS BIT IMMEDIATELY. Fixing the last offender
     * (cap-match.js) meant writing a comment explaining WHY it is now `bgRenderApp()` — and that comment
     * names `renderApp()`, so the guard flagged the comment describing its own fix. A guard that fails on
     * the note explaining the fix teaches people to delete the note.
     * ⭐ Blanked, not stripped, so every byte offset — and therefore every reported line number — is
     * unchanged. Same treatment, same day, as e2e/token-check.cjs. [[feedback-silence-is-the-bug]]
     */
    const body = src.slice(open, end)
      .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));

    /* ⚠️ `[^g]` so `bgRenderApp()` does not match as `renderApp()` — the fix would flag itself. */
    for (const hit of body.matchAll(/([^g])\brenderApp\s*\(\)/g)) {
      const line = src.slice(0, open + hit.index).split(/\r?\n/).length;
      fails.push(`${rel}:${line}  ${name}() repaints the shell directly — use bgRenderApp()`);
    }
  }
}

console.log('\n── a loader never repaints over an open modal ──');
console.log(`  ${scanned} loader(s) across ${files.length} file(s)`);
fails.forEach((f) => console.error('  x ' + f));
if (!fails.length) console.log('  OK — every loader repaints through bgRenderApp()\n');
else console.error('\n  A loader resolves whenever the network does, which may be while someone is typing in a\n'
  + '  modal. bgRenderApp() paints identically when nothing is open, and yields when something is.\n');

process.exit(fails.length ? 1 : 0);
