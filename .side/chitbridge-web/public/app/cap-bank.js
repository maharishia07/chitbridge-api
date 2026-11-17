/* cap-bank.js — BANK on CB Accounts (Daily): a statement file is read, matched to the shop's bank ledger, and the lines the Ledger lacks are added.
 * DECISIONS.md "Bank reconciliation runs on the SHOP'S DEVICE": the engine (CBBankRecon, public/engine/bank-recon.js, adopted at v1.18.0) parses the
 * statement IN THE BROWSER, the page fetches the shop's own bank lines (GET /api/books/ledger/:account) for the statement's dates, the engine matches
 * them and finds what is missing. The owner confirms each missing line in ＋ Entry (enOpen with a preset) and ONLY that confirmed entry goes to the
 * server, through the normal path (POST /events → MJ).
 *
 * ⭐ THE STATEMENT FILE IS NEVER UPLOADED. It is read with File.text(), parsed here, and held in memory. Nothing in this file passes its text, its name or any
 *   of its lines to api() or fetch — the only things that leave the device are the confirmed entries (a date, an amount, a note the owner saw in the preview).
 * ⭐ THE PAGE COMPUTES NO MONEY. Matching, suggestions and the BRS are the engine's; the books' balance is the API's ledger closing figure; every amount is shown
 *   through bkMoney / bkDrCr.
 * ⭐ NO DOUBLE POSTING (until the server keeps a match record): each entry carries client_ref = bank:<file hash>:<line no>, so posting the same line twice answers the
 *   first entry; and once an entry is saved the page fetches the ledger again, so the line is simply matched.
 * Never the word "accounting" on a screen.
 *
 * ⭐ BR1 · THE RAIL ALREADY TOLD US (2026-10-13). Each statement line is put against THREE things — the line ↔ the other party's payment chit ↔
 *   the ledger entry (CBBankRecon.explain, engines v1.44.0). GET /api/books/bank/rail brings the advices on my copies (M30) and the bank questions
 *   I asked — the only thing asked of the server is the statement's two dates. States: Settled (their chit + my books: ✓ Accept, one tap) ·
 *   Told (their chit, not in my books: Record — the pay sheet opens with their amount, reference and bills) · In books · Check · Asked ·
 *   Suggested · Needs you. A line nobody explained → ✉ Ask: a message chit to the party ("INR 4,200.00 on 12 Oct, ref R — which bill?"), only
 *   the date, the amount and the reference travel; their advice answers it, for both books. Better than Xero / QBO: they GUESS from amount and
 *   narration; we confirm from a sealed record both sides hold, and ask the payer when nobody did.
 * ⭐ THE MARKS: accept marks, notes and the rules learned (CBBankRecon.step / learn) stay in localStorage as the cache; the shared record (FIN-70, cap-bank-store.js) keeps the marks too and until it is set up says so. Undo takes an accept back and keeps the notes; a note never blocks accepting; a learned rule is only a suggestion, shown with where it came from. The count of lines that need a person rides to Accounts Home (bankTodoItem).
 * OWNS      the Bank view of CB Accounts (Daily › Bank): the statement read on the device (bankView · bankRun · bkbLoad), each line's state (bankRail · bankExplain · bankList),
 *           accept · undo · forget · note · record · ask (cap-bank-rows.js: bankAccept · bankUndo · bankForget · bankNote · bankRecord · bankAsk), the BRS and its CSV (bankBrsPaint · bankBrsCsv ·
 *           bankBrsDownload) and the count of lines that need a person (bankTodoItem)
 * CALLED BY public/accounts.html (script tag; BK.views bank: bankView, and the Home to-do reads bankTodoItem). Nothing else loads it: app.html has no ensureCap name for it (so it is a customer file, not app.html-only)
 * FLOW      pick a statement file → parsed in the browser (CBBankRecon) → the shop's bank ledger + GET /api/books/bank/rail → lines painted by state → accept · record (enOpen) · ask (bankAsk) → ledger read again
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 */
'use strict';
/* stmtAcct = the account the statement on screen was read FOR; stmtCur = the currency the person said the file is in (B5-05: never the account's by default) */
const BKB = { acct: '', stmtAcct: '', stmtCur: '', preset: '', file: null, parsed: null, ledger: null, m: null, rows: [], tab: 'lines', bal: '', view: 'home' }; /* view: 'home' (the page the menu's Bank always opens on) | 'lines' (a statement's lines; cap-bank-home.js) */
const bkbE = (v) => esc(v);
/** a figure on this page: plain, with no symbol. The currency is said ONCE (the header line, and the confirm's "Currency" line); the page is one account, so one currency. Money stays a value type in code; this is display only.
 *  A figure whose own currency differs from the page's keeps its code. The grouping and decimals are bkMoney's (the one formatter) with its symbol taken off. */
