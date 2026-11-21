'use strict';
/*
 * lib/books-opening.js — THE OPENING BALANCES PAGE'S SERVER SIDE (l16, Athi's walk of 16 Nov; critic: shots/l16-openbal/CRITIC.md).
 * OWNS      preview (the engine's own Difference, no write) · replace (reverse + repost in ONE transaction, with a reason and a per-line old → new log) · saved (every live
 *           opening line of a day, with who and when) · years (each year's opening, its carry and the "matches" pair, read from yearBalances / carryForward).
 * CALLED BY routes/books-opening.js (POST /opening/preview · POST /opening/replace · GET /opening · GET /opening/years); POST /opening itself stays in routes/books.js (`require_balanced`).
 * FLOW      rows → control check (bills against the typed control line) → Books.prepareOpening → the date and year gates → Books.openingDifference (previewEntry, read-only)
 *           replace: dryRun run of the NEW rows first (so a refusal writes nothing) → reverse every live opening entry of the day → Books.postOpening(require_balanced) — all in the caller's transaction.
 * CARD      14-accounting/README
 * ⚠️ NO NEW WRITER: every write is Books.reverseEntry / Books.postOpening (the one journal path). NO SECOND CALCULATION: the Difference is the posting engine's own Suspense line;
 *    the bills-against-control pair is two sums of the rows the page sent (never recomputed on the page). Country-neutral: names and codes come from the shop's chart and pack.
 */
const Books = require('./books');
const Store = require('./books-store');
const Engines = require('./books-engines');
const MoneyOps = require('./books-money-ops');

const refuse = Books.refuse;
const SUSPENSE_ROLE = 'suspense';
/** a row that names a party carries a bill; the typed control total (`control: true`) is the page's own claim about the sum of those bills, never posted when bills exist */
const hasParty = (row) => !!(row.party_no || row.party_id);
/** a row's Dr − Cr in minor units — the engine's minusMoney, in the opening's currency (CUR-1: every sum below carries it too, a mismatch refuses) */
const signed = (row, currency) => MoneyOps.diffMinor(row.dr_minor, row.cr_minor, currency);

/** the opening's currency: the one the page names, else the books' own (the same default prepareOpening reads) */
const currencyOf = async (handle, entity, opening) => opening.currency || Books.curOf(await Books.settingOf(handle, entity));

/** the rows split into what is posted and the typed control totals; a control total with no bills under it is an ordinary line */
function splitRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const billCodes = new Set(list.filter((row) => !row.control && hasParty(row)).map((row) => String(row.code)));
  const controls = list.filter((row) => row.control && billCodes.has(String(row.code)));
  const post = list.filter((row) => !controls.includes(row)).map((row) => (row.control ? Object.assign({}, row, { control: undefined }) : row));
  return { post, controls };
}
/** bills per control ledger: the sum of the bill rows on each code, set beside the typed control total when there is one (mismatch-not-recompute: two sums of the page's rows, compared) → [{ code, name, bills_minor, typed_minor | null, apart_minor }] */
function billsByControl(post, controls, chart, currency) {
  const codes = Array.from(new Set(post.filter(hasParty).map((row) => String(row.code))));
  return codes.map((code) => {
    const bills = MoneyOps.sumMinor(post.filter((row) => hasParty(row) && String(row.code) === code), currency, (row) => signed(row, currency));
    const control = controls.find((row) => String(row.code) === code);
    const account = chart.find((item) => String(item.code) === code);
    return { code, name: account ? account.name : code, bills_minor: Math.abs(bills), typed_minor: control ? Math.abs(signed(control, currency)) : null, apart_minor: control ? Math.abs(MoneyOps.diffMinor(signed(control, currency), bills, currency)) : 0 };
  });
}
/** the sentence of a bills-against-control gap (the preview lists it, the save refuses with it) */
const apartWords = (pair, currency) => 'Bills ' + Books.named(pair.bills_minor, currency) + ' vs ' + pair.name + ' ' + Books.named(pair.typed_minor, currency) + ': ' + Books.named(pair.apart_minor, currency) + ' apart.';
/** a refusal the owner can read (a question or a refusal in words) is a line of the answer; anything else is a fault and goes on up */
function asRefusal(error) {
  const readable = error && (error.refused || error.say || (error.status && error.status < 500) || error.code === 'DATE_INVALID');
  if (!readable) throw error;
  return { name: error.code || 'BOOKS_REFUSED', why: error.say || error.message };
}

