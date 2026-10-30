'use strict';
/*
 * OWNS      the ONE list of files that hold the chits route's code (LEAN-PLAN §7 point 4): routes/chits.js and what has been lifted out of it
 *           (lib/chit-move.js, lib/chit-crossing.js), plus the globs that later splits will land in. Nothing else names them.
 * CALLED BY every test, guard and *-breaks.cjs script that reads the chits code BY PATH (tests/*.test.*, scripts/*-breaks.cjs, scripts/fn-size.cjs).
 *           A reader that must pin ONE file on purpose does not use it and says why in its own header.
 * WHY       a split moves code out of routes/chits.js; a guard that still reads only routes/chits.js then stays green on a file that no longer
 *           holds the code. Add the new file (or a glob) HERE once and every reader follows; tests/chits-files.test.cjs fails when a chit file
 *           exists that the list does not reach.
 * CARD      28-platform-and-operations/maintainability
 */
const fs = require('fs');
const path = require('path');

/** routes/chits.js first: positions and "first match" scans keep their old meaning */
const FILES = ['routes/chits.js', 'lib/chit-move.js', 'lib/chit-crossing.js'];
/** future splits land here: a '*' in the last segment matches within one folder, a trailing '/' means the whole folder tree */
const GLOBS = ['routes/chits-*.js', 'lib/chit-send/'];
/** the route file itself, for a reader that pins it on purpose */
const MAIN = FILES[0];

function walk(abs, out) {
  let names;
  try { names = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
  for (const d of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(abs, d.name);
    if (d.isDirectory()) walk(p, out); else if (/\.c?js$/.test(d.name)) out.push(p);
  }
}

function expand(root, glob) {
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');
  if (glob.endsWith('/')) { const out = []; walk(path.join(root, glob), out); return out.map(rel); }
  const dir = path.dirname(glob);
  const parts = path.basename(glob).split('*').map((p) => p.replace(/[^A-Za-z0-9_-]/g, (c) => '\\' + c));
  const re = new RegExp('^' + parts.join('[^/]*') + '$');
  let names = [];
  try { names = fs.readdirSync(path.join(root, dir)); } catch (e) { return []; }
  return names.filter((n) => re.test(n)).sort().map((n) => dir + '/' + n);
}

/** every chits file that exists under `root`, routes/chits.js first, no duplicates */
function list(root) {
  const seen = new Set(), out = [];
  for (const rel of FILES.concat(...GLOBS.map((g) => expand(root, g)))) {
    if (seen.has(rel) || !fs.existsSync(path.join(root, rel))) continue;
    seen.add(rel); out.push(rel);
  }
  return out;
}

const textOf = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

/** all of their text in list order (LF-normalised), for a test that asks "is this code in the chits route, wherever it lives now" */
function read(root) {
  return list(root).map((rel) => textOf(root, rel)).join('\n');
}

/** the chits file whose text holds `anchor` exactly once; `file` unchanged when it is not a chits file or no file holds it once (the caller then reports "anchor not found") */
function anchorFile(root, file, anchor) {
  if (!FILES.includes(file)) return file;
  const hits = list(root).filter((rel) => textOf(root, rel).split(anchor).length === 2);
  return hits.length === 1 ? hits[0] : file;
}

module.exports = { FILES, GLOBS, MAIN, list, read, anchorFile };
