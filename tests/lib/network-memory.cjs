/**
 * network-memory.cjs — a small stand-in for the network's tables (cb_entity, cb_edge, identities, connections) that answers the statements the network routes make.
 *
 * OWNS      the rows of a few businesses and what the service (src/services/network.js) and routes/connections.js ask of them: who is who, where each sits on the tree (a dotted
 *           path), which edges are asked, active or held, and the connection requests of the handshake. Statements are answered by their SHAPE, so the same facts meet old and new code.
 * CALLED BY tests/lib/network-scenes.cjs · tests/api-problem-network.test.cjs (the scenes and the "signed in as another shop" world). Not a test itself.
 * FLOW      memory() → { answer(sql, params), world } → the harness's sqlRows → the service's pool.query / withTx and the routes' own query
 * CARD      04-network/connections-and-invitations
 * Nothing here decides who may do what: that is src/services/network.js (mayAct, _sameRoot), run for real over these rows.
 */
'use strict';

const A = '11111111-1111-4111-8111-111111111111'; /* the shop that signs in (the harness SHOP) */
const B = '66666666-6666-4666-8666-666666666666'; /* another shop: the stranger */
const C = '77777777-7777-4777-8777-777777777777'; /* a business below A on the tree */
const NODE = { a: 'aaaaaaaa-0000-4000-8000-00000000000a', b: 'aaaaaaaa-0000-4000-8000-00000000000b', c: 'aaaaaaaa-0000-4000-8000-00000000000c' };
const EDGE = 'eeeeeeee-0000-4000-8000-000000000001';
const CONNECTION = 'cccccccc-0000-4000-8000-000000000001';
const FIXED_NEW_NODE = 'aaaaaaaa-0000-4000-8000-0000000000ff';

const norm = (sql) => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();
const under = (path, base) => path === base || path.startsWith(base + '.');
const rootOf = (path) => String(path).split('.')[0];
const reply = (rows) => ({ rows, rowCount: rows.length });

/** the businesses of the world: [identity, node] pairs; C sits under A on the tree when `tree` is true, else it is a root of its own */
function businesses(tree, claimed) {
  return {
    identities: [
      { identity_id: A, bridge_id: 'AAAA2222', display_name: 'Shop A', user_id: 'shop-a', identity_type: 'entity', status: 'active' },
      { identity_id: B, bridge_id: 'BBBB3333', display_name: 'Shop B', user_id: 'shop-b', identity_type: 'entity', status: 'active' },
      { identity_id: C, bridge_id: 'CCCC4444', display_name: 'Shop C', user_id: 'shop-a.c', identity_type: 'entity', status: 'active' }
    ],
    entities: [
      { id: NODE.a, bridge_id: 'AAAA2222', name: 'Shop A', mode: 'b2b', claimed: true, status: 'active', path: 'AAAA2222' },
      { id: NODE.b, bridge_id: 'BBBB3333', name: 'Shop B', mode: 'b2b', claimed: true, status: 'active', path: 'BBBB3333' },
      { id: NODE.c, bridge_id: 'CCCC4444', name: 'Shop C', mode: 'b2b', claimed: !!claimed, status: 'active', path: tree ? 'AAAA2222.CCCC4444' : 'CCCC4444' }
    ]
  };
}

/**
 * memory(options) → { answer(sql, params), data }
 *   options.tree      C sits under A on the tree (default false: three roots)
 *   options.childClaimed  C has claimed its node (default false: an unclaimed stub)
 *   options.lonely    C is not there at all (the unknown id of a stranger's question)
 *   options.edge      an edge between A (parent) and C (child): { state, requested_by, type, in_flight } or null for none
 *   options.request   a connection request C → A is waiting (true: pending; or the status it has, e.g. 'accepted') — the handshake of routes/connections.js
 */
