/**
 * schemas-scenes.cjs — the named scenarios of tests/api-problem-schemas.test.cjs: an answer the generic worlds cannot reach (a catalogue with columns, a refusal inside a handler,
 * a library that throws), with the stand-in rows each one needs.
 *
 * OWNS      the extras: one scenario per answer of routes/schemas.js worth freezing; the rows themselves (the shop's definition, its columns, what products record); the stand-in of the
 *           "signed in as another shop" world (visibleTo).
 * CALLED BY tests/api-problem-schemas.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, db, jsonThrows }, patch, body, url, after, synthetic }] → the harness runs each one against the real route
 * CARD      07-catalogue-and-pricing/catalogue-setup
 * A scenario with `after: true` is a refusal the sweep ADDS (an unknown key in a body, a list for a body): nothing was frozen for it, it is asserted by its own check.
 * A scenario with `synthetic: true` is replayed in a capture and a compare and judged by its own function in a check run (the one leak the sweep found, POST /create-default).
 */
'use strict';
const S = '/api/schemas';
const SHOP = '11111111-1111-4111-8111-111111111111';
const OTHER_SHOP = '99999999-9999-4999-8999-999999999999';
const SCHEMA = '77777777-7777-4777-8777-777777777777';
const FIELD = '88888888-8888-4888-8888-888888888888';
const BOOTSTRAP_SAYS = 'the bootstrap said no';

/** a stand-in that answers a statement with rows when the statement matches */
const when = (pattern, rows) => (sql) => (pattern.test(String(sql)) ? { rows, rowCount: rows.length } : null);
/** the first stand-in that has an answer wins */
const firstOf = (...answers) => (sql, params) => answers.map((answer) => answer(sql, params)).find((given) => given) || null;
/** a stand-in that raises for a statement that matches (the rest is answered by the next stand-in) */
const raising = (pattern) => (sql) => {
  if (pattern.test(String(sql))) throw Object.assign(new Error('pg 57014'), { code: '57014' });
  return null;
};

/* the statements of routes/schemas.js and of the libraries under it, by the words that tell them apart */
const MY = /FROM entity_schemas es\s+LEFT JOIN schema_fields/;
const READ_BACK = /FROM entity_schemas es\s+JOIN schema_fields sf/;
const DEFAULT_SCHEMA = /SELECT schema_id FROM entity_schemas/;
const DECLARED = /FROM schema_fields WHERE schema_id = \$1 ORDER BY display_order ASC/;
const OWN_KEYS = /SELECT field_key FROM schema_fields WHERE schema_id = \$1\s+ORDER BY display_order NULLS LAST/;
const USAGE = /jsonb_each_text/;
const ATTRS = /SELECT field_key, unit, leg, via FROM schema_fields/;
const COLUMN = /SELECT sf\.field_id, sf\.field_name/;
const HOLDERS = /btrim\(COALESCE\(ci\.item_data->>\$2, ''\)\) <> ''/;
const EMPTY_HOLDERS = /btrim\(COALESCE\(ci\.item_data->>\$2, ''\)\) = ''/;
const DROP = /DELETE FROM schema_fields/;
const REORDER = /UPDATE schema_fields s SET display_order/;
const RETYPE = /UPDATE schema_fields SET/;
const VISIBILITY = /UPDATE entity_schemas SET visibility/;

const definition = () => ({ schema_id: SCHEMA, entity_id: SHOP, schema_name: 'Product Schema', status: 'active', is_default: true, visibility: 'private', fields: [{ field_key: 'name', field_name: 'Product', field_type: 'text', required: true, display_order: 1 }] });
const declared = () => [
  { field_key: 'name', field_name: 'Product', field_type: 'text', required: true, display_order: 1 },
  { field_key: 'unit', field_name: 'Unit', field_type: 'text', required: false, display_order: 2 },
  { field_key: 'price', field_name: 'Price', field_type: 'number', required: true, display_order: 3 },
  { field_key: 'grade', field_name: 'Grade', field_type: 'text', required: false, display_order: 4 }
];
/** a column row as the lookup of DELETE and PATCH reads it */
const column = (more) => Object.assign({ field_id: FIELD, field_name: 'Grade', field_type: 'text', required: false, schema_id: SCHEMA }, more);
const withRows = (answer) => ({ sqlRows: answer });
/** the shop has a default definition and these columns; products record `used` */
const catalogue = (used) => firstOf(when(DEFAULT_SCHEMA, [{ schema_id: SCHEMA }]), when(DECLARED, declared()), when(USAGE, used || [{ field_key: 'grade', n: 3 }, { field_key: 'name', n: 12 }, { field_key: 'colour', n: 2 }]));
/** the lookup of one column of the shop's definition, and how many products record a value in it */
const holding = (row, holders, missing) => firstOf(when(COLUMN, row ? [row] : []), when(HOLDERS, [{ n: holders || 0 }]), when(EMPTY_HOLDERS, [{ n: missing || 0 }]));
const schemaReady = (yes) => ({ schema: { hasColumn: async () => yes } });
const bootstrapGives = (given) => ({ bootstrap: { ensureDefaultSchema: async () => given } });
const bootstrapThrows = () => ({ bootstrap: { ensureDefaultSchema: async () => { throw new Error('relation "entity_schemas" does not exist -- SELECT secret FROM vault'); } } });