/** the gates a preview runs when the books are on: a change to what is saved meets the date and carried-year gates, a new opening the new-opening guards */
async function guardPreview(handle, entity, opening, plan) {
  if (!(plan.setting && plan.setting.enabled)) return;
  if (opening.replace) {
    Books.openingDateGate(plan.setting, opening.date); /* a change to what is saved: the same-rows and open-bill guards read the old entries, which the change reverses first */
    await Books.refuseCarriedYearOpening(handle, entity, opening.date, Books.packOf(plan.setting));
  } else await Books.guardNewOpening(handle, entity, plan.setting, { date: opening.date, source_ref: null }, plan.lines, plan.rows, plan.chart, plan.refs);
}
/** the engine's dry run as the preview carries it: both totals, the Difference (always positive) and the side it falls on (cr, dr, or none) */
function differenceOf(dryRun) {
  const difference = dryRun.difference_minor;
  return { debit_minor: dryRun.debit_minor, credit_minor: dryRun.credit_minor, difference_minor: Math.abs(difference || 0), side: difference ? (difference > 0 ? 'cr' : 'dr') : null };
}
/**
 * previewOpening(handle, entity, { rows, date, currency }) → { currency, date, debit_minor, credit_minor, difference_minor, side, bills, refusals[], can_save }
 * The Difference is what the posting engine would park in Suspense (Books.openingDifference); the page shows it and never adds a column itself.
 */
async function previewOpening(handle, entity, opening) {
  const refusals = [];
  const { post, controls } = splitRows(opening.rows);
  const chart = await Store.accounts(handle, entity);
  const bills = billsByControl(post, controls, chart, await currencyOf(handle, entity, opening));
  for (const pair of bills) if (pair.apart_minor) refusals.push({ name: 'BILLS_APART', code: pair.code, why: apartWords(pair, opening.currency) });
  const answer = { currency: opening.currency, date: opening.date, debit_minor: 0, credit_minor: 0, difference_minor: 0, side: null, bills, refusals, can_save: false, posted_rows: post.length };
  if (!post.length) return answer;
  try {
    const plan = await Books.prepareOpening(handle, entity, Object.assign({}, opening, { rows: post, client_ref: null }));
    await guardPreview(handle, entity, opening, plan);
    Object.assign(answer, differenceOf(await Books.openingDifference(handle, entity, plan.event)));
  } catch (error) {
    refusals.push(asRefusal(error));
  }
  answer.can_save = !refusals.length && answer.difference_minor === 0 && answer.debit_minor > 0;
  return answer;
}

/** the page's save: the typed control totals are checked against their bills and never posted; the rest goes through postOpening, which REFUSES a difference (require_balanced) */
async function postTyped(handle, entity, opening) {
  const { post, controls } = splitRows(opening.rows);
  const apart = billsByControl(post, controls, await Store.accounts(handle, entity), await currencyOf(handle, entity, opening)).find((pair) => pair.apart_minor);
  if (apart) throw refuse(apartWords(apart, opening.currency), 'BOOKS_REFUSED');
  return Books.postOpening(handle, entity, Object.assign({}, opening, { rows: post, require_balanced: true }));
}

