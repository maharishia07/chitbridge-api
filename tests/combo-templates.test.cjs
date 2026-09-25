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
  /** in-memory stand-in for the real table — enough SQL pattern-matching to prove the route's own logic,
   *  not a second implementation of Postgres. */
  let ROWS = [], seq = 1;
  require.cache[require.resolve(API + '/middleware/auth')] = {
    exports: Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
      entityOf: (req) => (req.identity && (req.identity.parent_entity_id || req.identity.identity_id)) || null,
    }),
  };
  require.cache[require.resolve(API + '/db')] = {
    exports: {
      withEntity: async (entity_id, fn) => fn({
        query: async (text, params) => {
          const q = text.replace(/\s+/g, ' ').trim();
          if (q.startsWith('SELECT id, name, definition, created_at, updated_at FROM combo_templates WHERE entity_id=$1')) {
            return { rows: ROWS.filter((r) => r.entity_id === params[0]).sort((a, b) => b.seq - a.seq) };
          }
          if (q.startsWith('INSERT INTO combo_templates')) {
            const [eid, name, def] = params;
            const row = { id: 'ct' + (seq), seq: seq++, entity_id: eid, name, definition: JSON.parse(def), created_at: 'now', updated_at: 'now' };
            ROWS.push(row);
            return { rows: [row] };
          }
          if (q.startsWith('SELECT name, definition FROM combo_templates WHERE id=$1 AND entity_id=$2')) {
            const row = ROWS.find((r) => r.id === params[0] && r.entity_id === params[1]);
            return { rows: row ? [{ name: row.name, definition: row.definition }] : [] };
          }
          if (q.startsWith('UPDATE combo_templates SET name=$1, definition=$2')) {
            const [name, def, id, eid] = params;
            const row = ROWS.find((r) => r.id === id && r.entity_id === eid);
            if (!row) return { rows: [] };
            row.name = name; row.definition = JSON.parse(def); row.updated_at = 'later';
            return { rows: [row] };
          }
          if (q.startsWith('DELETE FROM combo_templates WHERE id=$1 AND entity_id=$2')) {
            const i = ROWS.findIndex((r) => r.id === params[0] && r.entity_id === params[1]);
            if (i < 0) return { rows: [] };
            const [row] = ROWS.splice(i, 1);
            return { rows: [{ id: row.id }] };
          }
          throw new Error('unstubbed query in combo-templates.test.cjs: ' + q);
        },
      }),
    },
  };

  delete require.cache[require.resolve(API + '/routes/combo-templates')];
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

  srv.close();
}

(async () => {
  await run();
  console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
