'use strict';
// OWNS      sendBlob(res, file, opt) · contentDisposition(name): the ONE way a stored file leaves the api (stored-XSS defence, S2): only images and PDFs render inline, everything else is forced to download, nosniff always.
// CALLED BY routes/attachments.js (GET /:id) · routes/books.js (GET /evidence/:id, the auditor's door)
// FLOW      a file { name, mime, data } ──▶ the safe type (image/png|jpeg|gif|webp|bmp and application/pdf stay; SVG and the rest become a download) ──▶ headers ──▶ the bytes
// RISK      security
/**
 * contentDisposition(name) → the filename part of a Content-Disposition value (RFC 6266 / 5987): an ASCII fallback in quotes, plus filename*=UTF-8'' percent-encoded when the name holds anything else.
 * ⚠️ A header value outside Latin-1 makes Node throw (ERR_INVALID_CHAR).
 */
function contentDisposition(name) {
  if (/^[ -~]*$/.test(name)) return 'filename="' + name + '"';
  const fallback = name.replace(/[^ -~]/g, '_').replace(/%/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (mark) => '%' + mark.charCodeAt(0).toString(16).toUpperCase());
  return 'filename="' + fallback + '"; filename*=UTF-8' + "''" + encoded;
}
/** send the file; opt.cache is the Cache-Control value (default: private for a day; a door that a grant can revoke passes 'private, no-store') */
function sendBlob(res, file, opt) {
  const rawMime = String(file.mime || 'application/octet-stream').toLowerCase();
  /* SVG is deliberately EXCLUDED — image/svg+xml can carry inline <script>, so it is forced to download. */
  const renderable = /^image\/(png|jpe?g|gif|webp|bmp)$/.test(rawMime) || rawMime === 'application/pdf';
  const safeName = (file.name || 'file').replace(/[\r\n"\\]/g, '');
  res.setHeader('Content-Type', renderable ? rawMime : 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${renderable ? 'inline' : 'attachment'}; ${contentDisposition(safeName)}`);
  res.setHeader('Cache-Control', (opt && opt.cache) || 'private, max-age=86400');
  res.send(file.data);
}
module.exports = { sendBlob, contentDisposition };
