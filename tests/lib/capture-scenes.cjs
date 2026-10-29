/**
 * capture-scenes.cjs — the named scenarios of tests/api-problem-capture.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte,
 * a signed delivery to a webhook).
 *
 * OWNS      the stand-in database of the capture routes (stubRows: a statement answered by its shape, so the same facts meet the old and the new code), the ids and secrets it knows,
 *           the signed bodies the two provider webhooks are sent, and the extras: one scenario per answer of the 12 routes of routes/capture.js (/api/capture).
 * CALLED BY tests/api-problem-capture.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who }, body, url, raw, env, patch, after }] → the harness runs each one against the real route
 * CARD      11-crm-and-marketing/capture
 * The webhooks are an OUTSIDE CONTRACT (Meta, the e-mail provider): a scenario with `raw` sends the bytes the provider signed (not JSON), and `env` sets the secrets for that scenario (null removes one).
 * `calls` records what the stood-in side effects were asked (auto-raise, the STOP confirmation), for the test to read after the run.
 */
'use strict';
const crypto = require('crypto');

const SHOP = '11111111-1111-4111-8111-111111111111';
const CAP = '22222222-2222-4222-8222-222222222222';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const CHIT = '88888888-8888-4888-8888-888888888888';
const STAMP = '2026-10-01T10:00:00.000Z';
const SECRETS = { WHATSAPP_APP_SECRET: 'wa-secret-test', EMAIL_INBOUND_SECRET: 'mail-secret-test', WHATSAPP_VERIFY_TOKEN: 'verify-me' };
const OUR_LINE = '+919999999999';

const answer = (rows) => ({ rows, rowCount: rows.length });
/** an error the way pg raises one: its text is the database's, which no answer may carry (a body scan finds it) */
const SECRET_TEXT = 'relation "secret_table" does not exist -- SELECT secret FROM vault';
const pgError = (code, message) => Object.assign(new Error(message || SECRET_TEXT), { code });
const STRUCTURED = { subject: 'Weekly order', line_items: [{ particulars: 'Tomato', quantity: 5, unit: 'kg', raw_phrase: '5 kg tomato' }], delivery_at: 'sunday' };
const CAPTURE_ROW = { id: CAP, entity_id: SHOP, channel: 'whatsapp', sender_ref: '919840012345', sender_name: 'Anna', subject: null, raw_text: '5 kg tomato', media_refs: [], status: 'pending', structured: null, chit_id: null, to_ref: OUR_LINE, provider_msg_id: 'wamid.1', created_at: STAMP };
const STORE_ROW = { store_id: 's1', phone_key: '9840012345', display_name: 'Chola Stores', address: 'Anna Nagar', provisional: false, created_at: STAMP };

/**
 * stubRows(spec) → the harness's sqlRows: the rows a statement gets, by its shape. spec: { owner, capture, pending, stores, dup, binding, autoRaise, unbound, raise: [[pattern, code, message?]] }.
 * A capture is answered only to its owning shop (spec.owner, SHOP unless the scene is asking as a stranger), as RLS and `WHERE entity_id = $2` would.
 */
