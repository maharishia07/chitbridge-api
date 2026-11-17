#!/usr/bin/env node
/**
 * sec127-dispute-reads.test.cjs — SEC-127: every dispute READ names the caller's shop in its own SQL, not only through row security.
 *
 * OWNS      the offline proof that, on a connection that does NOT apply row security, shop B (a holder of the chit, not on shop A's dispute) gets
 *           none of shop A's disputes: GET /chits/:id/disputes (empty), the evidence read (none), resolve (404), the dispute-message party check (403),
 *           the open-dispute count that guards archive/delete (lib/dispute-may openOn), and the dispute counts on the chit list SQL.
 *           The stand-in db holds disputes of two shops and cuts rows to a shop ONLY when the SQL names an entity predicate.
 * CALLED BY scripts/guards.cjs. Twin of tests/sec105-dispute-queue.test.cjs (the queue); the real T2 twin is the S41 suite.
 * FLOW      stand-in sign-in + db (tests/lib/problem-world.cjs) → the real routes/chits.js over http → ask as shop B and as shop A → compare
 * CARD      28-platform-and-operations/api-standard
 *
 *   node tests/sec127-dispute-reads.test.cjs
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { harness, SHOP } = require('./lib/problem-world.cjs');

const HERE = path.join(__dirname, '..');
const CF = require('../tools/chits-files.cjs'); /* the ONE list of chits files (tools/chits-files.cjs) */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = '';

const SHOP_A = SHOP;
const SHOP_B = '66666666-6666-4666-8666-666666666666';
const WHO_A = { identity_id: SHOP_A, identity_type: 'entity', display_name: 'Shop A' };
const WHO_B = { identity_id: SHOP_B, identity_type: 'entity', display_name: 'Shop B' };
const CHIT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DISP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** shop A's copy of one open dispute on a chit both shops hold */
const ALL = [{ dispute_id: DISP, chit_id: CHIT, entity_id: SHOP_A, raised_by_entity_id: SHOP_A, status: 'open', category: 'x', reason: 'r', scope: 'targeted', created_at: '2026-10-01' }];