/** the bill (party item) one opening line carries: the first unclaimed item of the same party, ledger and amount; null for a line with no party */
function billOfLine(header, line, taken) {
  if (!line.party_id) return null;
  const amount = Number(line.dr_minor) || Number(line.cr_minor); /* a database bigint arrives as text: '0' is truthy */
  const item = header.items.find((candidate) => !taken.has(candidate.item_id) && String(candidate.party_id) === String(line.party_id) && String(candidate.account_id) === String(line.account_id) && Math.abs(Number(candidate.amount_minor)) === amount);
  if (item) taken.add(item.item_id);
  return item || null;
}
/** one live opening line as a row of the page: the entry, the ledger, the party and the bill (reference, dates) */
function liveRowOf(header, line, account, item) {
  return {
    entry_id: header.entry_id,
    entry_no: header.entry_no,
    code: String(account.code),
    name: account.name || null,
    role: account.role || null,
    party_id: line.party_id || null,
    dr_minor: Number(line.dr_minor),
    cr_minor: Number(line.cr_minor),
    bill_ref: item ? item.ref : null,
    bill_date: item && item.doc_date ? Engines.ymd(item.doc_date) : null,
    due_date: item && item.due_date ? Engines.ymd(item.due_date) : null
  };
}
/** the live opening lines of a day, one row each, with the ledger's name, the party and the bill (reference, due date) — Move in's three entries on one day all show */
async function liveRows(handle, entity, openedOn) {
  const chart = await Store.accounts(handle, entity);
  const byId = new Map(chart.map((item) => [String(item.account_id), item]));
  const lines = (await Store.ledgerLines(handle, entity, openedOn, openedOn)).filter((line) => line.is_opening && !line.reverses_entry_id && !line.reversed_by);
  const entries = new Map();
  for (const entryId of new Set(lines.map((line) => line.entry_id))) entries.set(entryId, await Store.entry(handle, entity, entryId));
  const taken = new Set();
  const rows = [];
  for (const header of entries.values()) for (const line of header.lines) rows.push(liveRowOf(header, line, byId.get(String(line.account_id)) || {}, billOfLine(header, line, taken)));
  return { rows, entries: Array.from(entries.values()) };
}
/** where an opening came from, as a KIND (the page words it from its own table; no system's name is typed here): typed on the page · moved in · posted another way */
const sourceKindOf = (ref) => (/^opening:grid:/.test(String(ref || '')) ? 'typed' : /^opening:move/.test(String(ref || '')) ? 'moved_in' : 'posted');

/** the ledgers the grid always shows, from the shop's pack: bank, cash, debtors, creditors, the owner's equity and every tax ledger the pack names (its taxLedgers) → [{ code, name, role }] */
async function pinnedOf(handle, entity) {
  const context = await Books.ledgerCtx(handle, entity);
  const taxRoles = [];
  Object.values(context.pack.taxLedgers || {}).forEach((head) => Object.values(head || {}).forEach((role) => role && taxRoles.push(role)));
  const wanted = ['bank', 'cash', 'debtors', 'creditors', 'capital'].concat(taxRoles);
  return wanted.map((role) => context.chart.find((item) => item.role === role && !item.is_group && item.active !== false)).filter(Boolean).map((item) => ({ code: String(item.code), name: item.name, role: item.role }));
}
/** savedOpening(handle, entity, day?) → the day's live opening: { date, dates, currency, entries[{ entry_no, by, by_name, at, source }], lines[], suspense_minor }; no day = the first day that has one */
async function savedOpening(handle, entity, openedOn) {
  const dates = await Store.openingDays(handle, entity);
  const date = openedOn || dates[0] || null;
  const setting = await Books.settingOf(handle, entity);
  const answer = { date, dates, default_date: Books.ledgerStart(setting, Books.packOf(setting)), currency: Books.curOf(setting), pinned: await pinnedOf(handle, entity), entries: [], lines: [], suspense_minor: 0 };
  if (!date) return answer;
  const live = await liveRows(handle, entity, date);
  const names = await Store.namesOf(handle, entity, live.entries.map((header) => header.created_by));
  answer.entries = live.entries.map((header) => ({
    entry_id: header.entry_id,
    entry_no: header.entry_no,
    by: header.created_by || null,
    by_name: names.get(String(header.created_by)) || null,
    at: header.created_at || null,
    source: { kind: sourceKindOf(header.source_ref) },
    narration: header.narration || null
  }));
  answer.lines = live.rows;
  answer.suspense_minor = MoneyOps.sumMinor(live.rows.filter((row) => row.role === SUSPENSE_ROLE), answer.currency, (row) => MoneyOps.diffMinor(row.cr_minor, row.dr_minor, answer.currency));
  return answer;
}