function memory(options) {
  const given = options || {};
  const data = Object.assign(businesses(!!given.tree, given.childClaimed), { edges: [], connections: [] });
  if (given.lonely) {
    data.identities = data.identities.filter((one) => one.identity_id !== C);
    data.entities = data.entities.filter((one) => one.id !== NODE.c);
  }
  if (given.edge) data.edges.push(Object.assign({ id: EDGE, parent_id: NODE.a, child_id: NODE.c, type: 'governance', state: 'requested', requested_by: NODE.a, in_flight: false, created_at: '2026-10-01T00:00:00.000Z' }, given.edge));
  if (given.request) data.connections.push({ connection_id: CONNECTION, from_entity_id: C, from_display_name: 'Shop C', from_bridge_id: 'CCCC4444', to_entity_id: A, to_display_name: 'Shop A', to_bridge_id: 'AAAA2222', status: given.request === true ? 'pending' : given.request, note: '', created_at: '2026-10-01T00:00:00.000Z' });
  const identity = (id) => data.identities.find((one) => one.identity_id === id);
  const entity = (id) => data.entities.find((one) => one.id === id);
  const edge = (id) => data.edges.find((one) => one.id === id);
  const move = (found, state) => (found ? Object.assign(found, { state }) : null);

  /** each rule: [pattern on the normalised statement, (params, sql) → rows] — the first that matches answers */
  const RULES = [
    [/^select identity_id, bridge_id, display_name from identities where identity_id = \$1 and identity_type = 'entity'/, (p) => [identity(p[0])].filter(Boolean)],
    [/^select \* from cb_entity where bridge_id\s*=\s*\$1/, (p) => data.entities.filter((one) => same(one.bridge_id, p[0]))],
    [/^insert into cb_entity\(bridge_id,name,mode,owner_scope,path,claimed,app_ref\)/, (p) => [{ id: FIXED_NEW_NODE, bridge_id: 'REGISTERED1', name: p[1], mode: p[2], claimed: p[5], path: 'REGISTERED1' }]],
    [/^insert into cb_entity/, () => []],
    [/^select \* from cb_entity where id\s*=\s*\$1/, (p) => [entity(p[0])].filter(Boolean)],
    [/^select \* from cb_edge where id\s*=\s*\$1/, (p) => [edge(p[0])].filter(Boolean)],
    [/as same from cb_entity e where e\.id = \$1/, (p) => {
      const found = entity(p[0]);
      return found ? [{ same: rootOf(found.path) === rootOf(p[1]) && (found.id === p[2] || !data.edges.some((one) => one.type === 'governance' && one.state === 'suspended' && under(p[1], entity(one.child_id).path))) }] : [];
    }],
    [/from cb_entity e left join identities i/, (p) => data.entities.filter((one) => under(one.path, p[0])).map((one) => ({ id: one.id, bridge_id: one.bridge_id, name: one.name, path: one.path, depth: one.path.split('.').length - p[0].split('.').length }))],
    [/^select \(\$1::ltree <@ \$2::ltree\) as ok/, (p) => [{ ok: under(p[0], p[1]) }]],
    [/from cb_edge e join cb_entity pp/, (p) => data.edges.filter((one) => (one.parent_id === p[0] || one.child_id === p[0]) && ['requested', 'active', 'suspended'].includes(one.state)).map((one) => Object.assign({}, one, { parent_name: entity(one.parent_id).name, child_name: entity(one.child_id).name }))],
    [/^update cb_entity c set claimed=true/, (p) => {
      const found = entity(p[0]);
      const who = identity(p[1]);
      if (!found || found.claimed || !who || !same(who.bridge_id, found.bridge_id)) return [];
      found.claimed = true;
      return [found];
    }],
    [/^select claimed from cb_entity where id\s*=\s*\$1/, (p) => [entity(p[0])].filter(Boolean).map((one) => ({ claimed: one.claimed }))],
    [/^update cb_edge set state='declined', approved_by=\$2/, (p) => [edge(p[0])].filter((one) => one && one.state === 'requested').map((one) => move(one, 'declined'))],
    [/^update cb_edge set state=\$3 where id=\$1 and state=\$2/, (p) => [edge(p[0])].filter((one) => one && one.state === p[1]).map((one) => move(one, p[2]))],
    [/^select 1 from cb_edge where child_id=\$1 and type = \$2/, (p) => data.edges.filter((one) => one.child_id === p[0] && one.type === p[1] && ['active', 'suspended'].includes(one.state)).map(() => ({ '?column?': 1 }))],
    [/as bad$/, (p) => [{ bad: under(p[0], p[1]) }]],
    [/^update cb_entity set path/, () => []],
    [/^update cb_edge set state='active', approved_by=\$2/, (p) => [move(edge(p[0]), 'active')].filter(Boolean)],
    [/^update cb_edge set state='declined', decided_at=now\(\)/, () => []],
    [/^select 1 from cb_chit where edge_id\s*=\s*\$1/, (p) => (edge(p[0]) && edge(p[0]).in_flight ? [{ '?column?': 1 }] : [])],
    [/^update cb_chit/, () => []],
    [/^update cb_edge set in_flight/, (p) => { if (edge(p[0])) edge(p[0]).in_flight = false; return []; }],
    [/^update cb_edge set state='disconnected'/, (p) => [move(edge(p[0]), 'disconnected')].filter(Boolean)],
    [/^select \* from cb_edge where parent_id\s*=\s*\$1 and child_id\s*=\s*\$2 and type\s*=\s*\$3/, (p) => data.edges.filter((one) => one.parent_id === p[0] && one.child_id === p[1] && one.type === p[2] && ['requested', 'active', 'suspended'].includes(one.state))],
    [/^insert into cb_edge/, (p) => { const made = { id: EDGE.replace(/1$/, '2'), parent_id: p[0], child_id: p[1], type: p[2], state: 'requested', requested_by: p[3] }; data.edges.push(made); return [made]; }],
    [/from identities where \(lower\(user_id\) = lower\(\$1\) or upper\(bridge_id\) = upper\(\$1\)\)/, (p) => data.identities.filter((one) => same(one.user_id || '', p[0]) || same(one.bridge_id, p[0])).map((one) => ({ identity_id: one.identity_id }))],
    /* routes/connections.js — the handshake between two businesses */
    [/^select identity_id, bridge_id, display_name from identities where identity_id = \$1 and status = 'active'/, (p) => [identity(p[0])].filter(Boolean)],
    [/^select bridge_id, display_name from identities where identity_id = \$1/, (p) => [identity(p[0])].filter(Boolean)],
    [/^select connection_id, status from connections where \(from_entity_id/, (p) => data.connections.filter((one) => (one.from_entity_id === p[0] && one.to_entity_id === p[1]) || (one.from_entity_id === p[1] && one.to_entity_id === p[0]))],
    [/^insert into connections/, () => []],
    [/^select \* from connections where connection_id = \$1 and to_entity_id = \$2 and status = 'pending'/, (p) => data.connections.filter((one) => one.connection_id === p[0] && one.to_entity_id === p[1] && one.status === 'pending')],
    [/^select connection_id, from_entity_id, from_display_name/, (p) => data.connections.filter((one) => one.to_entity_id === p[0] && one.status === 'pending')],
    [/^select connection_id, case when from_entity_id/, (p) => data.connections.filter((one) => one.status === 'accepted' && (one.from_entity_id === p[0] || one.to_entity_id === p[0]))],
    [/^update connections set status/, (p) => { const found = data.connections.find((one) => one.connection_id === p[1]); if (found) found.status = p[0]; return []; }]
  ];

  /** the rows a statement gets, or null when this world has nothing to say about it (the harness then answers an empty set) */
  function answer(sql, params) {
    const text = norm(sql);
    const rule = RULES.find((one) => one[0].test(text));
    return rule ? reply(rule[1](params || [], text)) : null;
  }
  return { answer, data };
}

module.exports = { memory, A, B, C, NODE, EDGE, CONNECTION };
