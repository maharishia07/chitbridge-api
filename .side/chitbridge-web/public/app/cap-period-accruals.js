/* app/cap-period-accruals.js — CB ACCOUNTS › Month & year end › Accruals & recurring. Split out of cap-period.js, code moved verbatim.
 * OWNS      the Accruals & recurring tab: the accrual rows and their reversal (peAccrualsView · peAccrBody · peAccrList · peAccrForm · peAccrSave · peAccrRev) and the recurring entries (peRec*), with PE_ACCR
 * CALLED BY public/accounts.html (script tag, after cap-period.js); accounts.html opens peAccrualsView from its Month & year end tab table
 * FLOW      Accruals tab → peAccrualsView → peAccrTab (Accruals | Recurring) → peAccrBody / peRecBody → the server's lists → a form → POST → the list paints again
 * CARD      14-accounting/periods-month-lock-year-close
 */
'use strict';
/* ═══ 3 · ACCRUALS & RECURRING ═════════════════════════════════════════════════════════════════════════════════════════
   Repeating entries: CRUD /recurring, post or skip a due one. Accruals: POST /accruals (comes back on the first day of the next month), POST /accruals/:ref/reverse.
   There is no list of accruals on the API yet: the page shows the ones that are DUE to turn back (the To-do feed's own list) and the ones made in this visit. */
/** the sentence a reader who is not the owner sees where the Close card would be (ACC-229): one wording, two places */
/** the pack's own tax word (GST · VAT · Tax) from the one reader packWord; no tax name is typed in this file */
const peTaxWord = () => (typeof packWord === 'function' && packWord('taxName')) || tx('Tax');
const peOwnerOnlyCloses = () => txf('Only the owner closes and pays {name}', { name: peTaxWord() });
const PE_FREQ = [
  ['monthly', 'Every month'],
  ['quarterly', 'Every 3 months'],
  ['yearly', 'Every year']
];
const PE_ACCR = [
  ['outstanding', 'Owed, not yet paid'],
  ['prepaid', 'Paid in advance'],
  ['accrued_income', 'Earned, not yet received'],
  ['income_in_advance', 'Received in advance']
];
async function peAccrualsView(body) {
  if (!peOwner()) {
    body.innerHTML = peNoOwner('Only the owner sees repeating entries and accruals');
    return;
  }
  body.innerHTML =
    '<div class="tabs" role="group">' +
    [
      ['rec', 'Repeating'],
      ['acc', 'Accruals']
    ]
      .map(
        (item) =>
          '<button data-cbsid="BKS016-B04" type="button" class="pe-tab" data-testid="pr-tab-' +
          item[0] +
          '" aria-pressed="' +
          (PE.tab === item[0]) +
          '" onclick="peAccrTab(\'' +
          item[0] +
          '\')">' +
          esc(tx(item[1])) +
          '</button>'
      )
      .join('') +
    '</div>' +
    '<div id="pr_body"></div>';
  peAccrPaint();
}
function peAccrTab(t) {
  PE.tab = t;
  document
    .querySelectorAll('[data-testid^="pr-tab-"]')
    .forEach((item) => item.setAttribute('aria-pressed', String(item.getAttribute('data-testid') === 'pr-tab-' + t)));
  peAccrPaint();
}
function peAccrPaint() {
  const b = peEl('pr_body');
  if (!b) return;
  if (PE.tab === 'acc') peAccrBody(b);
  else peRecBody(b);
}

