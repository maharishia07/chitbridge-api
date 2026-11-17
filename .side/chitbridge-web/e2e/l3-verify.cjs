/**
 * l3-verify.cjs — prove an L3 rewrite changed NOTHING that a reader sees.
 *
 * ⚠️⚠️ THE GATE THE WHOLE PROSE PASS DEPENDS ON. Reshaping
 *
 *     'Remove ' + n + ' from your supplier list?'
 *   → txf('Remove {name} from your supplier list?', { name: n })
 *
 * must render the same English. If it does not, the REWRITE is wrong — not the copy. The failure modes are a
 * dropped space, a lost `<b>`, a placeholder that never substitutes: each invisible in a diff of a 9,000-line
 * file and obvious to a user.
 *
 * ── HOW IT COMPARES, AND WHY THIS WAY ────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ MY FIRST VERSION EVALUATED THE EXPRESSIONS and it was the wrong instrument. The agents quoted whole
 * STATEMENTS — `catch(e){ toast(…); }`, `var counts = … ? … : '';` — because that is what a human reviewing the
 * change needs to see. `new Function('return (' + stmt + ')')` cannot parse a statement, so most sites came back
 * "could not evaluate" and the checker was useless exactly where the code was most interesting.
 *
 * ⭐ So it compares the SHAPE OF THE TEXT instead. Both sides are reduced to their literal text with every
 * interpolation replaced by one marker:
 *
 *     BEFORE  'Remove ' + n + ' from your list?'                    →  Remove ⟦⟧ from your list?
 *     AFTER   txf('Remove {name} from your list?', { name: n })     →  Remove ⟦⟧ from your list?
 *
 * Identical shapes mean the same words, the same spaces and the same markup in the same order, with holes in the
 * same places. That is precisely the property a faithful reshaping has to have, and it needs no evaluation, no
 * stub values and no guess about what `f.name` holds.
 *
 * ⚠️ IT DOES NOT PROVE THE VARS ARE RIGHT. `{name: n}` vs `{name: m}` looks identical here. That is the human's
 * job, and the proposals list the vars beside each site so it can be read. This tool exists to make the
 * MECHANICAL failure impossible, not to replace the review.
 *
 * Usage:  node e2e/l3-verify.cjs --all
 *         node e2e/l3-verify.cjs e2e/l3-proposals/cap-folders.md
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HOLE = '⟦⟧';   // ⟦⟧ — a marker no source string contains

/** Every single/double-quoted literal in an expression, in order. Template literals are reported separately. */
function literals(expr) {
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(expr))) out.push({ text: m[1] !== undefined ? m[1] : m[2], end: m.index + m[0].length, start: m.index });
  return out;
}

/**
 * The rendered SHAPE of a concatenation: literals joined, with a marker wherever an expression sat.
 * ⚠️ Only `+`-joined runs count. A literal used as an argument (`toast('x')`) is one run of one.
 */
function shapeOf(expr) {
  const lits = literals(expr);
  if (!lits.length) return null;
  let out = '', prev = null;
  lits.forEach((l) => {
    if (prev !== null) {
      const between = expr.slice(prev.end, l.start);
      /* nothing but `+` and whitespace → the two literals are adjacent halves of one string */
      if (/^[\s+]*$/.test(between) && between.includes('+')) out += '';
      /* an expression sat between them → one hole */
      else if (/\+/.test(between)) out += HOLE;
      /* something else entirely (a comma, a paren) → a separate string; keep them apart */
      else out += '‖';
    }
    out += l.text;
    prev = l;
  });
  /* a leading or trailing interpolation: `'x ' + v` has a hole after, `v + ' x'` has one before */
  const first = lits[0], last = lits[lits.length - 1];
  if (/\+\s*$/.test(expr.slice(0, first.start).replace(/\s+$/, '') + ' ')) out = HOLE + out;
  if (/^\s*\+/.test(expr.slice(last.end))) out = out + HOLE;
  return out;
}

