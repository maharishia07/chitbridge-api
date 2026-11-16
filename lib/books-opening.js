'use strict';
/*
 * lib/books-opening.js — THE OPENING BALANCES PAGE'S SERVER SIDE (l16, Athi's walk of 16 Nov; critic: shots/l16-openbal/CRITIC.md).
 * OWNS      preview (the engine's own Difference, no write) · replace (reverse + repost in ONE transaction, with a reason and a per-line old → new log) · saved (every live
 *           opening line of a day, with who and when) · years (each year's opening, its carry and the "matches" pair, read from yearBalances / carryForward).
 * CALLED BY routes/books-opening.js (POST /opening/preview · POST /opening/replace · GET /opening · GET /opening/years); POST /opening itself stays in routes/books.js (`require_balanced`).
 * FLOW      rows → control check (bills against the typed control line) → B.prepareOpening → the date and year gates → B.openingDifference (previewEntry, read-only)
 *           replace: dry run of the NEW rows first (so a refusal writes nothing) → reverse every live opening entry of the day → B.postOpening(require_balanced) — all in the caller's transaction.
 * CARD      14-accounting/README
 * ⚠️ NO NEW WRITER: every write is B.reverseEntry / B.postOpening (the one journal path). NO SECOND CALCULATION: the Difference is the posting engine's own Suspense line;
 *    the bills-against-control pair is two sums of the rows the page sent (never recomputed on the page). Country-neutral: names and codes come from the shop's chart and pack.
 */
const B = require('./books');
const S = require('./books-store');
const E = require('./books-engines');

const refuse = B.refuse;
const SUSPENSE_ROLE = 'suspense';
/** a row that names a party carries a bill; the typed control total (`control: true`) is the page's own claim about the sum of those bills, never posted when bills exist */
const hasParty = (row) => !!(row.party_no || row.party_id);
const signed = (row) => Number(row.dr_minor || 0) - Number(row.cr_minor || 0);

/** the rows split into what is posted and the typed control totals; a control total with no bills under it is an ordinary line */
function splitRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const billCodes = new Set(list.filter((row) => !row.control && hasParty(row)).map((row) => String(row.code)));
  const controls = list.filter((row) => row.control && billCodes.has(String(row.code)));
  const post = list.filter((row) => !controls.includes(row)).map((row) => (row.control ? Object.assign({}, row, { control: undefined }) : row));
  return { post, controls };
}
/** bills per control ledger: the sum of the bill rows on each code, set beside the typed control total when there is one (mismatch-not-recompute: two sums of the page's rows, compared) → [{ code, name, bills_minor, typed_minor | null, apart_minor }] */
function billsByControl(post, controls, chart) {
  const codes = Array.from(new Set(post.filter(hasParty).map((row) => String(row.code))));
  return codes.map((code) => {
    const bills = post.filter((row) => hasParty(row) && String(row.code) === code).reduce((total, row) => total + signed(row), 0);
    const control = controls.find((row) => String(row.code) === code);
    const account = chart.find((item) => String(item.code) === code);
    return { code, name: account ? account.name : code, bills_minor: Math.abs(bills), typed_minor: control ? Math.abs(signed(control)) : null, apart_minor: control ? Math.abs(signed(control) - bills) : 0 };
  });
}
/** the sentence of a bills-against-control gap (the preview lists it, the save refuses with it) */
const apartWords = (pair, currency) => 'Bills ' + B.named(pair.bills_minor, currency) + ' vs ' + pair.name + ' ' + B.named(pair.typed_minor, currency) + ': ' + B.named(pair.apart_minor, currency) + ' apart.';
/** a refusal the owner can read (a question or a refusal in words) is a line of the answer; anything else is a fault and goes on up */
function asRefusal(error) {
  const readable = error && (error.refused || error.say || (error.status && error.status < 500) || error.code === 'DATE_INVALID');
  if (!readable) throw error;
  return { name: error.code || 'BOOKS_REFUSED', why: error.say || error.message };
}

/**
 * previewOpening(handle, entity, { rows, date, currency }) → { currency, date, debit_minor, credit_minor, difference_minor, side, bills, refusals[], can_save }
 * The Difference is what the posting engine would park in Suspense (B.openingDifference); the page shows it and never adds a column itself.
 */
