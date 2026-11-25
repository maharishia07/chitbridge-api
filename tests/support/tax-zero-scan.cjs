/**
 * tests/support/tax-zero-scan.cjs — TAX-EXPLICIT (1129): finds, in the tax-touching api files, (1) a tax-ish figure defaulted to zero (`<rate|cess|tax|gst|vat|slab|pct|percent> || 0` / `?? 0`)
 * and (2) a catch that swallows (no rethrow, no log.fellBack / log.orElse / log.*, no answer to the caller). Pure text scan; the allow-list is tests/support/tax-zero-allow.json.
 * OWNS      scan(root) → [{ file, kind: 'zero' | 'catch', text }]   CALLED BY tests/tax-zero-guard.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');

/** the tax-touching files: every non-adopted lib/routes file whose NAME says tax, plus the files that carry a tax figure through (named by the lane) */
const NAMED = ['lib/services.js', 'lib/catalogue-view.js', 'lib/books-hooks.js', 'lib/till-match.js', 'lib/books-return-split.js'];
function taxFiles(root) {
  const out = [];
  for (const dir of ['lib', 'routes']) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      const rel = dir + '/' + name;
      if (!/\.js$/.test(name) || !/tax|gst|vat/i.test(name)) continue;
      if (/^\/\* ADOPTED/.test(fs.readFileSync(path.join(root, rel), 'utf8').slice(0, 200))) continue; /* adopted engine files are changed in engines, guarded there */
      if (/\.browser\.js$/.test(name)) continue;
      out.push(rel);
    }
  }
  return out.concat(NAMED.filter((rel) => fs.existsSync(path.join(root, rel)))).sort();
}

const TAXISH = '(?:rate|cess|tax|gst|vat|slab|pct|percent)';
const ZERO_RE = /\b\w*(?:rate|cess|tax|gst|vat|slab|pct|percent)\w*\)?(?:\.\w+|\[[^\]]*\]|\([^()]*\))*\s*(?:\|\||\?\?)\s*0(?![\d.])/i;

const norm = (text) => text.replace(/\s+/g, ' ').trim();
/** the text between the bracket at `open` and its match (strings and comments are not skipped: a rare brace in a string only widens the body, which is the safe side) */
function bodyAt(src, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}
/** a catch that says something: rethrows, logs (log.fellBack · log.orElse · any log.* / cbLog.*), or answers the caller */
const SAYS_WORDS = ['throw ', 'fellBack', 'orElse', 'warn(', 'error(', 'swallowed(', 'problem(', 'next(', 'res.status', 'res.json', 'res.send', 'reject(', 'return refus'];
const SAYS = { test: (body) => SAYS_WORDS.some((word) => body.includes(word)) };

function scanFile(root, rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const hits = [];
  src.split('\n').forEach((line) => {
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '');
    if (ZERO_RE.test(code)) hits.push({ file: rel, kind: 'zero', text: norm(line) });
  });
  const reTry = /\bcatch\s*(?:\([^)]*\))?\s*\{/g;
  let m;
  while ((m = reTry.exec(src))) {
    const body = bodyAt(src, m.index + m[0].length - 1, '{', '}');
    if (!SAYS.test(body)) hits.push({ file: rel, kind: 'catch', text: norm(src.slice(m.index, m.index + m[0].length) + ' ' + body.slice(1, 90)) });
  }
  const reArrow = /\.catch\s*\(/g;
  while ((m = reArrow.exec(src))) {
    const body = bodyAt(src, m.index + m[0].length - 1, '(', ')');
    if (!SAYS.test(body)) hits.push({ file: rel, kind: 'catch', text: norm('.catch ' + body.slice(0, 100)) });
  }
  return hits;
}
function scan(root) {
  return taxFiles(root).flatMap((rel) => scanFile(root, rel));
}
module.exports = { scan, taxFiles, scanFile };
