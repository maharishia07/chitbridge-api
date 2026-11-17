/* cap-bank-rows.js — BANK on CB Accounts: the lines of the statement on screen and what a person does with one line (accept · undo · forget · note · record · ask · add).
 *
 * OWNS      the lines list of the Bank view (bkbLineRows · bkbLinePanel · bkbAnswered · bankList), a line's rail actions (bankAccept · bankUndo · bankForget · bankRecord · bankNote ·
 *           bankNoteSave · bankAsk · bankNext)
 * CALLED BY cap-bank.js (bankPaint → bankList; the view's buttons) · cap-bank-sheet.js · loaded AFTER app/cap-bank.js (it shares that file's page globals BKB, bkbLoad, bkbEl …) by public/accounts.html
 * FLOW      a statement read by cap-bank.js → bankList paints one row per line by its state → a press runs accept / record / ask here → the ledger is read again by cap-bank.js
 * CARD      16-finance/bank-reconciliation-and-bank-rail
 * Split out of cap-bank.js (shrink W2, 2026-11-17): behaviour unchanged, the same global names; no money is computed here either — the engine and the API are the numbers.
 */
'use strict';
/** the page's rows for the shared list (bank-lines.js). A statement line takes the ONE standing the Add sheet's controller gives it (bkshItemOf: Ready to add or Needs you, the same split on every page); the rail's own state stays on `raw`.
 *  A line already in the books is "In your books", one only in the books is "Not on the statement". */
