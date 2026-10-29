/**
 * channels-scenes.cjs — the named scenarios of tests/api-problem-channels.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of routes/channels.js worth holding (every refusal the library raises, the platform doors with and without their key,
 *           a success with its stand-in rows), and the stand-in rows they need.
 * CALLED BY tests/api-problem-channels.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db, adminKey }, body, url, after }] → the harness runs each one against the real route
 * CARD      qa/offline-guards
 * A scenario with `after: true` is an answer the sweep ADDS (the schema's refusal): the old code answered it otherwise, so it is run in a check but never frozen.
 */
'use strict';
const C = '/api/channels';
const SHOP = '11111111-1111-4111-8111-111111111111';
const BINDING = '66666666-6666-4666-8666-666666666666';
const ADMIN_KEY = 'a-long-platform-key-for-the-tests';
const NUMBER = '+919876543210';
const BINDING_ROW = { id: BINDING, channel: 'whatsapp', address: NUMBER, label: 'Shop', provider_ref: '1234567890', status: 'declared', verified_at: null, verified_via: null, templates: {}, created_at: '2026-10-01T00:00:00.000Z', auto_raise: false };
/** the text a provider or a failed fetch left in a receipt (lib/whatsapp-out.js writes it, GET /outbound lists it): a 200 that carries it is a finding, held here as it is */
const PROVIDER_TEXT = '(#131030) Recipient phone number not in allowed list';

