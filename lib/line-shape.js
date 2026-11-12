// CARD 01-rail-core-the-chit/chits-routes
// owns: what a send's line items are checked for BEFORE the money engine reads them: a line_id that is not a uuid or is repeated, and a figure-like key the engine does not read.
// called by: routes/chits.js sendBody (the send door), answered in routes/chits.js sendAnswer.
// FLOW  line_items → badLineId(lines) → 400 naming the line | ignoredFigures(lines) → ['amount', ...] named in the 200 answer
'use strict';
/**
 * lib/line-shape.js — THE SHAPE OF A SEND'S LINES (C11 input-shape sweep 10b, RAIL-177 · RAIL-81, 2026-11-12).
 *
 * ⚠️ NEVER A CLOSED LIST OF LINE KEYS. The counter sends particulars · quantity · unit · price · total · item_id · hsn · gst_rate · mods · offer · offers · item_data, a shift or a summary
 *    sends no lines, a short receipt sends quantity 0 and a newer vendored till sends keys this server has not met. A refusal on /chits/send is retried for ever by the till's queue,
 *    so a key the engine does not read is NAMED in the answer (`ignored`), never refused.
 * ⚠️ ONLY A FIGURE-LIKE KEY IS NAMED. Every key is stored on the line; the harm is a price or a quantity sent under a name the engine does not read (it bills 0 with no word said).
 * ⚠️ line_id is the one key refused: a top-level line_id that is not a uuid, or that two lines share, would orphan every amendment pointing at it (mint.lines keeps a given id).
 */
const services = require('./services');
const { UUID_TEXT } = require('./chits-input');

const UUID = new RegExp(UUID_TEXT.pattern, 'i');
/** the keys of a line the engine reads as a figure (services.CHIT_SENT_FIELDS) and the till's own that carry no sum the engine bills */
const READ = new Set(services.CHIT_SENT_FIELDS.map((row) => row[1][0]).concat(['offer', 'offers', 'mods', 'item_data', 'unit_size', 'hsn']));
/** a key that looks like a price, a quantity or a tax figure */
const FIGURE_LIKE = /price|amount|cost|total|qty|quant|rate|mrp|tax|gst|disc|net|gross/i;

/** the top-level line_id a line carries, or undefined */
const givenId = (line) => (line && typeof line === 'object' && typeof line.line_id !== 'undefined' && line.line_id !== null && line.line_id !== '' ? line.line_id : undefined);

/** badLineId(lines) → { line, why: 'not_uuid' | 'repeated' } for the first line (1-based) whose top-level line_id is unusable, else null */
function badLineId(lines) {
  const seen = new Set();
  const ids = (Array.isArray(lines) ? lines : []).map(givenId);
  for (let at = 0; at < ids.length; at++) {
    if (ids[at] === undefined) continue;
    const key = String(ids[at]).toLowerCase();
    if (typeof ids[at] !== 'string' || !UUID.test(ids[at])) return { line: at + 1, why: 'not_uuid' };
    if (seen.has(key)) return { line: at + 1, why: 'repeated' };
    seen.add(key);
  }
  return null;
}

/** the sentence of a bad line_id (the value is never echoed back: Q19) */
const badLineIdSaid = (found) =>
  found.why === 'repeated'
    ? 'Line ' + found.line + ' has the same line_id as an earlier line. Each line needs its own — or leave line_id out and one is made. Nothing was saved.'
    : 'Line ' + found.line + ' has a line_id that is not an id. Leave it out and one is made, or send the one this chit gave. Nothing was saved.';

/** the figure-like keys of one line the engine does not read */
const unreadKeys = (line) => (line && typeof line === 'object' && !line.removed ? Object.keys(line).filter((key) => FIGURE_LIKE.test(key) && !READ.has(key)) : []);

/** ignoredFigures(lines) → the figure-like keys the engine does not read, once each, in the order met ([] when none) */
function ignoredFigures(lines) {
  const keys = (Array.isArray(lines) ? lines : []).flatMap(unreadKeys);
  return [...new Set(keys)];
}

/** the sentence that goes with `ignored` */
const ignoredSaid = (keys) => 'These line fields are not figures this system reads, so they were kept on the line but not billed: ' + keys.join(', ') + '. If one was meant as the price or quantity, send it as price or quantity.';

/** refusalOf(lines) → the problem spec of a bad line_id (400 BAD_LINE_ID, the line named), or null: the send door answers it as it stands */
function refusalOf(lines) {
  const found = badLineId(lines);
  return found ? { error: 'Invalid line id', code: 'BAD_LINE_ID', message: badLineIdSaid(found), line: found.line } : null;
}

/** answerOf(ignored) → the keys the send answer carries when a line held a figure the engine does not read ({} when none) */
const answerOf = (ignored) => (ignored && ignored.length ? { ignored, says: ignoredSaid(ignored) } : {});

module.exports = { badLineId, badLineIdSaid, ignoredFigures, ignoredSaid, refusalOf, answerOf };
