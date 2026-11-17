/* cap-bank-store.js — the SERVER STORE of the Bank view's marks (FIN-70, web half; api: POST /bank/marks, POST /bank/statements, GET /bank/log).
 * OWNS      bankStoreLoad (read the log, replay the marks through the SAME CBBankRecon.step, newest wins) · bankStoreAppend (one mark per step action, in order) ·
 *           the sign-off ("Sign off this reconciliation": the BRS figures the page already shows, carried, behind one confirm) · bankStorePanel (one line saying where the
 *           marks are kept, the signed statements, the posted lines no accept names) · bankStoreNoteWords.
 * CALLED BY cap-bank.js (bankRun · bkbStep · bankPaint · the note box), loaded after it by public/accounts.html. Is handed cap-bank.js's BKB at load (bankStoreState.view) and reads its bkb* helpers by name.
 * FLOW      bankRun → bankStoreLoad → GET /bank/log → replay → bankStoreState.view.rec · a step → bkbStep → bankStoreAppend → POST /bank/marks · Sign off → confirm → POST /bank/statements
 * ⭐ ONE CALCULATION: nothing is worked out here. The replay is CBBankRecon.step, the sign-off carries CBBankRecon.brs's own figures (bankStoreState.view.brs), the server stamps who and when.
 * ⭐ UNTIL THE SQL RUNS (api b864) every door answers 503 "arrives after the next update": the marks stay in localStorage as today, one line says so, and nothing is lost.
 *    localStorage is ALWAYS kept as the offline cache; marks made before the server store existed are NOT copied up (trial data is mock; ask Athi if ever wanted).
 * ⚠️ A statement line, a narration and the file name are never sent: a mark carries a line fingerprint, ids, the owner's note text; the statement carries figures and the hash.
 * IDS       BKS014-B08 (Sign off this reconciliation). The confirm is the page's one popup (CBAction.ask). CARD 16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    booksBankLog: { m: 'GET', p: '/api/books/bank/log' },
    booksBankMarks: { m: 'POST', p: '/api/books/bank/marks' },
    booksBankStatements: { m: 'POST', p: '/api/books/bank/statements' }
  });
}

/** where the marks are kept: mode 'server' (shared record) · 'device' (the record is not set up yet) · 'error' (could not reach it); the rest is what the log said */
var bankStoreState = { view: null, mode: 'device', acct: '', statements: [], exceptions: [], posted: [], chain: Promise.resolve(), say: '', blind: false, signing: false };
const bankStoreState_SHOWN = 4;
/** a string made safe to put into the panel */
const bksE = (text) => (typeof bkbE === 'function' ? bkbE(text) : String(text));
/** true when the server says the shared record is not set up yet (503) */
const bksNotSetUp = (failure) => !!failure && failure.status === 503;
/** the api's 403 COST_BLIND (B3): this login may not see costs, so the bank statements and log are not its to read; ONE test and ONE sentence for every bank read (the body's code, from the error's own data) */
const bksCostBlind = (failure) => !!failure && failure.status === 403 && !!failure.data && (failure.data.code === 'COST_BLIND' || (failure.data.error && failure.data.error.code === 'COST_BLIND'));
const bksCostBlindSay = () => tx('Your access does not include costs, so the bank statements are hidden.');
/** why a bank read failed, in words: the cost-blind sentence, else the server's own message */
const bksWhy = (failure) => (bksCostBlind(failure) ? bksCostBlindSay() : (failure && failure.message) || '');

