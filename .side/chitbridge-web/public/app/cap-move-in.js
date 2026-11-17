/* cap-move-in.js — MOVE IN FROM XERO / QUICKBOOKS (IM1, 2026-10-12): CB Accounts › Setup › Move in. One entry for the five exports a practice
 * brings (chart of accounts · contacts · items · trial balance · open invoices and bills), each the same three steps:
 *   File → Columns (guessed by the server, confirmed here) → Preview (the DRY RUN: will add · will merge · will skip, with the reason) → Import.
 * Phase 1 is files; CA1's practice door will call the same screen later.
 * OWNS      the Move in screen of CB Accounts › Setup (miView · miRender · miGuard · miOnStep · miImport · miConnect): the five exports as File → Columns → Preview → Import, the country gate's one line, the held rows
 * CALLED BY public/accounts.html (script tag; BK.views movein: miView) · public/app/cap-compare.js (miRow) · public/app/cap-fx.js (miRow). The practice door (CA1) will call miConnect with a company's country
 * FLOW      pick a source and file → columns guessed by the server and confirmed → the dry-run preview → Import through CBAction.run → the outcome and the skipped rows said in place (MVI steps 1–4, docs/process/flows.json)
 * CARD      14-accounting/move-in-from-xero-quickbooks
 *
 * ── WHAT IS REUSED (CLAUDE.md rule 1) ────────────────────────────────────────────────────────────────────────────────────────────
 *   · the steps ARE CBSteps (app/step-flow.js): the rail, the guard-with-a-reason, the footer, focus — this file supplies only what each step renders
 *   · the rows ARE CBList (app/list-ctl.js): the preview rows and the skipped rows — search, the action filter, cards at 390 px, only the rows scroll
 *   · the one write goes through CBAction.run (M64, app/accounts-shell.js): one press, busy, the outcome said where it happened
 *   · every amount SHOWN is bkMoney / bkDrCr (M36, cap-books.js); the server composes the row sentences (lib/move-in moneyWords) — nothing is computed here
 *   · the API's answers are the contract (e2e/fixtures/web-api.contract.json): guess · counts · rows · refusal · notes · entry
 * ── WHAT IS NEW, AND WHY ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   miView · miRender · miGuard · miOnStep · miImport — nothing existing read a Xero / QBO file (the Opening balances view takes typed lines;
 *   the catalogue import is the Product Lab's own screen for products only). Flow: MVI (Move in) steps 1–4, docs/process/flows.json.
 * ⚠️ Every action is shown; a refused one is greyed WITH the server's sentence (the step guard): an unbalanced trial balance greys Import with
 *    the refusal; a column not confirmed greys Preview with which one.
 * ── MOVE-IN W1 (2026-10-18, DECISIONS 2026-10-18:62-70) — THE COUNTRY RULE ──────────────────────────────────────────────────────────
 *   · every call carries source_country: for a file the OWNER states it (one picker, the registered packs only — CBRegulation.list — set to the
 *     shop's own country, one line saying why); for a connection (miConnect, the practice door) it is the company's own country and its id
 *   · the server judges it (api lib/move-in-gate): another country is refused WHOLE (422 MOVE_IN_*) — painted here as one line in our words
 *     with the server's sentence under it; Import stays greyed with that line
 *   · held rows (action hold · code tax_code | unit | bill_key) are counted and listed as "Held", with the server's sentence; nothing of them is written
 */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    booksMoveInPreflight: { m: 'POST', p: '/api/books/move-in/preflight', ok: 'y' } /* owner: the file read, the columns guessed — nothing written */,
    booksMoveInPreview: { m: 'POST', p: '/api/books/move-in/preview', ok: 'y' } /* owner: the dry run — nothing written */,
    booksMoveInImport: { m: 'POST', p: '/api/books/move-in/import', ok: 'y' } /* owner: ONE transaction; { confirm: true } */
  });
}

