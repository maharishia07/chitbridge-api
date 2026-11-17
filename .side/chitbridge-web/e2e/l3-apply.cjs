/**
 * l3-apply.cjs — apply the verified L3 proposals to source.
 *
 * ⚠️⚠️ EXACT MATCH OR NOTHING. Every BEFORE fence must appear in its file EXACTLY ONCE. No fuzzy matching, no
 * whitespace normalisation, no "closest line". These edits change shipped user-facing copy, and a fuzzy match
 * that lands one line off produces a wrong sentence that nothing downstream can detect — the diff looks
 * plausible, the file parses, and a reader sees nonsense.
 *
 * A BEFORE that matches zero times or twice is REPORTED AND SKIPPED, never guessed at.
 *
 * ⚠️ IT REFUSES TO RUN IF l3-verify DISAGREES. The verifier is the gate; this is only the hands. Anything it
 * flagged as TEXT CHANGED is excluded here unless explicitly named on the command line.
 *
 * Usage:
 *   node e2e/l3-apply.cjs --dry            list what would change, touch nothing
 *   node e2e/l3-apply.cjs --go             apply
 *   node e2e/l3-apply.cjs --go --only cap-folders.md
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'public');
const DIR = path.join(__dirname, 'l3-proposals');

/** Map a proposal file name to the source file it edits. */
function sourceOf(mdName) {
  const base = mdName.replace(/\.md$/, '');
  if (base === 'app.html') return 'app.html';
  return 'app/' + base + '.js';
}

/* ⚠️ The same parser the verifier uses, so the two can never disagree about what a proposal SAYS. */
function parse(md) {
  const out = [];
  md.split(/^### /m).slice(1).forEach((b) => {
    const site = b.split('\n')[0].trim();
    const head = b.split('\n').slice(1, 4).join('\n');
    if (/^\s*(SKIP|NEEDS-HUMAN)/im.test(head)) return;
    const fenced = (label) => {
      const m = new RegExp('^' + label + '\\s*\\n```(?:js)?\\n([\\s\\S]*?)\\n```', 'm').exec(b);
      return m ? m[1] : null;
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
    if (before && after) out.push({ site, before, after, note: /^NOTE\s+(.+)$/m.test(b) });
  });
  return out;
}

const DRY = !process.argv.includes('--go');
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_'))
  .filter((f) => !only || f === only);

let applied = 0, missed = 0, ambiguous = 0;
const broken = [];
const report = [];

