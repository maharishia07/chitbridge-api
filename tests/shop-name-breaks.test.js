'use strict';
/**
 * shop-name-breaks.test.js — breaks each guard of tests/shop-name.test.js once; every break must turn it red.
 * Each file is restored from a COPY (never git); each anchor must occur exactly once.
 * Run: node tests/shop-name-breaks.test.js
 */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const R = path.join(__dirname, '..');
const TEST = path.join(R, 'tests', 'shop-name.test.js');
const BREAKS = [
  ['lib/profile.js', "trade_name: me.display_name || tag.trade_name || null,", "trade_name: tag.trade_name || me.display_name || null,", 'the vault\'s name beats the profile\'s on the invoice'],
  ['lib/profile.js', "v[k] = Object.assign({}, v[k], { other: { value:", "v[k] = Object.assign({}, v[k], { other_dropped: { value:", 'the vault\'s differing value is not recorded'],
  ['routes/integrations.js', ".replace(/\\s+/g, '').toLowerCase()", "", 'a case-only difference is reported as a mismatch'],
  ['lib/profile.js', "k === 'trade_name' && v[k] && v[k].source === 'profile'", "false", 'a higher-rung vault name wins trade_name'],
];
let caught = 0; const missed = [];
for (const [file, from, to, what] of BREAKS) {
  const abs = path.join(R, file), copy = abs + '.breakcopy';
  const orig = fs.readFileSync(abs, 'utf8'); fs.writeFileSync(copy, orig);
  let s = orig;
  if (s.split(from).length !== 2) { console.log('  ??   anchor not found once: ' + what); fs.unlinkSync(copy); missed.push(what + ' (no anchor)'); continue; }
  fs.writeFileSync(abs, s.replace(from, () => to));
  let r; try { r = spawnSync(process.execPath, [TEST], { encoding: 'utf8', timeout: 120000 }); }
  finally { fs.writeFileSync(abs, fs.readFileSync(copy, 'utf8')); fs.unlinkSync(copy); }
  if (r.status !== 0) { caught++; console.log('  caught  ' + what); } else { missed.push(what); console.log('  MISSED  ' + what); }
}
console.log('\n  ' + BREAKS.length + ' checks · ' + caught + ' breaks caught');
process.exit(missed.length ? 1 : 0);
