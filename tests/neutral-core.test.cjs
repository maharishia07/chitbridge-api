/**
 * neutral-core.test.cjs — NEUTRAL CORE (2026-10-17): a record states its own country, currency, zone; a reader that finds none says so.
 * N0: a shop with no country or no money issues no document (documentGate — NO_COUNTRY / NO_MONEY, one sentence); an India shop is unchanged.
 * Run: node tests/neutral-core.test.cjs   (no database, no network)
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const CS = require(path.join(API, 'lib/country-setup'));
const readOf = (row) => async () => ({ rows: row ? [row] : [] });

(async () => {
  const none = await CS.documentGate(readOf({ country: null, currency_code: 'INR' }), 'e1');
  ok('no country → refused 422 NO_COUNTRY with the one sentence', none && none.status === 422 && none.code === 'NO_COUNTRY' && none.message === CS.DOC_UNSTATED);
  const blank = await CS.documentGate(readOf({ country: '  ', currency_code: 'INR' }), 'e1');
  ok('a blank country is no country', blank && blank.code === 'NO_COUNTRY');
  const nomoney = await CS.documentGate(readOf({ country: 'ZZ', currency_code: null }), 'e1');
  ok('a country with no pack and no currency → NO_MONEY', nomoney && nomoney.code === 'NO_MONEY' && nomoney.message === CS.DOC_UNSTATED);
  ok('India with its own currency passes unchanged', (await CS.documentGate(readOf({ country: 'IN', currency_code: 'INR' }), 'e1')) === null);
  ok('India with no stored currency passes on the pack\u2019s own money (an India shop is unchanged)', (await CS.documentGate(readOf({ country: 'IN', currency_code: null }), 'e1')) === null);
  ok('Australia passes', (await CS.documentGate(readOf({ country: 'AU', currency_code: 'AUD' }), 'e1')) === null);
  ok('a read that throws leaves the gate open (a blip is no evidence)', (await CS.documentGate(async () => { throw new Error('db down'); }, 'e1')) === null);
  ok('the sentence says where to set it', /Country setup/.test(CS.DOC_UNSTATED));
  const kept = CS.clean({ country: 'IN', currency: 'INR', fy_start_month: 4, tax: { registered: false }, source: { country: 'backfill b299 (today’s facts)', currency: 'typed' } });
  ok('saving an assumed (b299) country is the one-tap confirm: its source stops saying backfill', kept.source.country === 'confirmed by the owner' && kept.source.currency === 'typed');
  const src = require('fs').readFileSync(path.join(API, 'routes/chits.js'), 'utf8');
  ok('the send route asks the gate right after the sender is known, and lets a draft through', /sendSender, sendMoneyStated,/.test(src) && /if \(req\.body\.is_draft\) return false;\s*\n\s*const refusal/.test(src));
  console.log('\n' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