async function peEntryKinds() {
  if (PE.kinds) return PE.kinds;
  const reply = await api('booksEvents');
  const picks = (reply && reply.picks) || {};
  PE.picks = picks;
  PE.kinds = ((reply && reply.events) || []).filter((e) => e.preview !== false && !e.route && e.kind !== 'journal' && (e.fields || []).length);
  return PE.kinds;
}
function peKindFields(kind) {
  const ev = (PE.kinds || []).filter((e) => e.kind === kind)[0];
  if (!ev) return '';
  return (ev.fields || [])
    .map((item) => (typeof item === 'string' ? { key: item, kind: item } : item))
    .filter((item) => item.key !== 'date')
    .map((item) => {
      const id = 'prf_' + item.key,
        lab =
          item.label ||
          { class: 'What for', paid_from: 'Paid from', into: 'Came into', from: 'Taken from', to: 'Put into', amount: 'How much', narration: 'Note' }[
            item.key
          ] ||
          item.key;
      if (item.kind === 'amount') return peField(id, lab, peAmt(id));
      if (item.kind === 'pick') {
        const opts = item.pick === 'mode' ? peMODES : ((PE.picks || {})[item.pick] || []).map((entry) => [entry.role || entry.code, entry.name]);
        return peField(id, lab, peSel(id, [['', 'Choose…']].concat(opts), ''));
      }
      return peField(id, lab, peInput(id, '', ''));
    })
    .join('');
}
function peRecKind() {
  const k = peVal('pr_kind');
  const box = peEl('pr_kfields');
  if (box) box.innerHTML = k ? peKindFields(k) : '';
}
async function peRecBody(node) {
  node.innerHTML =
    '<div class="supacts pe-bar">' +
    peBtn('pr-add-open', '＋ New repeating entry', 'peRecForm()') +
    '</div><div id="pr_form" class="pe-slot"></div><div id="pr_out" class="pe-slot"></div><div id="bkl_rec" data-testid="recurring-list"></div>';
  await peRecList();
}
async function peRecList() {
  const host = peEl('bkl_rec');
  if (!host) return;
  try {
    PE.rec = peList(await api('perRecList'), 'recurring');
  } catch (e) {
    const w = peWhy(e, tx('Could not be read'));
    host.innerHTML = '<div class="' + (w.calm ? 'pe-calm' : 'pe-bad') + '" data-testid="pe-refused">' + (w.calm ? '⏳ ' : '') + esc(w.text) + '</div>';
    return;
  }
  const today = peYmd(new Date()),
    isDue = (t) => t.active && t.next_on && t.next_on <= today;
  CBList.reset && CBList.reset('recurring');
  CBList.mount(host, {
    key: 'recurring',
    t: tx,
    rows: () => PE.rec,
    id: (t) => t.recurring_id,
    rowTid: (t) => 'rec-' + t.recurring_id,
    head: () => ({ notices: PE.rec.filter(isDue).length ? [{ cls: 'warn', tid: 'pr-due', text: txf('{n} due', { n: PE.rec.filter(isDue).length }) }] : [] }),
    columns: [
      {
        key: 'name',
        label: tx('Name'),
        prio: 1,
        sort: 'name',
        w: 230,
        html: true,
        cell: (t) => esc(t.name) + (t.active ? '' : ' <span class="optchip">' + esc(tx('Stopped')) + '</span>')
      },
      {
        key: 'next',
        label: tx('Next'),
        prio: 2,
        sort: 'next',
        w: 190,
        html: true,
        cell: (t) =>
          t.next_on
            ? esc(bkDate(t.next_on)) +
              (isDue(t) ? ' <span class="optchip" data-testid="rec-due-' + esc(t.recurring_id) + '">' + esc(tx('Due')) + '</span>' : '')
            : '—'
      },
      {
        key: 'freq',
        label: tx('How often'),
        prio: 3,
        sort: 'freq',
        w: 160,
        html: true,
        cell: (t) => esc(tx((PE_FREQ.filter((item) => item[0] === t.frequency)[0] || [0, t.frequency])[1]))
      },
      {
        key: 'what',
        label: tx('What'),
        prio: 4,
        sort: 'what',
        w: 170,
        html: true,
        cell: (t) => esc(tx(((t.event || {}).kind || (t.event || {}).type || '').replace(/_/g, ' ')))
      },
      { key: 'auto', label: tx('Posts'), prio: 5, sort: 'auto', w: 160, html: true, cell: (t) => esc(tx(t.auto ? 'By itself' : 'When I accept')) }
    ],
    search: (t) => [t.name, t.frequency, t.next_on, (t.event || {}).kind].join(' '),
    sorts: [
      { key: 'next', label: tx('Next due'), cmp: (a, b) => String(a.next_on).localeCompare(String(b.next_on)) },
      { key: 'name', label: tx('Name'), cmp: (a, b) => String(a.name).localeCompare(String(b.name)) },
      { key: 'freq', label: tx('How often'), cmp: (a, b) => String(a.frequency).localeCompare(String(b.frequency)) }
    ],
    actions: [
      { id: 'post', icon: '✓', label: 'Post it', tid: 'rec-post', when: isDue, run: (t) => peRecDo('perRecPost', t, 'Posted') },
      { id: 'skip', icon: '⤼', label: 'Skip this one', tid: 'rec-skip', when: isDue, run: (t) => peRecDo('perRecSkip', t, 'Skipped') },
      { id: 'auto', icon: '⚙', label: 'Post by itself / ask me', tid: 'rec-auto', when: (t) => t.active, run: (t) => peRecAuto(t) },
      { id: 'stop', icon: '■', label: 'Stop it', tid: 'rec-stop', when: (t) => t.active, run: (t) => peRecStop(t) }
    ],
    empty: { title: tx('No repeating entries yet') }
  });
}
async function peRecDo(key, t, word) {
  await bkOnce('pe-rec-' + key + t.recurring_id, null, async () => {
    try {
      const r = (await api(key, { params: { id: t.recurring_id }, body: {} })) || {};
      const no = r.posted && (r.posted.entry_no || r.posted.no);
      peOk('pr_out', esc(tx(word)) + (no ? ' · ' + esc(no) : '') + ' — ' + esc(t.name));
      peRecList();
    } catch (e) {
      peBad('pr_out', e);
    }
  });
}
async function peRecAuto(t) {
  await bkOnce('pe-rec-auto' + t.recurring_id, null, async () => {
    try {
      await api('perRecPatch', { params: { id: t.recurring_id }, body: { auto: !t.auto } });
      peOk('pr_out', esc(tx(!t.auto ? 'It will post by itself' : 'It will ask you each time')));
      peRecList();
    } catch (e) {
      peBad('pr_out', e);
    }
  });
}
function peRecStop(t) {
  confirmAsk(
    tx('Stop this repeating entry?'),
    esc(txf('{n} stops. What it already posted stays.', { n: t.name })),
    tx('Stop it'),
    async () => {
      try {
        await api('perRecStop', { params: { id: t.recurring_id } });
        peOk('pr_out', esc(txf('{n} stopped', { n: t.name })));
        peRecList();
      } catch (e) {
        peBad('pr_out', e);
      }
    },
    true
  );
}
async function peRecForm() {
  try {
    await peEntryKinds();
  } catch (e) {
    return peBad('pr_out', e);
  }
  PE.ref.rec = PE.ref.rec || bkRef();
  peEl('pr_form').innerHTML =
    '<div class="pe-card" data-testid="pr-form"><div class="pe-form">' +
    peField('pr_name', 'Name', peInput('pr_name', '', tx('e.g. Shop rent'))) +
    peField(
      'pr_kind',
      'What happens',
      peSel('pr_kind', [['', 'Choose…']].concat(PE.kinds.map((e) => [e.kind, e.words || e.kind])), '', ' onchange="peRecKind()"')
    ) +
    '<div id="pr_kfields" class="pe-sub-form"></div>' +
    peField('pr_freq', 'How often', peSel('pr_freq', PE_FREQ, 'monthly')) +
    peField('pr_next', 'First one on', peInput('pr_next', peYmd(new Date()), '', 'date')) +
    peField('pr_end', 'Last one on (optional)', peInput('pr_end', '', '', 'date')) +
    peField(
      'pr_auto',
      'Posts',
      peSel(
        'pr_auto',
        [
          ['0', 'When I accept'],
          ['1', 'By itself']
        ],
        '0'
      )
    ) +
    '</div><div class="supacts">' +
    peBtn('pr-save', 'Save', 'peRecSave(this)') +
    peBtn('pr-cancel', 'Cancel', "peEl('pr_form').innerHTML=''", '') +
    '</div><div id="pr_fout" class="pe-slot"></div></div>';
}
async function peRecSave(btn) {
  const kind = peVal('pr_kind');
  if (!peVal('pr_name') || !kind) return peBad('pr_fout', tx('Name it and say what happens each time.'));
  const ev = { kind };
  const fields = ((PE.kinds || []).filter((e) => e.kind === kind)[0] || {}).fields || [];
  for (const f0 of fields) {
    const f = typeof f0 === 'string' ? { key: f0, kind: f0 } : f0;
    if (f.key === 'date') continue;
    const v = peVal('prf_' + f.key);
    if (!v) continue;
    if (f.kind === 'amount') {
      const m = bkMoneyMinor(v);
      if (isNaN(m)) return peBad('pr_fout', tx('The amount must be a number.'));
      ev.amount_minor = m;
    } else ev[f.key] = v;
  }
  const body = { name: peVal('pr_name'), event: ev, frequency: peVal('pr_freq'), next_on: peVal('pr_next'), auto: peVal('pr_auto') === '1' };
  if (peVal('pr_end')) body.end_on = peVal('pr_end');
  await bkOnce('pe-rec-add', btn, async () => {
    try {
      await api('perRecAdd', { body });
      PE.ref.rec = null;
      peEl('pr_form').innerHTML = '';
      peOk('pr_out', esc(txf('{n} saved', { n: body.name })));
      peRecList();
    } catch (e) {
      peBad('pr_fout', e);
    }
  });
}