const keyOf = (row) => [String(row.code), row.party_id || row.party_no || '', row.bill_ref || ''].join('|');
const netByKey = (rows, currency) => {
  const net = new Map();
  rows.forEach((row) => net.set(keyOf(row), MoneyOps.addMinor(net.get(keyOf(row)) || 0, signed(row, currency), currency)));
  return net;
};
const sideWords = (net, currency) => (net === 0 ? 'nil' : (net > 0 ? 'Dr ' : 'Cr ') + Books.named(Math.abs(net), currency));

/** the gates of a change, before anything is reversed: a reason, a client_ref, a replay, bills against control, a live opening to change, the date and year gates, the dry run */
async function checkReplace(handle, entity, opening, planned) {
  const { post, controls, chart, currency } = planned;
  const apart = billsByControl(post, controls, chart, currency).find((pair) => pair.apart_minor);
  if (apart) throw refuse(apartWords(apart, opening.currency), 'BOOKS_REFUSED');
  const live = await liveRows(handle, entity, opening.date);
  if (!live.entries.length) throw refuse('No opening balances are saved on ' + opening.date + ' to change.', 'BOOKS_NOT_FOUND');
  await refuseSettledBills(handle, entity, live.rows, currency);
  const plan = await Books.prepareOpening(handle, entity, Object.assign({}, opening, { rows: post, client_ref: null }));
  Books.openingDateGate(plan.setting, opening.date);
  await Books.refuseCarriedYearOpening(handle, entity, opening.date, Books.packOf(plan.setting));
  const dryRun = await Books.openingDifference(handle, entity, plan.event); /* a locked opening period refuses here, before anything is reversed */
  if (dryRun.difference_minor) throw refuse('The opening balances are out by ' + Books.named(Math.abs(dryRun.difference_minor), opening.currency) + ". Add the owner's equity or fix a line; nothing was changed.", 'OPENING_NOT_BALANCED');
  return live;
}
/**
 * F2 (Fable 17 Nov): a replace reverses every live opening entry, and reversing a bill releases the payment allocated to it (FIN-64) — the bill would come back fully owed beside a receipt left unallocated.
 * So a replace is refused, in words, while any live opening bill has an allocation against it; the owner undoes that payment (or its allocation) first. Nothing is reversed or written.
 */
