/**
 * lib/storage-object.js — the OBJECT-STORE half of the StorageAdapter.
 *
 * Athi, 2026-08-15: *"can we add a s3 bucket kind of in the current environment … and how do we keep the naming
 * convention etc should be decided."*  Full reasoning in C:\dev\SPEC-object-storage.md.
 *
 * ── ⭐ WHY THERE IS NO SDK HERE ───────────────────────────────────────────────────────────────────────────────────
 * Two transports, both on Node's built-in fetch, chosen by config (docs/HOSTING.md, Storage):
 *   · S3 (SigV4) — S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY (+ S3_REGION, S3_PATH_STYLE). AWS S3, Cloudflare R2, MinIO,
 *     Supabase's own S3 endpoint (<ref>.supabase.co/storage/v1/s3) — anything that speaks the S3 API. HX1, 2026-10-13: the
 *     signing is ~40 lines below (sigv4), proven against AWS's published example signature (tests/hosting-neutral.test.cjs) and
 *     against MinIO in deploy/compose.yml (tests/storage-s3-live.test.cjs) — still no ~20MB SDK for four HTTP calls.
 *   · Supabase Storage REST — S3_ENDPOINT + S3_KEY (a bearer token, `POST /storage/v1/object/<bucket>/<path>`): what production
 *     ran before HX1, kept unchanged so nothing moves until the owner switches the env.
 * Neither set → the database fallback below. The key naming, the replication rule and the private bucket are the same for all three.
 *
 * ── ⚠️ THE BYTES ARE REPLICATED, ONE OBJECT PER PARTICIPANT ──────────────────────────────────────────────────────
 * Not content-addressed, not deduplicated. Three participants on a 6MB file means three objects and 18MB.
 *
 * That is deliberate and it is the expensive choice. Dedup needs reference counting, and a refcount bug is a
 * CROSS-PARTY DATA-LOSS bug: one party deletes their copy and another party's evidence disappears. That is exactly
 * the failure the per-copy mailing model exists to make impossible, and the standing rule's own tie-break is
 * "when in doubt → replicate". Storage costs rupees; a counterparty finding their proof gone mid-dispute costs
 * the product its reason to exist. Dedup can be added later behind a real refcount and a test that proves the
 * second holder survives the first one's delete. It cannot be added later as a correction.
 *
 * ── ⚠️ PRIVATE BUCKET. NO PUBLIC URL. EVER. ──────────────────────────────────────────────────────────────────────
 * Reads stream back through the API, so `GET /api/attachments/:id` keeps deciding access via RLS inside
 * withEntity() exactly as it does today. The URL grants nothing; the session does. Signed URLs are a later
 * optimisation for large media and they are the moment a leak becomes possible, so they get their own decision.
 */
'use strict';

const crypto = require('crypto');
const ENDPOINT = (process.env.S3_ENDPOINT || '').replace(/\/+$/, '');   // e.g. https://<ref>.supabase.co · https://s3.<region>.amazonaws.com · http://minio:9000
const BUCKET   = process.env.S3_BUCKET || 'cb-attach';
const KEY      = process.env.S3_KEY || '';                              // Supabase REST: service role key (server-side only)
const SIG = {                                                           // S3 API (SigV4): an access key pair, never sent — only signatures are
  id: process.env.S3_ACCESS_KEY_ID || '', secret: process.env.S3_SECRET_ACCESS_KEY || '',
  region: process.env.S3_REGION || 'us-east-1',                         // R2: auto · MinIO: us-east-1 · Supabase: the project's region
  pathStyle: String(process.env.S3_PATH_STYLE || 'true').toLowerCase() !== 'false'   // false = <bucket>.<host> (AWS virtual-hosted)
};
const transport = () => (ENDPOINT && SIG.id && SIG.secret) ? 'sigv4' : ((ENDPOINT && KEY) ? 'supabase' : null);

function configured() { return transport() !== null; }
const NOT_SET = 'storage-object: S3_ENDPOINT with S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (or S3_KEY) not set';

/**
 * ⭐ THE DATABASE FALLBACK — "a simple storage in the server for a few images" (Athi, 2026-09-05). When no S3 env is
 * set, bytes live in `media_blobs` (b204, WITHOUT RLS: rows are addressed by their unguessable key through the API
 * only; the public read resolves the key from the product's own item_data, never from the URL). Same key, same
 * put/get/del, so a later S3 configuration changes nothing above this line. Sized for pictures (8 MB cap upstream),
 * not for a video library — video is a LINK (YouTube/Vimeo), see routes/products.js.
 */
let _dbMode = null, _dbAsked = 0;
async function mode() {
  if (configured()) return 's3';
  /* ⚠️ NEVER CACHE A NO. The Railway process booted before Athi ran b204; the first media call cached false and every
     later call answered 'not configured' until a redeploy (2026-09-04, the tour's video case). A yes is stable for the
     life of the process; a no is re-asked, at most once a minute. */
  if (_dbMode === null || (_dbMode === false && Date.now() - _dbAsked > 60000)) { _dbAsked = Date.now(); try { _dbMode = await require('./schema').hasTable('media_blobs'); } catch (_) { _dbMode = false; } }
  return _dbMode ? 'db' : null;
}
async function available() { return (await mode()) !== null; }
const dbq = (...a) => require('../db').query(...a);