function bkbFig(minor, c) {
  const page = String(bkCur() || '').toUpperCase(),
    code = String(c || page).toUpperCase(),
    text = bkMoney(minor, code || undefined);
  if (!page || code !== page) return text;
  /* the figure alone: its sign and its digits with their own grouping marks; a symbol or code before or after is dropped. A shape not read this way stays as bkMoney wrote it. */
  const read = /^(-?)\s*[^\d-]*?\s*(\d[\d.,\s'  ]*)[^\d]*$/.exec(text);
  return read ? read[1] + read[2].trim() : text;
}
const bkbEl = (id) => document.getElementById(id);
const bkbWords = {
  /* what the engine's proposal means, in the shop's words */
  'expense:bank_charges': 'Bank charge',
  'other_income:interest_received': 'Interest received',
  'contra:bank>cash': 'Cash drawn from the bank',
  'contra:cash>bank': 'Cash paid into the bank',
  payment_received: 'Payment received from a customer',
  payment_made: 'Payment made to a supplier',
  cheque_dishonoured: 'Returned cheque'
};
function bkbEventWord(ev) {
  if (!ev) return '';
  const k = ev.type === 'contra' ? 'contra:' + ev.from + '>' + ev.to : ev.type === 'expense' || ev.type === 'other_income' ? ev.type + ':' + ev.class : ev.type;
  return tx(bkbWords[k] || 'Another entry');
}
/* FIN-27 · THREE GROUPS, one count each: every engine state answers one question — is the pair in both, only in the bank, or only in your books?
   (the states stay on each row's chip; the head and the filter speak the three) */
const BKB_GROUPS = [
  { key: 'books', label: 'Not in your books', states: ['bank-only', 'check', 'suggested', 'told', 'asked'] },
  { key: 'matched', label: 'In your books', states: ['settled', 'matched', 'accepted'] },
  { key: 'bank', label: 'Not on the statement', states: ['missing', 'told-only'] }
];
/** the group a row's state belongs to; a state nobody listed lands in "Missing in your books", where a person looks at it */
const bkbGroupOf = (status) => (BKB_GROUPS.filter((item) => item.states.indexOf(status) >= 0)[0] || BKB_GROUPS[0]).key;
/* ── ON THIS DEVICE: the marks (accept · note · file) of a bank account, and the rules learned — keyed by the shop, never uploaded ── */
const bkbShop = () => {
  try {
    return (typeof SESSION !== 'undefined' && SESSION && SESSION.entityId) || 'shop';
  } catch (_) {
    return 'shop';
  }
};
const bkbKey = (what) => 'cb_bankrec:' + bkbShop() + ':' + what;
function bkbLoad(what, dflt) {
  try {
    const parsed = JSON.parse(localStorage.getItem(bkbKey(what)) || 'null');
    return parsed == null ? dflt : parsed;
  } catch (_) {
    return dflt;
  }
}
function bkbSave(what, v) {
  try {
    localStorage.setItem(bkbKey(what), JSON.stringify(v));
  } catch (_) { /* storage blocked or full: the page works without it */ }
}
const bkbRec = () => (BKB.rec = BKB.rec || bkbLoad('marks:' + BKB.acct, {}));
const bkbRules = () => (BKB.rules = BKB.rules || bkbLoad('rules', []));
const bkbBy = () => {
  try {
    return (typeof SESSION !== 'undefined' && SESSION && SESSION.name) || null;
  } catch (_) {
    return null;
  }
};
/** the shop's own country, upper-cased; '' when none is stated. The bank rules are the country pack's, so every engine call names it (CTRY-94: the engine never guesses one) */
function bkbCountry() {
  return String((typeof SESSION !== 'undefined' && SESSION && SESSION.country) || '').toUpperCase();
}
/** the engine's one sentence for a shop with no country (CBRegulation.status(null).why); '' when the shop has one. The bank rules are the pack's, so with none the page says this and never calls the engine (CTRY-94) */
function bkbNoCountryWords() {
  if (bkbCountry()) return '';
  const said = typeof CBRegulation !== 'undefined' && CBRegulation.status ? CBRegulation.status(null) : null;
  return (said && said.why) || tx('Set the shop country first (Country setup).');
}
/**
 * B5-07: every action on a statement (a mark, an entry, a payment, the sign-off) belongs to the account the statement was read for. True when the dropdown still names it; otherwise says so and refuses,
 * so nothing the person does on account A's lines can land on account B.
 */
function bkbBound() {
  if (BKB.parsed && BKB.stmtAcct && BKB.stmtAcct === BKB.acct) return true;
  toast(tx('This statement was read for another bank account. Load the file again for this account.'));
  return false;
}
/** the dropdown moved to another account: the statement, its marks and its reconciliation belong to the old one, so they are cleared and the file is asked for again (B5-07) */
function bankAcctPick(code, loading) {
  const moved = BKB.stmtAcct && BKB.stmtAcct !== code;
  BKB.acct = code;
  if (!moved) return;
  Object.assign(BKB, { text: null, stmtAcct: '', stmtCur: '', file: null, parsed: null, ledger: null, ledgerRaw: null, m: null, brs: null, rec: null, rows: [], teach: null, bal: '' });
  const file = bkbEl('bk_file'),
    res = bkbEl('bk_res'),
    out = bkbEl('bk_out');
  if (file) file.value = '';
  if (res) res.innerHTML = '';
  bankLayout(false, false);
  if (loading) return; /* the Statements box is about to read a kept file for this account: the device copy is not loaded over it */
  if (bankRestore()) return;
  if (out) out.innerHTML = '<div class="pe-note" data-testid="bank-acct-changed">' + bkbE(tx('You changed the bank account, so the statement on screen was cleared. Load the statement file for this account.')) + '</div>';
}
/** one step action: the engine's step, the device copy, then the shared record */
/** an acting adviser works the bank page for the client; the owner's own login too. Only the owner's grant decides whether the adviser may POST (the server stays the authority) */
const bkbActing = () => typeof CBBooksActing !== 'undefined' && CBBooksActing.isAdviser();
const bkbMayAct = () => peOwner() || bkbActing();
/** W15-71: the auditor's seat reads the bank (home, kept files, a month's lines, who matched, the sign-off) and writes nothing: no Add, Post, Match, Note, Sign off or Reopen is drawn, and the rail (party and bank details) is not asked */
const bkbReadOnly = () => typeof bkReadOnlySeat === 'function' && bkReadOnlySeat();
/** the sentence for an adviser whose grant does not post straight into these books ('' when the person may act) */
function bkbActRefusal() {
  return bkbActing() && !CBBooksActing.posts() ? tx('The owner has not let you post straight into these books. Prepare a journal for the owner to accept instead.') : '';
}
function bkbStep(action) {
  if (!bkbBound()) return false;
  if (bkbActRefusal()) {
    toast(bkbActRefusal());
    return false;
  }
  const next = CBBankRecon.step(bkbRec(), Object.assign({ at: new Date().toISOString(), by: bkbBy() }, action));
  if (next.why) {
    toast(tx(next.why));
    return false;
  }
  BKB.rec = next;
  bkbSave('marks:' + BKB.acct, next);
  bankStoreAppend(action); /* the shared record (cap-bank-store.js); the device copy above stays as the offline cache */
  return true;
}
/** a confirmed explanation → a suggestion rule (the newest wins for the same words) */
function bkbLearn(line, x) {
  if (bkbNoCountryWords()) return;
  const r = CBBankRecon.learn(line, x, { at: new Date().toISOString(), by: bkbBy(), country: bkbCountry() });
  if (!r.ok) return;
  BKB.rules = bkbRules()
    .filter((y) => y.id !== r.rule.id)
    .concat([r.rule]);
  bkbSave('rules', BKB.rules);
}
const bkbIsBank = (a, groupCode) => !a.is_group && (a.role === 'bank' || (groupCode != null && a.parent_code === groupCode));
function bkbBanks(accts) {
  const main = accts.filter((item) => item.role === 'bank')[0],
    g = main ? main.parent_code : null;
  return accts.filter((item) => bkbIsBank(item, g) && item.active !== false);
}
/** the payment mode of the ledger a statement belongs to (its own role: 1520 Card settlements is 'card'); null when the ledger has no mode, so nothing is posted to another account by guess */
function bkbModeOf(accts, code) {
  const a = (accts || []).filter((x) => String(x.code) === String(code))[0];
  return a && /^(cash|bank|upi|card)$/.test(a.role || '') ? a.role : null;
}

/* ── the file: read and hashed on this device ── */
async function bkbHash(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((item) => item.toString(16).padStart(2, '0'))
      .join('');
  } catch (_) {
    let h = 5381;
    for (let index = 0; index < text.length; index++) h = ((h << 5) + h + text.charCodeAt(index)) | 0;
    return ('00000000' + (h >>> 0).toString(16)).slice(-8).repeat(8);
  }
}

/** the banks the shop's COUNTRY pack knows (pack.bank.presets), never another country's list (I6: an Australian shop was offered the Indian banks); none when no country is stated */
function bkbPresets() {
  const pack = typeof CBRegulation !== 'undefined' && bkbCountry() ? CBRegulation.resolve({ country: bkbCountry() }) : null;
  return (pack && pack.bank && pack.bank.presets) || {};
}
async function bankView(body) {
  let accts = [];
  try {
    const reply = await api('booksAccounts');
    accts = (reply && reply.accounts) || [];
  } catch (e) {
    body.innerHTML = '<div class="pe-bad">' + bkErr(e) + '</div>';
    return;
  }
  BKB.accts = accts;
  const banks = bkbBanks(accts);
  if (!banks.length) {
    body.innerHTML = '<div class="pe-note" data-testid="bank-none">' + bkbE(tx('There is no bank ledger yet. Add one under Shop ledgers.')) + '</div>';
    return;
  }
  if (!banks.some((item) => item.code === BKB.acct)) BKB.acct = banks[0].code;
  const known = bkbPresets(),
    presets = Object.keys(known);
  body.innerHTML =
    '<div class="pe-bank"><div class="pe-card" data-testid="bank-form"><div class="bk-line" id="bk_line" data-testid="bank-line"></div><div class="pe-form">' +
    peField(
      'bk_acct',
      'Bank account',
      peSel(
        'bk_acct',
        banks.map((item) => [item.code, item.name]),
        BKB.acct,
        ' onchange="bankAcctPick(this.value)"'
      )
    ) +
    (bkbReadOnly() ? '' : [
    peField(
      'bk_preset',
      'Which bank',
      peSel(
        'bk_preset',
        [['', 'Find out from the file']].concat(presets.map((item) => [item, known[item].bank])),
        BKB.preset,
        ' onchange="BKB.preset=this.value"'
      )
    ) +
    peField(
      'bk_file',
      'Statement file (CSV or JSON)',
      '<input data-cbsid="BKS014-I01" class="inp" type="file" id="bk_file" data-testid="bank-file" accept=".csv,.json,.txt,text/csv,application/json" onchange="bankPick(this)">'
    )].join('')) +
    '</div>' + (bkbReadOnly() ? '' : '<div class="pe-note" data-testid="bank-private">🔒 ' + bkbE(tx('The file is read on this device and is never uploaded. This device keeps the latest one.')) + '</div>') +
    '<div id="bk_out" class="pe-slot"></div></div>' +
    '<div class="pe-card bks" id="bk_stmts" data-testid="bank-stmts"></div>' /* the Statements box (cap-bank-statements.js) */ +
    '<div id="bk_res" data-testid="bank-res"></div></div>';
  BKB.view = 'home'; /* W15-84: the menu's Bank ALWAYS lands on the home; the device's last statement never decides it (it is read again from a month's press) */
  bankLayout(false, false);
  if (typeof bankHomeClass === 'function') bankHomeClass();
  if (typeof bankStmtMount === 'function') bankStmtMount(banks);
}
/** the latest statement of the bank account on screen, kept on this device: picked again when the account is changed on the plain picker (never the landing page). Null-safe when nothing is kept. */
function bankRestore() {
  const kept = bkbLoad('stmt:' + BKB.acct, null);
  if (!kept || !kept.text) return false;
  bankTake(kept.text, kept.name || '', true).catch((failure) => bkQuiet('bank-restore', failure));
  return true;
}

async function bankPick(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  bkbEl('bk_out').innerHTML = '';
  let text;
  try {
    text = await file.text();
  } catch (_) {
    return peBad('bk_out', tx('That file could not be read.'));
  }
  return bankTake(text, file.name, false);
}
/** a statement's text on screen: read, remembered on this device (never uploaded), then the currency and the books. `remembered` = it came back from this device, not from the file picker */
async function bankTake(text, name, remembered) {
  const hash = await bkbHash(text);
  if (bkbNoCountryWords()) return peBad('bk_out', bkbNoCountryWords());
  const parsed = CBBankRecon.parse(text, { format: 'auto', preset: BKB.preset || undefined, country: bkbCountry() });
  if (!parsed || !parsed.ok) {
    BKB.parsed = null;
    BKB.rows = [];
    bkbEl('bk_res').innerHTML = '';
    bankLayout(false, false);
    if (remembered) bkbSave('stmt:' + BKB.acct, null);
    return peBad('bk_out', (parsed && parsed.why) || tx('That file could not be read as a bank statement.'));
  }
  if (!remembered) bkbSave('stmt:' + BKB.acct, { name, text }); /* the page opens on the latest statement of this account next time; only this device keeps it */
  BKB.text = text; /* kept in memory only, for the Add sheet: never sent */
  BKB.postedLocal = {};
  BKB.openingOk = false; /* a new statement asks the opening-balance question afresh */
  if (typeof BKSH !== 'undefined') BKSH.ctl = null; /* a statement read again starts the sheet's answers afresh */
  BKB.file = { name, hash: hash.slice(0, 16) };
  BKB.parsed = parsed;
  BKB.stmtAcct = BKB.acct; /* B5-07: this statement belongs to the account picked NOW */
  BKB.stmtCur = parsed.currency || bkbAcctCur(); /* the file's own currency, else the account's when the account has it on record (a known fact), else asked below; nothing is guessed */
  BKB.bal = '';
  const dates = parsed.lines.map((item) => item.date).sort();
  BKB.from = parsed.from || dates[0];
  BKB.to = parsed.to || dates[dates.length - 1];
  if (!parsed.lines.length) return peBad('bk_out', tx('There are no transactions in that file.'));
  await bankCurrencyRun();
}
/** the currency the statement's bank account has on record: the account's own, else the ledger's; '' when neither is known (then the person is asked) */
function bkbAcctCur() {
  const ledger = (BKB.accts || []).filter((item) => String(item.code) === String(BKB.stmtAcct || BKB.acct))[0] || {};
  return String(ledger.currency || bkCur() || '').toUpperCase();
}
/** B5-05: the file does not say its currency AND the account has none on record, so ask once; the statement is not read against the books until the person answers */
function bankCurrencyAsk() {
  const shopCurrency = bkbAcctCur(); /* the one fact the shop already states, shown filled in: one press confirms it, the field changes it */
  bkbEl('bk_res').innerHTML = '';
  bkbEl('bk_out').innerHTML =
    '<div class="pe-note" data-testid="bank-currency-ask">' +
    bkbE(tx(shopCurrency ? 'This statement is in the currency below (your shop\'s). Change it if the file is in another.' : 'Which currency is this statement in? Nothing is assumed.')) +
    ' <input class="inp" id="bk_cur" type="text" maxlength="3" size="4" autocomplete="off" value="' + bkbE(shopCurrency) + '" data-testid="bank-currency" data-cbsid="BKS014-S01" aria-label="' + bkbE(tx('Statement currency, three capital letters')) + '"> <button data-cbsid="BKS014-B09" type="button" class="act" data-testid="bank-currency-go" onclick="bankCurrencyUse()">' +
    bkbE(tx('Read this statement')) +
    '</button></div>';
}
function bankCurrencyUse() {
  const chosen = String((bkbEl('bk_cur') || {}).value || '').trim().toUpperCase();
  if (!chosen) return toast(tx('Say which currency the statement is in first.'));
  if (typeof CBMoney !== 'undefined' && CBMoney.isIsoCurrency && !CBMoney.isIsoCurrency(chosen)) return toast(tx('That is not a currency code. Use three capital letters.'));
  BKB.stmtCur = chosen;
  bankCurrencyRun().catch((failure) => bkQuiet('bank-currency', failure));
}
/** the statement's currency, asked when the file did not say: it must be the bank account's (nothing is converted), then the books are read */
async function bankCurrencyRun() {
  if (!BKB.stmtCur) return bankCurrencyAsk();
  const accountCurrency = bkbAcctCur();
  if (accountCurrency && BKB.stmtCur.toUpperCase() !== accountCurrency) {
    BKB.parsed = null;
    BKB.rows = [];
    bkbEl('bk_res').innerHTML = '';
    return peBad('bk_out', txf('This statement is in {a} but the bank account is in {b}. Nothing is converted.', { a: BKB.stmtCur, b: accountCurrency }));
  }
  bkbEl('bk_out').innerHTML = '';
  await bankRun();
  bankFileAccountNote();
}
/** the digits of an account number or name, so a file's "062-000 1234" and a ledger's "Bank 062000 1234" meet */
const bkbDigits = (text) => String(text || '').replace(/\D/g, '');
/** B5-07: the account number the FILE prints against the ledger picked: when they differ (or the ledger names none) the person is told, never silently trusted */
function bankFileAccountNote() {
  const said = bkbDigits(BKB.parsed && BKB.parsed.account),
    ledger = (BKB.accts || []).filter((item) => String(item.code) === String(BKB.acct))[0] || {},
    ours = bkbDigits(ledger.name),
    out = bkbEl('bk_out');
  if (!said || !out || (ours && (ours.includes(said) || said.includes(ours)))) return;
  out.innerHTML = '<div class="pe-warn" data-testid="bank-file-account">' + bkbE(txf('The file is for account {a}. Check it is the one you picked: {b}.', { a: String(BKB.parsed.account), b: ledger.name || BKB.acct })) + '</div>';
}

/** the shop's own bank lines for the statement's dates → the engine's ledger lines */
async function bankLedger() {
  const reply = await api('booksLedger', { params: { account: BKB.acct }, query: { from: BKB.from, to: BKB.to } });
  BKB.ledgerRaw = reply || {};
  return ((reply && reply.lines) || []).map((item, index) => ({
    id: String(item.ref) + '#' + index,
    date: item.date,
    dr_minor: Number(item.dr_minor) || 0,
    cr_minor: Number(item.cr_minor) || 0,
    ref: (item.source && item.source.how_ref) || null,
    narration: item.what || '',
    entry_no: item.ref,
    chit_id: item.source_chit_id || null
  }));
}
/** BR1: what the other parties already told us for the statement's dates — their advices and my questions. A failure is said, never a blank: the lines still match the books */
async function bankRail() {
  if (bkbReadOnly()) return { chits: [], parties: [], books: { parties: [], open_items: [] }, may: {}, me: null, currency: null }; /* the auditor never asks the rail: no failure notice either */
  try {
    const r = (await api('booksBankRail', { query: { from: BKB.from, to: BKB.to } })) || {};
    return { chits: r.rail_chits || [], parties: r.parties || [], books: r.books || { parties: [], open_items: [] }, may: r.may || {}, me: r.me || null, currency: r.currency || null };
  } catch (e) {
    return { chits: [], parties: [], may: {}, failed: true };
  }
}
async function bankRun() {
  if (!bkbBound()) return;
  const res = bkbEl('bk_res');
  if (res) res.innerHTML = '<div class="loadwrap"><span class="spin"></span> ' + bkbE(tx('Reading…')) + '</div>';
  let rail;
  try {
    [BKB.ledger, rail] = await Promise.all([bankLedger(), bankRail()]);
  } catch (e) {
    if (res) res.innerHTML = '';
    return peBad('bk_out', e, tx('Could not read the bank ledger'));
  }
  BKB.rail = rail;
  BKB.rec = await bankStoreLoad(BKB);
  BKB.rules = null;
  bankExplain();
  bankBrs();
  bankPaint();
  /* ONE split per line: the rows read the controller the Add sheet runs (cap-bank-sheet.js), so the page, the sheet and the demo say the same of one file */
  if (typeof bkshPrime === 'function') bkshPrime().then(() => bankPaint()).catch((failure) => bkQuiet('bank-prime', failure));
}
/** every customer and supplier of the books (not only those on the rail) and every open invoice or bill, as the books sent them (GET /bank/rail books): the engine matches a line to them, the page matches nothing */
const bkbBookParties = () => ((BKB.rail && BKB.rail.books && BKB.rail.books.parties) || []).slice();
const bkbOpenItems = () => ((BKB.rail && BKB.rail.books && BKB.rail.books.open_items) || []).slice();
/** my own advice names its entry: the ledger line of that entry is the third leg (an id join, not a sum) → writes payment_id on those ledger lines */
function bkbJoinOwnAdvice(chits) {
  const own = {};
  chits.forEach((item) => {
    const advice = (item.business_json || {}).payment_advice;
    if (item.direction === 'sent' && advice && advice.adviser_entry_no && advice.adviser_payment_id) own[advice.adviser_entry_no] = advice.adviser_payment_id;
  });
  BKB.ledger.forEach((item) => {
    if (own[item.entry_no]) item.payment_id = own[item.entry_no];
  });
}
/** the bank questions I asked (message chits to a party): { key, chit_id, party, at } each */
function bkbAsksOf(chits) {
  return chits
    .filter((item) => item.direction === 'sent' && (item.business_json || {}).kind === 'bank_query' && item.business_json.bank_query)
    .map((item) => ({ key: item.business_json.bank_query.key, chit_id: item.chit_id, party: item.party, at: item.created_at }));
}
/** a list of records as { id → record } */
function bkbById(list, idOf) {
  const map = {};
  list.forEach((item) => {
    map[idOf(item)] = item;
  });
  return map;
}
/** a statement line's own facts as a row of the page's list: its date, words, reference, side and amount */
function bkbLineFacts(line) {
  return {
    date: line.date,
    narration: line.narration,
    ref: line.ref || line.cheque_no || '',
    in: (+line.credit_minor || 0) > 0,
    amount_minor: +line.credit_minor || 0 || +line.debit_minor || 0
  };
}
/** the state the engine gave a line and what the page calls it: a settled or matched line the person accepted is 'accepted' */
function bkbStatusOf(found, marks) {
  const was = found.state === 'unexplained' ? 'bank-only' : found.state;
  return { was, status: marks[found.key] && (was === 'settled' || was === 'matched') ? 'accepted' : was };
}
/** one statement line, its state and what the engine found for it, as a row of the page's list */
function bkbStatementRow(found, parsed, marks, byChit, byLedger) {
  const line = parsed.lines[found.i],
    state = bkbStatusOf(found, marks);
  return Object.assign(bkbLineFacts(line), {
    id: 's' + found.i,
    i: found.i,
    key: found.key,
    stmt: line,
    status: state.status,
    was: state.was,
    how: found.how,
    x: found,
    chits: found.chits.map((id) => byChit[id]).filter(Boolean),
    party: found.party || (found.asked && found.asked.party) || null,
    books: (found.state === 'check' ? found.candidates || [] : found.ledger).map((id) => byLedger[id]).filter(Boolean),
    sugg: found.suggestion,
    asked: found.asked,
    accepted: state.status === 'accepted' ? marks[found.key] : null /* W15-71: who matched it and when, the shared record's own mark */
  });
}
/** a ledger line the statement does not have */
function bkbMissingRow(item) {
  return {
    id: 'l' + item.id,
    status: 'missing',
    date: item.date,
    narration: item.narration,
    ref: item.entry_no,
    in: (+item.dr_minor || 0) > 0,
    amount_minor: +item.dr_minor || 0 || +item.cr_minor || 0,
    books: [item]
  };
}
/** a payment the other side's chit told me about that is on neither the statement nor my books */
function bkbToldOnlyRow(item) {
  return {
    id: 'r' + item.chit_id,
    status: 'told-only',
    date: item.date,
    narration: item.words || '',
    ref: item.ref || '',
    in: item.side === 'in',
    amount_minor: item.amount_minor,
    chits: [item],
    party: item.party,
    books: []
  };
}
/** the engine puts every line against the party's chit and the books; the page only names the states (no money is computed here) → BKB.rows, BKB.counts and the Home count */
function bankExplain() {
  const parsed = BKB.parsed,
    chits = (BKB.rail.chits || []).map((item) => Object.assign({}, item, { party: item.party && item.party.id ? item.party : null }));
  bkbJoinOwnAdvice(chits);
  const pays = CBBankRecon.railPayments(chits),
    byChit = bkbById(pays, (item) => item.chit_id),
    asks = bkbAsksOf(chits);
  const pairing = typeof bkshPairing === 'function' ? bkshPairing(parsed.lines) : {};
  const explained = CBBankRecon.explain(parsed.lines, BKB.ledger, pays, { window_days: 3, asks, line_refs: pairing.line_refs, posted: pairing.posted, parties: bkbBookParties(), open_items: bkbOpenItems(), learned: bkbRules(), bank: BKB.preset || undefined, country: bkbCountry() });
  BKB.m = {
    unmatched_ledger: explained.unmatched_ledger || [],
    unmatched_stmt: explained.rows.filter((item) => !item.ledger.length).map((item) => Object.assign({ i: item.i }, parsed.lines[item.i]))
  };
  const byLedger = bkbById(BKB.ledger, (item) => item.id),
    marks = bkbRec().accepted || {};
  const rows = explained.rows.map((found) => bkbStatementRow(found, parsed, marks, byChit, byLedger));
  (explained.unmatched_ledger || []).forEach((item) => rows.push(bkbMissingRow(item)));
  (explained.rail_only || []).forEach((item) => rows.push(bkbToldOnlyRow(item)));
  BKB.rows = rows;
  BKB.counts = explained.counts;
  /* the Home count: what needs a person, from the last statement read on this device */
  bkbSave('todo', { n: explained.counts.needs_you, acct: BKB.acct, to: BKB.to });
}


/** the name of the ledger the statement is for, as the chart names it */
const bkbAcctName = () => ((BKB.accts || []).filter((item) => String(item.code) === String(BKB.stmtAcct || BKB.acct))[0] || {}).name || '';
/** the Bank Reconciliation Statement: the books' balance is the API's ledger closing figure; the bank's is the statement's (or typed); the engine states the difference */
function bankBrs() {
  const P = BKB.parsed,
    last = P.lines[P.lines.length - 1] || {};
  let bank = P.closing_minor != null ? P.closing_minor : last.balance_minor != null ? last.balance_minor : null;
  if (bank == null && BKB.bal !== '') {
    const m = bkToMinor(BKB.bal);
    if (!isNaN(m)) bank = m;
  }
  BKB.bankKnown = bank != null;
  if (bank == null) {
    BKB.brs = null;
    return;
  }
  BKB.brs = CBBankRecon.brs({
    asOf: BKB.to,
    bookBalance_minor: Number((BKB.ledgerRaw || {}).closing_minor) || 0,
    bankBalance_minor: bank,
    country: bkbCountry(),
    unmatched_ledger: BKB.m.unmatched_ledger || [],
    unmatched_stmt: BKB.m.unmatched_stmt || []
  });
}

/** the page is "loaded" once a statement is on screen: the load form folds to one line and the lines fill the screen (body.bk-on, accounts.html); the Statement view scrolls as a page */
function bankLayout(loaded, fill) {
  const pane = document.querySelector('.pe-bank');
  if (pane) pane.classList.toggle('bk-loaded', !!loaded);
  if (pane && !loaded) pane.classList.remove('bk-open');
  document.body.classList.toggle('bk-on', !!(loaded && fill));
}
/** the one QUIET line the load form folds to: the file, and the way back to the form. The account, the period and the count are the band's (bank-band.js), said large once (W15-18) */
function bankLineHtml() {
  return ''; /* the way back to the form is the band's "Load another statement" (bankFinish): nothing is drawn here any more */
}
/** the load form opens again over the lines (a different file or account); the list is re-fitted to the room left */
function bankChange(btn) {
  const pane = document.querySelector('.pe-bank');
  if (!pane) return;
  const open = pane.classList.toggle('bk-open');
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = tx(open ? 'Hide the form' : 'Load another statement');
  window.dispatchEvent(new Event('resize'));
  /* the box is not ready: the plain picker is the only door */
  const file = bkbEl('bk_file');
  if (open && file) file.focus(); /* the form opens ABOVE the band that holds this button: the keyboard goes to its file box */
}
/** the lines of one group, from the rows the engine explained (a count of rows, nothing summed) */
/** the group a row counts in: the engine's, except a line the books hold by its own client_ref (posted in a later month because its own was locked, W15-85): the controller says it is in the books */
const bkbRowGroup = (item) => {
  const group = bkbGroupOf(item.status),
    one = group !== 'matched' && typeof bkshItemOf === 'function' ? bkshItemOf(item) : null;
  return one && one.state === 'in_books' ? 'matched' : group;
};
const bkbCount = (key) => BKB.rows.filter((item) => bkbRowGroup(item) === key).length;
/** a signed period at nil: "Sign off again" lives in More on a phone, where the band has no room for the button (the band shows it from 760 px up) */
function bankMoreSignAgain() {
  const fig = bankFigures();
  if (!fig || !fig.nil || typeof bankStoreSignedNow !== 'function' || !bankStoreSignedNow() || bankStoreState.mode !== 'server') return '';
  return '<button data-cbsid="BKS014-B26" type="button" role="menuitem" class="bk-mi bk-more-sign" data-testid="bank-signoff-more" onclick="bankMoreToggle(false);bankStoreSignOff(this)">' + bkbE(tx('Sign off again')) + '</button>';
}
/** the More menu: the Statement view and the file of the reconciliation; one button opens it, Esc and a press outside close it */
function bankMoreHtml(worked, withStore) {
  const download =
    worked && worked.ok
      ? '<button data-cbsid="BKS014-B02" type="button" role="menuitem" class="bk-mi" data-testid="bank-brs-download" onclick="bankMoreToggle(false);bankBrsDownload()">' + bkbE(tx('Download the reconciliation')) + '</button>'
      : '';
  return (
    '<span class="bk-menu"><button data-cbsid="BKS014-B19" type="button" class="act" id="bk_more" data-testid="bank-more" aria-haspopup="menu" aria-expanded="false" onclick="bankMoreToggle()">' +
    bkbE(tx('More')) + ' ▾</button><div class="bk-pop" id="bk_pop" role="menu" data-testid="bank-more-menu" hidden>' +
    (withStore && typeof bankStoreLine === 'function'
      ? '<div class="bk-note" id="bk_store_line" data-testid="bank-store-line" data-mode="' + bankStoreState.mode + '">' + bkbE(bankStoreLine()) + '</div>'
      : '') +
    '<button data-cbsid="BKS014-B01" type="button" role="menuitem" class="bk-mi" data-testid="bank-tab-brs" onclick="bankMoreToggle(false);BKB.tab=\'brs\';bankPaint()">' + bkbE(tx('The statement and sign-off')) + '</button>' +
    download + bankMoreSignAgain() + '</div></span>'
  );
}
function bankMoreToggle(want) {
  const pop = bkbEl('bk_pop'),
    btn = bkbEl('bk_more');
  if (!pop || !btn) return;
  const open = want === undefined ? pop.hidden : !!want;
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) (pop.querySelector('button') || btn).focus();
  else btn.focus();
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && bkbEl('bk_pop') && !bkbEl('bk_pop').hidden) {
    event.stopPropagation();
    bankMoreToggle(false);
  }
});
document.addEventListener('click', (event) => {
  const pop = bkbEl('bk_pop');
  if (pop && !pop.hidden && !event.target.closest('.bk-menu')) {
    pop.hidden = true;
    bkbEl('bk_more').setAttribute('aria-expanded', 'false');
  }
});

