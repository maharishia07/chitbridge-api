/**
 * quick-keys-scenes.cjs — the world and the named scenarios of tests/api-problem-quick-keys.test.cjs: the quick-key tables as a small in-memory store the real lib/quick-keys.js runs over.
 *
 * OWNS      the stand-in for the quick_key_group / quick_key_group_item / device_screen_config tables (it answers each statement of lib/quick-keys.js the way the SQL does, with the
 *           same `entity_id` filter, so a row is shown only to its owning shop), the other shop's sign-in, and one scenario per answer of routes/quick-keys.js (a refusal the generic worlds
 *           cannot reach, a success to prove byte for byte).
 * CALLED BY tests/api-problem-quick-keys.test.cjs. Not a test itself.
 * FLOW      store() → answer(sql, params) → rows | null → the harness's sqlRows; extras() → [{ id, route, expect, plant, setup, body, url, after }] → the harness runs each against the real route
 * CARD      qa/offline-guards
 * A scenario with `after: true` is an answer the sweep ADDS (the schema's refusal of a body that is not an object): the old code answered it otherwise, so it is run in a check but never frozen.
 * `plant(store)` puts the rows a scenario needs into a fresh store before the request. The store never throws: a database that fails is the harness's `db: 'fail'`.
 */
'use strict';
const { SHOP } = require('./problem-world.cjs');

const OTHER_SHOP = '99999999-9999-4999-8999-999999999999';
const STRANGER = { identity_id: OTHER_SHOP, identity_type: 'entity', display_name: 'Another shop' };
const GROUP = '00000000-0000-4000-8000-0000000000a1';
const TEA = '00000000-0000-4000-8000-0000000000b1';
const BUN = '00000000-0000-4000-8000-0000000000b2';
const STAMP = '2026-10-23T00:00:00.000Z';
const Q = '/api/quick-keys';

