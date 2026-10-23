/**
 * attachments-scenes.cjs — the named scenarios of tests/api-problem-attachments.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the 2 routes of routes/attachments.js (put a file on a chit, give every participant a copy; read your own copy), each with the stand-in rows it
 *           needs, answered by the SHAPE of the statement so the same facts meet the old code and the new. Also the stand-in a foreign-id play uses (a copy is visible only to the entity that owns it,
 *           as RLS `rls_entity` on cb_attachment and chit_messages decides) and the stand-in's two type checks that Postgres makes (a uuid column refuses 'nope', an integer column refuses NaN).
 * CALLED BY tests/api-problem-attachments.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, body, url, patch }] → the harness runs each one against the real route
 * CARD      01-rail-core-the-chit/attachments
 * Every name below is an obviously made-up file ("receipt.png"); there is no person's data in this file. The bytes are a few made-up characters.
 */
'use strict';

const AT = '/api/attachments';
const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const PEER_ID = '99999999-9999-4999-8999-999999999999';
const THIRD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHIT = '77777777-7777-4777-8777-777777777777';
const UNKNOWN_CHIT = '88888888-8888-4888-8888-888888888888';
const ATT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UNKNOWN_ATT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MSG_OPEN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MSG_INTERNAL = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MSG_PEER_INTERNAL = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const MSG_UNKNOWN = '12121212-1212-4212-8212-121212121212';
const COPY_IDS = { [SHOP_ID]: '21212121-2121-4212-8212-212121212121', [PEER_ID]: '31313131-3131-4313-8313-313131313131', [THIRD_ID]: '41414141-4141-4414-8414-414141414141', [STRANGER_ID]: '51515151-5151-4515-8515-515151515151' };
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT4_MAX = 2147483647;
const SIX_MB = 6 * 1024 * 1024;
const BYTES = Buffer.from('made-up bytes of a receipt');
const ROSTER = [{ entity_id: SHOP_ID }, { entity_id: PEER_ID }, { entity_id: THIRD_ID }];
const B64 = BYTES.toString('base64');

/** what a participant's own copy of the chit's header holds: the roster (all_recipients) the upload fans out to */
const headerFor = (entity, roster) => ({ chit: CHIT, entity, roster });
/** a stored file as getBlob reads it */
const fileRow = (more) => Object.assign({ name: 'receipt.png', mime: 'image/png', size: BYTES.length, data: BYTES, chit_id: CHIT, message_id: null, entity_id: SHOP_ID }, more);

/**
 * attRows(world) — the stand-in database of these two routes, answering by the SHAPE of the statement.
 * world = { caller, headers: [{ chit, entity, roster }], messages: [{ id, entity, visibility }], files: [{ id, entity, row }], failInsertAt }
 * RLS is modelled where the statement does not name the entity itself: a message copy and a file are visible only to the entity that owns them (`caller`).
 */
function attRows(world, sqlError) {
  const state = { inserts: 0 };
  return (sql, params) => {
    const text = String(sql);
    if (/SELECT all_recipients FROM chit_header/.test(text)) {
      if (!UUID_SHAPE.test(String(params[0]))) throw sqlError('22P02'); /* chit_id is a uuid column */
      const held = (world.headers || []).find((one) => one.chit === params[0] && one.entity === params[1]);
      return { rows: held ? [{ all_recipients: held.roster }] : [], rowCount: held ? 1 : 0 };
    }
    if (/SELECT visibility_entity_id FROM chit_messages/.test(text)) {
      if (!UUID_SHAPE.test(String(params[0]))) throw sqlError('22P02'); /* message_id is a uuid column */
      const held = (world.messages || []).find((one) => one.id === params[0] && one.entity === world.caller);
      return { rows: held ? [{ visibility_entity_id: held.visibility }] : [], rowCount: held ? 1 : 0 };
    }
    if (/INSERT INTO cb_attachment/.test(text)) return inserted(world, state, params, sqlError);
    if (/FROM cb_attachment\s+WHERE id = \$1/.test(text)) {
      if (!UUID_SHAPE.test(String(params[0]))) throw sqlError('22P02'); /* Postgres: the id column is a uuid, 'nope' is not one */
      const held = (world.files || []).find((one) => one.id === params[0] && one.entity === world.caller);
      return { rows: held ? [Object.assign({}, held.row)] : [], rowCount: held ? 1 : 0 };
    }
    return null;
  };
}

