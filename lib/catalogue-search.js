'use strict';
// lib/catalogue-search.js — the ONE answer to "which products match what was typed" (CAT-313/314).
// OWNS     searchWhere(q, paramNo) → { sql, param } : the SQL condition and its LIKE parameter for GET /api/products?q=
// CALLED BY routes/products.js (GET /)
// CARD     06-catalogue-pim/README (Items — search)
// WHY      the old search was `item_data::text ILIKE '%q%'` over the WHOLE record: a cost-blind editor could read a hidden cost one cent step at a time (a
//          search for 4242.5 returned the product), and a field NAME ("cost") matched. Now only the VALUES of the named fields below are searched, the same
//          for every caller (a product is found by what its row shows; a cost is a search key for nobody), and % _ \ in what was typed match themselves.
const cost = require('./cost');

/** the product fields a person looks a product up by — scalar text/number values at the top of item_data, the ones the list row carries */
const SEARCH_FIELDS = ['name', 'display_name', 'sku', 'code', 'item_code', 'barcode', 'ean', 'brand', 'category', 'description', 'hsn', 'unit', 'model', 'tax_slab_name'].filter(
  (field) => !cost.isCostKey(field) /* the ONE cost-key rule: a future field named like a cost can never become a search key */
);

/** % _ and \ typed by a person mean themselves in a LIKE pattern */
const likeLiteral = (typed) => String(typed).replace(/[\\%_]/g, (symbol) => '\\' + symbol);

/** the AND-able condition over item_data and the value to bind at $paramNo; the field names are constants of this file, never input */
function searchWhere(typed, paramNo) {
  const ref = `$${paramNo}`;
  const perField = SEARCH_FIELDS.map((field) => `(jsonb_typeof(item_data->'${field}') IN ('string','number') AND item_data->>'${field}' ILIKE ${ref} ESCAPE '\\')`);
  return { sql: `(${perField.join(' OR ')})`, param: `%${likeLiteral(typed)}%` };
}

/** the list's { where, params } for a shop's active products matching what was typed (entity_id is $1, the pattern $2) */
function shelfWhere(entityId, typed) {
  const found = searchWhere(typed, 2);
  return { where: `entity_id=$1 AND is_active=true AND ${found.sql}`, params: [entityId, found.param] };
}

module.exports = { shelfWhere, searchWhere, likeLiteral, SEARCH_FIELDS };