/** the tables, in memory; answer(sql, params) is the harness's `sqlRows` (null = not a statement of this store) */
function store() {
  const data = { groups: [], items: [], catalogue: { [TEA]: { name: 'Tea', price: '15' }, [BUN]: { name: 'Bun', price: '10' } }, config: {}, audit: 0, next: 1 };
  const id = () => '00000000-0000-4000-8000-' + String(100000000000 + data.next++);
  const same = (a, b) => String(a) === String(b);
  const groupOf = (gid, entity) => data.groups.find((one) => same(one.id, gid) && same(one.entity_id, entity));
  const rows = (list) => ({ rows: list, rowCount: list.length });
  const handlers = [
    [/INSERT INTO quick_key_audit/, () => (data.audit++, rows([]))],
    [/FROM quick_key_group WHERE entity_id = \$1 AND NOT is_deleted/, (p) => rows(data.groups.filter((one) => same(one.entity_id, p[0]) && !one.is_deleted).sort((a, b) => a.sort_order - b.sort_order || String(a.name).localeCompare(b.name)))],
    [/FROM quick_key_group_item gi JOIN catalogue_items/, (p) => rows(data.items.filter((one) => p[0].includes(one.group_id)).sort((a, b) => a.position - b.position).map((one) => ({ group_id: one.group_id, product_id: one.product_id, position: one.position, name: (data.catalogue[one.product_id] || {}).name, price: (data.catalogue[one.product_id] || {}).price })))],
    [/INSERT INTO quick_key_group \(/, (p) => {
      const row = { id: id(), entity_id: p[0], name: p[1], color: p[2], sort_order: p[3], window_from: p[4], window_to: p[5], suggest_on_start: p[6], is_deleted: false, version: 1, updated_by: p[7], updated_at: STAMP };
      data.groups.push(row);
      return rows([row]);
    }],
    [/SELECT \* FROM quick_key_group WHERE id = \$1 AND entity_id = \$2/, (p) => rows([groupOf(p[0], p[1])].filter(Boolean))],
    [/UPDATE quick_key_group SET name=/, (p) => {
      const row = groupOf(p[7], p[8]);
      Object.assign(row, { name: p[0], color: p[1], sort_order: p[2], window_from: p[3], window_to: p[4], suggest_on_start: p[5], version: row.version + 1, updated_by: p[6], updated_at: STAMP });
      return rows([row]);
    }],
    [/UPDATE quick_key_group SET is_deleted = true/, (p) => {
      const row = groupOf(p[1], p[2]);
      Object.assign(row, { is_deleted: true, version: row.version + 1, updated_by: p[0], updated_at: STAMP });
      return rows([row]);
    }],
    [/SELECT id FROM quick_key_group WHERE id=\$1 AND entity_id=\$2 AND NOT is_deleted/, (p) => rows([groupOf(p[0], p[1])].filter((one) => one && !one.is_deleted).map((one) => ({ id: one.id })))],
    [/INSERT INTO quick_key_group_item/, (p) => {
      const found = data.items.find((one) => same(one.group_id, p[0]) && same(one.product_id, p[2]));
      const row = found || { group_id: p[0], entity_id: p[1], product_id: p[2], position: 0 };
      row.position = p[3];
      if (!found) data.items.push(row);
      return rows([row]);
    }],
    [/DELETE FROM quick_key_group_item/, (p) => {
      const gone = data.items.filter((one) => same(one.group_id, p[0]) && same(one.entity_id, p[1]) && same(one.product_id, p[2]));
      data.items = data.items.filter((one) => !gone.includes(one));
      return rows(gone);
    }],
    [/UPDATE quick_key_group_item q SET position/, () => rows([])],
    [/SELECT config, updated_at FROM device_screen_config WHERE entity_id=\$1 AND counter_id IS NULL/, (p) => rows(data.config[p[0]] ? [{ config: data.config[p[0]], updated_at: STAMP }] : [])],
    [/INSERT INTO device_screen_config/, (p) => {
      data.config[p[0]] = JSON.parse(p[1]);
      return rows([{ entity_id: p[0], counter_id: null, config: data.config[p[0]], updated_by: p[2], updated_at: STAMP }]);
    }]
  ];
  const answer = (sql, params) => {
    const found = handlers.find(([pattern]) => pattern.test(sql));
    return found ? found[1](params || []) : null;
  };
  /** a group of the owning shop, with its two keys, planted straight in the tables */
  const plantGroup = (entity, more) => {
    const row = Object.assign({ id: GROUP, entity_id: entity, name: 'Morning', color: null, sort_order: 0, window_from: null, window_to: null, suggest_on_start: false, is_deleted: false, version: 1, updated_by: null, updated_at: STAMP }, more);
    data.groups.push(row);
    data.items.push({ group_id: row.id, entity_id: entity, product_id: TEA, position: 1 }, { group_id: row.id, entity_id: entity, product_id: BUN, position: 2 });
    return row;
  };
  return { data, answer, plantGroup };
}

/** the tools a scene is built from: nothing but the ids */
function extras() {
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const N = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const planted = (more) => ({ plant: (world) => world.plantGroup(SHOP, more) });
  const failing = { setup: { db: 'fail' } };
  const R = (verb, tail) => verb + ' ' + Q + tail;
  const items = '/groups/:id/items';
  const at = (tail) => ({ url: Q + tail });
  return [
    X('groups-list', R('GET', '/groups'), 200, planted()),
    X('groups-list-empty', R('GET', '/groups'), 200, {}),
    X('groups-list-fails', R('GET', '/groups'), 500, failing),
    X('group-make', R('POST', '/groups'), 201, { body: { name: '  Morning rush  ', color: '#c00', sort_order: 2, suggest_on_start: 1 } }),
    X('group-make-no-name', R('POST', '/groups'), 400, { body: {} }),
    X('group-make-blank-name', R('POST', '/groups'), 400, { body: { name: '   ' } }),
    X('group-make-fails', R('POST', '/groups'), 500, Object.assign({ body: { name: 'x' } }, failing)),
    N('group-make-body-a-list', R('POST', '/groups'), 400, { body: [{ name: 'x' }] }),
    X('group-change', R('PATCH', '/groups/:id'), 200, Object.assign({ body: { name: 'Evening', version: 1 } }, at('/groups/' + GROUP), planted())),
    X('group-change-no-version', R('PATCH', '/groups/:id'), 200, Object.assign({ body: { color: '#0a0' } }, at('/groups/' + GROUP), planted())),
    X('group-change-stale', R('PATCH', '/groups/:id'), 409, Object.assign({ body: { name: 'Evening', version: 7 } }, at('/groups/' + GROUP), planted())),
    X('group-change-unknown', R('PATCH', '/groups/:id'), 404, Object.assign({ body: { name: 'Evening' } }, at('/groups/' + GROUP))),
    X('group-change-deleted', R('PATCH', '/groups/:id'), 404, Object.assign({ body: { name: 'Evening' } }, at('/groups/' + GROUP), planted({ is_deleted: true }))),
    X('group-change-fails', R('PATCH', '/groups/:id'), 500, Object.assign({ body: { name: 'Evening' } }, failing)),
    N('group-change-body-a-list', R('PATCH', '/groups/:id'), 400, Object.assign({ body: [] }, at('/groups/' + GROUP), planted())),
    X('group-drop', R('DELETE', '/groups/:id'), 200, Object.assign({ body: { version: 1 } }, at('/groups/' + GROUP), planted())),
    X('group-drop-stale', R('DELETE', '/groups/:id'), 409, Object.assign({ body: { version: 3 } }, at('/groups/' + GROUP), planted())),
    X('group-drop-unknown', R('DELETE', '/groups/:id'), 404, Object.assign({ body: {} }, at('/groups/' + GROUP))),
    X('group-drop-fails', R('DELETE', '/groups/:id'), 500, Object.assign({ body: {} }, failing)),
    N('group-drop-body-a-list', R('DELETE', '/groups/:id'), 400, Object.assign({ body: [] }, at('/groups/' + GROUP), planted())),
    N('group-drop-unknown-key', R('DELETE', '/groups/:id'), 400, Object.assign({ body: { version: 1, colour: 'red' } }, at('/groups/' + GROUP), planted())), /* closed body: refused by name, the group stays */
    X('key-add', R('POST', items), 201, Object.assign({ body: { product_id: BUN, position: 3 } }, at('/groups/' + GROUP + '/items'), planted())),
    X('key-add-no-product', R('POST', items), 400, Object.assign({ body: { position: 1 } }, at('/groups/' + GROUP + '/items'), planted())),
    X('key-add-unknown-group', R('POST', items), 404, Object.assign({ body: { product_id: BUN } }, at('/groups/' + GROUP + '/items'))),
    X('key-add-fails', R('POST', items), 500, Object.assign({ body: { product_id: BUN } }, failing)),
    N('key-add-body-a-list', R('POST', items), 400, Object.assign({ body: [] }, at('/groups/' + GROUP + '/items'), planted())),
    X('key-remove', R('DELETE', '/groups/:id/items/:productId'), 200, Object.assign(at('/groups/' + GROUP + '/items/' + TEA), planted())),
    X('key-remove-unknown', R('DELETE', '/groups/:id/items/:productId'), 200, at('/groups/' + GROUP + '/items/' + TEA)),
    X('key-remove-fails', R('DELETE', '/groups/:id/items/:productId'), 500, failing),
    X('keys-reorder', R('PATCH', items), 200, Object.assign({ body: { items: [{ product_id: BUN, position: 1 }, { product_id: TEA, position: 2 }] } }, at('/groups/' + GROUP + '/items'), planted())),
    X('keys-reorder-no-list', R('PATCH', items), 200, Object.assign({ body: {} }, at('/groups/' + GROUP + '/items'), planted())),
    N('keys-reorder-unknown-group', R('PATCH', items), 404, Object.assign({ body: { items: [{ product_id: TEA, position: 1 }] } }, at('/groups/' + GROUP + '/items'))),
    X('keys-reorder-fails', R('PATCH', items), 500, Object.assign({ body: { items: [{ product_id: TEA, position: 1 }] } }, failing)),
    N('keys-reorder-body-a-list', R('PATCH', items), 400, Object.assign({ body: [] }, at('/groups/' + GROUP + '/items'), planted())),
    X('screen-read-empty', R('GET', '/screen-config/default'), 200, {}),
    X('screen-read-set', R('GET', '/screen-config/default'), 200, { plant: (world) => { world.data.config[SHOP] = { cols: 4, tiles: [1, 2] }; } }),
    X('screen-read-fails', R('GET', '/screen-config/default'), 500, failing),
    X('screen-write', R('PUT', '/screen-config/default'), 200, { body: { config: { cols: 5 } } }),
    X('screen-write-no-config', R('PUT', '/screen-config/default'), 200, { body: {} }),
    X('screen-write-fails', R('PUT', '/screen-config/default'), 500, Object.assign({ body: { config: {} } }, failing)),
    N('screen-write-body-a-list', R('PUT', '/screen-config/default'), 400, { body: [] })
  ];
}

module.exports = { store, extras, STRANGER, OTHER_SHOP, GROUP, TEA, BUN, Q };
