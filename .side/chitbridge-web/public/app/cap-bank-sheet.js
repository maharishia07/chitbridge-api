/* cap-bank-sheet.js — the Bank view's "Add to your books" SHEET (FIN-117): the statement's lines against the books, the questions each line asks, one confirm that says what it reaches, then the lines posted.
 * OWNS      bankSheetOpen (the sheet) · the controller's in-app options (ledger, post, parties, learned rules, who may post) · the confirm and the posting of the ready lines · the read of the books after.
 *           The flow is public/app/bank-preview.js (the same module the no-login demo runs), the lines are painted by public/app/bank-preview-ui.js, each line is posted by public/app/cap-bank-post.js.
 * CALLED BY cap-bank.js (the primary Add button in the band, and Add missing on a line: bankAdd → bankSheetOpen). Loaded by public/accounts.html after cap-bank.js.
 * FLOW      bankSheetOpen → countrySetup (tax registered? unknown stays unknown) → CBBankPreview.create({ ledger: bkshBook().ledger, post: CBBankPost.adapter }) → load(bkshBook().text) → CBBankPreviewUI.mount → answers → Add N → CBAction.ask (reach) → postReady → bankLedger → paint
 * ⭐ THE STATEMENT NEVER LEAVES THE DEVICE: bkshBook().text is read by the engine here; what is sent is each confirmed entry (kind, date, amount, narration, one client_ref), as before.
 * ⭐ THE PAGE COMPUTES NO MONEY and defaults no unasked fact: the entry, its tax and its totals are the engine's; a registered shop is asked what tax a charge is (bank-preview.js heldHere_), an unknown registration asks nothing and claims nothing.
 * IDS       BKS014-U03 (the sheet) · BKS014-B16 (Add) · BKS014-B17 (Close) · BKS014-B18 (the Add button in the band, drawn by cap-bank.js bankPrimaryHtml). CARD 16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
/** the Bank view's own state (cap-bank.js declares BKB; this file reads it through one door) */
const bkshBook = () => BKB;
/** the shop's own login (the page's isOwner: a co-assist is not the owner); false where the page has none */
const bkshIsOwner = () => typeof isOwner === 'function' && isOwner() && !(typeof bkReadOnlySeat === 'function' && bkReadOnlySeat()); /* W15-71: an auditor's seat never reads as the owner */
const BKSH = { ctl: null, ui: null, key: '', taxRegistered: null, posting: false, said: null, refs: null };
/** the statement the answers belong to: the account and the file's hash; the controller (and every answer on it) is kept for this key, so closing the sheet never loses them */
const bkshKey = () => String(bkshBook().stmtAcct || bkshBook().acct) + ':' + ((bkshBook().file && bkshBook().file.hash) || '');
/** the engine parts the sheet needs, or null when the page did not load them */
function bkshEngine() {
  const parts = { recon: window.CBBankRecon, project: window.CBBankProject, entry: window.CBBankEntry, statementCheck: window.CBBankStatementCheck };
  return parts.recon && parts.project && parts.entry ? parts : null;
}
/** the shop's bank ledger as the preview reads it: every line carries its currency; read again after a post through bankLedger */
function bkshLedger() {
  const cur = String(bkCur() || '').toUpperCase(),
    lines = (bkshBook().ledger || []).map((item) => Object.assign({}, item, { currency: cur }));
  return { lines, opening_minor: Number((bkshBook().ledgerRaw || {}).opening_minor) || 0, posted_refs: lines.map((item) => item.ref).filter(Boolean).concat(bkshLateRefs()) };
}
/** W15-85: the lines posted in a LATER month because their own was locked: the books' ledger for the statement's dates cannot show them, the bank log does (found by their own ref, never by date) */
const bkshLateRows = () => (bankStoreState.posted || []).filter((row) => row.ref && CBBankLock.lateWords(row));
const bkshLateRefs = () => bkshLateRows().map((row) => row.ref);
const bkshLateOf = (ref) => CBBankLock.lateWords(bkshLateRows().filter((row) => row.ref === ref)[0]);
/** the card sales the books still hold on the card clearing account (the rail's books answer, when it sends them): a settlement that arrives net of a fee is read against them (BB-04) */
const bkshCardSales = () => ((bkshBook().rail && bkshBook().rail.books && bkshBook().rail.books.card_sales) || []).slice();
/** the parties the books know, in the shape the engine compares names against: every customer and supplier of the shop (GET /bank/rail books), else the rail's own list */
function bkshParties() {
  const all = (bkshBook().rail && bkshBook().rail.books && bkshBook().rail.books.parties) || [];
  if (all.length) return all.filter((item) => item.id && item.name);
  const known = (bkshBook().rail && bkshBook().rail.parties) || [];
  return known.map((item) => ({ id: item.party_id, name: item.name || '', kind: item.kind || item.role || undefined })).filter((item) => item.id && item.name);
}
/** the shop's own bank-group ledgers other than this statement's (a savings account it added): the 'moved between my own accounts' answer may name them; the engine knows the pack's own already */
function bkshOwnAccounts() {
  const own = String(bkshStatementAccount().code || bkshBook().acct);
  return bkbBanks(bkshBook().accts || []).filter((item) => String(item.code) !== own).map((item) => ({ code: String(item.code), name: item.name }));
}
/** the ledger account that already has this name — the same name twice would be refused: the one that is there is the one meant; undefined when none */
function bkshAccountNamed(known, name) {
  return ((known && known.accounts) || []).filter((item) => !item.is_group && String(item.name).toLowerCase() === name.toLowerCase())[0];
}
/**
 * the owner's own savings (or other bank) account, added where the transfer asks for it: the one door the chart uses (POST /accounts under the shop's bank group), then the accounts are read again,
 * so the "moved between my own accounts" answer can name it. Answers { ok, code } or { ok: false, why }.
 */
