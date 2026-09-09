/**
 * column-home.test.cjs — A COLUMN IS ONLY REAL ON THE TABLE IT LIVES ON (2026-09-08).
 *
 * ⚠️ THE BUG THIS EXISTS FOR. `/api/till/bills` selected `line_items` FROM `chit_header` — a column that has never been on that
 * table; it lives on `chit_detail`. Postgres answered "column line_items does not exist" and the counter's Earlier-bills tab, which
 * treats any non-OK answer as "the line is down", quietly told a perfectly online shop it was offline. It shipped on 2026-09-07 and
 * was found the next day by a NEW screen making the same mistake — which is the only reason anybody looked.
 *
 * A SQL string in a template literal is not type-checked by anything, so this reads the routes as text and holds the few
 * table→column facts that have already cost us something. It is deliberately small: a guard that tries to model the whole schema
 * would rot, and a rotten guard is worse than none.
 *
 * Run: node tests/column-home.test.cjs   · no DB, no network.
 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const ROUTES = path.join(__dirname, '..', 'routes');
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

let pass = 0;
const it = (what, fn) => { try { fn(); pass++; console.log('  ok  ' + what); } catch (e) { console.log('  FAIL ' + what + '\n      ' + e.message); process.exitCode = 1; } };

/** the columns declared between one CREATE TABLE and the next */
function columnsOf(table) {
  const at = SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS ' + table);
  assert.ok(at > 0, 'no such table in schema.sql: ' + table);
  const next = SCHEMA.indexOf('CREATE TABLE', at + 10);
  const body = SCHEMA.slice(at, next < 0 ? SCHEMA.length : next);
  return body.split('\n').map((l) => (l.trim().match(/^([a-z_]+)\s+[A-Z]/) || [])[1]).filter(Boolean);
}

console.log('— where a column actually lives —');

it('line_items is on chit_detail, and NOT on chit_header', () => {
  assert.ok(columnsOf('chit_detail').indexOf('line_items') >= 0, 'chit_detail no longer declares line_items');
  assert.ok(columnsOf('chit_header').indexOf('line_items') < 0, 'chit_header now declares line_items — delete this guard, it is over');
});

/**
 * ⚠️ READ THE SELECT, NOT THE FILE. A route may mention chit_header and chit_detail in the same breath quite legitimately (a JOIN is
 * exactly that), so what is checked is a SELECT that names line_items whose FROM is chit_header with no chit_detail joined to it.
 */
it('no route selects line_items from chit_header without joining chit_detail', () => {
  const bad = [];
  for (const f of fs.readdirSync(ROUTES).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(ROUTES, f), 'utf8');
    /* every SELECT … FROM chit_header … up to the next backtick or semicolon */
    const re = /SELECT[\s\S]{0,600}?FROM\s+chit_header[\s\S]{0,600}?(?=`|;)/gi;
    let m;
    while ((m = re.exec(src))) {
      const q = m[0];
      if (!/\bline_items\b/.test(q)) continue;
      if (/JOIN\s+chit_detail/i.test(q)) continue;      /* joined properly */
      bad.push(f + ': ' + q.replace(/\s+/g, ' ').slice(0, 110));
    }
  }
  assert.deepStrictEqual(bad, [], 'line_items read off chit_header:\n      ' + bad.join('\n      '));
});

it('the counter\'s own three reads join it, rather than hoping', () => {
  const src = fs.readFileSync(path.join(ROUTES, 'till.js'), 'utf8');
  const joins = (src.match(/JOIN chit_detail d ON d\.chit_id = h\.chit_id AND d\.entity_id = h\.entity_id/g) || []).length;
  assert.ok(joins >= 4, 'expected the bills, tasks and match reads to join chit_detail; found ' + joins);
});



/**
 * ⚠️⚠️ A BILL TO YOURSELF IS STILL A BILL (2026-09-09). /api/till/bills filtered on direction = 'sent'. A counter bill is a chit
 * the shop sends to ITSELF, and a SELF chit lands with direction 'received' — which we already knew, because it is why
 * business_json.side and sideOf() exist. So the query matched nothing and "Earlier bills" answered "you have no bills" to a shop
 * that had been billing all week. It found nothing rather than erroring, which is why it went unnoticed for a day.
 * The identity of a bill is the entity, the purpose, and carrying a bill_no. Direction is a fact about the counterparty, and a
 * shop billing itself is not asking that question.
 */
it('⚠️⚠️ the bills query does not filter on direction — a SELF chit is received, not sent', () => {
  const src = fs.readFileSync(path.join(ROUTES, 'till.js'), 'utf8');
  const q = src.slice(src.indexOf("router.get('/bills'"), src.indexOf("router.get('/bills'") + 2200);
  assert.ok(q.indexOf('bill_no') > 0, 'the bills query no longer identifies a bill by its bill_no');
  assert.ok(q.indexOf("direction = 'sent'") < 0,
    "the bills query filters on direction = 'sent' again — a counter bill is sent to SELF and lands as 'received'");
});

console.log(pass + ' checks');
