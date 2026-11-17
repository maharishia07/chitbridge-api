/* cap-entry.js — ＋ ENTRY on the Day book: what happened → with whom / what → how much, when, on what paper → check and save.
 * Contract: docs/design/manual-entry/REQUIREMENT.md; the server's shapes: chitbridge-api routes/books.js (GET /events · POST /preview · POST /events · POST /entries/:id/reverse) and lib/books-manual.js. Loaded by accounts.html after cap-books.js and by finance.html; the Day book offers the ＋ only when
 * enOpen exists (cap-books.js bkDvHead), and offers Reverse on a row through CBList's own `actions`.
 *
 * ⭐ THE PAGE HOLDS NO RULES AND COMPUTES NO MONEY. The events, their words, icons, fields and save routes are GET /api/books/events;
 * the journal (lines, each line's type and the golden rule that placed it, the voucher, balanced or not, every refusal and warning with
 * its fix) is POST /api/books/preview. This file asks, shows what the server said, and enables Save only when the server said
 * `balanced` and refused nothing. A typed amount is parsed to minor units (bkToMinor) and sent; no figure is ever added up here.
 * ⭐ One tap, one record: the sheet carries ONE client_ref from the moment it opens (bkRef), the Save button is dead while its call is out
 * (bkOnce) — the same two halves cap-books.js uses for payments.
 * ⭐ Never "accounting" on a screen. Insert-only: a saved entry is never edited — Reverse adds the mirror.
 * Look: the chit sheet's own popup (a <dialog>, same tokens), the Day book's own line rows (CBList.nextRow). No new style of list.
 *
 * OWNS       the ＋ Entry sheet: the event tiles, the step fields, the journal preview, Save and Reverse (enOpen · enPick · enNext · enBack · enSet ·
 *             enPreview · enSave · enSaveWrite · enPaintSaved · enReverse · enClose). It owns no rule and no figure: the server's events and preview answer.
 * CALLED BY  public/accounts.html and public/finance.html (a <script> tag each; grep -n 'cap-entry' public/*.html) · cap-books.js (the Day book's ＋ Entry door, enOpen near line 2645) · cap-bank.js (enOpen from a bank line, near line 947) ·
 *            cap-finance-pay.js (a debit note is opened through enOpen with a preset, near line 413).
 * FLOW       enOpen(preset) → GET /api/books/events → tiles → enPick(event) → fields (enSet) → enNext → enPreview (POST /preview) → enSave →
 *            enSaveWrite (POST /events, one client_ref) → enPaintSaved → enReverse (POST /entries/:id/reverse) → enClose.
 * IDS        every control carries its register code (data-cbsid, UX-137): SCR022 (Inside a screen › Entry), whichever page opens the sheet; Back wears CMP006.
 * CARD      14-accounting/ledger-accounts-day-book-entries-reverse
 */
'use strict';
if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    booksEvents: { m: 'GET', p: '/api/books/events' },
    booksPreview: { m: 'POST', p: '/api/books/preview' },
    booksEventPost: { m: 'POST', p: '/api/books/events' } /* ONE save door for every event (the server's own composition); `event` names which */,
    booksReverse: { m: 'POST', p: '/api/books/entries/:id/reverse' }, booksActionPrepare: { m: 'POST', p: '/api/books-actions', idem: 'attempt' } /* ACC-176b: an adviser PREPARES, or posts under adviser_posts */
  });
}

/* the server names a band, an icon and a pick; the page only gives them words and a glyph (display, never a rule) */
var EN_BAND = { paid: 'Paid', received: 'Received', owner: 'The owner', staff: 'Staff', money: 'Money moves', adjust: 'Your own journal', bought: 'Bought' };
var EN_ICON = { receipt: '🧾', 'receipt-minus': '🧾', coins: '🪙', 'wallet-in': '👛', 'wallet-out': '💸', 'person-out': '🧑', 'person-in': '🧑', swap: '🔁', pen: '✍️' };
/* R106: an event whose Save is a money promise asks first (CBAction.ask), naming the party and the server's ₹ — by the event's kind, the server's own code */
var EN_ASK = { debit_note: { title: 'Note {amt} against the bill?', body: 'A debit note posts against the bill. What you owe {who} falls by {amt}.', yes: 'Note it' } };
var EN_ITEM = { name: 'Item', qty: 'Qty', unit_price: 'Rate difference', gst_rate: 'Tax %' };
/* a payment mode in words: the pack's raw keys (eft, bpay, payid, eftpos…) never show as typed */
var EN_MODE = { cash: 'Cash', bank: 'Bank', upi: 'UPI', card: 'Card', eft: 'EFT', bpay: 'BPAY', payid: 'PayID', eftpos: 'EFTPOS', cheque: 'Cheque', transfer: 'Bank transfer', neft: 'NEFT', imps: 'IMPS', rtgs: 'RTGS', paynow: 'PayNow', nets: 'NETS', duitnow: 'DuitNow', fpx: 'FPX', paypay: 'PayPay', ic: 'IC card' };
var EN_LABEL = {
  class: 'What for',
  paid_from: 'Paid from',
  into: 'Came into',
  from: 'Taken from',
  to: 'Put into',
  ledger: 'Which staff ledger',
  amount: 'How much',
  date: 'Date',
  narration: 'Note',
  supplier: 'Supplier',
  against_ref: 'Which bill',
  reason: 'Why',
  lines: 'What differs'
};
var EN = {
  step: 1,
  events: null,
  ev: null,
  v: {},
  lines: [],
  items: [] /* R106: the typed item lines of a non-journal event (a debit note: name · qty · rate difference · tax %) — sent as typed, taxed by the server */,
  after: null /* R106: what the opener wants done after a save (Payables reads again) */,
  pv: null,
  pvBusy: false,
  dateRef: null,
  ref: null,
  saved: null,
  err: null,
  denied: false,
  photo: null,
  rev: {},
  seq: 0
};
/* the four kinds of "who / what" field live on step 2; the rest are step 3 — a layout choice, never a rule of the books. A field may name its own step. */
var EN_STEP2 = { party: 1, ledger: 1, bank: 1, asset_class: 1, loan: 1, lines: 1, choice: 1 };