function bkbLineRows() {
  const rows = BKB.rows.map((found) => {
    const item = typeof bkshItemOf === 'function' ? bkshItemOf(found) : null,
      group = bkbGroupOf(found.status);
    let row;
    if (item) {
      const result = BKSH.ctl.view().results[item.key];
      row = CBBankLines.rowOfItem(item, result, CBBankPreview.standing(item, result));
    } else row = { item: null, result: null, standing: '', narration: found.narration || '', date: found.date, out: !found.in, amount_minor: found.amount_minor, kind: '', gst: '', sure: '', look: false, status: found.status === 'suggested' ? 'ready' : 'need' };
    if (group === 'matched') row.status = 'in';
    else if (group === 'bank') row.status = 'books';
    return Object.assign(row, { id: found.id, raw: found });
  });
  CBBankLines.markLookAlikes(rows);
  return rows;
}
/** what opens under a line: the answers it asks (the sheet's controller, bank-preview-ui.js: what it looks like, Dr and Cr, the questions) and, under them, what the rail and the books say about it */
function bkbLinePanel(row) {
  const answers = !bkbReadOnly() && row.item && BKB.ui && (row.status === 'need' || row.status === 'ready' || row.status === 'lock') ? BKB.ui.panel(row.item, row.result) : '';
  const booked = row.item && row.status === 'in' && row.item.alreadyWhy ? '<div class="pe-note" data-testid="bank-in-why">' + bkbE(tx('In your books') + ' · ' + row.item.alreadyWhy) + '</div>' : ''; /* W15-85: a line posted in a later month says so on its own row */
  return booked + answers + bankNext(row.raw);
}
/** an answer was given under a line on this page: the band and the chips follow (the same controller), the open row and the filters stay, and after an answer the next line that needs one opens */
function bkbAnswered(key, what) {
  bkshPageFollows(); /* a "Same payment" answer moves the pairing: the page reads its engine again (a full paint) */
  const slot = bkbEl('bk_bandslot');
  if (slot) slot.innerHTML = bankFinish();
  if (typeof bkshTodo === 'function') bkshTodo();
  if (BKB.lines) {
    BKB.lines.refresh();
    if (what === 'answered') BKB.lines.openNext(key);
  }
}
/** a rail action of a row, on the page's own row: the row carries the rail's state on `raw` */
const bkbOnRaw = (item) => Object.assign({}, item, { when: item.when && ((row) => item.when(row.raw)), run: (row) => item.run(row.raw), why: item.why && ((row) => item.why(row.raw)) });
/** the two columns the rail adds to the lines list: who told me (the parties' chits, or whom I asked) and the books entries the line is in */
function bkbRailColumns() {
  return [
      {
        key: 'party',
        label: tx('Told by'),
        prio: 5,
        w: 170,
        html: true,
        cell: (row) => {
          const r = row.raw;
          return r.chits && r.chits.length
            ? bkbE(r.chits.map((item) => (item.party && item.party.name) || tx('A party')).filter((item, index, a) => a.indexOf(item) === index).join(', '))
            : r.asked
              ? bkbE(txf('Asked {party}', { party: (r.asked.party && r.asked.party.name) || tx('the party') }))
              : '—';
        }
      },
      {
        key: 'entry',
        label: tx('In your books'),
        prio: 6,
        sort: 'entry',
        w: 170,
        html: true,
        cell: (row) => ((row.raw.books || []).length && row.raw.status !== 'check' ? '<span class="mono">' + bkbE(row.raw.books.map((item) => item.entry_no).join(', ')) + '</span>' : '—')
      }
  ];
}
/** the row actions of the rail's chits: accept · record from the chit · ask the party · add missing · record in Dues · undo · note · forget this rule; each says when it shows and why it is held */
function bkbRailActionsFor(askRight) {
  return [
    {
      id: 'accept',
      icon: '✓',
      label: 'Accept',
      tid: 'bank-accept',
      when: (r) => r.status === 'settled' || r.status === 'matched',
      run: (r) => bankAccept(r)
    },
    {
      id: 'record',
      icon: bkSymbol(bkCur()) || '¤',
      label: 'Record from the chit',
      tid: 'bank-record',
      when: (r) => r.status === 'told',
      why: () => (askRight.ok ? '' : askRight.say),
      run: (r) => bankRecord(r)
    },
    {
      id: 'ask',
      icon: '✉',
      label: 'Ask the party',
      tid: 'bank-ask',
      when: (r) => r.status === 'bank-only' || r.status === 'suggested' || r.status === 'check',
      why: () =>
        !askRight.ok ? askRight.say : !((BKB.rail && BKB.rail.parties) || []).length ? tx('Nobody on the network to ask. Add it in your books instead.') : '',
      run: (r) => bankAsk(r)
    }
  ];
}
/** the row actions that work on the books: add missing · record in Dues · undo · note · forget this rule */
function bkbBookActions(mayAct) {
  return [
    {
      id: 'add',
      icon: '＋',
      label: 'Add missing',
      tid: 'bank-add',
      when: (r) => mayAct && (r.status === 'suggested' || r.status === 'bank-only' || r.status === 'check') && !bankIsParty(r),
      run: (r) => bankAddBound(r)
    },
    {
      id: 'dues',
      icon: bkSymbol(bkCur()) || '¤',
      label: 'Record it in Dues',
      tid: 'bank-dues',
      when: (r) => peOwner() && r.status !== 'told' && bankIsParty(r),
      run: () => bkTab('dues')
    },
    { id: 'undo', icon: '↶', label: 'Undo', tid: 'bank-undo', when: (r) => r.status === 'accepted', run: (r) => bankUndo(r) },
    { id: 'note', icon: '✎', label: 'Note', tid: 'bank-note', when: (r) => !!r.key, run: (r) => bankNote(r) },
    {
      id: 'forget',
      icon: '⨯',
      label: 'Forget this rule',
      tid: 'bank-forget',
      when: (r) => !!(r.sugg && r.sugg.rule === 'learned'),
      run: (r) => bankForget(r)
    }
  ];
}
/** the Bank view's lines list: one row per statement line (and per line only the books or only a chit has), the rail's columns and actions on the shared lines list */
function bankList() {
  const host = bkbEl('bkl_bank');
  if (!host) return;
  const mayAct = bkbMayAct();
  const askRight = (BKB.rail && BKB.rail.may && BKB.rail.may.ask) || { ok: false, say: tx('Asking starts after an update') };
  const notices = [];
  if (BKB.rail && BKB.rail.failed)
    notices.push({ cls: 'warn', tid: 'bank-rail-failed', text: tx('Could not read what parties told you. Lines are matched to your books only.') });
  BKB.ui = typeof bkshPageUi === 'function' ? bkshPageUi(host, bkbAnswered) : null; /* the answers painter, on this list's host (null until the controller has read the file) */
  BKB.lines = CBBankLines.mount(host, {
    key: 'bank',
    rows: bkbLineRows,
    panel: bkbLinePanel,
    fmt: (minor) => bkbFig(minor),
    tid: (r) => 'bank-row-' + r.id,
    extra: {
      head: () => ({ notices }),
      wrapStatus: (row, icon) => '<span data-testid="bank-chip-' + bkbE(row.id) + '" data-status="' + bkbE(row.raw.status) + '">' + icon + '</span>' /* the rail's mayAct state (Settled by chit · Party told us · …) stays readable on the row; the icon is the line's standing */,
      columns: bkbRailColumns(),
      actions: bkbReadOnly() ? [] : bkbRailActionsFor(askRight).concat(bkbBookActions(mayAct)).map(bkbOnRaw)
    }
  });
}
const bankIsParty = (r) => !!(r.sugg && r.sugg.event && /^(payment_received|payment_made|cheque_dishonoured)$/.test(r.sugg.event.type));