async function previewOpening(handle, entity, opening) {
  const refusals = [];
  const { post, controls } = splitRows(opening.rows);
  const chart = await S.accounts(handle, entity);
  const bills = billsByControl(post, controls, chart);
  for (const pair of bills) if (pair.apart_minor) refusals.push({ name: 'BILLS_APART', code: pair.code, why: apartWords(pair, opening.currency) });
  const answer = { currency: opening.currency, date: opening.date, debit_minor: 0, credit_minor: 0, difference_minor: 0, side: null, bills, refusals, can_save: false, posted_rows: post.length };
  if (!post.length) return answer;
  try {
    const plan = await B.prepareOpening(handle, entity, Object.assign({}, opening, { rows: post, client_ref: null }));
    if (plan.setting && plan.setting.enabled && opening.replace) {
      B.openingDateGate(plan.setting, opening.date); /* a change to what is saved: the same-rows and open-bill guards read the old entries, which the change reverses first */
      await B.refuseCarriedYearOpening(handle, entity, opening.date, B.packOf(plan.setting));
    } else if (plan.setting && plan.setting.enabled) await B.guardNewOpening(handle, entity, plan.setting, { date: opening.date, source_ref: null }, plan.lines, plan.rows, plan.chart, plan.refs);
    const dry = await B.openingDifference(handle, entity, plan.event);
    Object.assign(answer, { debit_minor: dry.debit_minor, credit_minor: dry.credit_minor, difference_minor: Math.abs(dry.difference_minor || 0), side: dry.difference_minor ? (dry.difference_minor > 0 ? 'cr' : 'dr') : null });
  } catch (error) {
    refusals.push(asRefusal(error));
  }
  answer.can_save = !refusals.length && answer.difference_minor === 0 && answer.debit_minor > 0;
  return answer;
}

/** the page's save: the typed control totals are checked against their bills and never posted; the rest goes through postOpening, which REFUSES a difference (require_balanced) */
async function postTyped(handle, entity, opening) {
  const { post, controls } = splitRows(opening.rows);
  const apart = billsByControl(post, controls, await S.accounts(handle, entity)).find((pair) => pair.apart_minor);
  if (apart) throw refuse(apartWords(apart, opening.currency), 'BOOKS_REFUSED');
  return B.postOpening(handle, entity, Object.assign({}, opening, { rows: post, require_balanced: true }));
}

/** the live opening lines of a day, one row each, with the ledger's name, the party and the bill (reference, due date) — Move in's three entries on one day all show */
async function liveRows(handle, entity, day) {
  const chart = await S.accounts(handle, entity);
  const byId = new Map(chart.map((item) => [String(item.account_id), item]));
  const lines = (await S.ledgerLines(handle, entity, day, day)).filter((line) => line.is_opening && !line.reverses_entry_id && !line.reversed_by);
  const entries = new Map();
  for (const entryId of new Set(lines.map((line) => line.entry_id))) entries.set(entryId, await S.entry(handle, entity, entryId));
  const taken = new Set();
  const rows = [];
  for (const header of entries.values()) {
    for (const line of header.lines) {
      const account = byId.get(String(line.account_id)) || {};
      const amount = Number(line.dr_minor || line.cr_minor);
      const item = line.party_id ? header.items.find((candidate) => !taken.has(candidate.item_id) && String(candidate.party_id) === String(line.party_id) && String(candidate.account_id) === String(line.account_id) && Number(candidate.amount_minor) === amount) : null;
      if (item) taken.add(item.item_id);
      rows.push({
        entry_id: header.entry_id,
        entry_no: header.entry_no,
        code: String(account.code),
        name: account.name || null,
        role: account.role || null,
        party_id: line.party_id || null,
        dr_minor: Number(line.dr_minor),
        cr_minor: Number(line.cr_minor),
        bill_ref: item ? item.ref : null,
        bill_date: item && item.doc_date ? E.ymd(item.doc_date) : null,
        due_date: item && item.due_date ? E.ymd(item.due_date) : null
      });
    }
  }
  return { rows, entries: Array.from(entries.values()) };
}
/** where an opening came from, as a KIND (the page words it from its own table; no system's name is typed here): typed on the page · moved in · posted another way */
const sourceKindOf = (ref) => (/^opening:grid:/.test(String(ref || '')) ? 'typed' : /^opening:move/.test(String(ref || '')) ? 'moved_in' : 'posted');

