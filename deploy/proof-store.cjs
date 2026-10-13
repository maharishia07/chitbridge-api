// deploy/proof-store.cjs — fed on stdin to node INSIDE the api container by deploy/proof.sh (HX1; deploy/ is not in the image): the api's own
// config reaches the object store over SigV4
'use strict';
const o = require(require('path').join(process.cwd(), 'lib', 'storage-object'));   /* the image's /app */
const k = 'proof/' + Date.now(), b = Buffer.from('from inside the api');
(async () => {
  if (o.transport() !== 'sigv4') throw new Error('the api is not on the S3 transport: ' + o.transport());
  await o.put(k, b, 'text/plain'); const g = await o.get(k); await o.del(k);
  if (!g.equals(b)) throw new Error('bytes differ');
  console.log('the api container stores on ' + process.env.S3_ENDPOINT + ' (SigV4): put · get · del ok');
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
