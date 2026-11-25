/**
 * tests/policy-stock.test.cjs — lib/policy-stock.js: the shop's "selling below zero" switch (OPS-121): the FLAGS row negative_stock and its CARD row.
 * OWNS      the proof that the flag is an enum of two ways with 'allow' (practice: allow and flag) as the default, that the owner-only words are the ones passed in (never restated here),
 *           that the CARD row names both ways in the shopkeeper's words and refuses nothing silently (a way with no label would show a bare key).
 * CALLED BY scripts/guards.cjs · CI. No database, no network.
 * FLOW      flagsFor(owner) → { negative_stock } ; CARD.negative_stock → label · labels · help
 * CARD      13-inventory-stock-and-traceability/on-hand-and-movements
 * MIN unit-per-rule · MIN refusal-path · MIN fail-closed
 */
'use strict';
const assert = require('assert');
const { flagsFor, CARD } = require('../lib/policy-stock');
let checks = 0;
const ok = (name, got, want) => { assert.deepStrictEqual(got, want, name); checks++; console.log('   ok   ' + name); };
const flags = flagsFor({ owner_only: true, why: 'Only the owner can change this' });
ok('the flag is an enum of exactly two ways', [flags.negative_stock.type, flags.negative_stock.options], ['enum', ['allow', 'block']]);
ok('the default is allow and flag (practice: a switch with the common way as default)', flags.negative_stock.def, 'allow');
ok('the owner-only words are the ones passed in, never restated here', [flags.negative_stock.owner_only, flags.negative_stock.why], [true, 'Only the owner can change this']);
ok('no owner words passed: none invented (fail closed to the caller\'s own default)', Object.keys(flagsFor({}).negative_stock).sort(), ['def', 'options', 'type']);
ok('the card names both ways in words, never a bare key', [CARD.negative_stock.labels.allow, CARD.negative_stock.labels.block], ['Allow and flag', 'Refuse the sale']);
ok('every option has a label (a way with none would show its key)', flags.negative_stock.options.every((way) => !!CARD.negative_stock.labels[way]), true);
ok('the card is the entity level and says what each way does', [CARD.negative_stock.level, CARD.negative_stock.gov, /Refuse the sale/.test(CARD.negative_stock.help)], ['entity', 'entity', true]);
console.log('\n' + checks + ' checks');
