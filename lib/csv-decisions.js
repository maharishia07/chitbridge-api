// OWNER     cb-catalogue (the import)
// RISK      plain
// OWNS      the COMMIT half of a spreadsheet import: applyDecisions (the person's decision per column + the file's rows → items, new fields, errors) and its helpers; pure
// FLOW      csv-preflight's report ──▶ the person decides ──▶ applyDecisions ──▶ items the route writes
// @stage tested
// CALLED BY routes/products.js, tests/csv-preflight.test.js, tests/walkd-csv-yes-no.test.cjs, tests/fixtures/walkthrough.js
// CARD 06-catalogue-pim/import-export-workbook-preflight
'use strict';
/**
 * csv-decisions.js — the commit half of csv-preflight, split out so csv-preflight.js stays a zero-require file that can be lifted on its own
 * (tests/csv-preflight.test.js pins that) and keeps its file-size row. Reads csv-preflight's own exports; changes no rule.
 */
const { matchHeader, looseNumber, toFieldKey, inferType, booleanOf, BLOCKED, NUMERIC_FIELDS, BOOLEAN_FIELDS, IDENTIFIER_FIELDS } = require('./csv-preflight');

/**
 * applyDecisions({ headers, rows, template, decisions }) → { items, newFields, errors, lines }
 *
 * Pure. Validates the decisions against the file and the accepted format, then turns the rows into item_data.
 * Refuses rather than repairs: a decision that does not hold up is an error the caller must show, not something to
 * silently drop, because a silently dropped decision imports a column the person thought they had mapped.
 */
