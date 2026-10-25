'use strict';
/**
 * tests/crossing/lib/plan.cjs — which scenarios run, in which mode, and why the others do not (so --dry-run can print it and nothing signs in).
 * OWNS      the --only / --single / --multi selection · the prerequisite closure · the reasons a scenario is skipped
 * CALLED BY tests/crossing/run.cjs · tests/ctp-crossing-pack.test.cjs
 * FLOW      buildPlan(topo, scenarios, { mode, installation, only, flags }) → rows { id, title, state: run | prereq | skip, reason, pair, installations, shops }
 * Single mode runs only scenarios whose shops all live on ONE installation; multi runs everything. A scenario that needs a flag (R8 stops a container) is skipped without it.
 */
const topology = require('./topology.cjs');

/** the shops a scenario signs in as: its pair's two plus declared extras */
function shopsOf(topo, s) {
  const pair = topology.pairOf(topo, s.id);
  return { pair, shops: [...new Set([pair.buyer.key, pair.seller.key].concat(s.extra || []))] };
}

/** the requires closure of the wanted ids, in registry order */
function withPrereqs(scenarios, wanted) {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const need = new Set();
  const visit = (id) => {
    if (need.has(id)) return;
    const s = byId.get(id);
    if (!s) throw new Error('unknown scenario ' + id + ' (known: ' + scenarios.map((x) => x.id).join(', ') + ')');
    need.add(id);
    (s.requires || []).forEach(visit);
  };
  wanted.forEach(visit);
  return need;
}

function buildPlan(topo, scenarios, opts) {
  const o = opts || {};
  const wanted = o.only && o.only.length ? new Set(o.only) : new Set(scenarios.map((s) => s.id));
  const chosen = withPrereqs(scenarios, [...wanted]);
  return scenarios.map((s) => {
    const { pair, shops } = shopsOf(topo, s);
    const installations = [...new Set(shops.map((k) => topo.shops[k].installation))];
    const row = { id: s.id, title: s.title, pair: pair.name, installations, shops, requires: s.requires || [], state: 'run', reason: null };
    if (!chosen.has(s.id)) return Object.assign(row, { state: 'skip', reason: 'not selected' });
    if (!wanted.has(s.id)) row.state = 'prereq';
    const outside = o.mode === 'single' ? installations.filter((i) => i !== o.installation) : [];
    if (outside.length) return Object.assign(row, { state: 'skip', reason: 'needs ' + installations.join(' + ') + ' (single mode runs only ' + o.installation + ')' });
    if (s.needsFlag && !(o.flags || {})[s.needsFlag]) return Object.assign(row, { state: 'skip', reason: 'needs --' + s.needsFlag.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + ' (it stops a container on ' + pair.seller.installation + ')' });
    return row;
  });
}

/** the installations whose tester code and database the plan will touch */
function touched(plan) {
  return [...new Set(plan.filter((r) => r.state !== 'skip').flatMap((r) => r.installations))];
}

module.exports = { buildPlan, withPrereqs, touched, shopsOf };