function bankPaint() {
  const res = bkbEl('bk_res');
  if (!res) return;
  const P = BKB.parsed;
  if (!P) {
    res.innerHTML = '';
    bankLayout(false, false);
    return;
  }
  /* the engine's note that a bank's format is not confirmed is for its builders: the shop is told what to do about it */
  const ws = (P.warnings || []).map((item) =>
    /verify against a real file/i.test(item) ? tx('Check the lines against your statement — this bank format is not confirmed yet.') : item
  );
  const warn = ws.length ? '<div class="pe-warn" data-testid="bank-warn">⚠ ' + bkbE(ws.slice(0, 3).join(' · ')) + (ws.length > 3 ? ' …' : '') + '</div>' : '';
  const lines = BKB.tab !== 'brs';
  res.innerHTML =
    warn +
    bankOpeningHtml() +
    '<div id="bk_bandslot">' + bankFinish() + '</div>' +
    (lines
      ? '<div id="bkl_bank" data-testid="bank-list"></div>'
      : '<div class="supacts"><button data-cbsid="BKS014-B22" type="button" class="act" data-testid="bank-tab-lines" onclick="BKB.tab=\'lines\';bankPaint()">← ' +
        bkbE(tx('Back to the lines')) + '</button><button data-cbsid="BKS014-B25" type="button" class="act" data-testid="bank-brs-print" onclick="bankBrsPrint()">' + bkbE(tx('Print or save as PDF')) + '</button></div>' + bankStorePanel() + '<div id="bk_brs" data-testid="bank-brs"></div>');
  const line = bkbEl('bk_line');
  if (line) line.innerHTML = bankLineHtml();
  if (typeof bankHomeEnter === 'function') bankHomeEnter(); /* the lines are on screen: the view is 'lines' and the browser's Back has the home to go to */
  bankLayout(true, lines);
  if (lines) bankList();
  else bankBrsPaint();
  if (typeof bankStmtPaint === 'function') bankStmtPaint(); /* a statement is on screen: the Statements box folds to its one line (it may have opened before the kept statement came back) */
}