var MIV = { st: null, f: null, pre: null, dec: {}, plan: null, out: null, err: '', busy: false, gen: 0 };
var MI_SOURCES = [
  ['xero', 'Xero'],
  ['qbo', 'QuickBooks Online']
];
var MI_KINDS = [
  ['accounts', 'Chart of accounts'],
  ['contacts', 'Contacts'],
  ['items', 'Items'],
  ['trial_balance', 'Trial balance'],
  ['open_bills', 'Open invoices or bills']
];
var MI_ACTION = { add: 'Will add', merge: 'Will merge', skip: 'Will skip', hold: 'Held' };
var MI_TONE = { add: 'green', merge: 'blue', skip: '', hold: 'amber' };
/* the country refusals (api lib/move-in-gate codes) in our words — the server's own sentence is shown under the line.
   ⚠️ MOVE_IN_COUNTRY has NO words here: the server sends it for three reasons (no pack · "not ready for <country> yet" · another country),
   so only the server can say which — the line is "Not moved in." and the server's sentence says why (show-action rule). */
var MI_REFUSED = {
  MOVE_IN_COUNTRY_UNSTATED: 'Pick the country these books are from.',
  MOVE_IN_COUNTRY_WORD: 'Pick the country these books are from.',
  MOVE_IN_FOREIGN: "Not moved in: this file has another country's tax codes.",
  MOVE_IN_COMPANY: 'Not moved in: this shop already took books from another company.'
};

function miFresh() {
  MIV.f = { source: 'xero', kind: 'accounts', side: 'customer', as_at: '', name: '', csv: null, xlsx: null, country: miShopCountry() };
  MIV.pre = null;
  MIV.dec = {};
  MIV.plan = null;
  MIV.out = null;
  MIV.err = '';
  MIV.refused = null;
}
/** the shop's own country (two letters): the session's, else the books' own (GET /health country, miKnowShop), or '' while unknown */
function miShopCountry() {
  return String((typeof SESSION !== 'undefined' && SESSION && SESSION.country) || MIV.shop || '').toUpperCase();
}
/* the books' country, read once when the session does not carry it; unknown, the picker says "Pick the country" and File stays greyed */
function miKnowShop() {
  if (miShopCountry() || MIV.asked) return;
  MIV.asked = true;
  api('booksHealth').then(
    function (health) {
      var code = health && health.country && health.country.country && health.country.country.code;
      if (!code) return;
      MIV.shop = String(code).toUpperCase();
      if (MIV.f && !MIV.f.country) MIV.f.country = MIV.shop;
      miRefresh();
    },
    function (failure) {
      MIV.asked = false;
      if (typeof cblog === 'function') cblog('warn', 'move-in: the shop country was not read — ' + ((failure && failure.message) || 'no answer'));
    }
  );
}
/** the countries a file may be stated from: the registered packs only, by name ([code, name]) */
function miCountries() {
  var packs = [];
  try {
    packs = window.CBRegulation ? CBRegulation.list() : [];
  } catch (failure) {
    if (typeof cblog === 'function')
      cblog('warn', 'move-in: the country packs could not be listed, so the picker offers none — ' + ((failure && failure.message) || 'no answer'));
  }
  return packs.map(function (pack) {
    return [pack.id, String(pack.name || pack.id).split(' · ')[0]];
  });
}
function miCountryName(code) {
  var found = miCountries().filter(function (pair) {
    return pair[0] === code;
  })[0];
  return found ? found[1] : code;
}
/** a connection opens the screen: its company's own country and id are sent, and no country is asked (the practice door, CA1) */
function miConnect(company) {
  if (!MIV.f) miFresh();
  MIV.conn = company && company.country ? { country: String(company.country).toUpperCase(), id: company.id || null } : null;
}
function miNeedsSide(kind) {
  return kind === 'contacts' || kind === 'open_bills';
}
function miNeedsDate(kind) {
  return kind === 'trial_balance' || kind === 'open_bills';
}
/** the body every move-in call carries: the file, which export, which system, the side, the move date */
function miBody() {
  var form = MIV.f,
    body = { kind: form.kind, source: form.source };
  if (form.xlsx) body.xlsx = form.xlsx;
  else body.csv = form.csv || '';
  if (miNeedsSide(form.kind)) body.side = form.kind === 'contacts' ? form.side : form.side === 'supplier' ? 'payable' : 'receivable';
  if (miNeedsDate(form.kind) && form.as_at) body.as_at = form.as_at;
  body.source_country = MIV.conn ? MIV.conn.country : form.country;
  if (MIV.conn && MIV.conn.id) body.source_company = MIV.conn.id;
  return body;
}
/* the country row: a connection says its company's country; a file asks, set to the shop's own, with the reason in one line */
function miCountryRow() {
  if (MIV.conn) return miRow(tx('Books from'), '<span data-testid="mi-country-read">' + esc(miCountryName(MIV.conn.country)) + '</span>');
  var shop = miShopCountry(),
    opts = (MIV.f.country ? [] : [['', 'Pick the country']]).concat(miCountries());
  return miRow(
    tx('Books from'),
    miSel('mi-country', 'country', opts, MIV.f.country) +
      '<div data-testid="mi-country-why" style="color:var(--grey);font-size:var(--fs-1);margin-top:4px">' +
      esc(shop ? txf('Only books from {c} — tax rules differ by country.', { c: miCountryName(shop) }) : tx('Tax rules differ by country.')) +
      '</div>',
    'mi-country'
  );
}
function miDecisions() {
  return Object.keys(MIV.dec)
    .filter(function (item) {
      return MIV.dec[item];
    })
    .map(function (item) {
      return { incoming: item, field: MIV.dec[item] };
    });
}

