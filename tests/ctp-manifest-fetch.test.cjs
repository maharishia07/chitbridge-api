/**
 * tests/ctp-manifest-fetch.test.cjs — READING A PEER'S MANIFEST HAS A DEADLINE AND A BYTE CAP (RAIL-140 c).
 *
 * lib/ctpdirectory.manifestFor fetches https://<domain>/.well-known/ctp.json before any envelope from that peer is
 * believed. The deadline was cleared when the headers arrived, and the body was read whole and then cut to 64 K
 * characters. So a peer could send its headers and drip the body forever, or send any amount. This runs a real
 * local server (CB_CTP_ALLOW_PRIVATE=1 lets loopback through the address guard, as local dev does) and asks it.
 */
'use strict';
const http = require('http');
const path = require('path');
process.env.CB_CTP_ALLOW_PRIVATE = '1';
const dir = require(path.join(__dirname, '..', 'lib', 'ctpdirectory'));

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.error('  FAIL ' + name + (extra ? '   ' + extra : '')); }
};
const MANIFEST = { ctp: '1', installation_key: 'far-1', public_key: 'PK-FAR' };
const pad = (ch, count) => JSON.stringify(Object.assign({}, MANIFEST, { pad: ch.repeat(count) }));

/* one local server per behaviour: the domain is host:port, so each behaviour gets its own port */
function serve(handler) {
  return new Promise((done) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => done(s)); });
}
const timed = (promise, ms) => Promise.race([promise, new Promise((done) => setTimeout(() => done({ timedOut: true }), ms))]);

(async () => {
  const servers = [];
  try {
    console.log('\n── a peer\'s manifest: read in bytes, within the deadline ──');
    const plain = await serve((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(MANIFEST)); });
    servers.push(plain);
    let r = await dir.manifestFor('127.0.0.1:' + plain.address().port, { fresh: true });
    t('an ordinary manifest is read', r.ok === true && r.manifest.public_key === 'PK-FAR', JSON.stringify(r));

    /* 40 000 × 'é' is 40 000 characters (under the old character cut) and 80 000 bytes (over the 64 KB cap) */
    const wide = await serve((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(pad('é', 40000)); });
    servers.push(wide);
    r = await dir.manifestFor('127.0.0.1:' + wide.address().port, { fresh: true });
    t('a body over 64 KB in bytes is refused, however few characters it has', r.ok === false && r.why === 'manifest is too large to be one', JSON.stringify(r).slice(0, 160));

    const small = await serve((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(pad('é', 20000)); });
    servers.push(small);
    r = await dir.manifestFor('127.0.0.1:' + small.address().port, { fresh: true });
    t('a multi-byte body under the cap is read', r.ok === true);

    /* headers at once, then one byte a second: the deadline (5 s) must cut it, not wait for the far end */
    const drip = await serve((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.flushHeaders();
      const body = JSON.stringify(MANIFEST);
      let at = 0;
      const tick = setInterval(() => { if (at >= body.length || res.destroyed) { clearInterval(tick); res.end(); return; } res.write(body[at++]); }, 1000);
      res.on('close', () => clearInterval(tick));
    });
    servers.push(drip);
    const started = Date.now();
    r = await timed(dir.manifestFor('127.0.0.1:' + drip.address().port, { fresh: true }), 8000);
    const took = Date.now() - started;
    t('a body dripped after the headers is cut at the deadline', !r.timedOut && r.ok === false && took < 7000, 'took ' + took + ' ms · ' + JSON.stringify(r).slice(0, 160));
  } finally {
    servers.forEach((s) => { s.closeAllConnections(); s.close(); });
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
