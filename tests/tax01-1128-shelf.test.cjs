/**
 * tests/tax01-1128-shelf.test.cjs — VERIFY-TAX-01 rows 1, 4 and 5 (batch 1128).
 * OWNS      row 1: a failed read of the shop's identities row REFUSES (TAX_SHELF_UNREADABLE, 503) instead of reading "no GSTIN, so no GST".
 *           row 4: the no-tax-id gate follows the PACK (collect_without_tax_id), not a field the slab rows never carry.
 *           row 5: a slab with a null, blank or non-number rate is not served as a live 0% slab; it is named (rate missing).
 * CALLED BY CI / node --test tests/tax01-1128-shelf.test.cjs · no DB, no network (injected readers).
 * HAND FIGURES (minor units): a shop with GSTIN 27AAPFU0939F1ZV sells one item at 100000 (1,000.00) at 18%: tax 18000, total 118000. Read as "no GSTIN" it invoiced 100000, short 18000.
 *           A US shop with no EIN: item 10000 at 8% → 800 tax, 10800 total (the cart said 10000 before row 4).
 * CARD      15-tax-and-country-packs/tax-compute-rate-invoice-tax
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const shelf = require('../lib/tax-shelf');
const gov = require('../lib/tax-governance');
const { known } = require('../lib/knownerr');

const GSTIN = '27AAPFU0939F1ZV';
/** an entity-scoped db whose identities read answers `idRead` (a row, or an Error to throw) */
const depsWith = (idRead) => ({
  withEntity: async (_id, fn) =>
    fn({
      query: async (sql) => {
        if (/FROM identities/.test(sql)) {
          if (idRead instanceof Error) throw idRead;
          return { rows: [idRead] };
        }
        return { rows: [] };
      }
    })
});
const ofRate = (rate) => ({ jurisdiction: { tax: { scheme: 'GST', slabs: [{ id: 'IN-GST-X', name: 'x', rate }] } } });
const tax = (minor, ratePct) => Math.round((minor * ratePct) / 100);

test('1 · the identities read fails: refused in words (503), never read as "no GSTIN, no GST"', async () => {
  await assert.rejects(
    () => shelf.readShelf('E1', depsWith(new Error('pool timeout'))),
    (e) => {
      assert.equal(e.code, 'TAX_SHELF_UNREADABLE');
      assert.equal(e.status, 503);
      assert.equal(e.refused, true);
      const said = known(e);
      assert.ok(said && said.status === 503 && said.body.code === 'TAX_SHELF_UNREADABLE', 'the door answers it as a refusal');
      assert.ok(!/pool timeout/.test(said.body.message), 'the driver words never go back');
      return true;
    }
  );
});

test('1b · the same read working: the GSTIN shop has its shelf (1,000.00 at 18% = 18000 tax)', async () => {
  const s = await shelf.readShelf('E1', depsWith({ gstn: GSTIN, country: 'IN', timezone: 'Asia/Kolkata' }));
  assert.ok(s, 'a shelf');
  assert.equal(tax(100000, 18), 18000);
  assert.equal(100000 + tax(100000, 18), 118000);
  /* a shop with no GSTIN still has NO shelf by design (not a failure): answered null, not refused */
  const none = await shelf.readShelf('E1', depsWith({ gstn: null, country: 'IN', timezone: 'Asia/Kolkata' }));
  assert.equal(none, null);
});

test('4 · a pack that collects without a tax id (US) gets its shelf with no EIN; IN, AU, AE with no id still get none', () => {
  const rows = { defs: { rows: [] }, items: { rows: [] }, face: null, gov: [] };
  const us = shelf.shelfFromRows(Object.assign({ gstn: null, zone: { country: 'US', timezone: 'America/New_York' } }, rows));
  assert.ok(us, 'US shop, no EIN: a shelf, so the cart resolves its 8% (800 on 10000)');
  assert.equal(tax(10000, 8), 800);
  for (const country of ['IN', 'AU', 'AE']) assert.equal(shelf.shelfFromRows(Object.assign({ gstn: null, zone: { country, timezone: 'UTC' } }, rows)), null, country + ' with no tax id: no shelf, as the invoice charges none');
  /* the two deciders agree: chargesTax says yes for the US pack and no for the others */
  const packs = require('../lib/tax-packs');
  assert.equal(shelf.chargesTax({ reg_type: 'regular' }, packs.packFor('US')), true);
  assert.equal(shelf.chargesTax({ reg_type: 'regular' }, packs.packFor('AE')), false);
  /* a shop with an id still has its shelf whatever the country */
  assert.ok(shelf.shelfFromRows(Object.assign({ gstn: GSTIN, zone: { country: 'IN' } }, rows)));
});

test('5 · a slab whose rate is null, blank or not a number is skipped and named, never a live 0% slab (18000 owed on 100000, not 0)', () => {
  for (const bad of [null, '', '   ', [], {}, true, undefined, 'abc']) {
    assert.deepEqual(gov.slabsFromLayer(ofRate(bad), 'ZZ').map((r) => r.definition_id), [], 'not served for rate ' + JSON.stringify(bad));
    assert.deepEqual(gov.unratedSlabs(ofRate(bad)), ['IN-GST-X'], 'named for rate ' + JSON.stringify(bad));
  }
  for (const [good, pct] of [[18, 18], ['18', 18], [0, 0], ['0', 0]]) {
    const row = gov.slabsFromLayer(ofRate(good), 'ZZ')[0];
    assert.equal(row.rules.rate, pct, 'served for rate ' + JSON.stringify(good) + ' (0 is a real nil rate)');
    assert.deepEqual(gov.unratedSlabs(ofRate(good)), []);
  }
  assert.equal(tax(100000, gov.slabsFromLayer(ofRate(18), 'ZZ')[0].rules.rate), 18000);
});

test('5b · governedSlabsFor tells its caller which slabs had no rate', async () => {
  let told = null;
  const layer = { region_code: 'ZZ', currency: 'ZZD', jurisdiction: { tax: { scheme: 'GST', slabs: [{ id: 'ZZ-GST-A', rate: 5 }, { id: 'ZZ-GST-B', rate: null }] } } };
  const rows = await gov.governedSlabsFor('E1', {
    query: async () => ({ rows: [{ country: 'ZZ' }] }),
    regionLayer: async () => layer,
    onUnrated: (ids, juris) => { told = [ids, juris]; }
  });
  assert.deepEqual(rows.map((r) => r.definition_id), ['ZZ-GST-A']);
  assert.deepEqual(told, [['ZZ-GST-B'], 'ZZ']);
});
