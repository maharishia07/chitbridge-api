'use strict';
// @type: unit
/**
 * tests/boilerplate-source.test.cjs - the sealed mould and its sources (lib/boilerplate.js, lib/source.js), over a scripted stand-in for ../db.
 *
 * OWNS      the proof of resolveBoilerplate (newest ACTIVE row, the version asked for, declared sources folded into brand + standards by facet, the bound
 *           locale laid over region_layer, tables absent -> null), entityBoilerplateKey, and the source-entity calls (registerSource refuses no key,
 *           is idempotent by key, renames in one field; resolveSourceEntity answers null on a failed read).
 * CALLED BY scripts/guards.cjs (offline; the db module is replaced before the libs load, nothing reaches a network).
 * CARD      docs/20-settings-governance-and-plan/functions/boilerplate-and-sources.md
 */
const assert = require('assert');
const dbPath = require.resolve('../db');
let script = [], calls = [];
const next = (sql, p) => { calls.push({ sql, p }); const r = script.shift(); if (r instanceof Error) throw r; return r || { rows: [] }; };
const fake = { query: async (sql, p) => next(sql, p), withEntity: async (_id, fn) => fn({ query: async (sql, p) => next(sql, p) }), withTransaction: async (fn) => fn({ query: async (sql, p) => next(sql, p) }) };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake };
const BP = require('../lib/boilerplate'), SRC = require('../lib/source');
let pass = 0, fail = 0;
const t = async (name, fn) => { script = []; calls = []; try { await fn(); console.log('  PASS  ' + name); pass++; } catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); fail++; } };

