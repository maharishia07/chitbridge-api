#!/usr/bin/env node
'use strict';
/**
 * match.test.js — the rule condition matcher, tested purely.
 *
 * A rule runs unattended against chits nobody is watching, so the cases that matter are the ones where it would
 * QUIETLY do the wrong thing: an unknown key ignored instead of refused, an empty condition matching everything,
 * a chit with no agreed value being swept up by an amount test.
 *
 * RUN:  node scripts/match.test.js
 */
const m = require('../lib/match');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (detail ? '\n      ' + detail : '')); }
};

const NOW = '2026-08-10T12:00:00Z';
const chit = (o) => Object.assign({
  manual_subject: 'Cement order', auto_subject: null, counterparty_name: 'Ramesh Traders',
  purpose: 'order', direction: 'received', current_status: 'pending',
  value: 500, currency: 'INR', open_disputes: 0, read_at: null,
  created_at: '2026-08-09T12:00:00Z',
  summary_json: { via: { channel: 'whatsapp', raw_excerpt: 'need 3 bags of cement' } },
}, o);

console.log('\n  match — a rule that runs while nobody is watching\n');

/* ── validation: the failures that LOOK like success ───────────────────────────────────────────────────────────── */
ok('★★★ an UNKNOWN key is REFUSED, not ignored — a rule that silently matches nothing still looks enabled',
  m.validate({ sender: 'Ramesh' }).ok === false);
ok('★★ an EMPTY condition is refused — it would match every chit ever',
  m.validate({}).ok === false);
ok('a blank text term is refused', m.validate({ from: '   ' }).ok === false);
ok('a non-numeric amount is refused', m.validate({ min_amount: 'lots' }).ok === false);
ok('a valid condition passes', m.validate({ from: 'Ramesh', purpose: 'order' }).ok === true);

/* ── the terms ─────────────────────────────────────────────────────────────────────────────────────────────────── */
ok('from · matches on part of the counterparty name', m.match(chit(), { from: 'ramesh' }));
ok('from · does not match someone else', !m.match(chit(), { from: 'selvam' }));
ok('subject · case-insensitive contains', m.match(chit(), { subject: 'CEMENT' }));
ok('channel · reads summary_json.via', m.match(chit(), { channel: 'whatsapp' }));
ok('text · searches subject, party AND the channel excerpt', m.match(chit(), { text: '3 bags' }));
ok('older_than_days · a 1-day-old chit is not 5 days old', !m.match(chit(), { older_than_days: 5 }, { now: NOW }));
ok('older_than_days · …but it is 1 day old', m.match(chit(), { older_than_days: 1 }, { now: NOW }));
ok('unread · true matches an unread chit', m.match(chit(), { unread: true }));
ok('unread · false does not', !m.match(chit(), { unread: false }));

/* ── amounts and the null trap ─────────────────────────────────────────────────────────────────────────────────── */
ok('min_amount · 500 >= 100', m.match(chit(), { min_amount: 100 }));
ok('max_amount · 500 is not <= 100', !m.match(chit(), { max_amount: 100 }));
ok('★★★ a chit with NO agreed value is NOT swept up by max_amount — treating null as 0 would capture every '
  + 'unpriced inbound request, which is the normal state for one',
  !m.match(chit({ value: null }), { max_amount: 100 }));
ok('★★ …nor by min_amount', !m.match(chit({ value: null }), { min_amount: 0 }));

/* ── AND, not OR ───────────────────────────────────────────────────────────────────────────────────────────────── */
ok('★★ every term must hold — one miss fails the whole condition',
  !m.match(chit(), { from: 'ramesh', purpose: 'invoice' }));

/* ── order and stop ────────────────────────────────────────────────────────────────────────────────────────────── */
const rules = [
  { rule_id: 'r1', folder_id: 'f1', when: { purpose: 'invoice' }, enabled: true, sort: 0 },
  { rule_id: 'r2', folder_id: 'f2', when: { from: 'ramesh' }, enabled: true, sort: 1 },
  { rule_id: 'r3', folder_id: 'f3', when: { channel: 'whatsapp' }, enabled: true, sort: 2 },
];
ok('★★ the FIRST matching rule wins, read top-down', (m.firstMatch(chit(), rules) || {}).rule_id === 'r2');
ok('a disabled rule is skipped',
  (m.firstMatch(chit(), [{ ...rules[1], enabled: false }, rules[2]]) || {}).rule_id === 'r3');
ok('★★ stop_processing halts the walk — so "which rule won" is answerable by reading the list',
  m.firstMatch(chit(), [{ rule_id: 'x', when: { purpose: 'invoice' }, enabled: true, stop_processing: true }, rules[1]]) === null);
ok('no rules · no match, no crash', m.firstMatch(chit(), []) === null && m.firstMatch(chit(), null) === null);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exitCode = fail ? 1 : 0;
