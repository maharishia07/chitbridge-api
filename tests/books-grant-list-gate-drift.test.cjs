#!/usr/bin/env node
// @type: unit
/**
 * books-grant-list-gate-drift.test.cjs — UX-218 GUARD: what "Who can see my books" tells the owner (lib/books-grant list(): `state`) and what the gate admits (verdictOf / liveAmong) are ONE rule.
 * OWNS      the proof that for every kind of grant row (network parent, firm accepted by request, expired, revoked, edge off) 'live' in the list === 'allowed' at the gate, for both roles;
 *           and that list() holds no state rule of its own (it asks stateOf, the function verdictOf asks).
 * CALLED BY CI. No database, no network.
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const grants = require('../lib/books-grant');

/* one row as the SELECT hands it: revoked_at, the database clock's `unexpired`, the edge read by isGrantParentSql (a governance edge = network parent; an active commercial/agency edge = a firm that connected by request) */
const row = (preset, o) => Object.assign({ grant_id: 'g', preset, revoked_at: null, unexpired: true, edge_live: true, grantee_entity: 'f', grantor_entity: 'm' }, o);
const KINDS = {
  'network parent (governance edge)': {},
  'firm accepted by request (commercial/agency edge)': {},
  expired: { unexpired: false },
  revoked: { revoked_at: '2026-11-01' },
  'edge off': { edge_live: false },
  'revoked and expired and edge off': { revoked_at: '2026-11-01', unexpired: false, edge_live: false },
  'edge unknown (null)': { edge_live: null }
};
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const READ = { method: 'GET', listed: true, owner: true };

ok('list state live === gate allowed, every kind of grant, both roles', () => {
  for (const preset of grants.PRESETS) {
    for (const [kind, patch] of Object.entries(KINDS)) {
      const r = row(preset, patch);
      const listed = grants.stateOf(r) === 'live';
      const gate = grants.verdictOf(r, READ) === 'allowed';
      assert.strictEqual(listed, gate, kind + ' / ' + preset + ': the list says ' + grants.stateOf(r) + ', the gate says ' + grants.verdictOf(r, READ));
    }
  }
});
ok('a refused state is the gate\'s own word (revoked, expired, edge_off), never a second wording', () => {
  for (const preset of grants.PRESETS) for (const patch of Object.values(KINDS)) {
    const r = row(preset, patch);
    if (grants.stateOf(r) !== 'live') assert.strictEqual(grants.verdictOf(r, READ), grants.stateOf(r));
  }
});
ok('the set the gate admits (liveAmong) equals the set the list calls live', async () => {
  const rows = [];
  Object.values(KINDS).forEach((patch, i) => rows.push(row('auditor', Object.assign({ grant_id: 'a' + i, grantor_entity: 'm' + i }, patch))));
  const want = rows.filter((r) => grants.stateOf(r) === 'live').map((r) => r.grant_id);
  grants.liveAmong(null, rows, READ).then((out) => assert.deepStrictEqual(out.live.map((r) => r.grant_id), want));
});
ok('list() asks stateOf and keeps no state rule of its own (no app-clock date test, no edge_live ternary)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'books-grant.js'), 'utf8');
  const body = src.slice(src.indexOf('async function list(entity)'), src.indexOf('async function looks('));
  assert.ok(/stateOf\(row\)/.test(body), 'list() must state each grant with stateOf');
  assert.ok(!/new Date\(row\.expires_at\)/.test(body) && !/edge_live \? 'live'/.test(body), 'list() holds its own state rule: drift from the gate');
});
console.log('\n  ✓ ' + n + ' passed');
