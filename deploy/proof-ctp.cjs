// deploy/proof-ctp.cjs — run by deploy/proof.sh (HX1): CTP discovery answers on the api's name and is never the web app; /config.js names CB_API_BASE
'use strict';
const API = 'http://127.0.0.1:' + process.env.API_PORT, WEB = 'http://127.0.0.1:' + process.env.WEB_PORT;
(async () => {
  const a = await fetch(API + '/.well-known/ctp.json'), aj = a.ok ? await a.json() : null;
  const w = await fetch(WEB + '/.well-known/ctp.json'), wt = await w.text();
  const c = await (await fetch(WEB + '/config.js')).text();
  const named = (c.match(/"(https?:[^"]+)"/) || [])[1];
  const ok = a.status === 200 && aj && typeof aj === 'object' && w.status === 404 && !/<title>ChitBridge<\/title>/.test(wt) && named === String(process.env.CB_API_BASE).replace(/\/+$/, '');
  console.log((ok ? '' : '✗ ') + 'ctp.json: api ' + a.status + ' (' + Object.keys(aj || {}).slice(0, 4).join(', ') + ') · web ' + w.status + ' (not the app) · /config.js names ' + named);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
