/* cap-period.js — MONTH & YEAR END on CB Accounts: Closing stock · Assets & depreciation · Accruals & recurring · GST close & pay · Year close.
 * OWNS      the five Month & year end views of CB Accounts: Closing stock (peStockView) · Assets & depreciation (peAssetsView) · Accruals & recurring (peAccrualsView) · GST close & pay
 *           (peGstView · peReturnWord) · Year close (peYearView), and the small form helpers cap-bank.js reuses (peBad · peVal · peField · peSel · peAmt · peBtn · peOwner)
 * CALLED BY public/accounts.html (script tag; BK.views closingstock · assets · accruals · gstclose · yearclose, and the PE_RET.word it reads for the return's name) · public/app/cap-bank.js (peBad · peVal · peField · peSel · peAmt · peBtn · peOwner).
 *           Not loaded by app.html (no ensureCap name)
 * FLOW      a tab opens → the period's read (GET /api/books/… · /returns) → paint → an action (close · pay · year close) → the server's answer painted in its slot
 * CARD      14-accounting/periods-month-lock-year-close
 * Contract: docs/design/cb-accounts-ia/REQUIREMENT.md ("Month & year end"); the server's shapes: chitbridge-api routes/books.js (the period-end routes),
 * lib/books-period.js, lib/books-recurring.js and GET /year/:fy/status. Loaded by accounts.html after cap-books.js, which owns the helpers used here
 * (bkMoney · bkToMinor · bkOnce · bkRef · bkWhy · bkPeriodsLoad · bkIsOwner · CBList mounting).
 *
 * ⭐ THE PAGE COMPUTES NO MONEY. Every figure on these pages is read from the API's answer (set-off, payable, basis, entry number, WDV);
 *   a typed amount is parsed to minor units (bkToMinor) and sent. Nothing is added up here.
 * ⭐ EVERY ENTRY IS POSTED THROUGH THE API, which numbers it (MJ / JV) — this file shows the number it was given and never makes one.
 * ⭐ ONE TAP, ONE RECORD: each form carries ONE client_ref from the moment it opens (PE.ref), the button is dead while its call is out (bkOnce),
 *   and the ref is replaced only after the server said yes — so a second tap answers the first entry (duplicate) instead of posting twice.
 * ⭐ OWNER-ONLY ACTIONS ARE NOT DRAWN for anyone else (the server enforces it; this only decides who is offered the button).
 * ⭐ A REFUSAL IS A PLAIN SENTENCE WITH ITS FIX: the server's words, and the one button that goes where the fix is (Month lock for a locked month).
 *   A 503 (the table is not migrated yet) is one calm line — "Starts after an update" — never a raw message.
 * Never the word "accounting" on a screen.
 */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    perStock: { m: 'POST', p: '/api/books/closing-stock' },
    perAssets: { m: 'GET', p: '/api/books/assets' },
    perAssetAdd: { m: 'POST', p: '/api/books/assets' },
    perAssetSell: { m: 'POST', p: '/api/books/assets/:id/dispose' },
    perDepRun: { m: 'POST', p: '/api/books/depreciation/run' },
    perRecList: { m: 'GET', p: '/api/books/recurring' },
    perRecAdd: { m: 'POST', p: '/api/books/recurring' },
    perRecPatch: { m: 'PATCH', p: '/api/books/recurring/:id' },
    perRecStop: { m: 'DELETE', p: '/api/books/recurring/:id' },
    perRecPost: { m: 'POST', p: '/api/books/recurring/:id/post' },
    perRecSkip: { m: 'POST', p: '/api/books/recurring/:id/skip' },
    perAccrue: { m: 'POST', p: '/api/books/accruals' },
    perAccrueRev: { m: 'POST', p: '/api/books/accruals/:ref/reverse' },
    perGstClose: { m: 'POST', p: '/api/books/gst/close' },
    perGstPay: { m: 'POST', p: '/api/books/gst/pay', idem: 'attempt' },
    perReturn: { m: 'GET', p: '/api/books/returns' } /* BAS1: the shop's OWN return (AU BAS · AE VAT201), read from the posted books */,
    perYearStatus: { m: 'GET', p: '/api/books/year/:fy/status' },
    perYearClose: { m: 'POST', p: '/api/books/year/:fy/close' }
  });
}

var PE = { ref: {}, accr: [], rec: [], tab: 'rec' };
const peEl = (id) => document.getElementById(id);
const peVal = (id) => {
  const e = peEl(id);
  return e ? String(e.value || '').trim() : '';
};
const peOwner = () => typeof bkIsOwner === 'function' && bkIsOwner();
const peRef = (k) => PE.ref[k] || (PE.ref[k] = bkRef());
const peYmd = (date) => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
/** the last day of the month `back` months ago (1 = last month) — a date for a field's default, not money */
function peMonthEnd(back) {
  const date = new Date();
  return peYmd(new Date(date.getFullYear(), date.getMonth() - back + 1, 0));
}
/** ⭐ WX-R2R: the year a close or a depreciation run is for — last year when the books hold it, else the books' FIRST year (the server's
   GET /periods years). Never a year before the books began: the Year close used to open on it and paint twelve "not locked" crosses. */
function peLastYear(years) {
  const prev = bkFyPrev(bkFyNow());
  return years.indexOf(prev) >= 0 ? prev : years.slice().sort()[0] || prev;
}
function peDaysAgo(n) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return peYmd(date);
}
function peList(r, k) {
  return Array.isArray(r) ? r : (r && r[k]) || [];
}

/* ── words: the server's sentence, its one fix button, and the calm line for "not migrated yet" ── */
function peFix(msg, code) {
  if (code === 'PERIOD_RETURN_OPEN') return { label: txf('Open {name}', { name: peReturnName() }), tab: 'gstclose' }; /* ACC-204: the year close waits for every BAS period — branch on the code, never the prose */
  if (/locked|closed for good/i.test(msg)) return { label: tx('Open Month lock'), tab: 'lock' };
  return null;
}
function peWhy(e, fallback) {
  if (e && e.status === 503) return { text: tx('Starts after an update'), calm: true, fix: null };
  const text = bkWhy(e, fallback || tx('Could not be saved'));
  return { text, calm: false, fix: peFix(text, e && e.data && e.data.code) }; /* the answer's own body rides on e.data (core.js _fail) */
}
function peBad(id, e, fallback) {
  const el = peEl(id);
  if (!el) return;
  const w = typeof e === 'string' ? { text: e, calm: false, fix: null } : peWhy(e, fallback);
  el.innerHTML =
    '<div class="pe-' +
    (w.calm ? 'calm' : 'bad') +
    '" data-testid="pe-refused" role="alert"><span>' +
    (w.calm ? '⏳ ' : '⚠ ') +
    esc(w.text) +
    '</span>' +
    (w.fix ? '<button data-cbsid="BKS016-B01" type="button" class="pe-fix" data-testid="pe-fix" onclick="show(\'' + w.fix.tab + '\')">' + esc(w.fix.label) + '</button>' : '') +
    '</div>';
}
function peOk(id, html) {
  const el = peEl(id);
  if (el) el.innerHTML = '<div class="pe-ok" data-testid="pe-ok" role="status">✓ ' + html + '</div>';
}
function peNote(tid, text) {
  return '<div class="pe-note" data-testid="' + tid + '">' + esc(tx(text)) + '</div>';
}
const peNoOwner = (what) => peNote('pe-readonly', what);
const peField = (id, label, inner) => '<label class="pe-f"><span>' + esc(tx(label)) + '</span>' + inner + '</label>';
const peInput = (id, val, ph, type, extra) =>
  '<input data-cbsid="BKS016-I01" class="inp" id="' +
  id +
  '" data-testid="' +
  id +
  '"' +
  (type ? ' type="' + type + '"' : ' inputmode="text"') +
  (ph ? ' placeholder="' + esc(ph) + '"' : '') +
  ' value="' +
  esc(val || '') +
  '"' +
  (extra || '') +
  '>';
const peAmt = (id, val, ph) => bkMoneyInput({ id: id, text: val || '', ph: ph == null ? undefined : ph }); /* the one money input (cap-books bkMoneyInput) */
const peSel = (id, opts, cur, extra) =>
  '<select data-cbsid="BKS016-S01" class="inp" id="' +
  id +
  '" data-testid="' +
  id +
  '"' +
  (extra || '') +
  '>' +
  opts
    .map((item) => '<option value="' + esc(item[0]) + '"' + (String(item[0]) === String(cur) ? ' selected' : '') + '>' + esc(tx(item[1])) + '</option>')
    .join('') +
  '</select>';
const peMODES = [
  ['cash', 'Cash'],
  ['bank', 'Bank'],
  ['upi', 'UPI'],
  ['card', 'Card']
];
const peBtn = (tid, label, fn, cls) =>
  '<button data-cbsid="BKS016-B02" type="button" class="' + (cls || 'supact-pri') + '" data-testid="' + tid + '" onclick="' + fn + '">' + esc(tx(label)) + '</button>';