/** the words of the band, ONE truth: the statement's figure and the books' figure (both carried: the engine's BRS reads them), the gap between them and what it is made of, and what nobody explained.
 *  Nothing is worked out twice: the gap is the two carried figures set side by side (as the Add sheet does), the unexplained is the BRS's own difference. */
function bankFigures() {
  const worked = BKB.brs;
  if (!worked || !worked.ok) return null;
  const plain = (minor) => (minor < 0 ? bkbFig(-minor) + ' ' + tx('overdrawn') : bkbFig(minor)),
    difference = worked.bank_balance_minor - worked.book_balance_minor,
    notIn = bkbCount('books'),
    notBank = bkbCount('bank');
  return {
    statement: plain(worked.bank_balance_minor),
    books: plain(worked.book_balance_minor),
    gap: bkbFig(Math.abs(difference)),
    dir: difference > 0 ? tx('the statement is higher than your books') : difference < 0 ? tx('your books are higher than the statement') : '' /* which side is higher: the two carried figures, set side by side */,
    parts: [
      notIn ? txn('{count} line not yet in your books', '{count} lines not yet in your books', notIn) : '',
      notBank ? txn('{count} line not yet on the statement', '{count} lines not yet on the statement', notBank) : ''
    ]
      .filter(Boolean)
      .join(' · '),
    unexplained: bkbFig(Math.abs(worked.difference_minor)),
    nil: difference === 0 && worked.difference_minor === 0
  };
}
/** the opening-balance question, ON THE PAGE: the statement's own opening figure against the books' balance the day before it starts (two carried figures, compared). Unanswered, Add is held. Null when they agree or one is not stated. */
function bankOpeningFacts() {
  const stated = BKB.parsed && BKB.parsed.opening_minor,
    books = BKB.ledgerRaw && BKB.ledgerRaw.opening_minor;
  if (BKB.openingOk || stated == null || books == null || Number(stated) === Number(books)) return null;
  return { statement: bkbFig(stated), books: bkbFig(books) };
}
/** "Choose another account": the load form opens again over the lines */
function bankChangeOpen() {
  const button = document.querySelector('[data-testid="bank-change"]');
  if (button && !document.querySelector('.pe-bank.bk-open')) bankChange(button);
}
function bankOpeningHtml() {
  const facts = bankOpeningFacts();
  if (!facts) return '';
  return (
    '<div class="pe-bad bk-wrong" role="alert" data-testid="bank-opening-check"><span>' +
    bkbE(txf('This statement opens at {s}; your books show {b} the day before. Is it the right bank account?', { s: facts.statement, b: facts.books })) +
    '</span><span class="bk-wrong-acts">' + bkbWrongAccountButton('bank-opening-other', 'Choose another account') +
    '<button data-cbsid="BKS014-B24" type="button" class="act" data-testid="bank-opening-go" onclick="BKB.openingOk=true;bankPaint()">' +
    bkbE(tx('It is right, go on')) +
    '</button></span></div>'
  );
}
/** the ONE primary button: Sign off when the difference is nil, else Add to your books while lines are missing; nothing for a reader who may do neither */
function bankPrimaryHtml(fig) {
  if (bkbReadOnly()) return typeof bankStoreSignButton === 'function' ? bankStoreSignButton() : ''; /* the auditor: the sign-off is SAID whenever the month is signed, whatever the difference; no button */
  const canAdd = typeof bankSheetOpen === 'function' && BKB.text && bkbMayAct();
  if (fig && fig.nil && typeof bankStoreSignButton === 'function') return bankStoreSignButton();
  if (!canAdd || (fig && !bkbCount('books'))) return '';
  const held = bankOpeningFacts() ? ' disabled title="' + bkbE(tx('Answer the question above first')) + '"' : '';
  return '<button data-cbsid="BKS014-B18" type="button" class="pri bk-primary" data-testid="bank-sheet-open"' + held + ' onclick="bankAdd()">' + bkbE(bkbCount('books') ? txn('Add {count} line to your books', 'Add {count} lines to your books', bkbCount('books')) : tx('Add to your books')) + '</button>';
}