async function bkshAddOwnAccount(name) {
  const main = (bkshBook().accts || []).filter((item) => item.role === 'bank')[0];
  try {
    const known = await api('booksAccounts', { fresh: true }), same = bkshAccountNamed(known, name);
    const made = same ? { account: same } : await api('booksAccountAdd', { body: { name, parent_code: main ? main.parent_code : undefined } });
    const again = await api('booksAccounts', { fresh: true });
    bkshBook().accts = (again && again.accounts) || bkshBook().accts;
    return { ok: true, code: String((made && made.account && made.account.code) || '') };
  } catch (failure) {
    return { ok: false, line: true, why: bkWhy(failure, tx('Could not add the account')) };
  }
}
/** true / false as the shop said, null when it did not say (SET-49: unknown is not false, nothing is claimed on it); 'unread' when the read failed: the sheet then ASKS the tax kind and says so, so a registered shop's charge is never posted untaxed by a failed read */
async function bkshRegistered() {
  try {
    const answer = (await api('countrySetup')) || {};
    return answer.tax && typeof answer.tax.registered === 'boolean' ? answer.tax.registered : null;
  } catch (failure) {
    bkQuiet('bank-sheet-registration', failure);
    return 'unread';
  }
}
/** the shop's own bank ledger stands in for "bank" on the entry: the statement's own account, never a fixed Bank */
function bkshModeOf(body) {
  const mode = bkbModeOf(bkshBook().accts, bkshBook().stmtAcct || bkshBook().acct),
    swap = (key) => (body[key] === 'bank' ? mode : body[key]);
  if (!mode) return body;
  return Object.assign({}, body, { paid_from: swap('paid_from'), into: swap('into'), from: swap('from'), to: swap('to') });
}
/** the registration answer the preview takes: an unread answer asks each charge its tax kind (true), a said answer stands, unknown stays unknown */
function bkshTaxRegisteredFor(answer) {
  return answer === true || answer === 'unread' ? true : answer;
}
/** who is signed in, as the post adapter reads it: the shop's own login is the owner */
function bkshSignedIn() {
  if (typeof CBBooksActing !== 'undefined' && CBBooksActing.isAdviser()) return { role: 'adviser', posts: CBBooksActing.posts() }; /* the grant's posting, known up front; the server decides */
  return { role: bkshIsOwner() ? 'owner' : 'other' };
}
/** the books account the statement is for */
function bkshStatementAccount() {
  const code = String(bkshBook().stmtAcct || bkshBook().acct);
  return (bkshBook().accts || []).filter((item) => String(item.code) === code)[0] || {};
}
/** the entries already posted from bank lines, by ref: { ref → { at, by, entry_no } } (the check names who and when per line) */
function bkshPostedFeed() {
  const feed = {};
  (bankStoreState.posted || []).forEach((row) => {
    feed[row.ref] = { at: row.made_at, by: bankStoreMadeBy(row), entry_no: row.entry_no, for_client: !!row.for_client };
  });
  return feed;
}
/**
 * B5: the pairing of a statement line with the entry it made, ONE TO ONE BY OCCURRENCE: the line's own client_ref (the engine's refsOf: bank:<fingerprint>-<n>) and the posted record (ref → entry_no).
 * Two equal lines on one day carry two refs, so after posting each is paired with its own entry (never by amount and date alone). Nothing is worked out here: the engine's match() reads both.
 */
