'use strict';
/**
 * tests/lib-proof-mutate.cjs — the one way the 2026-11-14 proof tests (RAIL-30/65/71/121 ...) read a source file or load a module, so a *.red.cjs can break ONE line and run
 * the SAME test against it. PROOF_MUT = {"file":"routes/chits.js","from":"<exact text>","to":"<replacement>"}. No PROOF_MUT: the real file, untouched.
 * A mutation whose `from` is not in the file exits 9 (the proof of the proof must say it did not apply). Not a test file: nothing enrols it.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MUT = process.env.PROOF_MUT ? JSON.parse(process.env.PROOF_MUT) : null;

/** the text of rel (relative to the api root), with the mutation applied when it names this file */
function read(rel) {
  let text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (MUT && MUT.file === rel) {
    if (!text.includes(MUT.from)) { console.log('MUTANT-NOT-APPLIED ' + rel); process.exit(9); }
    text = text.replace(MUT.from, () => MUT.to);
  }
  return text;
}

/** require rel; when a mutation names it, a mutated copy beside the real file (so its own relative requires still resolve), removed at exit */
function load(rel) {
  if (!(MUT && MUT.file === rel)) return require(path.join(ROOT, rel));
  const copy = path.join(path.dirname(path.join(ROOT, rel)), '_mutant-' + path.basename(rel));
  fs.writeFileSync(copy, read(rel));
  process.on('exit', () => { try { fs.unlinkSync(copy); } catch (_) { /* gone already */ } });
  return require(copy);
}

/** the text of `function name(...) {...}` (or `async function`) by brace matching — for lifting one function out of a route file */
function lift(text, name) {
  const at = text.search(new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\('));
  if (at < 0) throw new Error('function ' + name + ' not found');
  const open = text.indexOf('{', text.indexOf(')', at));
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(at, j + 1);
  }
  throw new Error('function ' + name + ' is not closed');
}

module.exports = { read, load, lift, ROOT };
