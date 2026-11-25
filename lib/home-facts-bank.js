'use strict';
/**
 * lib/home-facts-bank.js — the Home Bank card: the LAST SIGNED STATEMENT as carried, else what is waiting, else the bank entries already posted.
 * OWNS      bankCard · bankEntriesPosted · statementLines (no route, no state)
 * CALLED BY lib/home-facts.js (the `bank` card of GET /api/facts/:card), which passes its own small helpers as `helpers`
 * FLOW      bankRead (latest signed · unsigned · chart or posted count, ONE withEntity) -> statementLines -> { lines, figures, state }
 * CARD      28-platform-and-operations/home-facts
 * The statement's date, account and difference_minor come from lib/bank-rec-log.latest (the log GET /api/books/bank/log reads), in its own currency (CUR-1).
 * "Lines to add" is NOT shown: it is not carried, and a figure is never recomputed here. No statement -> a plain status, never a zero.
 */
const bankLog = require('./bank-rec-log');
const booksStore = require('./books-store');
const money = require('./money');

/** how many live entries (not reversed, not reversals) touch the shop's bank account(s): one trip, a count the ledger carries */
async function bankEntriesPosted(handle, entity, helpers) {
  const found = await handle.query(
    `SELECT COUNT(DISTINCT h.entry_id) AS n FROM journal_line l JOIN journal_entry h ON h.entry_id = l.entry_id JOIN ledger_account a ON a.account_id = l.account_id
      WHERE l.entity_id = $1 AND h.entity_id = $1 AND a.role = 'bank' AND h.reverses_entry_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM journal_entry r WHERE r.entity_id = $1 AND r.reverses_entry_id = h.entry_id)`,
    [entity]
  );
  return helpers.toNumber(found.rows[0] && found.rows[0].n);
}

/** the bank facts in one transaction: { row (last signed), waiting (loaded, not signed), posted (entries, only when neither), chart } */
async function bankRead(entity, helpers) {
  const facts = { row: null, waiting: null, posted: 0, chart: [] };
  await helpers.withEntity(entity, async (handle) => {
    facts.row = await bankLog.latest(handle, entity);
    facts.waiting = await bankLog.unsigned(handle, entity);
    if (facts.row) facts.chart = await booksStore.accounts(handle, entity);
    else if (!facts.waiting) facts.posted = await bankEntriesPosted(handle, entity, helpers);
  });
  return facts;
}

/** the lines of a signed statement: its day and account, the difference (or "Nothing unexplained"), and the unsigned one beside it */
function statementLines(row, chart, unsignedLine) {
  const account = chart.find((item) => String(item.account_id) === String(row.account_id)) || null,
    diff = row.difference_minor,
    statementDay = row.period_to || null;
  const lines = [{ text: 'Last statement {when}' + (account && account.name ? ' · ' + account.name : ''), at: statementDay }];
  if (diff != null) {
    /* RW1-04: ONE sign and ONE wording with the Bank page ("A$354.32 unexplained"): the carried remainder is the absolute figure, never "Difference -A$354.32" */
    const major = money.round(Math.abs(diff) / Math.pow(10, money.decimals(row.currency)), row.currency);
    lines.push(diff === 0 ? { text: 'Nothing unexplained', value: 0 } : { text: '{money} unexplained', value: Math.abs(diff), money: { amount: major, currency: row.currency }, tone: 'dn' });
  }
  if (unsignedLine) lines.push(unsignedLine);
  return { lines, figures: { statement: { date: statementDay, account: account ? account.name : null, difference_minor: diff, currency: row.currency } } };
}

/** the answer when no statement is signed: the worked-on one, the posted entries, or "no statement loaded yet" (never a zero) */
function noSignedStatement(facts, unsignedLine, helpers) {
  const { waiting, posted } = facts;
  if (waiting) return { lines: [unsignedLine], figures: { statement: null, unsigned: { at: unsignedLine.at } }, state: 'in_use' };
  /* l16 home-fix: bank entries already in the books (posted from bills, payments, the day's takings) are use of the Bank area even before a statement is loaded: said, never "Not started" */
  if (posted) return { lines: [{ text: helpers.plural(posted, 'bank entry', 'bank entries') + ' in your books · no statement loaded yet', value: posted }], figures: { statement: null, posted }, state: 'in_use' };
  return { lines: [{ text: 'No statement loaded yet' }], figures: { statement: null }, state: 'not_started' };
}

/** the Home Bank card: { lines, figures, state } for ctx.entity, or the not-provisioned answer */
async function bankCard(ctx, helpers) {
  let facts;
  try {
    facts = await bankRead(ctx.entity, helpers);
  } catch (failure) {
    if (helpers.notProvisioned(failure)) return helpers.notStarted('the ledger is not provisioned');
    throw failure;
  }
  /* a statement loaded and worked on but not signed: its day, said plainly (the figure lives on the device, never recomputed here) */
  const unsignedLine = facts.waiting ? { text: 'Worked on {when} · not signed off yet', at: require('./books-hooks').dayOf(facts.waiting.at, 'UTC') } : null;
  if (!facts.row) return noSignedStatement(facts, unsignedLine, helpers);
  return statementLines(facts.row, facts.chart, unsignedLine);
}

module.exports = { bankCard, bankEntriesPosted, statementLines };