function applyDecisions(opts = {}) {
  const headers = Array.isArray(opts.headers) ? opts.headers : [];
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const decisions = Array.isArray(opts.decisions) ? opts.decisions : [];
  const plan = {
    headers,
    rows,
    accepted: (opts.template && opts.template.columns) || [],
    labels: opts.labels || {},
    errors: [],
    byHeader: new Map(),
    claimed: new Map(),
    newFields: []
  };
  for (const decision of decisions) applyDecision(plan, decision);

  // Build the items. A column with no decision is simply absent — never imported on the strength of a suggestion.
  const items = [];
  const lines = [];
  rows.forEach((row, index) => {
    const built = builtItemOf(row, plan);
    if (!hasSomethingToGoOn(built, opts.identity)) return;
    items.push(built);
    lines.push(index + 2);
  });

  return { items, lines, newFields: plan.newFields, errors: plan.errors, mappedFields: [...plan.claimed.keys()] };
}
/** one decision of the person against the file: an error in words, or a column kept in plan.byHeader (a map or a create); ignore does nothing */
function applyDecision(plan, decision) {
  const incoming = decision && decision.incoming;
  const idx = plan.headers.indexOf(incoming);
  if (idx < 0) {
    plan.errors.push(`The file has no column called "${incoming}".`);
    return;
  }
  const action = (decision.action || 'ignore').toLowerCase();
  if (action === 'ignore') return;

  // A blocked column stays blocked. This is re-checked here and not merely trusted from the report, because the
  // report came back through the client and a decision is the one place someone could try to reintroduce one.
  const matched = matchHeader(incoming, plan.accepted, plan.labels);
  if (matched.how === 'blocked') {
    plan.errors.push(`"${incoming}" cannot be imported: ${matched.why}.`);
    return;
  }
  if (action === 'map') mapColumn(plan, decision, incoming, idx);
  else if (action === 'create') createColumn(plan, decision, incoming, idx);
  else plan.errors.push(`"${incoming}": ${action} is not something that can be done with a column.`);
}
/** a decision to map the file's column to a field the catalogue accepts: refused when the field is not accepted, is blocked, or is already claimed */
function mapColumn(plan, decision, incoming, idx) {
  const field = decision.field;
  if (!plan.accepted.includes(field)) {
    plan.errors.push(`"${incoming}" cannot be mapped to ${field} — your catalogue does not accept that column.`);
    return;
  }
  if (BLOCKED[field]) {
    plan.errors.push(`"${incoming}" cannot be mapped to ${field}: ${BLOCKED[field]}.`);
    return;
  }
  if (plan.claimed.has(field)) {
    plan.errors.push(`Both "${plan.claimed.get(field)}" and "${incoming}" were mapped to ${field}. Pick one.`);
    return;
  }
  plan.claimed.set(field, incoming);
  plan.byHeader.set(incoming, { field, idx });
}
/** why a new column key cannot be made, in words, or null when it can */
function newColumnRefusal(plan, key, incoming) {
  if (!key) return `"${incoming}" cannot become a column name — give it a name in letters.`;
  if (BLOCKED[key] || key === 'quantity') return `"${incoming}" cannot become ${key}: ${BLOCKED[key] || 'quantity is set by the customer at order time'}.`;
  if (plan.accepted.includes(key)) return `Your catalogue already has a ${key} column — map "${incoming}" to it instead of creating it again.`;
  if (plan.claimed.has(key)) return `Both "${plan.claimed.get(key)}" and "${incoming}" would create ${key}. Pick one.`;
  return null;
}
/** a decision to create a new optional column from the file's column: refused when its key is empty, blocked, already in the catalogue or already claimed */
function createColumn(plan, decision, incoming, idx) {
  const key = decision.field ? toFieldKey(decision.field) : toFieldKey(incoming);
  const refusal = newColumnRefusal(plan, key, incoming);
  if (refusal) {
    plan.errors.push(refusal);
    return;
  }
  plan.claimed.set(key, incoming);
  plan.byHeader.set(incoming, { field: key, idx });
  // Created OPTIONAL, always. A new required field would retroactively invalidate every product already stored.
  plan.newFields.push({
    field_key: key,
    field_name: String(incoming).trim().slice(0, 120),
    /* ⚠️ An identifier is text even when every value is digits — see IDENTIFIER_FIELDS. */
    field_type: IDENTIFIER_FIELDS.indexOf(key) >= 0 ? 'text' : inferType(plan.rows.map((row) => row[plan.headers.indexOf(incoming)])),
    required: false
  });
}
/** the item one file row builds: each mapped column's cell, a blank cell left out, a number as a number, a yes/no as a boolean, the rest as trimmed text */
function builtItemOf(row, plan) {
  const built = {};
  for (const [, { field, idx }] of plan.byHeader) {
    const rawCell = row[idx];
    if (rawCell === undefined || String(rawCell).trim() === '') continue;
    const cell = cellValueOf(field, rawCell, plan.newFields);
    if (cell.keep) built[field] = cell.value;
  }
  return built;
}
/** one cell as its field wants it → { keep, value }: a yes/no word a boolean (neither word: dropped), a number a number (unreadable: dropped, preflight reported it), else trimmed text */
function cellValueOf(field, rawCell, newFields) {
  const numeric =
    IDENTIFIER_FIELDS.indexOf(field) < 0 &&
    (NUMERIC_FIELDS.includes(field) || (newFields.find((entry) => entry.field_key === field) || {}).field_type === 'number');
  if (BOOLEAN_FIELDS.includes(field)) {
    const flag = booleanOf(rawCell);
    return { keep: flag !== null, value: flag };
  }
  if (numeric) {
    const { value } = looseNumber(rawCell);
    return { keep: value !== null, value }; // a null is already reported by preflight as an error
  }
  return { keep: true, value: String(rawCell).trim() };
}
/**
 * A row needs SOMETHING to go on: a name (to create by) or a code (to find an existing product by).
 *
 * ⚠️ This used to demand a NAME, full stop — which quietly made partial updates impossible. A file of
 * `sku,price` (the most ordinary update there is: today's prices) was refused with "no row had a product name",
 * so the only way to change one number was to resend every column of every row. The route decides what a row
 * WITHOUT a name means: matched on code it is an update, unmatched it cannot be created and is reported.
 */
function hasSomethingToGoOn(built, identity) {
  const idKeys = identity && Array.isArray(identity.key) && identity.key.length ? identity.key : ['sku'];
  const identified = idKeys.every((entry) => String(built[entry] == null ? '' : built[entry]).trim());
  return !!String(built.name || '').trim() || identified;
}

module.exports = { applyDecisions };
