/**
 * tests/shrink-parts.test.cjs — the part modules split out of the big route files (SHRINK, Nov 2026): each pure rule on its own, the refusals in words, and the doors that fail closed.
 *
 * OWNS      unit-per-rule checks of lib/{assist-parts, testing-results, integrations-fit, entities-prefs, chits-till-send, definitions-guards, books-daybook, crm-timeline-rows, chits-trace-batch, catalogue-order-checks, signin-code, products-list-adopt, till-match, ctp-guards, connectors-gates, governance-plan, folders-reads, network-design-stores, relationships-rename, entities-me, actors-assign-jobs, books-movein}.js
 * CALLED BY node tests/shrink-parts.test.cjs (offline: no database, no network) · tests/run-tests.js
 * FLOW      require the part -> call its rule with plain objects -> assert the answer, or the refusal's words
 * CARD      28-platform-and-operations/api-standard
 * MIN unit-per-rule
 * MIN refusal-path
 * MIN fail-closed
 * A refusal is said in words and never thrown as a 500; a door with nothing to go on is refused, closed, not guessed.
 */
'use strict';
const path = require('path');

let pass = 0, fail = 0;
const t = (name, ok, why) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  XX  ' + name + (why ? '\n        ' + why : '')); } };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

(async () => {
  // ── assist-parts: the catalogue-source write's refusals
  const assist = require('../lib/assist-parts.js');
  t('assist: a missing source key is refused 422 in words', assist.keyRefusal('').status === 422);
  t('assist: a 201-character key is refused 400 (too long for a label)', assist.keyRefusal('k'.repeat(201)).status === 400);
  t('assist: a good key is not refused', assist.keyRefusal('beta-royale-play@v1') === null);
  t('assist: no row yet means nothing to refuse', assist.sourceRefusal(null, 'x') === null);
  t('assist: a source another brand owns is refused to this caller', !!assist.sourceRefusal({ owner_entity_id: 'a' }, 'b'));
  t('assist: the owner may rewrite its own source', assist.sourceRefusal({ owner_entity_id: 'a' }, 'a') === null);
  t('assist: every screen hint is a sentence', Object.values(assist.CONTEXT_HINTS).every((hint) => typeof hint === 'string' && hint.length > 20));

  // ── testing-results: what the board refuses to record
  const results = require('../lib/testing-results.js');
  t('results: a result must name its case', /name the case/.test(results.badResult({ status: 'pass', run_kind: 'unit' })));
  t('results: an unknown status is refused with the list', /is not a status/.test(results.badResult({ case_key: 'A-1', status: 'maybe', run_kind: 'unit' })));
  t('results: blocked without a reason is refused', /must say what blocked it/.test(results.badResult({ case_key: 'A-1', status: 'blocked', run_kind: 'unit' })));
  t('results: a blocked case with its reason is taken', results.badResult({ case_key: 'A-1', status: 'blocked', run_kind: 'unit', note: 'db down' }) === null);
  t('results: an unrecognised case field is reported, never silently dropped', results.unknownFields([{ case_key: 'A', surprise: 1 }]).join() === 'surprise');
  const row = results.resultRowOf({ case_key: 'AC-9', status: 'pass', run_kind: 'unit' }, {}, { name: 'Asha' });
  t('results: the tester is stamped from the token, the module from the key', row.tester_name === 'Asha' && row.module_key === 'AC' && row.definition_id === null);

  // ── integrations-fit: a connector offered only where it works
  const fit = require('../lib/integrations-fit.js');
  t('fit: a connector with no kit is refused in words naming it', fit.mayFor({ fits: 'none', name: 'Xero connector' }, 'AU').ok === false && /Xero kit/.test(fit.mayFor({ fits: 'none', name: 'Xero connector' }, 'AU').why));
  t('fit: no fits flag means every pack', fit.mayFor({ name: 'CSV' }, 'AU').ok === true);
  t('fit: an unknown country is offered, never guessed away', fit.mayFor({ fits: 'tally', name: 'Tally connector' }, null).ok === true);
  t('fit: the not-yet rows name the countries they are for', fit.NOT_YET.every((rowItem) => rowItem.fits === 'none' && rowItem.for.length > 0));

  // ── entities-prefs: the person's own preference sets
  const prefs = require('../lib/entities-prefs.js');
  t('prefs: a kind off the prototype chain is no set (own-property lookup)', prefs.prefSetOf('__proto__') === null && prefs.prefSetOf('constructor') === null);
  t('prefs: ui and locale are the two sets', !!prefs.prefSetOf('ui') && !!prefs.prefSetOf('locale'));
  const patched = prefs.prefPatch(prefs.prefSetOf('ui'), { theme: 'cream', font: '' });
  t('prefs: a sent key is set and an empty one is dropped', patched.set.theme === 'cream' && patched.drop.includes('font'));
  t('prefs: a value that is no token is refused', /not a valid value/.test(prefs.prefPatch(prefs.prefSetOf('ui'), { theme: 'a b;c' }).error));
  t('prefs: an unknown reading font is refused by the set', prefs.PREF_SETS.ui.check({ font: 'comic' }) === 'Unknown reading font');
  t('prefs: the merge-patch SQL names its column only through the whitelist', prefs.MERGE_PATCH_SQL('ui_prefs').includes('ui_prefs'));

  // ── chits-till-send: a till key may send ONE counter bill to ONE customer, nothing wider
  const tillSend = require('../lib/chits-till-send.js');
  const refusedTwo = await tillSend.tillMaySend('shop', [{ entity_id: 'a' }, { entity_id: 'b' }], {});
  t('till send: two recipients are refused, not recorded', !!refusedTwo && /one customer only/.test(refusedTwo.refuse));
  const refusedNotBill = await tillSend.tillMaySend('shop', [{ entity_id: '11111111-1111-1111-1111-111111111111' }], { purpose: 'order', business_json: {} });
  t('till send: a send that is no counter bill is refused', !!refusedNotBill && /not a counter bill/.test(refusedNotBill.refuse));

  // ── definitions-guards: who may set a rate, the live offer needs the shop's yes
  const guards = require('../lib/definitions-guards.js');
  t('definitions: an offer going live without the yes needs it', guards.liveNeedsYes({ body: { status: 'live' } }, 'offer', 'draft') === true);
  t('definitions: with the yes it goes on', guards.liveNeedsYes({ body: { status: 'live', confirmed: true } }, 'offer', 'draft') === false);
  t('definitions: an offer already live is never asked again', guards.liveNeedsYes({ body: { status: 'live' } }, 'offer', 'live') === false);
  let nexted = false;
  const sink = { status: () => sink, type: () => sink, set: () => sink, json: () => sink, setHeader: () => sink, locals: {} };
  guards.bornLiveWithoutYes({ method: 'POST', originalUrl: '/x', headers: {}, body: { kind: 'offer', status: 'live' }, id: 'r' }, sink, () => { nexted = true; });
  t('definitions: an offer born live without the yes is refused before anything is written', nexted === false);

  // ── books-daybook: the page asked for, the source of a line
  const daybook = require('../lib/books-daybook.js');
  t('daybook: nothing asked is the whole range (no page)', daybook.pageQ({}) === null);
  t('daybook: a limit is clamped to the server maximum', daybook.pageQ({ limit: '99999' }).limit <= 500);
  t('daybook: a keyset cursor is read, a junk one is none', daybook.pageQ({ after: '2026-04-01|JV-9' }).after.no === 'JV-9' && daybook.pageQ({ limit: 5, after: 'junk' }).after === null);
  t('daybook: only uuids name entries', daybook.pageQ({ entries: 'nope,3f2504e0-4f89-41d3-9a0c-0305e82c3301' }).entries.length === 1);
  t('daybook: a next page says where to go on', daybook.cursorOf({ date: '2026-04-01', no: 'JV-9' }) === '2026-04-01|JV-9' && daybook.cursorOf(null) === null);
  t('daybook: a moment that is no moment is skipped, never passed on', daybook.momentOf('not a date') === null && daybook.momentOf('') === null);
  t('daybook: a line with no chit behind it has no source', daybook.sourceOf({ source_chit_id: null, covers: 0 }) === null);
  t('daybook: a plain cash bill reads as paid in cash', daybook.sourceOf({ source_chit_id: 'c', src_chit_id: 'c', src_mode: 'cash', event_type: 'sale_bill' }).how === 'Cash');
  const place = daybook.pagePlace(null, { paged: null }, {}, null);
  t('daybook: an unpaged read says no place', Object.keys(place).length === 0);
  const entries = daybook.entriesOf([{ entry_id: 'e1', entry_no: 'JV-1', posting_date: '2026-04-01', doc_date: '2026-04-01', event_type: 'sale_bill', code: '1100', account_name: 'Cash', dr_minor: '500', cr_minor: '0' }, { entry_id: 'e1', code: '4000', account_name: 'Sales', dr_minor: '0', cr_minor: '500' }], new Map(), null);
  t('daybook: lines of one entry stay together, in order', entries.length === 1 && entries[0].lines.length === 2 && entries[0].lines[1].cr_minor === 500);

  // ── crm-timeline-rows: a blind reader's cost side is hidden
  const rows = require('../lib/crm-timeline-rows.js');
  const entry = rows.chitEntry({ created_at: '2026-04-01T00:00:00Z', chit_id: 'c1', direction: 'sent', current_status: 'sent', purpose: 'order', value: '100', open_disputes: '2' }, null);
  t('timeline: a chit entry carries its money as stored', entry.kind === 'chit' && entry.value === 100 && entry.open_disputes === 2);
  t('timeline: a ledger entry keeps its minor units', rows.ledgerEntry({ created_at: '2026-04-01T00:00:00Z', ref: 'R1', ref_kind: 'bill', amount_minor: '1250', currency: 'INR' }, false, null).amount_minor === 1250);

  // ── chits-trace-batch: the recall chain
  const batch = require('../lib/chits-trace-batch.js');
  t('trace: a parties list that is not JSON is none, never a throw', batch.recipientsOf({ all_recipients: '{bad' }, 'test').length === 0);
  const items = batch.batchItems([{ chit_id: 'a', sender_entity_id: 's', all_recipients: [{ role: 'receiver', entity_id: 'm' }], trace: { product: 'oil', qty: 1 } }, { chit_id: 'a', sender_entity_id: 's', all_recipients: [] }, { chit_id: 'b', sender_entity_id: 'm', all_recipients: [{ role: 'receiver', entity_id: 'c' }], trace: { product: 'oil' } }]);
  t('trace: one item per chit even when the lot join repeats it', items.length === 2);
  const chain = batch.batchChain(items);
  t('trace: the receiver of one handoff is the sender of the next', chain.edges.length === 1 && chain.nmap.a.is_origin === true && chain.nmap.b.depth === 1);

  // ── catalogue-order-checks: the buyer's offer against the declared schema
  const order = require('../lib/catalogue-order-checks.js');
  t('order: names compare trimmed and lower-cased', order._norm('  Sunflower OIL ') === 'sunflower oil');
  const refusedOffer = throws(() => order.validateProposal({ price: 5 }, { negotiable: false }, null, 'Oil'));
  t('order: a shop that takes no offers refuses one, 422, in words', !!refusedOffer && refusedOffer.status === 422 && /does not take offers/.test(refusedOffer.message));
  t('order: no offer is no position', order.validateProposal(null, { negotiable: false }, null, 'Oil') === null);
  t('order: no item name means the catalogue governs', (await order.itemDeclFor('shop', '', {})) === null);

  // ── signin-code: the one sentence for a mail's outcome
  const code = require('../lib/signin-code.js');
  t('signin: a delivered mail says so', /sent to your email/.test(code.sentWords({ delivered: true })));
  t('signin: a mailer outage reads as failure, never as sent', /couldn't send/.test(code.sentWords(null)));

  // ── products-list-adopt: what the starter-list adopt strips
  const adopt = require('../lib/products-list-adopt.js');
  const stripped = adopt.withoutServerOwned([{ name: 'Tomato', media: ['x'], image: 'y' }, { name: 'Onion' }]);
  t('adopt: server-owned keys are dropped and counted once per row', stripped.dropped === 1 && !('media' in stripped.kept[0]) && stripped.kept[1].name === 'Onion');
  t('adopt: the photos note appears only when something was dropped', adopt.photosNote(0) === '' && /photos were not copied/.test(adopt.photosNote(2)));
  const unpriced = await adopt.dropForeignListPrices([{ name: 'Tomato', price: 40 }], { identity: null });
  t('adopt: a currency that cannot be read fails closed, the list price is dropped', !('price' in unpriced[0]));

  // ── till-match: the supplier's bill against what was counted
  const match = require('../lib/till-match.js');
  t('match: an invoice with no total has no gap', match.matchMoney({ total: null }, [], 'INR').code === 'no_total');
  t('match: an invoice in another currency is not compared', match.matchMoney({ total: 100, currency: 'AED' }, [], 'INR').code === 'currency_differs' || match.matchMoney({ total: 100, currency: 'AED' }, [], 'INR').gap === null);

  // ── home-facts-finance / home-facts-bank: the Home cards say a plain status, never a guessed zero, and refuse closed when the ledger is not there
  const financeCard = require('../lib/home-facts-finance.js');
  const bankCard = require('../lib/home-facts-bank.js');
  const helpers = { withEntity: async () => { const failure = new Error('relation missing'); failure.code = '42P01'; throw failure; }, notProvisioned: (failure) => failure && failure.code === '42P01', notStarted: (why) => ({ lines: [], unavailable: why, state: 'not_started' }), plural: (count, one, many) => count + ' ' + (count === 1 ? one : many || one + 's'), toNumber: (value) => Number(value) || 0, neverUsed: (...figures) => (figures.some(Boolean) ? undefined : 'not_started') };
  t('finance card: a ledger that is not provisioned is said, not guessed (closed)', (await financeCard.financeCard({ entity: 'shop' }, helpers)).unavailable === 'the ledger is not provisioned');
  t('bank card: a ledger that is not provisioned is said, not guessed (closed)', (await bankCard.bankCard({ entity: 'shop' }, helpers)).unavailable === 'the ledger is not provisioned');
  const nothingHeld = financeCard.chequeLines({ toCollect: 0, toPay: 0, remind: { on: true } }, { dueList: [], late: [], next: null, held: [] }, 'INR', helpers);
  t('finance card: nothing waiting says so, with no money line', nothingHeld.length === 1 && nothingHeld[0].text === 'No cheque waiting');
  const owing = financeCard.chequeLines({ toCollect: 500, toPay: 200, remind: { on: false } }, { dueList: [{ amount: 100, state: 'due' }], late: [], next: null, held: [] }, 'INR', helpers);
  t('finance card: cheque first, then what is owed to the shop and by it, then the switch off', owing.length === 4 && /to deposit/.test(owing[0].text) && owing[1].text === 'To pay {money}' && owing[3].text === 'Cheque reminders off');
  const matches = bankCard.statementLines({ account_id: 'a', difference_minor: 0, currency: 'INR', period_to: '2026-04-30' }, [{ account_id: 'a', name: 'HDFC' }], null);
  t('bank card: a statement that agrees says nothing is unexplained', matches.lines[1].text === 'Nothing unexplained' && matches.figures.statement.account === 'HDFC');
  const differs = bankCard.statementLines({ account_id: 'a', difference_minor: 1250, currency: 'INR', period_to: '2026-04-30' }, [], null);
  t('bank card: a difference carries its money in its own currency', differs.lines[1].money.currency === 'INR' && differs.lines[1].tone === 'dn');

  // ── the remaining parts are doors to the database: they load, and say what they export
  const DOORS = {
    'ctp-guards.js': require('../lib/ctp-guards.js'),
    'connectors-gates.js': require('../lib/connectors-gates.js'),
    'governance-plan.js': require('../lib/governance-plan.js'),
    'folders-reads.js': require('../lib/folders-reads.js'),
    'network-design-stores.js': require('../lib/network-design-stores.js'),
    'relationships-rename.js': require('../lib/relationships-rename.js'),
    'entities-me.js': require('../lib/entities-me.js'),
    'actors-assign-jobs.js': require('../lib/actors-assign-jobs.js'),
    'books-movein.js': require('../lib/books-movein.js')
  };
  const shape = {
    'ctp-guards.js': ['namesItsAnswer', 'refusalTo', 'readsVersion'],
    'connectors-gates.js': ['hashKey', 'hasConnector', 'requireConnector', 'deviceActor', 'deviceKey'],
    'governance-plan.js': ['loadActiveConstitution', 'CHITS_TODAY_SQL', 'countChitsToday', 'assertChitAllowed'],
    'folders-reads.js': ['UNFILE_SUBTREE_SQL', 'filedChits'],
    'network-design-stores.js': ['MAX_STORES', 'visibleStores'],
    'relationships-rename.js': ['renameMinted'],
    'entities-me.js': ['governanceAndLedger'],
    'actors-assign-jobs.js': ['ASSIGN_JOBS'],
    'books-movein.js': ['moveInBody', 'moveInPlan']
  };
  for (const [file, names] of Object.entries(shape)) {
    const loaded = DOORS[file];
    t(file + ' exports ' + names.join(' · '), names.every((name) => loaded[name] !== undefined));
  }
  t('connectors: a shop without the connector switch is refused (closed)', require('../lib/connectors-gates.js').hasConnector(['till']) === false && require('../lib/connectors-gates.js').hasConnector(['connector']) === true);
  t('connectors: the key is stored only as a hash', require('../lib/connectors-gates.js').hashKey('k') !== 'k' && require('../lib/connectors-gates.js').hashKey('k').length === 64);
  t('assign: pull, push and return are the only three jobs', Object.keys(require('../lib/actors-assign-jobs.js').ASSIGN_JOBS).sort().join() === 'pull,push,return');
  t('governance: an unfiled-subtree walk cannot loop (UNION, not UNION ALL)', /UNION\s+SELECT/.test(require('../lib/folders-reads.js').UNFILE_SUBTREE_SQL) && !/UNION ALL/.test(require('../lib/folders-reads.js').UNFILE_SUBTREE_SQL));

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('  XX  crashed: ' + (err && err.stack)); process.exit(1); });