function bkshPairing(lines) {
  const engine = bkshEngine(),
    posted = {};
  if (!engine || !engine.project.refsOf || !lines || !lines.length) return { line_refs: undefined, posted: undefined };
  (bankStoreState.posted || []).forEach((row) => {
    if (row.ref && row.entry_no) posted[row.ref] = row.entry_no;
  });
  Object.keys(bkshBook().postedLocal || {}).forEach((ref) => {
    posted[ref] = bkshBook().postedLocal[ref]; /* what this very session posted: its reply named the entry, so the pairing never waits for the log */
  });
  const made = (BKSH.ctl && BKSH.ctl.pairsMade && BKSH.ctl.pairsMade()) || {};
  Object.keys(made).forEach((ref) => {
    posted[ref] = String(made[ref]).split('#')[0]; /* "Same payment": the owner said which entry this line is; the page counts it too (the id is entry_no#line) */
  });
  return { line_refs: engine.project.refsOf(lines, bkshRefAccount(), lines), posted };
}
/** the ONE account key every statement-line ref is fingerprinted with: the ledger CODE, the same the statement check hands back (fingerprint_account) and the controller posts with. A name here made the page pair by other refs than the entries were posted under (B5, reload showed twins as "Not on the statement") */
function bkshRefAccount() {
  return String(bkshStatementAccount().code || bkshBook().acct);
}
/** the carried figures the statement check compares: this account, the books' balance before the statement (the ledger read, never summed here), the reconciled statements and the posted feed */
function bkshCheckInput() {
  const acct = bkshStatementAccount(),
    statements = (bankStoreState.statements || []).map((row) => Object.assign({ made_by: bankStoreSignerFull(row) || null, made_at: row.at }, row));
  return {
    today: bkToday(),
    accounts: [{ id: String(acct.code || bkshBook().acct), name: acct.name || null, number: typeof bkbHeldNumber === 'function' && bkbHeldNumber() ? bkbHeldNumber() : null }],
    saved_account_id: String(acct.code || bkshBook().acct) /* the owner already picked this account for the statement in the Bank view */,
    books: { opening_minor: Number((bkshBook().ledgerRaw || {}).opening_minor) || 0 },
    log: { statements },
    posted: bkshPostedFeed()
  };
}
/** the controller for this statement: the books it reads, the adapter that posts, the pack's country and the rules this device learned */
function bkshController() {
  const country = bkbCountry(),
    signedIn = bkshSignedIn(),
    acct = bkshStatementAccount();
  return CBBankPreview.create({
    engine: bkshEngine(),
    currency: String(bkCur() || '').toUpperCase(),
    account: bkshRefAccount(),
    ledger: bkshLedger,
    post: CBBankPost.adapter({ api, who: signedIn, modeOf: bkshModeOf }),
    lockedMonth: (date) => CBBankLock.lockedOf(bkshMonthRows(), date) /* the months the server says are locked (GET /periods): said before any work, on the band and on each line */,
    lateOf: bkshLateOf,
    statementCurrency: () => bkshBook().stmtCur || null,
    amountText: bkshAmountText,
    checkInput: bkshCheckInput,
    postable: CBBankPost.POSTABLE,
    taxRegistered: bkshTaxRegisteredFor(BKSH.taxRegistered),
    pairing: bkshPairing,
    suggestOpts: Object.defineProperty({ country, learned: bkbRules(), parties: bkshParties(), open_items: bkbOpenItems(), card_sales: bkshCardSales() }, 'own_accounts', { enumerable: true, get: bkshOwnAccounts }) /* read per answer: an account added in this sheet is on the list at once */,
    parseOpts: { country, currency: bkshBook().stmtCur || undefined, preset: bkshBook().preset || undefined }
  });
}
/** a carried amount as the page writes it: plain, the currency is said once on the page (bkbFig, cap-bank.js) */
const bkshAmountText = (value) => bkbFig(CBBankPreview.minorOf(value), (value && value.currency) || undefined);
/** the name the shop's own chart gives an account key ("gst_collected" → "GST collected"); '' when the chart has none */
const bkshAccountName = (role) => ((bkshBook().accts || []).filter((item) => item.role === role)[0] || {}).name || '';
const bkshEl = (id) => document.getElementById(id);
/** the sheet's own words under the title: the band's ONE truth (bankFigures, cap-bank.js), so the page and the sheet never say two things; nothing here is worked out */
/** the counts every place reads: the lines still to add, how many of them are ready, how many wait for an answer (the controller's own items, counted once) */
function bkshCounts() {
  const model = BKSH.ctl.view(),
    toAdd = (model.items || []).filter((item) => item.state !== 'in_books' && !(model.results[item.key] && model.results[item.key].ok)).length,
    ready = BKSH.ctl.readyCount();
  return { toAdd, ready, needs: Math.max(0, toAdd - ready) };
}
function bkshStrip() {
  const fig = typeof bankFigures === 'function' ? bankFigures() : null;
  if (!fig || BKSH.ctl.only()) return '';
  const count = bkshCounts();
  return txf('{total} to add · {ready} ready · {needs} need an answer', { total: txn('{count} line', '{count} lines', count.toAdd), ready: count.ready, needs: count.needs }) + ' · ' + bkshFigures(fig);
}
function bkshFigures(fig) { /* one line answered: that line alone, the statement's figures stay on the page */
  return txf('Statement {s} · Books {b} · Difference {d} · Unexplained {u}', {
    s: fig.statement,
    b: fig.books,
    d: fig.gap,
    u: fig.unexplained
  });
}
/** the sheet's one say-line: red for what went wrong, green for what was added */
function bkshSay(words, good) {
  const node = bkshEl('bks_say');
  if (!node) return;
  node.textContent = words || '';
  node.className = good ? 'pe-ok' : 'pe-bad';
}
/** paint the sheet again from the controller: the strip, the lines, and the Add button with its count */
/** a "Same payment" answer is the page's truth too: when the pairs changed, the page counts its lines again (no read: the engine's match with the pairs added) */
function bkshPageFollows() {
  const sig = JSON.stringify((BKSH.ctl.pairsMade && BKSH.ctl.pairsMade()) || {}) + JSON.stringify((BKSH.ctl.movedMonths && BKSH.ctl.movedMonths()) || {});
  if (sig === BKSH.pairSig) return;
  BKSH.pairSig = sig;
  if (typeof bankExplain === 'function' && typeof bankPaint === 'function') {
    bankExplain();
    bankPaint();
  }
}
/** paint the sheet: the strip, the lines, and the Add button with the count it will add */
function bkshPaint() {
  const model = BKSH.ctl.view(),
    addButton = bkshEl('bks_add'),
    ready = BKSH.ctl.readyCount();
  bkshEl('bks_strip').textContent = bkshStrip();
  if (model.parsed) BKSH.ui.paint(model);
  if (model.refusal) bkshSay(model.refusal, false);
  if (addButton) {
    addButton.disabled = !ready || BKSH.posting;
    addButton.textContent = ready ? (BKSH.ctl.only() ? tx('Add this line to your books') : txf('Add these {n} ready lines', { n: ready })) : tx('Nothing ready to add');
  }
}
/** the question the Add press asks first: how many entries, how much, which dates, how many new parties, how many still need you (the engine's own carried totals) */
function bkshAsk() {
  const said = BKSH.ctl.confirmText();
  if (!said) return null;
  return { title: tx(said.title), body: said.lines.map((words) => '<p>' + bkbE(words) + '</p>').join(''), yes: tx('Add to your books'), danger: false };
}
/** the one write: confirm, post the ready lines one at a time, read the books again, paint what happened on each line */
async function bkshAdd(btn) {
  const question = bkshAsk();
  if (!question) return void bkshSay(tx('The engine sent no figures for this press, so nothing was added.'), false);
  if (BKSH.posting || (await CBAction.ask(question)) !== true) return;
  BKSH.posting = true;
  bkshPaint();
  try {
    const done = await BKSH.ctl.postReady(() => {});
    bkshNoteAdded();
    await bankRun();
    bkshAcceptAdded(); /* the owner's own adds read as accepted at once, whichever way the sheet is closed later */
    /* the Bank view reads the books and the rail again and repaints: its band and its counts follow what was posted (B4) */
    BKSH.ctl.answer('ledger_read', Date.now()); /* projects again over the books just read */
    const said = done.failed ? txf('{a} added, {f} not added: each says why on its line.', { a: done.added, f: done.failed }) : txf('{a} added to your books.', { a: done.added });
    const figures = typeof bankFigures === 'function' ? bankFigures() : null;
    if (!done.failed && figures && figures.nil) {
      /* nothing is left: the books agree with the statement, so the sheet closes itself and the Bank view offers the sign-off */
      BKSH.posting = false;
      closeModal();
      toast(said);
      return;
    }
    bkshSay(said, !done.failed);
  } catch (failure) {
    bkQuiet('bank-sheet-add', failure);
    bkshSay(tx('Could not finish adding. Nothing more was sent. Open the Bank view again to see what was added.'), false);
  }
  BKSH.posting = false;
  bkshPaint();
}
/** the entry the ＋ Entry opens for a line: the page's bankEntryPreset when it has one, else the statement's own words and figure on the statement's own side */
function bkshEntryPreset(item, key) {
  if (typeof bankEntryPreset === 'function') return bankEntryPreset(item, bkshBook());
  const line = item.line || {},
    minor = line.debit_minor || line.credit_minor || 0;
  return { v: Object.assign({ date: line.date, amount: bkMinorText(minor, bkCur()), narration: 'Bank statement ' + line.date + ': ' + String(line.narration || '').slice(0, 120) }, bkshBankEnd(line)), ref: item.ref || 'bank:' + ((bkshBook().file && bkshBook().file.hash) || '') + ':' + key };
}
/** the one step on a line the sheet cannot finish (a tax payment, a loan, a transfer): the ＋ Entry opens for that line, the sheet stays kept behind it. The entry is pre-filled by bankEntryPreset when the bank-match build provides it; else the date, amount and words of the line */
function bkshEntry(key) {
  const item = ((BKSH.ctl && BKSH.ctl.view().items) || []).filter((one) => one.key === key)[0];
  if (!item) return { ok: false, why: tx('That line is gone') };
  if (typeof enOpen !== 'function') return { ok: false, why: tx('This starts after an update') };
  const preset = bkshEntryPreset(item, key);
  closeModal();
  enOpen(preset);
  return { ok: true };
}
/** the statement's own account on the side of the entry it is on, so the entry never asks again: money out → paid_from / from, money in → into / to (its mode when the ledger has one, else its code) */
function bkshBankEnd(line) {
  const code = String(bkshBook().stmtAcct || bkshBook().acct),
    end = bkbModeOf(bkshBook().accts, code) || code;
  return (+line.debit_minor || 0) > 0 ? { paid_from: end, from: end } : { into: end, to: end };
}
/**
 * BNK-new-10: the lines the owner just added from the sheet were CONFIRMED by the owner (the press named what it reached), so each is accepted as it comes back matched: the accept mark names the entry
 * it made, and the bank log no longer lists it as posted-not-accepted. The refs added in this sheet session are remembered here; nothing is accepted that the sheet did not post.
 */