/** add the entry sheet's stylesheet to the page once */
function enCss() {
  if (document.getElementById('en_css')) return;
  var node = document.createElement('style');
  node.id = 'en_css';
  node.textContent =
    '#entrysheet{border:0;padding:0;margin:auto;width:min(620px,100vw);max-width:100vw;height:min(760px,94dvh);border-radius:14px;background:var(--card,#fff);color:var(--ink,#0F2E3D);box-shadow:var(--shadow,0 12px 34px rgba(15,46,61,.2));overflow:hidden}' +
    '#entrysheet[open]{display:flex;flex-direction:column}#entrysheet::backdrop{background:rgba(15,46,61,.45)}' +
    '#entrysheet .en-top{display:flex;align-items:center;gap:6px;padding:6px 6px 6px 14px;border-bottom:1px solid var(--line,#E7E2D8);font-size:var(--fs-3,14px);font-weight:700}#entrysheet .en-top span{flex:1}' +
    '#entrysheet .en-top button{cursor:pointer;min-width:44px;min-height:44px;border:0;background:none;font-size:var(--fs-4,16px);color:inherit}' +
    '#entrysheet .en-body{padding:12px 14px;overflow:auto;flex:1;min-height:0;overscroll-behavior:contain;font-size:var(--fs-2,12.5px)}' +
    '#entrysheet .en-dots{display:flex;gap:6px;padding:8px 14px 0}#entrysheet .en-dots i{flex:1;height:4px;border-radius:2px;background:var(--line,#E7E2D8)}#entrysheet .en-dots i.on{background:var(--ink,#0F2E3D)}' +
    '#entrysheet h3{margin:4px 0 10px;font-size:var(--fs-4,16px)}#entrysheet .en-sec{margin:12px 0 6px;font-size:var(--fs-1,11px);font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--grey,#494F56)}' +
    '#entrysheet .en-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}' +
    '#entrysheet .en-tile{cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:84px;padding:8px 6px;border:1px solid var(--line,#E7E2D8);border-radius:12px;background:var(--card,#fff);color:inherit;font:inherit;font-weight:600;text-align:center}' +
    '#entrysheet .en-tile .ic{font-size:26px;line-height:1}#entrysheet .en-tile:hover,#entrysheet .en-tile:focus-visible{background:var(--gold-soft,#F7F1E4)}' +
    '#entrysheet label.en-f{display:block;margin:0 0 12px;font-weight:600}#entrysheet label.en-f>span{display:block;margin-bottom:4px;color:var(--grey,#494F56);font-size:var(--fs-1,11px)}' +
    '#entrysheet .en-f input,#entrysheet .en-f select,#entrysheet .en-ln input,#entrysheet .en-ln select{width:100%;box-sizing:border-box;min-height:44px;padding:0 10px;border:1px solid var(--line,#E7E2D8);border-radius:9px;background:var(--card,#fff);color:inherit;font:inherit}' +
    '#entrysheet .en-ln{display:grid;grid-template-columns:minmax(0,1fr) 84px minmax(0,132px) 44px;gap:6px;margin-bottom:8px}' +
    '#entrysheet .en-ln.en-item{grid-template-columns:minmax(0,1.5fr) 64px minmax(0,104px) 64px 44px}@media (max-width:420px){#entrysheet .en-ln.en-item{grid-template-columns:minmax(0,1fr) 56px 84px 56px 44px}}' /* R106: item lines — item · qty · rate difference · tax % · remove */ +
    '#entrysheet .en-bad{margin:6px 0 12px;padding:8px 10px;border:1px solid var(--red-b,#E8B7A6);background:var(--red-t,#FBEDE8);color:var(--red-i,#8E3517);border-radius:8px}' +
    '#entrysheet .en-warn{margin:6px 0 12px;padding:8px 10px;border:1px solid var(--gold-line,#E8D9BC);background:var(--gold-soft,#F7F1E4);border-radius:8px}' +
    '#entrysheet .en-bad button,#entrysheet .en-warn button{cursor:pointer;display:block;margin-top:6px;min-height:44px;padding:0 14px;border:1px solid currentColor;border-radius:9px;background:none;color:inherit;font:inherit;font-weight:700}' +
    '#entrysheet .en-chip{display:inline-block;border:1px solid var(--line,#E7E2D8);border-radius:99px;padding:1px 8px;font-size:var(--fs-1,11px);font-weight:600}' +
    '#entrysheet .en-why{color:var(--grey,#494F56);font-size:var(--fs-1,11px);padding:0 0 8px;border-bottom:1px dashed var(--line,#E7E2D8)}' +
    '#entrysheet .en-ok{color:var(--ok,#27794c);font-weight:700}' +
    '#entrysheet .en-acts{display:flex;gap:8px;justify-content:space-between;padding:8px 14px calc(8px + env(safe-area-inset-bottom));border-top:1px solid var(--line,#E7E2D8);background:var(--paper,#FAF8F4)}' +
    '#entrysheet .en-btn{cursor:pointer;min-height:44px;padding:0 18px;border:1px solid var(--line,#E7E2D8);border-radius:9px;background:transparent;color:inherit;font:inherit;font-weight:700}' +
    '#entrysheet .en-btn.pri{background:var(--green,#16693F);border-color:var(--green,#16693F);color:#fff}#entrysheet .en-btn:disabled{opacity:.45;cursor:default}';
  document.head.appendChild(node);
}
/** the entry sheet's <dialog>, created on first use */
function enDlg() {
  var node = document.getElementById('entrysheet');
  if (node) return node;
  enCss();
  node = document.createElement('dialog');
  node.setAttribute('data-pop', 'POP120');
  node.id = 'entrysheet';
  node.setAttribute('aria-label', tx('New entry'));
  node.innerHTML =
    '<div class="en-top"><span data-testid="en-title"></span><button data-cbsid="CMP005" type="button" data-testid="en-close" aria-label="' +
    esc(tx('Close')) +
    '" onclick="enClose()">✕</button></div><div class="en-dots" id="en_dots"></div><div class="en-body" id="en_body"></div><div class="en-acts" id="en_acts"></div>';
  node.addEventListener('close', function () {
    try {
      document.documentElement.style.overflow = '';
    } catch (failure) {
      if (typeof cbQuiet === 'function') cbQuiet('entry: the page scroll was not restored', failure); /* best effort: nothing the person sees changes */
    }
  });
  node.addEventListener('click', function (e) {
    if (e.target === node) enClose();
  });
  document.body.appendChild(node);
  return node;
}
function enClose() {
  var node = document.getElementById('entrysheet');
  if (node && node.open) node.close();
  try {
    document.documentElement.style.overflow = '';
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
}

/* ── the one door ── */
/** enOpen() opens the sheet at "What happened?". enOpen({ kind, v, ref }) opens it with an entry already suggested (Bank → "Add missing"): kind = the event, v = its
 *  answers (date · amount · class · paid_from …), ref = the client_ref the entry will carry. A suggestion with a kind goes straight to the server's preview; the person
 *  still presses Save. One without a kind keeps what it knows (date, amount, note) and asks "What happened?". */
async function enOpen(preset) {
  var node = enDlg();
  EN.step = 1;
  EN.ev = null;
  EN.v = {};
  EN.lines = [];
  EN.pv = null;
  EN.dateRef = null;
  EN.saved = null;
  EN.err = null;
  EN.denied = false;
  EN.photo = null;
  EN.ref = (preset && preset.ref) || bkRef();
  EN.pre = (preset && preset.v) || null;
  EN.after = enAfterOf(preset);
  EN.items = [];
  enPaint();
  try {
    document.documentElement.style.overflow = 'hidden';
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  if (!node.open) {
    if (node.showModal) { node.setAttribute('data-pop', 'POP120'); node.showModal(); }
    else node.setAttribute('open', '');
  }
  try {
    var rr = await Promise.all([
      api('booksEvents'),
      api('booksAccounts').catch(function () {
        return { accounts: [] };
      }),
      typeof booksDuesLoad === 'function' ? booksDuesLoad(false).catch(function () {}) : null
    ]);
    EN.picks = (rr[0] && rr[0].picks) || {};
    EN.accounts = (rr[1] && rr[1].accounts) || [];
    /* the events that POST /events can preview and save; the ones with a route of their own (asset, loan …) are not offered on this sheet */
    EN.events = ((rr[0] && rr[0].events) || [])
      .filter(function (e) {
        return e.preview !== false && !e.route;
      })
      .map(enNorm);
    if (
      preset &&
      preset.kind &&
      EN.events.some(function (e) {
        return e.id === preset.kind;
      })
    ) {
      enPresetStart(preset.kind);
      return;
    }
  } catch (e) {
    if (e && (e.status === 403 || /not allowed|forbidden|403/i.test(String(e.message)))) EN.denied = true;
    else EN.err = bkWhy(e, tx('Could not be read'));
  }
  enPaint();
}

/** what the opener wants done after a save (R106: Payables reads again), or nothing */
function enAfterOf(preset) {
  return preset && typeof preset.after === 'function' ? preset.after : null;
}
/** a suggestion with a kind: picked, then (R106) the first step still to answer — a debit note's lines — or the server's preview when everything is answered */
function enPresetStart(kind) {
  enPick(kind);
  var gapStep = enSteps().filter(function (step) {
    return step > 1 && step < 4 && !enStepReady(step);
  })[0];
  EN.step = gapStep || 4;
  enPaint();
  if (!gapStep) enPreview();
}
/** the server's event → the page's: id = kind, label = words, group = its band's words, icon = a glyph for the server's icon name */
function enNorm(e) {
  return Object.assign({}, e, {
    id: e.kind,
    label: e.words || e.label || e.kind,
    group: EN_BAND[e.band] || e.group || '',
    icon: EN_ICON[e.icon] || e.icon || '＋',
    fields: e.fields || []
  });
}
/** a field's kind as the page lays it out: pick → ledger / mode / class by what the server says it picks */
function enKind(f) {
  return f.kind === 'pick' ? (f.pick === 'ledger' ? 'ledger' : 'pick') : f.kind;
}

/* ── paint ── */
function enSteps() {
  return EN.ev && enFields(2).length === 0 ? [1, 3, 4] : [1, 2, 3, 4];
}
function enFields(step) {
  if (!EN.ev) return [];
  return (EN.ev.fields || [])
    .map(function (item) {
      return typeof item === 'string' ? { key: item, kind: item } : item;
    })
    .filter(function (item) {
      return (item.step ? Number(item.step) : EN_STEP2[enKind(item)] || (item.kind === 'pick' && item.pick !== 'mode') ? 2 : 3) === step;
    });
}
function enStepWord(n) {
  return {
    1: 'What happened?',
    2: EN.ev && EN.ev.kind === 'journal' ? 'Which lines?' : 'With whom / what?',
    3: EN.ev && EN.ev.kind === 'journal' ? 'When, on what paper?' : 'How much, when, on what paper?',
    4: 'Check and save'
  }[n];
}
/** paint the sheet for the current step: title, body, step dots and buttons */
function enPaint() {
  var body = document.getElementById('en_body'),
    acts = document.getElementById('en_acts'),
    dots = document.getElementById('en_dots');
  if (!body) return;
  var node = document.querySelector('#entrysheet [data-testid="en-title"]');
  if (node) node.textContent = EN.saved ? tx('Saved') : EN.ev ? tx(EN.ev.label) : tx('New entry');
  var order = enSteps();
  dots.innerHTML =
    EN.saved || EN.denied
      ? ''
      : order
          .map(function (item) {
            return '<i class="' + (item <= EN.step ? 'on' : '') + '"></i>';
          })
          .join('');
  if (EN.denied) {
    body.innerHTML =
      '<div class="en-warn" data-testid="en-denied">' +
      esc(tx('Only the owner and co-assists the owner has allowed can add entries. You can read everything.')) +
      '</div>';
    acts.innerHTML = '<button data-cbsid="CMP005" class="en-btn" onclick="enClose()">' + esc(tx('Close')) + '</button>';
    return;
  }
  if (EN.err) {
    body.innerHTML =
      '<div class="en-bad" data-testid="en-err">' +
      esc(EN.err) +
      '<button data-cbsid="CMP009" type="button" data-testid="en-retry" onclick="enOpen()">' +
      esc(tx('Try again')) +
      '</button></div>';
    acts.innerHTML = '';
    return;
  }
  if (!EN.events) {
    body.innerHTML = '<div class="loadwrap"><span class="spin"></span> ' + esc(tx('Reading…')) + '</div>';
    acts.innerHTML = '';
    return;
  }
  if (EN.saved) return enPaintSaved(body, acts);
  var h = '<h3 data-testid="en-step-' + EN.step + '">' + esc(tx(enStepWord(EN.step))) + '</h3>';
  if (EN.step === 1) {
    body.innerHTML = h + enGridHTML();
    acts.innerHTML = '<button data-cbsid="CMP003" class="en-btn" onclick="enClose()">' + esc(tx('Cancel')) + '</button>';
    return;
  }
  if (EN.step === 4) {
    body.innerHTML = h + enPreviewHTML();
  } else body.innerHTML = h + enFormHTML(EN.step);
  enActs();
}
/** the button row: Back / Next, and Save only when enCanSave says the server allowed it (step 4) */
function enActs() {
  var acts = document.getElementById('en_acts'),
    last = EN.step === 4,
    can = enCanSave();
  acts.innerHTML =
    '<button data-cbsid="CMP006" data-cbmount="SCR022-U106" class="en-btn" data-testid="en-back" onclick="enBack()">‹ ' +
    esc(tx('Back')) +
    '</button>' +
    (last
      ? '<button data-cbsid="CMP001" class="en-btn pri" data-testid="en-save" id="en_save" onclick="enSave(this)"' + (can ? '' : ' disabled') + '>' + esc(tx(enActingAdviser() ? (CBBooksActing.posts() ? 'Post' : 'Prepare') : 'Save')) + '</button>'
      : '<button data-cbsid="SCR022-B01" class="en-btn pri" data-testid="en-next" id="en_next" onclick="enNext()"' +
        (enStepReady(EN.step) ? '' : ' disabled') +
        '>' +
        esc(tx('Next')) +
        ' ›</button>');
}
/* Save is on only when the SERVER said the journal balances and refused nothing — the page never works that out itself */
function enCanSave() {
  var pv = EN.pv;
  return !!(pv && pv.balanced === true && !(pv.refusals || []).length && !EN.pvBusy && !EN.saving);
}
/** step 1: the events the server offers, grouped, as a grid of buttons */
function enGridHTML() {
  var groups = [],
    by = {};
  EN.events.forEach(function (item) {
    var g = item.group || '';
    if (!by[g]) {
      by[g] = [];
      groups.push(g);
    }
    by[g].push(item);
  });
  if (
    !EN.events.some(function (e) {
      return e.kind === 'journal';
    })
  ) {
    if (!by['']) {
      by[''] = [];
      groups.push('');
    }
    by[''].push(enJournalEv());
  }
  /* the journal tile is the LAST tile, wherever the server listed it */
  var last = null;
  groups.forEach(function (item) {
    by[item] = by[item].filter(function (e) {
      if (e.kind === 'journal') {
        last = e;
        return false;
      }
      return true;
    });
  });
  return groups
    .map(function (item, index) {
      var tiles = by[item].concat(index === groups.length - 1 && last ? [last] : []);
      return (
        '<div class="en-sec">' +
        esc(item ? tx(item) : tx('Your own journal')) +
        '</div>' +
        '<div class="en-grid">' +
        tiles
          .map(function (entry) {
            return (
              '<button data-cbsid="SCR022-B02" type="button" class="en-tile" data-testid="en-event-' +
              esc(entry.id) +
              '" onclick="enPick(\'' +
              esc(entry.id) +
              '\')"><span class="ic" aria-hidden="true">' +
              esc(entry.icon || '＋') +
              '</span><span>' +
              esc(tx(entry.label)) +
              '</span></button>'
            );
          })
          .join('') +
        '</div>'
      );
    })
    .join('');
}
/* the free journal is the one tile the page may supply itself when the server's list has none: its fields are the CA's own (lines, date, paper, note) */
function enJournalEv() {
  return {
    id: 'journal',
    kind: 'journal',
    icon: '✍️',
    label: 'Write a journal',
    fields: [
      { key: 'lines', kind: 'lines', required: true },
      { key: 'narration', kind: 'text', required: true },
      { key: 'date', kind: 'date' }
    ]
  };
}
/** choose an event (or the free journal) and start its first step */
function enPick(id) {
  var ev = EN.events.filter(function (e) {
    return e.id === id;
  })[0];
  if (!ev && id === 'journal') ev = enJournalEv();
  if (!ev) return;
  EN.ev = ev;
  EN.v = Object.assign({ date: bkToday() }, EN.pre || {});
  EN.pv = null;
  EN.dateRef = null;
  EN.photo = null;
  if (ev.kind === 'journal')
    EN.lines = [
      { code: '', side: 'dr', amt: '' },
      { code: '', side: 'cr', amt: '' }
    ];
  /* R106: an event with item lines (a debit note) starts with one empty line */
  EN.items = (ev.fields || []).some(function (field) {
    return field && field.kind === 'lines' && ev.kind !== 'journal';
  })
    ? [enItemNew()]
    : [];
  EN.step = enSteps()[1];
  enPaint();
}
function enBack() {
  var o = enSteps(),
    i = o.indexOf(EN.step);
  EN.step = i > 0 ? o[i - 1] : 1;
  EN.pv = null;
  enPaint();
}
function enNext() {
  var o = enSteps(),
    i = o.indexOf(EN.step);
  if (!enStepReady(EN.step) || i < 0) return;
  EN.step = o[i + 1];
  enPaint();
  if (EN.step === 4) enPreview();
}

/* ── the fields ── */
function enOptions(f) {
  /* R106: the server's `pick: 'supplier'` / `'customer'` (books-manual debit_note) is the party list of that side — the one /dues read, as kind party */
  if (f.kind === 'pick' && (f.pick === 'supplier' || f.pick === 'customer')) return enOptions({ kind: 'party', side: f.pick });
  if (f.kind === 'pick' && f.pick !== 'ledger' && !(f.options && f.options.length))
    return ((EN.picks || {})[f.pick] || []).map(function (item) {
      return { v: item.role || item.code, l: item.name };
    });
  if (f.options && f.options.length)
    return f.options
      .map(function (item) {
        return typeof item === 'object' ? item : { v: item, l: tx(EN_MODE[item] || item) };
      })
      .map(function (item) {
        return { v: item.v != null ? item.v : item.code, l: item.l || item.label || item.name || item.v };
      });
  if (f.kind === 'party') {
    /* the one /dues read the whole page shares (cap-books.js booksDuesLoad → BK.dues, party_id → party) */
    var list = Object.keys(BK.dues || {}).map(function (item) {
      return BK.dues[item];
    });
    return list
      .filter(function (item) {
        return !f.side || item.side === f.side;
      })
      .map(function (item) {
        return { v: item.party_id, l: bkPartyLabel(item.party_id, item.name) };
      });
  }
  return [];
}
/** a ledger the shop added itself (the chart carries no role on it) — the server still refuses one outside Loans and advances, in words */
function enShopLedger(code) {
  var a = (EN.accounts || []).filter(function (x) {
    return String(x.code) === String(code);
  })[0];
  return !!a && !a.role;
}
/** a ledger-account select built from the books accounts, banded and optionally limited to one group; testid (optional) is drawn on the select itself */
function enLedgerSelect(id, cur, onch, onlyGroup, testid) {
  var bands = bkLtModel(EN.accounts || []),
    h = '<option value="">' + esc(tx('Choose…')) + '</option>';
  bands.forEach(function (item) {
    var list = item.groups.filter(function (entry) {
      return !onlyGroup || entry.title === onlyGroup;
    });
    var inner = '',
      own = onlyGroup === 'Stock & advances';
    list.forEach(function (entry) {
      entry.accts.forEach(function (element) {
        if (own && !enShopLedger(element.code)) return;
        inner +=
          '<option value="' +
          esc(element.code) +
          '"' +
          (element.code === cur ? ' selected' : '') +
          '>' +
          esc(element.code + ' · ' + element.name) +
          '</option>';
      });
    });
    if (inner) h += '<optgroup label="' + esc(tx(item.title)) + '">' + inner + '</optgroup>';
  });
  return '<select data-cbsid="SCR022-S01"' + (testid ? ' data-testid="' + testid + '"' : '') + ' id="' + id + '" onchange="' + onch + '">' + h + '</select>';
}
/** the shop's OWN cash and bank ledgers (the ones money moves between): [{ v, l }], v the ledger's payment mode when it has one, else its code (the server's contra takes either) */
function enOwnOptions() {
  var all = (EN.accounts || []).filter(function (a) {
      return !a.is_group && a.active !== false;
    }),
    homes = {};
  all.forEach(function (a) {
    if (/^(cash|bank|upi|card)$/.test(a.role || '')) homes[a.parent_code] = true;
  });
  return all
    .filter(function (a) {
      return /^(cash|bank|upi|card)$/.test(a.role || '') || homes[a.parent_code];
    })
    .map(function (a) {
      return { v: /^(cash|bank|upi|card)$/.test(a.role || '') ? a.role : String(a.code), l: a.name };
    });
}
/** Move money: "Taken from" / "Put into" name the business's own accounts, with the one inline door to add a savings account (the same POST /accounts the chart uses) */
function enOwnField(k, lab, tid, v, on) {
  var opened = EN.addOwn === k,
    box = opened
      ? '<span class="en-addown" data-testid="en-addown"><input data-testid="en-addown-name" id="en_addown_name" maxlength="60" placeholder="' + esc(tx('Name, e.g. Savings account')) + '" value="' + esc(EN.addOwnName || '') + '" oninput="EN.addOwnName=this.value"> <button type="button" class="en-btn pri" data-testid="en-addown-go" onclick="enOwnAdd(this.dataset.k)" data-k="' + esc(k) + '">' + esc(tx('Add account')) + '</button> <button type="button" class="en-btn" onclick="EN.addOwn=null;enPaint()">' + esc(tx('Cancel')) + '</button></span>' + (EN.addOwnErr ? '<span class="en-bad" role="alert">' + esc(EN.addOwnErr) + '</span>' : '')
      : '<button type="button" class="en-btn" data-testid="en-addown-open" data-k="' + esc(k) + '" onclick="EN.addOwn=this.dataset.k;EN.addOwnErr=&quot;&quot;;enPaint()">+ ' + esc(tx('Add a savings account')) + '</button>';
  return '<label class="en-f"><span>' + esc(lab) + '</span>' + enSelect(tid, enOwnOptions(), v, on) + '</label>' + box;
}
/** add the account under the shop's bank group, read the accounts again, and put it in the field that asked */
async function enOwnAdd(k) {
  var name = String(EN.addOwnName || '').trim(),
    main = (EN.accounts || []).filter(function (a) {
      return a.role === 'bank';
    })[0];
  if (!name) {
    EN.addOwnErr = tx('Type a name');
    return enPaint();
  }
  try {
    var made = await api('booksAccountAdd', { body: { name: name, parent_code: main ? main.parent_code : undefined } });
    var again = await api('booksAccounts');
    EN.accounts = (again && again.accounts) || EN.accounts;
    EN.v[k] = String((made && made.account && made.account.code) || '');
    EN.pv = null;
    EN.addOwn = null;
    EN.addOwnName = '';
    EN.addOwnErr = '';
  } catch (e) {
    EN.addOwnErr = bkWhy(e, tx('Could not add it'));
  }
  enPaint();
}
/** the HTML of one field of the current step, by its kind (date, amount, party, ledger, lines, photo, narration…) */
function enFieldHTML(f) {
  var k = f.key,
    v = enValueOf(k),
    lab = enFieldLabel(f),
    tid = 'en-f-' + k;
  var wrap = function (inner) {
    return '<label class="en-f"><span>' + esc(lab) + '</span>' + inner + '</label>';
  };
  var on = "enSet('" + esc(k) + "',this.value)";
  if (EN.ev && EN.ev.kind === 'contra' && (k === 'from' || k === 'to')) return enOwnField(k, lab, tid, v, on);
  if (f.kind === 'pick' && f.pick === 'ledger')
    return (
      '<label class="en-f"><span>' +
      esc(lab) +
      '</span>' +
      enLedgerSelect(tid, v, on, 'Stock & advances', tid) +
      '</label>'
    );
  if (f.kind === 'pick') return wrap(enSelect(tid, enOptions(f), v, on));
  if (f.kind === 'ledger')
    return (
      '<label class="en-f"><span>' + esc(lab) + '</span>' + enLedgerSelect(tid, v, on, undefined, tid) + '</label>'
    );
  if (f.kind === 'bank')
    return (
      '<label class="en-f"><span>' +
      esc(lab) +
      '</span>' +
      (enOptions(f).length
        ? enSelect(tid, enOptions(f), v, on)
        : enLedgerSelect(tid, v, on, 'Cash & bank', tid)) +
      '</label>'
    );
  if (f.kind === 'party' || f.kind === 'asset_class' || f.kind === 'loan' || f.kind === 'choice') {
    var o = enOptions(f);
    return o.length ? wrap(enSelect(tid, o, v, on)) : wrap('<input data-cbsid="SCR022-I01" data-testid="' + tid + '" value="' + esc(v) + '" oninput="' + on + '">');
  }
  if (f.kind === 'amount') return wrap(bkMoneyInput({ id: tid, text: v == null ? '' : String(v), on: on, extra: 'onchange="enCheckDate()"' }));
  if (f.kind === 'date')
    return (
      wrap('<input data-cbsid="SCR022-I02" data-testid="' + tid + '" type="date" value="' + esc(v) + '" onchange="enSet(\'date\',this.value);enCheckDate()">') +
      '<div id="en_dateref">' +
      enRefusalHTML(EN.dateRef) +
      '</div>'
    );
  if (f.kind === 'paid_by') {
    var m =
      f.options && f.options.length
        ? enOptions(f)
        : [
            { v: 'cash', l: tx('Cash') },
            { v: 'bank', l: tx('Bank') },
            { v: 'upi', l: tx('UPI') },
            { v: 'cheque', l: tx('Cheque') }
          ];
    return (
      wrap(enSelect(tid, m, v, "enSet('paid_by',this.value);enPaintKeep()")) +
      (v === 'cheque'
        ? '<label class="en-f"><span>' +
          esc(tx('Cheque no.')) +
          '</span><input data-cbsid="SCR022-I03" data-testid="en-f-cheque_no" value="' +
          esc(EN.v.cheque_no || '') +
          '" oninput="enSet(\'cheque_no\',this.value)"></label><label class="en-f"><span>' +
          esc(tx('Cheque date')) +
          '</span><input data-cbsid="SCR022-I04" data-testid="en-f-cheque_date" type="date" value="' +
          esc(EN.v.cheque_date || '') +
          '" onchange="enSet(\'cheque_date\',this.value)"></label>'
        : '')
    );
  }
  if (f.kind === 'photo')
    return (
      wrap('<input data-cbsid="SCR022-I05" data-testid="' + tid + '" type="file" accept="image/*,application/pdf" onchange="enPhoto(this)">') +
      (EN.photo ? '<div class="en-why" data-testid="en-photo-name">📎 ' + esc(EN.photo.name) + '</div>' : '')
    );
  if (f.kind === 'lines') return enLinesField();
  return wrap('<input data-cbsid="SCR022-I06" data-testid="' + tid + '" value="' + esc(v) + '" oninput="' + on + '">');
}
/** a plain select from a list of options with the current value chosen */
function enSelect(id, opts, cur, onch) {
  return (
    '<select data-cbsid="SCR022-S02" data-testid="' +
    id +
    '" onchange="' +
    onch +
    '"><option value="">' +
    esc(tx('Choose…')) +
    '</option>' +
    opts
      .map(function (item) {
        return '<option value="' + esc(item.v) + '"' + (String(item.v) === String(cur) ? ' selected' : '') + '>' + esc(item.l) + '</option>';
      })
      .join('') +
    '</select>'
  );
}
function enFormHTML(step) {
  return enFields(step).map(enFieldHTML).join('') || '<div class="en-why">' + esc(tx('Nothing to ask here')) + '</div>';
}
function enSet(k, v) {
  EN.v[k] = v;
  EN.pv = null;
  var node = document.getElementById('en_next');
  if (node) node.disabled = !enStepReady(EN.step);
}
function enPaintKeep() {
  enPaint();
}
/** true when every required field of the step has a value */
function enStepReady(step) {
  return enFields(step).every(function (item) {
    if (item.kind === 'date') return !!EN.v.date && !(EN.dateRef && EN.dateRef.length);
    if (item.required === false || item.kind === 'photo' || item.kind === 'narration' || item.kind === 'doc_no')
      return !(item.kind === 'doc_no' && item.required);
    if (item.kind === 'lines') return enLinesReady();
    if (item.kind === 'amount') return String(EN.v[item.key] || '').trim() !== '';
    if (item.kind === 'paid_by') return !!EN.v.paid_by && (EN.v.paid_by !== 'cheque' || !!EN.v.cheque_no);
    return String(EN.v[item.key] == null ? '' : EN.v[item.key]).trim() !== '';
  });
}
/** read the chosen paper photo into EN.photo (or clear it) */
function enPhoto(inp) {
  var f = inp.files && inp.files[0];
  if (!f) {
    EN.photo = null;
    return;
  }
  if (f.size > 6 * 1024 * 1024) {
    toast(f.name + ' ' + tx('is over 6MB — skipped.'));
    inp.value = '';
    return;
  }
  var r = new FileReader();
  r.onload = function () {
    EN.photo = { name: f.name, type: f.type, data: String(r.result) };
    enPaint();
  };
  r.readAsDataURL(f);
}

/* ── the journal's own lines (the CA's door): ledger · Dr/Cr · amount. The server says whether they balance. ── */
function enLinesHTML() {
  return (
    '<div class="en-sec">' +
    esc(tx('Lines')) +
    '</div>' +
    EN.lines
      .map(function (item, index) {
        return (
          '<div class="en-ln" data-testid="en-line-' +
          index +
          '">' +
          enLedgerSelect('en_lc' + index, item.code, 'enLine(' + index + ",'code',this.value)", undefined, 'en-line-code-' + index) +
          '<select data-cbsid="SCR022-S03" data-testid="en-line-side-' +
          index +
          '" onchange="enLine(' +
          index +
          ',\'side\',this.value)"><option value="dr"' +
          (item.side === 'dr' ? ' selected' : '') +
          '>Dr</option><option value="cr"' +
          (item.side === 'cr' ? ' selected' : '') +
          '>Cr</option></select>' +
          bkMoneyInput({ id: 'en-line-amt-' + index, text: item.amt == null ? '' : String(item.amt), on: 'enLine(' + index + ",'amt',this.value)" }) +
          '<button data-cbsid="CMP008" type="button" class="en-btn" style="padding:0" aria-label="' +
          esc(tx('Remove')) +
          '" data-testid="en-line-del-' +
          index +
          '" onclick="enLineDel(' +
          index +
          ')"' +
          (EN.lines.length <= 2 ? ' disabled' : '') +
          '>✕</button></div>'
        );
      })
      .join('') +
    '<button data-cbsid="SCR022-B03" type="button" class="en-btn" data-testid="en-line-add" onclick="enLineAdd()">＋ ' +
    esc(tx('Add a line')) +
    '</button>'
  );
}
function enLine(i, k, v) {
  EN.lines[i][k] = v;
  EN.pv = null;
  var node = document.getElementById('en_next');
  if (node) node.disabled = !enStepReady(EN.step);
}
function enLineAdd() {
  EN.lines.push({ code: '', side: 'dr', amt: '' });
  enPaint();
}
function enLineDel(i) {
  if (EN.lines.length > 2) EN.lines.splice(i, 1);
  enPaint();
}

/* ── R106: the ITEM lines of a non-journal event (a debit note: what differs, how many, the rate difference per unit, its tax %) — typed as data, taxed and
   composed by the server (books-manual debit_note → taxedInvoice); the page adds nothing up ── */
function enIsJournal() {
  return !!(EN.ev && EN.ev.kind === 'journal');
}
/** the lines field as this event lays it out: a journal's ledger lines, else item lines */
function enLinesField() {
  return enIsJournal() ? enLinesHTML() : enItemLinesHTML();
}
/** the lines are complete: a journal's two or more ledger lines with amounts; an item list with every line named, counted and rated */
function enLinesReady() {
  if (!enIsJournal()) return EN.items.length >= 1 && EN.items.every(enItemFilled);
  return (
    EN.lines.length >= 2 &&
    EN.lines.every(function (entry) {
      return entry.code && String(entry.amt).trim() !== '';
    })
  );
}
function enItemNew() {
  return { name: '', qty: '', unit_price: '', gst_rate: '' };
}
/** a typed item line is complete when it is named and its quantity and rate are numbers */
function enItemFilled(item) {
  return String(item.name || '').trim() !== '' && isFinite(Number(item.qty)) && String(item.qty).trim() !== '' && isFinite(Number(item.unit_price)) && String(item.unit_price).trim() !== '';
}
/** the item lines as a form: one row per line (item · qty · rate difference · tax %), Remove on each, Add a line below */
function enItemLinesHTML() {
  var cell = function (index, key, kind) {
    return '<input data-cbsid="SCR022-I07" data-testid="en-item-' + key + '-' + index + '" ' + kind + ' placeholder="' + esc(tx(EN_ITEM[key])) + '" value="' + esc(String(EN.items[index][key] == null ? '' : EN.items[index][key])) + '" oninput="enItem(' + index + ",'" + key + '\',this.value)">';
  };
  return (
    '<div class="en-sec">' +
    esc(tx('What differs')) +
    '</div>' +
    EN.items
      .map(function (item, index) {
        return (
          '<div class="en-ln en-item" data-testid="en-item-' + index + '">' +
          cell(index, 'name', 'type="text" autocomplete="off"') +
          cell(index, 'qty', 'type="text" inputmode="decimal" autocomplete="off"') +
          cell(index, 'unit_price', 'type="text" inputmode="decimal" autocomplete="off"') +
          cell(index, 'gst_rate', 'type="text" inputmode="decimal" autocomplete="off"') +
          '<button data-cbsid="CMP008" type="button" class="en-btn" style="padding:0" aria-label="' + esc(tx('Remove')) + '" data-testid="en-item-del-' + index + '" onclick="enItemDel(' + index + ')"' + (EN.items.length <= 1 ? ' disabled' : '') + '>✕</button></div>'
        );
      })
      .join('') +
    '<button data-cbsid="SCR022-B04" type="button" class="en-btn" data-testid="en-item-add" onclick="enItemAdd()">＋ ' +
    esc(tx('Add a line')) +
    '</button>'
  );
}
function enItem(index, key, value) {
  EN.items[index][key] = value;
  EN.pv = null;
  var node = document.getElementById('en_next');
  if (node) node.disabled = !enStepReady(EN.step);
}
function enItemAdd() {
  EN.items.push(enItemNew());
  enPaint();
}
function enItemDel(index) {
  if (EN.items.length > 1) EN.items.splice(index, 1);
  enPaint();
}
/** the item lines as the server takes them (books-manual debit_note: name · qty · unit_price · gst_rate, the chit line's own shape) */
function enItemsBody() {
  return EN.items.map(function (item) {
    return { name: String(item.name || '').trim(), qty: Number(item.qty), unit_price: Number(item.unit_price), gst_rate: String(item.gst_rate).trim() === '' ? 0 : Number(item.gst_rate) };
  });
}
/* every refusal and every warning carries a button that takes the person to the fix */
function enRefusalHTML(list, w) {
  w = w || 'date';
  return (list || [])
    .map(function (x, index) {
      return (
        '<div class="en-bad" data-testid="en-refusal-' +
        esc(x.code || index) +
        '">' +
        esc(x.message) +
        '<button data-cbsid="SCR022-B05" type="button" data-testid="en-fix-' +
        esc(x.code || index) +
        '" onclick="enFixGo(' +
        index +
        ",'" +
        w +
        '\')">' +
        esc((x.fix && x.fix.label) || tx('Change it')) +
        '</button></div>'
      );
    })
    .join('');
}
/** the server's warnings and refusals as a list, each with its fix button */
function enWarnHTML(list) {
  return (list || [])
    .map(function (x, index) {
      return (
        '<div class="en-warn" data-testid="en-warning-' +
        esc(x.code || index) +
        '">' +
        esc(x.message) +
        '<button data-cbsid="SCR022-B06" type="button" data-testid="en-wfix-' +
        esc(x.code || index) +
        '" onclick="enFixGo(' +
        index +
        ",'warnings')\">" +
        esc((x.fix && x.fix.label) || tx('Change it')) +
        '</button></div>'
      );
    })
    .join('');
}
/** one journal line of the preview: account, side, amount, and the rule that placed it */
function enLineHTML(l, c) {
  var rate = l.rate != null && l.rate !== '' ? ' ' + esc(String(l.rate)) + '%' : '';
  return (
    '<div data-testid="en-pline-' +
    esc(l.code) +
    '">' +
    CBList.nextRow(
      [
        '<span class="mono">' + esc(l.code) + '</span> ' + esc(l.name) + rate + (l.party_name ? ' · ' + esc(l.party_name) : ''),
        l.dr_minor ? esc(bkMoney(l.dr_minor, c)) : '',
        l.cr_minor ? esc(bkMoney(l.cr_minor, c)) : ''
      ],
      [110, 110]
    ) +
    '<div class="en-why" data-testid="en-prule-' +
    esc(l.code) +
    '"><span class="en-chip" data-testid="en-ptype-' +
    esc(l.code) +
    '">' +
    esc(tx(l.type || '')) +
    '</span> ' +
    esc(l.rule || '') +
    '</div></div>'
  );
}
/** step 4: the server's journal preview, its voucher, balanced or not, and its warnings */
function enPreviewHTML() {
  var pv = EN.pv;
  if (!pv) return '<div class="loadwrap"><span class="spin"></span> ' + esc(tx('Checking…')) + '</div>';
  var c = pv.currency,
    v = pv.voucher || {};
  var grey = 'color:var(--grey);font-size:var(--fs-1);text-transform:uppercase';
  return (
    '<div style="margin-bottom:8px"><span class="en-chip" data-testid="en-voucher">' +
    esc((v.series || 'MJ') + (v.kind ? ' · ' + tx(v.kind) : '')) +
    '</span> ' +
    /* WX-R2R: a refused entry with no lines has no two sides — the refusal (with its fix) is the one thing said; "do not match" sent the owner to the amounts when the DATE was the fix */
    (pv.balanced === true
      ? '<span class="en-ok" data-testid="en-balanced">✓ ' + esc(tx('Both sides match')) + '</span>'
      : (pv.refusals || []).length && !(pv.lines || []).length
        ? ''
        : '<b data-testid="en-unbalanced" style="color:var(--red-i,#8E3517)">' + esc(tx('The two sides do not match')) + '</b>') +
    '</div>' +
    enRefusalHTML(pv.refusals, 'refusals') +
    enWarnHTML(pv.warnings) +
    '<div style="' +
    grey +
    '">' +
    CBList.nextRow([esc(tx('Code')) + ' · ' + esc(tx('Ledger')), esc(tx('Debit')), esc(tx('Credit'))], [110, 110]) +
    '</div>' +
    (pv.lines || [])
      .map(function (item) {
        return enLineHTML(item, c);
      })
      .join('') +
    (pv.narration ? '<div class="en-why" style="border:0;margin-top:8px">' + esc(pv.narration) + '</div>' : '')
  );
}

/* ── save: one tap, one record ── */
async function enSave(btn) {
  if (!enCanSave() || !EN.ev) return;
  await bkOnce('entry-save', btn, async function () {
    /* R106: a money promise asks first, INSIDE the busy guard (a second press while the question is open is dropped — the R102b lesson) */
    var question = enAskWords() || (enActingAdviser() && CBBooksActing.posts() ? CBBooksActing.postAsk(EN.pv) : null);
    if (question && typeof CBAction !== 'undefined' && (await CBAction.ask(question)) !== true) return;
    await enSaveWrite();
  });
}
/** the one write: POST /events with the sheet's client_ref; then the Saved screen, the Day book and the opener are told — a refusal shows under the preview */
async function enSaveWrite() {
  EN.saving = true;
  var body = enBody(); body.client_ref = EN.ref;
  if (EN.photo) body.attachment = EN.photo;
  try {
    var reply = enActingAdviser() ? await CBBooksActing.prepare(api, tx, body, bkToday().slice(0, 7)) : await api('booksEventPost', { body: body });
    EN.saved = reply || {}; EN.saving = false; EN.ref = null;
    if (!EN.saved.prepared || EN.saved.posted) enSavedTell(EN.saved);
    enPaint();
  } catch (e) {
    EN.saving = false;
    EN.pv = Object.assign({}, EN.pv, {
      refusals: [{ code: 'SAVE', message: bkWhy(e, tx('Could not save this entry')), fix: { label: tx('Try again'), retry: true } }]
    });
    enPaint2();
  }
}
/** this sheet is open on a page acting for a store as the adviser: Save PREPARES, or POSTS under the grant's adviser_posts (CBBooksActing is loaded only by the pages that act) */
function enActingAdviser() { return typeof CBBooksActing !== 'undefined' && CBBooksActing.isAdviser(); }
/** after a save: the Day book, the Books to-do and the opener (R106: Payables) are told — a painter that fails is logged, the save stands */
function enSavedTell(saved) {
  try {
    if (typeof BK !== 'undefined' && BK.onEntrySaved) BK.onEntrySaved(saved);
    if (EN.after) EN.after(saved);
    if (typeof bkHealthLoad === 'function') bkHealthLoad().catch(function () {});
    if (typeof BK !== 'undefined' && BK.tab === 'daybook' && typeof bkTab === 'function') bkTab('daybook', true);
  } catch (e) {
    if (typeof cblog === 'function') cblog('error', 'entry saved, a painter failed: ' + ((e && e.message) || e));
  }
}
/** the "Saved" screen after a successful save, with its entry number and the next actions */
function enPaintSaved(body, acts) {
  if (EN.saved.prepared) return CBBooksActing.paintPrepared(body, acts, EN.saved, tx, esc);
  var s = EN.saved,
    no = s.entry_no || s.no || '';
  body.innerHTML =
    '<h3 data-testid="en-saved"><span class="en-ok">✓</span> ' +
    esc(tx('Saved')) +
    '</h3><div data-testid="en-saved-no" class="en-chip">' +
    esc(no) +
    '</div>' +
    '<div class="en-why" style="border:0;margin-top:10px">' +
    esc(tx('It is now in the Day book, Ledgers and Trial balance.')) +
    '</div>';
  acts.innerHTML =
    '<button data-cbsid="SCR022-B07" class="en-btn" data-testid="en-reverse-now" onclick="enReverse(\'' +
    esc(s.entry_id || s.id || '') +
    "','" +
    esc(no) +
    '\',true)">↩ ' +
    esc(tx('Reverse this entry')) +
    '</button>' +
    '<button data-cbsid="CMP004" class="en-btn pri" data-testid="en-done" onclick="enClose()">' +
    esc(tx('Done')) +
    '</button>';
}

/* ── Reverse this entry: a plain confirm, then the mirror entry (insert-only) ── */
/**
 * ⭐ THE ONE REVERSE (M29): the confirm asks the REASON (the API wants one with every reversal), posts the mirror entry and tells the caller
 * what came back — `done(r, why)` — so a statement row repaints itself (cap-books.js bkReverseLine) without a Day book read. The answer's
 * `words` name the bills reopened ("Reversed PY/… by MJ/…. Reopened 2 bills (…)"); they are the API's, never composed here.
 * The confirm sheet is removed before onOk runs, so the reason is kept as it is typed (EN.why), not read from the sheet afterwards.
 */
function enReverse(id, no, fromSheet, done) {
  if (!id) return;
  EN.why = '';
  var body =
    esc(txf('{no} stays as it is. A new entry that cancels it is added.', { no: no || '' })) +
    '<input data-cbsid="SCR022-I08" class="inp" id="en_reason" data-testid="en-reason" placeholder="' +
    esc(tx('Reason')) +
    '" aria-label="' +
    esc(tx('Reason')) +
    '" maxlength="120" style="margin-top:8px" oninput="EN.why=this.value">';
  confirmAsk(
    tx('Reverse this entry?'),
    body,
    tx('Reverse'),
    function () {
      var why = String(EN.why || '').trim() || tx(fromSheet ? 'Reversed from the Day book' : 'Reversed from the row');
      bkOnce('rev-' + id, null, async function () {
        EN.rev[id] = EN.rev[id] || bkRef();
        try {
          var reply = await api('booksReverse', { params: { id: id }, body: { client_ref: EN.rev[id], reason: why } });
          delete EN.rev[id];
          toast((reply && reply.words) || txf('Reversed — new entry {no}', { no: (reply && (reply.entry_no || reply.no)) || '' }));
          if (fromSheet) enClose();
          if (typeof done === 'function') done(reply, why);
          /* M175: the Day book repaints its two rows from the answer; only when it cannot does it read the whole book again */
          if (typeof BK !== 'undefined' && BK.tab === 'daybook' && !(typeof bkDvReversed === 'function' && bkDvReversed(id, reply))) bkTab('daybook', true);
        } catch (e) {
          toast(bkWhy(e, tx('Could not reverse this entry')));
        }
      });
    },
    true
  );
}
