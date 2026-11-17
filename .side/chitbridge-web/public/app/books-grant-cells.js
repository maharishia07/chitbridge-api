/**
 * books-grant-cells.js — ACC-176 part of books-grant-view.js: how ONE cell of a books read is painted.
 *
 * OWNS      the cell painters of the firm's books view: figure (the one switch by column kind), the money, Dr/Cr, change, party and risk cells, and the two notes under the list (what is highlighted, how risk is counted)
 * CALLED BY books-grant-view.js (the parts and the parent share one kit object, root.CBBooksGrantKit)
 * FLOW      kit.figure(row, column) → the cell's html or text; every number is the server's, painted in the answer's currency
 * CARD      04-network/ACC-176-AUDITOR-GRANT
 *
 * Computes nothing: a figure is the server's, a risk list is books-grant-filters.js's. Loaded before books-grant-view.js (network.html).
 */
(function (root) {
  'use strict';
  var grantKit = root.CBBooksGrantKit; /* created by books-grant-reports.js, which loads first */
  grantKit.compareDrawn = compareDrawn;
  grantKit.cmpNote = cmpNote;
  grantKit.riskNote = riskNote;
  grantKit.minorWords = minorWords;
  grantKit.riskWords = riskWords;
  grantKit.figure = figure;
  /** leader-compare #2: are the Last year · Change · % columns drawn for this read? Only when the SERVER read last year: the P&L and the trial balance say so in `compare`, the balance sheet by a change on its lines (a year before the books began carries none) */
  function compareDrawn(report) {
    var a = grantKit.viewState.answer;
    if (!a) return false;
    if (report.k === 'pl' || report.k === 'tb') return !!a.compare;
    return report.k === 'bs' && [].concat(a.assets || [], a.liabilities || [], a.equity || []).some(function (row) { return row.change_minor != null; });
  }
  /** ASA 520: the one line that says what is highlighted, from the server's rule (nothing when last year was not read or the figures are hidden) */
  function cmpNote(report) {
    var a = grantKit.viewState.answer, rule = a && a.over_rule;
    if (!a || !compareDrawn(report) || !rule || rule.pct_bp == null || rule.min_minor == null) return '';
    var amount = minorWords(rule.min_minor).replace(/[.,]0+$/, '');
    return '<style>.bv-over,.bv-over>*{background:var(--amber-t)}.bv-over-dot{color:var(--amber-i)}.bv-cmpnote{margin:6px 0;color:var(--muted);font-size:var(--fs-1,13px)}</style><div class="bv-cmpnote" data-cbsid="NET005-P03" data-testid="bv-cmp-note">' + esc(grantKit.words('Highlighted') + ': ' + grantKit.words('change of') + ' ' + rule.pct_bp / 100 + '% ' + grantKit.words('and') + ' ' + amount + ' ' + grantKit.words('or more')) + '</div>';
  }
  /** NET005-P05: under the Day book, the fixed hours and day counts the Risk column and its filters use (one sentence; not a setting) */
  function riskNote(report) {
    if (report.k !== 'daybook' || grantKit.viewState.since) return '';
    return '<style>.bv-risk{display:inline-block;min-width:1.6em;text-align:center;border-radius:10px;padding:0 6px;background:var(--amber-t);color:var(--amber-i);font-weight:600}.bv-risknote{margin:6px 0;color:var(--muted);font-size:var(--fs-1,13px)}</style><div class="bv-risknote" data-cbsid="NET005-P05" data-testid="bv-risk-note">' + esc(grantKit.words('Risk counts one point for each of: recorded after the period end · over 7 days late · at a weekend · after hours (8 pm to 7 am) · a round sum (multiple of 100) · no narration.')) + '</div>';
  }
  /** a figure in the answer's currency, the way the books screens paint it (CBBooksActing.money) */
  function minorWords(minor) {
    return root.CBBooksActing.figure(minor, (grantKit.viewState.answer && grantKit.viewState.answer.currency) || (root.CBBooksActing.current() || {}).currency);
  }
  /** a group key (trade_debtors, gst_and_statutory) as words */
  function groupWords(key) {
    var tax = (typeof root.packWord === 'function' && root.packWord('taxName')) || '';
    var text = String(key).split('_').map(function (part) { return tax && part === tax.toLowerCase() ? tax : part; }).join(' ');
    return grantKit.words(text.charAt(0).toUpperCase() + text.slice(1));
  }
  /** an entry whose Evidence state is "No source" (no document to attach to: not a fault; the pill stays for No tax invoice, No file and a held file); the state is cap-evidence.js's own (stateOf), never re-decided here */
  function noSourceRow(row) {
    return !!(row && row.evidence && root.CBEvidence && root.CBEvidence.stateOf(row.evidence).key === 'nodoc');
  }
  /** the JET rules an entry trips (the filters file's riskOf, read with the period and currency on screen) */
  function riskWords(e) {
    var F = root.CBBooksGrantFilters;
    return F ? F.riskOf(e, grantKit.viewState.period, grantKit.viewState.answer && grantKit.viewState.answer.currency, grantKit.viewState.answer && grantKit.viewState.answer.country) : [];
  }
  /** "1 risk" / "3 risks": the shell's txn (Intl.PluralRules of the reader's locale, the catalogue's one/other forms); English one/other when the page has no txn */
  function riskCount(n) {
    return typeof root.txn === 'function' ? root.txn('{count} risk', '{count} risks', n) : n + (n === 1 ? ' risk' : ' risks');
  }
  /** the Risk cell: the count, with the rules it counts as its title and as words for a reader; none = a dash */
  function riskCell(row) {
    var list = row.risk_list || [];
    return list.length ? '<span class="bv-risk" data-cbsid="NET005-P04" data-testid="bv-risk" role="img" aria-label="' + esc(riskCount(list.length) + ': ' + list.join(', ')) + '" title="' + esc(list.join(', ')) + '">' + list.length + '</span>' : '—';
  }
  /** a cell, by its column: a kind (risk, mark, money …) or a name says how it is painted; the rest is the server's value as words */
  function figure(row, column) {
    var value = row[column[0]];
    var onTb = (column[0] === 'change_minor' || column[0] === 'change_bp') && grantKit.current().k === 'tb' && root.CBTbChange ? root.CBTbChange.read(row) : null; /* F3: the trial balance's change on the account's own side (tb-change.js, shared with the owner's tab) */
    if (onTb) value = onTb[column[0]];
    var painted = kindCell(row, column, value, onTb);
    return painted !== undefined ? painted : plainCell(row, column, value);
  }
  /** the cells a column kind decides (undefined when the kind says nothing: the column name or the value then decides) */
  function kindCell(row, column, value, onTb) {
    var kind = column[2];
    if (kind === 'risk') return riskCell(row);
    if (kind === 'explain') return grantKit.explainCell(row);
    if (kind === grantKit.PCT) return pctCell(value);
    if (column[0] === 'change_minor') return changeCell(row, value, onTb && onTb.side);
    if (kind === grantKit.DRCR) return isBlank(value) ? '—' : esc(drCrWords(value));
    if (kind === grantKit.MONEY) return narrowLabel(row, column, moneyCell(row, column[0], value));
    return helperCell(row, column, value);
  }
  /** basis points as a signed percent */
  function pctCell(value) {
    return value == null ? '—' : (Number(value) > 0 ? '+' : '') + (Number(value) / 100).toFixed(1) + '%';
  }
  /** no value to paint: nothing or the empty text */
  function isBlank(value) {
    return value == null || value === '';
  }
  /** the cells that are a helper's chip: my mark, my bookmark, the evidence */
  function helperCell(row, column, value) {
    var kind = column[2], state = grantKit.viewState;
    if (kind === 'mark') return state.mk.chip(row.entry_id);
    if (kind === 'flag') return state.fl ? state.fl.chip(row.entry_id, grantKit.flagLabel(row)) : ''; /* CMP066: my own bookmark; never the client's, never the mark */
    if (column[0] === 'lock_note') return value || '—'; /* html built from the server's trail, each line escaped */
    if (column[0] === 'party_ref') return partyCell(row, value); /* one painter: the party · ref, and under it who posted it when an adviser did */
    if (kind === 'evidence') return state.ev && !noSourceRow(row) ? state.ev.chip(row) : '—'; /* CMP062: what stands behind the row (cap-evidence.js); an entry with no source document (a cash sale, an opening balance, a journal) has nothing to hold, so a quiet dash, never a pill that reads as a fault */
    return undefined;
  }
  /** any other value: blank or a dash when nothing, a day as the shop's day, a key as words, else the text */
  function plainCell(row, column, value) {
    if (value == null || value === '') return row._total ? '' : '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return root.shopDay(value); /* any day, whatever the column is called */
    return /^[a-z]+(_[a-z]+)+$/.test(String(value)) && column[0] !== 'name' ? groupWords(value) : String(value); /* a key (payment_received, soft_locked) as words */
  }
  /** the Party · ref cell (html, so escaped here): the text, and a second line "posted by …" only when the entry was posted by an adviser firm's person */
  function partyCell(row, v) {
    var text = v == null || v === '' ? '—' : String(v), by = row.posted_by_words ? '<div class="sub" data-testid="bv-posted-by">' + esc(grantKit.words('posted') + ' ' + String(row.posted_by_words).replace(/^Posted /, '')) + '</div>' : '';
    return esc(text) + by;
  }
  /** W21: on a phone the aged table is a card of values, so each aged figure names its bucket ("1–30 A$220.00"); on a wide screen the column head does that */
  function narrowLabel(row, column, painted) {
    var narrow = typeof root.matchMedia === 'function' && root.matchMedia('(max-width: 600px)').matches;
    var aged = /^age_/.test(column[0]) || (column[0] === 'balance_minor' && grantKit.viewState.report === 'dues');
    return narrow && painted && aged ? grantKit.words(column[1]) + ' ' + painted : painted;
  }
  /** the P&L's Change: a signed amount, with a quiet dot (and a word for a reader) when it is over the server's threshold; html, escaped here */
  function changeCell(row, v, side) {
    if (v == null || v === '') return '—';
    var dot = row.change_over ? '<span class="bv-over-dot" data-cbsid="NET005-P02" role="img" aria-label="' + esc(grantKit.words('Highlighted')) + '" title="' + esc(grantKit.words('Highlighted')) + '">●</span> ' : '';
    return dot + esc((Number(v) > 0 ? '+' : '') + minorWords(v) + (side ? '\u00a0' + grantKit.words(side) : ''));
  }
  /** a net balance in words: the amount, then Dr (debit) or Cr (credit); nil is 0 with neither */
  function drCrWords(minor) {
    var n = Number(minor);
    return minorWords(String(Math.abs(n))) + (n ? ' ' + grantKit.words(n > 0 ? 'Dr' : 'Cr') : '');
  }
  /** a money cell: a nil debit or credit is blank; a supplier's balance is what is owed (no minus) */
  function moneyCell(row, key, value) {
    var nothing = isBlank(value);
    if (key === 'sales_minor' && nothing) return grantKit.words('No sales');
    if ((key === 'dr_minor' || key === 'cr_minor') && (nothing || String(value) === '0')) return '';
    if (/^age_/.test(key)) return agedMoney(key, value);
    return minorWords(row.side === 'supplier' && key === 'balance_minor' ? String(Math.abs(Number(value))) : value);
  }
  /** an aged bucket: an empty one is blank, as the leaders print it (W21); one never read is a dash */
  function agedMoney(key, value) {
    if (value == null) return '—';
    return Number(value) === 0 ? '' : minorWords(value);
  }
})(typeof window !== 'undefined' ? window : globalThis);