/** the log's marks, oldest first, through the engine's own step; a mark the engine refuses is skipped, never invented */
function bankStoreReplay(marks) {
  let state = {};
  (marks || []).forEach((row) => {
    const next = CBBankRecon.step(state, {
      act: row.act,
      key: row.line_key,
      how: row.how,
      chits: row.chit_ids,
      ledger: row.entry_ids,
      text: row.note,
      name: row.attach_ref,
      ref: row.attach_ref,
      at: row.at,
      by: row.by_name || row.by /* W15-71: the name the log carries for the person, else the id as before */
    });
    if (!next.why) state = next;
  });
  return state;
}
/** the marks of the picked account: the shared record when it answers, else this device's own copy (and the line says which) */
async function bankStoreLoad(view) {
  bankStoreState = Object.assign(bankStoreState, { view: view, acct: view.acct, statements: [], exceptions: [], say: '', blind: false, chain: Promise.resolve() });
  try {
    const log = (await api('booksBankLog', { query: { account: bankStoreState.view.acct, from: bankStoreState.view.from, to: bankStoreState.view.to }, fresh: true })) || {};
    bankStoreState.mode = 'server';
    bankStoreState.statements = log.statements || [];
    bankStoreState.posted = log.posted || []; /* api #1350: the bank-line entries posted, who and when (the statement check reads them) */
    bankStoreState.exceptions = log.exceptions || [];
    const state = bankStoreReplay(log.marks);
    bkbSave('marks:' + bankStoreState.view.acct, state);
    return state;
  } catch (failure) {
    bankStoreState.mode = bksNotSetUp(failure) ? 'device' : 'error';
    bankStoreState.say = bksNotSetUp(failure) ? '' : bksWhy(failure);
    bankStoreState.blind = bksCostBlind(failure);
    return bkbLoad('marks:' + bankStoreState.view.acct, {});
  }
}
/** the line, ready for the server: the engine's action keys only; at and by are the server's */
function bankStoreMark(action) {
  const ids = (list) => (list || []).map(String);
  const mark = { act: action.act, key: String(action.key) };
  if (action.how) mark.how = String(action.how).slice(0, 40);
  if (action.chits) mark.chits = ids(action.chits);
  if (action.ledger) mark.ledger = ids(action.ledger);
  if (action.text) mark.text = String(action.text);
  if (action.ref) mark.ref = String(action.ref);
  return mark;
}
/** one step → one mark, sent in the order made; a failure is said on the line and the device copy stays */
function bankStoreAppend(action) {
  if (bankStoreState.mode === 'device') return;
  const acct = bankStoreState.view.stmtAcct || bankStoreState.view.acct /* B5-07: the account the statement was read for, never the dropdown's */,
    body = { account: acct, file_hash: (bankStoreState.view.file && bankStoreState.view.file.hash) || undefined, marks: [bankStoreMark(action)] };
  bankStoreState.chain = bankStoreState.chain
    .then(() => api('booksBankMarks', { body }))
    .then(() => {
      bankStoreState.mode = 'server';
      bankStoreState.say = '';
      bankStoreState.blind = false;
    })
    .catch((failure) => {
      bankStoreState.mode = bksNotSetUp(failure) ? 'device' : 'error';
      bankStoreState.say = bksNotSetUp(failure) ? '' : bksWhy(failure);
      bankStoreState.blind = bksCostBlind(failure);
    })
    .then(bankStorePaintLine);
}
/** the sentence under the note box: where the note is kept */
const bankStoreNoteWords = () =>
  bankStoreState.mode === 'server'
    ? tx('Kept for you and your accountant on the shared record. A note never stops you accepting.')
    : tx('Kept on this device. A note never stops you accepting.');
/** the one line saying where the marks are kept */
const bankStoreLine = () =>
  bankStoreState.blind
    ? bksCostBlindSay() /* the api's 403 COST_BLIND: said, not the "could not reach" line (silence is the bug) */
    : bankStoreState.mode === 'server'
    ? (typeof bkbReadOnly === 'function' && bkbReadOnly() ? '' : tx('Marks and notes are kept for your accountant too.')) /* R3-3: the read-only auditor makes no marks, so the line is not said to them */
    : bankStoreState.mode === 'device'
      ? tx('Saved on this device until the next update')
      : tx('Could not reach the shared record. Saved on this device for now.'); /* FIN-118: never the server's raw sentence (it named a route); the words are ours */