/** the statement signed off just before this one (the log's newest period that ended before this one starts): { to, by }, or null when there is none (continuity: the engine's check words a gap or an overlap) */
function bkbPreviousStatement() {
  const from = BKB.parsed && BKB.parsed.from,
    rows = (typeof bankStoreState !== 'undefined' && bankStoreState.statements) || [];
  const before = rows.filter((row) => row.period_to && from && row.period_to < from).sort((first, second) => (first.period_to < second.period_to ? 1 : -1))[0];
  return before ? { to: before.period_to, by: (typeof bankStoreSignerFull === 'function' && bankStoreSignerFull(before)) || '' } : null;
}
/** the controller's statement check for this statement (the same one the Add sheet runs), or null before it has read the file */
const bkbCheck = () => (typeof BKSH !== 'undefined' && BKSH.ctl && BKSH.key === bkshKey() && BKSH.ctl.view().check) || null;
/** the "Wrong account? Change" button, ONE definition: the opening question and the band both use it. The load form opens again; nothing is saved, so nothing is harmed */
const bkbWrongAccountButton = (testid, label) =>
  '<button data-cbsid="BKS014-B23" type="button" class="act" data-testid="' + testid + '" onclick="bankChangeOpen()">' + bkbE(tx(label)) + '</button>';
