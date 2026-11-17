'use strict';
/**
 * e2e/lib/known-findings.cjs - the RATCHET BASELINE for the source scanners (QA-154, 13 Nov 2026).
 *
 * OWNS      reading and writing e2e/scanner-known.json: per scanner, today's findings as a count and a list of keys, and the
 *           one comparison "which findings are new, which are known". Same rule as token-guard.baseline.json and
 *           lint.ratchet.json: a finding may go away, never appear; --write only ever lowers.
 * CALLED BY e2e/api-envelope.cjs, bridge-id-audit.cjs, cb-build-guard.cjs, crm-themes.cjs, empty-states.cjs, index-page.cjs,
 *           list-standard.cjs, policy-reachable.cjs, silent-control.cjs, token-check.cjs, tooltip-length.cjs, tx-leak.cjs
 * FLOW      scanner collects findings as { key, show } ──▶ ratchet(name, findings) ──▶ { fresh, known }
 *           ──▶ scanner prints fresh as before, exits 1 on fresh, prints the one "N known" line this module returns
 * CARD      qa/scanner-ratchet
 *
 * KEY       a finding's key is stable text WITHOUT its line number (file + the offending text), so a blank line added above it
 *           does not turn a known finding into a new one. Two findings with one key count twice.
 * STALE     a baseline entry no longer found FAILS until --write lowers it (so a fixed finding cannot return under its old key unseen).
 * WRITE     `node e2e/<scanner>.cjs --write` records today's findings. It REFUSES to write a count above the recorded one,
 *           and a new key is "new" even when another went away. Only a first record for a scanner may be written from nothing.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'scanner-known.json');
const REL = 'e2e/scanner-known.json';

function readAll() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}

/** items: [{ key, show }]. Returns { fresh, known, line, fixed } and handles --write. */
function ratchet(name, items, opts) {
  const all = readAll();
  const row = all[name] || { count: 0, keys: [] };
  const left = new Map();
  row.keys.forEach((k) => left.set(k, (left.get(k) || 0) + 1));
  const fresh = [];
  let known = 0;
  items.forEach((it) => {
    const n = left.get(it.key) || 0;
    if (n > 0) { left.set(it.key, n - 1); known++; } else fresh.push(it);
  });
  const fixed = [...left.entries()].reduce((a, e) => a + e[1], 0);
  const countRise = items.length > row.count;
  const line = '  ' + known + ' known, see ' + REL + ' [' + name + ']'
    + (fixed ? '  - ' + fixed + ' since fixed: run with --write to lower the baseline' : '');

  if (process.argv.includes('--write')) {
    if (all[name] && items.length > row.count) {
      console.error('  ✗ --write refuses: ' + items.length + ' findings is above the recorded ' + row.count + '. The baseline only goes down.');
      process.exit(1);
    }
    if (all[name] && fresh.length) {
      console.error('  ✗ --write refuses: ' + fresh.length + ' finding(s) are not in the baseline (new, even if others went away).');
      process.exit(1);
    }
    all[name] = { count: items.length, owner: (opts && opts.owner) || '', keys: items.map((i) => i.key).sort() };
    const sorted = {};
    Object.keys(all).sort().forEach((k) => { sorted[k] = all[k]; });
    fs.writeFileSync(FILE, JSON.stringify(sorted, null, 1) + '\n');
    console.log('  baseline written: ' + name + ' ' + items.length + ' finding(s)');
    process.exit(0);
  }
  /* a known entry that is no longer found must fail until --write lowers the baseline (the list only shrinks, and a fixed finding that
     comes back under the same key must not be forgiven by a stale row). Set in an exit hook so every scanner keeps its own exit path. */
  if (fixed) {
    console.error('  ✗ ' + fixed + ' baseline entr' + (fixed === 1 ? 'y' : 'ies') + ' of [' + name + '] no longer found: lower it with  node e2e/' + path.basename(process.argv[1]) + ' --write');
    process.on('exit', () => { process.exitCode = 1; });
  }
  return { fresh, known, fixed, countRise, line, baseline: row.count };
}

module.exports = { ratchet, REL };