function bkshNoteAdded() {
  const results = (BKSH.ctl && BKSH.ctl.view().results) || {},
    items = (BKSH.ctl && BKSH.ctl.view().items) || [];
  BKSH.added = BKSH.added || {};
  BKSH.movedAdded = BKSH.movedAdded || {};
  items.forEach((item) => {
    if (item.moveTo && results[item.key] && results[item.key].ok && results[item.key].entry_no) BKSH.movedAdded[item.key] = results[item.key].entry_no; /* posted in the next open month: its own accept mark names it below */
  });
  bkshBook().postedLocal = bkshBook().postedLocal || {};
  Object.keys(results).forEach((ref) => {
    if (results[ref] && results[ref].ok) {
      BKSH.added[ref] = true;
      if (results[ref].entry_no) bkshBook().postedLocal[ref] = results[ref].entry_no;
    }
  });
}
/** accept each added line that now reads as matched, by its own client_ref (one to one by occurrence) */
function bkshAcceptAdded() {
  const added = BKSH.added || {},
    parsed = bkshBook().parsed;
  if (!parsed || !Object.keys(added).length) return;
  const refs = bkshPairing(parsed.lines).line_refs || [];
  (bkshBook().rows || []).forEach((row) => {
    if (added[refs[row.i]] && (row.status === 'matched' || row.status === 'settled')) bankAccept(row, true);
    else if (added[refs[row.i]] && BKSH.movedAdded && BKSH.movedAdded[refs[row.i]]) bankAccept(Object.assign({}, row, { chits: [], books: [{ entry_no: BKSH.movedAdded[refs[row.i]] }] }), true); /* W15-85: the same mark as a normal add (line key to the entry), though the entry sits in the next month */
  });
  BKSH.added = {};
  BKSH.movedAdded = {};
}
/** the sheet closed: the Bank view reads the books again so the lines that were added show as matched, and the owner's own adds are accepted */
function bkshClose() {
  closeModal();
  if (typeof bankRun === 'function' && bkshBook().parsed) bankRun().then(bkshAcceptAdded).catch((failure) => bkQuiet('bank-sheet-close', failure));
}
/** the statement, the engine and the three scripts the sheet needs are all there */
function bkshReady() {
  const scripts = [typeof CBBankPreview, typeof CBBankPreviewUI, typeof CBBankPost];
  return !!bkshBook().text && !!bkshEngine() && scripts.every((kind) => kind !== 'undefined');
}
/** the sheet's first words under the title: the engine's refusal, or that registration could not be read */
function bkshFirstWords(said, unread) {
  if (!said.ok) return said.why;
  return unread ? txf('Could not check whether the shop is registered for {tax}, so each charge asks what {tax} it carries.', { tax: packWord('taxName') }) : '';
}
/** the controller's key of one bank row (its client_ref, one to one by occurrence), '' when the row is not on this statement */
function bkshKeyOfRow(row) {
  const parsed = bkshBook().parsed;
  return row && parsed ? String((bkshPairing(parsed.lines).line_refs || [])[row.i] || '') : '';
}
/**
 * ONE split per bank line (l16-bank-10): the page's rows read the same controller the sheet runs, so "Ready to add" and "Needs you" are one answer for one file.
 * The controller is made quietly as soon as the statement is read (no sheet), and kept for the sheet; the page repaints when it is there.
 */
