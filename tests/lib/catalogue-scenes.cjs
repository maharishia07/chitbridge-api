/**
 * catalogue-scenes.cjs — the named scenarios of tests/api-problem-catalogue.test.cjs: the shopper's orders and documents, the product enquiries, the photo read and the catalogue face.
 *
 * OWNS      the extras: one scenario per refusal and per success of the nine routes, each with the stand-in rows it needs.
 * CALLED BY tests/api-problem-catalogue.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, body, url }] → the harness runs each one against the real route
 * CARD      qa/offline-guards
 */
'use strict';

const C = '/api/catalogue';
const F = '/api/catalogue-face';
const SHOP = '11111111-1111-4111-8111-111111111111';
const boom = async () => {
  throw new Error('x');
};
/** an error the way the skill raises a refusal: a status and a sentence */
const refusal = (status, message) => async () => {
  throw Object.assign(new Error(message), { status });
};
const BIG_FACE = { notes: 'a'.repeat(1000001) };

function extras(tools) {
  const { PARTY, STAFF, answering, raising, firstOf } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const withRows = (answer) => ({ sqlRows: answer });
  const failing = { db: 'fail' };
  const owned = answering(/SELECT entity_id FROM catalogue_items/, [{ entity_id: SHOP }]);
  /** the enquiry insert answers with the text it was given, so the trimmed text shows in the answer */
  const delivered = (sql, params) => (/enquiry_message_deliver/.test(sql) ? { rows: [{ created_at: params[5] }], rowCount: 1 } : null);
  const orderRows = answering(/FROM chit_header ch/, [{ chit_id: PARTY, auto_subject: 'Tea', current_status: 'delivered', _total: '3' }]);
  const photo = (invoke) => ({ ai: { invokeSkill: invoke } });
  const identity = (key) => answering(/SELECT sf.field_key/, [{ field_key: key }]);
  return [
    /* GET /enquiry */
    X('enquiries-listed', 'GET ' + C + '/enquiry', 200, { url: C + '/enquiry?side=in&page=1&limit=5', setup: withRows(answering(/WITH m AS/, [{ total: 1, rows: [{ item_id: PARTY }] }])) }),
    X('enquiries-none', 'GET ' + C + '/enquiry', 200, {}),
    X('enquiries-before-b161', 'GET ' + C + '/enquiry', 200, { setup: withRows(raising(/WITH m AS/, '42703')) }),
    X('enquiries-db-fails', 'GET ' + C + '/enquiry', 500, { setup: failing }),
    /* GET /enquiry/:item_id */
    X('thread-read', 'GET ' + C + '/enquiry/:item_id', 200, { setup: withRows(answering(/FROM chit_messages/, [{ message_text: 'hello' }])) }),
    X('thread-before-b162', 'GET ' + C + '/enquiry/:item_id', 200, { setup: withRows(raising(/FROM chit_messages/, '42883')) }),
    X('thread-db-fails', 'GET ' + C + '/enquiry/:item_id', 500, { setup: failing }),
    /* POST /enquiry/:item_id */
    X('enquiry-text-blank', 'POST ' + C + '/enquiry/:item_id', 400, { body: { message_text: '   ' } }),
    X('enquiry-thread-unknown', 'POST ' + C + '/enquiry/:item_id', 400, { body: { message_text: 'hi', thread_type: 'loud' } }),
    X('enquiry-both-wrong', 'POST ' + C + '/enquiry/:item_id', 400, { body: { message_text: '', thread_type: 5 } }),
    X('enquiry-product-not-visible', 'POST ' + C + '/enquiry/:item_id', 404, { body: { message_text: 'hi' } }),
    X('enquiry-asked', 'POST ' + C + '/enquiry/:item_id', 201, { body: { message_text: '  is it fresh?  ' }, setup: withRows(firstOf(owned, delivered)) }),
    X('enquiry-number-as-text', 'POST ' + C + '/enquiry/:item_id', 201, { body: { message_text: 5, thread_type: 'internal' }, setup: withRows(firstOf(owned, delivered)) }),
    X('enquiry-not-migrated', 'POST ' + C + '/enquiry/:item_id', 503, { body: { message_text: 'hi' }, setup: withRows(firstOf(owned, raising(/enquiry_message_deliver/, '42883'))) }),
    X('enquiry-db-fails-after-the-gate', 'POST ' + C + '/enquiry/:item_id', 500, { body: { message_text: 'hi' }, setup: withRows(firstOf(owned, raising(/enquiry_message_deliver/, '08006'))) }),
    X('enquiry-db-fails', 'POST ' + C + '/enquiry/:item_id', 500, { body: { message_text: 'hi' }, setup: failing }),
    /* POST /photo-extract */
    X('photo-no-images', 'POST ' + C + '/photo-extract', 400, { body: {} }),
    X('photo-images-not-a-list', 'POST ' + C + '/photo-extract', 400, { body: { images: 'x' } }),
    X('photo-empty-list', 'POST ' + C + '/photo-extract', 400, { body: { images: [] } }),
    X('photo-read', 'POST ' + C + '/photo-extract', 200, { body: { images: [{ mime: 'image/png', b64: 'AA==' }] }, patch: photo(async () => ({ proposed: [], note: 'ok' })) }),
    X('photo-wallet-empty', 'POST ' + C + '/photo-extract', 402, { body: { images: [{}] }, patch: photo(refusal(402, 'Top up the wallet.')) }),
    X('photo-refusal-without-words', 'POST ' + C + '/photo-extract', 429, { genericOk: true /* the thrower set no sentence: the generic one is all there is */, body: { images: [{}] }, patch: photo(async () => { throw Object.assign(new Error(''), { status: 429 }); }) }),
    X('photo-not-connected', 'POST ' + C + '/photo-extract', 503, { body: { images: [{}] }, patch: photo(refusal(503, 'secret provider text')) }),
    X('photo-fails', 'POST ' + C + '/photo-extract', 500, { body: { images: [{}] }, patch: photo(boom) }),
    /* the shopper's orders and documents */
    X('orders-listed', 'GET ' + C + '/:bridge_id/my-orders', 200, { url: C + '/tea-shop/my-orders?page=1&limit=2', setup: withRows(orderRows) }),
    X('orders-none', 'GET ' + C + '/:bridge_id/my-orders', 200, {}),
    X('orders-before-b50', 'GET ' + C + '/:bridge_id/my-orders', 200, { setup: withRows(firstOf(raising(/chit_participants/, '42883'), orderRows)) }),
    X('orders-db-fails', 'GET ' + C + '/:bridge_id/my-orders', 500, { setup: failing }),
    X('documents-listed', 'GET ' + C + '/:bridge_id/my-documents', 200, { setup: withRows(answering(/FROM cb_attachment/, [{ id: PARTY, name: 'return.pdf', _total: '1' }])) }),
    X('documents-none', 'GET ' + C + '/:bridge_id/my-documents', 200, {}),
    X('documents-db-fails', 'GET ' + C + '/:bridge_id/my-documents', 500, { setup: failing }),
    X('document-deleted', 'DELETE ' + C + '/:bridge_id/my-documents/:id', 200, { setup: withRows(answering(/DELETE FROM cb_attachment/, [{ id: PARTY }])) }),
    X('document-not-theirs', 'DELETE ' + C + '/:bridge_id/my-documents/:id', 404, {}),
    X('document-delete-fails', 'DELETE ' + C + '/:bridge_id/my-documents/:id', 500, { setup: failing }),
    X('a-business-is-no-shopper', 'GET ' + C + '/:bridge_id/my-orders', 401, { setup: { noCustomer: true } }),
    /* the catalogue face */
    X('face-none', 'GET ' + F, 200, {}),
    X('face-saved', 'GET ' + F, 200, { setup: withRows(answering(/SELECT face, updated_at FROM catalogue_face/, [{ face: { purpose: 'shop' }, updated_at: '2026-10-01T00:00:00.000Z' }])) }),
    X('face-saved-no-stamp', 'GET ' + F, 200, { setup: withRows(answering(/SELECT face, updated_at FROM catalogue_face/, [{ face: {}, updated_at: null }])) }),
    X('face-read-fails', 'GET ' + F, 500, { setup: failing }),
    X('face-missing', 'PUT ' + F, 400, { body: {} }),
    X('face-null', 'PUT ' + F, 400, { body: { face: null } }),
    X('face-a-list', 'PUT ' + F, 400, { body: { face: [] } }),
    X('face-too-large', 'PUT ' + F, 413, { body: { face: BIG_FACE } }),
    X('face-declaration-unsupported', 'PUT ' + F, 422, { body: { face: { order_input: { schema: { properties: { a: { pattern: 'x' } } } } } } }),
    X('face-item-declaration-unsupported', 'PUT ' + F, 422, { body: { face: { items: [{ name: 'Tea', order_input: { schema: { properties: { a: { pattern: 'x' } } } } }] } } }),
    X('face-identity-unknown-column', 'PUT ' + F, 422, { body: { face: { identity: { key: ['nope'] } } }, setup: withRows(identity('name')) }),
    X('face-saved-whole', 'PUT ' + F, 200, { body: { face: { purpose: 'shop' } }, setup: withRows(answering(/INSERT INTO catalogue_face/, [{ updated_at: '2026-10-23T00:00:00.000Z' }])) }),
    /* CAT-211: the shop default rate is owner or manager only; the editor's save that changes it is refused whole */
    X('face-rate-owner-only', 'PUT ' + F, 403, { body: { face: { purpose: 'shop', tax: { default_slab: 'slab-18' } } }, setup: { who: STAFF, sqlRows: answering(/SELECT face FROM catalogue_face/, [{ face: { purpose: 'shop' } }]) } }),
    X('face-save-fails', 'PUT ' + F, 500, { body: { face: { purpose: 'shop' } }, setup: failing }),
    X('face-saved-by-staff', 'PUT ' + F, 200, { body: { face: { purpose: 'shop' } }, setup: { who: STAFF, sqlRows: answering(/INSERT INTO catalogue_face/, [{ updated_at: '2026-10-23T00:00:00.000Z' }]) } })
  ];
}

module.exports = { extras };
