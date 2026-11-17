'use strict';
// @type: unit
/**
 * tests/workroute-cascade.test.cjs - where work of one kind goes (lib/workroute.js routeFor), over a stand-in for ../db that answers by the SQL it is asked.
 *
 * OWNS      the proof of the rung order  kind rule -> network above (destination only) -> entity default -> nothing, the `why` sentence of each,
 *           the 60 s memo and the clear-all on invalidate, that a failed read is answered (never thrown) and NOT cached, that a missing table (42P01)
 *           IS cached, and the four-hop bound of the walk up the network.
 * CALLED BY scripts/guards.cjs (offline).
 * CARD      docs/02-tasks-orders-and-workflow/functions/work-routing-patterns-populations-teams.md
 */
const assert = require('assert');
const dbPath = require.resolve('../db');
let rules = {}, ancestors = [], defaults = {}, fail42P01 = false, failRead = false, reads = 0;
const answer = (sql, p) => {
  reads++;
  if (failRead) throw new Error('connection blip');
  if (fail42P01) { const e = new Error('relation does not exist'); e.code = '42P01'; throw e; }
  if (/FROM identities i JOIN cb_entity c/.test(sql)) return { rows: ancestors.slice(0, p[1]) };
  if (/information_schema\.columns/.test(sql)) { const r = rules[p[0] + '|' + p[1]]; return { rows: r ? [{ folder_id: r.folder_id || null, assignee_actor_id: r.assignee || null, notify_email: r.notify || null, has_team: r.team ? 1 : null }] : [] }; }
  if (/SELECT route_to_entity_id FROM entity_work_routing/.test(sql)) { const r = rules[p[0] + '|' + p[1]]; return { rows: r && r.team ? [{ route_to_entity_id: r.team }] : [] }; }
  if (/FROM entity_actor_settings/.test(sql)) return { rows: defaults[p[0]] ? [{ default_assignee_actor_id: defaults[p[0]] }] : [] };
  throw new Error('unscripted sql: ' + sql.slice(0, 60));
};
const fake = { query: async (sql, p) => answer(sql, p), withEntity: async (_id, fn) => fn({ query: async (sql, p) => answer(sql, p) }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake };
const W = require('../lib/workroute');
let pass = 0, fail = 0;
const t = async (name, fn) => { rules = {}; ancestors = []; defaults = {}; fail42P01 = failRead = false; reads = 0; W.invalidate(); try { await fn(); console.log('  PASS  ' + name); pass++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; } };

(async () => {
  await t('no entity or no kind -> all null, why says so, nothing read', async () => {
    const r = await W.routeFor('', 'incident'); assert.strictEqual(r.why, 'no entity or kind'); assert.strictEqual(r.folder_id, null);
    assert.strictEqual((await W.routeFor('E1', '')).why, 'no entity or kind'); assert.strictEqual(reads, 0);
  });
  await t('a rule for the kind wins: folder + assignee + notify as set, why "routed by kind"', async () => {
    rules['E1|incident'] = { folder_id: 'F9', assignee: 'A7', notify: 'ops@x.in' }; defaults.E1 = 'A1';
    const r = await W.routeFor('E1', 'incident');
    assert.deepStrictEqual([r.folder_id, r.assignee_actor_id, r.notify_email, r.route_to_entity_id, r.why], ['F9', 'A7', 'ops@x.in', null, 'routed by kind']);
  });
  await t('a rule that names a team says so: "routed by kind, to a team"', async () => {
    rules['E1|spec'] = { team: 'T5' }; const r = await W.routeFor('E1', 'spec');
    assert.strictEqual(r.route_to_entity_id, 'T5'); assert.strictEqual(r.why, 'routed by kind, to a team');
  });
  await t('no rule: the nearest ancestor with a destination is inherited - the destination ONLY, never its folder or person', async () => {
    ancestors = [{ identity_id: 'P1', display_name: 'Branch group' }, { identity_id: 'HQ', display_name: 'Head office' }];
    rules['P1|incident'] = {}; rules['HQ|incident'] = { team: 'T1', folder_id: 'HQF', assignee: 'HQA' };
    const r = await W.routeFor('E2', 'incident');
    assert.deepStrictEqual([r.route_to_entity_id, r.folder_id, r.assignee_actor_id, r.why], ['T1', null, null, 'inherited from Head office']);
  });
  await t('the nearer ancestor beats the farther one', async () => {
    ancestors = [{ identity_id: 'P1', display_name: 'Near' }, { identity_id: 'HQ', display_name: 'Far' }];
    rules['P1|incident'] = { team: 'TN' }; rules['HQ|incident'] = { team: 'TF' };
    assert.strictEqual((await W.routeFor('E3', 'incident')).route_to_entity_id, 'TN');
  });
  await t('the walk is bounded: only 4 ancestors are asked for (a fifth is never reached)', async () => {
    ancestors = [1, 2, 3, 4, 5].map((n) => ({ identity_id: 'A' + n, display_name: 'n' + n })); rules['A5|incident'] = { team: 'T5' };
    const r = await W.routeFor('E4', 'incident'); assert.strictEqual(r.route_to_entity_id, null); assert.strictEqual(r.why, 'nothing routed for incident');
  });
  await t('no rule, no ancestor, an entity default: that person, why names the kind', async () => {
    defaults.E5 = 'A1'; const r = await W.routeFor('E5', 'change');
    assert.deepStrictEqual([r.assignee_actor_id, r.why], ['A1', 'entity default (no rule for change)']);
  });
  await t('nothing at all: all null and why "nothing routed for <kind>" (an unrouted queue can be SEEN)', async () => {
    const r = await W.routeFor('E6', 'release'); assert.deepStrictEqual([r.assignee_actor_id, r.folder_id, r.why], [null, null, 'nothing routed for release']);
  });
  await t('the answer is memoised per entity+kind (second call reads nothing), and invalidate clears EVERY entry', async () => {
    defaults.E7 = 'A1'; await W.routeFor('E7', 'x'); const n = reads; await W.routeFor('E7', 'x'); assert.strictEqual(reads, n);
    defaults.E8 = 'A2'; await W.routeFor('E8', 'x'); W.invalidate('E8'); const m = reads; await W.routeFor('E7', 'x'); assert.ok(reads > m, 'another entity key was cleared too');
  });
  await t('a failed read is answered with the fixed sentence (no db text) and is NOT cached: the retry reads again', async () => {
    failRead = true; const r = await W.routeFor('E9', 'incident');
    assert.strictEqual(r.why, 'routing could not be read just now - filed in the default queue'.replace(' - ', ' — ')); assert.ok(!/blip/.test(JSON.stringify(r)));
    failRead = false; defaults.E9 = 'A3'; assert.strictEqual((await W.routeFor('E9', 'incident')).assignee_actor_id, 'A3');
  });
  await t('a missing table (42P01) says b250 has not been run, and that stable fact IS cached', async () => {
    fail42P01 = true; const r = await W.routeFor('E10', 'incident'); assert.strictEqual(r.why, 'b250 has not been run — no routing table');
    const n = reads; await W.routeFor('E10', 'incident'); assert.strictEqual(reads, n);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
