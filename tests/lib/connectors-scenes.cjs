/**
 * connectors-scenes.cjs — the named scenarios of tests/api-problem-connectors.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the stand-in database of the connector routes (stubRows: a statement answered by its shape, so the same facts meet the old and the new code), the ids and the keys it
 *           knows, and the extras: one scenario per answer of the 14 routes of routes/connectors.js (/api/connectors).
 * CALLED BY tests/api-problem-connectors.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who }, body, url, patch, after }] → the harness runs each one against the real route
 * CARD      28-platform-and-operations/connectors-routes
 * A device (POST /ingest, POST /erp-ingest) has no session: its key rides in the body (`key`), which deviceActor reads when there is no X-Bridge-Key header.
 */
'use strict';
const crypto = require('crypto');

const SHOP = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const PARTY = '33333333-3333-4333-8333-333333333333';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const FOREIGN_PARTY = '77777777-7777-4777-8777-777777777777';
const CONNECTION = '7';
const BRIDGE = 'CBDEVICE1';
const GOOD_KEY = 'device-key-good';
const IOT_KEY = 'device-key-iot';
const OFF_KEY = 'device-key-off';
const ASLEEP_KEY = 'device-key-asleep';
const STAMP = '2026-10-01T10:00:00.000Z';
const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

const ERP_ACTOR = { identity_id: ACTOR, display_name: 'Tally Mayur', connector_type: 'erp', site: 'Office', connector_config: { base_url: 'https://erp.example.com', auth_type: 'key', auth_ref: 'erp-key-ref', counterparty_entity_id: PARTY }, last_seen: STAMP };
const IOT_ACTOR = { identity_id: ACTOR, display_name: 'Cold room Pi', connector_type: 'iot', site: 'Yard', connector_config: { mode: 'push' }, last_seen: STAMP };
const CONNECTION_ROW = { connection_id: Number(CONNECTION), actor_id: ACTOR, entity_id: SHOP, direction: 'in', ref: 'sensor-1', schema_ref: null, counterparty_entity_id: null, retention: 'never_persist', bridge_id: BRIDGE, conn_config: { topic: 'cold/1' }, enabled: true, last_seen: STAMP, created_at: STAMP };
const KEYS = {
  [GOOD_KEY]: { type: 'erp', status: 'active', caps: ['connector'] },
  [IOT_KEY]: { type: 'iot', status: 'active', caps: ['connector'] },
  [OFF_KEY]: { type: 'iot', status: 'active', caps: [] },
  [ASLEEP_KEY]: { type: 'iot', status: 'inactive', caps: ['connector'] }
};

const answer = (rows) => ({ rows, rowCount: rows.length });
/** an error the way pg raises one: its text is the database's, which no answer may carry (a body scan finds it) */
const SECRET_TEXT = 'relation "secret_table" does not exist -- SELECT secret FROM vault';
const pgError = (code, message) => Object.assign(new Error(message || SECRET_TEXT), { code });

/**
 * stubRows(spec) → the harness's sqlRows: the rows a statement gets, by its shape. spec: { caps, hat, actor, owner, connections, receipts, email, otpRow, parties, noEntity, duplicate, raise: [[pattern, code, message?]], conn, connMissing }.
 * A record is answered only to its owning shop (spec.owner, SHOP unless the scene is asking as a stranger), as RLS and `WHERE parent_entity_id = $2` would.
 */
