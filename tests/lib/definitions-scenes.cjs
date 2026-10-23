/**
 * definitions-scenes.cjs — the named scenarios of tests/api-problem-definitions.test.cjs: the six routes of routes/definitions.js.
 *
 * OWNS      the extras: one scenario per refusal and per success of the six routes, each with the stand-in rows it needs; the one-shop-at-a-time rows of the "another shop" world.
 * CALLED BY tests/api-problem-definitions.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, body, url, after }] → the harness runs each one against the real route
 * CARD      07-catalogue-and-pricing/definitions
 */
'use strict';

const D = '/api/definitions';
const SHOP = '11111111-1111-4111-8111-111111111111';
const OTHER_SHOP = '99999999-9999-4999-8999-999999999999';
const DEF = '22222222-2222-4222-8222-222222222222';
const SLAB_B = '33333333-3333-4333-8333-333333333333';
const GOVERNED = 'IN-GST-18';
const NOT_AN_ID = 'not-an-id';
/** a definition row as the table holds it */
const rowOf = (more) => Object.assign({ definition_id: DEF, entity_id: SHOP, kind: 'pricing', sub_kind: null, name: 'Carton of 6', note: null, status: 'draft', current_version: 1, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', created_by: SHOP }, more);
const OFFER = { kind: 'offer', sub_kind: 'percent_off', name: 'Diwali 10%' };
const INDIA = { jurisdiction: { tax: { scheme: 'GST', slabs: [{ id: GOVERNED, name: 'GST 18%', rate: 18 }] } }, region_code: 'IN', currency: 'INR' };

function extras(tools) {
  const { answering, raising, firstOf } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const withRows = (answer) => ({ sqlRows: answer });
  const failing = { db: 'fail' };
  const found = (more) => answering(/SELECT \* FROM definition WHERE/, [rowOf(more)]);
  const kindAndStatus = (more) => answering(/SELECT kind, status FROM definition WHERE/, [Object.assign({ kind: 'pricing', status: 'live' }, more)]);
  const updated = (more) => answering(/UPDATE definition\s+SET name/, [rowOf(Object.assign({ current_version: 2 }, more))]);
  const inserted = (more) => answering(/INSERT INTO definition \(/, [rowOf(more)]);
  const liveOffers = answering(/d\.kind = 'offer' AND d\.status = 'live'/, [{ definition_id: SLAB_B, name: 'Flat 10', sub_kind: 'percent_off', rules: { percent: 10 } }]);
  const country = (code) => answering(/SELECT country, currency_code FROM identities/, [{ country: code, currency_code: null }]);
  const layers = answering(/FROM region_layer/, [INDIA]);
  const oneLayer = answering(/FROM region_layer WHERE region_code = \$1/, [INDIA]);
  const listed = answering(/FROM definition d\s+LEFT JOIN/, [Object.assign(rowOf({ kind: 'offer', status: 'live', name: 'Diwali 10%', current_version: 2 }), { rules: { percent: 10 }, version_at: '2026-10-02T00:00:00.000Z' })]);
  const migrated = (pattern) => raising(pattern, '42P01');
  const tax = { kind: 'tax' };
  const cited = answering(/count\(\*\)::int AS n/, [{ n: 3 }]);
  const takeoverTarget = answering(/d\.kind = 'tax' AND d\.status = 'live'/, [{ definition_id: SLAB_B, name: 'GST 12%', status: 'live', rules: { rate: 12 } }]);
  return [
    /* GET / */
    X('list-listed', 'GET ' + D, 200, { url: D + '?all=1', setup: withRows(listed) }),
    X('list-page', 'GET ' + D, 200, { url: D + '?kind=offer&status=live&page=1&limit=1', setup: withRows(listed) }),
    X('list-kinds', 'GET ' + D, 200, { url: D + '?kind=tax,category,offer', setup: withRows(listed) }),
    X('list-with-the-governed-slabs', 'GET ' + D, 200, { setup: withRows(firstOf(country('in'), layers, listed)) }),
    X('list-with-the-network-block', 'GET ' + D, 200, { url: D + '?kind=offer', setup: withRows(firstOf(answering(/policy_flags#>/, [{ released: { [DEF]: { at: '2026-10-03T00:00:00.000Z', version: 1 } }, stores: 3 }]), listed)) }),
    X('list-read-batch-fails-then-the-plain-read-answers', 'GET ' + D, 200, { setup: withRows(firstOf(raising(/FROM region_layer WHERE region_code IN/, '57014'), country('in'), oneLayer, listed)) }),
    X('list-no-country-says-why', 'GET ' + D, 200, { setup: withRows(firstOf(raising(/FROM region_layer WHERE region_code IN/, '57014'), country(null), listed)) }),
    X('list-not-migrated', 'GET ' + D, 503, { setup: withRows(migrated(/FROM definition d/)) }),
    /* GET /:id */
    X('read-one', 'GET ' + D + '/:id', 200, { setup: withRows(firstOf(found(), answering(/FROM definition_version/, [{ version: 1, rules: { qty: 6 }, note: null, created_at: '2026-10-01T00:00:00.000Z', created_by: SHOP }]), answering(/definition_status_log/, [{ status: 'live', changed_at: '2026-10-02T00:00:00.000Z', changed_by: SHOP, changed_by_name: 'Test shop' }]))) }),
    X('read-one-not-migrated', 'GET ' + D + '/:id', 503, { setup: withRows(migrated(/SELECT \* FROM definition WHERE/)) }),
    X('read-one-id-is-not-a-uuid', 'GET ' + D + '/:id', 500, { url: D + '/' + NOT_AN_ID, setup: withRows(raising(/SELECT \* FROM definition WHERE/, '22P02')) }),
    X('read-one-history-fails', 'GET ' + D + '/:id', 500, { setup: withRows(firstOf(found(), raising(/FROM definition_version/, '08006'))) }),
    /* POST / */
    X('create-nothing-sent', 'POST ' + D, 400, { body: {} }),
    X('create-kind-only', 'POST ' + D, 400, { body: { kind: 'pricing' } }),
    X('create-name-only', 'POST ' + D, 400, { body: { name: 'Carton of 6' } }),
    X('create-both-blank', 'POST ' + D, 400, { body: { kind: ' ', name: '' } }),
    X('create-both-null', 'POST ' + D, 400, { body: { kind: null, name: null } }),
    X('create-kind-is-a-number', 'POST ' + D, 400, { body: { kind: 5, name: 'Carton of 6' } }),
    X('create-name-is-a-list', 'POST ' + D, 400, { body: { kind: 'pricing', name: ['Carton'] } }),
    X('create-body-is-a-list', 'POST ' + D, 400, { body: [] }),
    X('create-offer-without-its-percent', 'POST ' + D, 422, { body: Object.assign({ rules: {} }, OFFER) }),
    X('create-draft', 'POST ' + D, 201, { body: { kind: 'pricing', name: '  Carton of 6  ', note: 'six to a box', rules: { qty: 6 } }, setup: withRows(inserted()) }),
    X('create-live-offer', 'POST ' + D, 201, { body: Object.assign({ status: 'live', rules: { percent: 10 } }, OFFER), setup: withRows(inserted({ kind: 'offer', status: 'live' })) }),
    X('create-offer-clash', 'POST ' + D, 409, { body: Object.assign({ status: 'live', rules: { percent: 10 } }, OFFER), setup: withRows(liveOffers) }),
    X('create-name-taken', 'POST ' + D, 409, { body: { kind: 'pricing', name: 'Carton of 6' }, setup: withRows(raising(/INSERT INTO definition \(/, '23505')) }),
    X('create-not-migrated', 'POST ' + D, 503, { body: { kind: 'pricing', name: 'Carton of 6' }, setup: withRows(migrated(/INSERT INTO definition \(/)) }),
    X('create-db-fails', 'POST ' + D, 500, { body: { kind: 'pricing', name: 'Carton of 6' }, setup: failing }),
    X('create-version-write-fails', 'POST ' + D, 500, { body: { kind: 'pricing', name: 'Carton of 6' }, setup: withRows(firstOf(inserted(), raising(/INSERT INTO definition_version/, '08006'))) }),
    /* PUT /:id */
    X('save-a-governed-slab', 'PUT ' + D + '/:id', 403, { url: D + '/' + GOVERNED, body: { name: 'x' } }),
    X('save-renamed', 'PUT ' + D + '/:id', 200, { body: { name: 'Box of 6', note: 'renamed' }, setup: withRows(firstOf(found(), updated({ name: 'Box of 6' }))) }),
    X('save-new-version', 'PUT ' + D + '/:id', 200, { body: { rules: { qty: 12 }, note: 'twelve' }, setup: withRows(firstOf(found(), updated())) }),
    X('save-made-live', 'PUT ' + D + '/:id', 200, { body: { status: 'live' }, setup: withRows(firstOf(found(), updated({ status: 'live' }))) }),
    X('save-same-status-again', 'PUT ' + D + '/:id', 200, { body: { status: 'draft' }, setup: withRows(firstOf(found(), updated())) }),
    X('save-rules-are-a-list', 'PUT ' + D + '/:id', 200, { body: { rules: [] }, setup: withRows(firstOf(found(), updated())) }),
    X('save-incomplete-slab', 'PUT ' + D + '/:id', 422, { body: { rules: {} }, setup: withRows(found(tax)) }),
    X('save-offer-clash', 'PUT ' + D + '/:id', 409, { body: { status: 'live', rules: { percent: 10 } }, setup: withRows(firstOf(found(OFFER), liveOffers)) }),
    X('save-live-offer-rename-is-not-asked', 'PUT ' + D + '/:id', 200, { body: { name: 'Diwali' }, setup: withRows(firstOf(found(Object.assign({ status: 'live' }, OFFER)), updated())) }),
    X('save-name-taken', 'PUT ' + D + '/:id', 409, { body: { name: 'Box' }, setup: withRows(firstOf(found(), raising(/UPDATE definition\s+SET name/, '23505'))) }),
    X('save-not-migrated', 'PUT ' + D + '/:id', 503, { body: { name: 'Box' }, setup: withRows(migrated(/SELECT \* FROM definition WHERE/)) }),
    X('save-id-is-not-a-uuid', 'PUT ' + D + '/:id', 500, { url: D + '/' + NOT_AN_ID, body: { name: 'Box' }, setup: withRows(raising(/SELECT \* FROM definition WHERE/, '22P02')) }),
    X('save-update-fails', 'PUT ' + D + '/:id', 500, { body: { name: 'Box' }, setup: withRows(firstOf(found(), raising(/UPDATE definition\s+SET name/, '08006'))) }),
    X('save-body-is-a-list', 'PUT ' + D + '/:id', 400, { body: [], after: true, setup: withRows(firstOf(found(), updated())) }),
    /* DELETE /:id */
    X('retire-a-governed-slab', 'DELETE ' + D + '/:id', 403, { url: D + '/' + GOVERNED }),
    X('retire-one', 'DELETE ' + D + '/:id', 200, { setup: withRows(kindAndStatus()) }),
    X('retire-one-already-retired', 'DELETE ' + D + '/:id', 200, { setup: withRows(kindAndStatus({ status: 'retired' })) }),
    X('retire-a-slab-nothing-cites', 'DELETE ' + D + '/:id', 200, { setup: withRows(firstOf(kindAndStatus(tax), answering(/count\(\*\)::int AS n/, [{ n: 0 }]))) }),
    X('retire-a-slab-that-is-cited', 'DELETE ' + D + '/:id', 409, { setup: withRows(firstOf(kindAndStatus(tax), cited)) }),
    X('retire-takeover-is-the-same-slab', 'DELETE ' + D + '/:id', 400, { url: D + '/' + DEF + '?takeover=' + DEF, setup: withRows(firstOf(kindAndStatus(tax), cited)) }),
    X('retire-takeover-is-not-a-live-slab', 'DELETE ' + D + '/:id', 400, { url: D + '/' + DEF + '?takeover=' + SLAB_B, setup: withRows(firstOf(kindAndStatus(tax), cited)) }),
    X('retire-a-slab-with-a-takeover', 'DELETE ' + D + '/:id', 200, { url: D + '/' + DEF + '?takeover=' + SLAB_B, setup: withRows(firstOf(kindAndStatus(tax), cited, takeoverTarget)) }),
    X('retire-a-slab-with-a-governed-takeover', 'DELETE ' + D + '/:id', 200, { url: D + '/' + DEF + '?takeover=' + GOVERNED, setup: withRows(firstOf(kindAndStatus(tax), cited, country('in'), oneLayer)) }),
    X('retire-not-migrated', 'DELETE ' + D + '/:id', 503, { setup: withRows(migrated(/SELECT kind, status FROM definition/)) }),
    X('retire-id-is-not-a-uuid', 'DELETE ' + D + '/:id', 500, { url: D + '/' + NOT_AN_ID, setup: withRows(raising(/SELECT kind, status FROM definition/, '22P02')) }),
    X('retire-update-fails', 'DELETE ' + D + '/:id', 500, { setup: withRows(firstOf(kindAndStatus(), raising(/UPDATE definition SET status = 'retired'/, '08006'))) }),
    /* POST /freeze */
    X('freeze-nothing-sent', 'POST ' + D + '/freeze', 400, { body: {} }),
    X('freeze-ids-are-text', 'POST ' + D + '/freeze', 400, { body: { definition_ids: DEF } }),
    X('freeze-ids-are-an-object', 'POST ' + D + '/freeze', 400, { body: { definition_ids: {} } }),
    X('freeze-body-is-a-list', 'POST ' + D + '/freeze', 400, { body: [DEF] }),
    X('freeze-an-empty-list', 'POST ' + D + '/freeze', 200, { body: { definition_ids: [] } }),
    X('freeze-blank-ids-only', 'POST ' + D + '/freeze', 200, { body: { definition_ids: ['', null] } }),
    X('freeze-one', 'POST ' + D + '/freeze', 200, { body: { definition_ids: [DEF] }, setup: withRows(answering(/JOIN definition_version v/, [{ definition_id: DEF, kind: 'pricing', sub_kind: null, name: 'Carton of 6', status: 'retired', version: 3, rules: { qty: 6 } }])) }),
    X('freeze-one-and-one-unknown', 'POST ' + D + '/freeze', 200, { body: { definition_ids: [DEF, SLAB_B] }, setup: withRows(answering(/JOIN definition_version v/, [{ definition_id: DEF, kind: 'pricing', sub_kind: null, name: 'Carton of 6', status: 'live', version: 1, rules: {} }])) }),
    X('freeze-a-governed-slab', 'POST ' + D + '/freeze', 200, { body: { definition_ids: [GOVERNED, 'IN-GST-99'] }, setup: withRows(firstOf(country('in'), oneLayer)) }),
    X('freeze-not-migrated', 'POST ' + D + '/freeze', 503, { body: { definition_ids: [DEF] }, setup: withRows(migrated(/JOIN definition_version v/)) }),
    X('freeze-id-is-not-a-uuid', 'POST ' + D + '/freeze', 500, { body: { definition_ids: [NOT_AN_ID] }, setup: withRows(raising(/JOIN definition_version v/, '22P02')) }),
    X('freeze-db-fails', 'POST ' + D + '/freeze', 500, { body: { definition_ids: [DEF] }, setup: failing })
  ];
}

module.exports = { extras, rowOf, DEF, SHOP, OTHER_SHOP, GOVERNED, NOT_AN_ID, SLAB_B, OFFER, D };
