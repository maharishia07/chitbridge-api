/**
 * e2e/wrap-apply.cjs — wrap the bare LABEL bucket in tx(), one mechanical edit per site.
 *
 * Run with --dry (default) to see every change; run with --apply to make them.
 *
 * ⚠️⚠️ THE SAME LABEL NEEDS TWO DIFFERENT EDITS DEPENDING ON WHERE IT SITS, and getting it wrong does not
 * throw — it SHIPS. Inside a template literal the wrap is `${tx('X')}`; inside ordinary string concatenation
 * it is `' + tx('X') + '`. Use the template form in a concatenated string and the reader sees the literal
 * characters `${tx('Save')}` on screen; use the concat form inside a template literal and you break the quote
 * nesting. Neither is caught by `node --check` in every case.
 *
 * ⭐ SO THE CONTEXT IS DETECTED, NOT ASSUMED: count unescaped backticks before the match on that line. An odd
 * number means we are inside a template literal. It is a heuristic, which is exactly why this defaults to a
 * DRY RUN and prints every edit for reading before anything is written.
 *
 * ⚠️ AND IT REFUSES THE AMBIGUOUS ONES rather than guessing. A line where the label appears more than once, or
 * where quoting cannot be read confidently, is SKIPPED and listed. Ninety mechanical edits plus nine done by
 * hand is a better trade than ninety-nine edits where a few are silently wrong.
 */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const W = path.join(__dirname, '..', 'public');
const entries = JSON.parse(fs.readFileSync(path.join(__dirname, 'strings.catalogue.json'), 'utf8'));

/* group by file so each file is read and written once */
const byFile = {};
for (const e of entries) {
  const i = e.source.lastIndexOf(':');
  const f = e.source.slice(0, i);
  (byFile[f] = byFile[f] || []).push({ msgid: e.msgid, line: +e.source.slice(i + 1) });
}

let planned = 0; const skipped = [];
const preview = [];

for (const [file, list] of Object.entries(byFile)) {
  const full = path.join(W, file);
  const fileText = fs.readFileSync(full, 'utf8');
  const lines = fileText.split(/\r?\n/);
  /* absolute offset of each line, so the backtick count can run from the top of the file */
  const lineStart = [];
  { let off = 0; const nl = fileText.indexOf('\r\n') >= 0 ? 2 : 1;
    for (let i = 0; i < lines.length; i++) { lineStart.push(off); off += lines[i].length + nl; } }
  let touched = false;

  for (const item of list) {
    const idx = item.line - 1;
    const line = lines[idx];
    if (line == null) { skipped.push(file + ':' + item.line + '  line missing'); continue; }

    const needle = '>' + item.msgid + '<';
    const at = line.indexOf(needle);
    if (at < 0) { skipped.push(file + ':' + item.line + '  ' + JSON.stringify(item.msgid) + ' not found on the line'); continue; }
    if (line.indexOf(needle, at + 1) >= 0) {
      skipped.push(file + ':' + item.line + '  ' + JSON.stringify(item.msgid) + ' appears twice — ambiguous');
      continue;
    }
    /* an apostrophe in the label would need escaping inside the tx('…') argument — hand these over */
    if (item.msgid.indexOf("'") >= 0) {
      skipped.push(file + ':' + item.line + '  ' + JSON.stringify(item.msgid) + " contains an apostrophe");
      continue;
    }

    /**
     * ⚠️⚠️ COUNTING BACKTICKS ON THE LINE ALONE WAS WRONG, AND WRONG IN THE DANGEROUS DIRECTION. app.html is
     * built from MULTI-LINE template literals: a template opened three lines up leaves zero backticks before
     * the match on this line, so every site read as "concat" — 87 of 87, which is what gave it away. Injecting
     * `' + tx('X') + '` inside a template literal does not throw; it prints those characters on screen.
     *
     * ⭐ So the count runs from the START OF THE FILE. ⚠️ And it strips comments first, because this codebase
     * (and my own commenting style) uses backticks around `identifiers` constantly — counting those would
     * flip the parity at random and produce exactly the silent breakage this is trying to avoid.
     */
    const prefixRaw = fileText.slice(0, lineStart[idx] + at);
    const prefix = prefixRaw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')          /* block comments */
      .replace(/(^|\n)\s*(\/\/|\*)[^\n]*/g, '$1') /* line comments and jsdoc continuation lines */
      .replace(/\\`/g, ' ');                      /* an escaped backtick is not a delimiter */
    let inTemplate = ((prefix.match(/`/g) || []).length % 2) === 1;

    /**
     * ⚠️⚠️ THE BACKTICK COUNT STILL MISSED THREE, AND A BROWSER FOUND THEM, NOT A TEST. `' + tx('Build
     * preview') + '` was printed literally at the top of every screen; two more sat on the chit detail, which
     * `render-smoke` does not render. **Both forms are valid JavaScript, so nothing throws and no syntax check
     * fires — only looking at the page catches it.**
     *
     * ⭐ SO THE LINE ITSELF IS ASKED A SECOND QUESTION, and it is a stronger one than the parity count: if the
     * text between here and the label contains an ACTIVE `${…}` interpolation, we are unambiguously inside a
     * template literal, because `${}` is inert anywhere else. A line cannot be both.
     *
     * ⚠️ IT ONLY LOOKS AT THE SEGMENT AFTER THE LAST `}`. A `${cond ? '<b>' + tx('X') + '</b>' : ''}` is a
     * concat INSIDE an interpolation and is correct as it stands — counting the whole line would flip those
     * and break five sites that were right.
     */
    const seg = line.slice(0, at);
    const afterLastClose = seg.slice(seg.lastIndexOf('}') + 1);
    if (/\$\{[a-zA-Z_(!]/.test(afterLastClose)) inTemplate = true;
    const wrap = inTemplate ? ('>${tx(\'' + item.msgid + '\')}<') : ('>\' + tx(\'' + item.msgid + '\') + \'<');

    lines[idx] = line.slice(0, at) + wrap + line.slice(at + needle.length);
    touched = true; planned++;
    if (preview.length < 12) preview.push('   ' + (file + ':' + item.line).padEnd(26) + (inTemplate ? 'tmpl  ' : 'concat') + '  ' + JSON.stringify(item.msgid));
  }

  /**
   * ⚠️ PRESERVE THE FILE'S OWN LINE ENDINGS. app.html is CRLF; `join('\n')` would rewrite every line in the
   * file and bury 87 real edits inside a ten-thousand-line diff nobody could review — and an unreviewable
   * diff on the hot file is how a mechanical change stops being safe.
   */
  if (touched && APPLY) fs.writeFileSync(full, lines.join(fileText.indexOf('\r\n') >= 0 ? '\r\n' : '\n'));
}

console.log('\n  ' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n');
console.log('    would wrap   ' + String(planned).padStart(4));
console.log('    skipped      ' + String(skipped.length).padStart(4) + '   (listed below — do these by hand)\n');
preview.forEach((p) => console.log(p));
if (planned > preview.length) console.log('   … and ' + (planned - preview.length) + ' more');
if (skipped.length) { console.log('\n  SKIPPED\n'); skipped.forEach((s) => console.log('   ' + s)); }
console.log('');
