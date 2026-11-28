#!/usr/bin/env node
// @type: unit
/**
 * sec-117-auditor-source-chit.test.cjs — P1-3 (28 Nov 2026): a books READ grant (X-Books-For) reads the SOURCE DOCUMENT of an entry of the granted books, and nothing else.
 * OWNS the proof of books-evidence.isSourceOf / sourceView / sourceOfSql, the evidence path in middleware/books-grant.js, and the grant branch of routes/chits.js GET /:chit_id (the route guard is a source scan with its own mutation).
 * CALLED BY CI. No database, no network. CARD 04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'test'; process.env.DATABASE_URL = ''; process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const ev = require('../lib/books-evidence');
const { refuseElsewhere } = require('../middleware/books-grant');

const SHOP = '11111111-1111-4111-8111-111111111111', LINKED = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
/** a fake handle that holds ONE entry: SHOP's, with LINKED as its source: it answers the shared SQL's parameters the way the database would */
const fake = (log) => ({ query: async (sql, params) => { log.push({ sql, params }); assert.ok(/j\.entity_id = \$1/.test(sql), 'the entity is asked in the SQL itself'); return { rows: [{ linked: params[0] === SHOP && params[1] === LINKED }] }; } });

(async () => {
  const log = [];
  assert.strictEqual(await ev.isSourceOf(fake(log), SHOP, LINKED), true, 'a chit linked to an entry of the shop is readable');
  assert.strictEqual(await ev.isSourceOf(fake(log), SHOP, OTHER), false, 'a chit of no entry is refused');
  assert.strictEqual(await ev.isSourceOf(fake(log), OTHER, LINKED), false, "another shop's books never vouch for it");
  const before = log.length;
  for (const bad of ['', null, undefined, 'x', LINKED + "' OR 1=1", '../' + LINKED]) assert.strictEqual(await ev.isSourceOf(fake(log), SHOP, bad), false, 'not a uuid: ' + bad);
  assert.strictEqual(await ev.isSourceOf(fake(log), '', LINKED), false, 'no entity');
  assert.strictEqual(log.length, before, 'a non-uuid or empty input never reaches the database');
  assert.ok(/source_chit_ids/.test(ev.sourceOfSql('$1', '$2')) && /source_chit_id =/.test(ev.sourceOfSql('$1', '$2')), "both the entry source and a day's source list");

  /* the answer is an ALLOW-LIST: a hostile key and a hostile header column never appear; who else holds the chit, the internal history and the actions go */
  const full = { header: { chit_id: LINKED, all_recipients: [{ email: 'a@example.com' }], created_by_actor_id: 'x', hostile_column: 'secret', business_json: { kind: 'invoice' } }, detail: { line_items: [] }, participants: [{ display_name: 'P' }], state_log: [{ detail: 'internal note' }], line_assignment: { a: 1 }, books_wait: { why: 'x' }, actions: { accept: { ok: true } }, attachments: [], hostile_top: 1, _timing: {} };
  const cut = ev.sourceView(full);
  for (const gone of ['participants', 'state_log', 'line_assignment', 'books_wait', 'hostile_top', '_timing']) assert.strictEqual(cut[gone], undefined, gone + ' is cut');
  assert.deepStrictEqual(cut.actions, {}, 'no action is offered');
  assert.strictEqual(cut.read_only, true);
  assert.deepStrictEqual(Object.keys(cut.header).sort(), ['business_json', 'chit_id'], 'header: only the allow-list');
  assert.ok(cut.detail && cut.attachments, 'the document and its file list stay');

  /* the fence: the uuid path passes for a GET, every other method is refused read-only, a static sibling stays closed */
  const run = (p, method) => {
    const out = { next: false, status: null, body: null };
    const res = { statusCode: 200, status(c) { out.status = c; return this; }, setHeader() {}, set() { return this; }, type() { return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; } };
    refuseElsewhere({ path: p, headers: { 'x-books-for': 'S' }, id: 'r1', method: method || 'GET', originalUrl: p, baseUrl: '', get() { return undefined; } }, res, () => { out.next = true; });
    return out;
  };
  assert.strictEqual(run('/api/chits/' + LINKED).next, true, 'GET on a chit uuid reaches the route (which asks isSourceOf)');
  assert.strictEqual(run('/api/chits/' + LINKED + '/').next, true, 'trailing slash too');
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) { const o = run('/api/chits/' + LINKED, m); assert.strictEqual(o.next, false, m + ' refused'); assert.ok(JSON.stringify(o.body).includes('BOOKS_FOR_READ_ONLY'), m + ' says read only: ' + JSON.stringify(o.body)); }
  for (const p of ['/api/chits', '/api/chits/drafts', '/api/chits/holds', '/api/chits/my-work', '/api/chits/unread', '/api/chits/' + LINKED + '/costs', '/api/chits/' + LINKED + '/status', '/api/chits/' + LINKED + '/reprice']) { const o = run(p, 'GET'); assert.strictEqual(o.next, false, p + ' stays closed'); assert.ok(JSON.stringify(o.body).includes('BOOKS_FOR_NOT_HERE'), p); }

  /* the route guard: ONE check that reads the source of routes/chits.js; each mutation below must make it fail */
  const text = fs.readFileSync(path.join(__dirname, '..', 'routes', 'chits.js'), 'utf8');
  function routeGuard(src) {
    const at = src.indexOf("router.get('/:chit_id', ");
    assert.ok(at > 0, 'the route');
    const body = src.slice(at, src.indexOf("router.post('/:chit_id/reprice'", at));
    assert.ok(/^router\.get\('\/:chit_id', require\('\.\.\/middleware\/books-grant'\), auth,/.test(body), 'the grant front is in front of auth');
    assert.ok(/if \(granted && !\(await withEntity\(entity_id, \(db\) => require\('\.\.\/lib\/books-evidence'\)\.isSourceOf\(db, entity_id, chit_id\)\)\)\) return problem\(req, res, \{ status: 404/.test(body), 'the link check refuses with the 404');
    assert.ok(body.indexOf('isSourceOf(') < body.indexOf('FROM chit_header'), 'before the first read of the chit');
    assert.ok(/if \(!granted\) await db\.query\(\s*`WITH prev AS/.test(body), 'the first-opened write is skipped under a grant');
    assert.ok(/identity_type === 'actor' && !granted/.test(body), 'the mark-read write is skipped under a grant');
    assert.ok(body.includes("${granted ? \"'[]'::json\"") && body.includes('granted ? [] : await trySavepoint(db, (c) => c.query(`SELECT * FROM chit_participants'), 'the cross-entity participants function is never called under a grant');
    assert.ok(/answerOf\(costView\.chitAnswer\(/.test(body), 'the answer is cut last');
  }
  routeGuard(text);
  assert.throws(() => routeGuard(text.replace('isSourceOf(db, entity_id, chit_id)', 'true || 0')), 'MUTATION: dropping the link check goes red');
  assert.throws(() => routeGuard(text.replace("identity_type === 'actor' && !granted", "identity_type === 'actor'")), 'MUTATION: letting a grant write mark-read goes red');
  assert.throws(() => routeGuard(text.replace('granted ? [] : await trySavepoint(db, (c) => c.query(`SELECT * FROM chit_participants', 'await trySavepoint(db, (c) => c.query(`SELECT * FROM chit_participants')), 'MUTATION: calling the participants function goes red');
  const evText = fs.readFileSync(path.join(__dirname, '..', 'lib', 'books-evidence.js'), 'utf8');
  assert.ok((evText.match(/FROM journal_entry j WHERE j\.entity_id = \$\{entityParam\}/g) || []).length === 1 && evText.includes("sourceOfSql('$2', 'a.chit_id')") && evText.includes("sourceOfSql('$1', '$2::uuid')"), 'ONE entry-to-chit SQL, read by isEvidence and isSourceOf');
  console.log('sec-117-auditor-source-chit: ok');
})().catch((e) => { console.error(e); process.exit(1); });
