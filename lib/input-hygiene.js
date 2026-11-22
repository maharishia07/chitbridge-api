// @stage tested
// @stage-note The door check for a NUL byte (API-15); proved by tests/api-nul-input.test.cjs.
// CARD 28-platform-and-operations/api-standard
// OWNS  the one door check for text the database cannot hold: a NUL byte (\u0000) in a body, a query or a path is refused 400 INVALID_CHARACTER.
// ALSO  textOf(value, opts): the one read of a text value from a body or query (FUZZ-8); refuses an object/array/number as 400 INVALID_INPUT.
// CALLED BY  server.js (once, after the body parsers, before every router).
// FLOW  request → hasNul(path, query, body) → 400 problem+json | next()
'use strict';
/**
 * lib/input-hygiene.js — A NUL BYTE NEVER REACHES POSTGRES (API-15, BH-3, 2026-10-31).
 *
 * Postgres cannot store \u0000 in text and answers 22021 "invalid byte sequence". One NUL pasted from a PDF or sent by a barcode scanner made a whole
 * save or search answer 500 on 44 write routes and 6 reads. Every route catches its own errors, so translating 22021 in lib/knownerr.js would not
 * reach them; the door is the one place all of them pass. Only NUL is refused: a tab and a new line are text the database stores.
 *
 * refuseNul(req, res, next) — mount once after the parsers. Looks at the decoded path, the query (keys and values) and the parsed JSON / form body (keys and values, any depth).
 */
const { problem } = require('./problem');

/* a lone surrogate (half an emoji, cut by a client) is valid JS text but Postgres refuses it inside a json value: 22P02 "invalid input syntax for type json" - the 500s on POST /api/products (sit-grund, 2026-11-19). Same refusal as a NUL. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
const hasNulText = (text) => typeof text === 'string' && (text.indexOf('\u0000') !== -1 || LONE_SURROGATE.test(text) || BIDI_CONTROL.test(text));

/* GOR-11 / P4 (gorilla 2026-11-20): a bidi override or isolate (U+202A-202E, U+2066-2069) makes a name read backwards in a list or on a slip (a spoofing aid): refused like a NUL.
   C0/C1 control characters (except tab, new line, carriage return) are stripped from every body and query text by stripControls: never part of a name; a pasted one broke lines and logs. */
const BIDI_CONTROL = /[‪-‮⁦-⁩]/;
const CONTROL_CHARS = /[---]/g;
/** strips control characters from every string value of a parsed body in place (keys left alone); depth-capped, Buffers skipped */
function stripControls(value, depth) {
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || (depth || 0) > 40) return;
  const next = (depth || 0) + 1;
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (typeof item === 'string') value[key] = item.replace(CONTROL_CHARS, '');
    else stripControls(item, next);
  }
}

/** true when any string, key or nested value of `value` holds a NUL; a Buffer (raw webhook body) is left alone */
function hasNul(value, depth) {
  if (hasNulText(value)) return true;
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || (depth || 0) > 40) return false;
  const next = (depth || 0) + 1;
  if (Array.isArray(value)) return value.some((item) => hasNul(item, next));
  return Object.keys(value).some((key) => hasNulText(key) || hasNul(value[key], next));
}

/** the middleware: answer 400 INVALID_CHARACTER when the path, query or body holds a NUL, else strip control characters from the body and go on */
function refuseNul(req, res, next) {
  /* review GF-platform-04 M20: Express leaves req.path percent-encoded, so a %00 in it never matched; it is decoded here (a malformed escape is left as it is) */
  let decodedPath = req.path;
  try {
    decodedPath = decodeURIComponent(String(req.path || ''));
  } catch (malformed) {
    require('./logger').fellBack('input-hygiene: path escape not decoded - the raw path is checked instead', malformed, 'debug'); /* the raw path is what the router sees too */
  }
  if (!(hasNul(decodedPath) || hasNul(req.query) || hasNul(req.body))) { stripControls(req.body); return next(); }
  return problem(req, res, { status: 400, code: 'INVALID_CHARACTER', detail: 'What was sent holds a character that cannot be saved (often pasted from a PDF or a scanner).', hint: 'Remove the odd character, or type that part again.' });
}

/**
 * K-1 (B2): the door cannot see every value (a body nested deeper than it looks, a value a handler builds), so the area's fault mapper asks this: Postgres refused text it cannot store
 * (22021, and 22P05 inside a jsonb value). That is the caller's value, never a fault of ours; the one sentence a person reads for it is NOT_STORABLE_SENTENCE.
 */
const NOT_STORABLE = ['22021', '22P05'];
const isNotStorable = (e) => !!e && NOT_STORABLE.includes(e.code);
const NOT_STORABLE_SENTENCE = 'Cannot save this text. Type it again.';

/**
 * textOf(value, { max, trim, empty, field }) — FUZZ-8 (2026-11-18): THE one read of a text value from a body or a query. It replaces the String-of-req.body idiom, which turned an object into
 * "[object Object]" and an array into "a,b" and let both reach the database. A string comes back trimmed ({ trim: false } keeps it as typed); null, undefined and '' come back as
 * `empty` ('' unless the site passes null). An object, an array, a number or a boolean is refused: thrown as the registered refusal (400 INVALID_INPUT, err.refused), which
 * every route's own catch (fromError, lib/knownerr thrownRefusal) and the server error handler answer as the one problem+json. `max` refuses a longer text (never cuts it silently).
 */
/** the registered refusal textOf throws: 400 INVALID_INPUT, named by field */
function refusedText(what, field) {
  return Object.assign(new Error(what), { refused: true, status: 400, code: 'INVALID_INPUT', field });
}
/** the sentence naming the field a text refusal is about */
function fieldWords(options, named, unnamed) {
  return options.field ? named + options.field : unnamed;
}
function textOf(value, opts) {
  const options = opts || {};
  const empty = options.empty === undefined ? '' : options.empty;
  if (value === undefined || value === null) return empty;
  if (typeof value !== 'string') throw refusedText('Send ' + fieldWords(options, 'the ', 'this value') + ' as text.', options.field);
  const text = options.trim === false ? value : value.trim();
  if (text === '') return empty;
  if (options.max && text.length > options.max) throw refusedText(fieldWords(options, 'The ', 'This text') + ' is longer than ' + options.max + ' characters.', options.field);
  return text;
}

module.exports = { refuseNul, hasNul, stripControls, textOf, isNotStorable, NOT_STORABLE_SENTENCE };
