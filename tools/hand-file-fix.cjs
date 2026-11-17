#!/usr/bin/env node
'use strict';
/*
 * OWNS      the one-entry-per-line layout of the two hand/ratchet files that every api PR used to clash on: docs/api-signoffs.json (hand file, the cb-api sign-offs)
 *           and readability.ratchet.json (the §6 per-file ratchet). A line-based reader that survives a `merge=union` result (a missing or extra comma, a
 *           duplicate line), a canonical writer, and a check. It never decides what a sign-off or a score IS; it only sorts, de-duplicates and re-lays lines.
 * CALLED BY toolset/batch-build-api.sh after the merges (--fix, both files) · CI api-standard (--check, every branch) · by hand: --fmt after editing a sign-off.
 * FLOW      read lines ──▶ header lines · entry lines (`  "<key>": {json}`) · footer lines ──▶ entries by key ──▶ the same key twice with DIFFERENT text is a stop
 *           (signoffs: a human picks; readability: the LOWER score wins, a ratchet only goes down) ──▶ sort by key ──▶ write the canonical text
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tools/hand-file-fix.cjs --check [signoffs|readability]   exit 1 when the file is not canonical, has a duplicate key, or a line that does not parse
 *   node tools/hand-file-fix.cjs --fix   [signoffs|readability]   rewrite the canonical layout (exit 1 on a duplicate key with different content for signoffs)
 * The readability layout is the web tool's own writer (tools/readability/ratchet.cjs write(): one row per line, sorted, `_about` first), so the format lives in one place;
 * this tool calls it when the web checkout is beside (../chitbridge-web) and refuses to guess when it is not.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = { signoffs: 'docs/api-signoffs.json', readability: 'readability.ratchet.json' };
const ENTRY = /^ {1,2}("(?:[^"\\]|\\.)*"): (\{.*\}),?\s*$/;
/* the web checkout: CB_WEB_DIR, else beside (../chitbridge-web), else CI's .side/chitbridge-web, else the laptop's C:/dev/chitbridge-web */
const WEB_RATCHET = [process.env.CB_WEB_DIR, path.join(ROOT, '..', 'chitbridge-web'), path.join(ROOT, '.side', 'chitbridge-web'), 'C:/dev/chitbridge-web'].filter(Boolean).map((dir) => path.join(dir, 'tools', 'readability', 'ratchet.cjs')).find((candidate) => fs.existsSync(candidate)) || '';

/** split a file's text into { head: lines before the first entry, entries: [{ key, json, text }], bad: lines in the entry block that are not an entry } */
function parseLines(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const head = []; const entries = []; const badLines = [];
  let inBlock = false;
  lines.forEach((line) => {
    const found = ENTRY.exec(line);
    if (found) {
      inBlock = true;
      let value;
      try { value = JSON.parse(found[2]); } catch (e) { badLines.push(line); return; }
      entries.push({ key: JSON.parse(found[1]), value, text: found[2] });
    } else if (!inBlock) head.push(line);
    else if (!/^\s*[}{]?,?\s*$/.test(line)) badLines.push(line);
  });
  return { head, entries, bad: badLines };
}

/** the entries by key; the same key on two lines is fine only when both lines say the same thing (readability: the lower score wins) */
function byKey(entries, kind) {
  const map = new Map(); const clashes = [];
  entries.forEach((entry) => {
    const earlier = map.get(entry.key);
    if (!earlier || earlier.text === entry.text) { map.set(entry.key, earlier || entry); return; }
    if (kind === 'readability') { map.set(entry.key, entry.value.score < earlier.value.score ? entry : earlier); return; }
    clashes.push(entry.key);
  });
  return { map, clashes };
}