async function bkshPrime() {
  if (!bkbBound() || !bkshReady()) return;
  if (BKSH.taxRegistered === null || BKSH.taxRegistered === 'unread') BKSH.taxRegistered = await bkshRegistered();
  await bkshReadMonths();
  if (!BKSH.ctl || BKSH.key !== bkshKey()) {
    BKSH.ctl = bkshController();
    BKSH.key = bkshKey();
    BKSH.said = BKSH.ctl.load(bkshBook().text, bkshBook().file && bkshBook().file.name);
  } else BKSH.ctl.answer('ledger_read', Date.now());
  BKSH.refs = null;
  bkshTodo();
}
/** the Accounts Home count: the lines still to add that are not ready, from the same controller */
function bkshTodo() {
  if (!BKSH.ctl) return;
  const count = bkshCounts();
  bkbSave('todo', { n: count.needs, acct: bkshBook().acct, to: bkshBook().to });
}
/** the controller's own item for a page row, or null when the sheet's controller is not there for this statement */
function bkshItemOf(row) {
  const parsed = bkshBook().parsed;
  if (!BKSH.ctl || BKSH.key !== bkshKey() || !parsed || row.i === undefined) return null;
  if (!BKSH.refs) BKSH.refs = bkshPairing(parsed.lines).line_refs || [];
  const ref = BKSH.refs[row.i];
  return (BKSH.ctl.view().items || []).filter((one) => one.key === ref)[0] || null;
}
/** the party the books matched to a line, by name, or '' (the statement's own words stay under it) */
function bkshPartyOf(row) {
  const item = bkshItemOf(row);
  return item && item.party && item.party.status === 'existing' && item.party.name ? item.party.name : '';
}
/**
 * the answers under a line on the Bank page's own list (W15-14): the SAME painter the sheet uses, on the same controller, mounted on the list's host (a press on a button of an open row is heard there).
 * `changed(key, 'answered'|'asked')` repaints what reads the lines. Null until the controller has read this statement.
 */