/** the ledgers the grid always shows, from the shop's pack: bank, cash, debtors, creditors, the owner's equity and every tax ledger the pack names (its taxLedgers) → [{ code, name, role }] */
async function pinnedOf(handle, entity) {
  const context = await B.ledgerCtx(handle, entity);
  const taxRoles = [];
  Object.values(context.pack.taxLedgers || {}).forEach((head) => Object.values(head || {}).forEach((role) => role && taxRoles.push(role)));
  const wanted = ['bank', 'cash', 'debtors', 'creditors', 'capital'].concat(taxRoles);
  return wanted.map((role) => context.chart.find((item) => item.role === role && !item.is_group && item.active !== false)).filter(Boolean).map((item) => ({ code: String(item.code), name: item.name, role: item.role }));
}
/** savedOpening(handle, entity, day?) → the day's live opening: { date, dates, currency, entries[{ entry_no, by, by_name, at, source }], lines[], suspense_minor }; no day = the first day that has one */
async function savedOpening(handle, entity, day) {
  const dates = await S.openingDays(handle, entity);
  const date = day || dates[0] || null;
  const setting = await B.settingOf(handle, entity);
  const answer = { date, dates, currency: B.curOf(setting), pinned: await pinnedOf(handle, entity), entries: [], lines: [], suspense_minor: 0 };
  if (!date) return answer;
  const live = await liveRows(handle, entity, date);
  const names = await S.namesOf(handle, live.entries.map((header) => header.created_by));
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
  answer.suspense_minor = live.rows.filter((row) => row.role === SUSPENSE_ROLE).reduce((total, row) => total + row.cr_minor - row.dr_minor, 0);
  return answer;
}

const keyOf = (row) => [String(row.code), row.party_id || row.party_no || '', row.bill_ref || ''].join('|');
const netByKey = (rows) => rows.reduce((map, row) => map.set(keyOf(row), (map.get(keyOf(row)) || 0) + signed(row)), new Map());
const sideWords = (net, currency) => (net === 0 ? 'nil' : (net > 0 ? 'Dr ' : 'Cr ') + B.named(Math.abs(net), currency));

/**
 * replaceOpening(handle, entity, { date, reason, rows, client_ref, currency, by }) → the new entry + { reversed: [entry_no…], changes: n }
 * ONE transaction (the caller's handle): the new rows are tried first, read-only (a refusal writes nothing); then each live opening entry of the day is reversed with the reason
 * and the new rows are posted through postOpening(require_balanced). Each changed line is logged old → new with the reason (books_change_log, table `opening`, keyed to the day).
 */
async function replaceOpening(handle, entity, opening) {
  if (!String(opening.reason || '').trim()) throw refuse('A change to the opening balances needs a reason.', 'BOOKS_BAD_REQUEST');
  if (!opening.client_ref) throw refuse('A change needs a client_ref, so a second tap cannot post it twice.', 'BOOKS_BAD_REQUEST');
  const replay = await S.entryBySource(handle, entity, 'opening:' + String(opening.client_ref).slice(0, 80));
  if (replay) return { ok: true, duplicate: true, entry_id: replay.entry_id, entry_no: replay.entry_no, reversed: [], changes: 0 };
  const { post, controls } = splitRows(opening.rows);
  const chart = await S.accounts(handle, entity);
  const apart = billsByControl(post, controls, chart).find((pair) => pair.apart_minor);
  if (apart) throw refuse(apartWords(apart, opening.currency), 'BOOKS_REFUSED');
  const live = await liveRows(handle, entity, opening.date);
  if (!live.entries.length) throw refuse('No opening balances are saved on ' + opening.date + ' to change.', 'BOOKS_NOT_FOUND');
  const plan = await B.prepareOpening(handle, entity, Object.assign({}, opening, { rows: post, client_ref: null }));
  B.openingDateGate(plan.setting, opening.date);
  await B.refuseCarriedYearOpening(handle, entity, opening.date, B.packOf(plan.setting));
  const dry = await B.openingDifference(handle, entity, plan.event); /* a locked opening period refuses here, before anything is reversed */
  if (dry.difference_minor) throw refuse('The opening balances are out by ' + B.named(Math.abs(dry.difference_minor), opening.currency) + ". Add the owner's equity or fix a line; nothing was changed.", 'OPENING_NOT_BALANCED');
  const before = netByKey(live.rows.filter((row) => row.role !== SUSPENSE_ROLE));
  const after = netByKey(post);
  const same = before.size === after.size && Array.from(after).every(([key, net]) => before.get(key) === net);
  /* a bill's own dates: only a date the new rows GIVE is compared (a bill kept with no date typed keeps the one it has) */
  const oldBills = new Map(live.rows.filter((row) => row.bill_ref).map((row) => [keyOf(row), row]));
  const datesMoved = post.filter((row) => row.bill_ref).map((row) => ({ row, old: oldBills.get(keyOf(Object.assign({}, row, { party_id: row.party_id || row.party_no }))) })).filter((item) => item.old && ((item.row.bill_date && item.row.bill_date !== item.old.bill_date) || (item.row.due_date && item.row.due_date !== item.old.due_date)));
  if (same && !datesMoved.length) throw B.conflict('Nothing changed: these opening balances are already saved as ' + live.entries.map((header) => header.entry_no).join(', ') + '.');
  const reversed = [];
  for (const header of live.entries) {
    const result = await B.reverseEntry(handle, entity, header.entry_id, { by: opening.by, reason: opening.reason });
    reversed.push(result.entry_no);
  }
  const posted = await B.postOpening(handle, entity, { rows: post, date: opening.date, currency: opening.currency, client_ref: opening.client_ref, by: opening.by, require_balanced: true });
  const names = new Map(chart.map((item) => [String(item.code), item.name]));
  let changes = 0;
  const changed = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const oldNet = before.get(key) || 0,
      newNet = after.get(key) || 0;
    if (oldNet === newNet) continue;
    const [code, , bill] = key.split('|');
    const field = code + ' ' + (names.get(code) || '') + (bill ? ' · bill ' + bill : '');
    const line = { by: opening.by, table_name: 'opening', row_id: opening.date, field, old: sideWords(oldNet, opening.currency), new: sideWords(newNet, opening.currency) + ' — ' + String(opening.reason).trim() };
    await S.logChange(handle, entity, line);
    changed.push({ field: line.field, old: line.old, new: line.new });
    changes += 1;
  }
  for (const item of datesMoved) {
    const line = { by: opening.by, table_name: 'opening', row_id: opening.date, field: item.row.code + ' ' + (names.get(String(item.row.code)) || '') + ' · bill ' + item.row.bill_ref, old: 'dated ' + (item.old.bill_date || '-') + ' · due ' + (item.old.due_date || '-'), new: 'dated ' + (item.row.bill_date || item.old.bill_date || '-') + ' · due ' + (item.row.due_date || item.old.due_date || '-') + ' — ' + String(opening.reason).trim() };
    await S.logChange(handle, entity, Object.assign({ by: opening.by }, line));
    changed.push({ field: line.field, old: line.old, new: line.new });
    changes += 1;
  }
  return Object.assign({}, posted, { reversed, changes, changed });
}

