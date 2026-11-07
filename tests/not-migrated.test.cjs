#!/usr/bin/env node
// @type: unit
/**
 * OWNS      the proof that lib/not-migrated.js words a "waiting for the update" answer in plain words with its required "meanwhile", and that NO user-facing string in lib/ or routes/ names a migration id.
 * CALLED BY the guards (node tests/not-migrated.test.cjs)
 * FLOW      waiting() → sentence → no b<digits> in it · scan of every lib/ and routes/ file for a b<digits> id inside a string literal that is not a comment, a log line or a contract `when:`
 * CARD      28-platform-and-operations/api-standard
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { waiting } = require('../lib/not-migrated');
let bad = 0;
const check = (name, ok) => { if (!ok) bad += 1; console.log((ok ? '  ok   ' : '  FAIL ') + name); };
const ID = /\bb(?!64\b)[0-9]{2,3}\b/; /* b64 is base64, not a migration */
check('singular reads "X arrives after the next update. <meanwhile>"', waiting('The asset register', false, 'Nothing was saved.') === 'The asset register arrives after the next update. Nothing was saved.');
check('plural reads "X arrive"', /^Channels arrive after/.test(waiting('Channels', true, 'Nothing was changed.')));
check('the meanwhile is required: none, or an empty one, is refused (fail closed)', [undefined, ''].every((m) => { try { waiting('Stores', true, m); return false; } catch (e) { return /meanwhile/.test(e.message); } }));
check('refusal path: no subject is refused too', (() => { try { waiting(undefined, false, 'x'); return false; } catch (e) { return true; } })());
check('no sentence carries a migration id', !ID.test(waiting('Stores', true, 'Nothing was changed.')));

/* HOLDBACKS: signed handlers (a reworded handler stales its sign-off) and legacy files without a header; each has its own PR + re-sign. file → reason */
const ALLOW = {
  'routes/folders.js': 'POST /folders and POST /messages/:id/mark are signed; own PR + re-sign (b275, b156)',
  'routes/chits.js': 'POST /chits/:id/amend is signed; own PR + re-sign (b148 reason)',
  'routes/testing.js': 'the test-run tool answers the tester, not a shopkeeper (b292, b237)',
  'lib/reprice.js': 'no module header / CARD yet: own PR with the header (b142, internal error)',
  'lib/schedule.js': 'no module header / CARD yet: own PR with the header (b203)',
  'lib/signin-events.js': 'text goes to the log only (the CHECK that refused), never to a person (b282)'
};
const ROOT = path.join(__dirname, '..');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(dir + '/' + d.name) : d.name.endsWith('.js') ? [dir + '/' + d.name] : []));
const blank = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')); /* block comments out, line numbers kept */
const SKIP = /^\s*(\/\/|\/\*|\*)|\bwhen:|console\.|\blog\.|logger\.|cbLog\.|\bneed\(|\.fellBack\(/;
const LITERAL = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g;
const leaksOf = (src) => blank(src).split('\n').map((l, i) => [l, i + 1]).filter(([l]) => !SKIP.test(l))
  .filter(([l]) => (l.replace(/\/\/.*$/, '').match(LITERAL) || []).filter((s) => !/^['"]b[0-9]{2,3}['"]$/.test(s)).some((s) => ID.test(s)));
const hits = [];
for (const f of [...walk('lib'), ...walk('routes')]) {
  const leaks = leaksOf(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  if (leaks.length && !ALLOW[f]) hits.push(f + ':' + leaks.map((x) => x[1]).join(','));
}
check('no lib/ or routes/ string names a migration id (outside the allow-list)' + (hits.length ? ' → ' + hits.join(' ') : ''), hits.length === 0);
check('every allow-list entry still has a reason and the file still exists', Object.keys(ALLOW).every((f) => ALLOW[f] && fs.existsSync(path.join(ROOT, f))));
console.log('\n  ' + (bad ? bad + ' failed' : 'all passed'));
process.exit(bad ? 1 : 0);
