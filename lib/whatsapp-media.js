// lib/whatsapp-media.js — fetch the BYTES of a photo a customer sent, so a co-assist can read it.
//
// A WhatsApp media message carries only an ID. The picture lives on Meta's servers and needs a two-step
// authenticated fetch: GET /{media_id} → a short-lived URL → GET that URL with the same bearer token.
//
// ⚠️ THIS IS THE ONE PLACE THAT FETCHES. SPEC-catalogue-photo-vision.md is explicit that the AI engine never
// follows a URL — an untrusted capture that could point the engine at an arbitrary address would be an SSRF hole
// with a language model on the end of it. So fetching happens here, against Meta's host only, and the ENGINE only
// ever receives bytes.
//
// ⚠️ IT NEEDS WHATSAPP_TOKEN — the same credential outbound uses, and one a business may not have. Without it this
// returns nothing and the caller falls back to the text path, which is the honest degrade: a photo we cannot read
// is still a capture a human can open and answer.
const GRAPH = process.env.WHATSAPP_GRAPH_BASE || 'https://graph.facebook.com/v21.0';

/** Bounded so a hostile or accidental 40MB video cannot be pulled into memory and then into a vision bill. */
const MAX_BYTES = Number(process.env.WHATSAPP_MEDIA_MAX_BYTES || 5_000_000);
const OK_MIME = /^image\/(png|jpe?g|webp|gif)$/;

/**
 * fetchImage — one media id → { mime, b64 } or null.
 *
 * Returns null for anything that is not a readable image, is too big, or cannot be fetched. Never throws: a photo
 * that will not download must not break the capture it belongs to.
 */
async function fetchImage(media_id) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token || !media_id) return null;
  try {
    const metaRes = await fetch(GRAPH + '/' + encodeURIComponent(media_id), { headers: { Authorization: 'Bearer ' + token } });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    // ⚠️ Check the type BEFORE downloading. A PDF or a video is a legitimate WhatsApp attachment and not something
    // to spend vision tokens on discovering.
    if (!meta || !meta.url || !OK_MIME.test(String(meta.mime_type || ''))) return null;
    if (meta.file_size && Number(meta.file_size) > MAX_BYTES) return null;

    const binRes = await fetch(meta.url, { headers: { Authorization: 'Bearer ' + token } });
    if (!binRes.ok) return null;
    const buf = Buffer.from(await binRes.arrayBuffer());
    // Re-check after download: file_size is Meta's claim about the file, and a claim is not a measurement.
    if (buf.length > MAX_BYTES) return null;
    return { mime: meta.mime_type, b64: buf.toString('base64'), bytes: buf.length };
  } catch (_) { return null; }
}

/** Every readable image on a capture, capped — the engine caps too, but a caller should not lean on that. */
async function imagesFor(capture, limit) {
  const refs = Array.isArray(capture && capture.media_refs) ? capture.media_refs : [];
  const out = [];
  for (const r of refs.slice(0, Number(limit) || 4)) {
    const im = await fetchImage(r && r.id);
    if (im) out.push(im);
  }
  return out;
}

module.exports = { fetchImage, imagesFor, MAX_BYTES };
