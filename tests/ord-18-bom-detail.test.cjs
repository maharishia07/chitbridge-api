#!/usr/bin/env node
/**
 * ord-18-bom-detail.test.cjs — ORD-18 (proof 2026-11-14): an order stays ONE line and a product's components ride on it as detail.
 * @type regression
 * OWNS      the proof on the real lib/tax-lines.decorate: a catalogue product made of Bun x2 + Patty (no qty = 1) + a junk component with no item,
 *           sold as one line, comes back as ONE line (count 1, quantity untouched) carrying bom [{Bun,2},{Patty,1}] (the junk component is dropped, the item
 *           names are text); a line that already carries its own bom keeps it; a product with no components adds no bom key value.
 * CALLED BY scripts/guards.cjs · CI. No database, no network: a pure function over a hand-made shelf.
 * FLOW      shelf (item_data.bom) + order line -> decorate -> the line as sent
 *   node tests/ord-18-bom-detail.test.cjs
 */
'use strict';
const path = require('path');
const { API, ok, done } = require('./lib/cat-proof-kit.cjs');
const { decorate } = require(path.join(API, 'lib', 'tax-lines.js'));

const shelf = { items: [
  { item_id: 'i-burger', item_data: { name: 'Burger', gst_rate: 5, bom: [{ item: 'Bun', qty: 2 }, { item: 'Patty' }, { qty: 3 }] } },
  { item_id: 'i-tea', item_data: { name: 'Tea', gst_rate: 5 } }
] };

const sent = decorate([{ item_id: 'i-burger', name: 'Burger', quantity: 3 }], shelf);
ok('one order line in, one line out (the components do not become lines)', sent.length === 1, JSON.stringify(sent));
ok('the ordered quantity is untouched (3)', sent[0].quantity === 3, JSON.stringify(sent[0]));
ok('the components ride on the line: Bun x2, Patty x1 (a missing qty is 1)', JSON.stringify(sent[0].bom) === JSON.stringify([{ item: 'Bun', qty: 2 }, { item: 'Patty', qty: 1 }]), JSON.stringify(sent[0].bom));
ok('a component with no item is dropped, not carried', sent[0].bom.length === 2, JSON.stringify(sent[0].bom));
ok('the line is still rated by the shelf (gst_rate 5)', sent[0].gst_rate === 5, JSON.stringify(sent[0]));

const own = decorate([{ item_id: 'i-burger', quantity: 1, bom: [{ item: 'Special bun', qty: 1 }] }], shelf);
ok('a line that already carries its own components keeps them (frozen at send)', JSON.stringify(own[0].bom) === JSON.stringify([{ item: 'Special bun', qty: 1 }]), JSON.stringify(own[0].bom));

const plain = decorate([{ item_id: 'i-tea', quantity: 2 }], shelf);
ok('a product with no components carries no bom', plain[0].bom === undefined, JSON.stringify(plain[0]));
done();