async function refuseSettledBills(handle, entity, rows, currency) {
  const named = [];
  const groups = new Map();
  rows.filter((row) => row.bill_ref && row.party_id).forEach((row) => groups.set(row.party_id + '|' + row.code, row));
  const accounts = await Store.accounts(handle, entity);
  for (const row of groups.values()) {
    const account = accounts.find((item) => String(item.code) === String(row.code));
    const settled = require('./books-carry-help').settledOf((await Store.items(handle, entity, row.party_id, account && account.account_id)).map(Engines.itemOf));
    rows.filter((bill) => bill.bill_ref && bill.party_id === row.party_id && bill.code === row.code && settled[bill.bill_ref]).forEach((bill) => named.push(bill.bill_ref + ' (' + Books.named(settled[bill.bill_ref], currency) + ' already settled)'));
  }
  if (named.length) throw refuse('These opening bills already have payments allocated to them: ' + named.join(', ') + '. Changing the opening balances would release those payments. Undo the payment first, then change the opening balances; nothing was changed.', 'BOOKS_REFUSED');
}
/** the bills whose own dates move: only a date the new rows GIVE is compared (a bill kept with no date typed keeps the one it has) → [{ row, old }] */
function datesMovedOf(post, liveRowList) {
  const oldBills = new Map(liveRowList.filter((row) => row.bill_ref).map((row) => [keyOf(row), row]));
  const moved = (item) => item.old && ((item.row.bill_date && item.row.bill_date !== item.old.bill_date) || (item.row.due_date && item.row.due_date !== item.old.due_date));
  return post.filter((row) => row.bill_ref).map((row) => ({ row, old: oldBills.get(keyOf(Object.assign({}, row, { party_id: row.party_id || row.party_no }))) })).filter(moved);
}
/** the log line of each ledger whose net moved, old → new with the reason */
function netChangeLines(opening, names, before, after) {
  const reason = String(opening.reason).trim();
  const lines = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const oldNet = before.get(key) || 0,
      newNet = after.get(key) || 0;
    if (oldNet === newNet) continue;
    const [code, , bill] = key.split('|');
    const field = code + ' ' + (names.get(code) || '') + (bill ? ' · bill ' + bill : '');
    lines.push({ by: opening.by, table_name: 'opening', row_id: opening.date, field, old: sideWords(oldNet, opening.currency), new: sideWords(newNet, opening.currency) + ' — ' + reason });
  }
  return lines;
}
/** the log line of each bill whose own dates moved, old → new with the reason */
function dateChangeLines(opening, names, datesMoved) {
  const reason = String(opening.reason).trim();
  const lines = [];
  for (const item of datesMoved) {
    const dates = (row) => 'dated ' + (row.bill_date || '-') + ' · due ' + (row.due_date || '-');
    const field = item.row.code + ' ' + (names.get(String(item.row.code)) || '') + ' · bill ' + item.row.bill_ref;
    lines.push({ by: opening.by, table_name: 'opening', row_id: opening.date, field, old: dates(item.old), new: 'dated ' + (item.row.bill_date || item.old.bill_date || '-') + ' · due ' + (item.row.due_date || item.old.due_date || '-') + ' — ' + reason });
  }
  return lines;
}
/** log each changed line old → new with the reason (books_change_log, table `opening`, keyed to the day) → [{ field, old, new }] */
async function logChanges(handle, entity, opening, chart, before, after, datesMoved) {
  const names = new Map(chart.map((item) => [String(item.code), item.name]));
  const lines = netChangeLines(opening, names, before, after).concat(dateChangeLines(opening, names, datesMoved));
  for (const line of lines) await Store.logChange(handle, entity, line);
  return lines.map((line) => ({ field: line.field, old: line.old, new: line.new }));
}

/**
 * replaceOpening(handle, entity, { date, reason, rows, client_ref, currency, by }) → the new entry + { reversed: [entry_no…], changes: n }
 * ONE transaction (the caller's handle): the new rows are tried first, read-only (a refusal writes nothing); then each live opening entry of the day is reversed with the reason
 * and the new rows are posted through postOpening(require_balanced). Each changed line is logged old → new with the reason (books_change_log, table `opening`, keyed to the day).
 */
async function replaceOpening(handle, entity, opening) {
  if (!String(opening.reason || '').trim()) throw refuse('A change to the opening balances needs a reason.', 'BOOKS_BAD_REQUEST');
  if (!opening.client_ref) throw refuse('A change needs a client_ref, so a second tap cannot post it twice.', 'BOOKS_BAD_REQUEST');
  const replay = await Store.entryBySource(handle, entity, 'opening:' + require('./books-input').clientRef(opening.client_ref));
  if (replay) return { ok: true, duplicate: true, entry_id: replay.entry_id, entry_no: replay.entry_no, reversed: [], changes: 0 };
  const { post, controls } = splitRows(opening.rows);
  const chart = await Store.accounts(handle, entity);
  const currency = await currencyOf(handle, entity, opening);
  const live = await checkReplace(handle, entity, opening, { post, controls, chart, currency });
  const before = netByKey(live.rows.filter((row) => row.role !== SUSPENSE_ROLE), currency);
  const after = netByKey(post, currency);
  const same = before.size === after.size && Array.from(after).every(([key, net]) => before.get(key) === net);
  const datesMoved = datesMovedOf(post, live.rows);
  if (same && !datesMoved.length) throw Books.conflict('Nothing changed: these opening balances are already saved as ' + live.entries.map((header) => header.entry_no).join(', ') + '.');
  const reversed = [];
  for (const header of live.entries) {
    const result = await Books.reverseEntry(handle, entity, header.entry_id, { by: opening.by, reason: opening.reason });
    reversed.push(result.entry_no);
  }
  const posted = await Books.postOpening(handle, entity, { rows: post, date: opening.date, currency: opening.currency, client_ref: opening.client_ref, by: opening.by, require_balanced: true });
  const changed = await logChanges(handle, entity, opening, chart, before, after, datesMoved);
  return Object.assign({}, posted, { reversed, changes: changed.length, changed });
}