/** a minor amount as the text of an amount field (the field is parsed back with bkToMinor — the same digits) */
function peText(minor) {
  return bkMinorText(minor);
}
const peMoney = (minor, c) =>
  bkMoney(minor, c); /* c: the answer's currency (BAS1: an AU return is in AUD, an AE one in AED) — the India pages pass none, as before */
const peHeads = ['cgst', 'sgst', 'igst', 'cess'];

/* ═══ 1 · CLOSING STOCK ═════════════════════════════════════════════════════════════════════════════════════════════════
   POST /closing-stock { date, value_minor, nrv_minor?, method: 'manual', client_ref } — only the DIFFERENCE from the books posts (the engine reads `book`).
   The last counts are the stock ledger's own lines (GET /ledger/stock): date · entry · what it changed · stock after. */
async function peStockView(body) {
  const own = peOwner();
  body.innerHTML =
    (own
      ? '<div class="pe-card" data-testid="ps-form"><div class="pe-form">' +
        peField('ps_date', 'Month end', peInput('ps_date', peMonthEnd(1), '', 'date')) +
        peField('ps_val', 'Stock on hand, at cost', peAmt('ps_val')) +
        peField('ps_nrv', 'Worth less now? (only if lower)', peAmt('ps_nrv', '', tx('Leave empty if not'))) +
        '</div><div class="supacts">' +
        peBtn('ps-save', 'Save closing stock', 'peStockSave(this)') +
        '</div><div id="ps_out" class="pe-slot"></div></div>'
      : peNoOwner('Only the owner enters the closing stock')) + '<div id="bkl_stock" data-testid="stock-list"></div>';
  await peStockList();
}
/* the counts the list shows - one array, so a count just saved is added here and painted at once (M173) */
var PE_STOCK = { lines: [], api: null };
async function peStockList() {
  const host = peEl('bkl_stock');
  if (!host) return;
  let lines = [];
  try {
    const reply = await api('booksLedger', { params: { account: 'stock' }, query: { from: peDaysAgo(400), to: peYmd(new Date()) } });
    lines = ((reply && reply.lines) || [])
      .filter((item) => /closing stock/i.test(String(item.what || '')))
      .map((item, index) => Object.assign({ i: index }, item))
      .reverse();
  } catch (e) {
    if (!(e && e.status === 404)) {
      host.innerHTML = '<div class="pe-bad">' + bkErr(e) + '</div>';
      return;
    }
  }
  CBList.reset && CBList.reset('stock');
  PE_STOCK.lines = lines;
  if (PE_STOCK.api) {
    try {
      PE_STOCK.api.destroy();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  PE_STOCK.api = CBList.mount(host, {
    key: 'stock',
    t: tx,
    rows: () => PE_STOCK.lines,
    id: (l) => String(l.ref) + '#' + l.i,
    rowTid: (l) => 'stock-' + l.i,
    columns: [
      { key: 'date', label: tx('Month end'), prio: 1, sort: 'date', w: 150, html: true, cell: (l) => esc(bkDate(l.date)) },
      { key: 'entry', label: tx('Entry'), prio: 3, sort: 'entry', w: 150, html: true, cell: (l) => '<span class="mono">' + esc(l.ref || '') + '</span>' },
      {
        key: 'change',
        label: tx('Changed the stock by'),
        prio: 2,
        sort: 'change',
        num: true,
        w: 200,
        html: true,
        cell: (l) => esc(l.dr_minor ? peMoney(l.dr_minor) + ' ' + tx('Dr') : peMoney(l.cr_minor) + ' ' + tx('Cr'))
      },
      { key: 'after', label: tx('Stock after'), prio: 4, sort: 'after', num: true, w: 190, html: true, cell: (l) => esc(bkDrCr(l.running_minor)) }
    ],
    search: (l) => [l.date, l.ref, l.what].join(' '),
    sorts: [{ key: 'date', label: tx('Newest first'), cmp: (a, b) => String(b.date).localeCompare(String(a.date)) }],
    empty: { title: tx('No counts yet') }
  });
}
/** M173: the count just saved goes into the list below at once, from the server's answer (only the difference posted: book_minor is what the ledger held) - no second read */
function peStockAdd(body, v, r) {
  const now = body.nrv_minor != null ? Math.min(v, body.nrv_minor) : v,
    book = Number(r && r.book_minor) || 0,
    diff = now - book;
  const i = PE_STOCK.lines.reduce((total, item) => Math.max(total, item.i), -1) + 1;
  PE_STOCK.lines = [
    {
      i,
      date: body.date,
      ref: (r && r.entry_no) || '',
      what: 'Closing stock ' + body.date,
      dr_minor: diff > 0 ? diff : 0,
      cr_minor: diff < 0 ? -diff : 0,
      running_minor: now
    }
  ].concat(PE_STOCK.lines);
  if (PE_STOCK.api) PE_STOCK.api.refresh();
  else peStockList();
}
async function peStockSave(btn) {
  const date = peVal('ps_date'),
    v = bkMoneyMinor(peVal('ps_val'));
  if (!date || isNaN(v)) return peBad('ps_out', tx('Enter the month end and the value of the stock on hand.'));
  const body = { date, value_minor: v, method: 'manual', client_ref: peRef('stock') };
  if (peVal('ps_nrv')) {
    const n = bkMoneyMinor(peVal('ps_nrv'));
    if (isNaN(n)) return peBad('ps_out', tx('The lower value must be an amount.'));
    body.nrv_minor = n;
  }
  await bkOnce('pe-stock', btn, async () => {
    try {
      const reply = await api('perStock', { body });
      PE.ref.stock = null;
      peOk('ps_out', reply && reply.entry_no ? esc(txf('Saved · {no}', { no: reply.entry_no })) : esc(tx((reply && reply.why) || 'Saved')));
      peStockAdd(body, v, reply);
    } catch (e) {
      peBad('ps_out', e);
    }
  });
}

/* ═══ 2 · ASSETS & DEPRECIATION ═════════════════════════════════════════════════════════════════════════════════════════
   GET /assets → the register; POST /assets (by hand); POST /assets/:id/dispose; POST /depreciation/run { fy } → one entry, and the basis it used.
   The classes are the pack's — the same six keys in IN · AU · AE (the server refuses another and names them). */
const PE_CLASSES = [
  ['buildings', 'Buildings'],
  ['plant', 'Plant & machinery'],
  ['furniture', 'Furniture'],
  ['vehicles', 'Vehicles'],
  ['office', 'Office equipment'],
  ['computers', 'Computers']
];
const PE_CLASS_WORD = PE_CLASSES.reduce((total, item) => {
  total[item[0]] = item[1];
  return total;
}, {});
/* CX2 (A5): the basis CODE is the pack's (depreciation.entityBases); its short word is here until a pack carries a label (engines request queued) */
const PE_BASIS = { it_act_wdv: 'Income-tax WDV', schedule_ii: 'Schedule II', div40: 'Division 40', ias16: 'IAS 16' };
const PE_ENTITY = {
  proprietor: 'proprietor',
  partnership: 'partnership',
  llp: 'LLP',
  huf: 'HUF',
  trust: 'trust',
  company: 'company',
  sole_trader: 'sole trader',
  sole_establishment: 'sole establishment'
};
async function peAssetsView(body) {
  if (!peOwner()) {
    body.innerHTML = peNoOwner('Only the owner sees the asset register');
    return;
  }
  body.innerHTML =
    '<div class="supacts pe-bar">' +
    peBtn('pa-add-open', '＋ Add an asset', 'peAssetForm()') +
    peBtn('pa-dep-open', 'Run depreciation', 'peDepForm()', '') +
    '</div>' +
    '<div id="pa_form" class="pe-slot"></div><div id="pa_out" class="pe-slot"></div><div id="bkl_assets" data-testid="assets-list"></div>';
  await peAssetsList();
}
async function peAssetsList() {
  const host = peEl('bkl_assets');
  if (!host) return;
  let r;
  try {
    r = await api('perAssets');
  } catch (e) {
    const w = peWhy(e, tx('Could not be read'));
    host.innerHTML = '<div class="' + (w.calm ? 'pe-calm' : 'pe-bad') + '" data-testid="pe-refused">' + (w.calm ? '⏳ ' : '') + esc(w.text) + '</div>';
    return;
  }
  PE.assets = (r && r.assets) || [];
  const list = (r && r.net_block) || [];
  CBList.reset && CBList.reset('assets');
  CBList.mount(host, {
    key: 'assets',
    t: tx,
    rows: () => PE.assets,
    id: (a) => a.asset_id,
    rowTid: (a) => 'asset-' + a.asset_id,
    head: () => ({
      chips: [{ tid: 'pa-total', text: tx('Written-down value') + ' ' + peMoney(r.total_wdv_minor) }],
      notices: list
        .filter((item) => item.agrees === false)
        .map((item) => ({
          cls: 'bad',
          tid: 'pa-differs-' + item.asset_class,
          text: txf('{c}: the register and the Ledger differ', { c: tx(PE_CLASS_WORD[item.asset_class] || item.asset_class) })
        }))
    }),
    columns: [
      {
        key: 'name',
        label: tx('Asset'),
        prio: 1,
        sort: 'name',
        w: 240,
        html: true,
        cell: (a) =>
          esc(a.name) + (a.disposed_on ? ' <span class="optchip" data-testid="asset-sold-' + esc(a.asset_id) + '">' + esc(tx('Sold')) + '</span>' : '')
      },
      { key: 'class', label: tx('Kind'), prio: 4, sort: 'class', w: 170, html: true, cell: (a) => esc(tx(PE_CLASS_WORD[a.asset_class] || a.asset_class)) },
      { key: 'cost', label: tx('Cost'), prio: 3, sort: 'cost', num: true, w: 150, html: true, cell: (a) => esc(peMoney(a.cost_minor)) },
      { key: 'use', label: tx('Put to use'), prio: 5, sort: 'use', w: 140, html: true, cell: (a) => esc(bkDate(a.put_to_use)) },
      { key: 'wdv', label: tx('Written-down value'), prio: 2, sort: 'wdv', num: true, w: 190, html: true, cell: (a) => esc(peMoney(a.wdv_minor)) }
    ],
    search: (a) => [a.name, a.asset_class, PE_CLASS_WORD[a.asset_class]].join(' '),
    sorts: [
      { key: 'name', label: tx('Name'), cmp: (a, b) => String(a.name).localeCompare(String(b.name)) },
      { key: 'cost', label: tx('Cost'), cmp: (a, b) => a.cost_minor - b.cost_minor },
      { key: 'wdv', label: tx('Written-down value'), cmp: (a, b) => a.wdv_minor - b.wdv_minor },
      { key: 'use', label: tx('Put to use'), cmp: (a, b) => String(a.put_to_use).localeCompare(String(b.put_to_use)) },
      { key: 'class', label: tx('Kind'), cmp: (a, b) => String(a.asset_class).localeCompare(String(b.asset_class)) }
    ],
    actions: [{ id: 'dispose', icon: '↗', label: 'Sold or scrapped', tid: 'pa-dispose', when: (a) => !a.disposed_on, run: (a) => peSellForm(a.asset_id) }],
    empty: { title: tx('No assets yet') }
  });
}
function peAssetForm() {
  PE.ref.asset = PE.ref.asset || bkRef();
  peEl('pa_form').innerHTML =
    '<div class="pe-card" data-testid="pa-form"><div class="pe-form">' +
    peField('pa_name', 'What is it?', peInput('pa_name', '', tx('e.g. Display fridge'))) +
    peField('pa_class', 'Kind', peSel('pa_class', PE_CLASSES, 'furniture')) +
    peField('pa_cost', 'Cost', peAmt('pa_cost')) +
    peField('pa_date', 'Bought on', peInput('pa_date', peYmd(new Date()), '', 'date')) +
    peField('pa_use', 'Put to use on (if later)', peInput('pa_use', '', '', 'date')) +
    peField('pa_how', 'Paid from', peSel('pa_how', peMODES, 'bank')) +
    '</div><div class="supacts">' +
    peBtn('pa-save', 'Add asset', 'peAssetSave(this)') +
    peBtn('pa-cancel', 'Cancel', "peEl('pa_form').innerHTML=''", '') +
    '</div><div id="pa_fout" class="pe-slot"></div></div>';
}
async function peAssetSave(btn) {
  const cost = bkMoneyMinor(peVal('pa_cost'));
  if (!peVal('pa_name') || isNaN(cost)) return peBad('pa_fout', tx('Name the asset and say what it cost.'));
  const body = { name: peVal('pa_name'), class: peVal('pa_class'), cost_minor: cost, date: peVal('pa_date'), how: peVal('pa_how'), client_ref: PE.ref.asset };
  if (peVal('pa_use')) body.put_to_use = peVal('pa_use');
  await bkOnce('pe-asset', btn, async () => {
    try {
      const reply = await api('perAssetAdd', { body });
      PE.ref.asset = null;
      peEl('pa_form').innerHTML = '';
      peOk('pa_out', esc(txf('Asset added · {no}', { no: (reply && reply.entry_no) || '' })));
      peAssetsList();
    } catch (e) {
      peBad('pa_fout', e);
    }
  });
}
function peSellForm(id) {
  PE.ref['sell' + id] = PE.ref['sell' + id] || bkRef();
  const a = (PE.assets || []).filter((x) => x.asset_id === id)[0] || {};
  peEl('pa_form').innerHTML =
    '<div class="pe-card" data-testid="pa-sell-form"><div class="pe-sub">' +
    esc(a.name || '') +
    '</div><div class="pe-form">' +
    peField('pd_date', 'Sold or scrapped on', peInput('pd_date', peYmd(new Date()), '', 'date')) +
    peField('pd_get', 'What it fetched (empty if scrapped)', peAmt('pd_get', '', tx('Leave empty if scrapped'))) +
    peField('pd_into', 'Money came into', peSel('pd_into', peMODES, 'bank')) +
    '</div><div class="supacts">' +
    peBtn('pd-save', 'Save', "peSellSave(this,'" + esc(id) + "')") +
    peBtn('pd-cancel', 'Cancel', "peEl('pa_form').innerHTML=''", '') +
    '</div><div id="pd_out" class="pe-slot"></div></div>';
  peEl('pa_form').scrollIntoView && peEl('pa_form').scrollIntoView({ block: 'nearest' });
}
async function peSellSave(btn, id) {
  const body = { date: peVal('pd_date'), into: peVal('pd_into'), client_ref: PE.ref['sell' + id] };
  if (peVal('pd_get')) {
    const m = bkMoneyMinor(peVal('pd_get'));
    if (isNaN(m)) return peBad('pd_out', tx('What it fetched must be an amount.'));
    body.proceeds_minor = m;
  }
  await bkOnce('pe-sell-' + id, btn, async () => {
    try {
      const reply = await api('perAssetSell', { params: { id }, body });
      PE.ref['sell' + id] = null;
      peEl('pa_form').innerHTML = '';
      peOk('pa_out', esc(txf('Saved · {no}', { no: (reply && reply.entry_no) || '' })));
      peAssetsList();
    } catch (e) {
      peBad('pd_out', e);
    }
  });
}
async function peDepForm() {
  let L;
  try {
    L = await bkPeriodsLoad();
  } catch (e) {
    return peBad('pa_out', e);
  }
  const years = L.years.slice(),
    prev = peLastYear(years);
  peEl('pa_form').innerHTML =
    '<div class="pe-card" data-testid="pdp-form"><div class="pe-form">' +
    peField(
      'pdp_fy',
      'Financial year',
      peSel(
        'pdp_fy',
        years.map((y) => [y, y]),
        prev,
        ' onchange="peDepLabel()"'
      )
    ) +
    '</div><div class="supacts"><button data-cbsid="BKS016-B03" type="button" class="supact-pri" id="pdp_run" data-testid="pdp-run" onclick="peDepRun(this)"></button>' +
    peBtn('pdp-cancel', 'Cancel', "peEl('pa_form').innerHTML=''", '') +
    '</div><div id="pdp_out" class="pe-slot"></div></div>';
  peDepLabel();
}
function peDepLabel() {
  const node = peEl('pdp_run');
  if (node) node.textContent = txf('Run depreciation for {fy}', { fy: peVal('pdp_fy') });
}
async function peDepRun(btn) {
  const fy = peVal('pdp_fy');
  await bkOnce('pe-dep', btn, async () => {
    try {
      const r = (await api('perDepRun', { body: { fy, client_ref: peRef('dep' + fy) } })) || {};
      PE.ref['dep' + fy] = null;
      const basis = (PE_ENTITY[r.entity_basis] || r.entity_basis || '') + ': ' + tx(PE_BASIS[r.basis_rule] || 'as set for this shop');
      let h = '<div class="pe-basis" data-testid="pdp-basis">' + esc(txf('Basis used — {b}', { b: basis })) + '</div>';
      if (r.entity_note) h += '<div class="pe-warn" data-testid="pdp-note">⚠ ' + esc(r.entity_note) + '</div>';
      if (r.nothing_to_post) h += '<div class="pe-note" data-testid="pdp-nothing">' + esc(r.why || tx('Nothing to depreciate')) + '</div>';
      else if (r.duplicate)
        h += '<div class="pe-note" data-testid="pdp-dup">' + esc(txf('Already run for {fy} · {no}', { fy, no: r.entry_no || '' })) + '</div>';
      else h += '<div class="pe-ok" data-testid="pdp-done">✓ ' + esc(txf('Depreciation for {fy} saved · {no}', { fy, no: r.entry_no || '' })) + '</div>';
      if ((r.by_class || []).length)
        h +=
          '<div class="pe-rows" data-testid="pdp-classes">' +
          r.by_class
            .map(
              (item) =>
                '<div class="pe-row"><span>' +
                esc(tx(PE_CLASS_WORD[item.class] || item.class)) +
                '</span><span class="mono">' +
                esc(item.rate) +
                '%</span><span class="mono">' +
                esc(CBLocale.money(Number(item.amount), bkCur())) +
                '</span></div>'
            )
            .join('') +
          '</div>';
      peEl('pdp_out').innerHTML = h;
      peAssetsList();
    } catch (e) {
      peBad('pdp_out', e);
    }
  });
}


/* ═══ 4 · GST CLOSE & PAY ═══════════════════════════════════════════════════════════════════════════════════════════════
   POST /gst/close { fy, period } → { utilised: [{ from, against, amount_minor }], payable_minor{cgst_minor…}, rcm_minor?, cash_minor?, carried_minor, pay_total_minor, entry_no }
   POST /gst/pay { fy, period, amounts, rcm, bank, challan_no } — a slip of the finger is caught by the server against what is owed. */
async function peGstView(body) {
  /* ACC-229: the server decides who READS the return (the owner or the shop's auditor; any other login is refused in words, shown below). Closing and paying stay the owner's:
     a reader who is not the owner sees the return and the sentence, never the Close card or the close form. */
  /* BAS1: the shop's OWN return first — an AU shop sees its BAS, an AE shop its VAT return (the pack's words). India (422 RETURN_FROM_RAIL), or a server
     without the route yet, keeps the GST close & pay below as the whole page. */
  let ret = null;
  try {
    PE_RET.q = Object.assign({}, peRetRecall());
    if (!PE_RET.q.period) PE_RET.q.on = await peBusyDay(); /* open on the quarter that has entries, as the Day book does */
    ret = await peReturnLoad();
  } catch (e) {
    body.innerHTML = '<div class="pe-bad">' + bkErr(e) + '</div>';
    return;
  }
  if (ret) {
    peReturnWord(ret);
    body.innerHTML = '<div id="pr_host" data-testid="pr-host"></div>';
    peReturnPaint(ret);
    return;
  }
  if (!peOwner()) {
    body.innerHTML = (PE_RET.why ? '<div class="pe-note" data-testid="pg-rail-why">' + esc(tx(PE_RET.why)) + '</div>' : '') + peNoOwner(peOwnerOnlyCloses());
    return;
  }
  let L;
  try {
    L = await bkPeriodsLoad();
  } catch (e) {
    body.innerHTML = '<div class="pe-bad">' + bkErr(e) + '</div>';
    return;
  }
  /* last month, in the shop's year (WX-R2R: the server's period row, else its year start — never an April of this file's own) */
  const last = peMonthEnd(1),
    lp = bkPeriodOfDay(last, L),
    lastP = lp.p,
    lastFy = lp.fy;
  const years = L.years.slice();
  if (years.indexOf(lastFy) < 0) years.push(lastFy);
  years.sort().reverse();
  body.innerHTML =
    (PE_RET.why ? '<div class="pe-note" data-testid="pg-rail-why">' + esc(tx(PE_RET.why)) + '</div>' : '') +
    '<div class="pe-card" data-testid="pg-form"><div class="pe-form">' +
    peField(
      'pg_fy',
      'Financial year',
      peSel(
        'pg_fy',
        years.map((y) => [y, y]),
        lastFy
      )
    ) +
    peField(
      'pg_p',
      'Month',
      peSel(
        'pg_p',
        bkMonths().map((item, index) => [String(index + 1), item]),
        String(lastP)
      )
    ) +
    '</div><div class="supacts">' +
    peBtn('pg-close', 'Close the month', 'peGstClose(this)') +
    '</div><div id="pg_out" class="pe-slot"></div></div><div id="pg_res"></div>';
}
/** the heads this close answered — the pack's (the server's `heads`); an older server answered India alone, so its four heads stand in */
const peGstHeadsOf = (answer) => (answer && Array.isArray(answer.heads) && answer.heads.length ? answer.heads : peHeads);
const peGstRcmHeadsOf = (answer) => Object.keys((answer && answer.rcm_minor) || {});
const peHeadWord = (headKey) => esc(String(headKey).toUpperCase());
const peGstRow = (testId, label, minor) =>
  '<div class="pe-row" data-testid="' + testId + '"><span>' + label + '</span><span class="mono">' + esc(peMoney(minor)) + '</span></div>';
/** the first half of the set-off card: the credit used, and reverse charge paid in cash where the server named it */
function peGstUsedHTML(answer) {
  const used = answer.utilised || [],
    rcmHeads = peGstRcmHeadsOf(answer);
  let html = '<div class="pe-sub">' + esc(tx('Credit used')) + '</div>';
  html += used.length
    ? '<div class="pe-rows">' +
      used.map((item, index) => peGstRow('pg-used-' + index, peHeadWord(item.from) + ' → ' + peHeadWord(item.against), item.amount_minor)).join('') +
      '</div>'
    : '<div class="pe-note" data-testid="pg-nouse">' + esc(tx('No credit was used')) + '</div>';
  if (rcmHeads.length)
    html +=
      '<div class="pe-sub">' +
      esc(tx('Reverse charge — paid in cash')) +
      '</div><div class="pe-rows">' +
      rcmHeads
        .filter((headKey) => answer.rcm_minor[headKey])
        .map((headKey) => peGstRow('pg-rcm-' + headKey, peHeadWord(headKey), answer.rcm_minor[headKey]))
        .join('') +
      '</div>';
  return html;
}
/** the second half: what is payable per head, what is carried (the pack's word), the total — every head the server named, nothing summed here */
function peGstPayableHTML(answer) {
  const heads = peGstHeadsOf(answer);
  let html =
    '<div class="pe-sub">' +
    esc(answer.form ? txf('To pay · {form}', { form: answer.form }) : tx('To pay by challan')) +
    '</div><div class="pe-rows">' +
    heads
      .filter((headKey) => (answer.payable_minor || {})[headKey + '_minor'])
      .map((headKey) => peGstRow('pg-pay-' + headKey, peHeadWord(headKey), answer.payable_minor[headKey + '_minor']))
      .join('') +
    '</div>';
  const carried = heads.filter((headKey) => (answer.carried_minor || {})[headKey + '_minor']);
  if (carried.length && answer.carried_word)
    html +=
      '<div class="pe-sub" data-testid="pg-carried-word">' +
      esc(answer.carried_word) +
      '</div><div class="pe-rows">' +
      carried.map((headKey) => peGstRow('pg-carried-' + headKey, peHeadWord(headKey), answer.carried_minor[headKey + '_minor'])).join('') +
      '</div>';
  html +=
    '<div class="pe-total" data-testid="pg-total"><span>' +
    esc(tx('Payable')) +
    '</span><span class="mono">' +
    esc(peMoney(answer.pay_total_minor)) +
    '</span></div>';
  return html;
}
/** ACC-336: the amounts a pay form may ask for, per head — still_to_pay_minor (after the payments named for the period) when the server sends it, else the set-off's payable_minor (an older server) */
function peGstStillMinor(answer) {
  return answer.still_to_pay_minor || answer.payable_minor || {};
}
/** ACC-336: the total still to pay: still_to_pay_total_minor when sent (reverse charge included), else pay_total_minor */
function peGstStillTotal(answer) {
  return typeof answer.still_to_pay_total_minor === 'number' ? answer.still_to_pay_total_minor : answer.pay_total_minor || 0;
}
/** ACC-336: the reverse-charge amount to prefill per head. The server sends no per-head still for reverse charge, only still_to_pay_total_minor, so what is left of that total after the forward heads is handed out head by head, never more than the head owes; an older server (no total) leaves the owed figure as it was */
function peGstRcmStill(answer) {
  const owed = answer.rcm_minor || {};
  if (typeof answer.still_to_pay_total_minor !== 'number') return owed;
  const forward = peGstStillMinor(answer);
  let left = answer.still_to_pay_total_minor - peGstHeadsOf(answer).reduce((sum, item) => sum + (forward[item + '_minor'] || 0), 0);
  const still = {};
  Object.keys(owed).forEach((item) => {
    still[item] = Math.max(0, Math.min(owed[item] || 0, left));
    left -= still[item];
  });
  return still;
}
/** the close's answer painted: credit used · reverse charge where owed · what is payable per head · what is carried (the pack's word) */
function peGstSetOff(answer) {
  return '<div class="pe-card" data-testid="pg-setoff">' + peGstUsedHTML(answer) + peGstPayableHTML(answer) + '</div>';
}
/** one painter for a close's answer wherever it was asked from (the month form · the return): the note on top, the set-off, the pay form when something is payable */
function peGstPaintClose(answer, resId, outId) {
  let html = peGstSetOff(answer);
  if (answer.duplicate)
    html = '<div class="pe-note" data-testid="pg-dup">' + esc(txf('Already closed · {no}', { no: answer.entry_no || '' })) + '</div>' + html;
  else if (answer.nothing_to_set_off)
    html =
      '<div class="pe-note" data-testid="pg-nothing">' +
      esc(answer.form ? tx('Nothing to set off this period') : tx('Nothing to set off this month')) +
      '</div>' +
      html;
  else
    html =
      '<div class="pe-ok" data-testid="pg-closed">✓ ' +
      esc(txf(answer.form ? 'Period closed · {no}' : 'Month closed · {no}', { no: answer.entry_no || '' })) +
      '</div>' +
      html;
  if (peGstStillTotal(answer) > 0) html += peGstPayForm(answer);
  peEl(resId).innerHTML = html;
  peEl(outId).innerHTML = '';
}
async function peGstClose(btn) {
  const fy = peVal('pg_fy'),
    period = Number(peVal('pg_p'));
  await bkOnce('pe-gst-close', btn, async () => {
    try {
      const r = (await api('perGstClose', { body: { fy, period, client_ref: 'gstclose-' + fy + '-' + period } })) || {};
      PE.gst = Object.assign({ fy, period }, r);
      peGstPaintClose(r, 'pg_res', 'pg_out');
    } catch (e) {
      peBad('pg_out', e);
      peEl('pg_res').innerHTML = '';
    }
  });
}
/** the picks the return was read with (frequency · stagger), handed to the close and the payment exactly as GET /returns took them — the server resolves the period from them */
const peRetPicks = (returnRead) => {
  const asked = (returnRead && returnRead.asked) || {},
    picks = {};
  if (asked.frequency) picks.frequency = asked.frequency;
  if (asked.stagger != null && asked.stagger !== '') picks.stagger = asked.stagger;
  return picks;
};
/** W2-BOOKS: the RETURN's period closed from the return screen (AU BAS · AE VAT201) — the server's own period id; a refusal (PERIOD_NOT_ENDED · RCM_NETTING_NOT_BUILT) is its sentence in the slot */
async function peGstCloseReturn(btn) {
  const returnRead = PE_RET.r,
    period = returnRead && returnRead.period;
  if (!period) return;
  const picks = peRetPicks(returnRead);
  await bkOnce('pe-gst-close', btn, async () => {
    try {
      const answer = (await api('perGstClose', { body: Object.assign({ period: period.period, client_ref: 'gstclose-' + period.period }, picks) })) || {};
      PE.gst = Object.assign({ period: period.period, picks }, answer);
      peGstPaintClose(answer, 'pr_close_res', 'pr_close_out');
    } catch (e) {
      peBad('pr_close_out', e);
      peEl('pr_close_res').innerHTML = '';
    }
  });
}
/** the payment form: paid from · the pack's reference (its label and hint come from the server — never "challan" typed for another country) · an amount per head the close left payable */
function peGstPayForm(r) {
  const toPay = peGstStillMinor(r), /* ACC-336: what is STILL to pay after the payments named for the period; an older server sends only payable_minor */
    heads = peGstHeadsOf(r).filter((item) => toPay[item + '_minor']),
    rcmStill = peGstRcmStill(r), /* ACC-336: reverse charge still owed after the payments named for the period */
    list = peGstRcmHeadsOf(r).filter((item) => rcmStill[item]);
  const label = r.ref_label || 'Challan number',
    hint = r.ref_hint || tx('The CPIN on the challan'); /* no ref words: an older server, which answered India alone */
  return (
    '<div class="pe-card" data-testid="pg-pay-form"><div class="pe-form">' +
    peField('pgp_bank', 'Paid from', peSel('pgp_bank', peMODES, 'bank')) +
    peField('pgp_ch', label, peInput('pgp_ch', '', hint)) +
    heads.map((item) => peField('pgp_' + item, item.toUpperCase(), peAmt('pgp_' + item, peText(toPay[item + '_minor'])))).join('') +
    list.map((item) => peField('pgr_' + item, item.toUpperCase() + ' · ' + tx('reverse charge'), peAmt('pgr_' + item, peText(rcmStill[item])))).join('') +
    '</div><div class="supacts">' +
    peBtn('pg-pay', 'Pay', 'peGstPay(this)') +
    '</div><div id="pgp_out" class="pe-slot"></div></div>'
  );
}
/** the payment posted: the heads the close named, the pack's reference; a month close (IN) sends fy · period · challan_no, a return close sends the period id · payment_ref · the picks */
async function peGstPay(btn) {
  const g = PE.gst || {},
    amounts = {},
    rcm = {};
  const read = (id, into, key) => {
    const e = peEl(id);
    if (!e) return true;
    const m = bkMoneyMinor(e.value);
    if (isNaN(m)) return false;
    into[key + '_minor'] = m;
    return true;
  };
  for (const k of peGstHeadsOf(g)) if (!read('pgp_' + k, amounts, k)) return peBad('pgp_out', tx('Each amount must be a number.'));
  for (const k of peGstRcmHeadsOf(g)) if (!read('pgr_' + k, rcm, k)) return peBad('pgp_out', tx('Each amount must be a number.'));
  const ref = peVal('pgp_ch');
  if (!ref) return peBad('pgp_out', g.ref_label ? txf('Give the {what}.', { what: g.ref_label.toLowerCase() }) : tx('Give the challan number (the CPIN).'));
  const body = Object.assign(g.form ? Object.assign({ period: g.period, payment_ref: ref }, g.picks || {}) : { fy: g.fy, period: g.period, challan_no: ref }, {
    amounts,
    bank: peVal('pgp_bank')
  });
  if (Object.keys(rcm).length) body.rcm = rcm;
  await bkOnce('pe-gst-pay', btn, async () => {
    try {
      const r = (await api('perGstPay', { body })) || {};
      peOk('pgp_out', esc(txf('Paid · {no}', { no: r.entry_no || '' })));
    } catch (e) {
      peBad('pgp_out', e);
    }
  });
}

/* ═══ 4a · THE SHOP'S OWN RETURN (BAS1, 2026-10-12) — BAS (AU) · VAT return (AE), prepared from the books, never lodged ═══════════════════════════════
   GET /returns?period&frequency&simpler&stagger&emirate → { currency, pack, form, name, short, authority, portal, prepared, asked, periods: [{ period, label, start, end, due, ended, state?, closed? }],
     period, boxes: [{ code, label, amount_minor, tax_minor, roles, accounts: [{ code, name }], note }], payable_minor, refund_minor, net_minor, notes, cite, emirates?, staggers?, needs?, why? }
   ⭐ THE PAGE COMPUTES NOTHING: every figure is the server's READ of the posted ledgers (engines gst-returns.returnFor → the pack's bas / vat201). The list IS CBList (rule 5);
   a box row opens the Ledgers page on the ledgers it counts, for the period; "Copy figures" puts the boxes on the clipboard as one block for the ATO / FTA portal.
   The FTA stagger and the Emirate are never guessed: until the owner picks the stagger the server says so (`needs`) and no box is drawn; the picks are remembered on this device. */
var PE_RET = { r: null, q: {}, api: null, block: '', why: '' };
const peRetKey = () => 'cb_ret_' + ((typeof SESSION !== 'undefined' && SESSION && (SESSION.entityId || SESSION.bridgeId)) || 'shop');
function peRetRemember() {
  try {
    localStorage.setItem(
      peRetKey(),
      JSON.stringify({
        stagger: PE_RET.q.stagger || null,
        emirate: PE_RET.q.emirate || null,
        frequency: PE_RET.q.frequency || null,
        simpler: PE_RET.q.simpler || null
      })
    );
  } catch (_) { /* storage blocked or full: the page works without it */ }
}
function peRetRecall() {
  try {
    const parsed = JSON.parse(localStorage.getItem(peRetKey()) || 'null') || {};
    Object.keys(parsed).forEach((item) => {
      if (parsed[item] == null) delete parsed[item];
    });
    return parsed;
  } catch (_) {
    return {};
  }
}
const peRetDash = () => '<span style="color:var(--grey)">—</span>';
/** the last day of the latest month WITH entries (the Day book's rule: GET /periods rows carry start_date, end_date, entries); '' when none, so the server's own default stands */
async function peBusyDay() {
  try {
    const busy = ((await api('booksPeriods')) || {}).periods || [];
    const last = busy
      .filter((item) => Number(item.entries) > 0 && Number(item.period) >= 1 && item.end_date)
      .map((item) => String(item.end_date).slice(0, 10))
      .sort()
      .pop();
    return last || '';
  } catch (failure) {
    return bkQuiet('busy-day', failure, '');
  }
}
/** what the shop calls its return — BAS, VAT return — before the server has answered (the pack's word), else the neutral "Tax close" */
const peReturnName = () => PE_RET.word || (typeof packWord === 'function' && packWord('returnName')) || tx('Tax close');
/** the return for the current picks; null when this shop's return is not read from the ledgers (India: 422 RETURN_FROM_RAIL) or the server predates the route (404) */
async function peReturnLoad() {
  const q = {};
  ['period', 'on', 'frequency', 'simpler', 'stagger', 'emirate'].forEach((item) => {
    if (PE_RET.q[item] != null && PE_RET.q[item] !== '') q[item] = String(PE_RET.q[item]);
  });
  /* TOUR-FIX1: the server ANSWERS a shop whose return is not read from the ledgers — 200 { form: null, code: RETURN_FROM_RAIL, why } — and the
     page says `why` above its GST close (the 422 is still read for a server from before) */
  PE_RET.why = '';
  try {
    const reply = await api('perReturn', { query: q });
    if (reply && reply.form) return reply;
    PE_RET.why = (reply && reply.code === 'RETURN_FROM_RAIL' && reply.why) || '';
    return null;
  } catch (e) {
    if (e && (e.status === 404 || (e.status === 422 && e.data && e.data.code === 'RETURN_FROM_RAIL'))) return null;
    throw e;
  }
}
/** the menu and the title say what the pack calls it — BAS, VAT return, GST return — instead of the neutral "Tax close & pay" */
function peReturnWord(r) {
  const word = r.short || r.form;
  PE_RET.word = word; /* accounts.html taxCloseWord() reads it, so its repaint keeps BAS */
  if (typeof NAV !== 'undefined' && Array.isArray(NAV)) {
    const n = NAV.find((x) => x[0] === 'gstclose');
    if (n && n[1] !== word) {
      n[1] = word;
      if (typeof navPaint === 'function') navPaint('gstclose');
    }
  }
  const node = document.getElementById('title');
  if (node && typeof BK !== 'undefined' && BK.tab === 'gstclose') node.textContent = word;
}
/** a pick changed (period · frequency · labels · stagger · Emirate): ask again, repaint; the server's refusal is one sentence in the slot */
async function peReturnPick(k, v) {
  PE_RET.q[k] = v;
  if (k !== 'period') {
    delete PE_RET.q.period;
    peRetRemember();
  }
  const host = peEl('pr_host');
  if (!host) return;
  try {
    const r = await peReturnLoad();
    if (r) peReturnPaint(r);
  } catch (e) {
    peBad('pr_out', e, tx('Could not be read'));
  }
}
/** the Period picker: the latest first, the one to prepare now on top; nothing when the server sent no period */
function peReturnPeriodField(returnAnswer) {
  const period = returnAnswer.period,
    periods = (returnAnswer.periods || []).slice().reverse();
  return (
    (periods.length
      ? peField(
          'pr_p',
          'Period',
          peSel(
            'pr_p',
            periods.map((item) => [item.period, (peNarrow() ? item.label.replace(/s*([^)]*)/, '') : item.label) + ' · ' + tx('due') + ' ' + bkDate(item.due) + (item.ended ? '' : ' · ' + tx('open')) + peRetStateWord(item.state)]),
            period ? period.period : '',
            ' onchange="peReturnPick(\'period\', this.value)"'
          )
        ).replace('<label class="pe-f">', '<label class="pe-f" style="grid-column:1/-1">') /* ACC-357: the period has the whole row, so its due date shows whole */
      : '')
  );
}
/** the BAS pickers: How often and the Labels (Simpler or Full) */
function peReturnBasFields(returnAnswer) {
  const asked = returnAnswer.asked || {};
  return (
    peField(
      'pr_f',
      'How often',
      peSel(
        'pr_f',
        [
          ['quarterly', 'Quarterly'],
          ['monthly', 'Monthly']
        ],
        asked.frequency || 'quarterly',
        ' onchange="peReturnPick(\'frequency\', this.value)"'
      )
    ) +
    peField(
      'pr_s',
      'Labels',
      peSel(
        'pr_s',
        [
          ['1', txf('Simpler {name}', { name: peReturnName() })],
          ['0', txf('Full {name}', { name: peReturnName() })]
        ],
        asked.simpler === false ? '0' : '1',
        ' onchange="peReturnPick(\'simpler\', this.value)"'
      )
    )
  );
}
/** the VAT pickers: the tax period (stagger) and, once the return is not waiting on a setup, the emirate */
function peReturnAeFields(returnAnswer) {
  const asked = returnAnswer.asked || {},
    stg = returnAnswer.staggers || {};
  const staggerOpts = [['', '—']].concat(
    Object.keys(stg).map((item) => [
      stg[item].monthly ? 'monthly' : item,
      stg[item].monthly ? tx('Monthly') : txf('Stagger {n} · tax year ends {m}', { n: item, m: stg[item].tax_year_end })
    ])
  );
  return (
    peField(
      'pr_st',
      'Tax period',
      peSel('pr_st', staggerOpts, asked.stagger == null ? '' : String(asked.stagger), ' onchange="peReturnPick(\'stagger\', this.value)"')
    ) +
    (!returnAnswer.needs
      ? peField(
          'pr_em',
          'Emirate',
          peSel('pr_em', [['', '—']].concat((returnAnswer.emirates || []).map((e) => [e, e])), asked.emirate || '', ' onchange="peReturnPick(\'emirate\', this.value)"')
        )
      : '')
  );
}
/** the pickers of the shop's own return, as the opening of its card; the choices are the server's */
function peReturnPickers(returnAnswer) {
  const picks = returnAnswer.form === 'VAT201' ? peReturnAeFields(returnAnswer) : peReturnBasFields(returnAnswer);
  return '<div class="pe-card" data-testid="pr-card"><div class="pe-form">' + peReturnPeriodField(returnAnswer) + picks + '</div>';
}
function peReturnPaint(r) {
  const host = peEl('pr_host');
  if (!host) return;
  PE_RET.r = r;
  const currency = r.currency;
  let h = peReturnPickers(r);
  if (r.needs) {
    host.innerHTML = h + '<div class="pe-note" data-testid="pr-needs">' + esc(r.why || '') + '</div></div>';
    return;
  }
  h +=
    '<div class="supacts">' +
    peBtn('pr-copy', 'Copy figures', 'peReturnCopy(this)') +
    '</div><div id="pr_out" class="pe-slot"></div>' +
    '<div class="pe-total" data-testid="pr-total" style="justify-content:flex-start"><span>' +
    esc(r.net_minor < 0 ? tx('Refund due') : tx('To pay')) +
    '</span><span class="mono">' +
    esc(peMoney(Math.abs(r.net_minor || 0), currency)) +
    '</span>' +
    peReturnRisk(r) +
    '</div>' +
    peReturnClaimBand(r) +
    '<div class="pe-note" data-testid="pr-prepared">' +
    esc(r.prepared + ' — ' + txf('lodge it in the {who} portal ({portal})', { who: r.authority, portal: r.portal })) +
    '</div>' +
    '</div><div id="pr_list" data-testid="pr-list"></div>';
  if ((r.notes || []).length)
    h +=
      '<div class="pe-card" data-testid="pr-basis"><div class="pe-sub">' +
      esc(tx('How it was read')) +
      '</div>' +
      r.notes.map((item, index) => '<div class="pe-note" data-testid="pr-note-' + index + '">' + esc(item) + '</div>').join('') +
      '</div>';
  host.innerHTML = '<div id="bk_attn_bas"></div>' + h + peReturnCloseSection(r);
  if (typeof CBAttention !== 'undefined' && r.period) CBAttention.mount(document.getElementById('bk_attn_bas'), { from: r.period.start, to: r.period.end }); /* W15-102: the same strip, the return's days */
  peReturnList(r);
}
/** W15-91: the credit claimed with no tax invoice — the server carried it (the Day book's own flag over this period); the words are CBEvidence's, "See them" opens the Day book on the same days, Evidence = No tax invoice. The return's figures and the lodging are not touched. */
function peReturnClaim(r) {
  return typeof CBEvidence !== 'undefined' && CBEvidence.claimWarning ? CBEvidence.claimWarning(r.unsupported_input, (minor) => peMoney(minor, r.currency)) : null;
}
/** the claim band under the return total: what the shop may claim back, in the server's words, with its risk mark when the server raised one */
function peReturnClaimBand(answer) {
  const claimed = peReturnClaim(answer);
  if (!claimed) return '';
  return (
    '<div class="ev-warnbox" role="status" data-testid="pr-claim">' +
    esc(claimed.text) +
    ' <button data-cbsid="BKS016-B10" type="button" class="optchip" data-testid="pr-claim-see" onclick="peReturnSeeClaim()">' +
    esc(claimed.see) +
    '</button></div>'
  );
}
/** a phone: the period words drop their months in brackets so the due date shows whole (shorten words, never clip) */
const peNarrow = () => typeof matchMedia === 'function' && matchMedia('(max-width:620px)').matches;
/** ACC-357: the money at risk, on the To pay line — both figures are the server's (CBEvidence.claimRisk words them; nothing is added here) */
function peReturnRisk(r) {
  const words = typeof CBEvidence !== 'undefined' && CBEvidence.claimRisk ? CBEvidence.claimRisk(r.unsupported_input, r.net_minor, (minor) => peMoney(minor, r.currency)) : null;
  return words ? '<span class="pe-risk" data-testid="pr-risk" style="font-size:13px;font-weight:400;color:var(--warn-2,#b45309)">· ' + esc(words) + '</span>' : '';
}
/** "See them": the Day book for the return's days, narrowed to Evidence = No tax invoice (the list's own preset, replaced once, then the list remembers as usual) */
function peReturnSeeClaim() {
  const P = PE_RET.r && PE_RET.r.period;
  if (!P || typeof BK === 'undefined') return;
  BK.dbp = bkDbPeriod('custom', { from: P.start, to: P.end });
  BK.dvPreset = { filt: { evidence: 'flag' } };
  if (typeof show === 'function') show('daybook');
}
/** the same warning, short, beside the box that counts the input tax (1B) */
function peReturnClaimMark(r, b) {
  const u = r.unsupported_input;
  if (!u || !u.box || u.box !== b.code || !peReturnClaim(r)) return '';
  return ' <span class="ev ev-warn" data-testid="pr-claim-mark">⚠ ' + esc(CBEvidence.words.flag) + ' · ' + esc(String(u.count)) + '</span>';
}
/* PAST-YEARS: each return period carries its state from the server (set_off · months_locked · year_closed · declared_lodged · open): said in the shop's words, never the code */
const PE_RET_STATE = { set_off: 'closed', months_locked: 'closed', year_closed: 'closed with the year', declared_lodged: 'lodged, as you said' };
const peRetStateWord = (state) => (PE_RET_STATE[state] ? ' · ' + tx(PE_RET_STATE[state]) : '');
/** a period closed with its year, or whose months are locked, is READ ONLY: the sentence says why (the server refuses a write all the same) */
const PE_RET_READ_ONLY = {
  year_closed: 'This period was closed with its year. You can read it; nothing here can change it.',
  declared_lodged: 'You said these returns were lodged outside ChitBridge when the year closed. You can read this period; nothing here can change it.',
  months_locked: "This period's months are locked. You can read it; nothing here can change it."
};
const peRetReadOnly = (r) => {
  const cur = (r.periods || []).find((item) => r.period && item.period === r.period.period);
  return (cur && PE_RET_READ_ONLY[cur.state]) || '';
};
/** ACC-229: the foot of the return — the owner gets the Close card; a reader who is not the owner (the shop's auditor) gets the sentence and no button */
function peReturnCloseSection(r) {
  if (peRetReadOnly(r)) return '<div class="pe-card" data-testid="pr-readonly"><div class="pe-note">' + esc(tx(peRetReadOnly(r))) + '</div></div>';
  return peOwner() ? peReturnCloseCard(r) : peNoOwner(peOwnerOnlyCloses());
}
/** W2-BOOKS: close and pay THIS period from the return (the same close & pay India has, per return period) — the server decides: a period still running (`ended` false) is greyed with the day it ends */
function peReturnCloseCard(r) {
  const period = r.period;
  if (!period) return '';
  const greyWhy = period.ended ? '' : txf('Ends on {day}', { day: bkDate(period.end) });
  return (
    '<div class="pe-card" data-testid="pr-close-card"><div class="pe-sub">' +
    esc(tx('Close and pay')) +
    '</div>' +
    '<div class="pe-note">' +
    esc(txf("Set the period's credit against its tax in the books, then record what was paid to the {who}.", { who: r.authority })) +
    '</div>' +
    '<div class="supacts">' +
    (greyWhy
      ? '<button data-cbsid="BKS016-B05" type="button" class="supact-pri" data-testid="pr-close" disabled title="' +
        esc(greyWhy) +
        '">' +
        esc(txf('Close {period}', { period: period.label })) +
        '</button>'
      : peBtn('pr-close', txf('Close {period}', { period: period.label }), 'peGstCloseReturn(this)')) +
    '</div>' +
    (greyWhy ? '<div class="pe-note" data-testid="pr-close-why">' + esc(greyWhy) + '</div>' : '') +
    '<div id="pr_close_out" class="pe-slot"></div></div><div id="pr_close_res"></div>'
  );
}
/** the boxes as the Task table (CBList): box · label · amount (· VAT) · the ledgers it counts, each a chip that opens it */
function peReturnList(r) {
  const host = peEl('pr_list');
  if (!host) return;
  const c = r.currency,
    two = (r.columns || []).indexOf('tax') >= 0 || r.form === 'VAT201';
  CBList.reset && CBList.reset('return');
  if (PE_RET.api) {
    try {
      PE_RET.api.destroy();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  const rows = (r.boxes || []).map((item, index) => Object.assign({ i: index }, item));
  const cols = [
    { key: 'code', label: tx('Box'), prio: 1, w: 90, html: true, cell: (b) => '<b class="mono">' + esc(b.code) + '</b>' },
    {
      key: 'label',
      label: tx('Label'),
      prio: 2,
      w: 320,
      html: true,
      cell: (b) => esc(b.label) + (b.note ? ' <span style="color:var(--grey)">' + esc(b.note) + '</span>' : '') + peReturnClaimMark(r, b)
    },
    {
      key: 'amount',
      label: tx('Amount'),
      prio: 1,
      num: true,
      w: 150,
      html: true,
      tid: (b) => 'pr-amt-' + b.code,
      cell: (b) => (b.amount_minor == null ? peRetDash() : esc(peMoney(b.amount_minor, c)))
    }
  ];
  if (two)
    cols.push({
      key: 'tax',
      label: peTaxWord(),
      prio: 1,
      num: true,
      w: 150,
      html: true,
      tid: (b) => 'pr-tax-' + b.code,
      cell: (b) => (b.tax_minor == null ? peRetDash() : esc(peMoney(b.tax_minor, c)))
    });
  cols.push({
    key: 'opens',
    label: tx('Ledgers'),
    prio: 3,
    w: 120,
    html: true,
    cell: (b) => (b.accounts_n ? '<span data-testid="pr-count-' + esc(b.code) + '">' + esc(txn('{count} ledger', '{count} ledgers', b.accounts_n)) + ' ▸</span>' : peRetDash())
  });
  PE_RET.api = CBList.mount(host, {
    key: 'return',
    t: tx,
    rows: () => rows,
    id: (b) => String(b.code),
    rowTid: (b) => 'pr-box-' + b.code,
    columns: cols,
    defaultCols: cols.map((x) => x.key) /* a return is read whole: every column shown (CBList's default keeps three); ⚙ still chooses */,
    next: (b) => peReturnLedgers(r, b, two) /* ACC-357: the row opens BELOW: one line per ledger with its amount for the period (a shop may have hundreds of places: the server sends the top ten) */
  });
}
/** the panel under a box: its own header row, one line per ledger (largest first, the server's figures), "and n more" when the server cut the list; each ledger opens its entries for the period */
function peReturnLedgers(answer, b, taxColumns) {
  const c = answer.currency,
    grey = 'color:var(--grey);font-size:var(--fs-1)',
    widths = taxColumns ? [130, 130] : [130],
    money = (v) => (v == null ? peRetDash() : esc(peMoney(v, c)));
  const head = CBList.nextRow(
    ['<span style="' + grey + '">' + esc(tx('Ledger')) + '</span>'].concat(taxColumns ? ['<span style="' + grey + '">' + esc(tx('Amount')) + '</span>', '<span style="' + grey + '">' + esc(peTaxWord()) + '</span>'] : ['<span style="' + grey + '">' + esc(tx('Amount')) + '</span>']),
    widths
  );
  const lines = (b.accounts || []).map((item) =>
    CBList.nextRow(
      [
        '<button data-cbsid="BKS016-B06" type="button" style="background:none;border:0;padding:0;min-height:0;font:inherit;color:var(--link,#1a5f8a);cursor:pointer;text-align:left" data-testid="pr-open-' + esc(b.code) + '-' + esc(item.code) + '" onclick="peReturnOpen(\'' + esc(item.code) + '\')">' + esc(item.code + ' ' + item.name) + '</button>'
      ].concat(taxColumns ? [money(item.amount_minor), money(item.tax_minor)] : [money(item.amount_minor != null ? item.amount_minor : item.tax_minor)]),
      widths
    )
  );
  const more = b.accounts_more_n
    ? '<div style="' + grey + ';padding:4px 0" data-testid="pr-more-' + esc(b.code) + '"><button type="button" style="background:none;border:0;padding:0;min-height:0;font:inherit;color:var(--link,#1a5f8a);cursor:pointer;text-align:left" onclick="peReturnOpen(null)">' + esc(txf('and {n} more', { n: b.accounts_more_n })) + ' ▸</button></div>'
    : '';
  return '<div data-testid="pr-ledgers-' + esc(b.code) + '">' + head + lines.join('') + more + '</div>';
}
/** a figure opens what it counts: the Ledgers page on that ledger, the period chip set to the return's period (the same ledger read the box was summed from) */
function peReturnOpen(code) {
  const r = PE_RET.r,
    P = r && r.period;
  if (!P) return;
  if (typeof BK !== 'undefined') {
    BK.backTo = { tab: 'gstclose', label: r.short || r.form, code: code == null ? null : String(code) }; /* ACC-357: the Ledgers head says Back to the BAS, and Back returns here */
    BK.lgp = { preset: 'custom', from: P.start, to: P.end };
    if (BK.lt && code != null) {
      BK.lt.sel = null;
      BK.lt.last = { code: String(code), party: null };
      if (typeof bkLtPrefsSave === 'function') bkLtPrefsSave();
    }
    if (code != null) BK.lgAcc = String(code);
  }
  if (typeof show === 'function') show('ledgers');
}
/** the boxes as one block of text for the portal: code · label · amount (· VAT), plain digits — what a shopkeeper pastes box by box */
function peReturnBlock(r) {
  const c = r.currency,
    P = r.period || {},
    lines = [(r.name || r.form) + ' · ' + (P.label || P.period || '') + (P.due ? ' · ' + tx('due') + ' ' + P.due : '')];
  (r.boxes || []).forEach((item) => {
    if (item.amount_minor == null && item.tax_minor == null) return;
    lines.push(
      [item.code, item.label, item.amount_minor == null ? '' : bkMinorText(item.amount_minor, c), item.tax_minor == null ? '' : bkMinorText(item.tax_minor, c)]
        .join('\t')
        .replace(/\t+$/, '')
    );
  });
  lines.push((r.net_minor < 0 ? tx('Refund due') : tx('To pay')) + '\t' + bkMinorText(Math.abs(r.net_minor || 0), c));
  lines.push(r.prepared + ' · ChitBridge');
  return lines.join('\n');
}
async function peReturnCopy(btn) {
  const r = PE_RET.r;
  if (!r) return;
  const text = (PE_RET.block = peReturnBlock(r)),
    n = (r.boxes || []).filter((item) => item.amount_minor != null || item.tax_minor != null).length;
  let done = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      done = true;
    }
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  if (!done) {
    try {
      const node = document.createElement('textarea');
      node.value = text;
      node.setAttribute('readonly', '');
      node.style.position = 'fixed';
      node.style.opacity = '0';
      document.body.appendChild(node);
      node.select();
      done = !!(document.execCommand && document.execCommand('copy'));
      document.body.removeChild(node);
    } catch (_) { /* cosmetic (focus/scroll): nothing to recover */ }
  }
  if (done) peOk('pr_out', esc(txf('Copied {n} boxes · paste them into the {who} portal', { n: n, who: r.authority })));
  else peBad('pr_out', tx('Could not copy — select the figures and copy by hand.'));
}

/* ═══ 5 · YEAR CLOSE ═══════════════════════════════════════════════════════════════════════════════════════════════════
   GET /year/:fy/status → { fiscal_year, closed, can_close, can_close_if_lodged, refusals: [{ name, why }], months: [{ period, status }], next } — what a close would say, nothing written
   POST /year/:fy/close { returns_lodged?: true } → { ok, next, locked, opening } · refused (422) with the refusals in plain words */
async function peYearView(body) {
  let L;
  try {
    L = await bkPeriodsLoad();
  } catch (e) {
    body.innerHTML = '<div class="pe-bad">' + bkErr(e) + '</div>';
    return;
  }
  const years = L.years.slice(),
    prev = peLastYear(years);
  body.innerHTML =
    '<div class="pe-card"><div class="pe-form">' +
    peField(
      'py_fy',
      'Financial year',
      peSel(
        'py_fy',
        years.map((y) => [y, y]),
        prev,
        ' onchange="peYearStatus()"'
      )
    ) +
    '</div></div><div id="py_res" data-testid="py-res"></div>';
  peYearStatus();
}
/** the page's fix for a failing check: where to go (the check's own sentence says what is wrong) */
function peYearFix(x) {
  const s = (x.name || '') + ' ' + (x.why || '');
  if (x.code === 'PERIOD_RETURN_OPEN' || x.name === 'return_open') return { label: txf('Open {name}', { name: peReturnName() }), tab: 'gstclose' }; /* ACC-204: the server's code first */
  if (/month|lock/i.test(s)) return { label: tx('Open Month lock'), tab: 'lock' };
  if (/suspense/i.test(s)) return { label: tx('Open the Day book'), tab: 'daybook' };
  if (/balance|trial/i.test(s)) return { label: tx('Open Trial balance'), tab: 'tb' };
  return null;
}
/** the checks of a year still open: every month locked, then each thing the server says stands in the way (each with the tab that fixes it), or that nothing else does */
function peYearChecksHtml(year, months, refs) {
  const open = months.filter((item) => item.status === 'open').length;
  let html = '';
  const notLocked = open + Math.max(0, 12 - months.length);
  html +=
    '<div class="pe-check ' +
    (notLocked ? 'bad' : 'ok') +
    '" data-testid="py-months"><span>' +
    (notLocked ? '✗' : '✓') +
    '</span><span>' +
    esc(notLocked ? txf('{n} of 12 months are not locked yet', { n: notLocked }) : tx('Every month is locked')) +
    '</span>' +
    (notLocked
      ? '<button data-cbsid="BKS016-B07" type="button" class="pe-fix" data-testid="py-fix-months" onclick="show(\'lock\')">' + esc(tx('Open Month lock')) + '</button>'
      : '') +
    '</div>';
  html += refs
    .map((x, index) => {
      const f = peYearFix(x);
      return (
        '<div class="pe-check bad" data-testid="py-check-' +
        index +
        '"><span>✗</span><span>' +
        esc(x.why) +
        '</span>' +
        (f ? '<button data-cbsid="BKS016-B08" type="button" class="pe-fix" data-testid="py-fix-' + index + '" onclick="show(\'' + f.tab + '\')">' + esc(f.label) + '</button>' : '') +
        '</div>'
      );
    })
    .join('');
  if (!refs.length) html += '<div class="pe-check ok" data-testid="py-rest"><span>✓</span><span>' + esc(tx('Nothing else stands in the way')) + '</span></div>';
  return html;
}
/** under the checks: the lodged tick (owner, when the server allows closing once lodged), Close the year (owner), or why a non-owner cannot */
function peYearActionsHtml(yearState) {
  let html = '';
  if (!yearState.closed && peOwner() && yearState.can_close_if_lodged) html += peYearLodgedTick();
  if (!yearState.closed && peOwner())
    html +=
      '<div class="supacts">' +
      '<button data-cbsid="BKS016-B09" type="button" class="supact-pri" data-testid="py-close"' +
      (yearState.can_close ? '' : ' disabled') +
      ' onclick="peYearClose(this)">' +
      esc(tx('Close the year')) +
      '</button></div>';
  if (!yearState.closed && !peOwner()) html += peNote('pe-readonly', 'Only the owner can close the year');
  return html;
}
async function peYearStatus() {
  const fy = peVal('py_fy'),
    host = peEl('py_res');
  if (!host) return;
  host.innerHTML = '<div class="loadwrap"><span class="spin"></span> ' + esc(tx('Reading…')) + '</div>';
  let st;
  try {
    st = (await api('perYearStatus', { params: { fy } })) || {};
  } catch (e) {
    const w = peWhy(e, tx('Could not be read'));
    host.innerHTML = '<div class="' + (w.calm ? 'pe-calm' : 'pe-bad') + '" data-testid="pe-refused">' + (w.calm ? '⏳ ' : '') + esc(w.text) + '</div>';
    return;
  }
  PE.year = st;
  const months = st.months || [],
    refs = st.refusals || [];
  let h = '<div class="pe-card" data-testid="py-checks">';
  if (st.closed) h += '<div class="pe-ok" data-testid="py-closed">✓ ' + esc(txf('{fy} is closed for good', { fy })) + '</div>';
  else h += peYearChecksHtml(st, months, refs);
  h += '</div>';
  h += peYearActionsHtml(st);
  h += '<div id="py_out" class="pe-slot"></div>';
  host.innerHTML = h;
}
/* PAST-YEARS: the server says can_close_if_lodged when only the returns stand in the way. PRODUCT POLICY, NOT LAW: ChitBridge takes the owner's word that the returns were lodged outside it
   (an older year the shop moved in with); it records the sentence and posts nothing. Shown only when the server says so; the owner ticks it and the button wakes. */
function peYearLodgedTick() {
  return (
    '<div class="pe-card" data-testid="py-lodged-card"><label class="pe-check" style="cursor:pointer"><input data-cbsid="BKS016-I02" type="checkbox" data-testid="py-lodged" onchange="peYearLodged(this)"> <span>' +
    esc(tx('I lodged these returns outside ChitBridge')) +
    '</span></label><div class="pe-note" data-testid="py-lodged-why">' +
    esc(tx('The year stays shut until you say so. ChitBridge keeps your word on each month and posts nothing.')) +
    '</div></div>'
  );
}
/** the tick wakes or greys Close the year (the server still decides) */
function peYearLodged(box) {
  const btn = document.querySelector('[data-testid="py-close"]');
  if (btn) btn.disabled = !box.checked;
}
function peYearClose(btn) {
  const fy = peVal('py_fy'),
    tick = document.querySelector('[data-testid="py-lodged"]'),
    lodged = !!(tick && tick.checked && PE.year && PE.year.can_close_if_lodged);
  confirmAsk(
    tx('Close the year?'),
    esc(lodged ? txf('{fy} is carried forward and locked for good, with its returns marked as lodged outside ChitBridge. This cannot be undone.', { fy }) : txf('{fy} is carried forward and locked for good. This cannot be undone.', { fy })),
    tx('Close the year'),
    () => {
      bkOnce('pe-year-' + fy, btn, async () => {
        try {
          const r = (await api('perYearClose', { params: { fy }, body: lodged ? { returns_lodged: true } : {} })) || {};
          peOk('py_out', esc(txf('{fy} closed · carried to {next}', { fy, next: r.next || '' })));
          const node = document.querySelector('[data-testid="py-close"]');
          if (node) node.remove();
        } catch (e) {
          peBad('py_out', e);
        }
      });
    },
    true
  );
}
