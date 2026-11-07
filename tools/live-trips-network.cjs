'use strict';
/**
 * OWNS      the driven scenario for the eight /api/network write routes (SPD-42 / SEC-138): a small network on sit-in, built from lt- objects, each route fired on its own objects.
 * CALLED BY tools/live-trips.cjs (before the generic pass). Tests/tooling only; the routes are only CALLED over HTTP.
 * FLOW      create lt- nodes ──▶ the load shop asks them (create edge) ──▶ the pool shop cbt-in-retail asks the load shop (commercial edge, no tree change) ──▶ the load shop approves,
 *           suspends, resumes, disconnects it ──▶ again and the load shop declines. Four rounds each (1 warm-up + 3), the highest X-DB-Trips of the 2xx answers is the count.
 * CARD      28-platform-and-operations/performance-and-round-trips
 */
const OTHER = 'cbt-in-retail'; /* the one pool shop that asks the load shop: the approve rule needs a request made by the OTHER side, and only the load shop sends X-DB-Trips */
const ROUNDS = 4; /* 1 warm-up + 3 measured */
const ACTIONS = ['approve', 'suspend', 'resume', 'disconnect'];

/** the count of a route from its calls: the highest X-DB-Trips among the 2xx answers, or null when none counted */
const best = (calls) => {
  const good = calls.filter((attempt) => attempt.status >= 200 && attempt.status < 300 && typeof attempt.trips === 'number');
  return good.length ? { state: 'measured', trips: Math.max(...good.map((attempt) => attempt.trips)), status: good[0].status, calls } : null;
};
/** the words an answer gave for itself (code, detail, error or plain text) */
const said = (res) => (res.body && (res.body.code || res.body.detail || res.body.error)) || res.text || '';
/** a route this scenario could not reach, with its group and reason */
const unreached = (group, reason, calls) => ({ state: 'unreached', group, reason, calls });
/** the two facts of an answer a count needs */
const keep = (res) => ({ status: res.status, trips: res.trips });

/** the load shop's own network node, found through its bridge id; { node, look } (node is undefined when there is none) */
async function findLoadNode(api) {
  const mine = await api.call('GET', '/api/entities/me');
  const bridge = mine.body && (mine.body.bridge_id || (mine.body.entity && mine.body.entity.bridge_id) || (mine.body.identity && mine.body.identity.bridge_id));
  const look = bridge ? await api.call('GET', '/api/network/entities/lookup?bridgeId=' + encodeURIComponent(bridge)) : null;
  return { node: look && look.body && look.body.entity && look.body.entity.id, look };
}

/** every route of the scenario marked unreached for the one fixture gap (the load shop has no network node) */
function allUnreached(look) {
  const fixtureGap = unreached('fixture', 'the load shop has no network node (lookup of its bridge id found none): ' + (look ? look.status : 'no bridge id in /api/entities/me'));
  const routeKeys = ['POST /api/network/entities', 'POST /api/network/connections', 'POST /api/network/entities/:id/claim', ...['approve', 'decline', 'disconnect', 'resume', 'suspend'].map((action) => 'POST /api/network/connections/:id/' + action)];
  const out = {};
  routeKeys.forEach((routeKey) => { out[routeKey] = fixtureGap; });
  return out;
}

/** create ROUNDS lt- nodes: the calls made and the ids that came back */
async function createNodes(api) {
  const creates = []; const nodes = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    const answer = await api.call('POST', '/api/network/entities', { name: 'lt-node-' + api.unique() });
    creates.push(keep(answer));
    if (answer.body && answer.body.id) nodes.push(answer.body.id);
  }
  return { creates, nodes };
}

/** the load shop asks each node to connect (create edge); the calls made */
async function askNodes(api, nodes) {
  const asks = [];
  for (const id of nodes) asks.push(keep(await api.call('POST', '/api/network/connections', { childId: id, type: 'commercial' })));
  return asks;
}

/** claim: every node register() makes is already claimed; an unclaimed stub for the caller's own bridge id needs SQL */
async function claimFirst(api, nodes) {
  const claim = nodes.length ? await api.call('POST', '/api/network/entities/' + nodes[0] + '/claim', {}) : null;
  if (claim && claim.status >= 200 && claim.status < 300) return best([keep(claim)]);
  return unreached('fixture', 'needs an UNCLAIMED cb_entity row whose bridge_id is the caller\'s own (answered ' + (claim ? claim.status + ' ' + said(claim) : 'no node') + '): register() mints a new bridge id and a claimed node, so it takes a SQL fixture');
}

/** the pool shop asks the load shop to connect; the new edge id, or undefined */
async function otherAsks(api, loadNode, otherToken) {
  const answer = await api.call('POST', '/api/network/connections', { parentId: loadNode, type: 'commercial' }, { authorization: 'Bearer ' + otherToken });
  return answer.body && answer.body.id;
}

/** ROUNDS edges the load shop approves, suspends, resumes and disconnects in turn (a refused step ends that edge's round) */
async function driveLifecycle(api, loadNode, otherToken, rounds) {
  for (let round = 0; round < ROUNDS; round += 1) {
    const edge = await otherAsks(api, loadNode, otherToken);
    if (!edge) { rounds.approve.push({ status: 0, trips: null, note: 'the pool shop could not ask' }); continue; }
    for (const action of ACTIONS) {
      const answer = await api.call('POST', '/api/network/connections/' + edge + '/' + action, {});
      rounds[action].push(keep(answer));
      if (answer.status >= 300) break;
    }
  }
}

/** ROUNDS edges the load shop declines */
async function driveDecline(api, loadNode, otherToken, rounds) {
  for (let round = 0; round < ROUNDS; round += 1) {
    const edge = await otherAsks(api, loadNode, otherToken);
    if (!edge) { rounds.decline.push({ status: 0, trips: null }); continue; }
    rounds.decline.push(keep(await api.call('POST', '/api/network/connections/' + edge + '/decline', {})));
  }
}

/** the whole scenario: { route key: measured or unreached row } for the eight network write routes */
async function driveNetwork(api) {
  const { node: loadNode, look } = await findLoadNode(api);
  if (!loadNode) return allUnreached(look);
  const out = {};
  const { creates, nodes } = await createNodes(api);
  out['POST /api/network/entities'] = best(creates) || unreached('example-refused', 'create answered ' + creates[0].status, creates);
  const asks = await askNodes(api, nodes);
  out['POST /api/network/connections'] = best(asks) || unreached('example-refused', 'ask answered ' + asks.map((attempt) => attempt.status).join(','), asks);
  out['POST /api/network/entities/:id/claim'] = await claimFirst(api, nodes);
  const otherToken = await api.tokenFor(OTHER);
  const rounds = { approve: [], suspend: [], resume: [], disconnect: [], decline: [] };
  await driveLifecycle(api, loadNode, otherToken, rounds);
  await driveDecline(api, loadNode, otherToken, rounds);
  Object.keys(rounds).forEach((action) => { out['POST /api/network/connections/:id/' + action] = best(rounds[action]) || unreached('precondition', action + ' answered ' + rounds[action].map((attempt) => attempt.status).join(','), rounds[action]); });
  return out;
}

module.exports = { run: driveNetwork, best, said, unreached, keep, allUnreached };