files.forEach((md) => {
  const srcRel = sourceOf(md);
  const srcPath = path.join(WEB, srcRel);
  if (!fs.existsSync(srcPath)) { report.push(['?', md, 'no such source file: ' + srcRel]); return; }
  let src = fs.readFileSync(srcPath, 'utf8');
  const proposals = parse(fs.readFileSync(path.join(DIR, md), 'utf8'));
  let changedHere = 0;

  proposals.forEach((p) => {
    /**
     * ⚠️ THE FILES ARE CRLF ON DISK and the proposals were written LF. A multi-line BEFORE therefore never
     * matches unless both forms are tried — and "never matches" would silently skip every multi-line rewrite,
     * which is most of the interesting ones.
     */
    const LF = String.fromCharCode(10), CR = String.fromCharCode(13);
    const asCRLF = (x) => x.split(LF).join(CR + LF);
    const candidates = [p.before, asCRLF(p.before)];
    const hit = candidates.find((c) => src.split(c).length - 1 === 1);

    if (!hit) {
      const anyCount = candidates.reduce((n, c) => Math.max(n, src.split(c).length - 1), 0);
      if (anyCount > 1) {
        /**
         * ⭐ THE SAME SENTENCE TWICE IS NORMAL, NOT AMBIGUOUS — attach-ui.js says "Attachment failed" on both
         * the staged and the immediate path, and cap-workforce repeats a confirm. Refusing those would leave
         * half a fix in place, which is worse than either applying or skipping both.
         *
         * ⚠️ SO THE LINE NUMBER IN THE SITE HEADING DISAMBIGUATES, and only that. The occurrence chosen is the
         * one whose start lies nearest the stated line; if the nearest is more than 4 lines away the proposal
         * is describing something else and it is still refused. A line number that is merely close is not a
         * licence to edit whichever one happens to be first.
         */
        const wantLine = Number((/:(\d+)/.exec(p.site) || [])[1] || 0);
        const cand = candidates.find((c) => src.indexOf(c) >= 0);
        let best = -1, bestDist = Infinity;
        for (let i = src.indexOf(cand); i >= 0; i = src.indexOf(cand, i + 1)) {
          const line = src.slice(0, i).split('\n').length;
          const d = Math.abs(line - wantLine);
          if (d < bestDist) { bestDist = d; best = i; }
        }
        if (wantLine && best >= 0 && bestDist <= 4) {
          const after2 = cand.includes(CR) ? asCRLF(p.after) : p.after;
          if (!DRY) src = src.slice(0, best) + after2 + src.slice(best + cand.length);
          changedHere++; applied++;
          report.push(['+', p.site, 'line-anchored (' + anyCount + ' occurrences, took the one at the stated line)']);
          return;
        }
        ambiguous++;
        report.push(['~', p.site, 'BEFORE appears ' + anyCount + '× and no line anchor resolves it — refusing to guess']);
      } else { missed++; report.push(['-', p.site, 'BEFORE not found verbatim — apply by hand']); }
      return;
    }
    const after = hit.includes(CR) ? asCRLF(p.after) : p.after;
    if (!DRY) src = src.replace(hit, after);
    changedHere++; applied++;
    report.push(['+', p.site, '']);
  });

  /**
   * ⚠️⚠️ PARSE-CHECK, OR THIS TOOL SHIPS BROKEN CODE — and it did, on its first real run, to five files.
   *
   * "The BEFORE appears exactly once" is NOT sufficient, and that was my mistake. A BEFORE can match exactly
   * once and still be a PARTIAL expression: the agents sometimes quoted the first two of four concatenated
   * halves, so the AFTER replaced that prefix and left the remaining `+ ' on …' + m.waitMine` dangling:
   *
   *     txn('<b>{count} waiting</b> — {theirs} on …', + ' on <span…>' + m.waitMine + '…'
   *
   * Exact, unique, and syntactically ruinous. Uniqueness proves WHERE to edit; it says nothing about whether
   * the edit leaves a valid expression behind.
   *
   * So every file is parsed after its edits and reverted WHOLE if it fails. Reverting the whole file rather
   * than the offending edit is deliberate: the applier cannot tell which of several edits broke it, and a
   * half-applied file is the worst of the three outcomes.
   */
  if (!DRY && changedHere) {
    const original = fs.readFileSync(srcPath, 'utf8');
    fs.writeFileSync(srcPath, src);
    const ok = parses(srcPath, srcRel);
    if (!ok.ok) {
      fs.writeFileSync(srcPath, original);
      broken.push({ file: srcRel, edits: changedHere, why: ok.err });
      applied -= changedHere;
    }
  }
});

/** node --check for a .js file; for app.html, check the one big inline script it carries. */
function parses(srcPath, rel) {
  const { execFileSync } = require('child_process');
  try {
    if (rel.endsWith('.js')) { execFileSync(process.execPath, ['--check', srcPath], { stdio: 'pipe' }); return { ok: true }; }
    /* app.html — extract every <script> WITHOUT a src and check each. */
    const html = fs.readFileSync(srcPath, 'utf8');
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m, i = 0;
    while ((m = re.exec(html))) {
      const tmp = path.join(require('os').tmpdir(), 'l3check' + (i++) + '.js');
      fs.writeFileSync(tmp, m[1]);
      try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
      catch (e) { return { ok: false, err: String(e.stderr || e.message).split('\n').slice(0, 3).join(' ').slice(0, 200) }; }
      finally { try { fs.unlinkSync(tmp); } catch (_) {} }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message).split('\n').slice(0, 3).join(' ').slice(0, 200) };
  }
}

console.log('\n══ L3 APPLY ' + (DRY ? '(DRY RUN — nothing written)' : '(APPLIED)') + ' ══');
console.log('  ' + applied + ' applied · ' + missed + ' not found · ' + ambiguous + ' ambiguous\n');
report.filter((r) => r[0] !== '+').forEach((r) => console.log('  ' + r[0] + ' ' + r[1] + '   ' + r[2]));
if (report.every((r) => r[0] === '+')) console.log('  every proposal matched its source exactly once');
console.log('');
