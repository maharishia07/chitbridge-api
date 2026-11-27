#!/usr/bin/env node
// @type: unit
/**
 * fw2-p1-attach-1132.test.cjs — FW2-03 (cold auditor walk 27 Nov): an adviser acting for a client attaches a receipt to an entry of the CLIENT's books.
 * Before: the web sent the firm's own token alone, so POST /api/attachments looked in the FIRM's books ("No such entry in these books.") and the header was refused by the books door's fence.
 * Now: POST /api/books/evidence is a books door; an adviser under a live grant reaches it (the synthetic editor identity of the client's entity); an auditor, a reviewer, a key or a bare header never does.
 * Units only (no database, no network). Hand figures: the entry is in the client's shop CLIENT, never in the firm FIRM.
 */
'use strict';
process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
const assert = require('assert');
const dbPath = require.resolve('../db');
const seen = [], logged = [];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [], rowCount: 0 }), withEntity: async (entity, fn) => { seen.push(entity); return fn({ query: async (sql, args) => { if (/books_change_log/.test(sql)) logged.push({ sql, args }); return ({ rows: args && args[0] === CLIENT && args[1] === ENTRY ? [{ ok: 1 }] : [], rowCount: 1 }); } }); } } };
const storage = require('../lib/storage');
const Attach = require('../lib/books-evidence-attach');
const Grant = require('../middleware/books-grant');
const contract = require('../lib/books-contract');
const FIRM = '33333333-3333-4333-8333-333333333333', CLIENT = '22222222-2222-4222-8222-222222222222', ENTRY = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
/** what the books door makes of an adviser's request: the firm person as an editor of the CLIENT's books, stamped with the live grant (middleware/books-grant syntheticOf) */
const acting = (preset, level) => ({ identity: { identity_id: 'p1', identity_type: 'actor', parent_entity_id: CLIENT, access_level: level, acting_for_grant: 'g1', acting_preset: preset }, acting_for_grant: 'g1', headers: { 'x-books-for': CLIENT } });
const stored = [];
storage.putForParticipants = async (file) => { stored.push(file); return 'f1'; };
storage.hasEntryColumns = async () => true;
storage.listForEntries = async () => [];
const body = { entry_id: ENTRY, name: 'receipt.png', data_base64: PNG.toString('base64') };

(async () => {
  assert.strictEqual(Attach.mayAttach(acting('adviser', 'editor')), true, 'an adviser under a live grant may');
  assert.strictEqual(Attach.mayAttach(acting('auditor', 'commenter')), false, 'an auditor look may not');
  assert.strictEqual(Attach.mayAttach(acting('adviser', 'commenter')), false, 'a reviewer seat on an adviser grant (commenter) may not');
  assert.strictEqual(Attach.mayAttach({ identity: { identity_id: FIRM, identity_type: 'entity' }, headers: { 'x-books-for': CLIENT } }), false, 'a header alone, no grant found, is nothing');
  assert.strictEqual(Attach.mayAttach(Object.assign(acting('adviser', 'editor'), { api_key: 'k' })), false, 'a key never');
  const done = await Attach.put(acting('adviser', 'editor'), CLIENT, body);
  assert.ok(done.ok && done.ok.entry_id === ENTRY, 'the entry is found in the CLIENT books: ' + JSON.stringify(done));
  assert.strictEqual(stored.length, 1);
  assert.deepStrictEqual(stored[0].participants, [CLIENT], 'the file lands in the client books');
  const trail = logged.filter((l) => /table_name|books_change_log/.test(l.sql) && l.args[2] === 'receipt')[0];
  assert.ok(trail && trail.args[3] === ENTRY && trail.args[4] === 'attached' && /sha256/.test(trail.args[6]) && /f1/.test(trail.args[6]), 'the change log names the entry, the file and its hash');
  const grantRun = await require('../lib/reqctx').runActingFor('g1', () => Attach.put(acting('adviser', 'editor'), CLIENT, body), { name: 'Pat', firm: 'Bayside Advisers' });
  const gt = logged.filter((l) => l.args[2] === 'receipt').pop();
  assert.ok(grantRun.ok && /grant_id/.test(gt.sql) && gt.args[7] === 'g1', 'the event carries the grant id');
  assert.ok(/Pat/.test(gt.args[6]) && /Bayside Advisers/.test(gt.args[6]), 'and who and which firm');
  const lost = await Attach.put(acting('adviser', 'editor'), FIRM, body);
  assert.ok(lost.refuse && lost.refuse.status === 404, 'in the firm own books the same entry is "No such entry" (the old dead end)');
  assert.ok(Grant.adviserDoor('POST', '/api/books/evidence'), 'the books door lists the receipt door for an adviser grant');
  assert.ok(contract.ROUTES['POST /evidence'] && contract.ROUTES['POST /evidence'].gates.includes('editor') && contract.ROUTES['POST /evidence'].gates.includes('noKey'), 'the route is in the books contract with its seat gates');
  console.log('fw2-p1-attach-1132: ok · 14 checks (guards-run counts the last "<n> checks" line; without it the gate reads 0 and fails)');
})().catch((e) => { console.log(e.stack || e); process.exit(1); });