function bkshPageUi(host, changed) {
  if (!BKSH.ctl || BKSH.key !== bkshKey()) return null;
  return CBBankPreviewUI.mount({
    host, controller: () => BKSH.ctl, accountName: bkshAccountName, only: () => '', currency: String(bkCur() || '').toUpperCase(), country: bkbCountry(), entry: bkshEntry, ownAccounts: bkshOwnAccounts, addOwn: bkshAddOwnAccount, amountText: bkshAmountText, addedWords: tx('Added to your books'),
    say: (words) => { if (words) toast(words); }, changed
  });
}
/** open the sheet for the statement on screen, or for ONE line of it (Add missing on a line: that line alone) */
async function bankSheetOpen(row) {
  if (!bkbBound()) return;
  if (!bkshReady()) return toast(tx('Load the statement file again to add its lines.'));
  BKSH.taxRegistered = await bkshRegistered();
  await bkshReadMonths();
  BKSH.refs = null;
  const unread = BKSH.taxRegistered === 'unread',
    kept = !!BKSH.ctl && BKSH.key === bkshKey();
  if (!kept) {
    BKSH.ctl = bkshController();
    BKSH.key = bkshKey();
    BKSH.said = null;
  }
  BKSH.ctl.only(bkshKeyOfRow(row));
  ui.dialog({
    mount: 'BKS014-U03', pop: 'POP092', titleTestid: 'bank-sheet-title',
    titleText: tx('Add to your books'), wide: true,
    bodyStyle: 'display:flex;flex-direction:column;gap:8px',
    body: '<div class="pe-note" id="bks_strip" data-testid="bank-sheet-strip" aria-live="polite"></div><div class="pe-bad" id="bks_say" data-testid="bank-sheet-say" role="status"></div><div id="bks_lines" class="bks-lines" data-testid="bank-sheet-lines"></div>',
    footerHtml: '<span class="bks-keep" data-testid="bank-sheet-kept">' + bkbE(tx('Your answers are kept if you close this. They clear when you load another statement.')) + '</span><button data-cbsid="BKS014-B17" type="button" data-testid="bank-sheet-close" onclick="bkshClose()">' + bkbE(tx('Close')) + '</button>' +
      '<button data-cbsid="BKS014-B16" id="bks_add" type="button" class="pri" data-testid="bank-sheet-add" disabled onclick="bkshAdd(this)">' + bkbE(tx('Nothing ready to add')) + '</button>'
  });
  BKSH.ui = CBBankPreviewUI.mount({
    host: bkshEl('bks_lines'), controller: () => BKSH.ctl, accountName: bkshAccountName, only: () => (BKSH.ctl ? BKSH.ctl.only() : ''), currency: String(bkCur() || '').toUpperCase(), country: bkbCountry(), entry: bkshEntry, ownAccounts: bkshOwnAccounts, addOwn: bkshAddOwnAccount, amountText: bkshAmountText, addedWords: tx('Added to your books'),
    say: (words) => { bkshSay(words, false); }, changed: () => { bkshPaint(); bkshPageFollows(); }
  });
  if (kept) BKSH.ctl.answer('ledger_read', Date.now()); /* the books may have moved since: project again, keep every answer */
  else BKSH.said = BKSH.ctl.load(bkshBook().text, bkshBook().file && bkshBook().file.name);
  bkshSay(bkshFirstWords(BKSH.said || { ok: true }, unread), false);
  bkshPaint();
}

