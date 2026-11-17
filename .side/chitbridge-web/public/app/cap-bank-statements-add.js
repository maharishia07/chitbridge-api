/* cap-bank-statements-add.js — the STATEMENTS BOX of the Bank view: Add statement (the form, the checks, the keep).
 * OWNS      the Add statement form (bkstAddHtml: account label and file field), the reader's checks before a file is kept (bkstChecked: period, currency, fingerprint), bankStmtAdd (the press) and
 *           bankStmtPickGap (a missing month pressed picks that account in the form).
 * CALLED BY cap-bank-statements.js (bankStmtPaint draws the form; the box's presses call bankStmtAdd) · cap-bank-home.js (the grid's missing month → bankStmtPickGap). Loaded AFTER app/cap-bank-statements.js; shares its page globals BKST and bkst*.
 * FLOW      the form → bankStmtAdd → file text → bkstChecked (parse by the ONE reader, period, currency, sha256) → bkstKeep (POST booksStmtAdd) → the box is read again
 * IDS       BKS014-I12 (the account label) · BKS014-I13 (the statement file)
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * Split out of cap-bank-statements.js (shrink W2, 2026-11-17): behaviour unchanged; the statement is never uploaded as a file to anything but the box's own record route.
 */
'use strict';
/* ── Add statement ── */
function bkstAddHtml() {
  const banks = bkstBanks();
  return (
    '<div class="bks-add" data-testid="bank-stmts-add">' +
    peField('bks_acct', 'Bank account', peSel('bks_acct', banks.map((item) => [item.code, item.name]), BKST.pickAcct, ' onchange="BKST.pickAcct=this.value"')) +
    peField('bks_label', 'Label, such as ..1234', '<input data-cbsid="BKS014-I12" class="inp" id="bks_label" data-testid="bank-stmts-label" maxlength="40" autocomplete="off" value="' + bkstE(bkstLabelOf(BKST.pickAcct)) + '">') +
    peField('bks_file', 'Statement file (CSV or JSON)', '<input data-cbsid="BKS014-I13" class="inp" type="file" id="bks_file" data-testid="bank-stmts-file" accept=".csv,.json,.txt,text/csv,application/json">') +
    peBtn('bank-stmts-add-go', 'Add statement', 'bankStmtAdd()') +
    '</div>'
  );
}
/** the label already kept for the account (the owner typed it once), else empty: never guessed */
function bkstLabelOf(code) {
  const bank = ((BKST.data && BKST.data.accounts) || []).filter((item) => String(item.code) === String(code))[0];
  return (bank && bank.label) || '';
}
/** the statement's period as the reader found it (CBBankRecon.parse's from and to, else the dates of its own lines, as bankTake takes them); null when there is none */
function bkstPeriod(parsed) {
  const dates = (parsed.lines || []).map((item) => item.date).filter(Boolean).sort();
  const from = parsed.from || dates[0],
    to = parsed.to || dates[dates.length - 1];
  return from && to ? { from: String(from).slice(0, 10), to: String(to).slice(0, 10) } : null;
}
/** the currency of the ledger picked: what the file says, else what the ledger or the shop has on record; '' asks the person, nothing is assumed */
function bkstCurrency(parsed, code) {
  const ledger = (BKB.accts || []).filter((item) => String(item.code) === String(code))[0] || {};
  return String(parsed.currency || ledger.currency || bkCur() || '').toUpperCase();
}
/** the file's text, or null when the browser could not read it */
async function bkstFileText(file) {
  try {
    return await file.text();
  } catch (failure) {
    bkQuiet('bank-stmts-text', failure);
    return null;
  }
}
/** the checks before a statement is kept: the reader's parse, the period and currency it names, the file's fingerprint → { ok: true, period, currency, hash } or { ok: false, why } */
async function bkstChecked(text, code) {
  const parsed = CBBankRecon.parse(text, { format: 'auto', preset: BKB.preset || undefined, country: bkbCountry() }); /* the ONE reader: its period and currency, nothing parsed here */
  if (!parsed || !parsed.ok) return { ok: false, why: (parsed && parsed.why) || tx('That file could not be read as a bank statement.') };
  const period = bkstPeriod(parsed);
  if (!period) return { ok: false, why: tx('We could not tell which dates this statement covers, so it cannot be kept. Check it is a bank statement.') };
  const currency = bkstCurrency(parsed, code);
  if (!currency) return { ok: false, why: tx('Which currency is this statement in? Nothing is assumed.') };
  const hash = await bkbHash(text);
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, why: tx('This page cannot fingerprint the file here. Open ChitBridge over its secure address to keep statements.') };
  return { ok: true, period, currency, hash };
}
/** what the server said about the statement it kept: the words it sent (or "Kept."), amber when it overlaps another kept statement */
function bkstKeptSay(kept) {
  return '<div class="pe-' + (kept && kept.overlaps && kept.overlaps.length ? 'warn' : 'ok') + '" data-testid="bank-stmts-kept-say" role="status">' + bkstE((kept && kept.words) || tx('Kept.')) + '</div>';
}
/** keep the checked statement on our server, read the box again and say what the server said */
async function bkstKeep(out, code, file, text, checked) {
  const period = checked.period,
    currency = checked.currency,
    hash = checked.hash;
  BKST.busy = true;
  BKST.open = true; /* the person is adding: the form stays open for the next file */
  try {
    const kept = await api('booksStmtAdd', { body: { account: code, label: String((bkstEl('bks_label') || {}).value || '').trim() || undefined, period_from: period.from, period_to: period.to, currency, sha256: hash, name: file.name, text } });
    BKST.pickAcct = code;
    await bankStmtLoad();
    const slot = bkstEl(out);
    if (slot) slot.innerHTML = bkstKeptSay(kept);
  } catch (failure) {
    peBad(out, failure, tx('The statement could not be kept'));
  } finally {
    BKST.busy = false;
  }
}
/** why Add statement cannot start yet: no account picked, no file picked, or no country words; '' when it can */
function bkstAddRefusal(code, file) {
  if (!code) return tx('Pick which bank account this statement is for.');
  if (!file) return tx('Pick the statement file first.');
  return bkbNoCountryWords() || '';
}
/** Add statement: the account, the file and the checks, then the server keeps it (the statement is parsed here by the ONE reader; only its period, currency and fingerprint are asked of it) */
async function bankStmtAdd() {
  if (BKST.busy) return;
  const out = 'bks_out',
    code = String((bkstEl('bks_acct') || {}).value || ''),
    file = (bkstEl('bks_file') || {}).files && bkstEl('bks_file').files[0];
  const refusal = bkstAddRefusal(code, file);
  if (refusal) return peBad(out, refusal);
  const text = await bkstFileText(file);
  if (text === null) return peBad(out, tx('That file could not be read.'));
  const checked = await bkstChecked(text, code);
  if (!checked.ok) return peBad(out, checked.why);
  return bkstKeep(out, code, file, text, checked);
}

/* ── the grid: account × month → bank-home (bankHomeGridHtml) ── */
/** a missing month pressed: that account is picked in the form and the file picker is the next thing */
function bankStmtPickGap(button) {
  BKST.pickAcct = String(button.getAttribute('data-acct') || BKST.pickAcct);
  const select = bkstEl('bks_acct');
  if (select) select.value = BKST.pickAcct;
  const label = bkstEl('bks_label');
  if (label) label.value = bkstLabelOf(BKST.pickAcct);
  const file = bkstEl('bks_file');
  if (file) file.focus();
}
