/**
 * migration-numbers.test.cjs — ONE NUMBER, ONE MIGRATION. Two parallel rounds both wrote b299 on 2026-10-12 (CS1's country setup and
 * M210's timestamptz) and both merged: the owner, who runs migrations in number order, could not tell which came first (api #113 renamed
 * one to b301). Athi, 2026-10-13: "as many changes are running in parallel, each change should not overwrite other's change".
 *
 * The rule: every file in migrations/ that starts bNNN (with an optional letter: b105a is a planned follow-on, its own number) belongs to
 * ONE topic. Variants of one migration share the number on purpose — _apply / _dryrun / _verify (any case), and a bare bNNN_VERIFY —
 * so the topic is the name with the number and those words taken out. Two different topics under one number fail, naming both files.
 * Offline: reads the folder only.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '   ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '   ' + extra : '')); }
}

const DIR = path.join(__dirname, '..', 'migrations');
const VARIANT = /(^|_)(apply|dryrun|dry_run|verify|rollback)(?=_|$)/gi;
/** b299_country_setup.sql → { key: 'b299', topic: 'country_setup' } · b180_x_apply.sql → { key: 'b180', topic: 'x' } */
function parse(file) {
  const m = /^(b\d+[a-z]?)_(.*)\.sql$/i.exec(file);
  if (!m) return null;
  return { key: m[1].toLowerCase(), topic: m[2].replace(VARIANT, '').replace(/^_+|_+$/g, '').toLowerCase(), file };
}

const byKey = new Map();
for (const f of fs.readdirSync(DIR)) {
  const p = parse(f);
  if (!p) continue;
  if (!byKey.has(p.key)) byKey.set(p.key, []);
  byKey.get(p.key).push(p);
}

const clashes = [];
for (const [key, list] of byKey) {
  const topics = new Set(list.map((p) => p.topic).filter(Boolean));   /* a bare bNNN_VERIFY has no topic of its own */
  if (topics.size > 1) clashes.push(key + ': ' + list.map((p) => p.file).join(' · '));
}
check('every migration number belongs to ONE migration (variants _apply/_dryrun/_verify share it on purpose)', clashes.length === 0,
  clashes.length ? '\n      ' + clashes.join('\n      ') + '\n      → give the later one the next free number' : byKey.size + ' numbers');

/* the rule itself, on fixtures — so a regex change cannot quietly let a clash through */
const fx = (files) => { const m = new Map(); files.map(parse).forEach((p) => { if (!m.has(p.key)) m.set(p.key, new Set()); if (p.topic) m.get(p.key).add(p.topic); }); return [...m.values()].some((s) => s.size > 1); };
check('the b299 clash of 12 Oct is caught', fx(['b299_country_setup.sql', 'b299_created_at_timestamptz.sql']));
check('apply / dryrun / verify of one migration are one migration', !fx(['b180_pulse_index_apply.sql', 'b180_pulse_index_dryrun.sql', 'b180_pulse_index_verify.sql']));
check('a bare VERIFY beside its migration is fine', !fx(['b198_VERIFY.sql', 'b198_declare_legacy_columns_APPLY.sql']));
check('a lettered follow-on is its own number', !fx(['b105_retention_prep.sql', 'b105a_floor_trigger_definer.sql']));

/* the guard gate reads the LAST "<n> checks" (scripts/guards.cjs) — a guard that counts nothing proves nothing */
console.log('\n' + (fail ? '  ✗ FAIL' : '  ✓ migration numbers') + ' · ' + fail + ' failed · ' + (pass + fail) + ' checks');
process.exit(fail ? 1 : 0);
