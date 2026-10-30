/**
 * chits-files.test.cjs - tools/chits-files.cjs, the ONE list of files that hold the chits route's code (LEAN-PLAN §8 #4).
 *   1. the list reaches the route and the two lifts (lib/chit-move.js, lib/chit-crossing.js), routes/chits.js first
 *   2. a split lands in the list by its glob alone (routes/chits-*.js, lib/chit-send/**) - proved on a throwaway tree
 *   3. anchorFile finds the file that holds a break's anchor exactly once, wherever the code lives now
 *   4. no test or script reads routes/chits.js by a literal path any more, except the readers pinned on purpose below
 * Offline: files only. Run: node tests/chits-files.test.cjs
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const CF = require('../tools/chits-files.cjs');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

ok('the list starts with routes/chits.js and holds the two lifts', CF.list(API)[0] === 'routes/chits.js' && ['lib/chit-move.js', 'lib/chit-crossing.js'].every((f) => CF.list(API).includes(f)), CF.list(API).join(' '));
ok('every file the list names exists (a rename would leave the list pointing at nothing)', CF.FILES.every((f) => fs.existsSync(path.join(API, f))), CF.FILES.join(' '));
ok('read() holds the route and a lifted function (moveStatus)', /async function moveStatus\(/.test(CF.read(API)) && /^ {2}'\/send',$/m.test(CF.read(API)));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chits-files-'));
try {
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), text); };
  put('routes/chits.js', 'A\nonly-in-route\n');
  put('routes/chits-send.js', 'B\nonly-in-split\n');
  put('routes/chitsy.js', 'not a chits file\n');
  put('lib/chit-move.js', 'C\nboth\n');
  put('lib/chit-send/deep/step.js', 'D\nboth\n');
  put('lib/chit-send/notes.md', 'not code\n');
  const got = CF.list(tmp);
  ok('a new routes/chits-*.js and a file under lib/chit-send/ join the list with no edit to the list', got.includes('routes/chits-send.js') && got.includes('lib/chit-send/deep/step.js'), got.join(' '));
  ok('a look-alike (routes/chitsy.js) and a non-code file stay out', !got.includes('routes/chitsy.js') && !got.includes('lib/chit-send/notes.md'), got.join(' '));
  ok('a file that does not exist is skipped, not an error (lib/chit-crossing.js is absent here)', !got.includes('lib/chit-crossing.js'));
  ok('anchorFile: an anchor now only in a split file is found there', CF.anchorFile(tmp, 'routes/chits.js', 'only-in-split') === 'routes/chits-send.js');
  ok('anchorFile: an anchor still in the route stays in the route', CF.anchorFile(tmp, 'routes/chits.js', 'only-in-route') === 'routes/chits.js');
  ok('anchorFile: an anchor in two files is ambiguous - the caller keeps the named file and reports it', CF.anchorFile(tmp, 'routes/chits.js', 'both') === 'routes/chits.js');
  ok('anchorFile: any other file is left alone', CF.anchorFile(tmp, 'lib/mint.js', 'only-in-split') === 'lib/mint.js');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

/* 4 - the readers: a literal read of the chits route (readFileSync / read( / src( with routes/chits.js on the line) must go through the list */
const PINNED = {
  /* none: every by-path reader of the chits code uses the list. A reader that must pin ONE file on purpose is named here WITH its reason. */
};
const READS = /(readFileSync|\bread|\bsrc)\([^\n]*(routes\/chits\.js|'routes', 'chits\.js')/;
const strays = [];
for (const dir of ['tests', 'scripts', 'tools']) {
  const walk = (abs) => fs.readdirSync(abs, { withFileTypes: true }).forEach((d) => {
    const p = path.join(abs, d.name);
    if (d.isDirectory()) { if (d.name !== 'node_modules' && d.name !== 'fixtures') walk(p); return; }
    if (!/\.(c|m)?js$/.test(d.name) || d.name === 'chits-files.test.cjs') return;
    const rel = path.relative(API, p).split(path.sep).join('/');
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => { if (READS.test(line) && !PINNED[rel]) strays.push(rel + ':' + (i + 1)); });
  });
  walk(path.join(API, dir));
}
ok('no test or script reads routes/chits.js by a literal path outside the list (read it with tools/chits-files.cjs, or pin it here with a reason)', strays.length === 0, strays.join(' · '));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
