/**
 * network-authority.test.cjs — WHO MAY DO WHAT ON A NETWORK EDGE (docs/NETWORK-AUTHORITY.md, ATH-86 — 2026-09-17).
 *
 * The network routes took the acting business from the request BODY, so writes were switched off in production. They now
 * take it from the signed-in business (src/services/network.nodeOf) and decide with mayAct(). This file is the rule table,
 * checked without a database: parent can · child can · stranger cannot — and the one who asked cannot approve.
 * It also holds the membership SQL to its two routes in (built under the brand, or an active commercial edge).
 *
 * Run: node tests/network-authority.test.cjs   · no DB, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const API = path.join(__dirname, '..');
const net = require(path.join(API, 'src', 'services', 'network.js'));
const membership = require(path.join(API, 'lib', 'network-membership.js'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ' + name); pass++; } catch (e) { console.log('  FAIL ' + name + '\n      ' + e.message); fail++; } };
const edge = (requested_by) => ({ parent_id: 'P', child_id: 'C', requested_by });

console.log('\nnetwork authority · the rule table');
t('⛔ a stranger can do nothing to an edge', () => {
  for (const op of ['request', 'approve', 'decline', 'suspend', 'resume', 'disconnect']) {
    assert.notStrictEqual(net.mayAct(op, { edge: edge('P'), actorId: 'X' }), true, op + ' was allowed for a stranger');
  }
});
t('⛔ nobody signed in can do anything', () => {
  assert.notStrictEqual(net.mayAct('decline', { edge: edge('P'), actorId: null }), true);
});
t('⭐ either side may ask, decline or disconnect', () => {
  for (const op of ['request', 'decline', 'disconnect']) for (const a of ['P', 'C']) {
    assert.strictEqual(net.mayAct(op, { edge: edge('P'), actorId: a, parentId: 'P', childId: 'C' }), true, op + ' by ' + a);
  }
});
t('⭐⭐ the side that did NOT ask approves — a brand invites, the store accepts; a store asks, the brand approves', () => {
  assert.strictEqual(net.mayAct('approve', { edge: edge('P'), actorId: 'C' }), true);
  assert.notStrictEqual(net.mayAct('approve', { edge: edge('P'), actorId: 'P' }), true, 'the brand approved its own invitation');
  assert.strictEqual(net.mayAct('approve', { edge: edge('C'), actorId: 'P' }), true);
  assert.notStrictEqual(net.mayAct('approve', { edge: edge('C'), actorId: 'C' }), true, 'the store approved its own request');
});
t('⚠️ an old edge with no recorded asker is treated as asked by the parent — the child consents, as before', () => {
  assert.strictEqual(net.mayAct('approve', { edge: edge(null), actorId: 'C' }), true);
  assert.notStrictEqual(net.mayAct('approve', { edge: edge(null), actorId: 'P' }), true);
});
t('⭐ only the network suspends or resumes a member', () => {
  assert.strictEqual(net.mayAct('suspend', { edge: edge('P'), actorId: 'P' }), true);
  assert.notStrictEqual(net.mayAct('suspend', { edge: edge('P'), actorId: 'C' }), true);
  assert.strictEqual(net.mayAct('resume', { edge: edge('P'), actorId: 'P' }), true);
  assert.notStrictEqual(net.mayAct('resume', { edge: edge('P'), actorId: 'C' }), true);
});

console.log('\nnetwork authority · the routes act as the signed-in business');
t('⚠️⚠️ no route takes the actor from the body any more', () => {
  const src = fs.readFileSync(path.join(API, 'src', 'routes', 'network.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/actingEntityId/.test(code), 'a route still reads actingEntityId from the request');
  for (const op of ['approve', 'decline', 'suspend', 'resume', 'disconnect', 'requestConnect']) {
    assert.ok(new RegExp('net\\.' + op + '\\([^;]{0,400}?actorOf\\(req\\)\\)').test(code), op + ' is not given the signed-in business');
  }
  assert.ok(/claim\(req\.params\.id, auth_\.entityOf\(req\)\)/.test(src), 'claim is not proven against the signed-in business');
});

console.log('\nnetwork membership · two ways in, nothing else');
t('⭐ the membership SQL admits a store under the brand (not suspended) or with an ACTIVE commercial edge — and nothing more', () => {
  const sql = membership.isMemberSql('b', 's');
  assert.ok(/sc\.path <@ bc\.path/.test(sql), 'built stores are not members');
  assert.ok(/g\.type = 'governance' AND g\.state = 'suspended'/.test(sql), 'a suspended built store is still a member');
  assert.ok(/e\.type = 'commercial' AND e\.state = 'active'/.test(sql), 'an approved store is not a member, or a pending one is');
  assert.ok(!/requested/.test(sql), 'a request is treated as membership');
});

console.log('\n' + (fail ? '✗ ' + fail + ' failed, ' : '✓ ') + pass + ' passed · ' + (pass + fail) + ' checks\n');
process.exit(fail ? 1 : 0);