function stubRows(spec) {
  const s = Object.assign({ owner: SHOP, capture: CAPTURE_ROW, pending: [CAPTURE_ROW], stores: [STORE_ROW], dup: null, autoRaise: false, unbound: false, raise: [] }, spec);
  const mine = (id, entity) => id === CAP && entity === s.owner && !!s.capture;
  return (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    const hit = s.raise.find(([pattern]) => pattern.test(text));
    if (hit) throw pgError(hit[1], hit[2]);
    if (/FROM capture WHERE entity_id = \$1 AND channel = \$2 AND provider_msg_id/.test(text)) return answer(s.dup ? [s.dup] : []);
    if (/SELECT \* FROM capture WHERE id = \$1 AND entity_id = \$2/.test(text)) return answer(mine(params[0], params[1]) ? [s.capture] : []);
    if (/INSERT INTO capture/.test(text)) return answer([{ id: CAP, channel: params[1], sender_ref: params[2], sender_name: params[3], subject: params[4], raw_text: params[5], status: 'pending', created_at: STAMP }]);
    if (/FROM capture WHERE entity_id = \$1 AND status = 'pending'/.test(text)) return answer(params[0] === s.owner ? s.pending : []);
    if (/UPDATE capture SET status = 'converted'/.test(text)) return answer(mine(params[1], params[2]) && s.capture.status === 'pending' ? [{ id: CAP, status: 'converted', chit_id: params[0] }] : []);
    if (/UPDATE capture SET status = 'dismissed'/.test(text)) return answer(mine(params[0], params[1]) && s.capture.status === 'pending' ? [{ id: CAP, status: 'dismissed' }] : []);
    if (/UPDATE capture SET structured/.test(text)) return answer([]);
    if (/FROM wholesaler_store WHERE owner_entity_id = \$1 ORDER BY/.test(text)) return answer(params[0] === s.owner ? s.stores : []);
    if (/INSERT INTO wholesaler_store/.test(text)) return answer([{ store_id: 's1', phone_key: params[1], display_name: params[2], address: params[3], provisional: false }]);
    if (/channel_owner_binding/.test(text)) return answer(s.unbound ? [] : [{ entity_id: SHOP, auto_raise: s.autoRaise }]);
    if (/SELECT channel_owner\(/.test(text)) return answer([{ entity_id: s.unbound ? null : SHOP }]);
    return null;
  };
}

const sign = (secret, text, prefix) => (prefix || '') + crypto.createHmac('sha256', secret).update(text).digest('hex');
const whatsappMessage = (id, text, more) => Object.assign({ id, from: '919840012345', type: 'text', text: { body: text } }, more);
/** the body Meta posts: our number in metadata, their number on each message */
const whatsappBody = (messages, line) =>
  JSON.stringify({ entry: [{ changes: [{ value: { metadata: { display_phone_number: line || OUR_LINE }, contacts: [{ wa_id: '919840012345', profile: { name: 'Anna' } }], messages } }] }] });
/** a raw POST as Meta sends it: octet bytes, the signature in x-hub-signature-256 */
const metaPost = (text, signature) => ({ headers: { 'content-type': 'application/octet-stream', 'x-hub-signature-256': signature === undefined ? sign(SECRETS.WHATSAPP_APP_SECRET, text, 'sha256=') : signature }, text });
const mailPost = (text, signature, headerName) => ({ headers: { 'content-type': 'application/octet-stream', [headerName || 'x-mailgun-signature-256']: signature === undefined ? sign(SECRETS.EMAIL_INBOUND_SECRET, text) : signature }, text });
const mailBody = (more) => JSON.stringify(Object.assign({ to: 'Orders <orders@shop.example>', from: 'Anna <anna@example.com>', subject: 'Order', text: '5 kg tomato' }, more));

/** what the stood-in side effects were asked, in order (read by the test after the run) */
const calls = [];

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { OWNER, STAFF } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const world = (spec) => ({ sqlRows: stubRows(spec) });
  const at = (tail) => '/api/capture' + tail;
  const R = (method, tail) => method + ' ' + at(tail);
  const failing = (pattern, code, message) => ({ raise: [[pattern, code || '08006', message]] });
  const withStructured = (more) => ({ capture: Object.assign({}, CAPTURE_ROW, { structured: STRUCTURED }, more) });
  const reader = (reply) => ({ ai: { invokeSkill: async () => reply } });
  const readerFails = (status, message) => ({ ai: { invokeSkill: async () => { throw Object.assign(new Error(message), { status }); } } });
  const sideEffects = { optout: { fromReply: async () => ({ stop: false }), confirmReply: async () => { calls.push('confirmReply'); } }, autoraise: { run: async (entity, id) => { calls.push('autoraise:' + id); } } };
  const stopping = { optout: { fromReply: async () => ({ stop: true, parties: 1, withdrawn: 1, country: 'IN', shop_name: 'Test shop' }), confirmReply: async () => { calls.push('confirmReply'); } }, autoraise: sideEffects.autoraise };
  const stopFailed = { optout: { fromReply: async () => ({ stop: true, failed: true }), confirmReply: async () => { calls.push('confirmReply'); } }, autoraise: sideEffects.autoraise };
  const cards = [
    { store_id: 's1', store_name: 'Chola Stores', store_provisional: false, chit_id: 'c1', fulfil_date: '2026-10-25', stated_when: 'sunday', deliver_to: null, address_overridden: false, lines: [{ particulars: 'Tomato', comment: '', qty: 5, unit: 'kg' }] },
    { store_id: 's2', store_name: 'Anna Nagar Mart', store_provisional: true, chit_id: 'c2', fulfil_date: null, stated_when: null, deliver_to: null, address_overridden: false, lines: [{ particulars: 'Onion', comment: '', qty: 2, unit: 'kg' }] }
  ];
  const catalogue = { items: [], variantsOf: {} };
  const reading = (list) => ({ capture: { consolidationInput: async () => list }, consolidate: { loadCatalogue: async () => catalogue } });
  const readingFails = { capture: { consolidationInput: async () => { throw new Error(SECRET_TEXT); } }, consolidate: { loadCatalogue: async () => catalogue } };

  /* ── POST /api/capture/simulate ── */
  const simulate = [
    X('sim-ok', R('POST', '/simulate'), 200, { body: { sender_ref: '919840012345', sender_name: 'Anna', subject: 'Order', raw_text: '5 kg tomato', media_refs: [] }, setup: world({}) }),
    X('sim-channel-is-always-web', R('POST', '/simulate'), 200, { body: { channel: 'whatsapp', sender_ref: '919840012345', raw_text: 'hello' }, setup: world({}) }),
    X('sim-no-text', R('POST', '/simulate'), 400, { body: { sender_ref: '919840012345' }, setup: world({}) }),
    X('sim-text-is-blank', R('POST', '/simulate'), 400, { body: { raw_text: '   ' }, setup: world({}) }),
    X('sim-not-migrated', R('POST', '/simulate'), 503, { body: { raw_text: 'hello' }, setup: world(failing(/INSERT INTO capture/, '42P01')) }),
    X('sim-insert-fails', R('POST', '/simulate'), 500, { body: { raw_text: 'hello' }, setup: world(failing(/INSERT INTO capture/)) }),
    X('sim-body-is-a-list', R('POST', '/simulate'), 400, { body: [1, 2], setup: world({}), after: true })
  ];

  /* ── GET /api/capture/pending ── */
  const pending = [
    X('pending-ok', R('GET', '/pending'), 200, { setup: world({}) }),
    X('pending-empty', R('GET', '/pending'), 200, { setup: world({ pending: [] }) }),
    X('pending-not-migrated', R('GET', '/pending'), 200, { setup: world(failing(/FROM capture WHERE entity_id = \$1 AND status = 'pending'/, '42P01')) }),
    X('pending-read-fails', R('GET', '/pending'), 500, { setup: world(failing(/FROM capture WHERE entity_id = \$1 AND status = 'pending'/)) })
  ];

  /* ── POST /api/capture/:id/structure ── */
  const structure = [
    X('structure-ok', R('POST', '/:id/structure'), 200, { url: at('/' + CAP + '/structure'), setup: world({}), patch: reader({ data: STRUCTURED, note: 'read by the co-assist', usage: { input_tokens: 10, output_tokens: 20 } }) }),
    X('structure-unknown', R('POST', '/:id/structure'), 404, { url: at('/' + CAP + '/structure'), setup: world({ capture: null }) }),
    X('structure-nothing-usable', R('POST', '/:id/structure'), 422, { url: at('/' + CAP + '/structure'), setup: world({}), patch: reader({ data: null }) }),
    X('structure-budget-used', R('POST', '/:id/structure'), 402, { url: at('/' + CAP + '/structure'), setup: world({}), patch: readerFails(402, 'AI budget used ($0.50). Add wallet credits to continue.') }),
    X('structure-rate-limit', R('POST', '/:id/structure'), 429, { url: at('/' + CAP + '/structure'), setup: world({}), patch: readerFails(429, 'AI rate limit reached (30/hour) — try again shortly.') }),
    X('structure-cut-off', R('POST', '/:id/structure'), 422, { url: at('/' + CAP + '/structure'), setup: world({}), patch: readerFails(422, 'The message was too long for one reading — the reply hit the 2000-token limit and was cut off. Nothing was saved. Send it in two shorter messages, or raise AI_MAX_TOKENS.') }),
    X('structure-provider-text', R('POST', '/:id/structure'), 502, { url: at('/' + CAP + '/structure'), setup: world({}), patch: readerFails(502, 'AI HTTP 500: {"error":"provider says: SELECT secret FROM vault"}') }),
    X('structure-not-connected', R('POST', '/:id/structure'), 503, { url: at('/' + CAP + '/structure'), setup: world({}), patch: readerFails(503, 'AI not connected — set ANTHROPIC_API_KEY.') }),
    X('structure-save-fails', R('POST', '/:id/structure'), 500, { url: at('/' + CAP + '/structure'), setup: world(failing(/UPDATE capture SET structured/)), patch: reader({ data: STRUCTURED }) }),
    X('structure-read-fails', R('POST', '/:id/structure'), 500, { url: at('/' + CAP + '/structure'), setup: world(failing(/SELECT \* FROM capture WHERE id/)) }),
    X('structure-body-is-a-list', R('POST', '/:id/structure'), 400, { url: at('/' + CAP + '/structure'), body: [1], setup: world({}), after: true })
  ];

  /* ── POST /api/capture/:id/raise ── */
  const raise = [
    X('raise-ok', R('POST', '/:id/raise'), 200, { url: at('/' + CAP + '/raise'), setup: world(withStructured()) }),
    X('raise-without-catalogue', R('POST', '/:id/raise'), 200, { url: at('/' + CAP + '/raise'), body: { use_catalogue: false }, setup: world(withStructured()) }),
    X('raise-not-read-yet', R('POST', '/:id/raise'), 409, { url: at('/' + CAP + '/raise'), setup: world({}) }),
    X('raise-already-handled', R('POST', '/:id/raise'), 409, { url: at('/' + CAP + '/raise'), setup: world(withStructured({ status: 'converted' })) }),
    X('raise-nothing-read', R('POST', '/:id/raise'), 409, { url: at('/' + CAP + '/raise'), setup: world({ capture: Object.assign({}, CAPTURE_ROW, { structured: { line_items: [] } }) }) }),
    X('raise-unknown', R('POST', '/:id/raise'), 404, { url: at('/' + CAP + '/raise'), setup: world({ capture: null }) }),
    X('raise-read-fails', R('POST', '/:id/raise'), 500, { url: at('/' + CAP + '/raise'), setup: world(failing(/SELECT \* FROM capture WHERE id/)) }),
    X('raise-body-is-a-list', R('POST', '/:id/raise'), 400, { url: at('/' + CAP + '/raise'), body: [1], setup: world(withStructured()), after: true })
  ];

  /* ── POST /api/capture/:id/convert and /dismiss ── */
  const handled = [
    X('convert-ok', R('POST', '/:id/convert'), 200, { url: at('/' + CAP + '/convert'), body: { chit_id: CHIT }, setup: world({}) }),
    X('convert-without-chit', R('POST', '/:id/convert'), 200, { url: at('/' + CAP + '/convert'), setup: world({}) }),
    X('convert-unknown', R('POST', '/:id/convert'), 404, { url: at('/' + CAP + '/convert'), body: { chit_id: CHIT }, setup: world({ capture: null }) }),
    X('convert-already-handled', R('POST', '/:id/convert'), 404, { url: at('/' + CAP + '/convert'), body: { chit_id: CHIT }, setup: world({ capture: Object.assign({}, CAPTURE_ROW, { status: 'converted' }) }) }),
    X('convert-fails', R('POST', '/:id/convert'), 500, { url: at('/' + CAP + '/convert'), body: { chit_id: CHIT }, setup: world(failing(/UPDATE capture SET status = 'converted'/)) }),
    X('convert-body-is-a-list', R('POST', '/:id/convert'), 400, { url: at('/' + CAP + '/convert'), body: [1], setup: world({}), after: true }),
    X('dismiss-ok', R('POST', '/:id/dismiss'), 200, { url: at('/' + CAP + '/dismiss'), setup: world({}) }),
    X('dismiss-unknown', R('POST', '/:id/dismiss'), 404, { url: at('/' + CAP + '/dismiss'), setup: world({ capture: null }) }),
    X('dismiss-already-handled', R('POST', '/:id/dismiss'), 404, { url: at('/' + CAP + '/dismiss'), setup: world({ capture: Object.assign({}, CAPTURE_ROW, { status: 'dismissed' }) }) }),
    X('dismiss-fails', R('POST', '/:id/dismiss'), 500, { url: at('/' + CAP + '/dismiss'), setup: world(failing(/UPDATE capture SET status = 'dismissed'/)) }),
    X('dismiss-body-is-a-list', R('POST', '/:id/dismiss'), 400, { url: at('/' + CAP + '/dismiss'), body: [1], setup: world({}), after: true })
  ];

  /* ── GET /api/capture/consolidate ── */
  const consolidation = [
    X('consolidate-ok', R('GET', '/consolidate'), 200, { setup: world({}), patch: reading(cards) }),
    X('consolidate-one-date', R('GET', '/consolidate'), 200, { url: at('/consolidate?date=2026-10-25'), setup: world({}), patch: reading(cards) }),
    X('consolidate-nothing', R('GET', '/consolidate'), 200, { setup: world({}), patch: reading([]) }),
    X('consolidate-fails', R('GET', '/consolidate'), 500, { setup: world({}), patch: readingFails }),
    X('consolidate-date-twice', R('GET', '/consolidate'), 400, { url: at('/consolidate?date=2026-10-25&date=2026-10-26'), setup: world({}), patch: reading(cards), after: true })
  ];

  /* ── GET and POST /api/capture/stores ── */
  const stores = [
    X('stores-ok', R('GET', '/stores'), 200, { setup: world({}) }),
    X('stores-not-migrated', R('GET', '/stores'), 200, { setup: world(failing(/FROM wholesaler_store WHERE owner_entity_id/, '42P01')) }),
    X('stores-read-fails', R('GET', '/stores'), 500, { setup: world(failing(/FROM wholesaler_store WHERE owner_entity_id/)) }),
    X('stores-save-ok', R('POST', '/stores'), 200, { body: { phone: '+91 98400 12345', display_name: 'Chola Stores', address: 'Anna Nagar', notes: 'gate 2' }, setup: world({}) }),
    X('stores-save-no-phone', R('POST', '/stores'), 400, { body: { display_name: 'Chola Stores' }, setup: world({}) }),
    X('stores-save-not-migrated', R('POST', '/stores'), 503, { body: { phone: '9840012345' }, setup: world(failing(/INSERT INTO wholesaler_store/, '42703')) }),
    X('stores-save-fails', R('POST', '/stores'), 500, { body: { phone: '9840012345' }, setup: world(failing(/INSERT INTO wholesaler_store/)) }),
    X('stores-save-body-is-a-list', R('POST', '/stores'), 400, { body: [1], setup: world({}), after: true })
  ];

  /* ── GET /api/capture/webhook/whatsapp (Meta's verify handshake: an outside contract) ── */
  const verify = (id, expect, query, env) => X(id, R('GET', '/webhook/whatsapp'), expect, { url: at('/webhook/whatsapp' + query), setup: world({}), env });
  const handshake = [
    verify('verify-ok', 200, '?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444'),
    verify('verify-wrong-token', 403, '?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1158201444'),
    verify('verify-wrong-mode', 403, '?hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=1158201444'),
    verify('verify-nothing-sent', 403, ''),
    verify('verify-not-configured', 403, '?hub.mode=subscribe&hub.verify_token=undefined&hub.challenge=1158201444', { WHATSAPP_VERIFY_TOKEN: null })
  ];

  /* ── POST /api/capture/webhook/whatsapp (signed by Meta: HMAC over the raw bytes; always 200 once signed) ── */
  const wa = (id, expect, text, more) => X(id, R('POST', '/webhook/whatsapp'), expect, Object.assign({ raw: metaPost(text), setup: world({}), patch: sideEffects }, more));
  const oneMessage = whatsappBody([whatsappMessage('wamid.A', '5 kg tomato')]);
  const whatsapp = [
    wa('wa-not-configured', 200, oneMessage, { env: { WHATSAPP_APP_SECRET: null } }),
    wa('wa-unsigned', 401, oneMessage, { raw: { headers: { 'content-type': 'application/octet-stream' }, text: oneMessage } }),
    wa('wa-wrong-signature', 401, oneMessage, { raw: metaPost(oneMessage, 'sha256=' + '0'.repeat(64)) }),
    wa('wa-signature-not-hex', 401, oneMessage, { raw: metaPost(oneMessage, 'sha256=zz') }),
    wa('wa-signature-of-another-body', 401, oneMessage, { raw: metaPost(oneMessage, sign(SECRETS.WHATSAPP_APP_SECRET, oneMessage + ' ', 'sha256=')) }),
    wa('wa-message-captured', 200, oneMessage),
    wa('wa-message-captured-and-raised', 200, oneMessage, { setup: world({ autoRaise: true }) }),
    wa('wa-redelivery', 200, oneMessage, { setup: world({ autoRaise: true, dup: CAPTURE_ROW }) }),
    wa('wa-status-receipt', 200, whatsappBody([{ id: 'wamid.S', from: '919840012345', type: 'reaction' }])),
    wa('wa-two-messages', 200, whatsappBody([whatsappMessage('wamid.B', 'hello'), whatsappMessage('wamid.C', 'again', { type: 'text' })])),
    wa('wa-photo-without-text', 200, whatsappBody([{ id: 'wamid.P', from: '919840012345', type: 'image', image: { id: 'media-1' } }])),
    wa('wa-not-our-number', 200, oneMessage, { setup: world({ unbound: true }) }),
    wa('wa-stop-reply', 200, whatsappBody([whatsappMessage('wamid.STOP', 'STOP')]), { patch: stopping }),
    wa('wa-stop-reply-not-recorded', 200, whatsappBody([whatsappMessage('wamid.STOP2', 'STOP')]), { patch: stopFailed }),
    wa('wa-body-is-not-json', 200, '{ not json'),
    wa('wa-capture-fails', 200, oneMessage, { setup: world(failing(/INSERT INTO capture/)) }),
    wa('wa-nothing-in-it', 200, '{}')
  ];

  /* ── POST /api/capture/webhook/email (signed by the provider; always 200 once signed) ── */
  const mail = (id, expect, text, more) => X(id, R('POST', '/webhook/email'), expect, Object.assign({ raw: mailPost(text), setup: world({}) }, more));
  const email = [
    mail('email-not-configured', 200, mailBody(), { env: { EMAIL_INBOUND_SECRET: null } }),
    mail('email-unsigned', 401, mailBody(), { raw: { headers: { 'content-type': 'application/octet-stream' }, text: mailBody() } }),
    mail('email-wrong-signature', 401, mailBody(), { raw: mailPost(mailBody(), '0'.repeat(64)) }),
    mail('email-signature-in-the-other-header', 200, mailBody(), { raw: mailPost(mailBody(), undefined, 'x-inbound-signature') }),
    mail('email-captured', 200, mailBody()),
    mail('email-form-fields', 200, 'to=orders%40shop.example&from=anna%40example.com&subject=Order&body-plain=5%20kg%20tomato', { raw: mailPost('to=orders%40shop.example&from=anna%40example.com&subject=Order&body-plain=5%20kg%20tomato') }),
    mail('email-no-binding', 200, mailBody(), { setup: world({ unbound: true }) }),
    mail('email-no-text', 200, mailBody({ text: '   ' })),
    mail('email-capture-fails', 200, mailBody(), { setup: world(failing(/INSERT INTO capture/)) })
  ];

  /* ── who is asking: a staff member reads the same inbox as the owner ── */
  const staff = [X('pending-staff', R('GET', '/pending'), 200, { setup: Object.assign({ who: STAFF }, world({})) }), X('sim-staff', R('POST', '/simulate'), 200, { body: { raw_text: 'hello' }, setup: Object.assign({ who: STAFF }, world({})) })];
  void OWNER;
  return [].concat(simulate, pending, structure, raise, handled, consolidation, stores, handshake, whatsapp, email, staff);
}

module.exports = { SHOP, CAP, CHIT, STRANGER_ID, SECRETS, CAPTURE_ROW, STRUCTURED, SECRET_TEXT, stubRows, extras, calls, whatsappBody, whatsappMessage, metaPost, mailPost, mailBody };
