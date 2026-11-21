/**
 * lib-period-units.test.cjs — the small period / return / marks modules, rule by rule. Offline, no database: the store and the books writer are replaced where a module reaches for them.
 * Modules: lib/books-period-lock.js · books-period-state.js · books-period-taxed.js · books-period-choices.js · books-return-split.js · mark-door.js · mark-embed.js · books-manual-bill-tax.js
 * Unit per rule · the refusal path · fail closed. Run: node tests/lib-period-units.test.cjs
 * CARD 14-accounting/README
 */
'use strict';
process.env.SHOP_CLOCK_ALLOW = '1';
const Lock = require('../lib/books-period-lock');
const State = require('../lib/books-period-state');
const Taxed = require('../lib/books-period-taxed');
const Choices = require('../lib/books-period-choices');
const ReturnSplit = require('../lib/books-return-split');
const MarkDoor = require('../lib/mark-door');
const MarkEmbed = require('../lib/mark-embed');
const ManualBillTax = require('../lib/books-manual-bill-tax');
const Books = require('../lib/books');
const Store = require('../lib/books-store');
const Schema = require('../lib/schema');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const thrown = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

(async () => {
  // ---- books-period-lock
  ok('nextMonth rolls a month and the year end', Lock.nextMonth('2026-01-15') === '2026-02-01' && Lock.nextMonth('2026-12-31') === '2027-01-01');
  ok('a month locked by a tax close is known by the reason PREFIX, not its label', Lock.lockedByTaxClose({ status: 'soft_locked', reason: 'Tax period closed — FY27 Q1 (reworded)' }) === true);
  ok('refusal: an open month, a hand lock and no row are not tax-closed', Lock.lockedByTaxClose({ status: 'open', reason: 'Tax period closed — x' }) === false && Lock.lockedByTaxClose({ status: 'soft_locked', reason: 'month end' }) === false && Lock.lockedByTaxClose(null) === false);
  const shop = { country: 'AU' };
  const span = { start: '2026-07-01', end: '2026-09-30', label: 'Q1' };
  const months = await Lock.monthsCovered({}, 'shop', shop, span, []);
  ok('monthsCovered lists each month of the span with the row the books hold (none yet)', months.length === 3 && months.every((month) => month.row === null));
  const rows = months.map((month, index) => ({ fiscal_year: month.fiscal_year, period: month.period, status: index === 0 ? 'hard_locked' : index === 1 ? 'soft_locked' : 'open', reason: index === 1 ? 'Tax period closed — Q1' : null }));
  const setCalls = [];
  const realPeriods = Store.periods, realSetPeriod = Books.setPeriod;
  Store.periods = async () => rows;
  Books.setPeriod = async (handle, entity, fiscalYear, period, status, by, reason) => { setCalls.push({ period, status, reason }); };
  const locked = await Lock.lockCovered({}, 'shop', shop, span, 'owner');
  ok('lockCovered locks only the open month; a hard-locked month and one already tax-closed are left alone', locked.length === 1 && setCalls.length === 1 && setCalls[0].status === 'soft_locked' && setCalls[0].reason === 'Tax period closed — Q1', JSON.stringify(setCalls));
  ok('closedBefore reads closed only when every covered month is tax-closed', (await Lock.closedBefore({}, 'shop', shop, span, rows)) === false);
  Store.periods = realPeriods; Books.setPeriod = realSetPeriod;

  // ---- books-period-state
  const stateRows = [{ fiscal_year: 2026, period: 1, start_date: '2025-07-01', status: 'soft_locked', reason: 'Tax period closed — Q1' }, { fiscal_year: 2026, period: 2, start_date: '2025-08-01', status: 'open' }, { fiscal_year: 2026, period: 0, start_date: '2025-06-01', status: 'open' }];
  const uncovered = State.uncoveredState(stateRows, 2026, { needs: 'stagger', why: 'The FTA gives the stagger.' });
  ok('uncoveredState names the months no closed tax period covers, in words, and not the opening period', uncovered.applies === true && uncovered.open.length === 1 && uncovered.open[0] === 'Aug 2025' && uncovered.needs === 'stagger' && uncovered.open_codes.length === 0, JSON.stringify(uncovered));

  // ---- books-period-taxed
  ok('the role lists are the pack ledger roles the tax reads', Taxed.TAX_ROLES.includes('gst_paid') && Taxed.MONEY_ROLES.includes('bank') && Taxed.SALES_ROLES.includes('sales'));
  const realIncome = Store.taxedIncomeLines, realOnly = Store.taxedOnlyLines;
  Store.taxedIncomeLines = async () => [{ code: 4900, dr_minor: '0', cr_minor: '500' }];
  Store.taxedOnlyLines = async () => [{ code: 6000, dr_minor: '70', cr_minor: '0' }];
  const movement = [{ code: '6000', role: 'purchases', dr_minor: 100, cr_minor: 0 }, { code: '6100', role: 'purchases', dr_minor: 40, cr_minor: 0 }];
  await Taxed.addTaxedRows({}, 'shop', { pack: { taxLedgers: { gst: { output: 'gst_collected' } }, returns: { taxedOnly: [{ tax_role: 'gst_paid', roles: ['purchases'] }] } } }, '2026-07-01', '2026-09-30', movement);
  ok('addTaxedRows joins taxed income on a non-sales ledger when the pack names gst_collected', movement.some((row) => row.role === 'sales_taxed_other' && row.cr_minor === 500));
  ok('addTaxedRows narrows a taxedOnly box to the postings that carried the tax; a bill with no tax reads nil', movement[0].dr_minor === 70 && movement[1].dr_minor === 0);
  const plain = [{ code: '6000', role: 'purchases', dr_minor: 100, cr_minor: 0 }];
  await Taxed.addTaxedRows({}, 'shop', { pack: { taxLedgers: {} } }, '2026-07-01', '2026-09-30', plain);
  ok('a pack with no such head reads whole accounts as before (nothing added, nothing narrowed)', plain.length === 1 && plain[0].dr_minor === 100);
  Store.taxedIncomeLines = realIncome; Store.taxedOnlyLines = realOnly;

  // ---- books-period-choices
  const monthRows = [{ fiscal_year: 2026, period: 1, start_date: '2025-07-01', end_date: '2025-07-31', status: 'soft_locked', entries: 4 }, { fiscal_year: 2026, period: 2, start_date: '2025-08-01', end_date: '2025-08-31', status: 'open', entries: 2 }, { fiscal_year: 2026, period: 0, start_date: '2025-06-01', end_date: '2025-06-30', status: 'open', entries: 0 }];
  const withMarks = Choices.withChecked(monthRows, new Map([['2026|1', { checked: 3, of: 4 }]]));
  ok('withChecked carries a month\'s checked and of, and null for a month with no read', withMarks[0].checked === 3 && withMarks[0].of === 4 && withMarks[1].checked === null);
  const years = Choices.yearsOf(withMarks);
  ok('yearsOf gives one line per financial year, the opening period left out', years.length === 1 && years[0].fy === 2026 && years[0].entries === 6, JSON.stringify(years));
  ok('fail closed: a year with a busy month nobody read carries no checked count (null, never a smaller number)', years[0].checked === null && years[0].of === null, JSON.stringify(years[0]));
  ok('underReview is null while no financial year has ended', Choices.underReview(monthRows, '2025-08-15') === null);
  const realCoverage = require('../lib/review-mark').coverageSql;
  require('../lib/review-mark').coverageSql = () => null;
  ok('checkedByMonth reads nothing (an empty map) when marking cannot be read', (await Choices.checkedByMonth({}, 'shop', monthRows, [{ fiscal_year: 2026, period: 1, entries: 4 }])).size === 0);
  require('../lib/review-mark').coverageSql = realCoverage;

  // ---- books-return-split
  const boxes = [{ code: 'G1', amount_minor: 300, tax_minor: null, accounts: [{ code: '4000', name: 'Sales' }, { code: '4100', name: 'Other' }] }];
  const answers = { 4000: [{ code: 'G1', amount_minor: 200, tax_minor: null }], 4100: [{ code: 'G1', amount_minor: 100, tax_minor: null }] };
  const returnFor = (pack, period, ledgerRows) => ({ ok: true, boxes: answers[ledgerRows[0].code] });
  const ledgerRows = [{ code: '4000' }, { code: '4100' }];
  const split = ReturnSplit.splitBoxes(returnFor, {}, {}, ledgerRows, {}, boxes, 'AUD');
  ok('splitBoxes shows each ledger its own share, largest first, and the parts add up to the box (split_ok)', split[0].accounts[0].code === '4000' && split[0].accounts_n === 2 && split[0].split_ok === true, JSON.stringify(split[0]));
  const apart = ReturnSplit.splitBoxes(returnFor, {}, {}, ledgerRows, {}, [Object.assign({}, boxes[0], { amount_minor: 999 })], 'AUD');
  ok('refusal: when the ledgers do not add up to the box the box says so (split_ok false), never forced', apart[0].split_ok === false);
  const refusedReturn = ReturnSplit.splitBoxes(() => ({ ok: false }), {}, {}, ledgerRows, {}, boxes, 'AUD');
  ok('fail closed: an engine that refuses a ledger leaves that ledger with no figure', refusedReturn[0].accounts.every((item) => item.amount_minor === null) && refusedReturn[0].split_ok === false);
  const many = Array.from({ length: ReturnSplit.TOP + 3 }, (_, index) => ({ code: String(1000 + index), name: 'L' + index }));
  const crowded = ReturnSplit.splitBoxes(() => ({ ok: true, boxes: [] }), {}, {}, [], {}, [{ code: 'G1', accounts: many }], 'AUD');
  ok('a box with hundreds of ledgers shows the top few and "and n more"', crowded[0].accounts.length === ReturnSplit.TOP && crowded[0].accounts_more_n === 3);

  // ---- mark-door
  const owner = { identity_id: 'i1', display_name: 'Ravi', entity_id: 'e1', identity_type: 'entity' };
  const plainCtx = MarkDoor.ctxOf({ identity: owner, headers: {}, user: owner });
  ok('ctxOf on a plain request is the person themselves, via self', plainCtx.real.identity_id === 'i1' && plainCtx.via.kind === 'self');
  const acting = MarkDoor.ctxOf({ identity: Object.assign({}, owner, { acting_preset: 'auditor' }), realIdentity: { identity_id: 'i9', display_name: 'Ann', parent_entity_id: 'f1' }, acting_for_grant: 'g1', acting_firm_name: 'Firm' });
  ok('ctxOf under a grant is the real person and the firm, via the grant, never an owner', acting.real.identity_id === 'i9' && acting.real.entity_id === 'f1' && acting.via.kind === 'grant' && acting.via.id === 'g1' && acting.owner === false, JSON.stringify(acting));

  // ---- mark-embed
  const realHas = Schema.hasTable;
  Schema.hasTable = async () => false;
  ok('marksIn is null when marking is not switched on (the list answers as before)', (await MarkEmbed.marksIn({ query: async () => ({}) }, {}, 'acc.audit', ['a'])) === null);
  ok('marksIn is null for an adopter nobody registered', (await MarkEmbed.marksIn({ query: async () => ({}) }, {}, 'no.such', ['a'])) === null);
  Schema.hasTable = async () => true;
  const savepoints = [];
  const failingDb = { query: async (sql) => { savepoints.push(String(sql).split(' ')[0]); if (/SAVEPOINT/.test(sql)) return {}; throw new Error('read failed'); } };
  const embedded = await MarkEmbed.marksIn(failingDb, { identity: owner, user: owner, headers: {} }, 'acc.audit', ['a']);
  ok('fail closed: a marks read that fails never fails the list — null, after a rollback to the savepoint', embedded === null && savepoints[0] === 'SAVEPOINT', savepoints.join());
  Schema.hasTable = realHas;

  // ---- books-manual-bill-tax
  const ctx = { s: { country: 'AU' } };
  const noLines = await thrown(() => ManualBillTax.taxedInvoice(ctx, { lines: [] }, 'AUD', { taxed: true, what: 'the bill', taxWhy: 'claim' }));
  ok('refusal: a bill with no lines is asked for its lines', noLines && /Add the lines of the bill/.test(noLines.message), noLines && noLines.message);
  const noNumber = await thrown(() => ManualBillTax.taxedInvoice(ctx, { lines: [{ name: 'x', qty: 1, rate: 100 }] }, 'AUD', { taxed: true, what: 'the bill', taxWhy: 'claim' }));
  ok('refusal: a taxed bill without the supplier tax number is asked for it, naming the tax', noNumber && / (number|ABN) is needed to claim/.test(noNumber.message), noNumber && noNumber.message);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });
