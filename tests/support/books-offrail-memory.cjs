'use strict';
/**
 * OWNS      the in-memory answer to lib/offrail-itc postedByRole (V-F-07): the input tax the month's off-rail purchases (ev:expense: entries, unreversed before `to`) posted, by account role.
 * CALLED BY tests/support/books-memory.cjs (fakeDb.query, one line)
 * FLOW      the SQL text + params ([shop, roles, from, to)) + the memory tables T ──▶ { rows: [{ role, minor }] } or null when the text is not that query
 */
const ASKED = /^SELECT a\.role, SUM\(l\.dr_minor - l\.cr_minor\) AS minor/;
function answer(T, text, params) {
  if (!ASKED.test(String(text).trim())) return null;
  const tables = T || { entries: [], lines: [], accounts: [] };
  const day = (entry) => String(entry.posting_date || '').slice(0, 10);
  const roles = (params || [])[1] || [];
  const sums = new Map();
  tables.entries.filter((entry) => entry.entity_id === params[0] && /^ev:expense:/.test(String(entry.source_ref || '')) && !entry.reverses_entry_id && day(entry) >= params[2] && day(entry) < params[3]
    && !tables.entries.some((back) => back.reverses_entry_id === entry.entry_id && day(back) < params[3])).forEach((entry) => tables.lines.filter((line) => line.entry_id === entry.entry_id).forEach((line) => {
    const role = (tables.accounts.find((account) => account.account_id === line.account_id) || {}).role;
    if (roles.indexOf(role) >= 0) sums.set(role, (sums.get(role) || 0) + Number(line.dr_minor || 0) - Number(line.cr_minor || 0));
  }));
  return { rows: [...sums].map(([role, minor]) => ({ role, minor: String(minor) })) };
}
module.exports = { answer };
