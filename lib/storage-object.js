/**
 * lib/storage-object.js — the OBJECT-STORE half of the StorageAdapter.
 *
 * Athi, 2026-08-15: *"can we add a s3 bucket kind of in the current environment … and how do we keep the naming
 * convention etc should be decided."*  Full reasoning in C:\dev\SPEC-object-storage.md.
 *
 * ── ⭐ WHY THERE IS NO SDK HERE ───────────────────────────────────────────────────────────────────────────────────
 * Supabase Storage speaks plain REST with a bearer token — `POST /storage/v1/object/<bucket>/<path>`. Four HTTP
 * calls. The alternatives were a ~20MB `@aws-sdk/client-s3` or ~70 lines of hand-rolled AWS SigV4 signing, and the
 * second of those is security-sensitive code written to avoid a dependency, which is the wrong trade in both
 * directions. Node's built-in fetch does the whole job.
 *
 * The bucket is S3-compatible, so moving to R2 or AWS later means writing a sibling of this file and changing an
 * env var — which is the entire reason lib/storage.js was built around an adapter in the first place.
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

const ENDPOINT = (process.env.S3_ENDPOINT || '').replace(/\/+$/, '');   // e.g. https://<ref>.supabase.co
const BUCKET   = process.env.S3_BUCKET || 'cb-attach';
const KEY      = process.env.S3_KEY || '';                              // service role key (server-side only)

function configured() { return !!(ENDPOINT && KEY); }

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

function url(key) {
  return `${ENDPOINT}/storage/v1/object/${encodeURIComponent(BUCKET)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
function headers(extra) {
  return Object.assign({ Authorization: `Bearer ${KEY}`, apikey: KEY }, extra || {});
}

async function put(key, buffer, mime) {
  if (!configured()) throw new Error('storage-object: S3_ENDPOINT/S3_KEY not set');
  const r = await fetch(url(key), {
    method: 'POST',
    headers: headers({ 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true' }),
    body: buffer
  });
  if (!r.ok) throw new Error(`storage-object: put ${r.status} ${(await r.text()).slice(0, 200)}`);
  return key;
}

async function get(key) {
  if (!configured()) throw new Error('storage-object: S3_ENDPOINT/S3_KEY not set');
  const r = await fetch(url(key), { headers: headers() });
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
  if (!configured()) throw new Error('storage-object: S3_ENDPOINT/S3_KEY not set');
  const r = await fetch(url(key), { method: 'DELETE', headers: headers() });
  /* 404 on delete is success: the goal state is "this object does not exist", and it does not. */
  if (!r.ok && r.status !== 404) throw new Error(`storage-object: delete ${r.status} for ${key}`);
  return true;
}

module.exports = { configured, objectKey, put, get, del, BUCKET, ENDPOINT_SET: !!ENDPOINT };
