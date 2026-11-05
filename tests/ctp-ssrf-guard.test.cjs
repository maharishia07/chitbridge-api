'use strict';
// SEC-80: the CTP outbound fetches refuse non-https and private/internal hosts. DB-free, network-free (dns stubbed).
const path = require('path');
const API = path.join(__dirname, '..');
delete process.env.CB_CTP_ALLOW_PRIVATE;
const { assertPublicHttps, isBlockedAddress } = require(path.join(API, 'lib', 'safe-url'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const fakeLookup = (map) => async (h) => { if (!map[h]) throw new Error('ENOTFOUND'); return map[h].map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 })); };

(async () => {
  const blocked = ['127.0.0.1', '127.255.0.9', '::1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', 'fc00::1', 'fd12::5',
    '169.254.169.254', '169.254.0.1', 'fe80::1', '0.0.0.0', '::', '100.64.0.1', '100.127.255.254',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '::ffff:192.168.0.1'];
  blocked.forEach((a) => ok(isBlockedAddress(a), a + ' must be blocked'));
  ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'].forEach((a) => ok(!isBlockedAddress(a), a + ' must be allowed'));

  for (const a of blocked.slice(0, 6)) {
    const lit = a.includes(':') ? '[' + a + ']' : a;
    const r = await assertPublicHttps('https://' + lit + '/x');
    ok(r.ok === false && /private or internal/.test(r.why), 'literal ' + a + ' refused');
  }
  let r = await assertPublicHttps('http://8.8.8.8/x');
  ok(r.ok === false && /https/.test(r.why), 'http refused');
  r = await assertPublicHttps('https://8.8.8.8/x');
  ok(r.ok === true, 'public literal https allowed');
  r = await assertPublicHttps('https://[::ffff:127.0.0.1]/x');
  ok(r.ok === false, 'mapped literal refused');
  r = await assertPublicHttps('ftp://example.com/');
  ok(r.ok === false, 'ftp refused');
  r = await assertPublicHttps('not a url');
  ok(r.ok === false, 'garbage refused');

  const lookup = fakeLookup({ 'good.example': ['8.8.8.8'], 'evil.example': ['8.8.8.8', '169.254.169.254'], 'loop.example': ['127.0.0.1'], 'none.example': [] });
  ok((await assertPublicHttps('https://good.example/', { lookup })).ok === true, 'public name allowed');
  ok((await assertPublicHttps('https://evil.example/', { lookup })).ok === false, 'ANY bad address refuses');
  ok((await assertPublicHttps('https://loop.example/', { lookup })).ok === false, 'name resolving to loopback refused');
  ok((await assertPublicHttps('https://none.example/', { lookup })).ok === false, 'no addresses refused');
  ok((await assertPublicHttps('https://nx.example/', { lookup })).ok === false, 'lookup failure refused');

  process.env.CB_CTP_ALLOW_PRIVATE = '1';
  ok((await assertPublicHttps('http://127.0.0.1:8124/x')).ok === true, 'opt-in env allows local dev');
  delete process.env.CB_CTP_ALLOW_PRIVATE;

  /* the two callers: same failure shapes, nothing sent */
  let fetched = 0;
  const realFetch = global.fetch;
  global.fetch = async () => { fetched++; throw new Error('should not fetch'); };
  const dir = require(path.join(API, 'lib', 'ctpdirectory'));
  const d = await dir.manifestFor('localhost:8124', { fresh: true });
  ok(d.ok === false && typeof d.why === 'string' && /https|private/.test(d.why), 'directory refuses loopback: ' + d.why);
  const d2 = await dir.manifestFor('127.0.0.1', { fresh: true });
  ok(d2.ok === false, 'directory refuses 127.0.0.1');
  const tr = require(path.join(API, 'lib', 'ctptransport'));
  const keys = require(path.join(API, 'lib', 'ctpkeys'));
  process.env.CTP_PRIVATE_KEY = keys.generate().CTP_PRIVATE_KEY;
  keys._reset();
  const env = { chit_id: 'c1' };
  const s = await tr.send('http://169.254.169.254/latest', env);
  ok(s.accepted === false && s.status === null && s.chit_id === 'c1' && !!s.why, 'transport refuses (or cannot sign) in the shared shape');
  /* RAIL-141 (c): a copy canon cannot read is answered in the same shape, never thrown into mint.deliver */
  let deepSend;
  try { deepSend = await tr.send('https://far.example/api/ctp/deliver', { chit_id: 'c2', copy: { qty: BigInt(2) } }); } catch (e) { deepSend = { threw: e.message }; }
  ok(deepSend.accepted === false && deepSend.chit_id === 'c2' && deepSend.why === 'this copy cannot be sealed as one message — nothing was sent', 'an unsealable copy is answered, not thrown: ' + JSON.stringify(deepSend));
  ok(/nothing was sent/.test(s.why) && !/cannot sign/.test(s.why), 'transport refusal is the guard, not a signing failure: ' + s.why);
  keys._reset();
  ok(fetched === 0, 'nothing was fetched');
  global.fetch = realFetch;

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