(async () => {
  await t('resolveBoilerplate: no key -> null and nothing is read', async () => { assert.strictEqual(await BP.resolveBoilerplate(''), null); assert.strictEqual(calls.length, 0); });
  await t('resolveBoilerplate: no active row -> null (one read only)', async () => { script = [{ rows: [] }]; assert.strictEqual(await BP.resolveBoilerplate('cb-in'), null); assert.strictEqual(calls.length, 1); });
  await t('a version is asked for with the second parameter, newest first otherwise', async () => {
    script = [{ rows: [] }]; await BP.resolveBoilerplate('cb-in', 'v2'); assert.deepStrictEqual(calls[0].p, ['cb-in', 'v2']); assert.ok(/AND version = \$2/.test(calls[0].sql));
    script = [{ rows: [] }]; calls = []; await BP.resolveBoilerplate('cb-in'); assert.deepStrictEqual(calls[0].p, ['cb-in']); assert.ok(/ORDER BY minted_at DESC LIMIT 1/.test(calls[0].sql));
  });
  await t('declared sources fold: a brand source is the brand, a facet source is a standard, a key without @ gets @v1', async () => {
    script = [
      { rows: [{ boilerplate_key: 'cb-in', version: 'v3', label: 'India retail', region_code: 'IN', locale: { currency: 'INR' } }] },
      { rows: [{ source_key: 'acme-brand', source_kind: 'brand', facet: null }, { source_key: 'gst-rates@v7', source_kind: 'standard', facet: 'tax' }, { source_key: 'uom', source_kind: 'standard', facet: 'units' }] },
      { rows: [{ currency: 'USD', units: 'metric', language: 'en', jurisdiction: 'IN-GST' }] }
    ];
    const r = await BP.resolveBoilerplate('cb-in');
    assert.strictEqual(r.brand, 'acme-brand@v1'); assert.deepStrictEqual(r.standards, { tax: 'gst-rates@v7', units: 'uom@v1' });
    assert.strictEqual(r.version, 'v3'); assert.strictEqual(r.sources.length, 3);
    assert.deepStrictEqual(calls[1].p, ['cb-in', 'v3'], 'the sources are read for the version found, not the one asked');
  });
  await t('the boilerplate own locale wins over region_layer; region_layer fills what it left out', async () => {
    script = [{ rows: [{ boilerplate_key: 'k', version: 'v1', region_code: 'IN', locale: { currency: 'INR' } }] }, { rows: [] }, { rows: [{ currency: 'USD', units: 'metric', jurisdiction: 'IN-GST' }] }];
    const r = await BP.resolveBoilerplate('k');
    assert.deepStrictEqual(r.locale, { currency: 'INR', units: 'metric', jurisdiction: 'IN-GST' });
  });
  await t('region_layer unreadable -> carried on without it (locale is the boilerplate alone)', async () => {
    script = [{ rows: [{ boilerplate_key: 'k', version: 'v1', region_code: 'IN', locale: { currency: 'INR' } }] }, { rows: [] }, new Error('no region_layer')];
    const r = await BP.resolveBoilerplate('k'); assert.strictEqual(r.locale.currency, 'INR'); assert.strictEqual(r.locale.units, undefined);
  });
  await t('boilerplate tables absent (first read fails) -> null, never a throw', async () => { script = [new Error('relation "boilerplate" does not exist')]; assert.strictEqual(await BP.resolveBoilerplate('k'), null); });
  await t('entityBoilerplateKey: the stamped key, null when unstamped, null for no entity or a failed read', async () => {
    script = [{ rows: [{ boilerplate_key: 'cb-in' }] }]; assert.strictEqual(await BP.entityBoilerplateKey(fake.withEntity, 'E1'), 'cb-in');
    script = [{ rows: [] }]; assert.strictEqual(await BP.entityBoilerplateKey(fake.withEntity, 'E1'), null);
    assert.strictEqual(await BP.entityBoilerplateKey(fake.withEntity, ''), null);
    script = [new Error('x')]; assert.strictEqual(await BP.entityBoilerplateKey(fake.withEntity, 'E1'), null);
  });
  await t('registerSource without a key -> 400 "source_key required" before any write', async () => {
    await assert.rejects(SRC.registerSource({ title: 'x' }), (e) => e.status === 400 && /source_key required/.test(e.message)); assert.strictEqual(calls.length, 0);
  });
  await t('registerSource: a new key mints the sealed entity from the deterministic .local email, then writes the standard', async () => {
    script = [{ rows: [] }, { rows: [{ identity_id: 'I1', bridge_id: 'B1', display_name: 'GST rates' }] }, { rows: [] }, { rows: [] }];
    const r = await SRC.registerSource({ source_key: 'gst', title: 'GST rates', facet: 'tax' });
    assert.deepStrictEqual(calls[0].p, ['src.gst@chitbridge.local']); assert.ok(/INSERT INTO identities/.test(calls[1].sql)); assert.ok(calls[2].sql.includes('set_config') && calls[2].p[0] === 'I1'); /* DB-103: the source entity is bound for the one write */ assert.ok(/INSERT INTO standard_source/.test(calls[3].sql));
    assert.deepStrictEqual(r, { source_key: 'gst', kind: 'standard', facet: 'tax', entity: { identity_id: 'I1', bridge_id: 'B1', display_name: 'GST rates' } });
  });
  await t('registerSource again with a new title is a RENAME of one field, never a second entity', async () => {
    script = [{ rows: [{ identity_id: 'I1', bridge_id: 'B1', display_name: 'GST rates' }] }, { rows: [] }, { rows: [] }];
    const r = await SRC.registerSource({ source_key: 'gst', title: 'GST rate card' });
    assert.ok(!calls.some((c) => /INSERT INTO identities/.test(c.sql))); assert.ok(/UPDATE identities SET display_name/.test(calls[1].sql)); assert.strictEqual(r.entity.display_name, 'GST rate card'); assert.strictEqual(r.entity.identity_id, 'I1');
  });
  await t('a kind other than standard writes the entity only (no standard_source row); facet defaults null', async () => {
    script = [{ rows: [{ identity_id: 'I2', bridge_id: 'B2', display_name: 'Acme' }] }];
    const r = await SRC.registerSource({ source_key: 'acme', kind: 'brand' }); assert.strictEqual(calls.length, 1); assert.strictEqual(r.facet, null); assert.strictEqual(r.kind, 'brand');
  });
  await t('resolveSourceEntity: the row, null when none, null (not a throw) on a failed read', async () => {
    script = [{ rows: [{ standard_key: 'gst', version: 'v1' }] }]; assert.strictEqual((await SRC.resolveSourceEntity('gst')).standard_key, 'gst'); assert.ok(/active = true ORDER BY s.version DESC LIMIT 1/.test(calls[0].sql));
    script = [{ rows: [] }]; assert.strictEqual(await SRC.resolveSourceEntity('none'), null);
    script = [new Error('x')]; assert.strictEqual(await SRC.resolveSourceEntity('gst'), null);
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