/** shop A's copy of one dispute message on the same chit (both shops hold the chit; only A is on the dispute) */
const MESSAGES = [{ message_id: 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm', chit_id: CHIT, entity_id: SHOP_A, is_dispute: true, dispute_id: DISP, thread_type: 'external', message_text: 'A-only dispute words', created_at: '2026-10-02' }];

const lab = harness({ here: HERE, mounts: ['/api/chits'], routeFiles: { '/api/chits': 'routes/chits.js' } });
const { check } = lab;
const seen = [];

/** the db with row security OFF: a chit_disputes / chit_header read is cut to a shop only when the SQL names `entity_id = $n` and that $n is the caller */
function modelWithoutRls(sql, params) {
  const asked = String(sql);
  const named = /entity_id\s*=\s*\$(\d)/.exec(asked.replace(/raised_by_entity_id/g, ''));
  const mine = (row) => (named ? row.entity_id === params[Number(named[1]) - 1] : true);
  if (/FROM chit_status WHERE chit_id = \$1 AND entity_id = \$2/.test(asked)) return { rows: [{ entity_id: params[1] }], rowCount: 1 }; /* both shops hold the chit */
  if (/FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/.test(asked)) return { rows: [{ all_recipients: [] }], rowCount: 1 };
  if (/FROM chit_messages WHERE chit_id/.test(asked)) {
    seen.push(asked);
    const rows = MESSAGES.filter(mine);
    return { rows, rowCount: rows.length };
  }
  if (/FROM chit_disputes/.test(asked) && !/count\(\*\)|COUNT\(\*\)/.test(asked)) {
    seen.push(asked);
    const rows = ALL.filter(mine);
    return { rows, rowCount: rows.length };
  }
  return null;
}

async function ask(port, who, method, url, body) {
  Object.assign(lab.world, { who, sqlRows: modelWithoutRls, db: 'ok' });
  return lab.send(port, method, url, body);
}

async function openCountCase() {
  const disputeMay = require(path.join(HERE, 'lib', 'dispute-may.js'));
  /* the harness's trySavepoint runs the statement on its own client, which answers from world.sqlRows */
  lab.world.sqlRows = (sql, params) => (/COUNT/.test(sql) ? { rows: [{ count: String(ALL.filter((row) => (/entity_id = \$2/.test(sql) ? row.entity_id === params[1] : true) && row.chit_id === params[0] && row.status === 'open').length) }], rowCount: 1 } : null);
  const db = {};
  check('open count: shop A holds 1 open on the chit', (await disputeMay.openOn(db, CHIT, SHOP_A)) === 1);
  const gotB = await disputeMay.openOn(db, CHIT, SHOP_B);
  check('open count: shop B (no copy of the dispute) counts 0, not shop A 1 (got ' + gotB + ')', gotB === 0);
  check('open count: no caller named = unreadable (null), never none', (await disputeMay.openOn(db, CHIT)) === null);
}

function listSqlCase() {
  const text = CF.read(HERE) + fs.readFileSync(path.join(HERE, 'lib', 'select.js'), 'utf8');
  const bare = text.match(/FROM chit_disputes cd\s+WHERE cd\.chit_id = (ch|cs)\.chit_id AND cd\.status/g) || [];
  check('chit-list dispute counts/filters: none left without cd.entity_id (' + bare.length + ' bare)', bare.length === 0, bare.join(' | '));
  const bareMsg = text.match(/FROM chit_messages cm2?\s+WHERE cm2?\.chit_id = ch\.chit_id AND cm2?\.visibility/g) || [];
  check('chit-list message count/last-message: none left without cm.entity_id (' + bareMsg.length + ' bare)', bareMsg.length === 0, bareMsg.join(' | '));
  check('chit-list SQL names cd.entity_id in the counts', (text.match(/cd\.entity_id = (ch|cs)\.entity_id/g) || []).length >= 8);
}

async function main() {
  lab.installStubs();
  const chits = require(path.join(HERE, 'routes', 'chits.js'));
  const server = lab.appOf([{ mount: '/api/chits', router: chits }]).listen(0);
  const port = server.address().port;

  const getB = await ask(port, WHO_B, 'GET', '/api/chits/' + CHIT + '/disputes');
  check('GET disputes as shop B: answered (' + getB.status + ')', getB.status === 200, getB.text.slice(0, 200));
  check("GET disputes as shop B: none of shop A's disputes", getB.json && (getB.json.disputes || []).length === 0, getB.text.slice(0, 300));
  const getA = await ask(port, WHO_A, 'GET', '/api/chits/' + CHIT + '/disputes');
  check('GET disputes as shop A: its one dispute', getA.json && (getA.json.disputes || []).length === 1, getA.text.slice(0, 300));

  /* SEC-127c: the thread read, with and without ?dispute=1, names the caller's shop in its own SQL */
  for (const q of ['?dispute=1', '', '?thread_type=external']) {
    const thrB = await ask(port, WHO_B, 'GET', '/api/chits/' + CHIT + '/messages' + q);
    check('GET messages' + q + ' as shop B: none of the dispute message of shop A (' + thrB.status + ')', thrB.status === 200 && !/A-only/.test(thrB.text) && (thrB.json.messages || []).length === 0, thrB.text.slice(0, 200));
  }
  const thrA = await ask(port, WHO_A, 'GET', '/api/chits/' + CHIT + '/messages?dispute=1');
  check('GET messages?dispute=1 as shop A: its one dispute message', thrA.json && (thrA.json.messages || []).length === 1, thrA.text.slice(0, 200));

  const evB = await ask(port, WHO_B, 'GET', '/api/chits/' + CHIT + '/diagnosis');
  const evText = evB.text;
  check("evidence/diagnosis read as shop B holds none of shop A's rows", !/dddddddd/.test(evText), evText.slice(0, 200));

  const resB = await ask(port, WHO_B, 'PUT', '/api/chits/' + CHIT + '/disputes/' + DISP + '/resolve', { resolution_note: 'done' });
  check('resolve as shop B: 404 on shop A\'s dispute (it answered ' + resB.status + ')', resB.status === 404, resB.text.slice(0, 200));

  /* the dispute-message party check, through the real POST /messages route */
  const msg = { message_text: 'hello', thread_type: 'external', is_dispute: true, dispute_id: DISP };
  const msgB = await ask(port, WHO_B, 'POST', '/api/chits/' + CHIT + '/messages', msg);
  check('dispute message as shop B (holds the chit, not a party): 403 Not a party (it answered ' + msgB.status + ')', msgB.status === 403 && /Not a party/.test(msgB.text), msgB.text.slice(0, 200));
  const msgA = await ask(port, WHO_A, 'POST', '/api/chits/' + CHIT + '/messages', msg);
  check('dispute message as shop A (a party): passes the party check (it answered ' + msgA.status + ')', !/Not a party/.test(msgA.text), msgA.text.slice(0, 200));

  await openCountCase();
  listSqlCase();
  server.close();
  console.log('\n  ' + (lab.count.passed + lab.count.failed) + ' checks, ' + lab.count.failed + ' failed');
  process.exit(lab.count.failed ? 1 : 0);
}

main().catch((failure) => {
  console.log('sec127-dispute-reads crashed:', failure);
  process.exit(1);
});
