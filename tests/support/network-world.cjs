/**
 * tests/support/network-world.cjs — THE STUBBED WORLD OF /api/network-offers: a store (adopts a brand's source, is in its network, one released
 * offer, one price notice) and the brand (authors a source, one member store, two offers). Rows are answered by SQL shape, so old and new
 * statements meet the same facts. Lifted out of tests/network-offers-shape.test.cjs (NET-32) so the golden shape test and the web-api contract
 * capture (tests/support/contract-network.cjs) read ONE world, never two.
 */
'use strict';
const S = '00000000-0000-4000-8000-00000000000a',
  B = '00000000-0000-4000-8000-00000000000b',
  O = '00000000-0000-4000-8000-00000000000c',
  O2 = '00000000-0000-4000-8000-00000000000d';
const AT = '2026-10-01T00:00:00.000Z';
const flagsB = {
  network_offers: { policy: 'opt_out', released: { [O]: { version: 1, at: AT, until: null, released_at: AT } } },
  network_catalogue: {
    pending: {},
    withdrawn_at: {},
    log: [{ id: 'L1', source_key: 'src1', applied_at: AT, changes: [{ name: 'Tea', kind: 'changed', fields: [{ field: 'price', from: 90, to: 100 }] }] }]
  }
};
const flagsS = { network_choices: { [O]: 'in' }, network_price_seen: {} };
const items = [{ name: 'Tea', price: 100, mrp: 110 }];
const first = (params) => String((params || [])[0] || '');
const rows = (sql, params) => {
  if (/FROM identities WHERE identity_id = ANY/.test(sql))
    return [S, B]
      .filter((id) => (params[0] || []).includes(id))
      .map((id) => ({ id, display_name: id === S ? 'Shop One' : 'Brand Handle', policy_flags: id === S ? flagsS : flagsB }));
  if (/^SELECT display_name(, gstn)?.* FROM identities WHERE identity_id = \$1/.test(sql))
    return [{ display_name: first(params) === S ? 'Shop One' : 'Brand Handle', policy_flags: first(params) === S ? flagsS : flagsB, country: 'IN' }];
  if (/FROM entity_profile/.test(sql)) return [];
  if (/FROM definition/.test(sql) && /status IN \('live', 'draft'\)/.test(sql))
    return first(params) === B
      ? [
          { definition_id: O, name: 'Tea Tuesday', sub_kind: 'discount', status: 'live', current_version: 1 },
          { definition_id: O2, name: 'Winter', sub_kind: 'combo', status: 'draft', current_version: 2 }
        ]
      : [];
  if (/FROM definition/.test(sql) && /definition_id::text = ANY/.test(sql))
    return first(params) === B ? [{ definition_id: O, name: 'Tea Tuesday', sub_kind: 'discount', status: 'live' }] : [];
  if (/AS owns/.test(sql))
    return first(params) === B
      ? [{ owns: true, node: 'n-b', bridge_id: 'brand.cb', root_bridge_id: 'brand.cb' }]
      : [{ owns: false, node: 'n-s', bridge_id: 'shop.cb', root_bridge_id: 'brand.cb' }];
  if (/'built' AS via/.test(sql))
    return first(params) === B ? [{ id: S, via: 'joined', state: 'active', edge_id: 'e1', asked_by: 'store', node_id: 'n-s', parent_node: 'n-b' }] : [];
  if (/FROM catalogue_adoption a LEFT JOIN catalogue_source s/.test(sql))
    return first(params) === S ? [{ source_key: 'src1', commercials: { Tea: { price: 95 } }, owner_entity_id: B, items }] : [];
  if (/^SELECT source_key, commercials FROM catalogue_adoption/.test(sql))
    return first(params) === S ? [{ source_key: 'src1', commercials: { Tea: { price: 95 } } }] : [];
  if (/^SELECT source_key, owner_entity_id(, items)? FROM catalogue_source WHERE source_key = ANY/.test(sql))
    return [{ source_key: 'src1', owner_entity_id: B, items }];
  if (/AS brand_id/.test(sql) && /cb_edge e ON e.child_id/.test(sql)) return first(params) === S ? [{ brand_id: B }] : [];
  if (/AS tree_parent/.test(sql))
    return [
      {
        brand_id: B,
        brand_node: 'n-b',
        store_node: 'n-s',
        brand_bridge_id: 'brand.cb',
        root_bridge_id: 'brand.cb',
        tree_parent: null,
        built: false,
        tree_state: null,
        tree_edge: null,
        edge_id: 'e1',
        edge_state: 'active',
        asked_by: 'store'
      }
    ];
  if (/^SELECT title FROM catalogue_source WHERE owner_entity_id/.test(sql)) return [{ title: 'Brand Co' }];
  if (/DISTINCT ON \(owner_entity_id\)/.test(sql)) return [{ id: B, title: 'Brand Co' }];
  if (/^SELECT b FROM unnest/.test(sql)) return [{ b: B }];
  if (/^SELECT source_key, title, items FROM catalogue_source WHERE owner_entity_id/.test(sql))
    return first(params) === B ? [{ source_key: 'src1', title: 'Brand Co', items }] : [];
  if (/FROM catalogue_items/.test(sql)) return first(params) === B ? [{ item_id: 'i1', item_data: { name: 'Tea', price: 100, mrp: 110 } }] : [];
  return [];
};
const known = { [S]: 'STORE', [B]: 'BRAND', [O]: 'OFFER', [O2]: 'OFFER2' };
module.exports = { S, B, O, O2, rows, known };