/** the sum of the debits of a balance-row list (the opening of a year, or what a year carries out) — rows are the engine's own, read as they are */
const equityOf = (rows, chart, currency) => MoneyOps.sumMinor((rows || []).filter((row) => ['capital', 'retained'].includes((chart.find((item) => String(item.code) === String(row.code)) || {}).role)), currency, (row) => MoneyOps.diffMinor(row.cr_minor, row.dr_minor, currency));
/**
 * SAMECOUNT A-F-39: the engine keeps BOTH grains of a balance (the account's own total, party null, AND each party under it - lib/ledger.js accumulate). A total over the rows must read
 * ONE grain or a debtor's 1,100 counts twice (opening 7,500 over a 6,400 entry). The account grain is the one the trial balance totals.
 */
const accountGrain = (rows) => (rows || []).filter((row) => !row.party);
/** a year's period-0 rows, netted per ledger and party (a reversed opening leaves its mirror rows beside it) → the debit total of what stands */
const openingDebits = (rows, currency) => {
  const net = new Map();
  accountGrain(rows).filter((item) => Number(item.period) === 0).forEach((item) => net.set(item.code + '|' + (item.party || item.party_key || ''), MoneyOps.addMinor(net.get(item.code + '|' + (item.party || item.party_key || '')) || 0, MoneyOps.diffMinor(item.dr_minor, item.cr_minor, currency), currency)));
  return MoneyOps.sumMinor(Array.from(net.values()), currency, (value) => Math.max(0, value));
};
const debitsOf = (rows, currency) => MoneyOps.sumMinor(accountGrain(rows), currency, (row) => row.dr_minor);
/**
 * yearsView(handle, entity) → { years: [{ fiscal_year, opening_minor, closing_minor, equity_minor, retained_minor, profit_minor, next, next_opening_minor, matches, apart_minor, refusal }] }
 * READ ONLY. The carry is yearBalances + CBLedger.carryForward (computed, never stored); "matches" sets one year's carried-out total beside the next year's opening total —
 * two carried figures, compared, no formula here. A year whose carry the engine refuses (Suspense not nil) shows the engine's sentence, never a blank.
 */
async function yearsView(handle, entity) {
  const context = await Books.ledgerCtx(handle, entity);
  const out = [];
  for (const [index, fiscalYear] of context.years.entries()) {
    const balances = await Books.yearBalances(handle, entity, fiscalYear, context);
    const row = { fiscal_year: fiscalYear, opening_minor: openingDebits(balances, context.pack.currency), closing_minor: null, equity_minor: null, retained_minor: null, profit_minor: null, next: context.years[index + 1] || null, next_opening_minor: null, matches: null, apart_minor: null, refusal: null };
    const carry = await Books.carryOut(handle, entity, context, fiscalYear, balances); /* b873: the kept carry when its key still matches, else the engine's own answer */
    if (carry.ok === false) row.refusal = carry.why || 'The year cannot be carried.';
    else Object.assign(row, { closing_minor: debitsOf(carry.rows, context.pack.currency), equity_minor: equityOf(carry.rows, context.chart, context.pack.currency), retained_minor: carry.retained_minor, profit_minor: carry.profit_minor });
    out.push(row);
  }
  for (const [index, row] of out.entries()) {
    const next = out[index + 1];
    if (!next || row.closing_minor == null) continue;
    row.next_opening_minor = next.opening_minor;
    row.apart_minor = Math.abs(MoneyOps.diffMinor(row.closing_minor, next.opening_minor, context.pack.currency));
    row.matches = row.apart_minor === 0;
  }
  return { currency: context.pack.currency, years: out };
}

module.exports = { postTyped, previewOpening, savedOpening, replaceOpening, yearsView, splitRows, billsByControl };