/** W15-18, W15-20 to W15-23, W15-27 · the band over the lines (bank-band.js, the same one the public demo paints): the account large, the period, the currency said once, "Right account?", three slim tiles, the lines to go and the progress bar.
 *  Every figure is carried (bankFigures: the engine's BRS; the counts are the list's own rows). */
function bankFinish() {
  return bankBandCore() + (typeof bkshLockNotice === 'function' ? bkshLockNotice() : ''); /* W15-85: a locked month is said under the band, before any work */
}
function bankBandCore() {
  const figures = bankFigures();
  const acts = '<div class="bk-acts" data-testid="bank-actions">' + '<span id="bk_primary">' + bankPrimaryHtml(figures) + '</span>' + bankMoreHtml(BKB.brs, BKB.tab !== 'brs') + '</div>';
  if (!figures && !bkbMayAct())
    return '<div class="bk-band" data-testid="bank-finish-ask"><span>' + (BKB.tab === 'brs' ? '' : bkbE(tx("This file does not say the bank's closing balance."))) + '</span>' + acts + '</div>'; /* l16 R5 R3-3: the sign-off view says it once, in the box under the record (bankBrsPaint); the band says it on the other tabs. l16 fable3 R3-3: a read-only seat is told, never asked to type */
  if (!figures)
    return (
      '<div class="bk-band" data-testid="bank-finish-ask"><span>' + bkbE(tx("The file does not say the bank's closing balance. Type it from the statement.")) + '</span>' +
      /* W15-75: the answer is typed HERE, in one step (the same box and button the Statement tab has: the library money input and button) */
      '<span class="bk-bal-quick" data-testid="bank-bal-quick">' + peAmt('bk_bal_q', BKB.bal) + ' ' + peBtn('bank-bal-quick-go', 'Show the difference', "BKB.bal=peVal('bk_bal_q');bankBrs();bankPaint()") + '</span>' +
      acts + '</div>'
    );
  const P = BKB.parsed,
    code = bkCur();
  return CBBankBand.html({
    tid: 'bank-finish',
    account: bkbAcctName() || BKB.stmtAcct,
    from: P.from, to: P.to, count: P.lines.length, currency: code,
    change: typeof BKST !== 'undefined' && BKST.mode === 'server' ? '' /* the trail's Back (cap-bank-home.js) is the way to the files and the other statements */ : '<button data-cbsid="BKS014-B21" type="button" class="act" data-testid="bank-change" aria-expanded="false" onclick="bankChange(this)">' + bkbE(tx('Load another statement')) + '</button>',
    rightAct: bkbReadOnly() ? '' : bkbWrongAccountButton('bank-wrong-account', 'Wrong account? Change') + '<button data-cbsid="BKS014-B27" type="button" class="act" data-testid="bank-details-open" onclick="bankDetailsOpen()">' + bkbE(tx('Bank details')) + '</button>',
    actions: acts,
    right: CBBankBand.rightAccount({
      parsed: P, check: bkbCheck(), fmt: (minor) => bkbFig(minor), currency: code, statementCurrency: BKB.stmtCur,
      booksOpening_minor: BKB.ledgerRaw ? BKB.ledgerRaw.opening_minor : null, accountNumber: bkbHeldNumber(), previous: bkbPreviousStatement()
    }),
    statement: figures.statement, books: figures.books, difference: figures.gap,
    toGo: bkbCount('books'), inBooks: bkbCount('matched'), total: P.lines.length,
    unexplained: figures.unexplained && /[1-9]/.test(figures.unexplained) ? figures.unexplained : '', nil: figures.nil
  });
}
/**
 * W15-24 · the BANK DETAILS of a bank account: bank, branch code and the LAST FOUR of the account number. Asked once, optional ("not given" stays unknown, never defaulted), and matched against a file that carries a number.
 * Only the last four are kept, never the full number: that is all the match needs, and it is the form Australian banks themselves show (the Consumer Data Right banking standard's maskedNumber).
 * The branch code is the country's own: AU a 6-digit BSB (allocated by AusPayNet), IN an IFSC, else a free branch code. Kept on THIS device for this shop and account (the books have no field for it yet: a server home needs
 * an api field and a migration, which is the owner's decision), so another device or the adviser's seat does not see it until then.
 * Figures cited from the walker's knowledge, not looked up in this round: cb-country to cite-check before a requirement is written.
 */