/** the sum of the debits of a balance-row list (the opening of a year, or what a year carries out) — rows are the engine's own, read as they are */
const equityOf = (rows, chart) => (rows || []).filter((row) => ['capital', 'retained'].includes((chart.find((item) => String(item.code) === String(row.code)) || {}).role)).reduce((total, row) => total + Number(row.cr_minor || 0) - Number(row.dr_minor || 0), 0);
/** a year's period-0 rows, netted per ledger and party (a reversed opening leaves its mirror rows beside it) → the debit total of what stands */
const openingDebits = (rows) => {
  const net = new Map();
  rows.filter((item) => Number(item.period) === 0).forEach((item) => net.set(item.code + '|' + (item.party || item.party_key || ''), (net.get(item.code + '|' + (item.party || item.party_key || '')) || 0) + Number(item.dr_minor || 0) - Number(item.cr_minor || 0)));
  return Array.from(net.values()).reduce((total, value) => total + Math.max(0, value), 0);
};
const debitsOf = (rows) => (rows || []).reduce((total, row) => total + Number(row.dr_minor || 0), 0);
/**
 * yearsView(handle, entity) → { years: [{ fiscal_year, opening_minor, closing_minor, equity_minor, retained_minor, profit_minor, next, next_opening_minor, matches, apart_minor, refusal }] }
 * READ ONLY. The carry is yearBalances + CBLedger.carryForward (computed, never stored); "matches" sets one year's carried-out total beside the next year's opening total —
 * two carried figures, compared, no formula here. A year whose carry the engine refuses (Suspense not nil) shows the engine's sentence, never a blank.
 */
async function yearsView(handle, entity) {
  const context = await B.ledgerCtx(handle, entity);
  const out = [];
  for (const [index, fiscalYear] of context.years.entries()) {
    const balances = await B.yearBalances(handle, entity, fiscalYear, context);
    const row = { fiscal_year: fiscalYear, opening_minor: openingDebits(balances), closing_minor: null, equity_minor: null, retained_minor: null, profit_minor: null, next: context.years[index + 1] || null, next_opening_minor: null, matches: null, apart_minor: null, refusal: null };
    const carry = E.ledger().carryForward({ pack: context.pack, balances, lines: [], fiscal_year: fiscalYear });
    if (carry.ok === false) row.refusal = carry.why || 'The year cannot be carried.';
    else Object.assign(row, { closing_minor: debitsOf(carry.rows), equity_minor: equityOf(carry.rows, context.chart), retained_minor: carry.retained_minor, profit_minor: carry.profit_minor });
    out.push(row);
  }
  for (const [index, row] of out.entries()) {
    const next = out[index + 1];
    if (!next || row.closing_minor == null) continue;
    row.next_opening_minor = next.opening_minor;
    row.apart_minor = Math.abs(row.closing_minor - next.opening_minor);
    row.matches = row.apart_minor === 0;
  }
  return { currency: context.pack.currency, years: out };
}

module.exports = { postTyped, previewOpening, savedOpening, replaceOpening, yearsView, splitRows, billsByControl };
