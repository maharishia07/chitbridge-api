#!/usr/bin/env node
// @type: unit
/**
 * rail-65-labelled-never-converted.test.cjs — RAIL-65 (cb-rail, currency governance): "An amount is LABELLED, never CONVERTED, anywhere on the rail." Written 2026-11-14 (proof pass);
 * no database. Three halves, because "anywhere" is a claim about the whole rail, not one function:
 *   1  THE VALUE TYPE (lib/money.js): a list in two currencies is REFUSED (409, names both, says "labelled, never converted"), never summed; two amounts of two currencies
 *      cannot meet (assertSameCurrency 409); times() keeps the label; a same-currency sum is exact; money.js exports no converter.
 *   2  THE DOOR (routes/chits.js sendPartCurrency, run lifted): a bill cell that names another currency than the bill's is a 409 CURRENCY_MISMATCH naming the field and BOTH
 *      codes, BEFORE anything is written — the amount is never re-expressed; a cell naming none, or the same one, passes untouched.
 *   3  THE RAIL: no code of the rail's files (routes/chits.js, routes/ctp.js, lib/mint*.js, lib/send-money.js, lib/chit*.js, lib/ctp*.js, lib/canon.js) reaches a rate table or a
 *      converter — lib/fx-rates.js (the books' own, typed-by-the-owner rate) is required by books code only.
 * HAND-COMPUTED: 10.00 INR + 5.00 USD → refused (409), never 15 and never an INR figure; 10.00 + 5.25 INR = 15.25 INR.
 * RUN       node tests/rail-65-labelled-never-converted.test.cjs     (tests/rail-sec-db-proofs.red.cjs breaks each line and shows this go red)
 * CARD      01-rail-core-the-chit/send-mint-a-chit
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('./lib-proof-mutate.cjs');
process.env.NODE_ENV = 'test';
let failed = 0;
const check = (label, ok, detail) => { if (!ok) failed++; console.log((ok ? 'ok   ' : 'FAIL ') + label + (ok ? '' : ' :: ' + detail)); };
const caught = (fn) => { try { fn(); return null; } catch (e) { return e; } };

(async () => {
  /* 1 · the value type */
  const Money = P.load('lib/money.js');
  const mixed = caught(() => Money.sum([{ amount: 10, currency: 'INR' }, { amount: 5, currency: 'USD' }]));
  check('a list in INR and USD is REFUSED, never summed', mixed && mixed.status === 409 && mixed.currencies.sort().join() === 'INR,USD', mixed ? mixed.message : 'no throw: it summed');
  check('…the refusal says why in the rail’s own words and offers the three honest ways forward', mixed && /labelled, never converted/.test(mixed.message) && mixed.options.length === 3, mixed && mixed.message);
  const same = Money.sum([{ amount: 10, currency: 'INR' }, { amount: 5.25, currency: 'INR' }]);
  check('the same currency adds exactly (10.00 + 5.25 = 15.25 INR) and keeps its label', same && same.amount === 15.25 && same.currency === 'INR', JSON.stringify(same));
  const meet = caught(() => Money.assertSameCurrency({ amount: 1, currency: 'INR' }, { amount: 1, currency: 'AED' }, 'the total'));
  check('two amounts of two currencies cannot meet (409, "labelled, never converted")', meet && meet.status === 409 && /labelled, never converted/.test(meet.message), meet && meet.message);
  const t = Money.times({ amount: 12.5, currency: 'AED' }, 3);
  check('times() multiplies by a quantity and keeps the label (37.5 AED), no rate in sight', t && t.amount === 37.5 && t.currency === 'AED', JSON.stringify(t));
  check('lib/money.js exports no converter (no convert, rate, fx or exchange function)', !Object.keys(Money).some((k) => /convert|rate|fx|exchange/i.test(k)), Object.keys(Money).join());

  /* 2 · the door */
  const chits = P.read('routes/chits.js');
  const answers = [];
  const cells = P.load('lib/currency-cells.js');
  const door = new Function('require', 'problem', 'said', P.lift(chits, 'sendPartCurrency') + '\nreturn sendPartCurrency;')(
    (id) => (/currency-cells/.test(id) ? cells : {}), (req, res, body) => { answers.push(body); return 'refused'; }, (body) => body);
  const res = { locals: {} };
  const bill = { business_json: { payment: { currency: 'USD', amount: 100 } }, line_items: [{ qty: 1, price: 100 }], currency_code: 'INR' };
  const out = await door(bill, {}, res);
  check('a payment naming USD on an INR bill is refused 409 CURRENCY_MISMATCH', out === 'refused' && answers[0].status === 409 && answers[0].code === 'CURRENCY_MISMATCH' && res.locals.code === 'CURRENCY_MISMATCH', JSON.stringify(answers));
  check('…naming the field and BOTH codes (claimed USD, governed INR), so nobody has to guess', answers[0].field === 'payment.currency' && answers[0].claimed === 'USD' && answers[0].governed === 'INR', JSON.stringify(answers[0]));
  check('…and the amount is untouched: nothing was re-expressed in INR', bill.business_json.payment.amount === 100 && bill.business_json.payment.currency === 'USD', JSON.stringify(bill.business_json));
  answers.length = 0;
  const line = await door({ business_json: {}, line_items: [{ qty: 2, price: { amount: 4, currency: 'AED' } }], currency_code: 'INR' }, {}, { locals: {} });
  check('a LINE price in AED on an INR bill is refused too (line_items[0].currency)', line === 'refused' && answers[0].field === 'line_items[0].currency', JSON.stringify(answers));
  answers.length = 0;
  const fine = await door({ business_json: { payment: { currency: 'inr', amount: 5 } }, line_items: [{ qty: 1, price: 5 }, { qty: 1, price: { amount: 5, currency: 'INR' } }], currency_code: 'INR' }, {}, { locals: {} });
  check('cells that name the bill’s own currency (any case) or none pass untouched', fine === undefined && answers.length === 0, JSON.stringify(answers));
  const steps = chits.slice(chits.indexOf('sendPartCurrency,') - 400, chits.indexOf('sendPartCurrency,') + 200).replace(/\s+/g, ' ');
  check('the check runs in the send steps (sendPartCurrency is in the list, before the write)', steps.includes('sendPartCurrency,') && chits.indexOf('  sendPartCurrency,') < chits.indexOf('  sendWrite,'), steps);

  /* 3 · the rail reaches no rate table */
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const railFiles = ['routes/chits.js', 'routes/ctp.js', 'lib/canon.js', 'lib/send-money.js'].concat(fs.readdirSync(path.join(P.ROOT, 'lib')).filter((f) => /^(mint|chit|ctp)/.test(f) && /\.js$/.test(f)).map((f) => 'lib/' + f));
  const converters = /fx-rates|fxRate|fx_rate|convertTo|convertCurrency|exchange_rate|rate_table|fx\.(rate|convert)/;
  const offenders = railFiles.filter((f) => converters.test(strip(P.read(f))));
  check('no rail file (' + railFiles.length + ' checked) requires a rate table or names a converter', offenders.length === 0, offenders.join());
  const users = fs.readdirSync(path.join(P.ROOT, 'lib')).concat(fs.readdirSync(path.join(P.ROOT, 'routes')).map((f) => 'routes/' + f)).filter((f) => /\.js$/.test(f)).filter((f) => /fx-rates/.test(strip(fs.readFileSync(path.join(P.ROOT, f.includes('/') ? f : 'lib/' + f), 'utf8'))));
  check('lib/fx-rates.js is required by the books only (not the rail)', users.length > 0 && users.every((f) => /books|forms|posting|not-migrated|fx-rates/.test(f)), users.join());

  console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL the test itself threw :: ' + e.stack); process.exit(1); });