/* ── the sign-off: the figures the Statement tab shows, carried, never worked out again ── */
/** the statement the page carries: the BRS figures as the Statement tab shows them */
function bankStoreBody() {
  const worked = bankStoreState.view.brs,
    ledger = bankStoreState.view.ledgerRaw || {};
  return {
    account: bankStoreState.view.stmtAcct || bankStoreState.view.acct, /* B5-07: bound to the statement, not the dropdown */
    period_from: bankStoreState.view.from,
    period_to: bankStoreState.view.to,
    opening_minor: Number(ledger.opening_minor) || 0,
    closing_bank_minor: worked.bank_balance_minor,
    closing_books_minor: worked.book_balance_minor,
    difference_minor: worked.difference_minor,
    currency: String(ledger.currency || bkCur() || '').toUpperCase(),
    file_hash: bankStoreState.view.file && bankStoreState.view.file.hash
  };
}
/** the confirm names its reach: which account, which period, what difference; and that it is kept and cannot be edited */
function bankStoreAsk(body) {
  const acct = (bankStoreState.view.accts || []).filter((item) => String(item.code) === String(bankStoreState.view.acct))[0];
  return {
    title: tx('Sign off this reconciliation?'),
    body:
      '<div data-testid="bank-signoff-reach">' +
      bksE(txf('{account}, {from} to {to}.', { account: (acct && acct.name) || bankStoreState.view.acct, from: bkDate(bankStoreState.view.from), to: bkDate(bankStoreState.view.to) })) +
      '<br>' +
      bksE(txf('Difference {amount}.', { amount: bkbFig(Math.abs(body.difference_minor), body.currency) })) +
      '<br>' +
      bksE(tx('It is kept for your accountant and cannot be edited. Signing again adds a new record.')) +
      '</div>',
    yes: tx('Sign off'),
    danger: false
  };
}
/** Sign off: confirm, then one POST /bank/statements; the signed list grows */
function bankStoreSignOff(btn) {
  if (!bkbBound()) return;
  if (!bankStoreState.view.brs || !bankStoreState.view.brs.ok || bankStoreState.mode !== 'server') return;
  if (typeof bkbActRefusal === 'function' && bkbActRefusal()) return toast(bkbActRefusal());
  const body = bankStoreBody();
  return CBAction.run(btn, () => api('booksBankStatements', { body }), {
    key: 'bank-signoff:' + bankStoreState.view.acct,
    confirm: bankStoreAsk(body),
    failed: tx('Could not sign off'),
    outcome: (reply) => {
      bankStoreState.statements = [(reply && reply.statement) || body].concat(bankStoreState.statements);
      bankStorePaintLine();
      toast(tx('Signed off.'));
    }
  });
}

