/**
 * e2e/html-syntax.cjs — the JavaScript inside app.html must parse.
 *
 * ⚠️⚠️ NOTHING CHECKED THIS, AND IT TOOK THE WHOLE SUITE DOWN. `node --check` refuses an .html file, so the
 * ~10,000 lines of JavaScript inside `app.html` — the largest single source file in the product — were the one
 * place a syntax error could land unnoticed. It did: a hand edit used `${txf(…)}` inside a SINGLE-QUOTED
 * concat string, `txf('The` closed the string, and `The` became a bare identifier.
 *
 * ⭐ AND EVERY EXISTING CHECK SAID FINE. `render-smoke` renders 27 screens from the capability files and never
 * evaluates app.html's inline script. The commit went out green; the next Playwright run failed in
 * `auth.setup` with *"waiting for onb-getstarted"* — a timeout on the welcome screen, which reads like a
 * broken selector or a slow server, not a parse error three thousand lines away.
 *
 * ⭐⭐ THE FAILURE POINTED AT THE WRONG PLACE, WHICH IS THE REAL COST. A parse error in one script block kills
 * every function defined in it, so the symptom appears wherever the app next needs one of them. Time went into
 * rate limits and fixture drift before anything looked at the file that had actually changed.
 *
 * ⚠️ It parses, it does not run — `new Function` compiles without executing, so nothing here touches the DOM
 * or the network. That is the whole job: catch what `node --check` would have caught if the file ended in .js.
 */
const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(W).filter((f) => f.endsWith('.html'));

let pass = 0, fail = 0;

for (const f of files) {
  const html = fs.readFileSync(path.join(W, f), 'utf8');
  /* inline blocks only — a <script src> is a real .js file and node --check already covers those */
  const RE = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0, bad = 0;
  while ((m = RE.exec(html))) {
    n++;
    const startLine = html.slice(0, m.index).split(/\r?\n/).length;
    try {
      // eslint-disable-next-line no-new-func
      new Function(m[1]);
    } catch (e) {
      bad++; fail++;
      console.error('  ✗ ' + f + '  block ' + n + ' (from line ' + startLine + '): ' + e.message);
      /**
       * ⭐ POINT AT THE LINE. `new Function` reports a message and no position, and hunting a missing quote
       * through ten thousand lines by eye is how this gets ignored rather than fixed. Writing the block out
       * and letting node --check locate it costs nothing and turns the message into an address.
       */
      const tmp = path.join(require('os').tmpdir(), 'cb-html-syntax-block.js');
      fs.writeFileSync(tmp, m[1]);
      console.error('    the block was written to ' + tmp + ' — run:  node --check "' + tmp + '"');
      console.error('    add ' + (startLine - 1) + ' to the line it reports to find it in ' + f);
    }
  }
  if (!bad) { pass++; console.log('  ✓ ' + f.padEnd(26) + n + ' inline block(s) parse'); }
}

console.log('\n  ══ ' + pass + ' file(s) clean · ' + fail + ' broken block(s) ══\n');
process.exit(fail ? 1 : 0);