/** the tools a scene is built from: the harness's own stand-ins */
function extras() {
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** an answer the sweep adds: nothing was frozen for it */
  const A = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const MY_ROUTE = 'GET ' + S + '/my';
  const CREATE = 'POST ' + S + '/create-default';
  const FIELDS = 'GET ' + S + '/fields';
  const DROP_ONE = 'DELETE ' + S + '/fields/:field_key';
  const ORDER = 'PATCH ' + S + '/fields/order';
  const PATCH_ONE = 'PATCH ' + S + '/fields/:field_key';
  const VIS = 'PATCH ' + S + '/visibility';
  const at = (key) => S + '/fields/' + key;
  const long = (count) => 'x'.repeat(count);
  return [
    /* GET /my */
    X('my-has-definition', MY_ROUTE, 200, { setup: withRows(when(MY, [definition()])) }),
    X('my-none', MY_ROUTE, 200, {}),
    X('my-answer-fails', MY_ROUTE, 500, { setup: { jsonThrows: true } }),
    X('my-query-ignored', MY_ROUTE, 200, { url: S + '/my?a=1&a=2' }),
    /* POST /create-default */
    X('create-new', CREATE, 200, { patch: bootstrapGives({ created: true, schema_id: SCHEMA }), setup: withRows(when(READ_BACK, [definition()])) }),
    X('create-existing', CREATE, 200, { patch: bootstrapGives({ created: false, schema_id: SCHEMA, existed: true }), setup: withRows(when(READ_BACK, [definition()])) }),
    X('create-read-back-empty', CREATE, 200, { patch: bootstrapGives({ created: true, schema_id: SCHEMA }) }),
    X('create-bootstrap-refuses', CREATE, 500, { patch: bootstrapGives({ created: false, error: BOOTSTRAP_SAYS }) }),
    X('create-no-schema-id', CREATE, 500, { patch: bootstrapGives({ created: false }) }),
    X('create-bootstrap-throws', CREATE, 500, { patch: bootstrapThrows() }),
    X('create-read-back-fails', CREATE, 500, { patch: bootstrapGives({ created: true, schema_id: SCHEMA }), setup: withRows(raising(READ_BACK)) }),
    X('create-answer-fails', CREATE, 500, { patch: bootstrapGives({ created: true, schema_id: SCHEMA }), setup: { jsonThrows: true, sqlRows: when(READ_BACK, [definition()]) } }),
    A('create-with-a-key', CREATE, 422, { patch: bootstrapGives({ created: false, schema_id: SCHEMA, existed: true }), body: { zz_unknown: 1 } }),
    A('create-with-a-list', CREATE, 422, { patch: bootstrapGives({ created: false, schema_id: SCHEMA, existed: true }), body: [] }),
    /* GET /fields */
    X('fields-declared', FIELDS, 200, { setup: withRows(catalogue()) }),
    X('fields-attrs-ready', FIELDS, 200, { patch: schemaReady(true), setup: withRows(firstOf(when(ATTRS, [{ field_key: 'grade', unit: 'KGM', leg: 'system', via: null }, { field_key: 'name', unit: null, leg: null, via: 'ERP' }]), catalogue())) }),
    X('fields-none-declared', FIELDS, 200, {}),
    X('fields-usage-read-fails', FIELDS, 200, { setup: withRows(firstOf(raising(USAGE), catalogue())) }),
    X('fields-declared-read-fails', FIELDS, 500, { setup: withRows(firstOf(raising(DECLARED), catalogue())) }),
    X('fields-answer-fails', FIELDS, 500, { setup: { jsonThrows: true, sqlRows: catalogue() } }),
    X('fields-query-ignored', FIELDS, 200, { url: S + '/fields?a=1&a=2', setup: withRows(catalogue()) }),
    /* DELETE /fields/:field_key */
    X('drop-free', DROP_ONE, 200, { url: at('grade'), setup: withRows(holding(column(), 0)) }),
    X('drop-locked', DROP_ONE, 409, { url: at('name') }),
    X('drop-required', DROP_ONE, 409, { url: at('grade'), setup: withRows(holding(column({ required: true }), 0)) }),
    X('drop-in-use', DROP_ONE, 409, { url: at('grade'), setup: withRows(holding(column(), 12)) }),
    X('drop-in-use-one', DROP_ONE, 409, { url: at('grade'), setup: withRows(holding(column(), 1)) }),
    X('drop-unknown', DROP_ONE, 404, { url: at('nothing') }),
    X('drop-blank-key', DROP_ONE, 400, { url: at('%20') }),
    X('drop-count-fails', DROP_ONE, 500, { url: at('grade'), setup: withRows(firstOf(raising(HOLDERS), holding(column(), 0))) }),
    X('drop-delete-fails', DROP_ONE, 500, { url: at('grade'), setup: withRows(firstOf(raising(DROP), holding(column(), 0))) }),
    X('drop-answer-fails', DROP_ONE, 500, { url: at('grade'), setup: { jsonThrows: true, sqlRows: holding(column(), 0) } }),
    X('drop-with-a-body', DROP_ONE, 200, { url: at('grade'), body: { zz_unknown: 1 }, setup: withRows(holding(column(), 0)) }),
    /* PATCH /fields/order */
    X('order-all', ORDER, 200, { body: { order: ['grade', 'price', 'unit', 'name'] }, setup: withRows(firstOf(when(DEFAULT_SCHEMA, [{ schema_id: SCHEMA }]), when(OWN_KEYS, declared()))) }),
    X('order-partial', ORDER, 200, { body: { order: ['price'] }, setup: withRows(firstOf(when(DEFAULT_SCHEMA, [{ schema_id: SCHEMA }]), when(OWN_KEYS, declared()))) }),
    X('order-doubles-and-strangers', ORDER, 200, { body: { order: ['grade', 'grade', 'zz', 'name', 7] }, setup: withRows(firstOf(when(DEFAULT_SCHEMA, [{ schema_id: SCHEMA }]), when(OWN_KEYS, declared()))) }),
    X('order-no-definition', ORDER, 404, { body: { order: ['name'] } }),
    X('order-none-of-mine', ORDER, 400, { body: { order: ['zz'] }, setup: withRows(firstOf(when(DEFAULT_SCHEMA, [{ schema_id: SCHEMA }]), when(OWN_KEYS, declared()))) }),
    X('order-empty-list', ORDER, 400, { body: { order: [] } }),
    X('order-missing', ORDER, 400, { body: {} }),
    X('order-not-a-list', ORDER, 400, { body: { order: 'name' } }),
    X('order-null', ORDER, 400, { body: { order: null } }),
    X('order-body-a-list', ORDER, 400, { body: ['name'] }),
    X('order-update-fails', ORDER, 500, { body: { order: ['name'] }, setup: withRows(firstOf(raising(REORDER), when(DEFAULT_SCHEMA, [{ schema_id: SCHEMA }]), when(OWN_KEYS, declared()))) }),
    X('order-answer-fails', ORDER, 500, { body: { order: ['name'] }, setup: { jsonThrows: true, sqlRows: firstOf(when(DEFAULT_SCHEMA, [{ schema_id: SCHEMA }]), when(OWN_KEYS, declared())) } }),
    A('order-with-a-key', ORDER, 400, { body: { order: ['name'], zz_unknown: 1 } }),
    /* PATCH /fields/:field_key */
    X('patch-rename', PATCH_ONE, 200, { url: at('grade'), body: { field_name: '  Quality  ' }, setup: withRows(holding(column())) }),
    X('patch-nothing', PATCH_ONE, 200, { url: at('grade'), body: {}, setup: withRows(holding(column())) }),
    X('patch-type-free', PATCH_ONE, 200, { url: at('grade'), body: { field_type: 'number' }, setup: withRows(holding(column(), 0)) }),
    X('patch-type-same', PATCH_ONE, 200, { url: at('grade'), body: { field_type: 'text' }, setup: withRows(holding(column())) }),
    X('patch-type-used', PATCH_ONE, 409, { url: at('grade'), body: { field_type: 'number' }, setup: withRows(holding(column(), 4)) }),
    X('patch-type-used-one', PATCH_ONE, 409, { url: at('grade'), body: { field_type: 'date' }, setup: withRows(holding(column(), 1)) }),
    X('patch-type-locked', PATCH_ONE, 409, { url: at('name'), body: { field_type: 'number' }, setup: withRows(holding(column({ field_name: 'Product' }), 0)) }),
    X('patch-type-unknown', PATCH_ONE, 400, { url: at('grade'), body: { field_type: 'blob' }, setup: withRows(holding(column())) }),
    X('patch-required-on', PATCH_ONE, 200, { url: at('grade'), body: { required: true }, setup: withRows(holding(column(), 0, 5)) }),
    X('patch-required-on-already', PATCH_ONE, 200, { url: at('grade'), body: { required: true }, setup: withRows(holding(column({ required: true }), 0, 5)) }),
    X('patch-required-off', PATCH_ONE, 200, { url: at('grade'), body: { required: false }, setup: withRows(holding(column({ required: true }))) }),
    X('patch-required-off-locked', PATCH_ONE, 409, { url: at('price'), body: { required: false }, setup: withRows(holding(column({ field_name: 'Price', required: true }))) }),
    X('patch-required-off-unit', PATCH_ONE, 200, { url: at('unit'), body: { required: false }, setup: withRows(holding(column({ field_name: 'Unit', required: true }))) }),
    X('patch-required-spelled-true', PATCH_ONE, 200, { url: at('grade'), body: { required: 'true' }, setup: withRows(holding(column(), 0, 2)) }),
    X('patch-required-spelled-false', PATCH_ONE, 200, { url: at('grade'), body: { required: 'false' }, setup: withRows(holding(column(), 0, 2)) }),
    X('patch-required-one', PATCH_ONE, 200, { url: at('grade'), body: { required: 1 }, setup: withRows(holding(column(), 0, 2)) }),
    X('patch-attr-not-ready', PATCH_ONE, 409, { url: at('grade'), body: { unit: 'kg' }, setup: withRows(holding(column())) }),
    X('patch-attr-unit', PATCH_ONE, 200, { url: at('grade'), body: { unit: ' kgm ' }, patch: schemaReady(true), setup: withRows(holding(column())) }),
    X('patch-attr-unit-empty', PATCH_ONE, 200, { url: at('grade'), body: { unit: '' }, patch: schemaReady(true), setup: withRows(holding(column())) }),
    X('patch-attr-unit-null', PATCH_ONE, 200, { url: at('grade'), body: { unit: null }, patch: schemaReady(true), setup: withRows(holding(column())) }),
    X('patch-attr-leg', PATCH_ONE, 200, { url: at('grade'), body: { leg: 'customer', via: 'IoT' }, patch: schemaReady(true), setup: withRows(holding(column())) }),
    X('patch-attr-leg-cleared', PATCH_ONE, 200, { url: at('grade'), body: { leg: null, via: '' }, patch: schemaReady(true), setup: withRows(holding(column())) }),
    X('patch-attr-leg-bad', PATCH_ONE, 400, { url: at('grade'), body: { leg: 'moon' }, patch: schemaReady(true), setup: withRows(holding(column())) }),
    X('patch-attr-via-bad', PATCH_ONE, 400, { url: at('grade'), body: { via: 'fax' }, patch: schemaReady(true), setup: withRows(holding(column())) }),
    X('patch-everything', PATCH_ONE, 200, { url: at('grade'), body: { field_name: 'Quality', field_type: 'number', required: true, unit: 'kgm', leg: 'cb', via: 'AI' }, patch: schemaReady(true), setup: withRows(holding(column(), 0, 3)) }),
    X('patch-unknown-column', PATCH_ONE, 404, { url: at('nothing'), body: { field_name: 'X' } }),
    X('patch-name-empty', PATCH_ONE, 400, { url: at('grade'), body: { field_name: '' } }),
    X('patch-name-null', PATCH_ONE, 400, { url: at('grade'), body: { field_name: null } }),
    X('patch-name-long', PATCH_ONE, 400, { url: at('grade'), body: { field_name: long(81) } }),
    X('patch-name-number', PATCH_ONE, 400, { url: at('grade'), body: { field_name: 5 } }),
    X('patch-type-number', PATCH_ONE, 400, { url: at('grade'), body: { field_type: 5 } }),
    X('patch-type-null', PATCH_ONE, 400, { url: at('grade'), body: { field_type: null } }),
    X('patch-required-bad', PATCH_ONE, 400, { url: at('grade'), body: { required: 'maybe' } }),
    X('patch-required-null', PATCH_ONE, 400, { url: at('grade'), body: { required: null } }),
    X('patch-unit-long', PATCH_ONE, 400, { url: at('grade'), body: { unit: long(17) } }),
    X('patch-unit-number', PATCH_ONE, 400, { url: at('grade'), body: { unit: 5 } }),
    X('patch-leg-number', PATCH_ONE, 400, { url: at('grade'), body: { leg: 5 } }),
    X('patch-via-object', PATCH_ONE, 400, { url: at('grade'), body: { via: {} } }),
    X('patch-all-bad', PATCH_ONE, 400, { url: at('grade'), body: { field_name: null, field_type: 1, required: 'x', unit: 5, leg: 5, via: 5 } }),
    X('patch-bad-and-missing-column', PATCH_ONE, 400, { url: at('nothing'), body: { required: 'x' } }),
    X('patch-count-fails', PATCH_ONE, 500, { url: at('grade'), body: { field_type: 'number' }, setup: withRows(firstOf(raising(HOLDERS), holding(column()))) }),
    X('patch-update-fails', PATCH_ONE, 500, { url: at('grade'), body: { field_name: 'Quality' }, setup: withRows(firstOf(raising(RETYPE), holding(column()))) }),
    X('patch-answer-fails', PATCH_ONE, 500, { url: at('grade'), body: { field_name: 'Quality' }, setup: { jsonThrows: true, sqlRows: holding(column()) } }),
    A('patch-with-a-key', PATCH_ONE, 400, { url: at('grade'), body: { field_name: 'Quality', zz_unknown: 1 }, setup: withRows(holding(column())) }),
    A('patch-with-a-list', PATCH_ONE, 400, { url: at('grade'), body: [], setup: withRows(holding(column())) }),
    /* PATCH /visibility */
    X('visibility-public', VIS, 200, { body: { visibility: 'public' }, setup: withRows(when(VISIBILITY, [{ schema_id: SCHEMA, visibility: 'public' }])) }),
    X('visibility-restricted', VIS, 200, { body: { visibility: 'restricted' }, setup: withRows(when(VISIBILITY, [{ schema_id: SCHEMA, visibility: 'restricted' }])) }),
    X('visibility-private', VIS, 200, { body: { visibility: 'private' }, setup: withRows(when(VISIBILITY, [{ schema_id: SCHEMA, visibility: 'private' }])) }),
    X('visibility-no-catalogue', VIS, 404, { body: { visibility: 'public' } }),
    X('visibility-bad', VIS, 400, { body: { visibility: 'secret' } }),
    X('visibility-missing', VIS, 400, { body: {} }),
    X('visibility-null', VIS, 400, { body: { visibility: null } }),
    X('visibility-number', VIS, 400, { body: { visibility: 5 } }),
    X('visibility-shouted', VIS, 400, { body: { visibility: 'PUBLIC' } }),
    X('visibility-body-a-list', VIS, 400, { body: ['public'] }),
    X('visibility-update-fails', VIS, 500, { body: { visibility: 'public' }, setup: { db: 'fail' } }),
    X('visibility-answer-fails', VIS, 500, { body: { visibility: 'public' }, setup: { jsonThrows: true, sqlRows: when(VISIBILITY, [{ schema_id: SCHEMA, visibility: 'public' }]) } }),
    A('visibility-with-a-key', VIS, 400, { body: { visibility: 'public', zz_unknown: 1 } })
  ];
}

/**
 * the rows of the "signed in as another shop" world: shop A's column is there for shop A and for nobody else (what the WHERE on the entity does), and `planted` false is a
 * database that never held it. → the sqlRows function of a scenario, or null when the caller sees nothing
 */
function visibleTo(who, planted) {
  const entity = who.parent_entity_id || who.identity_id;
  if (!planted || entity !== SHOP) return null;
  return holding(column(), 0);
}

module.exports = { extras, visibleTo, when, firstOf, column, SHOP, OTHER_SHOP, SCHEMA, BOOTSTRAP_SAYS, S };