/** the country's branch-code rule: helpers.js bankBranchRule (the pack's own first, else the one table); null = a free, neutral 'Branch code' */
const bkbBranchRule = () => bankBranchRule(bkbCountry());
const bkbBranchWords = () => {
  const rule = bkbBranchRule();
  return rule ? [rule.word, rule.hint] : ['Branch code', 'the branch code, if your bank has one'];
};
const bkbDetails = () => bkbLoad('acctdetails:' + (BKB.stmtAcct || BKB.acct), {}) || {};
/** the account number the books hold for this bank account, masked ('****1234'), or '' when none is held */
function bkbHeldNumber() {
  const held = bkbDetails();
  return held.last4 ? '****' + held.last4 : '';
}
function bankDetailsOpen() {
  const held = bkbDetails(),
    words = bkbBranchWords();
  ui.dialog({
    mount: 'BKS014-U04', pop: 'POP092',
    titleText: tx('Bank details of this account'),
    bodyStyle: 'display:flex;flex-direction:column;gap:8px',
    body: peField('bk_dbank', 'Bank', peInput('bk_dbank', held.bank, '', 'text', ' maxlength="60" autocomplete="off"')) +
      peField('bk_dbranch', words[0], peInput('bk_dbranch', held.branch, tx('For example') + ' ' + ((bkbBranchRule() || {}).example || ''), 'text', ' maxlength="20" autocomplete="off"')) +
      peField('bk_dlast4', 'Last 4 digits of the account number', peInput('bk_dlast4', held.last4, '', 'text', ' maxlength="4" inputmode="numeric" autocomplete="off"')) +
      '<div class="pe-note">' + bkbE(tx('Only the last four digits are kept, so a statement that carries the account number can be checked against this account. Nothing here is sent anywhere.')) + '</div><div id="bk_dout" class="pe-slot"></div>',
    footerHtml: '<button data-cbsid="BKS014-B29" type="button" onclick="closeModal()">' + bkbE(tx('Cancel')) + '</button><button data-cbsid="BKS014-B28" type="button" class="pri" data-testid="bank-details-save" onclick="bankDetailsSave()">' + bkbE(tx('Save')) + '</button>'
  });
}
function bankDetailsSave() {
  const bank = String(peVal('bk_dbank') || '').trim(),
    branch = String(peVal('bk_dbranch') || '').trim(),
    last4 = String(peVal('bk_dlast4') || '').trim(),
    out = bkbEl('bk_dout');
  const refuse = (words) => out && (out.innerHTML = '<div class="pe-bad" role="alert" data-testid="bank-details-bad">' + bkbE(tx(words)) + '</div>');
  if (last4 && !/^[0-9]{4}$/.test(last4)) return refuse('The last four digits of the account number are four digits.');
  const rule = bkbBranchRule();
  if (branch && rule && rule.pattern && !new RegExp(rule.pattern).test(branch)) return refuse(rule.hint ? 'The ' + rule.word + ' is ' + rule.hint + '.' : 'That branch code is not in the right form.');
  bkbSave('acctdetails:' + (BKB.stmtAcct || BKB.acct), { bank, branch, last4 });
  if (typeof BKSH !== 'undefined') BKSH.ctl = null; /* the statement is checked again with the number */
  closeModal();
  if (typeof bkshPrime === 'function') bkshPrime().then(() => bankPaint()).catch((failure) => bkQuiet('bank-details', failure));
  bankPaint();
  toast(tx('Bank details kept.'));
}
const BKB_BRS_ITEMS = [
  ['Cheques issued, not yet presented', 'issued_not_presented'],
  ['Cheques deposited, not yet credited', 'deposited_not_credited'],
  ['Credits by the bank not in your books', 'bank_credits_not_in_books'],
  ['Debits by the bank not in your books', 'bank_debits_not_in_books']
];
/** the BRS as a CSV: its lines as the engine worked them, then each named reconciling item (amounts as plain decimals) */
function bankBrsCsv(worked) {
  const currencyCode = bkCur();
  const rows = [[tx('Bank reconciliation statement as at'), worked.asOf], [tx('Currency'), currencyCode || '']].concat(worked.rows.map((x) => [tx(x.label), bkMinorText(x.minor, currencyCode)]));
  BKB_BRS_ITEMS.forEach(([title, key]) =>
    (worked[key] || []).forEach((x) => rows.push([tx(title), x.date || '', x.name || '', x.ref || '', bkMinorText(x.amount_minor, currencyCode)]))
  );
  return rows.map((row) => row.map(bkCsvCell).join(',')).join('\r\n') + '\r\n';
}
/** Print: the browser's own print sheet, the statement card alone (a print stylesheet hides the rest); PDF is its "Save as PDF" */
function bankBrsPrint() {
  const body = document.body;
  body.classList.add('brs-printing');
  const done = () => {
    body.classList.remove('brs-printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
function bankBrsDownload() {
  if (BKB.brs && BKB.brs.ok) bkSaveCsv('bank-reconciliation-' + BKB.acct + '-' + BKB.brs.asOf + '.csv', bankBrsCsv(BKB.brs));
}

/** ＋ Entry with the engine's suggestion filled in; the owner confirms in its preview, and the entry is posted through the API */
/** B5-07: an entry opened from a line belongs to the account the statement was read for */
function bankAddBound(r) {
  if (bkbBound()) bankAdd(r);
}
/** Add missing (on a line) and the Add button both open the one sheet: every line against the books, each with what it needs (FIN-117; the sheet is cap-bank-sheet.js) */
function bankAdd(row) {
  if (typeof bankSheetOpen !== 'function') return toast(tx('This starts after an update'));
  if (bkbActRefusal()) return toast(bkbActRefusal());
  bankSheetOpen(row).catch((failure) => bkQuiet('bank-add', failure));
}
/* a saved entry → fetch the bank ledger again, so the line is matched (the guard against posting it twice) */
if (typeof BK !== 'undefined')
  BK.onEntrySaved = () => {
    if (BK.tab === 'bank' && BKB.parsed) {
      if (BKB.teach) {
        bkbLearn(BKB.teach.line, BKB.teach.x);
        BKB.teach = null;
      }
      bankRun().catch(() => {});
    }
  };
/** BR1 · the Accounts Home to-do row for the bank: the count of lines that need a person, from the last statement read ON THIS DEVICE (the statement never
 *  reaches the server, so the server's To-do cannot count it). Drawn by the Home's own todoRow — the same look, the same words. null when nothing waits. */
function bankTodoItem() {
  const t = bkbLoad('todo', null),
    n = (t && Number(t.n)) || 0;
  if (!n) return null;
  return {
    kind: 'bank',
    count: n,
    words: txn('bank line needs you — from the last statement read on this device', 'bank lines need you — from the last statement read on this device', n),
    action: { screen: 'bank', label: tx('Open Bank') }
  };
}

/** one list of the reconciliation (cheques not presented, credits not in the books …): its title and a row per line; '' when the list is empty */
function bkbBrsList(title, list, testId) {
  if (!list.length) return '';
  const rows = list
    .map(
      (line) =>
        '<div class="pe-row"><span>' +
        bkbE(bkDate(line.date)) +
        ' · ' +
        bkbE(line.name || '') +
        (line.ref ? ' · ' + bkbE(line.ref) : '') +
        '</span><span class="mono">' +
        bkbE(bkbFig(line.amount_minor)) +
        '</span></div>'
    )
    .join('');
  return '<div class="pe-sub">' + bkbE(tx(title)) + '</div><div class="pe-rows" data-testid="' + testId + '">' + rows + '</div>';
}
/** the statement's own rows of the reconciliation, one line each (the engine's labels and figures) */
function bkbBrsRows(statement) {
  return statement.rows
    .map(
      (line, index) =>
        '<div class="pe-row" data-testid="brs-row-' +
        index +
        '"><span>' +
        bkbE(tx(line.label)) +
        '</span><span class="mono">' +
        bkbE(bkbFig(Math.abs(line.minor)) + (line.minor < 0 && line.sign === '' ? ' ' + tx('overdrawn') : '')) +
        '</span></div>'
    )
    .join('');
}
/** the line under the rows: tied (✓) or the engine's note on why not (⚠) */
function bkbBrsVerdict(brs) {
  return brs.tied
    ? '<div class="pe-ok" data-testid="brs-tied">✓ ' + bkbE(bankFigures() && !bankFigures().nil ? tx('Nothing is unexplained: every difference is a named line below.') : tx('The books reconcile to the bank: every difference is a named item.')) + '</div>'
    : '<div class="pe-warn" data-testid="brs-untied">⚠ ' + bkbE(brs.note || '') + '</div>';
}
/** the page when there is no reconciliation to show: no closing balance on the file (read only: nothing to type; else a box to type it in) or the engine's refusal; '' when there is one */
function bkbBrsGate(statement) {
  if (!statement && !bkbMayAct()) {
    return '<div class="pe-card" data-testid="bank-bal-ask"><div class="pe-note">' + bkbE(tx("This file does not say the bank's closing balance.")) + '</div></div>'; /* l16 fable3 R3-3: read only, no box to type in */
  }
  if (!statement) {
    return (
      '<div class="pe-card" data-testid="bank-bal-ask"><div class="pe-note">' +
      bkbE(tx("The file does not say the bank's closing balance. Type it from the statement.")) +
      '</div><div class="pe-form">' +
      peField('bk_bal', 'Balance as per the statement', peAmt('bk_bal', BKB.bal)) +
      '</div><div class="supacts">' +
      peBtn('bank-bal-go', 'Show the statement', "BKB.bal=peVal('bk_bal');bankBrs();bankPaint()") +
      '</div></div>'
    );
  }
  return statement.ok ? '' : '<div class="pe-bad" data-testid="bank-brs-bad">' + bkbE(statement.why) + '</div>';
}
function bankBrsPaint() {
  const host = bkbEl('bk_brs');
  if (!host) return;
  const gate = bkbBrsGate(BKB.brs);
  if (gate) {
    host.innerHTML = gate;
    return;
  }
  const statement = BKB.brs;
  host.innerHTML =
    '<div class="pe-card" id="bk_brs_print" data-testid="bank-brs-card"><h2 class="brs-title" data-testid="bank-brs-title">' +
    bkbE(txf('Bank reconciliation · {account} · {d}', { account: bkbAcctName(), d: bkDate(statement.asOf) })) +
    '</h2>' +
    (typeof bankStoreSignedWords === 'function' && bankStoreSignedWords() ? '<div class="pe-ok brs-signed" data-testid="bank-brs-signed">✓ ' + bkbE(bankStoreSignedWords()) + '</div>' : '') +
    '<div class="pe-sub">' +
    bkbE(txf('Bank statement as at {d}', { d: bkDate(statement.asOf) })) +
    '</div><div class="pe-rows">' +
    bkbBrsRows(statement) +
    '</div>' +
    bkbBrsVerdict(statement) +
    bkbBrsList('Cheques issued, not yet presented', statement.issued_not_presented || [], 'brs-issued') +
    bkbBrsList('Cheques deposited, not yet credited', statement.deposited_not_credited || [], 'brs-deposited') +
    bkbBrsList('Credits by the bank not in your books', statement.bank_credits_not_in_books || [], 'brs-bankcr') +
    bkbBrsList('Debits by the bank not in your books', statement.bank_debits_not_in_books || [], 'brs-bankdr') +
    '</div>';
}