/**
 * objectKey — THE NAMING CONVENTION, in one function so it can never drift.
 *
 *     <entity_id>/<yyyy>/<mm>/<attachment_id>
 *
 * · entity_id FIRST, always — the isolation boundary is the first path segment, so a bucket policy can be written
 *   per prefix and a stray listing is scoped by construction. Anything date-first makes "everything belonging to
 *   one entity" a full scan and "restrict to one entity" impossible to express.
 * · yyyy/mm — object stores list lexicographically; a flat prefix with 100k objects is a bad listing and a worse
 *   lifecycle rule. It also makes per-copy RETENTION expressible as a lifecycle policy instead of a scan.
 * · the attachment row's own uuid — 1:1 with the row, so "delete the row, delete the object" is trivially correct
 *   and an orphan is findable by a join.
 * · ⚠️ NO FILENAME. `Invoice-Acme-Q3-final.pdf` in a key tells a stranger who is trading with whom. The name lives
 *   in the row, where RLS governs it.
 * · ⚠️ NO EXTENSION. The mime type is in the row and is what the download honours; an extension in the key is a
 *   second source of truth that can disagree with the first.
 */
function objectKey(entity_id, id, when) {
  const d = when instanceof Date ? when : new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${entity_id}/${d.getUTCFullYear()}/${mm}/${id}`;
}

/* ── the Supabase Storage REST transport (unchanged) ── */
function url(key) {
  return `${ENDPOINT}/storage/v1/object/${encodeURIComponent(BUCKET)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
function headers(extra) {
  return Object.assign({ Authorization: `Bearer ${KEY}`, apikey: KEY }, extra || {});
}

/* ── the S3 transport: AWS Signature Version 4, header-signed (docs: "Signature Version 4 signing process") ── */
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
/* RFC 3986 unreserved stays, everything else %XX — encodeURIComponent leaves !'()* alone, S3 signs them encoded */
const uriEnc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/**
 * sigv4 — the Authorization header for one request. Pure (the clock and the keys are arguments) so the published AWS example
 * can be replayed byte for byte. `headers` must include host and x-amz-date; every header given is signed.
 */
function sigv4({ method, path, query, headers, payloadHash, region, service, id, secret }) {
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lower = {}; Object.keys(headers).forEach((h) => { lower[h.toLowerCase()] = String(headers[h]).trim().replace(/\s+/g, ' '); });
  const amzDate = lower['x-amz-date'], day = amzDate.slice(0, 8);
  const canonical = [method, path, query || '', names.map((h) => h + ':' + lower[h] + '\n').join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSign).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${id}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

/** one signed S3 request for an object key — path-style (<endpoint>/<bucket>/<key>) unless S3_PATH_STYLE=false */
function s3fetch(method, key, body, mime) {
  const base = new URL(ENDPOINT);
  const segs = (SIG.pathStyle ? [BUCKET] : []).concat(key.split('/')).map(uriEnc).join('/');
  const path = base.pathname.replace(/\/+$/, '') + '/' + segs;
  const host = SIG.pathStyle ? base.host : `${BUCKET}.${base.host}`;
  const payloadHash = sha256(body || '');
  const h = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': new Date().toISOString().replace(/[-:]|\.\d{3}/g, '') };
  if (mime) h['content-type'] = mime;
  h.authorization = sigv4({ method, path, headers: h, payloadHash, region: SIG.region, service: 's3', id: SIG.id, secret: SIG.secret });
  delete h.host;                                                        /* fetch sets Host from the URL — the same value that was signed */
  return fetch(`${base.protocol}//${host}${path}`, { method, headers: h, body: body || undefined });
}

async function put(key, buffer, mime) {
  if ((await mode()) === 'db') {
    await dbq(`INSERT INTO media_blobs (key, entity_id, mime, size, bytes) VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, size = EXCLUDED.size, bytes = EXCLUDED.bytes`,
      [key, key.split('/')[0], mime || 'application/octet-stream', buffer.length, buffer]);
    return key;
  }
  if (!configured()) throw new Error(NOT_SET);
  const r = transport() === 'sigv4' ? await s3fetch('PUT', key, buffer, mime || 'application/octet-stream') : await fetch(url(key), {
    method: 'POST',
    headers: headers({ 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true' }),
    body: buffer
  });
  if (!r.ok) throw new Error(`storage-object: put ${r.status} ${(await r.text()).slice(0, 200)}`);
  return key;
}

async function get(key) {
  if ((await mode()) === 'db') {
    const r = await dbq('SELECT bytes FROM media_blobs WHERE key = $1', [key]);
    if (!r.rows.length) throw new Error(`storage-object: get 404 for ${key}`);
    return r.rows[0].bytes;
  }
  if (!configured()) throw new Error(NOT_SET);
  const r = transport() === 'sigv4' ? await s3fetch('GET', key) : await fetch(url(key), { headers: headers() });
  /**
   * ⚠️ 404 THROWS, it does not return empty.
   *
   * An attachment row that exists while its bytes do not is a BROKEN PROMISE, and the one thing that must never
   * happen is serving a 0-byte file as though it were the document. In a dispute, an empty PDF that downloads
   * cleanly is worse than an error — the error gets investigated, the empty file gets believed.
   */
  if (!r.ok) throw new Error(`storage-object: get ${r.status} for ${key}`);
  return Buffer.from(await r.arrayBuffer());
}

async function del(key) {
  if ((await mode()) === 'db') { await dbq('DELETE FROM media_blobs WHERE key = $1', [key]); return true; }
  if (!configured()) throw new Error(NOT_SET);
  const r = transport() === 'sigv4' ? await s3fetch('DELETE', key) : await fetch(url(key), { method: 'DELETE', headers: headers() });
  /* 404 on delete is success: the goal state is "this object does not exist", and it does not. */
  if (!r.ok && r.status !== 404) throw new Error(`storage-object: delete ${r.status} for ${key}`);
  return true;
}

module.exports = { configured, available, mode, objectKey, put, get, del, sigv4, transport, BUCKET, ENDPOINT_SET: !!ENDPOINT };
