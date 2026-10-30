'use strict';
/*
 * OWNS      the ONE list of files that hold the chits route's code (LEAN-PLAN §7 point 4): routes/chits.js and what has been lifted out of it
 *           (lib/chit-move.js, lib/chit-crossing.js), plus the globs that later splits will land in. Nothing else names them.
 * CALLED BY every test, guard and *-breaks.cjs script that reads the chits code BY PATH (tests/*.test.*, scripts/*-breaks.cjs, scripts/fn-size.cjs).
 *           A reader that must pin ONE file on purpose does not use it and says why in its own header.
 * WHY       a split moves code out of routes/chits.js; a guard that still reads only routes/chits.js then stays green on a file that no longer
 *           holds the code. Add the new file (or a glob) HERE once and every reader follows; tests/chits-files.test.cjs fails when a chit file
 *           exists that the list does not reach.
 * FLOW      a reader gives its repo root ──▶ list() expands FILES + GLOBS to the files that exist ──▶ read() joins their text, or anchorFile() names the one holding an anchor
 * CARD      qa/lint-ratchet
 */
const fs = require('fs');
const path = require('path');

/** routes/chits.js first: positions and "first match" scans keep their old meaning */
const FILES = ['routes/chits.js', 'lib/chit-move.js', 'lib/chit-crossing.js'];
/** future splits land here: a '*' in the last segment matches within one folder, a trailing '/' means the whole folder tree */
const GLOBS = ['routes/chits-*.js', 'lib/chit-send/'];
/** the route file itself, for a reader that pins it on purpose */
const MAIN = FILES[0];

/** the entries of a folder, or none when it does not exist (a split that has not happened yet is not an error) */
function entriesOf(folder) {
  return fs.existsSync(folder) ? fs.readdirSync(folder, { withFileTypes: true }) : [];
}

/** every .js/.cjs file under a folder, depth first, in name order, pushed onto `found` */
function walk(folder, found) {
  for (const entry of entriesOf(folder).sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const inside = path.join(folder, entry.name);
    if (entry.isDirectory()) walk(inside, found);
    else if (/\.c?js$/.test(entry.name)) found.push(inside);
  }
}

/** the files under `root` that one GLOBS entry names (a folder tree, or a name pattern within one folder) */
function expand(root, glob) {
  const relativeTo = (absolute) => path.relative(root, absolute).split(path.sep).join('/');
  if (glob.endsWith('/')) {
    const found = [];
    walk(path.join(root, glob), found);
    return found.map(relativeTo);
  }
  const folder = path.dirname(glob);
  const pieces = path.basename(glob).split('*').map((piece) => piece.replace(/[^A-Za-z0-9_-]/g, (character) => '\\' + character));
  const matcher = new RegExp('^' + pieces.join('[^/]*') + '$');
  return entriesOf(path.join(root, folder)).map((entry) => entry.name).filter((name) => matcher.test(name)).sort().map((name) => folder + '/' + name);
}

/** every chits file that exists under `root`, routes/chits.js first, no duplicates */
function list(root) {
  const seen = new Set(), found = [];
  for (const relative of FILES.concat(...GLOBS.map((glob) => expand(root, glob)))) {
    if (seen.has(relative) || !fs.existsSync(path.join(root, relative))) continue;
    seen.add(relative); found.push(relative);
  }
  return found;
}

const textOf = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');

/** all of their text in list order (LF-normalised), for a test that asks "is this code in the chits route, wherever it lives now" */
function read(root) {
  return list(root).map((relative) => textOf(root, relative)).join('\n');
}

/** the chits file whose text holds `anchor` exactly once; `file` unchanged when it is not a chits file or no file holds it once (the caller then reports "anchor not found") */
function anchorFile(root, file, anchor) {
  if (!FILES.includes(file)) return file;
  const holders = list(root).filter((relative) => textOf(root, relative).split(anchor).length === 2);
  return holders.length === 1 ? holders[0] : file;
}

module.exports = { FILES, GLOBS, MAIN, list, read, anchorFile };
