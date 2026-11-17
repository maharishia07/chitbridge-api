/* bank-preview-check.js — THE STATEMENT CHECK for public/app/bank-preview.js: "is this the right statement?" asked BEFORE any line is worked.
 * OWNS      checkStatement(opts, preview, pass) → { check, refusal }: builds the input for CBBankStatementCheck.check (engines), keeps the owner's ticks (preview.confirmed) and account pick (preview.chosenAccount),
 *           and says in words whether line work may go on. Opt-in: a host that passes no opts.checkInput (or has no engine.statementCheck) behaves as before.
 * CALLED BY public/app/bank-preview.js (projectNow); the host supplies opts.checkInput(ctx) → { accounts, saved_account_id, books, log, posted, today, file_hash } (the no-login demo: sample state; in-app: the ledger read and GET /bank/log).
 * FLOW      parse → match (matched[] per line) → run() → verdict refuse: stop with the first refusal's words · confirm: wait for the ticks · go: project()
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * ⭐ It computes no balance and shows no account number: the engine returns the masked tail only; the full number never enters this file's output.
 */
(function (root) {
  'use strict';
  /** the engine's input for this statement: the host's carried figures beside the parse, the match and the owner's answers */
  function inputOf(opts, preview, pass) {
    var parsed = preview.parsed,
      held = pass.held || {};
    var base = {
      currency: opts.currency,
      statement: { account: parsed.account, from: parsed.from, to: parsed.to, opening_minor: parsed.opening_minor, closing_minor: parsed.closing_minor, currency: (opts.statementCurrency && opts.statementCurrency()) || parsed.currency || null }, /* B5-05: the currency the FILE or the person said, never the account's */
      lines: parsed.lines,
      matched: parsed.lines.map(function (line, index) {
        return !!held[index];
      }),
      chosen_account_id: preview.chosenAccount || undefined,
      confirmed: preview.confirmed || []
    };
    return Object.assign(base, opts.checkInput({ parsed: parsed }));
  }
  /** the words that stop line work: the refusals of the check, joined; '' when none */
  function refusalWords(result) {
    return result.items
      .filter(function (item) {
        return item.level === 'refuse' && !item.confirmed;
      })
      .map(function (item) {
        return item.why;
      })
      .join(' ');
  }
  /** the check for this statement: { check } (null when this host does not ask), plus { refusal } when line work must stop */
  function checkStatement(opts, preview, pass) {
    var engine = opts.engine && opts.engine.statementCheck;
    if (!engine || !opts.checkInput) return { check: null, refusal: null };
    var result = engine.check(inputOf(opts, preview, pass));
    if (!result || result.ok === false) return { check: null, refusal: (result && result.why) || 'This statement could not be checked, so nothing is added.' };
    var stop = result.verdict === 'refuse' ? refusalWords(result) : '';
    return { check: result, refusal: stop || null };
  }
  /** the line numbers' own "already done" words, by line index: { 3: 'Posted by Ann on 12 Oct (entry MJ-4).' } */
  function alreadyByLine(check) {
    var out = {};
    ((check && check.already && check.already.per_line) || []).forEach(function (row) {
      out[row.i] = row.why;
    });
    return out;
  }
  /** owner answers still owed before any line may be added (the confirm items not yet ticked) */
  function pendingCodes(check) {
    return (check && check.pending) || [];
  }
  root.CBBankPreviewCheck = { check: checkStatement, alreadyByLine: alreadyByLine, pendingCodes: pendingCodes };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CBBankPreviewCheck;
})(typeof globalThis !== 'undefined' ? globalThis : this);