/** the INSERT of one copy: what Postgres refuses (NaN or too big for an integer line_index) is refused here, a chosen insert may fail, else the entity's own copy id comes back */
function inserted(world, state, params, sqlError) {
  state.inserts++;
  if (Number.isNaN(params[3])) throw sqlError('22P02'); /* integer column, parseInt('abc') is NaN: "invalid input syntax for type integer" */
  if (typeof params[3] === 'number' && params[3] > INT4_MAX) throw sqlError('22003');
  if (world.failInsertAt === state.inserts) throw sqlError('23505');
  return { rows: [{ id: COPY_IDS[params[0]] || COPY_IDS[STRANGER_ID] }], rowCount: 1 };
}

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { STAFF, SECRET_SQL, sqlError } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const up = (id, expect, body, world, more) => X(id, 'POST ' + AT, expect, Object.assign({ url: AT, body, setup: { sqlRows: attRows(Object.assign({ caller: SHOP_ID, headers: [headerFor(SHOP_ID, ROSTER)] }, world || {}), sqlError) } }, more));
  const read = (id, expect, row, more) => X(id, 'GET ' + AT + '/:id', expect, Object.assign({ url: AT + '/' + ATT, setup: { sqlRows: attRows({ caller: SHOP_ID, files: row ? [{ id: ATT, entity: SHOP_ID, row }] : [] }, sqlError) } }, more));
  const good = { chit_id: CHIT, name: 'receipt.png', mime: 'image/png', data_base64: B64 };
  const withBody = (more) => Object.assign({}, good, more);
  const thrown = () => { throw new Error(SECRET_SQL); };
  const messageWorld = (messages) => ({ messages });

  const refusals = [
    up('up-needs-chit_id', 400, { name: 'receipt.png', data_base64: B64 }),
    up('up-needs-name', 400, { chit_id: CHIT, data_base64: B64 }),
    up('up-needs-the-bytes', 400, { chit_id: CHIT, name: 'receipt.png' }),
    up('up-body-a-list', 400, []),
    up('up-chit-unknown', 403, withBody({ chit_id: UNKNOWN_CHIT })),
    up('up-chit-text-not-a-uuid', 500, withBody({ chit_id: 'nope' })),
    up('up-chit-of-another-shop', 403, good, { headers: [headerFor(PEER_ID, ROSTER)] }),
    up('up-chit-held-by-another-shop-only', 403, good, { headers: [headerFor(STRANGER_ID, ROSTER)] }),
    up('up-empty-file', 400, withBody({ data_base64: 'data:text/plain;base64,' }), null),
    up('up-over-6mb', 413, withBody({ data_base64: Buffer.alloc(SIX_MB + 3).toString('base64') })),
    up('up-library-throws-leaks-nothing', 500, good, null, { patch: { storage: { putForParticipants: async () => { throw new Error(SECRET_SQL); } } } }),
    up('up-roster-read-fails-leaks-nothing', 500, good, null, { setup: { sqlRows: thrown } }),
    up('up-insert-fails-leaks-nothing', 500, good, null, { setup: { sqlRows: (sql, params) => (/INSERT INTO cb_attachment/.test(String(sql)) ? thrown() : attRows({ caller: SHOP_ID, headers: [headerFor(SHOP_ID, ROSTER)] }, sqlError)(sql, params)) } }),
    up('up-first-copy-fails', 500, good, { failInsertAt: 1 }),
    up('up-second-copy-fails', 500, good, { failInsertAt: 2 }),
    up('up-answer-cannot-be-written', 500, good, null, { setup: { jsonThrows: true, sqlRows: attRows({ caller: SHOP_ID, headers: [headerFor(SHOP_ID, ROSTER)] }, sqlError) } }),
    up('up-line-index-abc-is-nan', 500, withBody({ line_index: 'abc' })),
    up('up-line-index-empty-text-is-nan', 500, withBody({ line_index: '' })),
    up('up-line-index-true-is-nan', 500, withBody({ line_index: true })),
    up('up-line-index-too-big-for-an-integer', 500, withBody({ line_index: 1e10 }))
  ];

  const fanout = [
    up('up-chit-wide', 200, good),
    up('up-staff-uploads-for-the-shop', 200, good, null, { setup: { who: STAFF, sqlRows: attRows({ caller: SHOP_ID, headers: [headerFor(SHOP_ID, ROSTER)] }, sqlError) } }),
    up('up-data-url-prefix-is-cut', 200, withBody({ data_base64: 'data:image/png;base64,' + B64 })),
    up('up-exactly-6mb', 200, withBody({ data_base64: Buffer.alloc(SIX_MB).toString('base64') })),
    up('up-roster-empty-is-the-caller-alone', 200, good, { headers: [headerFor(SHOP_ID, [])] }),
    up('up-roster-null-is-the-caller-alone', 200, good, { headers: [headerFor(SHOP_ID, null)] }),
    up('up-roster-skips-entries-without-an-entity', 200, good, { headers: [headerFor(SHOP_ID, [{ entity_id: PEER_ID }, {}, { entity_id: null }, { entity_id: PEER_ID }])] }),
    up('up-keys-that-widen-are-ignored', 200, withBody({ participants: [STRANGER_ID], audience: 'all', entity_id: STRANGER_ID, uploaded_by: STRANGER_ID, size: 1, id: STRANGER_ID }))
  ];

  const echoes = [
    up('up-name-is-cut-at-200-and-echoed-whole', 200, withBody({ name: 'n'.repeat(300) })),
    up('up-mime-is-cut-at-120-and-echoed-whole', 200, withBody({ mime: 'm'.repeat(200) })),
    up('up-no-mime-is-octet-stream', 200, { chit_id: CHIT, name: 'receipt.bin', data_base64: B64 }),
    up('up-empty-mime-is-octet-stream', 200, withBody({ mime: '' })),
    up('up-name-an-object-is-echoed-as-sent', 200, withBody({ name: { any: 'thing' } })),
    up('up-mime-a-number-is-echoed-as-sent', 200, withBody({ mime: 7 })),
    up('up-bytes-a-number', 200, withBody({ data_base64: 123456 })),
    up('up-line-index-text-2', 200, withBody({ line_index: '2' })),
    up('up-line-index-zero', 200, withBody({ line_index: 0 })),
    up('up-line-index-null', 200, withBody({ line_index: null })),
    up('up-line-index-fraction', 200, withBody({ line_index: 1.9 })),
    up('up-line-index-text-prefix', 200, withBody({ line_index: '3abc' })),
    up('up-line-index-negative', 200, withBody({ line_index: -4 }))
  ];

  /* message_id: looked up under RLS only (the caller's own copies); what it finds decides the audience */
  const messages = [
    up('up-message-open', 200, withBody({ message_id: MSG_OPEN }), messageWorld([{ id: MSG_OPEN, entity: SHOP_ID, visibility: null }])),
    up('up-message-internal-own', 200, withBody({ message_id: MSG_INTERNAL }), messageWorld([{ id: MSG_INTERNAL, entity: SHOP_ID, visibility: SHOP_ID }])),
    up('up-message-unknown', 200, withBody({ message_id: MSG_UNKNOWN }), messageWorld([])),
    up('up-message-of-another-shop-not-visible', 200, withBody({ message_id: MSG_PEER_INTERNAL }), messageWorld([{ id: MSG_PEER_INTERNAL, entity: PEER_ID, visibility: PEER_ID }])),
    up('up-message-text-not-a-uuid', 500, withBody({ message_id: 'nope' }))
  ];

  const MIMES = [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['jpg', 'image/jpg'], ['gif', 'image/gif'], ['webp', 'image/webp'], ['bmp', 'image/bmp'], ['pdf', 'application/pdf']];
  const inline = MIMES.map(([tag, mime]) => read('get-' + tag + '-opens-inline', 200, fileRow({ mime })));
  const download = [
    read('get-svg-is-forced-to-download', 200, fileRow({ mime: 'image/svg+xml', name: 'logo.svg' })),
    read('get-html-is-forced-to-download', 200, fileRow({ mime: 'text/html', name: 'page.html' })),
    read('get-text-is-forced-to-download', 200, fileRow({ mime: 'text/plain', name: 'note.txt' })),
    read('get-no-mime-is-octet-stream', 200, fileRow({ mime: null })),
    read('get-mime-in-capitals-is-lowered', 200, fileRow({ mime: 'IMAGE/PNG' })),
    read('get-mime-with-parameters-is-forced-to-download', 200, fileRow({ mime: 'image/png; charset=x' })),
    read('get-name-is-cleaned', 200, fileRow({ name: 'a"b\\c\r\nd.png' })),
    read('get-no-name-is-file', 200, fileRow({ name: null })),
    read('get-name-in-latin-1', 200, fileRow({ name: 'résumé.pdf', mime: 'application/pdf' })),
    read('get-empty-bytes', 200, fileRow({ data: Buffer.alloc(0), size: 0 })),
    read('get-no-bytes-at-all', 200, fileRow({ data: null }))
  ];
  const reads = [
    read('get-not-held', 404, null),
    read('get-name-beyond-latin-1-cannot-be-sent', 500, fileRow({ name: 'रसीद.pdf', mime: 'application/pdf' })),
    read('get-staff-reads-the-shops-copy', 200, fileRow(), { setup: { who: STAFF, sqlRows: attRows({ caller: SHOP_ID, files: [{ id: ATT, entity: SHOP_ID, row: fileRow() }] }, sqlError) } }),
    read('get-id-not-a-uuid', 500, null, { url: AT + '/nope' }),
    read('get-library-throws-leaks-nothing', 500, null, { patch: { storage: { getBlob: async () => { throw new Error(SECRET_SQL); } } } }),
    read('get-read-fails-leaks-nothing', 500, null, { setup: { sqlRows: thrown } })
  ];
  return refusals.concat(fanout, echoes, messages, inline, download, reads);
}

/** the stand-in a foreign-id play uses: shop A (the owner) holds the file, only when `planted`; the caller is shop A or shop B; the file is visible to its own entity alone */
const ownedBy = (caller, planted, sqlError) => attRows({ caller, files: planted ? [{ id: ATT, entity: SHOP_ID, row: fileRow() }] : [] }, sqlError);

module.exports = { AT, extras, attRows, ownedBy, fileRow, headerFor, ROSTER, B64, BYTES, SHOP_ID, STRANGER_ID, PEER_ID, THIRD_ID, CHIT, UNKNOWN_CHIT, ATT, UNKNOWN_ATT, MSG_OPEN, MSG_INTERNAL, MSG_PEER_INTERNAL, MSG_UNKNOWN, COPY_IDS, SIX_MB };