/* accruals */
async function peAccrBody(node) {
  node.innerHTML =
    '<div class="supacts pe-bar">' +
    peBtn('pc-add-open', '＋ New accrual', 'peAccrForm()') +
    '</div><div id="pc_form" class="pe-slot"></div><div id="pc_out" class="pe-slot"></div><div id="bkl_accr" data-testid="accruals-list"></div>';
  let list = [];
  try {
    const t = peList(await api('booksTodo'), 'items').filter((item) => item.kind === 'accrual_reversals_due')[0];
    list = (t && t.items) || [];
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  const seen = {};
  PE.accr.forEach((item) => {
    seen[item.ref] = 1;
  });
  PE.accrDue = list.map((item) => ({ ref: item.ref, kind: '', reverses_on: item.due, posted_on: item.posted_on, due: true }));
  PE.accrDue.forEach((item) => {
    if (seen[item.ref]) {
      const m = PE.accr.filter((a) => a.ref === item.ref)[0];
      m.due = true;
    }
  });
  peAccrList();
}
const peAccrRows = () => PE.accr.concat((PE.accrDue || []).filter((item) => !PE.accr.some((a) => a.ref === item.ref)));
function peAccrList() {
  const host = peEl('bkl_accr');
  if (!host) return;
  const today = peYmd(new Date()),
    due = (a) => a.reverses_on && a.reverses_on <= today && !a.reversed;
  CBList.reset && CBList.reset('accruals');
  CBList.mount(host, {
    key: 'accruals',
    t: tx,
    rows: peAccrRows,
    id: (a) => a.ref,
    rowTid: (a) => 'accr-' + a.ref,
    head: () => ({
      notices: peAccrRows().filter(due).length
        ? [{ cls: 'warn', tid: 'pc-due', text: txf('{n} due to turn back', { n: peAccrRows().filter(due).length }) }]
        : []
    }),
    columns: [
      { key: 'ref', label: tx('Reference'), prio: 1, sort: 'ref', w: 200, html: true, cell: (a) => '<span class="mono">' + esc(a.ref) + '</span>' },
      {
        key: 'kind',
        label: tx('Kind'),
        prio: 3,
        sort: 'kind',
        w: 220,
        html: true,
        cell: (a) => (a.kind ? esc(tx((PE_ACCR.filter((item) => item[0] === a.kind)[0] || [0, a.kind])[1])) : '—')
      },
      {
        key: 'back',
        label: tx('Turns back on'),
        prio: 2,
        sort: 'back',
        w: 190,
        html: true,
        cell: (a) =>
          esc(bkDate(a.reverses_on)) +
          (a.reversed
            ? ' <span class="optchip">' + esc(tx('Turned back')) + '</span>'
            : due(a)
              ? ' <span class="optchip" data-testid="accr-due-' + esc(a.ref) + '">' + esc(tx('Due')) + '</span>'
              : '')
      },
      {
        key: 'no',
        label: tx('Entry'),
        prio: 4,
        sort: 'no',
        w: 150,
        html: true,
        cell: (a) => (a.entry_no ? '<span class="mono">' + esc(a.entry_no) + '</span>' : '—')
      }
    ],
    search: (a) => [a.ref, a.kind, a.entry_no].join(' '),
    sorts: [
      { key: 'back', label: tx('Turns back on'), cmp: (a, b) => String(a.reverses_on).localeCompare(String(b.reverses_on)) },
      { key: 'ref', label: tx('Reference'), cmp: (a, b) => String(a.ref).localeCompare(String(b.ref)) }
    ],
    actions: [{ id: 'rev', icon: '↩', label: 'Turn it back now', tid: 'accr-reverse', when: due, run: (a) => peAccrRev(a) }],
    empty: { title: tx('Nothing due to turn back') }
  });
}
async function peAccrForm() {
  try {
    await peEntryKinds();
  } catch (e) {
    return peBad('pc_out', e);
  }
  PE.ref.accr = PE.ref.accr || bkRef();
  const cls = ((PE.picks || {}).expense_class || [])
    .map((item) => [item.code || item.role, item.name])
    .concat(((PE.picks || {}).income_class || []).map((item) => [item.code || item.role, item.name]));
  peEl('pc_form').innerHTML =
    '<div class="pe-card" data-testid="pc-form"><div class="pe-form">' +
    peField('pc_ref', 'Reference', peInput('pc_ref', '', tx('e.g. ELEC-2026-09'))) +
    peField('pc_kind', 'Kind', peSel('pc_kind', PE_ACCR, 'outstanding')) +
    peField('pc_class', 'Which expense or income', peSel('pc_class', [['', 'Choose…']].concat(cls), '')) +
    peField('pc_amt', 'How much', peAmt('pc_amt')) +
    peField('pc_date', 'At month end', peInput('pc_date', peMonthEnd(1), '', 'date')) +
    '</div><div class="supacts">' +
    peBtn('pc-save', 'Save', 'peAccrSave(this)') +
    peBtn('pc-cancel', 'Cancel', "peEl('pc_form').innerHTML=''", '') +
    '</div><div id="pc_fout" class="pe-slot"></div></div>';
}
async function peAccrSave(btn) {
  const m = bkMoneyMinor(peVal('pc_amt'));
  if (!peVal('pc_ref') || !peVal('pc_class') || isNaN(m)) return peBad('pc_fout', tx('Give it a reference, pick the expense or income, and say how much.'));
  const body = { ref: peVal('pc_ref'), kind: peVal('pc_kind'), class: peVal('pc_class'), amount_minor: m, date: peVal('pc_date'), client_ref: PE.ref.accr };
  await bkOnce('pe-accr', btn, async () => {
    try {
      const r = (await api('perAccrue', { body })) || {};
      PE.ref.accr = null;
      peEl('pc_form').innerHTML = '';
      PE.accr = PE.accr.filter((item) => item.ref !== body.ref).concat([{ ref: body.ref, kind: body.kind, reverses_on: r.reverses_on, entry_no: r.entry_no }]);
      peOk('pc_out', esc(txf('Saved · {no} · turns back on {d}', { no: r.entry_no || '', d: bkDate(r.reverses_on) })));
      peAccrList();
    } catch (e) {
      peBad('pc_fout', e);
    }
  });
}
async function peAccrRev(a) {
  await bkOnce('pe-accr-rev' + a.ref, null, async () => {
    try {
      const r = (await api('perAccrueRev', { params: { ref: a.ref }, body: { client_ref: 'accr-rev-' + a.ref } })) || {};
      PE.accr.forEach((x) => {
        if (x.ref === a.ref) x.reversed = true;
      });
      PE.accrDue = (PE.accrDue || []).filter((x) => x.ref !== a.ref);
      peOk('pc_out', esc(txf('Turned back · {no}', { no: r.entry_no || '' })));
      peAccrList();
    } catch (e) {
      peBad('pc_out', e);
    }
  });
}
