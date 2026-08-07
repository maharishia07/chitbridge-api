#!/usr/bin/env node
/**
 * cascade-diff.js — what the parent/child cascade actually changes.
 *
 * Athi, 2026-08-08: *"make the cascade for parent and child… and tell me what difference it makes."*
 *
 * Runs every network × parent × child combination through BOTH rules and prints only the rows that move:
 *
 *   OLD  the ceiling came from the ROOT only. A node's own parent was never consulted.
 *   NEW  a node's ceiling is its PARENT's effective visibility, all the way down.
 *
 * Pure — no API, no database. It reads the real planner for NEW and reproduces OLD from the code it replaced, so
 * the comparison is against what actually shipped rather than a description of it.
 *
 *   node scripts/cascade-diff.js
 */
'use strict';
const NB = require('../lib/network-build');

const TIERS = [['public', 'public'], ['protected', 'network'], ['private', 'private']];
const RANK = { private: 0, network: 1, public: 2 };
const ROOT = { key: 'r', name: 'Net', root: true, owned: true, parent_key: null, holds: [] };

/** OLD RULE, as it was: every node capped by the ROOT, its parent ignored. */
function oldRule(netVis, pWord, cWord) {
  const vis = (w) => (TIERS.find((t) => t[0] === w) || [])[1] || 'private';
  const capAt = (v) => (RANK[v] > RANK[netVis] ? netVis : v);
  return { parent: capAt(vis(pWord)), child: capAt(vis(cWord)) };
}

/** NEW RULE — the shipped planner. */
function newRule(netVis, pWord, cWord) {
  const p = NB.plan({ rootHandle: 'net', taken: [], ceiling: netVis, nodes: [ROOT,
    { key: 'p', name: 'Parent', parent_key: 'r', owned: true, exposure: pWord },
    { key: 'c', name: 'Child', parent_key: 'p', owned: true, exposure: cWord }] });
  return { parent: p.create.find((x) => x.key === 'p').visibility,
           child: p.create.find((x) => x.key === 'c').visibility };
}

const W = (s, n) => String(s).padEnd(n);
console.log('\n╔' + '═'.repeat(74) + '╗');
console.log('║  THE PARENT/CHILD CASCADE — what changes                                 ║');
console.log('╚' + '═'.repeat(74) + '╝\n');
console.log('  ' + W('NETWORK', 10) + W('PARENT', 11) + W('CHILD', 11) + W('OLD child', 12) + W('NEW child', 12) + 'difference');
console.log('  ' + '─'.repeat(72));

let moved = 0, total = 0, exposures = 0;
for (const [nw, netVis] of TIERS) {
  for (const [pw] of TIERS) {
    for (const [cw] of TIERS) {
      total++;
      const o = oldRule(netVis, pw, cw), n = newRule(netVis, pw, cw);
      if (o.child === n.child && o.parent === n.parent) continue;
      moved++;
      // The rows that MATTER are the ones where the old rule left a store more open than what it sits inside.
      const leak = RANK[o.child] > RANK[n.child];
      if (leak) exposures++;
      console.log('  ' + W(nw, 10) + W(pw, 11) + W(cw, 11) + W(o.child, 12) + W(n.child, 12)
        + (leak ? '⚠ was OVER-EXPOSED' : 'narrower'));
    }
  }
}

console.log('  ' + '─'.repeat(72));
console.log(`\n  ${total} combinations · ${moved} behave differently · ${exposures} were leaking\n`);
console.log('  A leak means: the child was visible to MORE people than the department containing it.');
console.log('  Every one of them is a store the operator had closed, with something still open inside it.\n');

// The three-level case, to show it is not only one level deep.
const deep = NB.plan({ rootHandle: 'net', taken: [], ceiling: 'public', nodes: [ROOT,
  { key: 'a', name: 'Clothing',  parent_key: 'r', owned: true, exposure: 'public' },
  { key: 'b', name: 'Warehouse', parent_key: 'a', owned: true, exposure: 'protected' },
  { key: 'c', name: 'Cold room', parent_key: 'b', owned: true, exposure: 'public' },
  { key: 'd', name: 'Bay 4',     parent_key: 'c', owned: true, exposure: 'public' }] });
console.log('  A DEEPER CHAIN — everything below a closed node is closed, however far down:\n');
deep.create.forEach((c, i) => console.log('    ' + '  '.repeat(i) + (i ? '└ ' : '') + W(c.name, 12)
  + 'asked ' + W(c.asked, 9) + '→ ' + c.visibility + (c.asked !== c.visibility ? '   (closed by what it sits in)' : '')));
console.log('');