/* ── what is drawn ── */
/** one row of a list: what on the left, the amount or state on the right */
const bksRow = (testId, left, right) => '<div class="pe-row" data-testid="' + testId + '"><span>' + bksE(left) + '</span><span class="mono">' + bksE(right) + '</span></div>';
/** "and n more" when a list shows only its first few rows */
const bksMore = (count) => (count > bankStoreState_SHOWN ? '<div class="pe-note">' + bksE(txf('and {n} more', { n: count - bankStoreState_SHOWN })) + '</div>' : '');
/** who signed, in words: the record carries the login's id, so the name is the one on this login (or the record's own by_name); an id nobody can name is left out, never printed */
function bankStoreSigner(item) {
  if (item && item.by_name) return item.by_name; /* the api's own word for who, whoever signed: never the viewer's name for another person */
  const by = String((item && item.by) || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(by)) return by;
  return bankStoreIsMine(by) && typeof bkbBy === 'function' ? bkbBy() || '' : ''; /* an id of someone else with no name is left out; only this login's own id falls back to its name */
}
/** this login's own id (core.js cbMeId); an unknown own id on the owner's own page still reads as the owner's, never while acting for a client */
function bankStoreIsMine(by) {
  const me = (typeof cbMeId === 'function' && cbMeId()) || '';
  if (me) return String(me) === by;
  return !(typeof CBBooksActing !== 'undefined' && CBBooksActing.current());
}
/** the name of the client an adviser is acting for, '' when it has none; null when the person is not an adviser acting for a client */
function bankStoreAdviserClient() {
  if (typeof CBBooksActing === 'undefined' || !CBBooksActing.isAdviser()) return null;
  return (CBBooksActing.current().store || {}).name || '';
}
/** who made a line, for the posted feed: an adviser's own page reads "Pat Lee for <client>", the owner reads "Pat Lee, <firm>"; a row with no by_name keeps the plain name the api sent (made_by) */
function bankStoreMadeBy(row) {
  const name = (row && (row.by_name || row.made_by)) || '';
  if (!row || !row.by_name) return name;
  const client = bankStoreAdviserClient();
  if (client !== null) return txf('{name} for {client}', { name, client });
  return row.by_firm ? name + ', ' + row.by_firm : name;
}
/** the signer with the firm when an adviser made it: "Pat Lee, Bayside Bookkeeping - demo" */
function bankStoreSignerFull(item) {
  const who = bankStoreSigner(item);
  return who && item && item.by_firm && item.by_firm !== who ? who + ', ' + item.by_firm : who; /* a firm that signs as itself is said once */
}
/** the sign-off of THIS statement's period, newest first, or null */
const bankStoreSignedNow = () => bankStoreState.statements.filter((item) => item.period_to && bankStoreState.view && item.period_to === bankStoreState.view.to)[0] || null;
/** "Signed off by <name> on <date>", the one sentence the lines view and the statement both print; '' while the period is not signed */
function bankStoreSignedWords() {
  const item = bankStoreSignedNow();
  if (!item) return '';
  const who = bankStoreSignerFull(item),
    date = bkDate(String(item.at || '').slice(0, 10));
  if (who && item.by_firm) return txf('Reconciled by {who} on {date}', { who, date }); /* W15-75: a bookkeeper signs as the preparer, the firm named; the owner or auditor reviews */
  return who ? txf('Signed off by {who} on {date}', { who, date }) : txf('Signed off on {date}', { date });
}
/** the signed statements, newest first, the first few */
function bankStoreSigned() {
  if (!bankStoreState.statements.length) return '';
  return (
    '<div class="pe-sub">' +
    bksE(tx('Signed off')) +
    '</div><div class="pe-rows" data-testid="bank-signed">' +
    bankStoreState.statements
      .slice(0, bankStoreState_SHOWN)
      .map((item) =>
        bksRow(
          'bank-signed-row',
          bkDate(String(item.at || '').slice(0, 10)) + (bankStoreSignerFull(item) ? ' · ' + bankStoreSignerFull(item) : '') + ' · ' + tx('as at') + ' ' + bkDate(item.period_to),
          (item.tied ? tx('Tied') : tx('Difference') + ' ' + bkMoney(Math.abs(item.difference_minor), item.currency))
        )
      )
      .join('') +
    '</div>' +
    bksMore(bankStoreState.statements.length)
  );
}
/** the posted-not-accepted lines the log read named, the first few */
function bankStoreExceptions() {
  if (!bankStoreState.exceptions.length) return '';
  return (
    '<div class="pe-sub">' +
    bksE(tx('Posted from a bank line, not yet accepted')) +
    '</div><div class="pe-rows" data-testid="bank-exceptions">' +
    bankStoreState.exceptions
      .slice(0, bankStoreState_SHOWN)
      .map((item) => bksRow('bank-exception-row', txf('Entry {no}', { no: item.entry_no }) + ' · ' + bkDate(item.posting_date), bkMoney(item.amount_minor, item.currency)))
      .join('') +
    '</div>' +
    bksMore(bankStoreState.exceptions.length)
  );
}
/** the "✓ signed off …" line, drawn on every tab but the reconciliation's own; '' when nothing is signed */
function bankStoreSignedLine(signed) {
  return signed && bankStoreState.view.tab !== 'brs' ? '<span class="bk-signed" data-testid="bank-signed-line">✓ ' + bksE(signed) + '</span>' : '';
}
/** the Sign off button, drawn only when the difference is nil (the band asks for it then); greyed with the reason while the record is not set up. Its slot is repainted after a sign-off */
function bankStoreSignButton() {
  const worked = bankStoreState.view.brs;
  if (typeof bkbReadOnly === 'function' && bkbReadOnly()) return bankStoreSignedLine(bankStoreSignedWords()); /* W15-71: the sign-off is said, never offered */
  if (!worked || !worked.ok) return '';
  const notReady = bankStoreState.mode !== 'server',
    signed = bankStoreSignedWords();
  return (
    bankStoreSignedLine(signed) +
    '<button data-cbsid="BKS014-B08" type="button" class="' + (signed ? 'act' : 'pri bk-primary') + '" data-testid="bank-signoff"' +
    (notReady ? ' disabled title="' + bksE(tx('Signing off starts after the next update')) + '"' : '') +
    ' onclick="bankStoreSignOff(this)">' +
    bksE(tx(signed ? 'Sign off again' : 'Sign off this reconciliation')) +
    '</button>'
  );
}
/** the whole panel: the line, the signed list, the exceptions */
const bankStorePanel = () =>
  '<div id="bk_store" data-testid="bank-store"><div class="pe-note" id="bk_store_line" data-testid="bank-store-line" data-mode="' +
  bankStoreState.mode +
  '">' +
  bksE(bankStoreLine()) +
  '</div>' +
  bankStoreSigned() +
  bankStoreExceptions() +
  '</div>';
/** a step or an answer changed the line or the lists: redraw the panel where it is, nothing else */
function bankStorePaintLine() {
  const host = document.getElementById('bk_store'),
    slot = document.getElementById('bk_primary');
  const quiet = document.getElementById('bk_store_line');
  if (host) host.outerHTML = bankStorePanel();
  else if (quiet) {
    quiet.textContent = bankStoreLine();
    quiet.setAttribute('data-mode', bankStoreState.mode);
  }
  if (slot && typeof bankPrimaryHtml === 'function') slot.innerHTML = bankPrimaryHtml(bankFigures());
}
