'use strict';
// OWNS      clientOf(job chit's header) → the client a practice job is FOR · readClients(ids) → Map(client id → country, currency, books facts) · dueOf(facts, today) → what falls due next
// CALLED BY lib/work-rows.js (list rows for a practice's job chits: GET /api/work/list · /:chit_id)
// FLOW      hydrate sees business_json.job + all_recipients → clientOf names the subject (no new table: the job chit IS the link) → ONE asEach read of the clients on the page → build puts `client` on the row
// CARD      02-tasks-orders-and-workflow/tasks-and-orders-list-sheet
/**
 * W16 (walk 19 Nov): a row in the accountant's queue said only "Adviser service, standing". It now carries the CLIENT it is for (id, name, country, currency) and what is due
 * (the job's period and the pack's next return). The client is the job chit's own recipient; its country and money are read the way the practice list reads them
 * (db.query.asEach: one statement per client under that client's own binding, one trip), never a second rule: books_setting first, then the client's identity.
 * Nothing here decides who may open the books: that is the books grant's verdict (the page's "Open" goes to the same door the practice list uses).
 */
const db = require('../db');

const CLIENT_SQL = `SELECT $1::uuid AS entity_id,
  (SELECT to_jsonb(s) FROM (SELECT country, fy_start_month, functional_currency, enabled FROM books_setting WHERE entity_id = $1::uuid) s) AS setting,
  (SELECT to_jsonb(i) FROM (SELECT display_name, country, currency_code FROM identities WHERE identity_id = $1::uuid) i) AS identity`;

/** the client a job chit is for: the recipient that is not the sender (a job is sent TO its client), or null when the chit is no job */
function clientOf(header) {
  const jobMark = header && header.business_json && header.business_json.job;
  if (!jobMark) return null;
  const recipient = (Array.isArray(header.all_recipients) ? header.all_recipients : []).find((each) => each && each.entity_id && each.role !== 'sender');
  return recipient ? { entity_id: String(recipient.entity_id), role: jobMark.role || null, period: jobMark.period || null, plug: jobMark.plug || null } : null;
}

/** the books facts of these clients, one trip; a failed read answers an empty map (the row then shows the name only) and says why in the log */
async function readClients(ids) {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map();
  try {
    const found = await db.query.asEach(unique, CLIENT_SQL, (id) => [id]);
    return new Map(found.rows.map((row) => [String(row.entity_id), row]));
  } catch (failure) {
    require('./logger').warn('work: the clients of a page could not be read', { code: failure && failure.code, why: String(failure && failure.message).slice(0, 160) });
    return new Map();
  }
}

/** the next return due for the client's pack (the practice list's own basOf), or null when its books are off / the country has no pack */
function dueOf(row, today) {
  const setting = row && row.setting;
  if (!setting || !setting.country) return null;
  const nextReturn = require('./books-practice').basOf(setting, today);
  return nextReturn.due_date ? { form: nextReturn.form, due_date: nextReturn.due_date, due_in_days: nextReturn.due_in_days } : null;
}

/** the client's country in capitals: its books first, then its own identity, else null (never a default) */
function countryOf(setting, identity) {
  const code = (setting && setting.country) || (identity && identity.country);
  return code ? String(code).toUpperCase() : null;
}

/** the client's money: its books' functional currency first, then its identity's, else null */
function currencyOf(setting, identity) {
  return (setting && setting.functional_currency) || (identity && identity.currency_code) || null;
}

/** the `client` of a work row: who, where, in what money, and what is due */
function shape(link, facts, today) {
  const setting = (facts && facts.setting) || null, identity = (facts && facts.identity) || null;
  return {
    entity_id: link.entity_id,
    name: (identity && identity.display_name) || null,
    country: countryOf(setting, identity),
    currency: currencyOf(setting, identity),
    role: link.role,
    period: link.period,
    due: dueOf(facts, today)
  };
}

module.exports = { clientOf, readClients, shape };