/** the statements and rows a scene plants: each answers one statement of lib/channels.js */
function rowsOf(tools) {
  const { answering, raising } = tools;
  return {
    list: answering(/FROM channel_binding WHERE entity_id/, [BINDING_ROW]),
    outbound: tools.firstOf(
      answering(/count\(\*\)::int AS n/, [{ n: 1 }]),
      answering(/FROM channel_outbound o/, [{ id: 'o1', chit_id: null, capture_id: null, channel: 'whatsapp', from_ref: NUMBER, to_ref: '+919000000001', body: 'Hello', status: 'failed', reason: PROVIDER_TEXT, provider_msg_id: null, created_at: '2026-10-01T00:00:00.000Z' }])
    ),
    providerRef: answering(/SET provider_ref = \$3/, [{ id: BINDING, address: NUMBER, provider_ref: '1234567890', status: 'declared' }]),
    autoRaise: answering(/SET auto_raise = \$3/, [{ id: BINDING, address: NUMBER, status: 'declared', auto_raise: true }]),
    template: answering(/jsonb_set/, [{ id: BINDING, address: NUMBER, templates: { order_status_update: 'pending' } }]),
    inserted: answering(/INSERT INTO channel_binding/, [{ id: BINDING, channel: 'whatsapp', address: NUMBER, label: 'Shop', provider_ref: null, status: 'declared', created_at: '2026-10-01T00:00:00.000Z' }]),
    removed: answering(/DELETE FROM channel_binding/, [{ id: BINDING }]),
    statused: answering(/channel_set_status/, [{ id: BINDING, entity_id: SHOP, channel: 'whatsapp', address: NUMBER, status: 'verified', verified_at: '2026-10-01T00:00:00.000Z', verified_via: 'platform' }]),
    taken: raising(/INSERT INTO channel_binding/, '23505'),
    noTable: raising(/channel_binding/, '42P01'),
    noColumn: raising(/auto_raise/, '42703'),
    noFunction: raising(/channel_set_status/, '42883'),
    malformedId: raising(/channel_binding|channel_set_status/, '22P02'),
    noOutboundTable: raising(/channel_outbound/, '42P01')
  };
}

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const rows = rowsOf(tools);
  const make = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** an answer the sweep adds: never frozen */
  const added = (id, route, expect, more) => make(id, route, expect, Object.assign({ after: true }, more));
  const withRows = (answer, more) => Object.assign({ sqlRows: answer }, more);
  const platform = (answer) => withRows(answer, { adminKey: ADMIN_KEY, envKey: ADMIN_KEY });
  const wrongKey = { adminKey: 'not-the-key', envKey: ADMIN_KEY };
  const failing = { db: 'fail' };
  const asId = (route) => route.replace(':id', BINDING);
  return [
    /* GET / */
    make('list-bindings', 'GET ' + C, 200, { setup: withRows(rows.list) }),
    make('list-none-yet', 'GET ' + C, 200, {}),
    make('list-not-migrated', 'GET ' + C, 200, { setup: withRows(rows.noTable) }),
    make('list-before-auto-raise', 'GET ' + C, 200, { setup: withRows(tools.firstOf(rows.noColumn, rows.list)) }),
    make('list-fails', 'GET ' + C, 500, { setup: failing }),
    make('list-answer-fails', 'GET ' + C, 500, { setup: { jsonThrows: true } }),
    /* GET /outbound */
    make('outbound-page', 'GET ' + C + '/outbound', 200, { setup: withRows(rows.outbound) }),
    make('outbound-asked', 'GET ' + C + '/outbound', 200, { url: C + '/outbound?status=failed&page=1&limit=10', setup: withRows(rows.outbound) }),
    make('outbound-purpose-before-b776', 'GET ' + C + '/outbound', 200, { url: C + '/outbound?purpose=marketing', setup: {} }),
    make('outbound-not-migrated', 'GET ' + C + '/outbound', 200, { setup: withRows(rows.noOutboundTable) }),
    make('outbound-fails', 'GET ' + C + '/outbound', 500, { setup: failing }),
    added('outbound-doubled-value', 'GET ' + C + '/outbound', 400, { url: C + '/outbound?status=sent&status=failed', setup: withRows(rows.outbound) }),
    /* POST / */
    make('bind-ok', 'POST ' + C, 201, { body: { channel: 'whatsapp', address: '+91 98765 43210', label: 'Shop' }, setup: withRows(rows.inserted) }),
    make('bind-unknown-channel', 'POST ' + C, 400, { body: { channel: 'fax', address: '123' } }),
    make('bind-no-channel', 'POST ' + C, 400, { body: {} }),
    make('bind-no-address', 'POST ' + C, 400, { body: { channel: 'email', address: '  ' } }),
    make('bind-address-taken', 'POST ' + C, 409, { body: { channel: 'whatsapp', address: NUMBER }, setup: withRows(rows.taken) }),
    make('bind-not-migrated', 'POST ' + C, 503, { body: { channel: 'whatsapp', address: NUMBER }, setup: withRows(rows.noTable) }),
    make('bind-fails', 'POST ' + C, 500, { body: { channel: 'whatsapp', address: NUMBER }, setup: failing }),
    make('bind-body-a-list', 'POST ' + C, 400, { body: [] }),
    /* POST /:id/provider-ref */
    make('ref-ok', 'POST ' + C + '/:id/provider-ref', 200, { url: asId(C + '/:id/provider-ref'), body: { provider_ref: '1234567890' }, setup: withRows(rows.providerRef) }),
    make('ref-no-such-binding', 'POST ' + C + '/:id/provider-ref', 404, { url: asId(C + '/:id/provider-ref'), body: { provider_ref: '1' } }),
    make('ref-not-migrated', 'POST ' + C + '/:id/provider-ref', 503, { url: asId(C + '/:id/provider-ref'), body: { provider_ref: '1' }, setup: withRows(rows.noTable) }),
    make('ref-malformed-id', 'POST ' + C + '/:id/provider-ref', 500, { url: C + '/nope/provider-ref', body: { provider_ref: '1' }, setup: withRows(rows.malformedId) }),
    make('ref-fails', 'POST ' + C + '/:id/provider-ref', 500, { url: asId(C + '/:id/provider-ref'), body: { provider_ref: '1' }, setup: failing }),
    make('ref-body-a-list', 'POST ' + C + '/:id/provider-ref', 200, { url: asId(C + '/:id/provider-ref'), body: [], setup: withRows(rows.providerRef) }),
    /* POST /:id/auto-raise */
    make('auto-ok', 'POST ' + C + '/:id/auto-raise', 200, { url: asId(C + '/:id/auto-raise'), body: { on: true }, setup: withRows(rows.autoRaise) }),
    make('auto-no-such-binding', 'POST ' + C + '/:id/auto-raise', 404, { url: asId(C + '/:id/auto-raise'), body: { on: true } }),
    make('auto-column-not-migrated', 'POST ' + C + '/:id/auto-raise', 503, { url: asId(C + '/:id/auto-raise'), body: { on: true }, setup: withRows(rows.noColumn) }),
    make('auto-table-not-migrated', 'POST ' + C + '/:id/auto-raise', 503, { url: asId(C + '/:id/auto-raise'), body: { on: true }, setup: withRows(rows.noTable) }),
    make('auto-fails', 'POST ' + C + '/:id/auto-raise', 500, { url: asId(C + '/:id/auto-raise'), body: { on: true }, setup: failing }),
    make('auto-body-a-list', 'POST ' + C + '/:id/auto-raise', 200, { url: asId(C + '/:id/auto-raise'), body: [], setup: withRows(rows.autoRaise) }),
    /* POST /:id/template */
    make('template-pending', 'POST ' + C + '/:id/template', 200, { url: asId(C + '/:id/template'), body: { name: 'order_status_update', state: 'pending' }, setup: withRows(rows.template) }),
    make('template-unknown', 'POST ' + C + '/:id/template', 400, { url: asId(C + '/:id/template'), body: { name: 'nope', state: 'pending' } }),
    make('template-bad-state', 'POST ' + C + '/:id/template', 400, { url: asId(C + '/:id/template'), body: { name: 'order_status_update', state: 'maybe' } }),
    make('template-shop-cannot-approve', 'POST ' + C + '/:id/template', 403, { url: asId(C + '/:id/template'), body: { name: 'order_status_update', state: 'approved' } }),
    make('template-no-such-binding', 'POST ' + C + '/:id/template', 404, { url: asId(C + '/:id/template'), body: { name: 'order_status_update', state: 'pending' } }),
    make('template-not-migrated', 'POST ' + C + '/:id/template', 503, { url: asId(C + '/:id/template'), body: { name: 'order_status_update', state: 'pending' }, setup: withRows(rows.noTable) }),
    make('template-fails', 'POST ' + C + '/:id/template', 500, { url: asId(C + '/:id/template'), body: { name: 'order_status_update', state: 'pending' }, setup: failing }),
    make('template-body-a-list', 'POST ' + C + '/:id/template', 400, { url: asId(C + '/:id/template'), body: [], setup: withRows(rows.template) }),
    /* DELETE /:id */
    make('unbind-ok', 'DELETE ' + C + '/:id', 200, { url: asId(C + '/:id'), setup: withRows(rows.removed) }),
    make('unbind-no-such-binding', 'DELETE ' + C + '/:id', 404, { url: asId(C + '/:id') }),
    make('unbind-not-migrated', 'DELETE ' + C + '/:id', 503, { url: asId(C + '/:id'), setup: withRows(rows.noTable) }),
    make('unbind-fails', 'DELETE ' + C + '/:id', 500, { url: asId(C + '/:id'), setup: failing }),
    /* the platform doors: header x-cb-admin-key against CB_ADMIN_KEY (the stand-in sign-in is never asked) */
    make('approve-ok', 'POST ' + C + '/:id/approve', 200, { url: asId(C + '/:id/approve'), body: { via: 'platform' }, setup: platform(rows.statused) }),
    make('approve-default-via', 'POST ' + C + '/:id/approve', 200, { url: asId(C + '/:id/approve'), body: {}, setup: platform(rows.statused) }),
    make('approve-wrong-key', 'POST ' + C + '/:id/approve', 403, { url: asId(C + '/:id/approve'), setup: wrongKey }),
    make('approve-key-of-another-length', 'POST ' + C + '/:id/approve', 403, { url: asId(C + '/:id/approve'), setup: { adminKey: 'short', envKey: ADMIN_KEY } }),
    make('approve-no-key-given', 'POST ' + C + '/:id/approve', 403, { url: asId(C + '/:id/approve'), setup: { envKey: ADMIN_KEY } }),
    make('approve-switched-off', 'POST ' + C + '/:id/approve', 503, { url: asId(C + '/:id/approve'), setup: { adminKey: ADMIN_KEY } }),
    make('approve-no-such-binding', 'POST ' + C + '/:id/approve', 404, { url: asId(C + '/:id/approve'), setup: platform(null) }),
    make('approve-not-migrated', 'POST ' + C + '/:id/approve', 503, { url: asId(C + '/:id/approve'), setup: platform(rows.noFunction) }),
    make('approve-fails', 'POST ' + C + '/:id/approve', 500, { url: asId(C + '/:id/approve'), setup: Object.assign(platform(null), failing) }),
    make('approve-body-a-list', 'POST ' + C + '/:id/approve', 200, { url: asId(C + '/:id/approve'), body: [], setup: platform(rows.statused) }),
    make('revoke-ok', 'POST ' + C + '/:id/revoke', 200, { url: asId(C + '/:id/revoke'), setup: platform(rows.statused) }),
    make('revoke-wrong-key', 'POST ' + C + '/:id/revoke', 403, { url: asId(C + '/:id/revoke'), setup: wrongKey }),
    make('revoke-switched-off', 'POST ' + C + '/:id/revoke', 503, { url: asId(C + '/:id/revoke'), setup: { adminKey: ADMIN_KEY } }),
    make('revoke-no-such-binding', 'POST ' + C + '/:id/revoke', 404, { url: asId(C + '/:id/revoke'), setup: platform(null) }),
    make('revoke-not-migrated', 'POST ' + C + '/:id/revoke', 503, { url: asId(C + '/:id/revoke'), setup: platform(rows.noFunction) }),
    make('revoke-fails', 'POST ' + C + '/:id/revoke', 500, { url: asId(C + '/:id/revoke'), setup: Object.assign(platform(null), failing) }),
    make('template-approve-ok', 'POST ' + C + '/:id/template-approve', 200, { url: asId(C + '/:id/template-approve'), body: { entity_id: SHOP, name: 'order_status_update' }, setup: platform(rows.template) }),
    make('template-approve-wrong-key', 'POST ' + C + '/:id/template-approve', 403, { url: asId(C + '/:id/template-approve'), body: { entity_id: SHOP, name: 'order_status_update' }, setup: wrongKey }),
    make('template-approve-unknown', 'POST ' + C + '/:id/template-approve', 400, { url: asId(C + '/:id/template-approve'), body: { entity_id: SHOP, name: 'nope' }, setup: platform(null) }),
    make('template-approve-no-such-binding', 'POST ' + C + '/:id/template-approve', 404, { url: asId(C + '/:id/template-approve'), body: { entity_id: SHOP, name: 'order_status_update' }, setup: platform(null) }),
    make('template-approve-not-migrated', 'POST ' + C + '/:id/template-approve', 503, { url: asId(C + '/:id/template-approve'), body: { entity_id: SHOP, name: 'order_status_update' }, setup: platform(rows.noTable) }),
    make('template-approve-fails', 'POST ' + C + '/:id/template-approve', 500, { url: asId(C + '/:id/template-approve'), body: { entity_id: SHOP, name: 'order_status_update' }, setup: Object.assign(platform(null), failing) }),
    make('template-approve-body-a-list', 'POST ' + C + '/:id/template-approve', 400, { url: asId(C + '/:id/template-approve'), body: [], setup: platform(rows.template) })
  ];
}


