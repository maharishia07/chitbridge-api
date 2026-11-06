'use strict';
/**
 * OWNS      the driven scenario for the eight /api/network write routes (SPD-42 / SEC-138): a small network on sit-in, built from lt- objects, each route fired on its own objects.
 * CALLED BY tools/live-trips.cjs (before the generic pass). Tests/tooling only; the routes are only CALLED over HTTP.
 * FLOW      create lt- nodes ──▶ the load shop asks them (create edge) ──▶ the pool shop cbt-in-retail asks the load shop (commercial edge, no tree change) ──▶ the load shop approves,
 *           suspends, resumes, disconnects it ──▶ again and the load shop declines. Four rounds each (1 warm-up + 3), the highest X-DB-Trips of the 2xx answers is the count.
 * CARD      speed · round trips
 */
const OTHER = 'cbt-in-retail'; /* the one pool shop that asks the load shop: the approve rule needs a request made by the OTHER side, and only the load shop sends X-DB-Trips */

const best = (calls) => {
  const good = calls.filter((c) => c.status >= 200 && c.status < 300 && typeof c.trips === 'number');
  return good.length ? { state: 'measured', trips: Math.max(...good.map((c) => c.trips)), status: good[0].status, calls } : null;
};
const said = (res) => (res.body && (res.body.code || res.body.detail || res.body.error)) || res.text || '';
const unreached = (group, reason, calls) => ({ state: 'unreached', group, reason, calls });
const keep = (res) => ({ status: res.status, trips: res.trips });

async function run(api) {
  const out = {};
  const mine = await api.call('GET', '/api/entities/me');
  const bridge = mine.body && (mine.body.bridge_id || (mine.body.entity && mine.body.entity.bridge_id) || (mine.body.identity && mine.body.identity.bridge_id));
  const look = bridge ? await api.call('GET', '/api/network/entities/lookup?bridgeId=' + encodeURIComponent(bridge)) : null;
  const loadNode = look && look.body && look.body.entity && look.body.entity.id;
  if (!loadNode) {
    const why = unreached('fixture', 'the load shop has no network node (lookup of its bridge id found none): ' + (look ? look.status : 'no bridge id in /api/entities/me'));
    ['POST /api/network/entities', 'POST /api/network/connections', 'POST /api/network/entities/:id/claim', ...['approve', 'decline', 'disconnect', 'resume', 'suspend'].map((a) => 'POST /api/network/connections/:id/' + a)].forEach((k) => { out[k] = why; });
    return out;
  }
  const creates = []; const nodes = [];
  for (let i = 0; i < 4; i += 1) {
    const r = await api.call('POST', '/api/network/entities', { name: 'lt-node-' + api.unique() });
    creates.push(keep(r));
    if (r.body && r.body.id) nodes.push(r.body.id);
  }
  out['POST /api/network/entities'] = best(creates) || unreached('example-refused', 'create answered ' + creates[0].status, creates);
  const asks = [];
  for (const id of nodes) asks.push(keep(await api.call('POST', '/api/network/connections', { childId: id, type: 'commercial' })));
  out['POST /api/network/connections'] = best(asks) || unreached('example-refused', 'ask answered ' + asks.map((c) => c.status).join(','), asks);
  /* claim: every node register() makes is already claimed; an unclaimed stub for the caller's own bridge id needs SQL */
  const claim = nodes.length ? await api.call('POST', '/api/network/entities/' + nodes[0] + '/claim', {}) : null;
  out['POST /api/network/entities/:id/claim'] = claim && claim.status >= 200 && claim.status < 300 && best([keep(claim)]) || unreached('fixture', 'needs an UNCLAIMED cb_entity row whose bridge_id is the caller\'s own (answered ' + (claim ? claim.status + ' ' + said(claim) : 'no node') + '): register() mints a new bridge id and a claimed node, so it takes a SQL fixture');
  const other = await api.tokenFor(OTHER);
  const rounds = { approve: [], suspend: [], resume: [], disconnect: [], decline: [] };
  const ask = async () => {
    const r = await api.call('POST', '/api/network/connections', { parentId: loadNode, type: 'commercial' }, { authorization: 'Bearer ' + other });
    return r.body && r.body.id;
  };
  for (let i = 0; i < 4; i += 1) {
    const edge = await ask();
    if (!edge) { rounds.approve.push({ status: 0, trips: null, note: 'the pool shop could not ask' }); continue; }
    for (const act of ['approve', 'suspend', 'resume', 'disconnect']) {
      const r = await api.call('POST', '/api/network/connections/' + edge + '/' + act, {});
      rounds[act].push(keep(r));
      if (r.status >= 300) break;
    }
  }
  for (let i = 0; i < 4; i += 1) {
    const edge = await ask();
    if (!edge) { rounds.decline.push({ status: 0, trips: null }); continue; }
    rounds.decline.push(keep(await api.call('POST', '/api/network/connections/' + edge + '/decline', {})));
  }
  Object.keys(rounds).forEach((act) => { out['POST /api/network/connections/:id/' + act] = best(rounds[act]) || unreached('precondition', act + ' answered ' + rounds[act].map((c) => c.status).join(','), rounds[act]); });
  return out;
}

module.exports = { run };