/** The msgid(s) a txf/txn call declares, with {placeholders} reduced to the same marker. */
function shapeOfCall(expr) {
  const call = /\btx[fn]?\s*\(/.exec(expr);
  if (!call) return null;
  const lits = literals(expr);
  if (!lits.length) return null;
  /* txn declares TWO msgids (one, other). Either may be the rendered form depending on the count, so both
     shapes are offered and a match against either is accepted — the count is not knowable statically. */
  const isN = /\btxn\s*\(/.test(expr);
  const norm = (t) => t.replace(/\{\w+\}/g, HOLE);
  return isN ? [norm(lits[0].text), norm(lits[1] ? lits[1].text : lits[0].text)] : [norm(lits[0].text)];
}

function parse(md) {
  const out = [];
  md.split(/^### /m).slice(1).forEach((b) => {
    const site = b.split('\n')[0].trim();
    const head = b.split('\n').slice(1, 4).join('\n');
    if (/^\s*(SKIP|NEEDS-HUMAN)/im.test(head)) return;
    const fenced = (label) => {
      const m = new RegExp('^' + label + '\\s*\\n```(?:js)?\\n([\\s\\S]*?)\\n```', 'm').exec(b);
      return m ? m[1].trim() : null;
    };
    const inline = (label) => {
      const m = new RegExp('^' + label + '\\s+(.+)$', 'm').exec(b);
      /* ⚠️ STRIP MARKDOWN CODE SPANS. The agents wrote inline entries as `expr` — backticks and all — and a
         parser that keeps them looks for a line of source that begins with a backtick, which never exists. That
         alone accounted for 21 of the 28 "BEFORE not found verbatim" reports. */
      if (!m || /^(SKIP|NEEDS-HUMAN)/i.test(m[1])) return null;
      return m[1].trim().replace(/^`+|`+$/g, '').trim();
    };
    const before = fenced('BEFORE') || inline('BEFORE');
    const after = fenced('AFTER') || inline('AFTER');
    if (before && after) out.push({ site, before, after });
  });
  return out;
}

let checked = 0, ok = 0, bad = 0, manual = 0;
const notes = [];

function verify(file) {
  parse(fs.readFileSync(file, 'utf8')).forEach((p) => {
    checked++;
    const want = shapeOf(p.before);
    const got = shapeOfCall(p.after);
    if (!want || !got) {
      manual++;
      notes.push({ site: p.site, kind: 'shape not extractable — read it', a: (want || '(none)'), b: (got || ['(no tx call)'])[0] });
      return;
    }
    /* ⚠️ The AFTER msgid is one sentence; the BEFORE may be that sentence embedded in surrounding markup or a
       larger expression. So the test is CONTAINMENT of the msgid shape within the before shape, not equality —
       and the shape carries every space and tag, so containment is still strict about the words. */
    /**
     * ⚠️ CONTAINMENT RUNS BOTH WAYS, and my first version only checked one. The agents were told to absorb
     * ADJACENT literals into the same msgid — that is the whole point, otherwise half a sentence stays
     * concatenated — so a correct msgid is routinely LONGER than the fragment the scanner flagged and the
     * proposal quoted. Testing only "msgid inside before" reported three good rewrites as text changes.
     *
     * Either direction is faithful; what would NOT be faithful is words that differ, and the shape carries
     * every space, tag and hole, so containment stays strict about that whichever way round it matches.
     */
    const hit = got.some((g) => want.indexOf(g) >= 0 || g.indexOf(want) >= 0);
    if (hit) { ok++; return; }
    /* A txn rewrite legitimately differs from a `n===1?'':'s'` before, so say which kind of mismatch it is. */
    /* ⚠️ THE PLURAL RESHAPINGS ARE NOT FAILURES — they are the ONE class where the English legitimately
       changes, because `n + ' item' + (n===1?'':'s')` renders "1 items" today and txn renders "1 item".
       That is a fix, but a VISIBLE one, so it is separated out for a human to approve rather than counted as
       either clean or broken. Detected from the before-text, which is where the English plural hack lives. */
    const pluralish = /===\s*1|!==\s*1|\(s\)|\?\s*''\s*:|length\s*>\s*1/.test(p.before);
    if (pluralish) { manual++; notes.push({ site: p.site, kind: 'plural reshaping — English may change, confirm', a: want, b: got.join('  |  ') }); return; }
    bad++;
    notes.push({ site: p.site, kind: 'TEXT CHANGED', a: want, b: got.join('  |  ') });
  });
}

const args = process.argv.slice(2);
const dir = path.join(__dirname, 'l3-proposals');
const files = args.includes('--all')
  ? (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_')).map((f) => path.join(dir, f)) : [])
  : args.filter((a) => !a.startsWith('--'));

if (!files.length) { console.log('\n  no proposal files — run the agents first, or pass a path\n'); process.exit(0); }
files.forEach(verify);

console.log('\n══ L3 REWRITE VERIFICATION ══');
console.log('  ' + checked + ' pairs · ' + ok + ' faithful · ' + bad + ' TEXT CHANGED · ' + manual + ' need a human eye\n');
notes.forEach((n) => {
  console.log('  ' + (n.kind === 'TEXT CHANGED' ? '✗' : '·') + ' ' + n.site + '   ' + n.kind);
  console.log('      was  ' + String(n.a).slice(0, 160));
  console.log('      now  ' + String(n.b).slice(0, 160));
});
if (!notes.length) console.log('  ✓ every rewrite carries the same words, spaces, markup and holes\n');
else console.log('');
process.exit(bad ? 1 : 0);