/* ── W15-85 · A LOCKED MONTH, SAID BEFORE ANY WORK ─────────────────────────────────────────────────────────────────────────────────
 * The month rows are the server's (GET /periods, kept by cap-books.js in BK.lk.info); bank-lock.js reads them for a day. The band says which months are locked and offers two ways on: reopen the month
 * (whoever the server says may: reopen.may, through the same unlock the Month lock page uses, with a reason) or post those lines in the next open month, noted. Nothing here is worked out twice. */
/** the month rows the controller reads: the server's rows of every year it holds, [] before they are read */
const bkshMonthRows = () => Object.keys((typeof BK !== 'undefined' && BK.lk && BK.lk.info) || {}).map((key) => BK.lk.info[key]);
async function bkshReadMonths() {
  try {
    if (typeof bkPeriodsLoad === 'function') await bkPeriodsLoad();
  } catch (failure) {
    bkQuiet('bank-months', failure); /* the page still works: a locked month is then the server's answer on the line, as before */
  }
}
/** the locked months with lines in them, as the band words them: [{ key, label, name, by, at, may, next, count, moved, fy, period }] */
const bkshLockGroups = () => CBBankLock.groupsOf(BKSH.ctl && BKSH.ctl.view().items, BKSH.ctl && BKSH.ctl.movedMonths && BKSH.ctl.movedMonths());
/** the notice under the band for each locked month. Reopen is the owner's act. Posting in the next open month is the owner's, and the accountant's where the grant lets her post (the accountant does the books for the owner; the entry carries the firm's name) */
function bkshLockNotice() {
  const signedIn = bkshSignedIn(),
    owner = signedIn.role === 'owner',
    mayPost = owner || (signedIn.role === 'adviser' && !!signedIn.posts);
  return bkshLockGroups()
    .map((group, at) => {
      const reopen = owner && group.may ? '<button data-cbsid="BKS014-B60" type="button" class="act" data-testid="bank-lock-reopen-' + at + '" onclick="bkshReopen(\'' + group.key + '\')">' + bkbE(txf('Reopen {month}', { month: group.name })) + '</button>' : '',
        move = mayPost && group.next && !group.moved ? '<button data-cbsid="BKS014-B61" type="button" class="act" data-testid="bank-lock-move-' + at + '" onclick="bkshLockMove(\'' + group.key + '\', true)">' + bkbE(txf('Post in {month} instead', { month: group.next.name })) + '</button>' : '',
        back = mayPost && group.moved ? '<button data-cbsid="BKS014-B62" type="button" class="act" data-testid="bank-lock-undo-' + at + '" onclick="bkshLockMove(\'' + group.key + '\', false)">' + bkbE(tx('Keep them out')) + '</button>' : '';
      return '<div class="bk-lock" role="status" data-testid="bank-lock-' + at + '"><span class="bk-lock-w">' + bkbE(group.moved ? CBBankLock.movedWords(group) : CBBankLock.noticeWords(group)) + '</span>' + reopen + move + back + '</div>';
    })
    .join('');
}
/** the page's band and lines follow a choice about a locked month */
function bkshLockRepaint() {
  const slot = bkbEl('bk_bandslot');
  if (slot) slot.innerHTML = bankFinish();
  if (typeof bkshTodo === 'function') bkshTodo();
  if (BKB.lines) BKB.lines.refresh();
  if (BKSH.ui && bkshEl('bks_lines')) bkshPaint();
}
/** "Post in October instead" (on) or take it back (off) */
function bkshLockMove(key, on) {
  if (!BKSH.ctl) return;
  BKSH.ctl.moveLocked(key, !!on);
  bkshLockRepaint();
}
/** "Reopen September": the reason is asked first and kept (the Month lock page's own unlock); the month rows and the lines are read again */
function bkshReopen(key) {
  const group = bkshLockGroups().filter((one) => one.key === key)[0];
  if (!group) return;
  ui.dialog({
    mount: 'BKS014-U05', pop: 'POP092', titleText: txf('Reopen {month}?', { month: group.label }),
    bodyStyle: 'display:flex;flex-direction:column;gap:8px',
    body: peField('bk_lkwhy', 'Reason', peInput('bk_lkwhy', '', tx('Needed to open a month again'), 'text', ' maxlength="200" autocomplete="off"')) + '<div id="bk_lkout" class="pe-slot" role="alert"></div>',
    footerHtml: '<button data-cbsid="BKS014-B63" type="button" onclick="closeModal()">' + bkbE(tx('Cancel')) + '</button><button data-cbsid="BKS014-B64" type="button" class="pri" data-testid="bank-lock-reopen-go" onclick="bkshReopenGo(\'' + key + '\')">' + bkbE(tx('Reopen')) + '</button>'
  });
}
/** the Reopen press: the reason typed, the month opened again through the api, the sheet read again */
async function bkshReopenGo(key) {
  const group = bkshLockGroups().filter((one) => one.key === key)[0],
    reason = String(peVal('bk_lkwhy') || '').trim(),
    out = bkbEl('bk_lkout');
  if (!group) return closeModal();
  if (!reason) return void (out && (out.textContent = tx('Say why — the reason is kept')));
  try {
    await api('booksUnlock', { params: { fy: group.fy, p: group.period }, body: { reason, hard: false } });
  } catch (failure) {
    return void (out && (out.textContent = bkWhy(failure, tx('Could not change it'))));
  }
  closeModal();
  await bkshReadMonths();
  if (BKSH.ctl) BKSH.ctl.answer('ledger_read', Date.now());
  bkshLockRepaint();
  toast(txf('{month} is open again.', { month: group.label }));
}
