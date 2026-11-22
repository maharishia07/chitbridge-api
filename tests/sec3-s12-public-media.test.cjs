/**
 * tests/sec3-s12-public-media.test.cjs - S12 (VERIFY-EL-SECURITY): the public picture route served any stored MIME, served a PRIVATE catalogue's picture to anyone holding the two ids, and matched the media id with a raw LIKE.
 * ATTACK    (1) a stored text/html (or svg) is served under its own type from our origin; (2) a pasted link to a private-catalogue picture keeps working for strangers; (3) a % or _ typed as the media id widens the blob lookup.
 * RULE      only allowlisted types are stored (400) and named when served (anything else is a plain attachment, nosniff); a picture found only through the owner's own context needs that shop's signed-in token (else 404, never cached publicly);
 *           the media id must be a UUID and the LIKE escapes its wildcards.
 * RUN       node tests/sec3-s12-public-media.test.cjs        STANDARD  OWASP ASVS 4.0.3 V12.5.1/V12.3 (uploaded content) · API1:2023 (object level authorization)
 * CARD      06-catalogue-and-products
 */
const assert = require('assert');
const G = require('./support/route-golden.cjs');
const SHOP = '11111111-1111-4111-8111-111111111111';
const ITEM = '66666666-6666-4666-8666-666666666666';
const MID = '77777777-7777-4777-8777-777777777777';
let mime = 'image/png', publiclyVisible = true, likeSeen = null, itemReads = 0;
const h = G.harness({
  known: { [SHOP]: 'SHOP' },
  rows: (sql, params) => {
    if (/FROM media_blobs WHERE key LIKE/.test(sql)) { likeSeen = { sql, param: params[0] }; itemReads = 0; return [{ entity_id: SHOP }]; }
    if (/SELECT 1 FROM catalogue_items/.test(sql)) return publiclyVisible ? [{ '?column?': 1 }] : [];
    if (/SELECT entity_id, item_data FROM catalogue_items/.test(sql)) return itemReads++ > 0 && !publiclyVisible ? [] : [{ entity_id: SHOP, item_data: { media: [{ id: MID, key: SHOP + '/2026/11/' + MID, mime }] } }];
    return [];
  }
});
const store = require.resolve('../lib/storage-object');
let putCalls = 0;
require.cache[store] = { id: store, filename: store, loaded: true, exports: { available: async () => true, objectKey: (e, m) => e + '/2026/11/' + m, put: async () => { putCalls++; }, get: async () => Buffer.from('bytes'), del: async () => undefined, NOT_OWNER: 'NOT_OWNER' } };
const products = require('../routes/products');
const app = h.app('/api/products', products);
const express = require('express');
const direct = express();
direct.use('/api/products', products);
let srv; const up = new Promise((r) => { srv = direct.listen(0, '127.0.0.1', r); });
const get = async (mid, headers) => { await up; const r = await fetch('http://127.0.0.1:' + srv.address().port + '/api/products/media/' + ITEM + '/' + mid, { headers: headers || {} }); return { status: r.status, headers: Object.fromEntries(r.headers.entries()) }; };
let n = 0, failed = 0;
const it = async (name, fn) => { n++; try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); } };
(async () => {
  await it('an allowed picture type is served under its own type with nosniff', async () => {
    const r = await get(MID);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['content-type'].split(';')[0], 'image/png');
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  });
  await it('a stored text/html is NOT named: served as an octet-stream attachment', async () => {
    mime = 'text/html';
    const r = await get(MID);
    assert.strictEqual(r.headers['content-type'].split(';')[0], 'application/octet-stream');
    assert.ok(/attachment/.test(r.headers['content-disposition'] || ''), JSON.stringify(r.headers));
    mime = 'image/png';
  });
  await it('a media id with a % or _ is no picture (404) and never reaches the blob lookup', async () => {
    likeSeen = null;
    const r = await get('%25');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(likeSeen, null);
  });
  await it("the blob lookup says ESCAPE and escapes the wildcards", async () => {
    await get(MID);
    assert.ok(/ESCAPE/.test(likeSeen.sql) && likeSeen.param === '%/' + MID);
  });
  await it('a PRIVATE catalogue picture is 404 for a stranger', async () => {
    publiclyVisible = false;
    const r = await get(MID);
    assert.strictEqual(r.status, 404, String(r.status));
  });
  await it("...and is served, not publicly cacheable, to the shop's own signed-in token", async () => {
    const jwt = require('jsonwebtoken');
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    const token = jwt.sign({ identity_id: SHOP }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    const r = await get(MID, { authorization: 'Bearer ' + token });
    assert.strictEqual(r.status, 200, String(r.status));
    assert.ok(/private/.test(r.headers['cache-control']), r.headers['cache-control']);
    publiclyVisible = true;
  });
  await it('upload: a text/html file is refused 400 and nothing is stored', async () => {
    const r = await h.run(app, { method: 'POST', url: '/api/products/' + ITEM + '/media', body: { name: 'x.html', mime: 'text/html', data_base64: Buffer.from('<script>1</script>').toString('base64') }, identity: { identity_id: SHOP }, settle: 5 });
    assert.strictEqual(r.status, 400, String(r.status) + JSON.stringify(r.body));
    assert.strictEqual(putCalls, 0);
  });
  console.log('\n  ' + (n - failed) + ' passed, ' + failed + ' failed · ' + n + ' checks');
  srv.close();
  process.exit(failed ? 1 : 0);
})();