/** canonical signoffs text: the header (about, version) from the old text, one entry per line sorted by key, then the closing braces */
function canonicalSignoffs(text, map) {
  const about = /^ "about": (".*"),?\s*$/m.exec(text);
  const version = /^ "version": (\d+),?\s*$/m.exec(text);
  if (!about || !version) throw new Error('docs/api-signoffs.json: no "about" / "version" header lines');
  const keys = [...map.keys()].sort();
  const body = keys.map((key, index) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(map.get(key).value) + (index < keys.length - 1 ? ',' : ''));
  return '{\n "about": ' + about[1] + ',\n "version": ' + version[1] + ',\n "routes": {\n' + body.join('\n') + '\n }\n}\n';
}

function canonicalReadability(map) {
  if (!WEB_RATCHET) throw new Error('no web checkout found (CB_WEB_DIR, ../chitbridge-web, .side/chitbridge-web): the readability layout is the web tool\'s writer');
  const webRatchet = require(WEB_RATCHET);
  const rows = {}; [...map.keys()].sort().forEach((key) => { if (key !== '_about') rows[key] = map.get(key).value; });
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ratchet-'));
  webRatchet.write(tmp, rows);
  const out = fs.readFileSync(webRatchet.ratchetPath(tmp), 'utf8');
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

/** the canonical text of a file's current text, plus the problems found on the way */
function normalise(kind, text) {
  const parsed = parseLines(text);
  let entries = parsed.entries; let badLines = parsed.bad;
  try {   // an older pretty-printed layout (one entry over many lines): the entries come from the JSON itself, once
    const json = JSON.parse(text); const obj = kind === 'signoffs' ? json.routes : json;
    const rows = Object.entries(obj || {}).filter(([key]) => key !== '_about');
    if (entries.length < rows.length) { entries = rows.map(([key, value]) => ({ key, value, text: JSON.stringify(value) })); badLines = []; }
  } catch (error) { console.log("hand-file-fix: " + (kind === "signoffs" ? "sign-offs" : "readability ratchet") + " is not valid JSON, reading it line by line (" + error.message.slice(0, 60) + ")"); }
  const problems = badLines.map((line) => 'a line that is neither an entry nor a brace: ' + line.slice(0, 80));
  const { map, clashes } = byKey(entries, kind);
  clashes.forEach((key) => problems.push('one key on two different lines (a person picks which): ' + key));
  if (!entries.length) problems.push('no entry lines found');
  if (problems.length) return { text: null, problems, count: map.size };
  const fixed = kind === 'signoffs' ? canonicalSignoffs(text, map) : canonicalReadability(map);
  return { text: fixed, problems: [], count: map.size };
}

/** the command line: --check (default) or --fix, for one or both files; returns the exit code */
function runCli(argv) {
  const mode = argv.includes('--fix') ? 'fix' : argv.includes('--fmt') ? 'fix' : 'check';
  const kinds = argv.filter((arg) => FILES[arg]);
  const todo = kinds.length ? kinds : Object.keys(FILES);
  let badCount = 0;
  todo.forEach((kind) => {
    const file = path.join(ROOT, FILES[kind]);
    if (!fs.existsSync(file)) { console.log(FILES[kind] + ': not in this checkout, skipped'); return; }
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const res = normalise(kind, text);
    if (res.problems.length) { badCount++; console.log(FILES[kind] + ': ' + res.problems.length + ' problem(s)\n  ' + res.problems.join('\n  ')); return; }
    if (mode === 'fix') {
      if (res.text !== text) fs.writeFileSync(file, res.text);
      console.log(FILES[kind] + ': ' + res.count + ' entries, ' + (res.text === text ? 'already canonical' : 'rewritten (one per line, sorted)'));
    } else if (res.text !== text) { badCount++; console.log(FILES[kind] + ': not canonical (one entry per line, keys sorted, no duplicates): run node tools/hand-file-fix.cjs --fix ' + kind); }
    else console.log(FILES[kind] + ': canonical, ' + res.count + ' entries');
  });
  return badCount ? 1 : 0;
}

module.exports = { parseLines, byKey, normalise, canonicalSignoffs };
if (require.main === module) process.exit(runCli(process.argv.slice(2)));
