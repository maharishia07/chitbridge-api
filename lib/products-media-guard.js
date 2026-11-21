'use strict';
/**
 * lib/products-media-guard.js — WHAT A CATALOGUE PICTURE MAY BE AND WHO MAY READ A PRIVATE ONE (S12, moved out of routes/products.js, read1129routes)
 * OWNER     cb-catalogue
 * RISK      security: a stored file is served only under an allowed type, a media id is a UUID, a private catalogue's picture reads only for that shop's own signed-in people
 * FLOW      a file type -> mimeKey -> MEDIA_MIME_OK (allowed or a plain download) · a typed media id -> MID_SHAPE / likeEscape · a request -> signedInAs the shop (a bad token is simply no)
 * OWNS      MEDIA_MIME_OK · mimeKey · MID_SHAPE · likeEscape · signedInAs · servedHeaders
 * CALLED BY routes/products.js (POST /:id/media, GET /media/:item_id/:mid) · tests/route-modules-1129.test.cjs
 * CARD      06-catalogue-pim/catalogue-read
 */
const log = require('./logger');

/** S12: the file types a catalogue may store and the public read may serve under their own type; anything else is refused on the way in and served as a download of unknown type */
const MEDIA_MIME_OK = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'application/pdf']);
const mimeKey = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();
const MID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** S12: LIKE's own characters (! % _) in a typed value, made plain (the query says ESCAPE with the bang) */
const likeEscape = (v) => String(v).replace(/[!%_]/g, (c) => '!' + c);
/** S12: is the request signed in as this shop (or a person of it)? A picture of a PRIVATE catalogue is served to nobody else. A bad or missing token is simply "no". */
function signedInAs(req, entity_id) {
  try {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer[ ]+/i, '');
    if (!bearer) return false;
    const { claims } = require('../lib/jwt-verify').verifyJwt(bearer); /* the one verifier (rotation-aware, HS256 pinned) */
    return String(claims.identity_id) === String(entity_id) || String(claims.parent_entity_id || '') === String(entity_id);
  } catch (err) {
    log.fellBack('products media: a bad or missing token is simply no', err, 'debug');
    return false;
  }
}

/** the headers a stored picture is served with: an allowed type under its own name (anything else a plain download), never sniffed, cached publicly only when the catalogue is public */
function servedHeaders(res, mime, isPrivate) {
  const served = MEDIA_MIME_OK.has(mimeKey(mime));
  res.set('Content-Type', served ? mimeKey(mime) : 'application/octet-stream');
  res.set('X-Content-Type-Options', 'nosniff');
  if (!served) res.set('Content-Disposition', 'attachment');
  res.set('Cache-Control', isPrivate ? 'private, max-age=0' : 'public, max-age=86400');
}

module.exports = { MEDIA_MIME_OK, mimeKey, MID_SHAPE, likeEscape, signedInAs, servedHeaders };
