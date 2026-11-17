/* tools/readability/header-grammar.cjs — the ONE reader of a file header: the labelled fields of PM/HEADER-TEMPLATE.md.
 *
 * OWNS      the field grammar (FIELD_LINE, TITLE_LINE, ID_VALUE) and parseFields(text, relPath) → { title, fields }; nothing else reads a header.
 * CALLED BY tools/readability/measure.cjs (readHeader, so the guard and the ratchet), tools/readability/headers.cjs (the --headers census).
 * FLOW      header text ──▶ parseFields ──▶ { title: bool, fields: { LABEL: first line of its value } }
 * CARD      qa/readability-guard
 * OWNER     cb-maintainability
 * RISK      plain
 */
'use strict';
const path = require('path');

/** every label the template knows; KIND, TEST LEVEL and BOUNDARY are read only to be flagged (they are derived, not typed) */
const FIELDS = ['ID', 'KIND', 'OWNER', 'OWNS', 'CALLED BY', 'CARD', 'FLOW', 'RISK', 'TEST LEVEL', 'BOUNDARY', 'RELEASE', 'COUNTRY', 'GATED BY', 'STAMP', 'UNIT'];
/** one field per line: comment decoration, the label, an optional colon, a gap, a non-empty value (only line 1 of a value is read) */
const FIELD_LINE = new RegExp('^[\\s/*#!<>-]*(' + FIELDS.join('|') + ')(:?)(\\s+)(\\S.*?)\\s*(?:-->|\\*/)?\\s*$', 'i');
/** the title line: `<path ending in the file name> — <one-line note>` */
const TITLE_LINE = /^[\s/*#!<>-]*(\S+\.(?:c?js|mjs|html))\s+[—–-]\s+(\S.*?)\s*(?:-->|\*\/)?\s*$/;
/** an ID is ONE code token with a digit (CMP012, 08-S3): prose that starts with "ID" ("ID of the party…") is not an ID */
const ID_VALUE = /^[A-Za-z][A-Za-z0-9-]*\d[A-Za-z0-9-]*$/;
const LINE_BREAK = /\r?\n/;

/** does this line really carry its label? upper-case always; a lower-case or mixed word only with a colon or a 2+ space gap (prose "owns the X" is not a field); an ID must hold a code */
function isField(match) {
  const spelled = match[1] === match[1].toUpperCase() || match[2] === ':' || match[3].length > 1;
  return spelled && (match[1].toUpperCase() !== 'ID' || ID_VALUE.test(match[4]));
}

/** what a header says: { title: the title line's path names this file, fields: { LABEL: value } } (first occurrence of a label wins) */
function parseFields(text, relPath) {
  const found = { title: false, fields: {} };
  for (const line of text.split(LINE_BREAK)) {
    const title = TITLE_LINE.exec(line);
    if (title && path.basename(relPath) === path.basename(title[1])) found.title = true;
    const field = FIELD_LINE.exec(line);
    if (field && isField(field) && !(field[1].toUpperCase() in found.fields)) found.fields[field[1].toUpperCase()] = field[4];
  }
  return found;
}

module.exports = { FIELDS, FIELD_LINE, TITLE_LINE, ID_VALUE, LINE_BREAK, parseFields };
