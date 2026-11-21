'use strict';
/**
 * lib/import-rejects.js — THE GOOD ROWS OF AN IMPORT GO IN; THE BAD ROWS COME BACK WITH A REASON EACH (WALK S2 S2-F-02, 21 Nov 2026).
 *
 * OWNER     cb-catalogue
 * RISK      plain
 * OWNS      rejectsOf (the preflight's error issues → one entry per bad row: line · field · reason) · rejectsCsv (the bad rows as a file to fix and send again, with a "problem" column)
 * CALLED BY routes/products.js POST /import when the person asked to skip the bad rows (body.skip_bad_rows === true)
 * FLOW      preflight issues (severity error) → rejectsOf → [{ line, field, message }] → the route drops those lines before it writes → rejectsCsv → answer.rejects_csv
 * CARD      storefront-and-catalogue/catalogue-import
 * ⚠️ Without the flag the route still refuses the whole file, as before (all-or-nothing is the default; a person chooses to take the good rows).
 * ⚠️ A line is the file's own line number (row 1 = the headings), the number the preflight and the outcome already use.
 */
const { cell } = require('./csv');

/** the preflight's issues → [{ line, field, message }], one per bad line (its first problem), in file order; only severity 'error' counts */
function rejectsOf(issues) {
  const seen = new Map();
  for (const issue of issues || []) {
    if (issue.severity !== 'error' || seen.has(issue.row)) continue;
    seen.set(issue.row, { line: issue.row, field: issue.column, message: issue.message });
  }
  return [...seen.values()].sort((a, b) => a.line - b.line);
}

/** the rejected rows as CSV text: the file's own headings, a "problem" column last; each row as it came (parsed rows are objects keyed by heading, line = index + 2) */
function rejectsCsv(headers, parsedRows, rejects) {
  const out = [headers.concat('problem').map(cell).join(',')];
  for (const bad of rejects) {
    const row = parsedRows[bad.line - 2] || {};
    out.push(headers.map((name) => cell(row[name])).concat(cell(bad.field + ': ' + bad.message)).join(','));
  }
  return out.join('\r\n') + '\r\n';
}

module.exports = { rejectsOf, rejectsCsv };