/** a library error WITH a status (a 503 where the route declares one, else a 500): which routes pass its sentence on, which keep the status and say only the safe one */
function relays() {
  const raised = (name, status) => ({ channels: { [name]: async () => { throw Object.assign(new Error('Because: library words.'), { status }); } } });
  const relay = (id, route, name, status, more) => Object.assign({ id, route, expect: status, setup: {}, patch: raised(name, status) }, more);
  const door = { adminKey: ADMIN_KEY, envKey: ADMIN_KEY };
  const idUrl = (tail) => C + '/' + BINDING + tail;
  return [
    relay('relay-list', 'GET ' + C, 'listChannels', 500),
    relay('relay-outbound', 'GET ' + C + '/outbound', 'listOutbound', 500),
    relay('relay-bind', 'POST ' + C, 'addBinding', 500, { body: { channel: 'whatsapp', address: NUMBER } }),
    relay('relay-provider-ref', 'POST ' + C + '/:id/provider-ref', 'setProviderRef', 503, { url: idUrl('/provider-ref'), body: { provider_ref: '1' } }),
    relay('relay-auto-raise', 'POST ' + C + '/:id/auto-raise', 'setAutoRaise', 503, { url: idUrl('/auto-raise'), body: { on: true } }),
    relay('relay-template', 'POST ' + C + '/:id/template', 'setTemplate', 500, { url: idUrl('/template'), body: { name: 'order_status_update', state: 'pending' } }),
    relay('relay-unbind', 'DELETE ' + C + '/:id', 'removeBinding', 503, { url: idUrl('') }),
    relay('relay-approve', 'POST ' + C + '/:id/approve', 'approveBinding', 503, { url: idUrl('/approve'), setup: door }),
    relay('relay-revoke', 'POST ' + C + '/:id/revoke', 'revokeBinding', 503, { url: idUrl('/revoke'), setup: door }),
    relay('relay-template-approve', 'POST ' + C + '/:id/template-approve', 'setTemplate', 500, { url: idUrl('/template-approve'), body: { entity_id: SHOP, name: 'order_status_update' }, setup: door })
  ];
}

module.exports = { extras, relays, rowsOf, SHOP, BINDING, ADMIN_KEY, NUMBER, PROVIDER_TEXT };
