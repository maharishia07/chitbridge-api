/**
 * combo-templates.test.cjs — [OFFR-06] SAVE AS, AND A WAY TO OPEN IT AGAIN — b266.
 *
 * Athi, testing the Modifier Lab: "the example shown is very pathetic... what i want is something similar
 * to the combo offer in a popup window with possibly combination, and also with save as option, if we are
 * doing save as feature then we should be having a mechanism of open the same again."
 *
 * Drives GET/POST/PATCH/DELETE /api/combo-templates through real express with a stubbed auth/db (in-memory
 * table) — no live database. The shape stored is CBVariant's own group-array contract; this route does not
 * re-validate it beyond "plausible enough to ever read back" (a name, at least one group, every group named
 * and non-empty) — the client runs the real CBVariant.validate() before ever offering "Save as".
 *
 * Run: node tests/combo-templates.test.cjs
 */
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');

const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(70) + got + (ok ? '' : '   want ' + want));
};

const ENTITY_A = { identity_id: 'eA', identity_type: 'entity', display_name: 'Mayur Bhavan' };
const ENTITY_B = { identity_id: 'eB', identity_type: 'entity', display_name: 'A Different Shop' };

const GROUPS = [{ name: 'Choose a tiffin', required: true, max: 1,
  options: [{ name: 'Idli', price: 0 }, { name: 'Masala Dosa', price: 15 }] }];

const call = (port, method, path_, body) => new Promise((ok) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: path_, method,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch (_) {}
      ok({ status: res.statusCode, body });
    }); });
  r.end(b);
});

