'use strict';
/**
 * tests/crossing/scenarios/index.cjs — the one list of scenarios, in the walk's order, keyed by the walk's own ids (R0-R30, G1-G4) so a failure maps to the walk.
 * OWNS      the ordered registry · the id sort
 * CALLED BY tests/crossing/run.cjs · lib/plan.cjs (through run.cjs) · tests/ctp-crossing-pack.test.cjs
 * R0 is not a walk row: it is the setup (add the seller, send a tagged chit) the message / dispute / status rows ride on.
 */
const files = [require('./rails.cjs'), require('./catalogue.cjs'), require('./rounds.cjs'), require('./reverse.cjs'), require('./grundfos.cjs')];

const rank = (id) => {
  const m = /^([RG])(\d+)$/.exec(id);
  return (m[1] === 'R' ? 0 : 1000) + Number(m[2]);
};

const all = files.flatMap((f) => f.scenarios).sort((a, b) => rank(a.id) - rank(b.id));

module.exports = { all, byId: (id) => all.find((s) => s.id === id) || null };