function stubRows(spec) {
  const s = Object.assign({ caps: ['connector'], hat: 'act', actor: ERP_ACTOR, owner: SHOP, connections: [CONNECTION_ROW], receipts: [], email: 'owner@example.com', otpRow: null, parties: [PARTY], raise: [] }, spec);
  const mine = (params) => params[0] === ACTOR && params[1] === s.owner && s.actor;
  return (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    const hit = s.raise.find(([pattern]) => pattern.test(text));
    if (hit) throw pgError(hit[1], hit[2]);
    if (/SELECT capabilities FROM identities/.test(text)) return answer([{ capabilities: s.caps }]);
    if (/SELECT hat FROM identities/.test(text)) return answer([{ hat: s.hat }]);
    if (/FROM identities a LEFT JOIN identities p/.test(text)) {
      const key = Object.keys(KEYS).find((name) => hashKey(name) === params[0]);
      const found = key && KEYS[key];
      return answer(found ? [{ identity_id: ACTOR, parent_entity_id: SHOP, display_name: 'Pi', connector_type: found.type, status: found.status, connector_config: found.type === 'erp' ? { counterparty_entity_id: PARTY } : {}, shop_capabilities: found.caps }] : []);
    }
    if (/AS party/.test(text)) return answer([{ display_name: 'Chola', party: s.parties.includes(params[1]), may: s.parties.includes(params[1]) }]);
    if (/SELECT bridge_id, display_name, currency_code, country FROM identities/.test(text)) return answer(s.noEntity ? [] : [{ bridge_id: 'CBSHOP', display_name: 'Mayur', currency_code: 'INR', country: 'IN' }]);
    if (/SELECT identity_id, bridge_id, display_name FROM identities WHERE identity_id = \$1 AND status = 'active'/.test(text)) return answer([{ identity_id: params[0], bridge_id: 'CBX', display_name: 'X' }]);
    if (/FROM identities WHERE identity_id = \$1 AND parent_entity_id = \$2 AND connector_type = 'erp'/.test(text)) return answer(mine(params) && s.actor.connector_type === 'erp' ? [{ '?column?': 1 }] : []);
    if (/SELECT identity_id, parent_entity_id, display_name, connector_type, connector_config FROM identities/.test(text)) return answer(mine(params) && s.actor.connector_type === 'erp' ? [Object.assign({ parent_entity_id: SHOP }, s.actor)] : []);
    if (/SELECT identity_id, display_name, connector_type, site, connector_config, last_seen FROM identities/.test(text)) return answer(mine(params) ? [s.actor] : []);
    if (/SELECT identity_id, display_name, connector_type, site, connector_config, last_seen, status, created_at/.test(text)) return answer([Object.assign({ status: 'active', created_at: STAMP, connection_count: '1' }, s.actor)]);
    if (/SELECT email, display_name FROM identities/.test(text)) return answer(s.email === null ? [{ email: null, display_name: 'Mayur' }] : [{ email: s.email, display_name: 'Mayur' }]);
    if (/SELECT identity_id, otp_code, otp_expires_at, otp_attempts FROM identities/.test(text)) return answer([s.otpRow || { identity_id: SHOP, otp_code: '482910', otp_expires_at: new Date('2099-01-01T00:00:00Z'), otp_attempts: 0 }]);
    if (/INSERT INTO connector_receipt/.test(text)) return answer(s.duplicate ? [] : [{ receipt_id: 'r-new' }]);
    if (/SELECT receipt_id, outcome, chit_id FROM connector_receipt/.test(text)) return answer([{ receipt_id: 'r-first', outcome: 'processed', chit_id: 'c-first' }]);
    if (/FROM connector_receipt WHERE actor_id/.test(text)) return answer(s.receipts);
    if (/SELECT COUNT\(\*\)::int AS n FROM connector_connection/.test(text)) return answer([{ n: s.connections.length }]);
    if (/SELECT bridge_id, ref, conn_config FROM connector_connection/.test(text)) return answer(s.connections);
    if (/SELECT \* FROM connector_connection WHERE actor_id = \$1 AND bridge_id = \$2/.test(text)) return answer(s.connMissing ? [] : [s.conn || CONNECTION_ROW]);
    if (/SELECT \* FROM connector_connection WHERE actor_id = \$1 AND entity_id/.test(text)) return answer(params[1] === s.owner ? s.connections : []);
    if (/INSERT INTO connector_connection/.test(text)) return answer([Object.assign({}, CONNECTION_ROW, { actor_id: params[0], direction: params[2], ref: params[3] })]);
    if (/UPDATE connector_connection SET enabled/.test(text)) return answer(params[3] === s.owner && params[2] === ACTOR && s.connections.length ? [Object.assign({}, CONNECTION_ROW, { enabled: params[0] })] : []);
    if (/SELECT folder_id FROM folder/.test(text)) return answer([{ folder_id: 'folder-1' }]);
    return null;
  };
}

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { OWNER, STAFF } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const world = (spec) => ({ sqlRows: stubRows(spec) });
  const at = (tail) => '/api/connectors' + tail;
  const owned = (tail) => at('/' + ACTOR + tail);
  const R = (method, tail) => method + ' ' + at(tail);
  const failing = (pattern, code, message) => ({ raise: [[pattern, code || '08006', message]] });
  /** a fixed clock and a fixed chance: the random parts of a success answer (a key, a bridge id, a sample document) are the same on every run */
  const fixed = { crypto: { randomBytes: (size) => Buffer.alloc(size, 7) }, math: { random: () => 0.25 }, date: { now: () => 1760000000000 } };
  const ingest = (more, key) => Object.assign({ key: key || GOOD_KEY, signal: 'temp', value: 4 }, more);
  const erpDoc = (more) => Object.assign({ key: GOOD_KEY, payload: { doc_type: 'invoice', doc_ref: 'INV-1', amount: 100 } }, more);
  const delivering = { mint: { deliver: async () => undefined } };
  const notDelivered = { mint: { deliver: async () => { throw new Error('chit_deliver failed -- relation "chit" does not exist'); } } };
  const boundary = { mint: { deliver: async () => { throw Object.assign(new Error('a test entity cannot trade with a production one'), { code: '23514' }); } } };
  const tooSlow = { mint: { deliver: async () => { throw pgError('57014', 'canceling statement due to statement timeout') ; } } };
  const noMoney = { mint: { deliver: async () => { throw Object.assign(new Error('The shop has not said what money it uses.'), { refused: true, status: 409, code: 'NO_MONEY', title: 'No money' }); } } };

  /* ── POST /api/connectors ── */
  const create = [
    X('create-iot-push', R('POST', ''), 200, { body: { display_name: 'Cold room Pi', type: 'iot', site: 'Yard', config: { mode: 'push', host: 'pi.local' } }, setup: world({}), patch: fixed }),
    X('create-iot-pull', R('POST', ''), 200, { body: { display_name: 'Broker feed', type: 'iot', config: { mode: 'pull', endpoint: 'mqtt://broker' } }, setup: world({}), patch: fixed }),
    X('create-erp', R('POST', ''), 200, { body: { display_name: 'Tally Mayur', type: 'erp', config: { base_url: 'https://erp.example.com' } }, setup: world({}), patch: fixed }),
    X('create-name-too-short', R('POST', ''), 400, { body: { display_name: 'a', type: 'iot' }, setup: world({}) }),
    X('create-type-unknown', R('POST', ''), 400, { body: { display_name: 'Cold room Pi', type: 'plc' }, setup: world({}) }),
    X('create-config-not-an-object', R('POST', ''), 400, { body: { display_name: 'Cold room Pi', type: 'iot', config: 'x' }, setup: world({}) }),
    X('create-both-wrong', R('POST', ''), 400, { body: { display_name: '', type: 'plc', config: 5 }, setup: world({}) }),
    X('create-insert-fails', R('POST', ''), 500, { body: { display_name: 'Cold room Pi', type: 'iot' }, setup: world(failing(/INSERT INTO identities/)) }),
    X('create-body-is-a-list', R('POST', ''), 400, { body: [1, 2], setup: world({}) })
  ];

  /* ── POST /api/connectors/ingest (a device) ── */
  const dev = (id, expect, body, spec, more) => X(id, R('POST', '/ingest'), expect, Object.assign({ body, setup: world(spec || {}) }, more));
  const device = [
    dev('ingest-no-key', 401, {}),
    dev('ingest-bad-key', 401, { key: 'not-a-key' }),
    dev('ingest-key-inactive', 401, ingest({}, ASLEEP_KEY)),
    dev('ingest-capability-off', 403, ingest({}, OFF_KEY)),
    dev('ingest-signal-too-long', 400, ingest({ signal: 'x'.repeat(65) })),
    dev('ingest-unit-too-long', 400, ingest({ unit: 'x'.repeat(17) })),
    dev('ingest-body-is-a-list', 401, [1, 2]),
    dev('ingest-unknown-device', 404, ingest({ bridge_id: 'CBNOPE', heartbeat_only: true }), { connMissing: true }),
    dev('ingest-device-disabled', 409, ingest({ bridge_id: BRIDGE, heartbeat_only: true }), { conn: Object.assign({}, CONNECTION_ROW, { enabled: false }) }),
    dev('ingest-to-a-stranger', 403, ingest({ to: FOREIGN_PARTY })),
    dev('ingest-to-not-an-id', 403, ingest({ to: 'abc' })),
    dev('ingest-heartbeat-only', 200, ingest({ heartbeat_only: true })),
    dev('ingest-heartbeat-for-a-device', 200, ingest({ bridge_id: BRIDGE, heartbeat_only: true })),
    dev('ingest-chit-raised', 200, ingest({ to: PARTY, signal: 'temperature', value: 4.5, unit: 'C' }), {}, { patch: delivering }),
    dev('ingest-chit-to-the-shop', 200, ingest({ folder: 'Cold chain', sub_type: 'door' }), {}, { patch: delivering }),
    dev('ingest-folder-not-filed', 200, ingest({ folder: 'Cold chain' }), failing(/SELECT folder_id FROM folder/, '42P01', 'relation "folder" does not exist -- SELECT secret FROM vault'), { patch: delivering }),
    dev('ingest-proof-not-kept', 200, ingest({ proof: 'aGVsbG8=' }), {}, { patch: Object.assign({ storage: { putForParticipants: async () => { throw new Error('bucket secret-bucket refused the write'); } } }, delivering) }),
    dev('ingest-proof-kept', 200, ingest({ proof: 'aGVsbG8=' }), {}, { patch: Object.assign({ storage: { putForParticipants: async () => 'proof-1' } }, delivering) }),
    dev('ingest-chit-not-delivered', 503, ingest({}), {}, { patch: notDelivered }),
    dev('ingest-no-entity-for-the-chit', 503, ingest({}), { noEntity: true }),
    dev('ingest-population-boundary', 409, ingest({}), {}, { patch: boundary }),
    dev('ingest-statement-timeout', 503, ingest({}), {}, { patch: tooSlow }),
    dev('ingest-no-money-refusal', 409, ingest({}), {}, { patch: noMoney }),
    dev('ingest-heartbeat-fails', 500, ingest({}), failing(/UPDATE identities SET last_seen/))
  ];

  /* ── POST /api/connectors/erp-ingest (the ERP agent) ── */
  const erp = (id, expect, body, spec, more) => X(id, R('POST', '/erp-ingest'), expect, Object.assign({ body, setup: world(spec || {}) }, more));
  const agent = [
    erp('erp-ingest-no-key', 401, { payload: {} }),
    erp('erp-ingest-bad-key', 401, { key: 'not-a-key', payload: {} }),
    erp('erp-ingest-capability-off', 403, erpDoc({ key: OFF_KEY })),
    erp('erp-ingest-no-payload', 400, { key: GOOD_KEY, doc_ref: 'X' }),
    erp('erp-ingest-payload-not-an-object', 400, { key: GOOD_KEY, payload: 'text' }),
    erp('erp-ingest-doc-type-too-long', 400, erpDoc({ doc_type: 'x'.repeat(65) })),
    erp('erp-ingest-body-is-a-list', 400, [1, 2]),
    erp('erp-ingest-wrong-type', 409, erpDoc({ key: IOT_KEY })),
    erp('erp-ingest-to-a-stranger', 403, erpDoc({ to: FOREIGN_PARTY })),
    erp('erp-ingest-received', 200, erpDoc({ to: PARTY }), {}, { patch: delivering }),
    erp('erp-ingest-received-own-fields', 200, erpDoc({ doc_type: 'order', doc_ref: 'PO-7' }), {}, { patch: delivering }),
    erp('erp-ingest-duplicate', 200, erpDoc({}), { duplicate: true }, { patch: delivering }),
    erp('erp-ingest-outcome-chit-failed', 200, erpDoc({}), {}, { patch: notDelivered }),
    erp('erp-ingest-heartbeat-fails', 500, erpDoc({}), failing(/UPDATE identities SET last_seen/)),
    erp('erp-ingest-claim-fails', 500, erpDoc({}), failing(/INSERT INTO connector_receipt/))
  ];

  /* ── GET /api/connectors/:actorId/receipts · POST /api/connectors/:actorId/erp-test ── */
  const receipts = [
    X('receipts-listed', R('GET', '/:actorId/receipts'), 200, { url: owned('/receipts'), setup: world({ receipts: [{ receipt_id: 'r1', doc_type: 'invoice', doc_ref: 'INV-1', payload_hash: 'abc', outcome: 'processed', chit_id: 'c1', received_at: STAMP }] }) }),
    X('receipts-paged', R('GET', '/:actorId/receipts'), 200, { url: owned('/receipts?page=1&limit=1'), setup: world({}) }),
    X('receipts-not-an-erp-connector', R('GET', '/:actorId/receipts'), 404, { url: owned('/receipts'), setup: world({ actor: IOT_ACTOR }) }),
    X('receipts-read-fails', R('GET', '/:actorId/receipts'), 500, { url: owned('/receipts'), setup: world(failing(/FROM connector_receipt WHERE actor_id/)) })
  ];
  const erpTest = [
    X('erp-test-processed', R('POST', '/:actorId/erp-test'), 200, { url: owned('/erp-test'), setup: world({}), patch: Object.assign({}, fixed, delivering) }),
    X('erp-test-not-an-erp-connector', R('POST', '/:actorId/erp-test'), 404, { url: owned('/erp-test'), setup: world({ actor: IOT_ACTOR }) }),
    X('erp-test-heartbeat-fails', R('POST', '/:actorId/erp-test'), 500, { url: owned('/erp-test'), setup: world(failing(/UPDATE identities SET last_seen/)) })
  ];

  /* ── GET /api/connectors · GET provisioning ── */
  const reads = [
    X('list-listed', R('GET', ''), 200, { setup: world({}) }),
    X('list-paged', R('GET', ''), 200, { url: at('?page=1&limit=1'), setup: world({}) }),
    X('list-read-fails', R('GET', ''), 500, { setup: world(failing(/SELECT identity_id, display_name, connector_type, site, connector_config, last_seen, status/)) }),
    X('provisioning-iot', R('GET', '/:actorId/provisioning'), 200, { url: owned('/provisioning'), setup: world({ actor: IOT_ACTOR }) }),
    X('provisioning-iot-own-endpoint', R('GET', '/:actorId/provisioning'), 200, { url: owned('/provisioning'), setup: world({ actor: Object.assign({}, IOT_ACTOR, { connector_config: { mode: 'pull', endpoint: 'mqtt://broker' } }) }) }),
    X('provisioning-erp', R('GET', '/:actorId/provisioning'), 200, { url: owned('/provisioning'), setup: world({}) }),
    X('provisioning-read-fails', R('GET', '/:actorId/provisioning'), 500, { url: owned('/provisioning'), setup: world(failing(/SELECT bridge_id, ref, conn_config/)) })
  ];

  /* ── POST reissue-code · POST regenerate-key ── */
  const asManager = { who: Object.assign({}, STAFF, { access_level: 'editor' }) };
  const reissue = [
    X('reissue-code-sent', R('POST', '/reissue-code'), 200, { setup: world({}) }),
    X('reissue-code-by-a-manager', R('POST', '/reissue-code'), 200, { setup: Object.assign({}, world({ hat: 'manager' }), asManager) }),
    X('reissue-code-not-allowed', R('POST', '/reissue-code'), 403, { setup: Object.assign({}, world({ hat: 'act' }), asManager) }),
    X('reissue-code-no-email', R('POST', '/reissue-code'), 400, { setup: world({ email: null }) }),
    X('reissue-code-send-fails', R('POST', '/reissue-code'), 500, { setup: world(failing(/UPDATE identities SET otp_code/)) })
  ];
  const ASK = { name: 'Tally Mayur', otp: '482910' };
  const regen = (id, expect, body, spec, more) => X(id, R('POST', '/:actorId/regenerate-key'), expect, Object.assign({ url: owned('/regenerate-key'), body, setup: world(spec || {}) }, more));
  const regenerate = [
    regen('regenerate-key-issued', 200, ASK, {}, { patch: fixed }),
    regen('regenerate-key-name-in-other-case', 200, { name: 'tally mayur', otp: '482910' }, {}, { patch: fixed }),
    regen('regenerate-key-unknown-connector', 404, ASK, { owner: 'nobody' }),
    regen('regenerate-key-no-name', 400, { otp: '482910' }),
    regen('regenerate-key-body-is-a-list', 400, [1, 2]),
    regen('regenerate-key-code-too-short', 400, { name: 'Tally Mayur', otp: '123' }),
    regen('regenerate-key-not-allowed', 403, ASK, { hat: 'act' }, { setup: Object.assign({}, world({ hat: 'act' }), asManager) }),
    regen('regenerate-key-name-mismatch', 400, { name: 'Other', otp: '482910' }),
    regen('regenerate-key-wrong-code', 400, { name: 'Tally Mayur', otp: '654321' }),
    regen('regenerate-key-code-locked', 400, ASK, { otpRow: { identity_id: SHOP, otp_code: '482910', otp_expires_at: new Date('2099-01-01T00:00:00Z'), otp_attempts: 9 } }),
    regen('regenerate-key-code-expired', 400, ASK, { otpRow: { identity_id: SHOP, otp_code: '482910', otp_expires_at: new Date('2000-01-01T00:00:00Z'), otp_attempts: 0 } }),
    regen('regenerate-key-update-fails', 500, ASK, failing(/UPDATE identities SET provision_key_hash/))
  ];

  /* ── ping · connections ── */
  const ping = [
    X('ping-pong', R('POST', '/:actorId/ping'), 200, { url: owned('/ping'), setup: world({}) }),
    X('ping-a-device', R('POST', '/:actorId/ping'), 200, { url: owned('/ping'), body: { bridge_id: BRIDGE }, setup: world({}) }),
    X('ping-write-fails', R('POST', '/:actorId/ping'), 500, { url: owned('/ping'), setup: world(failing(/UPDATE identities SET last_seen/)) })
  ];
  const conn = (id, expect, body, spec) => X(id, R('POST', '/:actorId/connections'), expect, { url: owned('/connections'), body, setup: world(spec || {}) });
  const connections = [
    conn('connection-added', 200, { ref: 'sensor-2', direction: 'out', schema_ref: 'temp', retention: 'persist_then_purge', counterparty_entity_id: PARTY, config: { topic: 'cold/2' } }),
    conn('connection-added-minimal', 200, { ref: 'sensor-3' }),
    conn('connection-unknown-connector', 404, { ref: 'x' }, { owner: 'nobody' }),
    conn('connection-no-ref', 400, {}),
    conn('connection-bad-direction', 400, { ref: 'x', direction: 'sideways' }),
    conn('connection-bad-retention', 400, { ref: 'x', retention: 'forever' }),
    conn('connection-counterparty-not-an-id', 400, { ref: 'x', counterparty_entity_id: 'abc' }),
    conn('connection-config-not-an-object', 400, { ref: 'x', config: 'abc' }),
    conn('connection-insert-fails', 500, { ref: 'x' }, failing(/INSERT INTO connector_connection/)),
    X('connection-body-is-a-list', R('POST', '/:actorId/connections'), 400, { url: owned('/connections'), body: [1, 2], setup: world({}) }),
    X('connections-listed', R('GET', '/:actorId/connections'), 200, { url: owned('/connections'), setup: world({}) }),
    X('connections-listed-asleep', R('GET', '/:actorId/connections'), 200, { url: owned('/connections'), setup: world({ actor: Object.assign({}, ERP_ACTOR, { last_seen: null }) }) }),
    X('connections-paged', R('GET', '/:actorId/connections'), 200, { url: owned('/connections?page=1&limit=1'), setup: world({}) }),
    X('connections-read-fails', R('GET', '/:actorId/connections'), 500, { url: owned('/connections'), setup: world(failing(/SELECT \* FROM connector_connection WHERE actor_id = \$1 AND entity_id/)) }),
    X('connection-switched', R('PATCH', '/:actorId/connections/:connId'), 200, { url: owned('/connections/' + CONNECTION), body: { enabled: false }, setup: world({}) }),
    X('connection-switch-unknown', R('PATCH', '/:actorId/connections/:connId'), 404, { url: owned('/connections/99'), body: { enabled: true }, setup: world({ connections: [] }) }),
    X('connection-switch-not-a-boolean', R('PATCH', '/:actorId/connections/:connId'), 400, { url: owned('/connections/' + CONNECTION), body: { enabled: 'maybe' }, setup: world({}) }),
    X('connection-switch-not-a-number', R('PATCH', '/:actorId/connections/:connId'), 400, { url: owned('/connections/abc'), body: { enabled: true }, setup: world({}) }),
    X('connection-switch-fails', R('PATCH', '/:actorId/connections/:connId'), 500, { url: owned('/connections/' + CONNECTION), body: { enabled: true }, setup: world(failing(/UPDATE connector_connection SET enabled/)) }),
    X('connection-switch-body-is-a-list', R('PATCH', '/:actorId/connections/:connId'), 400, { url: owned('/connections/' + CONNECTION), body: [true], setup: world({}) })
  ];

  /* ── DELETE /api/connectors/:actorId ── */
  const retire = [
    X('delete-retired', R('DELETE', '/:actorId'), 200, { url: owned(''), setup: world({ connections: [] }) }),
    X('delete-has-devices', R('DELETE', '/:actorId'), 409, { url: owned(''), setup: world({}) }),
    X('delete-has-one-device', R('DELETE', '/:actorId'), 409, { url: owned(''), setup: world({ connections: [CONNECTION_ROW] }) }),
    X('delete-has-records', R('DELETE', '/:actorId'), 409, { url: owned(''), setup: world({ connections: [], raise: [[/DELETE FROM identities/, '23503']] }) }),
    X('delete-fails', R('DELETE', '/:actorId'), 500, { url: owned(''), setup: world({ connections: [], raise: [[/DELETE FROM identities/, '08006']] }) })
  ];

  /* ── the gate and the errors it cannot reach ── */
  const gate = [
    X('gate-capability-switched-off', R('GET', ''), 403, { setup: world({ caps: [] }) }),
    X('gate-no-capabilities-at-all', R('GET', ''), 403, { setup: world({ caps: null }) })
  ];
  return [].concat(create, device, agent, receipts, erpTest, reads, reissue, regenerate, ping, connections, retire, gate);
}

module.exports = { extras, stubRows, SHOP, ACTOR, PARTY, STRANGER_ID, FOREIGN_PARTY, CONNECTION, BRIDGE, GOOD_KEY, ERP_ACTOR, IOT_ACTOR, CONNECTION_ROW, STAMP };