async function run() {
  console.log('\n-- [OFFR-06] save a combo, list it, reopen it, rename it, delete it --\n');

  let WHO = ENTITY_A;
  /** in-memory stand-ins for the real tables — enough SQL pattern-matching to prove the route's own logic,
   *  not a second implementation of Postgres. PRODUCTS backs catalogue_items, for the /push tests below. */
  let ROWS = [], seq = 1;
  let PRODUCTS = [], pseq = 1;
  const cols = (r) => ({ id: r.id, name: r.name, definition: r.definition, price: r.price != null ? r.price : null,
    product_item_id: r.product_item_id || null, created_at: r.created_at, updated_at: r.updated_at });
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
      entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
    }),
  };
  const dbExports = {
    /* defaultSchemaId()/ensureDeclared()'s own bookkeeping queries — none of them are what this test is
       proving, so they get an empty, harmless answer, same as an entity with no custom schema at all. */
    query: async () => ({ rows: [] }),
    withEntity: async (entity_id, fn) => fn({
      query: async (text, params) => {
        const q = text.replace(/\s+/g, ' ').trim();
        if (q.startsWith('SELECT id, name, definition, price, product_item_id, created_at, updated_at FROM combo_templates WHERE entity_id=$1')) {
          return { rows: ROWS.filter((r) => r.entity_id === params[0]).sort((a, b) => b.seq - a.seq).map(cols) };
        }
        if (q.startsWith('INSERT INTO combo_templates')) {
          const [eid, name, def, price] = params;
          const row = { id: 'ct' + (seq), seq: seq++, entity_id: eid, name, definition: JSON.parse(def), price: price == null ? null : Number(price), created_at: 'now', updated_at: 'now' };
          ROWS.push(row);
          return { rows: [cols(row)] };
        }
        if (q.startsWith('SELECT name, definition, price FROM combo_templates WHERE id=$1 AND entity_id=$2')) {
          const row = ROWS.find((r) => r.id === params[0] && r.entity_id === params[1]);
          return { rows: row ? [{ name: row.name, definition: row.definition, price: row.price }] : [] };
        }
        if (q.startsWith('SELECT name, definition, price, product_item_id FROM combo_templates WHERE id=$1 AND entity_id=$2')) {
          const row = ROWS.find((r) => r.id === params[0] && r.entity_id === params[1]);
          return { rows: row ? [{ name: row.name, definition: row.definition, price: row.price, product_item_id: row.product_item_id || null }] : [] };
        }
        if (q.startsWith('UPDATE combo_templates SET name=$1, definition=$2, price=$3')) {
          const [name, def, price, id, eid] = params;
          const row = ROWS.find((r) => r.id === id && r.entity_id === eid);
          if (!row) return { rows: [] };
          row.name = name; row.definition = JSON.parse(def); row.price = price == null ? null : Number(price); row.updated_at = 'later';
          return { rows: [cols(row)] };
        }
        if (q.startsWith('UPDATE combo_templates SET product_item_id=$1')) {
          const [pid, id, eid] = params;
          const row = ROWS.find((r) => r.id === id && r.entity_id === eid);
          if (!row) return { rows: [] };
          row.product_item_id = pid; row.updated_at = 'later';
          return { rows: [cols(row)] };
        }
        if (q.startsWith('DELETE FROM combo_templates WHERE id=$1 AND entity_id=$2')) {
          const i = ROWS.findIndex((r) => r.id === params[0] && r.entity_id === params[1]);
          if (i < 0) return { rows: [] };
          const [row] = ROWS.splice(i, 1);
          return { rows: [{ id: row.id }] };
        }
        /* ── catalogue_items — the /push tests' stand-in for mint-product.js / products.js's own UPDATE ── */
        if (q.startsWith('SELECT item_id, item_data FROM catalogue_items WHERE item_id=$1 AND entity_id=$2 AND is_active=true')) {
          const row = PRODUCTS.find((p) => p.item_id === params[0] && p.entity_id === entity_id && p.is_active !== false);
          return { rows: row ? [{ item_id: row.item_id, item_data: row.item_data }] : [] };
        }
        if (q.startsWith('INSERT INTO catalogue_items')) {
          const [eid, schema_id, item_data] = params;
          const row = { item_id: 'p' + (pseq++), entity_id: eid, schema_id, item_data: JSON.parse(item_data), is_active: true };
          PRODUCTS.push(row);
          return { rows: [row] };
        }
        if (q.startsWith('UPDATE catalogue_items SET item_data=$1')) {
          const [item_data, item_id, eid] = params;
          const row = PRODUCTS.find((p) => p.item_id === item_id && p.entity_id === eid);
          if (!row) return { rows: [] };
          row.item_data = JSON.parse(item_data);
          return { rows: [row] };
        }
        return { rows: [] };   /* defaultSchemaId(), ensureDeclared()'s own schema/column reads — see above */
      },
    }),
    readBatch: async () => ([{ rows: [] }]),
  };
  require.cache[require.resolve(API + '/db')] = { exports: dbExports };

  delete require.cache[require.resolve(API + '/routes/combo-templates')];
  delete require.cache[require.resolve(API + '/routes/products')];
  const app = express();
  app.use(express.json());
  app.use('/api/combo-templates', require(API + '/routes/combo-templates'));
  const srv = app.listen(0);
  const port = srv.address().port;

  WHO = ENTITY_A;
  t('a fresh shop starts with an empty library', (await call(port, 'GET', '/api/combo-templates')).body.templates.length, 0);

  t('saving with no name is refused — a nameless row could never be found again',
    (await call(port, 'POST', '/api/combo-templates', { name: '', definition: GROUPS })).status, 400);
  t('saving with no groups at all is refused',
    (await call(port, 'POST', '/api/combo-templates', { name: 'Empty combo', definition: [] })).status, 400);
  t('saving a group with no options is refused',
    (await call(port, 'POST', '/api/combo-templates', { name: 'Half-built', definition: [{ name: 'Choose one', options: [] }] })).status, 400);

  const saved = await call(port, 'POST', '/api/combo-templates', { name: 'Tiffin combo', definition: GROUPS });
  t('⭐⭐⭐ "Save as" itself succeeds', saved.status, 200);
  t('and comes back with a real, findable id', typeof saved.body.template.id === 'string' && saved.body.template.id.length > 0, true);
  const id = saved.body.template.id;

  console.log('\n-- ⭐⭐⭐ "a mechanism of open the same again" — it is on the list, and reopens with its groups intact --\n');
  const list = await call(port, 'GET', '/api/combo-templates');
  t('the saved combo now appears in the library', list.body.templates.length, 1);
  t('under the name it was saved as', list.body.templates[0].name, 'Tiffin combo');
  t('carrying the exact groups it was saved with — nothing lost on the round trip',
    JSON.stringify(list.body.templates[0].definition), JSON.stringify(GROUPS));

  console.log('\n-- renaming and re-defining a saved combo, deleting one, and cross-entity isolation --\n');
  const renamed = await call(port, 'PATCH', '/api/combo-templates/' + id, { name: 'Weekday tiffin combo' });
  t('renaming a saved combo succeeds', renamed.status, 200);
  t('and the new name sticks', renamed.body.template.name, 'Weekday tiffin combo');

  t('renaming to a BLANK name is refused, not silently ignored',
    (await call(port, 'PATCH', '/api/combo-templates/' + id, { name: '  ' })).status, 400);

  t('patching an id that does not exist 404s', (await call(port, 'PATCH', '/api/combo-templates/no-such-id', { name: 'x' })).status, 404);

  WHO = ENTITY_B;
  t('⚠️⚠️ A DIFFERENT ENTITY sees an EMPTY library, not the first shop\'s saved combos',
    (await call(port, 'GET', '/api/combo-templates')).body.templates.length, 0);
  t('and cannot rename the first shop\'s combo by guessing its id',
    (await call(port, 'PATCH', '/api/combo-templates/' + id, { name: 'stolen' })).status, 404);
  t('nor delete it', (await call(port, 'DELETE', '/api/combo-templates/' + id)).status, 404);

  WHO = ENTITY_A;
  const del = await call(port, 'DELETE', '/api/combo-templates/' + id);
  t('the owning entity can delete its own saved combo', del.status, 200);
  t('and it is gone from the library afterward', (await call(port, 'GET', '/api/combo-templates')).body.templates.length, 0);

  console.log('\n-- ⭐⭐⭐ [OFFR-08] "push" — CREATE the first time, UPDATE every time after --\n');
  const withPrice = await call(port, 'POST', '/api/combo-templates', { name: 'Tiffin combo', definition: GROUPS, price: 110 });
  const tid = withPrice.body.template.id;
  t('a price saved alongside the combo comes back on the row', withPrice.body.template.price, 110);

  const push1 = await call(port, 'POST', '/api/combo-templates/' + tid + '/push');
  t('the first push CREATES a real product', push1.status, 200);
  t('…and says so', push1.body.verb, 'created');
  t('the new product carries the combo\'s name, price and groups', push1.body.item.item_data.name, 'Tiffin combo');
  t('…price too — stamped {amount,currency} like every other product price', push1.body.item.item_data.price.amount, 110);
  t('…and its modifiers', JSON.stringify(push1.body.item.item_data.modifiers), JSON.stringify(GROUPS));
  const productId = push1.body.item.item_id;
  t('the template now remembers which product it created', push1.body.template.product_item_id, productId);

  console.log('\n-- ⚠️⚠️⚠️ pushing again UPDATES that same product — never a second, duplicate one --\n');
  const renamedTpl = await call(port, 'PATCH', '/api/combo-templates/' + tid, { name: 'Tiffin combo (weekday)', price: 120 });
  t('renamed and repriced the template first', renamedTpl.body.template.name, 'Tiffin combo (weekday)');
  const productsBefore = PRODUCTS.length;
  const push2 = await call(port, 'POST', '/api/combo-templates/' + tid + '/push');
  t('the second push UPDATES, not creates', push2.body.verb, 'updated');
  t('⭐⭐⭐ still the SAME product id — not a duplicate', push2.body.item.item_id, productId);
  t('no new row was added to the catalogue', PRODUCTS.length, productsBefore);
  t('the existing product now carries the new name', push2.body.item.item_data.name, 'Tiffin combo (weekday)');
  t('…and the new price', push2.body.item.item_data.price.amount, 120);

  console.log('\n-- ⚠️ a stale link (the product was deleted some other way) falls back to CREATE, not a refusal --\n');
  PRODUCTS = PRODUCTS.filter((p) => p.item_id !== productId);   // simulate the linked product having been removed
  const push3 = await call(port, 'POST', '/api/combo-templates/' + tid + '/push');
  t('a dangling product_item_id is not an error — it just re-creates', push3.status, 200);
  t('…and says CREATED, honestly, not "updated" a product that no longer exists', push3.body.verb, 'created');
  t('…with a genuinely new item id', push3.body.item.item_id !== productId, true);

  console.log('\n-- ⚠️ pushing a combo with no price and no product yet is refused, plainly --\n');
  const noPriceTpl = await call(port, 'POST', '/api/combo-templates', { name: 'No price yet', definition: GROUPS });
  const pushNoPrice = await call(port, 'POST', '/api/combo-templates/' + noPriceTpl.body.template.id + '/push');
  t('refused — there is nothing to price the new product at', pushNoPrice.status, 400);
  t('…and says why, plainly', /[Pp]rice/.test(pushNoPrice.body.message), true);

  srv.close();
}

(async () => {
  await run();
  console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