/* ── the view (BK.views.movein) ── */
function miView(body) {
  if (!MIV.f) miFresh();
  miKnowShop();
  body.innerHTML =
    '<div data-testid="mi-steps"><div id="mi_rail"></div><div id="mi_sub" style="color:var(--grey);font-size:var(--fs-1);margin-bottom:8px"></div>' +
    '<div id="mi_body"></div><div id="mi_foot" style="margin-top:12px"></div></div>';
  if (MIV.st) MIV.st.destroy();
  MIV.st = CBSteps.create({
    steps: [
      { k: 'file', n: tx('File'), t: tx('Export from Xero or QuickBooks, then pick the file') },
      { k: 'columns', n: tx('Columns'), t: tx('Check which column is which') },
      { k: 'preview', n: tx('Preview'), t: tx('What will happen, row by row') }
    ],
    railEl: 'mi_rail',
    bodyEl: 'mi_body',
    footEl: 'mi_foot',
    subEl: 'mi_sub',
    render: miRender,
    guard: miGuard,
    onStep: miOnStep,
    onSend: miImport,
    sendLabel: tx('Import'),
    nextLabel: function (stepKey) {
      return stepKey === 'file' ? tx('Read the file') + ' →' : stepKey === 'columns' ? tx('Preview') + ' →' : null;
    },
    sendTestid: 'mi-import',
    nextTestid: 'mi-next',
    backTestid: 'mi-back'
  });
  MIV.st.paint();
}
function miSel(id, field, opts, selected) {
  return (
    '<select data-cbsid="BKS024-S01" class="inp" id="' +
    id +
    '" data-testid="' +
    id +
    '" onchange="miSet(\'' +
    field +
    '\', this.value)">' +
    opts
      .map(function (item) {
        return '<option value="' + esc(item[0]) + '"' + (item[0] === selected ? ' selected' : '') + '>' + esc(tx(item[1])) + '</option>';
      })
      .join('') +
    '</select>'
  );
}
/* one labelled row (forId = the control's id: the visible label then names it for a screen reader, WCAG 4.1.2); min-width:0 on the cell so a native file input or a long name never pushes the page sideways at 390 px */
function miRow(label, html, forId) {
  return (
    '<div style="display:grid;grid-template-columns:minmax(80px,150px) minmax(0,1fr);gap:8px;align-items:center;margin:6px 0"><' +
    (forId ? 'label for="' + forId + '"' : 'span') +
    ' style="color:var(--grey);font-size:var(--fs-1)">' +
    esc(label) +
    (forId ? '</label>' : '</span>') +
    '<span style="min-width:0;overflow:hidden">' +
    html +
    '</span></div>'
  );
}
/** step 1: the file, which export, which system, which country, the side and move date (what/why: every choice the server needs before it can read the file) */
function miFileStepHTML(form) {
  var sides =
    form.kind === 'contacts'
      ? [
          ['customer', 'Customers'],
          ['supplier', 'Suppliers']
        ]
      : [
          ['customer', 'Invoices (customers owe you)'],
          ['supplier', 'Bills (you owe suppliers)']
        ];
  return (
    '<div data-testid="mi-file-step" style="max-width:640px">' +
    miRow(tx('From'), miSel('mi-source', 'source', MI_SOURCES, form.source), 'mi-source') +
    miCountryRow() +
    miRow(tx('Which export'), miSel('mi-kind', 'kind', MI_KINDS, form.kind), 'mi-kind') +
    (miNeedsSide(form.kind) ? miRow(tx('Which list'), miSel('mi-side', 'side', sides, form.side), 'mi-side') : '') +
    (miNeedsDate(form.kind)
      ? miRow(
          tx('As at'),
          '<input data-cbsid="BKS024-I01" class="inp" type="date" id="mi-asat" data-testid="mi-asat" value="' +
            esc(form.as_at) +
            '" onchange="miSet(\'as_at\', this.value)" style="width:auto">',
          'mi-asat'
        )
      : '') +
    miRow(
      tx('File'),
      '<input data-cbsid="BKS024-I02" type="file" id="mi-file" data-testid="mi-file" accept=".csv,.xlsx,text/csv" onchange="miFile(this)" style="max-width:100%;min-width:0;font-size:var(--fs-1)">' +
        (form.name ? '<div data-testid="mi-file-name" style="font-size:var(--fs-1);margin-top:4px">' + esc(form.name) + '</div>' : ''),
      'mi-file'
    ) +
    '<div style="color:var(--grey);font-size:var(--fs-1);margin-top:8px">' +
    esc(tx('Order: chart, contacts, items, then balances.')) +
    '</div>' +
    (MIV.err ? '<div class="err" data-testid="mi-err" style="color:var(--warn-2);margin-top:8px">' + esc(MIV.err) + '</div>' : '') +
    '</div>'
  );
}
/** one big figure with its caption under it (the preview counts and the result counts share it) */
function miBigNumber(count, caption, testId) {
  return (
    '<div style="min-width:110px"><div class="mono" data-testid="' +
    testId +
    '" style="font-size:var(--fs-5,28px);font-weight:800;line-height:1.1">' +
    esc(String(count || 0)) +
    '</div><div style="color:var(--grey);font-size:var(--fs-1)">' +
    esc(caption) +
    '</div></div>'
  );
}
/** step 2 — the columns of the file, each with the field the server guessed, to confirm or change */
function miColumnsStepHTML() {
  if (!MIV.pre)
    return '<div data-testid="mi-loading" style="color:var(--grey)">' + esc(MIV.busy ? tx('Reading…') : MIV.err || tx('Read the file first')) + '</div>';
  var preflight = MIV.pre,
    fields = preflight.fields || [];
  var opts = [['', tx('not read')]].concat(
    fields.map(function (x) {
      return [x.key, x.label + (x.required ? ' *' : '')];
    })
  );
  var rows = (preflight.guess || [])
    .map(function (item) {
      var chosen = MIV.dec[item.incoming] || '';
      return (
        '<tr data-testid="mi-col-' +
        esc(item.incoming) +
        '"><td style="padding:4px 8px 4px 0;word-break:break-word"><b>' +
        esc(item.incoming) +
        '</b></td>' +
        '<td style="padding:4px 8px 4px 0"><select data-cbsid="BKS024-S02" class="inp" style="width:100%;max-width:100%" data-testid="mi-pick-' +
        esc(item.incoming) +
        '" onchange="miPick(' +
        JSON.stringify(item.incoming).replace(/"/g, '&quot;') +
        ', this.value)">' +
        opts
          .map(function (entry) {
            return '<option value="' + esc(entry[0]) + '"' + (entry[0] === chosen ? ' selected' : '') + '>' + esc(entry[1]) + '</option>';
          })
          .join('') +
        '</select></td>' +
        '<td style="padding:4px 0;color:var(--grey);font-size:var(--fs-1);word-break:break-word">' +
        esc(item.how === 'known' || item.how === 'exact' ? '' : (item.field ? tx('A guess — check it') + ' · ' : '') + (item.why || '')) +
        '</td></tr>'
      );
    })
    .join('');
  return (
    '<div data-testid="mi-columns-step">' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:6px" data-testid="mi-rows-total">' +
    esc(txf('{n} rows in {f}', { n: preflight.rows_total, f: MIV.f.name })) +
    '</div>' +
    '<table style="border-collapse:collapse;width:100%;max-width:820px;table-layout:fixed"><thead><tr style="text-align:left;color:var(--grey);font-size:var(--fs-1)"><th>' +
    esc(tx('In the file')) +
    '</th><th>' +
    esc(tx('Read as')) +
    '</th><th></th></tr></thead><tbody>' +
    rows +
    '</tbody></table>' +
    '</div>'
  );
}
/** step 3 — what the import will do, counted: add · merge · skip · held, with the server's notes and the row list slot */
function miPreviewStepHTML() {
  if (MIV.refused) return miRefusedHTML();
  if (!MIV.plan)
    return '<div data-testid="mi-loading" style="color:var(--grey)">' + esc(MIV.busy ? tx('Checking…') : MIV.err || tx('Preview first')) + '</div>';
  var plan = MIV.plan,
    counts = plan.counts || {};
  return (
    '<div data-testid="mi-preview-step">' +
    '<div style="display:flex;gap:22px;flex-wrap:wrap;margin:4px 0 10px">' +
    miBigNumber(counts.add, tx('will add'), 'mi-n-add') +
    miBigNumber(counts.merge, tx('will merge'), 'mi-n-merge') +
    miBigNumber(counts.skip, tx('will skip'), 'mi-n-skip') +
    (counts.hold ? miBigNumber(counts.hold, tx('held'), 'mi-n-hold') : '') +
    '</div>' +
    (plan.refusal ? '<div data-testid="mi-refusal" style="color:var(--warn-2);font-weight:600;margin-bottom:8px">' + esc(plan.refusal) + '</div>' : '') +
    (plan.notes || [])
      .map(function (item) {
        return '<div data-testid="mi-note" style="color:var(--grey);font-size:var(--fs-1);margin-bottom:6px">' + esc(item) + '</div>';
      })
      .join('') +
    '<div id="mi_rows" data-testid="mi-rows" style="min-height:240px"></div>' +
    '</div>'
  );
}
/** the body of the step the wizard is on */
function miRender(stepKey) {
  var form = MIV.f;
  if (MIV.out) return miDoneHTML();
  if (stepKey === 'file') return miFileStepHTML(form);
  if (stepKey === 'columns') return miColumnsStepHTML();
  if (stepKey === 'preview') return miPreviewStepHTML();
  return '';
}
/** why Read the file is greyed, or null: no file, no country (a connection states its own) or no move date */
function miFileGuard(form) {
  if (!form.csv && !form.xlsx) return tx('Pick the file first');
  if (!MIV.conn && !form.country) return tx('Pick the country these books are from');
  if (miNeedsDate(form.kind) && !form.as_at) return tx('Pick the move date');
  return null;
}
function miGuard(stepKey) {
  if (MIV.out) return null;
  if (stepKey === 'file') return miFileGuard(MIV.f);
  if (stepKey === 'columns') {
    if (!MIV.pre) return MIV.err || tx('Read the file first');
    var picked = miDecisions().map(function (item) {
      return item.field;
    });
    var miss = (MIV.pre.fields || []).filter(function (x) {
      return x.required && picked.indexOf(x.key) < 0;
    });
    return miss.length
      ? txf('Pick the column for {f}', {
          f: miss
            .map(function (x) {
              return x.label;
            })
            .join(', ')
        })
      : null;
  }
  if (stepKey === 'preview') {
    if (MIV.refused) return miRefusedWhy(MIV.refused);
    if (!MIV.plan) return MIV.err || tx('Preview first');
    if (MIV.plan.refusal) return MIV.plan.refusal;
    var counts = MIV.plan.counts || {};
    if (!(Number(counts.add) + Number(counts.merge))) return tx('Nothing to import — every row is skipped');
    return null;
  }
  return null;
}
/* the one reader of the file: text for a .csv, base64 for an .xlsx — nothing leaves the browser until a step asks the server */
function miFile(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  var form = MIV.f;
  form.name = file.name;
  form.csv = null;
  form.xlsx = null;
  MIV.pre = null;
  MIV.dec = {};
  MIV.plan = null;
  MIV.err = '';
  var reader = new FileReader();
  if (/\.xlsx$/i.test(file.name)) {
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result),
        binary = '';
      for (var index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
      form.xlsx = btoa(binary);
      miRefresh();
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = function () {
      form.csv = String(reader.result || '');
      miRefresh();
    };
    reader.readAsText(file);
  }
}
function miRefresh() {
  if (MIV.st) {
    MIV.st.paintBody();
    MIV.st.paintFoot();
  }
}
function miSet(field, value) {
  MIV.f[field] = String(value || '');
  if (field !== 'as_at') {
    MIV.pre = null;
    MIV.dec = {};
    MIV.plan = null;
  }
  MIV.err = '';
  MIV.refused = null;
  miRefresh();
}
function miPick(header, value) {
  MIV.dec[header] = value || '';
  MIV.plan = null;
  if (MIV.st) MIV.st.paintFoot();
}
/* entering a step reads what it needs — once per file (a changed file or column empties the answer) */
function miOnStep(stepKey) {
  if (stepKey === 'columns' && !MIV.pre)
    miRead('booksMoveInPreflight', miBody(), function (preflight) {
      MIV.pre = preflight;
      MIV.dec = {};
      (preflight.guess || []).forEach(function (item) {
        if (item.field) MIV.dec[item.incoming] = item.field;
      });
    });
  if (stepKey === 'preview' && !MIV.plan)
    miRead('booksMoveInPreview', Object.assign(miBody(), { decisions: miDecisions() }), function (plan) {
      MIV.plan = plan;
      miPaintRows();
    });
}
function miRead(endpoint, body, then) {
  var generation = ++MIV.gen;
  MIV.busy = true;
  MIV.err = '';
  miRefresh();
  api(endpoint, { body: body }).then(
    function (reply) {
      if (generation !== MIV.gen) return;
      MIV.busy = false;
      then(reply || {});
      miRefresh();
      if (endpoint === 'booksMoveInPreview') miPaintRows();
    },
    function (e) {
      if (generation !== MIV.gen) return;
      MIV.busy = false;
      MIV.refused = miRefusal(e);
      MIV.err = MIV.refused ? '' : bkWhy(e, tx('Could not read the file'));
      miRefresh();
    }
  );
}
/** a country refusal from the server (422 MOVE_IN_*) → { code, why } — anything else is an ordinary error (null) */
function miRefusal(e) {
  var data = (e && e.data) || {},
    code = String(data.code || '');
  return /^MOVE_IN_(COUNTRY|FOREIGN|COMPANY)/.test(code) ? { code: code, why: data.message || (e && e.message) || '' } : null;
}
/** the refusal's headline: our words for a code that has one reason, else "Not moved in." (the server's sentence goes under it) */
function miRefusedLine(refusal) {
  return tx(MI_REFUSED[refusal.code] || 'Not moved in.');
}
/** why Import is greyed: our words when the code has one reason, else the server's own sentence */
function miRefusedWhy(refusal) {
  return MI_REFUSED[refusal.code] ? tx(MI_REFUSED[refusal.code]) : refusal.why || tx('Not moved in.');
}
/* the refusal painted: our line, the server's sentence under it, and the way back (Back to File, where the country is picked) */
function miRefusedHTML() {
  var refusal = MIV.refused;
  return (
    '<div data-testid="mi-refused" data-code="' +
    esc(refusal.code) +
    '" style="max-width:640px">' +
    '<div style="color:var(--warn-2);font-weight:700;margin-bottom:6px">' +
    esc(miRefusedLine(refusal)) +
    '</div>' +
    (refusal.why ? '<div data-testid="mi-refused-why" style="color:var(--grey);font-size:var(--fs-1)">' + esc(refusal.why) + '</div>' : '') +
    '</div>'
  );
}
/** the preview list's columns: line · what · action chip · why */
function miRowColumns() {
  return [
    {
      key: 'line',
      label: tx('Line'),
      prio: 4,
      sort: 'line',
      num: true,
      w: 80,
      cell: function (row) {
        return String(row.line);
      }
    },
    {
      key: 'what',
      label: tx('What'),
      prio: 1,
      sort: 'what',
      w: 260,
      cell: function (row) {
        return row.what || '';
      }
    },
    {
      key: 'action',
      label: tx('Action'),
      prio: 2,
      sort: 'action',
      w: 130,
      html: true,
      hfilter: 'action',
      cell: function (row) {
        return (
          '<span class="step ' +
          (MI_TONE[row.action] || '') +
          '" data-testid="mi-act-' +
          esc(row.line) +
          '" data-action="' +
          esc(row.action) +
          '">' +
          esc(tx(MI_ACTION[row.action] || row.action)) +
          '</span>'
        );
      }
    },
    {
      key: 'why',
      label: tx('Why'),
      prio: 3,
      sort: 'why',
      w: 420,
      cell: function (row) {
        return row.why || '';
      }
    }
  ];
}
/** the preview list's one filter: by what the import will do with the row */
function miRowFilters() {
  return [
    {
      key: 'action',
      label: tx('Action'),
      all: tx('Every row'),
      options: [
        { v: 'add', label: tx('Will add') },
        { v: 'merge', label: tx('Will merge') },
        { v: 'skip', label: tx('Will skip') },
        { v: 'hold', label: tx('Held') }
      ],
      match: function (row, value) {
        return row.action === value;
      }
    }
  ];
}
/** the preview list's two orders: file order and by action */
function miRowSorts() {
  return [
    {
      key: 'line',
      label: tx('File order'),
      cmp: function (left, right) {
        return left.line - right.line;
      }
    },
    {
      key: 'action',
      label: tx('Action'),
      cmp: function (left, right) {
        return String(left.action).localeCompare(String(right.action));
      }
    }
  ];
}
/* the preview rows: CBList — line · what · will add / merge / skip · why (the server's sentence) */
function miPaintRows() {
  var el = document.getElementById('mi_rows');
  if (!el || !MIV.plan) return;
  var rows = MIV.plan.rows || [];
  CBList.reset('movein');
  CBList.mount(el, {
    key: 'movein',
    t: tx,
    rows: function () {
      return rows;
    },
    id: function (row) {
      return row.line;
    },
    rowTid: function (row) {
      return 'mi-row-' + row.line;
    },
    columns: miRowColumns(),
    filters: miRowFilters(),
    sorts: miRowSorts(),
    search: function (row) {
      return [row.what, row.why, row.action].join(' ');
    },
    empty: { title: tx('No rows in the file') }
  });
}
/* ⭐ the one write (M64): one press, one call; the outcome is painted where the preview was */
function miImport() {
  var btn = document.querySelector('[data-testid="mi-import"]');
  if (!btn || MIV.out) return;
  CBAction.run(
    btn,
    function () {
      return api('booksMoveInImport', { body: Object.assign(miBody(), { decisions: miDecisions(), confirm: true }) });
    },
    {
      key: 'mi-import',
      busy: tx('Importing…'),
      outcome: function (row) {
        MIV.out = row || {};
        toast(tx('Moved in.'));
        MIV.st.paint();
        miPaintSkipped();
      },
      onFail: function (words) {
        MIV.err = words;
        MIV.st.paintBody();
      }
    }
  );
}
function miDoneHTML() {
  var done = MIV.out;
  var booked = done.entry || null,
    currency = bkCur(),
    words = '';
  if (booked && booked.entry_no)
    words =
      txf('Entered as {no}.', { no: booked.entry_no }) +
      (booked.suspense_minor ? ' ' + txf('{amt} held in Suspense until the rest arrives.', { amt: bkDrCr(booked.suspense_minor, currency) }) : '');
  return (
    '<div data-testid="mi-done">' +
    '<div style="display:flex;gap:22px;flex-wrap:wrap;margin:4px 0 10px">' +
    miBigNumber(done.added, tx('added'), 'mi-done-add') +
    miBigNumber(done.merged, tx('merged'), 'mi-done-merge') +
    miBigNumber(done.skipped, tx('skipped'), 'mi-done-skip') +
    (done.held ? miBigNumber(done.held, tx('held'), 'mi-done-hold') : '') +
    '</div>' +
    (words ? '<div data-testid="mi-entry" style="margin-bottom:6px">' + esc(words) + '</div>' : '') +
    (done.notes || [])
      .map(function (item) {
        return '<div data-testid="mi-note" style="color:var(--grey);font-size:var(--fs-1);margin-bottom:6px">' + esc(item) + '</div>';
      })
      .join('') +
    '<div class="supacts" style="margin:8px 0">' +
    ((done.rows || []).length
      ? '<button data-cbsid="BKS024-B01" type="button" data-testid="mi-download" onclick="miDownload()">' + esc(tx('Download rows not moved in')) + '</button>'
      : '') +
    '<button data-cbsid="BKS024-B02" type="button" data-testid="mi-again" onclick="miAgain()">' +
    esc(tx('Another file')) +
    '</button></div>' +
    '<div id="mi_skipped" data-testid="mi-skipped" style="min-height:160px"></div>' +
    '</div>'
  );
}
/** the skipped-rows list's columns: line · what · held or skipped chip · why */
function miSkippedColumns() {
  return [
    {
      key: 'line',
      label: tx('Line'),
      prio: 3,
      sort: 'line',
      num: true,
      w: 80,
      cell: function (row) {
        return String(row.line);
      }
    },
    {
      key: 'what',
      label: tx('What'),
      prio: 1,
      sort: 'what',
      w: 260,
      cell: function (row) {
        return row.what || '';
      }
    },
    {
      key: 'state',
      label: tx('Action'),
      prio: 2,
      w: 110,
      html: true,
      cell: function (row) {
        var held = !!row.code;
        return (
          '<span class="step ' + (held ? 'amber' : '') + '" data-testid="mi-state-' + esc(row.line) + '">' + esc(tx(held ? 'Held' : 'Skipped')) + '</span>'
        );
      }
    },
    {
      key: 'why',
      label: tx('Why'),
      prio: 3,
      sort: 'why',
      w: 420,
      cell: function (row) {
        return row.why || '';
      }
    }
  ];
}
function miPaintSkipped() {
  var el = document.getElementById('mi_skipped');
  if (!el || !MIV.out) return;
  var rows = MIV.out.rows || [];
  if (!rows.length) {
    el.innerHTML = '<div style="color:var(--grey);font-size:var(--fs-1)">' + esc(tx('Nothing was skipped')) + '</div>';
    return;
  }
  CBList.reset('movein-skipped');
  CBList.mount(el, {
    key: 'movein-skipped',
    t: tx,
    rows: function () {
      return rows;
    },
    id: function (row) {
      return row.line;
    },
    rowTid: function (row) {
      return 'mi-skip-' + row.line;
    },
    columns: miSkippedColumns(),
    sorts: [
      {
        key: 'line',
        label: tx('File order'),
        cmp: function (left, right) {
          return left.line - right.line;
        }
      }
    ],
    search: function (row) {
      return [row.what, row.why].join(' ');
    },
    empty: { title: tx('Nothing was skipped') }
  });
}
/* the skipped rows as a .csv (line · what · why) — the same three columns the server's skippedCsv writes */
function miDownload() {
  var rows = (MIV.out && MIV.out.rows) || [],
    quoted = function (value) {
      return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
    };
  var text =
    ['line,what,why']
      .concat(
        rows.map(function (item) {
          return [item.line, item.what, item.why].map(quoted).join(',');
        })
      )
      .join('\n') + '\n';
  var node = document.createElement('a');
  node.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  node.download = 'skipped-' + (MIV.f.kind || 'rows') + '.csv';
  document.body.appendChild(node);
  node.click();
  setTimeout(function () {
    try {
      URL.revokeObjectURL(node.href);
      node.remove();
    } catch (failure) {
      // the file was already saved; only the temporary link stays, so say so and move on
      if (typeof cblog === 'function') cblog('warn', 'move-in: the skipped-rows download link was not cleaned up — ' + ((failure && failure.message) || 'no answer'));
    }
  }, 500);
}
function miAgain() {
  miFresh();
  if (MIV.st) {
    MIV.st.reset();
    MIV.st.paint();
  }
}