/* ── the actions: device marks (accept · undo · note), the ONE books writer (record), the rail (ask) ── */
function bankAccept(line, quiet) {
  if (
    !bkbStep({
      act: 'accept',
      key: line.key,
      how: line.how,
      chits: (line.chits || []).map((item) => item.chit_id),
      ledger: (line.books || []).map((item) => item.entry_no)
    })
  )
    return;
  const chit = (line.chits || [])[0];
  if (chit && chit.party && chit.party.id) bkbLearn(line.stmt, { party: chit.party.id, party_name: chit.party.name });
  bankExplain();
  bankPaint();
  if (!quiet) toast(tx('Accepted. Undo keeps your notes.'));
}
function bankUndo(line) {
  if (!bkbStep({ act: 'undo', key: line.key })) return;
  bankExplain();
  bankPaint();
  toast(tx('Accept taken back. Your notes stay.'));
}
function bankForget(line) {
  const id = line.sugg && line.sugg.learned_id;
  BKB.rules = bkbRules().filter((y) => y.id !== id);
  bkbSave('rules', BKB.rules);
  bankExplain();
  bankPaint();
  toast(tx('Rule forgotten.'));
}
/** the pay sheet's starting values for a chit: the statement line's amount, the statement account's mode, the chit's reference and party name, and the bills every chit on the line settles */
function bkbPaySheetStart(line, chit) {
  return {
    amount_minor: line.amount_minor,
    mode: bkbModeOf(BKB.accts, BKB.acct) || 'bank',
    reference: chit.ref || line.ref || '',
    name: chit.party.name || '',
    bills: [].concat.apply(
      [],
      (line.chits || []).map((item) => item.bills || [])
    )
  };
}
/** their chit says what was paid and for which bills → the pay sheet opens with it placed; the person presses Record (POST /payments) */
function bankRecord(line) {
  if (!bkbBound()) return;
  const chit = (line.chits || [])[0];
  if (!chit || !chit.party || !chit.party.id) return toast(tx('This chit names no party.'));
  if (typeof payOpen !== 'function') return toast(tx('This starts after an update'));
  bkbLearn(line.stmt, { party: chit.party.id, party_name: chit.party.name });
  payOpen(line.in ? 'customer' : 'supplier', chit.party.id, bkbPaySheetStart(line, chit));
}
/** Note: the dialog to write a note on a line (kept on this device, and in the shared record when it is set up) */
function bankNote(line) {
  ui.dialog({
    mount: 'BKS014-U01', pop: 'POP092',
    titleText: tx('Note on this line'),
    bodyStyle: 'display:flex;flex-direction:column;gap:8px',
    body: '<div class="pe-note">' +
      bkbE(bkDate(line.date) + ' · ' + tx(line.in ? 'In' : 'Out') + ' ' + bkbFig(line.amount_minor)) +
      '</div>' +
      '<textarea data-cbsid="BKS014-T01" class="inp" id="bk_note" data-testid="bank-note-text" rows="3" style="width:100%" maxlength="500"></textarea>' +
      '<div class="pe-note">' +
      bkbE(bankStoreNoteWords()) +
      '</div>',
    footerHtml: '<button data-cbsid="BKS014-B03" type="button" onclick="closeModal()">' +
      bkbE(tx('Cancel')) +
      '</button><button data-cbsid="BKS014-B04" type="button" class="pri" data-testid="bank-note-save" onclick="bankNoteSave(\'' +
      bkbE(line.id) +
      '\')">' +
      bkbE(tx('Save note')) +
      '</button>'
  });
}
function bankNoteSave(id) {
  const line = BKB.rows.filter((x) => x.id === id)[0],
    text = peVal('bk_note');
  if (!line) return closeModal();
  if (!bkbStep({ act: 'note', key: line.key, text: text })) return;
  closeModal();
  bankPaint();
  toast(tx('Note kept.'));
}
/** ✉ Ask: the engine composes the question (date · amount · reference only); CBAdvice.sendBody sends it (POST /api/chits/send); their advice answers it */
function bankAsk(line) {
  const parties = (BKB.rail && BKB.rail.parties) || [],
    preset = (line.sugg && line.sugg.event && line.sugg.event.party) || '';
  BKB.asking = line.id;
  ui.dialog({
    mount: 'BKS014-U02', pop: 'POP091', titleTestid: 'bank-ask-title',
    titleText: tx('Ask the party about this line'),
    bodyStyle: 'display:flex;flex-direction:column;gap:8px',
    body: peField(
        'bk_askto',
        'Who to ask',
        peSel(
          'bk_askto',
          [['', 'Choose a party']].concat(parties.map((item) => [item.party_id, item.name || item.party_id])),
          parties.some((item) => item.party_id === preset) ? preset : '',
          ' onchange="bankAskWords()"'
        )
      ) +
      '<div class="pe-note" data-testid="bank-ask-words" id="bk_askwords"></div>' +
      '<div class="pe-note">' +
      bkbE(tx('Only the date, the amount and the reference are sent. Their payment advice settles it in both books.')) +
      '</div><div id="bk_askout" class="pe-slot"></div>',
    footerHtml: '<button data-cbsid="BKS014-B05" type="button" onclick="closeModal()">' +
      bkbE(tx('Cancel')) +
      '</button><button data-cbsid="BKS014-B06" type="button" class="pri" data-testid="bank-ask-send" onclick="bankAskSend(this)">' +
      bkbE(tx('Send')) +
      '</button>'
  });
  bankAskWords();
}
/** the question the engine composes for the line being asked about and the party chosen: { ok, body, words, key } or the reason it cannot be made */
function bankAskBody() {
  const line = BKB.rows.filter((x) => x.id === BKB.asking)[0],
    to = peVal('bk_askto'),
    party = ((BKB.rail && BKB.rail.parties) || []).filter((x) => x.party_id === to)[0];
  if (!line) return { ok: false, why: tx('That line is gone') };
  if (bkbNoCountryWords()) return { ok: false, why: bkbNoCountryWords() };
  return CBBankRecon.ask(line.stmt, {
    party: party ? { id: party.party_id, name: party.name } : null,
    currency: (BKB.rail && BKB.rail.currency) || bkCur(),
    me: BKB.rail && BKB.rail.me,
    country: bkbCountry(),
    key: line.key
  });
}
function bankAskWords() {
  const question = bankAskBody(),
    el = bkbEl('bk_askwords');
  if (el) el.textContent = question.ok ? question.words : bkbNoCountryWords() || tx('Choose who to ask.');
}
/** Send: the composed question goes through the rail's one send; the answer adds the asked chit to the page and a note to the line */
function bankAskSend(btn) {
  const question = bankAskBody(),
    line = BKB.rows.filter((x) => x.id === BKB.asking)[0];
  if (!question.ok) return peBad('bk_askout', bkbNoCountryWords() || tx('Choose who to ask.'));
  /* the rail's one send of question composed body (rail-advice.js CBAdvice.sendBody) — never question second mint */
  return CBAction.run(btn, () => CBAdvice.sendBody(question.body), {
    key: 'bankask:' + question.key,
    busy: tx('Sending…'),
    failed: tx('Not sent. Try again.'),
    /* the send went through: the asked chit joins the page's rail copy, the line is noted, the dialog closes and the lines are explained again */
    outcome: (chit_id) => {
      const partyAsked = ((BKB.rail && BKB.rail.parties) || []).filter((x) => x.party_id === peVal('bk_askto'))[0] || {};
      BKB.rail.chits = (BKB.rail.chits || []).concat([
        {
          chit_id: chit_id || 'local:' + question.key,
          direction: 'sent',
          party: { id: partyAsked.party_id, name: partyAsked.name },
          created_at: new Date().toISOString(),
          business_json: question.body.business_json,
          line_items: []
        }
      ]);
      if (line) bkbStep({ act: 'note', key: line.key, text: txf('Asked {party}', { party: partyAsked.name || '' }) });
      closeModal();
      bankExplain();
      bankPaint();
      toast(txf('Asked {party}. Their payment advice will settle this line.', { party: partyAsked.name || tx('the party') }));
    },
    onFail: (words) => peBad('bk_askout', words)
  });
}
/** one labelled line of the open row: its label (in the person's words) and its html */
function bkbNextRow(label, html) {
  return (
    '<div style="display:flex;flex-wrap:wrap;gap:4px 10px;padding:2px 0"><span style="color:var(--muted);min-width:110px">' +
    bkbE(tx(label)) +
    '</span><span style="min-width:0;overflow-wrap:anywhere">' +
    html +
    '</span></div>'
  );
}
/** how the engine matched a line, in words */
const BKB_HOW = {
  ref: 'the same reference',
  'amount+date': 'the same amount and date',
  'one-to-many': 'several together',
  'many-to-one': 'several lines together'
};
/** the books entries a line is in: number, date, amount, words */
function bkbNextBooks(line) {
  return (line.books || [])
    .map((item) =>
      bkbNextRow(
        'In your books',
        '<span class="mono">' +
          bkbE(item.entry_no) +
          '</span> · ' +
          bkbE(bkDate(item.date)) +
          ' · ' +
          bkbE(bkbFig(item.dr_minor || item.cr_minor)) +
          ' · ' +
          bkbE(item.narration)
      )
    )
    .join('');
}
/** the bills one chit settles, with the amount applied to each */
function bkbNextBills(item) {
  if (!(item.bills || []).length) return '';
  return bkbNextRow(
    'Bills',
    (item.bills || [])
      .map(
        (entry) =>
          '<span class="mono">' +
          bkbE(bkBillNo(entry.bill_no, entry.ref_chit_id, entry.date)) +
          '</span>' +
          (entry.applied_minor != null ? ' ' + bkbE(bkbFig(entry.applied_minor)) : '')
      )
      .join(' · ')
  );
}
/* the party's own chit: who, what they said, the bills it settles — the chit opens in the one popup */
function bkbNextTold(line) {
  return (line.chits || [])
    .map(
      (item) =>
        bkbNextRow(
          'Told by',
          bkbE((item.party && item.party.name) || tx('A party')) +
            (item.words ? ' · ' + bkbE(item.words) : '') +
            ' <button data-cbsid="BKS014-B07" type="button" class="cbl-btn" data-testid="bank-open-chit-' +
            bkbE(item.chit_id) +
            '" onclick="openChitSheet(\'' +
            bkbE(item.chit_id) +
            '\')">' +
            bkbE(tx('Open the chit')) +
            '</button>'
        ) + bkbNextBills(item)
    )
    .join('');
}
/** the "Asked" line: whom the question went to and when */
function bkbNextAsked(line) {
  return bkbNextRow(
    'Asked',
    bkbE(
      txf('{party} on {d}. Their payment advice will settle it.', {
        party: (line.asked.party && line.asked.party.name) || tx('The party'),
        d: bkDate(String(line.asked.at || '').slice(0, 10))
      })
    )
  );
}
/** a line the rules suggested an entry for: what it looks like, why, the rule it was learned from, and what to do next */
function bkbNextSuggested(line) {
  return (
    bkbNextRow('Looks like', bkbE(bkbEventWord(line.sugg.event))) +
    bkbNextRow('Why', bkbE(line.sugg.why || '')) +
    (line.sugg.rule === 'learned' && line.sugg.source
      ? bkbNextRow('Learned from', bkbE(txf('{n} on {d}', { n: line.sugg.source.narration || '', d: bkDate(line.sugg.source.date) })))
      : '') +
    (bankIsParty(line)
      ? bkbNextRow('Next', bkbE(tx('Record it as a payment in Dues, or ask the party which bill.')))
      : bkbNextRow('Next', bkbE(tx('Add missing opens the entry for you to check.'))))
  );
}
/** a line more than one books entry fits: why, and each entry it could be */
function bkbNextCheck(line) {
  return (
    bkbNextRow('Why', bkbE(tx('More than one entry fits this line'))) +
    (line.books || [])
      .map((item) => bkbNextRow('Could be', '<span class="mono">' + bkbE(item.entry_no) + '</span> · ' + bkbE(bkbFig(item.dr_minor || item.cr_minor))))
      .join('')
  );
}
/** the state a rail line is worded by: an accepted line reads as the state it was accepted from (settled or matched) */
function bkbNextKey(line) {
  if (line.status === 'accepted') return line.was === 'settled' ? 'settled' : 'matched';
  return line.status;
}
/** a line nobody told me about and nothing in my books matches (or the engine's own why): why, and what to do next */
function bkbNextOther(line) {
  return (
    bkbNextRow('Why', bkbE(line.sugg && line.sugg.why ? tx(line.sugg.why) : tx('Nobody told you about it and nothing in your books matches it'))) +
    bkbNextRow('Next', bkbE(tx('Ask the party which bill, or add it in your books.')))
  );
}
/** what the open row says for each state of a rail line (the chit, the books, the one next step) */
const BKB_NEXT_BY_KEY = {
  settled: (line) => bkbNextTold(line) + bkbNextBooks(line) + bkbNextRow('Next', bkbE(tx('Their chit and your books agree. Accept it.'))),
  told: (line) => bkbNextTold(line) + bkbNextRow('Next', bkbE(tx('Not in your books yet. Record from the chit fills in their amount and bills.'))),
  'told-only': (line) => bkbNextTold(line) + bkbNextRow('Why', bkbE(tx('Their chit says it was paid, but it is not on this statement yet.'))),
  matched: (line) => bkbNextBooks(line) + bkbNextRow('Matched by', bkbE(tx(BKB_HOW[line.how] || 'a rule'))) + bkbNextRow('Told by', bkbE(tx('Nobody sent a chit for it'))),
  asked: bkbNextAsked,
  suggested: bkbNextSuggested,
  check: bkbNextCheck,
  missing: () => bkbNextRow('Why', bkbE(tx('In your books but not on this statement yet — a cheque not presented, or a later date')))
};
/** the lines of the open row that depend on the line's state: the chit, the books, what to do next */
function bkbNextByStatus(line) {
  return (BKB_NEXT_BY_KEY[bkbNextKey(line)] || bkbNextOther)(line);
}
/** the notes the person wrote on a line, one line each */
function bkbNextNotes(line) {
  const notes = line.key ? (bkbRec().notes || {})[line.key] || [] : [];
  if (!notes.length) return '';
  return (
    '<div data-testid="bank-notes-' + bkbE(line.id) + '">' +
    notes.map((item) => bkbNextRow('Note', bkbE(item.text) + (item.at ? ' · ' + bkbE(bkDate(String(item.at).slice(0, 10))) : ''))).join('') +
    '</div>'
  );
}
/** the open row of a rail line (BR1): what the chit says, what the books say, and the one next step — the words only; no money is worked out here */
function bankNext(line) {
  const accepted = line.accepted && line.accepted.by
    ? bkbNextRow('Accepted by', bkbE(txf('{who} · {date}', { who: line.accepted.by, date: bkDate(String(line.accepted.at || '').slice(0, 10)) }))) /* W15-71: who matched it and when, whatever its state before */
    : '';
  return '<div data-testid="bank-next-' + bkbE(line.id) + '">' + bkbNextByStatus(line) + accepted + bkbNextNotes(line) + '</div>';
}
