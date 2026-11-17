/* app/cap-admin.js — the "admin" capability (progressively loaded on demand).
 * OWNS  the workshop's admin screens: MIS · Profile · Settings · governance (the panels, their reads and their paint).
 * CALLED BY app.html ensureCap('admin') the first time one of those screens opens (CAP_OF).
 * FLOW  ensureCap → the screen opens → api(…) → the panel paints; a write goes through the M64 action state
 * CARD 28-platform-and-operations/admin-screens
 * Injected by ensureCap('admin') the first time an admin screen (CAP_OF) is opened.
 * Classic script, shared global scope: references Core/helpers globals that are eager and already
 * present before this loads — api, mapApiActor, hatAssignable, menuAssist, scr, opt, inr, esc,
 * scrErr, val, toast, MSG, _CARD, CURRENCIES, UI. Screens: MIS, Profile, Settings (+ governance).
 * (Co-assists is planned to move here too, once its shared actor helpers are separated.) */

if (typeof EP !== 'undefined') {
  Object.assign(EP, {
    /* keysList · keysMint · keysRevoke · counters · counterAdd · counterRename · counterOpen · counterRelease → CB_SETTINGS_EP (app/accounts-shell.js, T3-SETTINGS) */
    /* ⭐ a brand releases offers to its stores; a store takes them or not (routes/network-offers.js, 2026-09-17) */
    netOffers: { m: 'GET', p: '/api/network-offers', ok: '✓' },
    netOfferPolicy: { m: 'PUT', p: '/api/network-offers/policy', ok: '✓' },
    netOfferRelease: { m: 'POST', p: '/api/network-offers/:id/release', ok: '✓' },
    netOfferWithdraw: { m: 'POST', p: '/api/network-offers/:id/withdraw', ok: '✓' },
    netOfferChoice: { m: 'POST', p: '/api/network-offers/:id/choice', ok: '✓' },
    /* ⭐ a brand publishes its product changes; a store is only ever SUGGESTED a price (lib/network-catalogue.js) */
    netCatPublish: { m: 'POST', p: '/api/network-offers/catalogue/publish', ok: '✓' },
    netCatCancel: { m: 'POST', p: '/api/network-offers/catalogue/cancel', ok: '✓' },
    netCatPrice: { m: 'POST', p: '/api/network-offers/catalogue/price', ok: '✓' },
    /* intCatalogue · intStatus · intApprove → CB_SETTINGS_EP (app/accounts-shell.js, T3-SETTINGS) */
    intProfileMap: { m: 'GET', p: '/api/integrations/profile-map', ok: 'y' }, // what we look for about the store · where from · how trusted
    intStreams: { m: 'GET', p: '/api/integrations/streams', ok: 'y' }, // who owns which stream (2026-09-07)
    intStreamsSet: { m: 'PUT', p: '/api/integrations/streams', ok: '✓' }, // hand a stream to another connector
    intReconcile: { m: 'GET', p: '/api/integrations/reconcile', ok: 'y' }, // did what left this account land in the books?
    intBooksSkip: { m: 'POST', p: '/api/integrations/books/skip', ok: '✓' }, // this one is not for the books (reversible)
    /* ⚠️ SAME PATH AS cap-messages' msgInbox, under a DIFFERENT KEY. The EP registry rejects duplicate keys
     (guard-static check 1), and MIS must not depend on the messages capability having been opened first —
     Friction counts unattended messages whether or not you have ever visited Messages. */
    misMsgs: { m: 'GET', p: '/api/folders/messages', ok: 'y' }
    /* ⭐ THE SERVER'S MEASUREMENT (backlog 29). MIS was the THIRD implementation of open/overdue/ageing/unread;
     lib/measure.js already served the folder pane and the counterparty scorecard. This makes it three consumers
     of one definition rather than two definitions. ⚠️ Above all it brings OVERDUE, which MIS simply did not have
     — the screen titled "What is stuck?" did not know what late meant.
     misMetrics → CB_MIS_EP (app/accounts-shell.js, T3-P4-ACCOUNT): CB Finance › Reports reads the same name; app.html merges it. */
  });
}
// ── TRADE DOCUMENTS VAULT — MOVED to app/cap-shop.js (SET1, 2026-10-13): CB Settings › Your shop paints the same rows. Loaded first by CAP_WITH.admin. ──
/**
 * ⭐ SHOWN TO CUSTOMERS — THE BUSINESS'S DEFAULTS (Athi, 2026-09-05: "tax may be default"). One switch per detail, applied to
 * every item unless the item's own pane says otherwise (product page › Shown to customers). Saved through
 * PATCH /entities/me/exposure; enforced in the catalogue view (lib/exposure.js), so every surface obeys.
 */
var PF_EXPOSURE = [
  ['tax', 'Tax line'],
  ['offers', 'Offers'],
  ['stock', 'Availability'],
  ['synonyms', 'Synonyms'],
  ['hsn', 'HSN code'],
  ['description', 'Description'],
  ['media', 'Pictures']
];
var PF_EXPOSURE_DEFAULTS = { tax: true, offers: true, stock: true, synonyms: false, hsn: false, description: true, media: true };
function pfExposureDefaultsHTML(e) {
  var cur = Object.assign({}, PF_EXPOSURE_DEFAULTS, (e && e.policy_flags && e.policy_flags.storefront_exposure) || {});
  return (
    '<label class="fl" style="margin-top:12px">' +
    tx('Shown to customers by default') +
    '</label>' +
    '<div data-testid="pf-exposure" style="display:flex;flex-wrap:wrap;gap:6px 14px;max-width:520px">' +
    PF_EXPOSURE.map(function (x) {
      return (
        '<label style="display:flex;gap:6px;align-items:center;font-size:var(--fs-2);cursor:pointer"><input data-cbsid="ACC002-I14" type="checkbox" data-testid="pf-expose-' +
        x[0] +
        '"' +
        (cur[x[0]] ? ' checked' : '') +
        ' onchange="pfExposureSet(\'' +
        x[0] +
        '\', this.checked)">' +
        esc(tx(x[1])) +
        '</label>'
      );
    }).join('') +
    '</div><div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
    esc(tx('Any item can differ: product page › Shown to customers. Price and unit always show.')) +
    '</div>'
  );
}
async function pfExposureSet(k, on) {
  try {
    var reply = await api('exposureDefaults', {
      body: (function () {
        var b = {};
        b[k] = !!on;
        return b;
      })()
    });
    if (UI._me) {
      UI._me.policy_flags = Object.assign({}, UI._me.policy_flags || {}, { storefront_exposure: reply.exposure });
    }
    toast(tx('Saved ✓'));
  } catch (e) {
    toast((e && e.message) || tx('Could not save'), true);
  }
}
/* ═══ MIS ═══════════════════════════════════════════════════════════════════════════════════════════════════
 * ⭐ REBUILT 2026-08-16. It was eight equal tiles — chits, value, open, in progress, closed, disputes, co-assists,
 * suppliers — and the trouble was not the layout, it was that EVERY ONE OF THOSE NUMBERS IS KNOWABLE INSIDE A
 * SINGLE COMPANY. CB stands between parties and sees both sides of a transaction, which no single ERP does, and
 * the old screen spent that vantage point on counts an accounts package already prints.
 *
 * Four bands, ordered by "would you act on this today", in the app's own two-pane shell (Athi: *"how do we bring
 * it as two sided panel? because all should be similar"*) — the rail is the set, the right pane is the selected
 * thing, exactly as Task→chit and Suppliers→catalogue. The rail carries each band's HEADLINE, so it is a summary
 * in its own right and the old tile grid is condensed rather than lost. `Overview` renders all four at once, which
 * is the one thing a two-pane shell would otherwise have cost (Athi: *"each at a time, or an option bar on top"*).
 *
 * ⚠️ NOTHING HERE IS INVENTED. Every figure is derived from chits already fetched. Where a number would require
 * logic that does not exist yet (counterparty reliability, mass balance) the band says so rather than showing a
 * plausible score — the same discipline netAvail set by waiting for lib/availability.js.
 */
var MIS_BANDS = [
  { key: 'overview', name: 'Overview', q: 'Everything, condensed' },
  { key: 'position', name: 'Position', q: 'How much is real?' },
  { key: 'flow', name: 'Flow', q: 'What is moving?' },
  { key: 'friction', name: 'Friction', q: 'What is stuck?' },
  { key: 'trust', name: 'Trust', q: 'Who can I rely on?' },
  /* The outcome half of the plan declared in Governance → Constitution. It is a metric, so it lives here. */
  { key: 'plan', name: 'Plan', q: 'What have I used?' },
  /* ⭐ THE NETWORK CLAIM, AS A NUMBER. Athi, 2026-09-04: "if you use our networking capability your tax liability can
     be computed or organised — is it possible?" — STUDY-gst-structure §4. Output tax on my sent chits, input credit
     on my received ones (the seller's copy is the same record), net for the month. Provisional until a copy is
     completed, which freezes its invoice. We compute and organise; we do not file. */
  { key: 'tax', name: 'Tax', q: 'What do I owe this month?' }
];
/**
 * ⚠️ THE STATUS→MONEY MAPPING, AND THE TRAP IN IT. `cancelled` and `rejected` live in the `close` bucket beside
 * `completed`, so "committed = closed" would count DEAD value as real money. They are excluded from both sides and
 * reported separately — silently dropping them would be a lie of omission, and folding them in would be worse.
 */
var MIS_COMMITTED = { accepted: 1, in_progress: 1, partial: 1, completed: 1 }; // someone said yes
var MIS_FORECAST = { pending: 1, delivered: 1, read: 1 }; // sent, nobody has committed
/** RAIL-146: a MIS figure summed over chits the server stripped for a cost-blind co-assist is PARTIAL and says so — never a plausible wrong number */
function misMoney(figures, value) {
  return figures.hidden ? tx('partial') + ' · ' + inr(value) : inr(value);
}
/** did any row in the window carry no money (stripped for a cost-blind co-assist)? */
function misAnyHidden(rows) {
  return rows.some(function (item) {
    return item.costHidden;
  });
}
var MIS_DEAD = { cancelled: 1, rejected: 1 };

/**
 * ⚠️ ON MOBILE, PICKING A ROW MUST SLIDE TO THE DETAIL. The shell hides .detail under .appwrap.m unless the panel
 * carries .showdetail, so without this the three new two-pane screens showed their rail and then did nothing at
 * all when tapped — the row highlighted and the content stayed invisible. selectSupplier has always done this;
 * one helper rather than the same three lines in MIS, Profile and Settings.
 */
function _capShowDetail() {
  if (UI.vp !== 'mob') return;
  UI.mdetail = true;
  var node = document.getElementById('panel');
  if (node) node.classList.add('showdetail');
}
function misBand() {
  return UI.misBand || 'overview';
}
/* Repaint from the cached model when we have one — switching band is not a reason to re-fetch five endpoints. */
function misSetBand(k) {
  UI.misBand = k;
  renderApp();
  _capShowDetail();
  if (UI._mis) {
    const node = document.getElementById('misbody');
    if (node) node.innerHTML = misBandHTML(k, UI._mis);
  } else {
    loadMIS();
  }
}
function misPeriod() {
  return UI.misPeriod || 'all';
}
function misSetPeriod(p) {
  UI.misPeriod = p;
  renderApp();
  loadMIS(true);
} /* ⚠ FORCED: a new window is a new question */ // a new window DOES need the data re-bucketed

function misScreen() {
  var m = UI._mis;
  var rail = MIS_BANDS.map(function (item) {
    var sel = misBand() === item.key ? ' sel' : '';
    var hv = m ? misHeadline(item.key, m) : { v: '·', s: '' };
    return (
      '<div data-cbsid="INS001-C01" class="row misrow' +
      sel +
      '" data-testid="mis-band-' +
      item.key +
      '" onclick="misSetBand(\'' +
      item.key +
      '\')">' +
      '<div class="main2"><div class="l1"><span class="code">' +
      esc(item.name) +
      '</span></div>' +
      '<div class="l2">' +
      esc(item.q) +
      '</div></div>' +
      '<div class="misval' +
      (hv.tone ? ' ' + hv.tone : '') +
      '">' +
      hv.v +
      '<small>' +
      esc(hv.s) +
      '</small></div></div>'
    );
  }).join('');
  var seg = function (p, l) {
    return '<button data-cbsid="INS001-B01" class="' + (misPeriod() === p ? 'on' : '') + '" onclick="misSetPeriod(\'' + p + '\')">' + l + '</button>';
  };
  /* The period bar sits ABOVE the split because it reframes all four bands at once; anything scoped to one band
     lives inside that band. Same rule that puts the Suppliers tabs above its list. */
  var bar =
    '<div class="misbar"><span class="misttl">' +
    tx('📊 MIS') +
    '</span>' +
    '<span class="seg">' +
    seg('7', '7 days') +
    seg('30', '30 days') +
    seg('all', 'All time') +
    '</span>' +
    '<span class="misbar-r">' +
    (m ? '<span class="misasof">' + esc(m.asOf) + '</span>' : '') /* the one read stamp: cap-mis.js misReadAt (W2-SHOP) */ +
    '<button data-cbsid="INS001-B02" class="composebtn" onclick="aiRun(\'metrics-narrate\',UI._mis,{title:\'📊 Explain my metrics\'})" title="AI narrates what your numbers say">' +
    tx('✨ Explain') +
    '</button></span></div>';
  var list = '<div class="list"><div class="lh" style="padding:0">' + bar + '</div>' + '<div class="rows" id="mis_rail">' + rail + '</div></div>';
  var detail =
    '<div class="detail" id="detailpane"><div id="misbody" tabindex="0" role="region" aria-label="' + esc(tx('Your numbers')) + '">' +
    /* ⚠️ NO INLINE SPINNER, AND A WAY OUT WHILE IT LOADS. api() already shows the centred "Reading data…" pill,
       so a second spinner in the pane is two indicators for one fetch. And on mobile the loading pane COVERS the
       rail — without this button a slow read (measured ~3.6s against Railway) strands you on a blank screen. */
    (m ? misBandHTML(misBand(), m) : '<button data-cbsid="CMP006" class="dback" data-testid="cap-back" onclick="backToList()">‹ Back</button>') +
    '</div></div>';
  var divider =
    '<div class="divider" id="divider" onmousedown="startDrag(event)" ontouchstart="startDrag(event)" role="separator" aria-label="Resize panes"><span class="grip"></span></div>';
  /**
   * ⚠️ ITS OWN RAIL WIDTH, not the shared UI.lw. Task and Suppliers hold lists of unbounded, variable-length rows,
   * so people drag those panes wide — and MIS then inherited that width for FIVE FIXED ROWS, pushing its detail
   * pane off the screen entirely. The rail's content here has a natural size; borrowing another screen's is what
   * made it wrong. Still draggable — startDrag writes UI.lw, and misLw only supplies the default.
   */
  if (UI.misLw == null) UI.misLw = 320;
  var lw = Math.min(UI.misLw, Math.max(260, Math.round((window.innerWidth || 1200) * 0.42)));
  return (
    '<div class="panel' +
    (UI.vp === 'mob' && UI.mdetail ? ' showdetail' : '') +
    '" id="panel" style="--lw:' +
    lw +
    'px;--lh:' +
    (UI.lh || 300) +
    'px">' +
    list +
    divider +
    detail +
    '</div>'
  );
}

/* The rail doubles as the summary, so each row needs its own headline — one number and one word of context. */
function misHeadline(k, m) {
  if (k === 'overview') return { v: MIS_BANDS.length - 1, s: 'bands' };
  if (k === 'position') return { v: misMoney(m, m.committed), s: 'committed' };
  if (k === 'flow') return { v: m.chits, s: m.periodLabel };
  if (k === 'friction') {
    const un = (m.unattended || []).length;
    /* The headline leads with whichever is worse — an unanswered message is friction the chit queue never showed. */
    if (un) return { v: m.waiting.length + un, s: un + ' unanswered', tone: 'warn' };
    return { v: m.waiting.length, s: m.waiting.length ? 'oldest ' + m.waiting[0].age : 'nothing stuck', tone: m.waiting.length ? 'warn' : 'ok' };
  }
  if (k === 'plan') return { v: UI._misToday == null ? '·' : UI._misToday, s: 'of ' + PLAN.chitsPerDay + ' today' };
  if (k === 'trust') return { v: m.suppliers, s: m.open_disputes ? m.open_disputes + ' disputes' : '0 disputes', tone: m.open_disputes ? 'warn' : 'ok' };
  if (k === 'tax') {
    const L = UI._taxLedger;
    if (!L) return { v: '·', s: 'this month' };
    return { v: inr(L.net.total), s: (L.provisional ? 'provisional · ' : '') + 'net ' + L.month, tone: L.net.total > 0 ? 'warn' : 'ok' };
  }
  return { v: '·', s: '' };
}

/* Athi: *"scroll not appearing, how do i know i reached the bottom"* — so say so, rather than leaving a stopped
   page indistinguishable from a stalled one. */
function _capEnd() {
  return '<div class="capend">— end —</div>';
}
function misBandHTML(k, m) {
  var body =
    k === 'overview'
      ? misOverview(m)
      : k === 'position'
        ? misPosition(m)
        : k === 'flow'
          ? misFlow(m)
          : k === 'friction'
            ? misFriction(m)
            : k === 'trust'
              ? misTrust(m)
              : k === 'plan'
                ? misPlan(m)
                : k === 'tax'
                  ? misTax()
                  : '';
  return body ? body + _capEnd() : '';
}
/**
 * ⭐ THE TAX BAND — one GSTIN, one month: output by head over my SENT copies, input credit by head over my RECEIVED
 * copies, net. Every row is a chit you can open; the figure on it is the same INV-01 block the copy carries (frozen
 * once completed). The two export links hand back the offline-tool JSON a return preparer or Tally imports.
 * ⚠️ Says PROVISIONAL while any copy in the month is not yet completed, and says what is NOT here: off-rail purchases.
 */
function misTaxMonth() {
  return UI._taxMonth || new Date().toISOString().slice(0, 7);
}
function misTaxSetMonth(m) {
  UI._taxMonth = m;
  UI._taxLedger = null;
  loadTaxLedger();
}
async function loadTaxLedger() {
  try {
    UI._taxLedger = await api('taxLedger', { query: { month: misTaxMonth() } });
  } catch (e) {
    UI._taxLedger = { error: (e && e.message) || 'Could not read the ledger.' };
  }
  const node = document.getElementById('misbody');
  if (node && misBand() === 'tax') node.innerHTML = misBandHTML('tax', UI._mis || {});
  const rail = document.getElementById('mis_rail');
  if (rail && UI._mis) {
    const b = MIS_BANDS.find(function (x) {
      return x.key === 'tax';
    });
    const hv = misHeadline('tax', UI._mis);
    const el = rail.querySelector('[data-testid="mis-band-tax"] .misval');
    if (el) el.innerHTML = hv.v + '<small>' + esc(hv.s) + '</small>';
  }
}
/**
 * The bills the ledger could not read, said in words. api #1180 sends `dropped` (chit ids) and `dropped_why` (fixed English sentences);
 * an older api sends neither, so read them only if present. Reuses the .miswarn notice; each bill opens with the standard Open (CMP010),
 * named "bill 1, 2 ..." because the answer carries ids only and an id is never shown to a person (cbIsRawId).
 * The count sentence is translated here (txn); the api's reason stays as the api wrote it, on the detail line.
 */
function taxDroppedHTML(ledger) {
  const ids = Array.isArray(ledger.dropped) ? ledger.dropped : [];
  if (!ids.length) return '';
  const reason = errWords([].concat(ledger.dropped_why || []).join(' '));
  const head = txn(
    '{count} bill could not be read and is left out of this month',
    '{count} bills could not be read and are left out of this month',
    ids.length
  );
  const links = ids
    .map(function (id, at) {
      return (
        '<button data-cbsid="CMP010" class="lineopen" data-testid="mis-tax-dropped-open-' +
        at +
        '" style="background:none;border:0;padding:0 8px 0 0;font:inherit" onclick="openChit(\'' +
        esc(id) +
        '\')">' +
        esc(txf('Open bill {n}', { n: at + 1 })) +
        '</button>'
      );
    })
    .join('');
  return (
    '<div class="miswarn" role="status" data-testid="mis-tax-dropped">' +
    esc(head) +
    (reason ? '<div data-testid="mis-tax-dropped-why">' + esc(reason) + '</div>' : '') +
    '<div>' +
    links +
    '</div></div>'
  );
}
function misTax() {
  /* ⭐ CX0: this band is India's GST (CGST · SGST · IGST, GSTR-1 / 3B from the rail). Another country's shop is told where its own return is. */
  if (typeof SESSION !== 'undefined' && SESSION && SESSION.country && String(SESSION.country).toUpperCase() !== 'IN')
    return _misHead('Tax', tx("This band reads India's GST. Your return is prepared in Accounts."));
  const L = UI._taxLedger;
  if (L === undefined || L === null) {
    loadTaxLedger();
    return _misHead('Tax', tx('What this month owes, from the chits on the rail.')) + '<div class="misnote">' + tx('reading…') + '</div>';
  }
  if (L.error) return _misHead('Tax', '') + '<div class="miswarn">' + esc(L.error) + '</div>';
  const m = misTaxMonth();
  const prev = (function () {
    const date = new Date(m + '-01T00:00:00Z');
    date.setUTCMonth(date.getUTCMonth() - 1);
    return date.toISOString().slice(0, 7);
  })();
  const next = (function () {
    const date = new Date(m + '-01T00:00:00Z');
    date.setUTCMonth(date.getUTCMonth() + 1);
    return date.toISOString().slice(0, 7);
  })();
  const head = (t, x) => '<div class="mistwo"><div>' + t + '</div><div>' + x + '</div></div>';
  const heads = (h) =>
    '<table style="width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:var(--fs-2)">' +
    [
      ['Taxable', h.taxable],
      ['CGST', h.cgst],
      ['SGST', h.sgst],
      ['IGST', h.igst]
    ]
      .concat(h.cess ? [['Cess', h.cess]] : [])
      .concat([['Tax', h.tax]])
      .map(function (item) {
        return (
          '<tr><td style="color:var(--grey);padding:2px 0">' +
          esc(item[0]) +
          '</td><td style="text-align:end;padding:2px 0"><bdi>' +
          inr(item[1]) +
          '</bdi></td></tr>'
        );
      })
      .join('') +
    '</table>';
  const rows = (L.rows || [])
    .map(function (item) {
      const tone = item.side === 'output' ? 'var(--warn-3)' : item.side === 'itc' ? 'var(--ok-2)' : 'var(--grey)';
      return (
        '<div data-cbsid="INS001-C02" class="row" style="cursor:pointer" onclick="openChit(\'' +
        esc(item.chit_id) +
        '\')">' +
        '<div class="main2"><div class="l1"><span class="code">' +
        esc(item.subject || item.purpose || 'chit') +
        '</span>' +
        '<span class="optchip" style="color:' +
        tone +
        '">' +
        esc(item.side === 'output' ? tx('output') : item.side === 'itc' ? tx('input credit') : tx('no credit')) +
        '</span>' +
        (item.provisional
          ? '<span class="optchip">' + tx('provisional') + '</span>'
          : '<span class="optchip" style="color:var(--ok-2)">' + tx('frozen') + '</span>') +
        '<span class="amt" style="margin-inline-start:auto"><bdi>' +
        inr(item.heads.tax) +
        '</bdi></span></div>' +
        '<div class="l2">' +
        esc((item.counterparty || '—') + (item.counterparty_gstin ? ' · ' + item.counterparty_gstin : ' · no GSTIN')) +
        ' · ' +
        tx('taxable') +
        ' ' +
        inr(item.heads.taxable) +
        (item.unrated ? ' · <span style="color:var(--warn-3)">' + item.unrated + ' ' + tx('line(s) without a rate') + '</span>' : '') +
        '</div></div></div>'
      );
    })
    .join('');
  return (
    _misHead(
      'Tax',
      tx('What this month owes, from the chits on the rail. Provisional until a copy is completed; off-rail purchases are not here; this is not a filing.')
    ) +
    '<div class="misbar" style="margin-bottom:8px"><span class="seg">' +
    '<button data-cbsid="INS001-B03" onclick="misTaxSetMonth(\'' +
    prev +
    '\')">‹</button><button data-cbsid="INS001-B04" class="on">' +
    esc(m) +
    '</button><button data-cbsid="INS001-B05" onclick="misTaxSetMonth(\'' +
    next +
    '\')">›</button></span>' +
    '<span class="misbar-r" style="font-size:var(--fs-1);color:var(--grey)">' +
    esc((L.gstin ? 'GSTIN ' + L.gstin : tx('no GSTIN on the profile')) + ' · ' + L.registration) +
    '</span></div>' +
    head(
      '<div class="mislbl">' +
        tx('Output · on what I sold') +
        '</div><div class="mishero" data-testid="mis-tax-output"><bdi>' +
        inr(L.output.tax) +
        '</bdi></div>' +
        heads(L.output),
      '<div class="mislbl">' +
        tx('Input credit · on what I bought') +
        '</div><div class="mishero" data-testid="mis-tax-itc" style="color:var(--ok-2)"><bdi>' +
        inr(L.itc.tax) +
        '</bdi></div>' +
        heads(L.itc)
    ) +
    '<div class="mislbl" style="margin-top:12px">' +
    tx('Net for the month') +
    '</div>' +
    '<div class="mishero" data-testid="mis-tax-net"><bdi>' +
    inr(L.net.total) +
    '</bdi>' +
    (L.provisional ? ' <small>' + tx('provisional') + '</small>' : '') +
    '</div>' +
    taxDroppedHTML(L) + '<div class="misnote">CGST ' +
    inr(L.net.cgst) +
    ' · SGST ' +
    inr(L.net.sgst) +
    ' · IGST ' +
    inr(L.net.igst) +
    (L.net.cess ? ' · Cess ' + inr(L.net.cess) : '') +
    '</div>' +
    '<div style="display:flex;gap:8px;margin:10px 0">' +
    '<button data-cbsid="INS001-B06" class="composebtn" onclick="misTaxExport(\'gstr1\')">' +
    tx('⬇ GSTR-1 JSON') +
    '</button>' +
    '<button data-cbsid="INS001-B07" class="composebtn" onclick="misTaxExport(\'gstr3b\')">' +
    tx('⬇ GSTR-3B JSON') +
    '</button></div>' +
    '<div class="sec">' +
    tx('The chits behind it') +
    ' · ' +
    L.count +
    '</div>' +
    (rows || '<div class="misnote">' + tx('No chit in this month.') + '</div>')
  );
}
/* The offline-tool JSON, saved as a file — the same read the band shows. T3-P1-MONEY: the download is helpers.js gstrDownload, the ONE copy CB Finance › Returns uses too. */
function misTaxExport(form) {
  const base = typeof apiBase === 'function' ? apiBase() : '';
  const url = base + '/api/tax/gstr?month=' + encodeURIComponent(misTaxMonth()) + '&form=' + form;
  gstrDownload(misTaxMonth(), form).catch(function () {
    toast(tx('Could not build the file. Try again.'), true);
  }); /* the server's sentence never reaches the band (design rule 1) */
  return url;
}
/**
 * ⚠️ THE BACK BUTTON IS PART OF THE HEADING, not an optional extra. On mobile the detail pane COVERS the rail,
 * so a section without a way back is a dead end — the same failure as the Find-a-product panel on a laptop, and
 * it reached three screens at once because they share this helper. `.dback` is the shell's mobile-only back
 * control: hidden on a laptop where the rail is still visible beside you, shown exactly when it is not.
 */
/* ⚠️ The back button is separable from the title, because Governance drops the title (the rail already names it)
   but still needs a way back on mobile. Losing it with the heading is exactly the dead-end fixed earlier. */
function _misBack() {
  return '<button data-cbsid="CMP006" class="dback" data-testid="cap-back" onclick="backToList()">‹ Back</button>';
}
/**
 * ⚠️ AN ABSENT SUBTITLE TAKES NO SPACE. Passing '' used to emit an empty `<div class="ds">` carrying a 14px
 * bottom margin — a gap under the heading with nothing in it, which reads as a rendering fault rather than as
 * a screen that simply needs no strapline. Now that a subtitle is optional (the IAM one was removed because it
 * had gone stale), omitting it has to look deliberate.
 */
function _misHead(t, s) {
  return (
    _misBack() +
    '<div class="dh">' +
    esc(t) +
    '</div>' +
    (s ? '<div class="ds" style="margin-bottom:14px">' + esc(s) + '</div>' : '<div style="margin-bottom:11px"></div>')
  );
}
function _misSplitBar(m) {
  var tot = m.committed + m.forecast;
  if (!tot) return '<div class="misnote">No value on any chit yet.</div>';
  var cp = Math.round((m.committed / tot) * 100);
  return (
    '<div class="misplit"><span style="background:var(--blue);width:' +
    cp +
    '%;color:var(--on-accent)"></span>' +
    '<span style="background:var(--gold);width:' +
    (100 - cp) +
    '%;color:var(--on-gold)"></span></div>' +
    '<div class="miskey"><span class="k"><i class="sw" style="background:var(--blue);color:var(--on-accent)"></i> Committed ' +
    misMoney(m, m.committed) +
    '</span>' +
    '<span class="k"><i class="sw" style="background:var(--gold);color:var(--on-gold)"></i> Forecast ' +
    misMoney(m, m.forecast) +
    '</span></div>'
  );
}
function _misStack(m) {
  var t = m.chits || 1;
  /**
   * ⚠️⚠️ EVERY BACKGROUND MUST NAME ITS TEXT COLOUR, and this was the one renderer that did not. Found by
   * THEME-01 once the account was seeded: `hcdark / mis` — white on `rgb(143,190,255)` at **1.91:1**.
   *
   * ⭐ IT IS THE ONLY BAR THAT PUTS THE NUMBER INSIDE THE FILL. `_misSplitBar` and both `miskey` swatches pair
   * each background with its `--on-*` token; this one wrote the count onto the segment and let it inherit the
   * card's ink — white in every dark theme.
   *
   * ⭐⭐ AND IT FAILED IN THE HIGH-CONTRAST DARK THEME, which exists precisely for people who need contrast.
   * `--blue` is LIGHTENED in dark themes so it reads as an accent ON dark; using it as a BACKGROUND inverts
   * that relationship, and inherited white then sits on a pale blue. A token is readable in one direction
   * only — which is exactly what the paired `--on-*` tokens are for.
   *
   * ⚠️ IT COULD NOT HAVE BEEN CAUGHT ON AN EMPTY ACCOUNT: `seg()` returns '' when the count is zero, so with
   * no chits there is no segment, no text, and nothing to measure. This is the bug M3 was worth doing for.
   */
  var seg = function (n, col, on) {
    return n ? '<span style="background:' + col + ';color:' + on + ';width:' + (n / t) * 100 + '%">' + n + '</span>' : '';
  };
  return (
    '<div class="misstack">' +
    seg(m.open, 'var(--blue)', 'var(--on-accent)') +
    seg(m.in_progress, 'var(--prog)', 'var(--on-warn)') +
    seg(m.closed, 'var(--ok)', 'var(--on-ok)') +
    '</div>' +
    '<div class="miskey"><span class="k"><i class="sw" style="background:var(--blue);color:var(--on-accent)"></i> ' +
    tx('Open') +
    '</span>' +
    '<span class="k"><i class="sw" style="background:var(--prog);color:var(--on-warn)"></i> ' +
    tx('In progress') +
    '</span>' +
    '<span class="k"><i class="sw" style="background:var(--ok);color:var(--on-ok)"></i> ' +
    tx('Closed') +
    '</span></div>'
  );
}
/* A real series off created_at — no invented shape. Flat line when there is only one bucket, which is honest. */
function _misSpark(series) {
  if (!series || series.length < 2) return '<div class="misnote">Not enough history yet for a trend — one bucket of data.</div>';
  var max =
    Math.max.apply(
      null,
      series.map(function (item) {
        return item.n;
      })
    ) || 1;
  var text = series
    .map(function (item, index) {
      var x = 6 + index * (288 / (series.length - 1));
      return Math.round(x) + ',' + Math.round(50 - (item.n / max) * 42);
    })
    .join(' ');
  var last = text.split(' ').pop().split(',');
  return (
    '<svg class="misspark" viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label="Chits per period, latest ' +
    series[series.length - 1].n +
    '">' +
    '<polyline points="' +
    text +
    '" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' +
    last[0] +
    '" cy="' +
    last[1] +
    '" r="4" fill="var(--blue)" stroke="#fff" stroke-width="2"/></svg>'
  );
}

function misPosition(m) {
  var tot = m.committed + m.forecast;
  var pct = tot ? Math.round((m.committed / tot) * 100) : 0;
  return (
    _misHead('Position', 'How much of the pipeline is authoritative, and how much is still a forecast.') +
    '<div class="mistwo"><div>' +
    '<div class="mislbl">' +
    tx('Committed · someone said yes') +
    '</div>' +
    '<div class="mishero">' +
    misMoney(m, m.committed) +
    '</div>' +
    '<div class="misnote">' +
    pct +
    '% of the book is authoritative — accepted, in progress or completed.</div>' +
    _misSplitBar(m) +
    '</div><div>' +
    '<div class="mislbl">' +
    tx('Forecast · nobody has committed') +
    '</div>' +
    '<div class="misfore">' +
    misMoney(m, m.forecast) +
    '</div>' +
    '<div class="misnote" style="margin-top:7px">Sent or received but not yet accepted. Real work — nobody has promised it.</div>' +
    (m.dead ? '<div class="miswarn">' + misMoney(m, m.dead) + ' on cancelled or rejected chits, counted in neither.</div>' : '') +
    '</div></div>' +
    '<div class="miswhy">The old screen showed <b>' +
    misMoney(m, m.committed + m.forecast + m.dead) +
    '</b> as one “deal value”, blending all three — which <b>overstates the book</b>.</div>'
  );
}
function misFlow(m) {
  return (
    _misHead('Flow', 'What is moving through the rail, and at what rate.') +
    '<div class="mistwo"><div>' +
    '<div class="mislbl">' +
    tx('Chits by state') +
    '</div><div class="misbig">' +
    m.chits +
    '</div>' +
    _misStack(m) +
    '<div class="miswhy">Three peer tiles hid that <b>' +
    m.open +
    ' + ' +
    m.in_progress +
    ' + ' +
    m.closed +
    ' = ' +
    m.chits +
    '</b>.</div>' +
    '</div><div>' +
    '<div class="mislbl">Chits per ' +
    esc(m.bucketName) +
    '</div>' +
    '<div class="misbig">' +
    m.chits +
    (m.delta ? ' <span class="misdelta">▲ ' + m.delta + '</span>' : '') +
    '</div>' +
    _misSpark(m.series) +
    '</div></div>'
  );
}
/* Ageing as a distribution, not a number — the oldest bucket carries the warning tone because that is the one
   worth acting on. An empty bucket renders as a flat rule rather than vanishing, so the scale stays readable. */
function _misAgeing(m) {
  const tot = m.waiting.length;
  if (!tot) return '';
  const max =
    Math.max.apply(
      null,
      m.ageing.map(function (item) {
        return item.n;
      })
    ) || 1;
  const cells = m.ageing
    .map(function (item, index) {
      const warn = index >= 2 && item.n > 0;
      return (
        '<div class="misage' +
        (warn ? ' warn' : '') +
        '">' +
        '<div class="misagebar"><i style="height:' +
        Math.round((item.n / max) * 100) +
        '%"></i></div>' +
        '<div class="misagen">' +
        item.n +
        '</div><div class="misagek">' +
        item.k +
        '</div></div>'
      );
    })
    .join('');
  return '<div class="mislbl" style="margin-top:16px">Ageing · how long they have waited</div>' + '<div class="misageing">' + cells + '</div>';
}
/**
 * ⭐⭐ OVERDUE — the number MIS did not have (backlog 29).
 *
 * `overdue` is a POLICY, not an opinion: `overdue_days` is set in Settings and obeyed by the folder Metrics pane
 * and the counterparty scorecard, both reading lib/measure.js. MIS — the screen titled *"What is stuck?"* — never
 * mentioned it, so setting overdue to 3 days changed every other surface and left this one exactly as it was.
 *
 * ⚠️ IT SAYS THE THRESHOLD OUT LOUD. "6 overdue" is unfalsifiable on its own; "6 past 7 days" can be checked, and
 * tells the reader that the number moves when the policy moves rather than when the business does.
 *
 * ⚠️ WHEN THE MEASUREMENT IS UNAVAILABLE IT SAYS SO. It does NOT fall back to counting in the browser — a silent
 * second implementation is exactly the drift this replaced, and the fallback would be invisible precisely when
 * the two disagree.
 */
function _misOverdue(m) {
  var s = m.srv;
  if (!s || !s.all) {
    return (
      '<div class="misnote" style="margin-top:14px">⚠️ Overdue is unavailable — the server measurement could not be read. ' +
      txf('It is deliberately {not} as shown in the folder pane.', { not: '<b>' + tx('not') + '</b>' }) +
      '</div>'
    );
  }
  var n = s.all.overdue || 0,
    d = s.overdue_days;
  var mine = (s.received && s.received.overdue) || 0,
    theirs = (s.sent && s.sent.overdue) || 0;
  return (
    '<div class="mislbl" style="margin-top:16px">Overdue · past ' +
    esc(String(d)) +
    ' day' +
    (d === 1 ? '' : 's') +
    '</div>' +
    '<div class="misstatus">' +
    (n
      ? '<i class="dot" style="background:var(--disp);color:var(--on-danger)"></i> <b>' + n + ' overdue</b>'
      : '<i class="dot" style="background:var(--ok);color:var(--on-ok)"></i> <b>' + tx('Nothing overdue') + '</b>') +
    '<span class="misnote" style="margin-inline-start:8px">· ' +
    mine +
    ' received · ' +
    theirs +
    ' sent</span></div>' +
    '<div class="misnote" style="margin-top:4px">The threshold is the <b data-cbsid="INS001-C03" onclick="navTo(\'settings\')" style="cursor:pointer;color:var(--blue)">overdue policy</b> — ' +
    'the same one the folder pane and the supplier scorecard obey, so all three move together.</div>'
  );
}
function _misUnattended(m) {
  const u = m.unattended || [];
  if (!u.length) return '<div class="misnote" style="margin-top:14px">✓ No unanswered messages.</div>';
  const rows = u
    .slice(0, 4)
    .map(function (x) {
      return (
        '<div class="misunrow"><span class="misunage">' +
        esc(x.age) +
        '</span>' +
        '<span class="misuntxt"><b>' +
        esc(x.from) +
        '</b> — ' +
        esc(x.text) +
        '</span></div>'
      );
    })
    .join('');
  return (
    '<div class="mislbl" style="margin-top:16px">Unanswered messages · ' +
    u.length +
    ' waiting on you</div>' +
    '<div class="misunatt">' +
    rows +
    (u.length > 4 ? '<div class="misnote" style="padding:6px 0 0">…and ' + (u.length - 4) + ' more.</div>' : '') +
    '</div>'
  );
}
function misFriction(m) {
  var rows = m.waiting
    .slice(0, 12)
    .map(function (item) {
      return (
        '<tr><td>' +
        esc(item.on) +
        '</td><td>' +
        esc(item.subject) +
        '</td><td class="num">' +
        esc(item.age) +
        '</td>' +
        '<td class="num">' +
        (item.costHidden ? tx('hidden') : item.amt ? inr(item.amt) : '—') +
        '</td>' +
        '<td><span class="misclock ' +
        item.who +
        '">◷ ' +
        (item.who === 'mine' ? 'Mine' : 'Theirs') +
        '</span></td></tr>'
      );
    })
    .join('');
  return (
    _misHead('Friction', 'Where time is being lost — and whose clock is running.') +
    '<div class="misstatus">' +
    (m.open_disputes
      ? '<i class="dot" style="background:var(--disp);color:var(--on-danger)"></i> <b>' +
        m.open_disputes +
        ' open dispute' +
        (m.open_disputes === 1 ? '' : 's') +
        '</b>'
      : '<i class="dot" style="background:var(--ok);color:var(--on-ok)"></i> <b>' + tx('No open disputes') + '</b>') +
    '<span class="misnote" style="margin-inline-start:8px">· ' +
    m.chits +
    ' chits · ' +
    (m.open_disputes ? 'needs resolving' : 'nothing to resolve') +
    '</span></div>' +
    _misOverdue(m) +
    _misAgeing(m) +
    _misUnattended(m) +
    (rows
      ? '<div class="mislbl" style="margin-top:18px">' +
        tx('The queue · oldest first') +
        '</div>' +
        '<div class="misscroll"><table class="mistable"><thead><tr><th>' +
        tx('Waiting on') +
        '</th><th>' +
        tx('Chit') +
        '</th><th>' +
        tx('Age') +
        '</th><th>' +
        tx('Value') +
        '</th><th>' +
        tx('Whose clock') +
        '</th></tr></thead><tbody>' +
        rows +
        '</tbody></table></div>'
      : '<div class="misnote" style="margin-top:12px">Nothing is waiting — every chit has been accepted or closed.</div>') +
    /* ⭐ DESIGN RATIONALE → SPEC. Why a dispute is shown as a status rather than a number is a good decision
       and not one the reader has to agree with before using the screen. */
    specNote(
      'mis.disputes-as-status',
      'Disputes are a <b>status</b>, not a count: a plain <b>0</b> tile reads exactly like <b>Suppliers 2</b>, ' +
        'when one is a health signal and the other is inventory.'
    )
  );
}
function misTrust(m) {
  var chan = m.byChannel;
  var chanTxt = Object.keys(chan).length
    ? Object.keys(chan)
        .map(function (item) {
          return chan[item] + ' by ' + esc(item);
        })
        .join(' · ')
    : 'none captured — everything entered by hand';
  return (
    _misHead('Trust', 'Who you deal with, and how the work reaches you.') +
    '<div class="mistrust">' +
    '<div><div class="mislbl">' +
    tx('Counterparties') +
    '</div><div class="misbig" style="font-size:var(--fs-5)">' +
    m.parties +
    '</div>' +
    '<div class="misnote">' +
    (m.partyNames.length ? esc(m.partyNames.slice(0, 3).join(' · ')) : 'no counterparties yet') +
    '</div></div>' +
    '<div><div class="mislbl">' +
    tx('Suppliers on your list') +
    '</div><div class="misbig" style="font-size:var(--fs-5)">' +
    m.suppliers +
    '</div>' +
    '<div class="misnote">' +
    m.co_assists +
    ' co-assist' +
    (m.co_assists === 1 ? '' : 's') +
    ' working the rail</div></div>' +
    '<div><div class="mislbl">' +
    tx('How work arrives') +
    '</div><div class="misbig" style="font-size:var(--fs-5)">' +
    m.captured +
    ' <span style="font-size:var(--fs-2);color:var(--grey)">of ' +
    m.chits +
    '</span></div>' +
    '<div class="misnote">' +
    chanTxt +
    '</div></div>' +
    '</div>' +
    /* ⚠️ The band I most want and have NOT verified is computable. Say so rather than show a score I cannot stand behind. */
    '<div class="miswhy">' +
    txf(
      '⚠️ {what} — who confirms fast, who delivers short — is the most valuable thing this could report, and is {notbuilt}. Shown as plain counts, not a score.',
      {
        what: '<b>' + tx('Counterparty reliability') + '</b>',
        notbuilt: '<b>' + tx('not built') + '</b>'
      }
    ) +
    '</div>'
  );
}
/**
 * ⭐ USAGE AGAINST THE DECLARED PLAN. The limits come from PLAN (declared in Governance → Constitution); this band
 * only measures. One declaration, one report.
 *
 * ⚠️ IT SAYS WHAT IT CANNOT COUNT. `Networks formed` and `Data stored` have no client-side source, so they say so
 * instead of rendering `0` — which would read as "you have none" rather than "we did not look". That distinction
 * is the same one the supplier search makes between "not listed" and "can't tell", and the `—` these rows used to
 * show on the governance card is exactly the ambiguity being removed.
 */
function misPlan(m) {
  var meter = function (label, used, limit, note) {
    if (limit == null)
      return (
        '<div class="govrow"><span class="govrow-k">' +
        esc(label) +
        '</span>' +
        '<span class="govrow-v" style="color:var(--grey)">' +
        esc(note || 'not counted here') +
        '</span></div>'
      );
    var pct = Math.min(100, Math.round((used / limit) * 100));
    var tone = pct >= 100 ? 'var(--disp)' : pct >= 80 ? 'var(--prog)' : 'var(--blue)';
    return (
      '<div class="misplanrow"><div class="misplanhead"><span>' +
      esc(label) +
      '</span>' +
      '<span class="misplanv">' +
      used +
      ' <span style="color:var(--grey);font-weight:600">of ' +
      limit +
      '</span></span></div>' +
      '<div class="misplanbar"><i style="width:' +
      pct +
      '%;background:' +
      tone +
      '"></i></div></div>'
    );
  };
  var todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  var chitsToday = (UI._misStamps || []).filter(function (item) {
    return item >= todayStart.getTime();
  }).length;
  /**
   * The subscription window, when there is one. ⚠️ It says "no period recorded" rather than assuming open-ended —
   * a plan with no dates and a plan valid forever look identical on screen but are not the same claim, and only
   * one of them is true here.
   */
  var w = planWindow();
  var period = !w
    ? '<span class="govtag" style="background:var(--warn-tint);color:var(--warn-3)">no period recorded</span>'
    : w.state === 'expired'
      ? '<span class="govtag" style="background:var(--danger-tint);color:var(--disp)">expired ' + w.days + 'd ago</span>'
      : w.state === 'not yet started'
        ? '<span class="govtag" style="background:var(--warn-tint);color:var(--warn-3)">starts in ' + w.days + 'd</span>'
        : '<span class="govtag" style="background:var(--ok-tint);color:var(--disp)">active' + (w.days != null ? ' · ' + w.days + 'd left' : '') + '</span>';
  return (
    _misHead('Plan', 'What you have used against the limits your plan declares.') +
    '<div class="misnote" style="margin-bottom:10px">' +
    period +
    '</div>' +
    '<div class="misnote" style="margin-bottom:12px"><b>' +
    esc(PLAN.tier) +
    '</b> plan · limits declared in ' +
    '<b data-cbsid="INS001-C04" onclick="navTo(\'settings\');UI.setSec=\'governance\';UI.govTab=0" style="cursor:pointer;color:var(--blue)">Governance <span class=arw>→</span> Constitution <span class=arw>→</span></b></div>' +
    meter('Entities', 1, PLAN.entities) +
    meter('Chits today', chitsToday, PLAN.chitsPerDay) +
    meter('Networks formed', 0, null, 'not counted on this screen') +
    meter('Data stored', 0, null, 'not counted on this screen') +
    '<div class="miswhy">These four sat on the governance card as <b>metered</b> rows, two of them showing ' +
    '<b>—</b> while this screen counted chits. Your plan sets the limit; this is what you have used.</div>'
  );
}
function misOverview(m) {
  var sec = function (name, q, inner) {
    return (
      '<div class="misov"><div class="misovh"><span class="misovn">' + esc(name) + '</span><span class="misnote">' + esc(q) + '</span></div>' + inner + '</div>'
    );
  };
  var tot = m.committed + m.forecast,
    pct = tot ? Math.round((m.committed / tot) * 100) : 0;
  return (
    _misHead('Overview', '') +
    sec(
      'Position',
      'How much of the pipeline is real?',
      '<div class="mistwo"><div><div class="mishero" style="font-size:var(--fs-6)">' +
        misMoney(m, m.committed) +
        '</div>' +
        '<div class="misnote">committed · ' +
        pct +
        '% of the book</div></div><div>' +
        _misSplitBar(m) +
        '</div></div>'
    ) +
    sec('Flow', 'What is moving through the rail?', '<div class="mistwo"><div>' + _misStack(m) + '</div><div>' + _misSpark(m.series) + '</div></div>') +
    sec(
      'Friction',
      'Where is time being lost?',
      '<div class="misstatus">' +
        (m.open_disputes
          ? '<i class="dot" style="background:var(--disp);color:var(--on-danger)"></i> <b>' + m.open_disputes + ' open</b>'
          : '<i class="dot" style="background:var(--ok);color:var(--on-ok)"></i> <b>' + tx('No open disputes') + '</b>') +
        '<span style="margin-inline-start:9px">' +
        (m.waiting.length
          ? '<b>' +
            m.waiting.length +
            ' waiting</b> — ' +
            m.waitTheirs +
            ' on <span class="misclock theirs">' +
            tx('◷ Theirs') +
            '</span> ' +
            m.waitMine +
            ' on <span class="misclock mine">' +
            tx('◷ Mine') +
            '</span>'
          : 'nothing waiting') +
        '</span></div>' +
        ((m.unattended || []).length
          ? '<div class="misnote" style="margin-top:6px">⚠ <b>' +
            m.unattended.length +
            ' unanswered message' +
            (m.unattended.length === 1 ? '' : 's') +
            '</b> — oldest ' +
            esc(m.unattended[0].age) +
            '</div>'
          : '') +
        _misAgeing(m)
    ) +
    sec(
      'Trust',
      'Who can I rely on?',
      '<div class="misnote"><b>' +
        m.parties +
        ' counterparties</b> · ' +
        m.captured +
        ' of ' +
        m.chits +
        ' chits captured from a channel · ' +
        m.suppliers +
        ' suppliers</div>'
    )
  );
}

/**
 * ── ⚠️⚠️⚠️ SEVEN ENDPOINTS, FETCHED TWICE, EVERY TIME ─────────────────────────────────────────────────────────
 *
 * Measured by the speed walk on 2026-09-13: MIS made `inbox`, `sent`, `disputeQueue`, `actors`, `supList`,
 * `misMsgs` and `misMetrics` TWICE on one visit — six seconds of round trips for a screen that had already
 * finished loading once.
 *
 * ⚠️ AND NOTHING WAS WRONG WITH THIS FUNCTION. `renderApp()` calls it whenever the nav is `mis`, and renderApp
 * runs more than once on arrival — the capability lands and `bgRenderApp()` paints again. Every screen that
 * loads from renderApp has this shape; the catalogue had it, was measured, and got a latch (`UI._prodReq`) in
 * September. This is the same latch, and the same reason.
 *
 * ⭐ ONE READ IN FLIGHT. A second caller joins the first rather than starting another; nobody has to know how
 * many times the app decided to paint. [[feedback-no-duplicate-functions]]
 */
async function loadMIS(force) {
  if (!document.getElementById('mis_rail')) return;
  if (UI._misReq) return UI._misReq;
  /**
   * ⚠️⚠️ A LATCH ALONE DID NOT FIX IT, AND THE RE-MEASUREMENT SAID SO. An in-flight latch joins a SECOND
   * caller to a FIRST that is still running; renderApp's two passes are far enough apart that the first had
   * already finished, so the second started cleanly and the seven calls went out again.
   * ⭐ So the model is also FRESH for ten seconds. Ten is chosen against what it is protecting: two paints of
   * one arrival, which are a second apart at worst. A person who waits ten seconds and expects new numbers
   * gets them; the twenty-second auto-refresh is untouched, and every deliberate re-read passes `force`.
   */
  if (!force && UI._mis && UI._misAt && Date.now() - UI._misAt < 10000) return;
  UI._misReq = _loadMIS().finally(function () {
    UI._misReq = null;
  });
  return UI._misReq;
}
async function _loadMIS() {
  try {
    /* ⚠️ BOTH SIDES, NOT JUST inbox. "Whose clock" is unanswerable from received copies alone — everything would
       read as mine. Merged by id so a self-chit, which lands in both, is counted once. */
    /* ⚠️ The window is computed BEFORE the fetch because the server has to measure the same one — see `since`
       below. A period selector on screen beside a figure measured over all time is worse than no selector. */
    const _days = misPeriod() === 'all' ? null : parseInt(misPeriod(), 10);
    const _since = misWindow(misPeriod()); /* ONE window rule (app/cap-mis.js, T3-P4-ACCOUNT): the same `since` CB Finance › Reports sends */
    const [inb, snt, dq, ac, sp, msgRaw, srv] = await Promise.all([
      api('inbox'),
      api('sent').catch(function () {
        return [];
      }),
      api('disputeQueue').catch(function () {
        return {};
      }),
      api('actors').catch(function () {
        return [];
      }),
      api('supList').catch(function () {
        return [];
      }),
      api('misMsgs').catch(function () {
        return [];
      }),
      /* ⚠️ Fails SOFT to null, not to a client-computed substitute. If the measurement is unavailable the screen
         must say the number is unavailable — quietly falling back to a second implementation is precisely the
         drift this endpoint exists to end, and it would be invisible. */
      api('misMetrics', { query: { since: _since } }).catch(function () {
        return null;
      })
    ]);
    const seen = {},
      chits = [];
    (inb || []).concat(snt || []).forEach(function (item) {
      const c = mapApiChit(item);
      if (!c || seen[c.id]) return;
      seen[c.id] = 1;
      c._iSent = !!SESSION.entity && (c.sender || '') === SESSION.entity;
      chits.push(c);
    });

    const cutoff = _since ? Date.parse(_since) : null;
    const inWindow = chits.filter(function (item) {
      return !cutoff || new Date(item.created_at).getTime() >= cutoff;
    });

    let committed = 0,
      forecast = 0,
      dead = 0;
    const byState = { open: 0, act: 0, close: 0 };
    const byChannel = {};
    let captured = 0;
    const parties = {};
    const waiting = [];
    const now = Date.now();
    inWindow.forEach(function (item) {
      const st = item._status || 'pending',
        amt = item.amt || 0;
      if (MIS_DEAD[st]) dead += amt;
      else if (MIS_COMMITTED[st]) committed += amt;
      else if (MIS_FORECAST[st]) forecast += amt;
      byState[item.state] = (byState[item.state] || 0) + 1;
      if (item.via && item.via.channel) {
        captured++;
        byChannel[item.via.channel] = (byChannel[item.via.channel] || 0) + 1;
      }
      const other = item._iSent ? item.party || '' : item.sender || item.party || '';
      if (other && other !== SESSION.entity) parties[other] = 1;
      if (MIS_FORECAST[st]) {
        const ageMs = now - new Date(item.created_at).getTime();
        const d = Math.floor(ageMs / 864e5),
          h = Math.floor(ageMs / 36e5);
        waiting.push({
          on: 'Acceptance',
          subject: item.code || '—',
          amt: amt,
          ageMs: ageMs,
          age: d >= 1 ? d + 'd' : h + 'h',
          /* I sent it → they owe the answer. It came to me → the clock is mine. */
          who: item._iSent ? 'theirs' : 'mine'
        });
      }
    });
    waiting.sort(function (first, second) {
      return second.ageMs - first.ageMs;
    });

    /* Weekly buckets when the span is wide, daily when it is short — a 7-day window has no weeks in it. */
    /* Kept for the Plan band, which counts against a per-DAY limit and so cannot use the period-windowed series. */
    UI._misStamps = chits
      .map(function (item) {
        return new Date(item.created_at).getTime();
      })
      .filter(function (item) {
        return item;
      });
    {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      UI._misToday = UI._misStamps.filter(function (item) {
        return item >= date.getTime();
      }).length;
    }
    const stamps = inWindow
      .map(function (item) {
        return new Date(item.created_at).getTime();
      })
      .filter(function (item) {
        return item;
      })
      .sort();
    let series = [],
      bucketName = 'week';
    if (stamps.length) {
      const spanDays = (stamps[stamps.length - 1] - stamps[0]) / 864e5;
      const size = spanDays > 21 ? 7 : 1;
      bucketName = size === 7 ? 'week' : 'day';
      const buckets = {};
      stamps.forEach(function (item) {
        const b = Math.floor((item - stamps[0]) / (size * 864e5));
        buckets[b] = (buckets[b] || 0) + 1;
      });
      const maxB = Math.max.apply(null, Object.keys(buckets).map(Number));
      for (let index = 0; index <= maxB; index++) series.push({ n: buckets[index] || 0 });
    }
    const delta = series.length >= 2 ? series[series.length - 1].n - series[series.length - 2].n : 0;

    /**
     * ⭐ AGEING + UNATTENDED (Athi, 2026-08-16: *"can we bring aging, message unattended etc"*).
     *
     * Ageing is the classic receivables question asked of the rail: not "how many are waiting" but "how long have
     * they been waiting", because a day-old wait and a fortnight-old wait are not the same fact and a single count
     * hides which you have.
     *
     * ⚠️ AN UNANSWERED MESSAGE IS TIME LOST TOO, and it was invisible here. A counterparty asking "can you deliver
     * before 7pm" and getting no reply is exactly the friction this band exists to surface — it just never had a
     * chit status to show up under. Inbound and unread, aged the same way; messages I sent are not my delay.
     */
    const AGE_BUCKETS = [
      { k: '<1d', max: 1 },
      { k: '1–3d', max: 3 },
      { k: '3–7d', max: 7 },
      { k: '7d+', max: Infinity }
    ];
    const ageing = AGE_BUCKETS.map(function (item) {
      return { k: item.k, n: 0 };
    });
    waiting.forEach(function (item) {
      const d = item.ageMs / 864e5;
      for (let index = 0; index < AGE_BUCKETS.length; index++) {
        if (d < AGE_BUCKETS[index].max) {
          ageing[index].n++;
          break;
        }
      }
    });

    const msgs = (msgRaw && (msgRaw.messages || msgRaw.items || (Array.isArray(msgRaw) ? msgRaw : []))) || [];
    const unattended = msgs
      .filter(function (item) {
        /* Unread AND not mine — my own outbound message sitting unread is THEIR clock, not a task of mine. */
        return !item.read_at && item.sender_entity_id !== SESSION.entityId;
      })
      .map(function (item) {
        const ms = now - new Date(item.created_at).getTime();
        const d = Math.floor(ms / 864e5),
          h = Math.floor(ms / 36e5);
        return {
          from: item.sender_display_name || '—',
          text: (item.message_text || '').slice(0, 90),
          subject: item.manual_subject || item.auto_subject || '—',
          ageMs: ms,
          age: d >= 1 ? d + 'd' : h + 'h'
        };
      })
      .sort(function (first, second) {
        return second.ageMs - first.ageMs;
      });

    const openDisp = dq.total_open != null ? dq.total_open : (dq.my_disputes || []).length + (dq.other_disputes || []).length;
    /* ⚠ stamped so the freshness guard above has something to measure against */
    UI._misAt = Date.now();
    UI._mis = {
      chits: inWindow.length,
      committed: committed,
      forecast: forecast, hidden: misAnyHidden(inWindow) /* RAIL-146: some rows carried no money (stripped for a cost-blind co-assist) */,
      dead: dead,
      open: byState.open,
      in_progress: byState.act,
      closed: byState.close,
      open_disputes: openDisp,
      co_assists: (ac || []).length,
      suppliers: (sp || []).length,
      parties: Object.keys(parties).length,
      partyNames: Object.keys(parties),
      captured: captured,
      byChannel: byChannel,
      waiting: waiting,
      waitMine: waiting.filter(function (item) {
        return item.who === 'mine';
      }).length,
      waitTheirs: waiting.filter(function (item) {
        return item.who === 'theirs';
      }).length,
      ageing: ageing,
      unattended: unattended,
      series: series,
      bucketName: bucketName,
      delta: delta > 0 ? delta : 0,
      /* ⭐ THE SERVER'S MEASUREMENT (backlog 29) — the same lib/measure.js the folder pane and the counterparty
         scorecard read, so all three now agree by construction rather than by coincidence. `srv` is null when
         the call failed; every reader must handle that rather than fall back to a second implementation. */
      srv: srv,
      periodLabel: misPeriod() === 'all' ? 'all time' : 'last ' + misPeriod() + 'd',
      asOf: misReadAt(Date.now()) /* "live · 10:32" — the same stamp CB Finance › Reports paints (cap-mis.js, loaded with this capability) */,
      currency: moneyCode()
    };
    const node = document.getElementById('misbody');
    if (node) node.innerHTML = misBandHTML(misBand(), UI._mis);
    const r = document.getElementById('mis_rail');
    if (r)
      r.innerHTML = MIS_BANDS.map(function (item) {
        const sel = misBand() === item.key ? ' sel' : '',
          hv = misHeadline(item.key, UI._mis);
        return (
          '<div data-cbsid="INS001-C05" class="row misrow' +
          sel +
          '" data-testid="mis-band-' +
          item.key +
          '" onclick="misSetBand(\'' +
          item.key +
          '\')">' +
          '<div class="main2"><div class="l1"><span class="code">' +
          esc(item.name) +
          '</span></div><div class="l2">' +
          esc(item.q) +
          '</div></div>' +
          '<div class="misval' +
          (hv.tone ? ' ' + hv.tone : '') +
          '">' +
          hv.v +
          '<small>' +
          esc(hv.s) +
          '</small></div></div>'
        );
      }).join('');
  } catch (e) {
    const node = document.getElementById('misbody');
    if (node) node.innerHTML = scrErr(e);
  }
}

/* ---- PROFILE ---- */
/* ═══ PROFILE ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Same two-pane grammar as MIS, Task and Suppliers — sections on the left, the selected section on the right.
 * It was one long scroll of four unrelated cards (identity, storefront, governance, vault) with no way to tell
 * where one ended and the next began, which is how the storefront's "Is your shop open?" came to sit a few
 * hundred pixels under identity's "Shop status" and read as its contradiction.
 */
var PROF_SECS = [
  /**
   * ⭐⭐ IAM — and the NAME is the small part. Athi asked for "Identity" to become IAM with five identity
   * classes (entity · employee · customer · supplier · IoT/AI/ERP), then said: *"do not take my words as
   * decision, think and provide a better alternate if possible."*
   *
   * ⚠️ THE FIVE-CLASS TABLE WOULD HAVE BEEN WRONG, and wrong in a way that contradicts the product. Of those
   * five, this business ADMINISTERS exactly two — itself and its co-assists (machines are co-assists; same
   * table, different actor_type). A customer self-identifies with a one-time code. A supplier is another
   * business with its own IAM. Five rows with an "Access" column implies you grant access to all five; you
   * cannot, so three would sit permanently empty and read as "not built yet" rather than "not yours to set".
   *
   * ⭐ SO IT IS STRUCTURED BY BOUNDARY — inside · at the edge · outside. That is the same sovereignty the rest
   * of the rail rests on, and it turns the asymmetry from an apology into the content.
   */
  { key: 'identity', name: 'IAM', q: 'Who can act, and what they may do' },
  { key: 'storefront', name: 'Storefront', q: 'What customers can see' },
  /* ⚠️ NOT "Governance" — Settings has a section by that name too, and two rows with one name in two screens is
     a collision even when the content differs. This one is your RESOLVED position (Governed by · Basics · Rights ·
     Allowances · Jurisdiction); the Settings one is the 7-layer model those values descend from. */
  { key: 'governance', name: 'Your rights', q: 'What this entity may do' },
  { key: 'vault', name: 'Documents', q: 'Fill forms once, reuse' }
];
function profSec() {
  return UI.profSec || 'identity';
}
/**
 * ⚠️ REPAINT THE BODY DIRECTLY — do not rely on the post-render hook. renderApp() rewrites the pane to its
 * "loading…" placeholder and the `if(UI.nav==="profile") loadProfile()` hook fires while #profbody is not yet in
 * the document, so loadProfile's `if(!h) return` bailed and every section sat on the spinner forever. It worked on
 * FIRST entry only, because arriving at the screen triggers a second render that the section switch does not.
 */
/* ⚠️ THE OLD profSetSec LIVED HERE — it switched PANES. The rail it drove is gone (see profileScreen), so the
   pane-switching version was dead the moment the sections absorbed it, and a duplicate definition means the
   earlier one silently never runs. The surviving shim, below, opens the matching accordion instead. */

/**
 * ⚠️ THE TWO-SIDED PANEL IS THE SHAPE, AND IT IS NOT NEGOTIABLE PER SCREEN (Athi, 2026-08-16: *"it has to be
 * uniform two sided, so it nicely works in phone as well"*). I briefly made this tabs because the rail sits
 * ~75% empty on a desktop viewport — which traded a real density gain for the thing that actually matters:
 * every screen behaving the same way, and list→tap→detail→back being the mobile pattern throughout. A screen
 * that is uniform everywhere beats a screen that is optimal once. Density is fixed by the pane, not by the shape.
 */
/**
 * ⚠️⚠️ THE RAIL IS GONE, AND KEEPING IT WOULD HAVE BEEN THE VERY DUPLICATION ATHI ASKED ME TO REMOVE.
 *
 * He said the other three panels *"can come over to the first page itself"*, and I folded Storefront, Rights
 * and Documents into iamHTML as sections — while leaving the left rail still listing those same four names.
 * The screen would have offered every one of them twice, in two different interaction styles, which is worse
 * than the repetition I was sent to remove. Found by reviewing my own change rather than by anyone seeing it.
 *
 * ⭐ ONE PANE FOR EVERYONE NOW — the same shape an actor already had. loadProfile fills #profbody, and the
 * sections inside it are the navigation.
 */
function profileScreen() {
  return scr('👤 Profile', 'profbody', 'profile');
}

/**
 * ⚠️ profSetSec SURVIVES AS A SHIM, because four call sites still ask for a section by name — a nav link, the
 * storefront cross-reference, and the naming-rules pointer. With the rail gone the honest translation is to
 * OPEN the matching accordion rather than to switch panes, so an old link still lands the reader on the thing
 * it promised. Deleting it would have left four dead links pointing at nothing.
 */
var _SEC_TO_ACCORDION = { identity: 'ident', storefront: 'governed', governance: 'rights', vault: 'docs' };
function profSetSec(k) {
  var key = _SEC_TO_ACCORDION[k] || 'ident';
  UI._iamOpen = UI._iamOpen || {};
  UI._iamOpen[key] = true;
  UI.nav = 'profile';
  renderApp();
  _capShowDetail();
  loadProfile();
}

/**
 * ⚠️ ONE READ AT A TIME. The post-render hook fires loadProfile on EVERY render, and a section switch renders —
 * so with the API at ~3.6s a round trip, switching sections stacked four and five identical `me` reads and the
 * pane sat on its spinner behind all of them. The in-flight guard makes the extra renders free.
 */
let _profBusy = false;
/**
 * ⭐ SEED THE THREE SUB-LOADERS FROM THE ONE RESPONSE, and set their latches so they do not fetch again.
 *
 * ⚠⚠ EACH SHAPE IS TAKEN FROM ITS OWN LOADER, NOT GUESSED. The channels one especially: the bound addresses
 * live in `channels[].bindings[]`, NOT in `channels[]` — that array is the CATALOGUE OF TYPES (whatsapp · email
 * · sms · web) and each type carries its own bindings. Guessing it once already produced a profile that
 * rendered four type objects with no address and no status, and a test fixture built on the same guess so it
 * passed while the screen was blank. Copied from the loader, deliberately, rather than re-derived.
 *
 * ⚠️ A FAILED INCLUDE MUST NOT LATCH. The server reports a broken part as `{ error }` in place, so the
 * profile still paints without it — but leaving the latch UNSET means the section's own loader will try again
 * when it renders. Bundling must not turn a retryable gap into a permanent one.
 */
function _profSeedIncluded(e) {
  var inc = e && e.included;
  if (!inc) return;
  var ok = function (v) {
    return v && !v.error;
  };

  if (ok(inc.readiness)) {
    UI._rdSum = inc.readiness.summary || null;
    UI._rdSumLoaded = true;
  }

  if (ok(inc.channels)) {
    UI._chans = Array.isArray(inc.channels.channels)
      ? inc.channels.channels.reduce(function (all, item) {
          return all.concat(item.bindings || []);
        }, [])
      : null;
    UI._chansLoaded = true;
  }

  /* ⚠️ THE VAULT IS NOT LATCHED THE SAME WAY — loadVault() paints a host element as well as fetching, so it
     still runs when the vault section opens. Seeding the DATA means it paints immediately instead of showing
     a spinner for a round trip it no longer needs. */
  if (ok(inc.vault)) {
    UI._vault = { sections: (inc.vault.vault || {}).sections || [] };
    UI._vaultEnc = !!inc.vault.vault_encrypted;
    UI._vaultSeeded = true;
  }
}

async function loadProfile() {
  const node = document.getElementById('profbody');
  if (!node) return;
  if (SESSION.role === 'actor') return loadActorProfile(node); // actors get their own profile, not the entity's
  /* ⚠️ THE SNAPSHOT IS RE-TAKEN AFTER EVERY PAINT. A baseline captured once at load goes stale the first time
     a section is collapsed, and every later edit then reads as clean. See profSnapshot. */
  /**
   * ⚠️⚠️ SEED THE LATCHES HERE TOO, AND THIS IS THE WHOLE DEFECT. The one-read work below already collapses
   * /me + readiness + channels + vault into a single request — but only on the COLD path, after meTake().
   * /me is PREFETCHED at sign-in, so by the time anyone opens Profile  is usually already set and
   * this early return fires instead: the sub-loaders find their latches unset and each fetches on its own.
   *
   * ⭐ So the optimisation worked exactly on the path nobody takes, and silently degraded back to four reads
   * on the common one. Measured 2026-09-01: three extra requests (actors, readiness, channels) on a warm
   * open. _profSeedIncluded is defensive — no , or one that errored, simply leaves the latch alone.
   */
  if (UI._me) {
    _profSeedIncluded(UI._me);
    node.innerHTML = profSecHTML(profSec(), UI._me);
    if (profSec() === 'vault') loadVault();
    profSnapshot();
    return;
  }
  if (_profBusy) return;
  _profBusy = true;
  /**
   * ⭐⭐ ONE HTTP ROUND TRIP INSTEAD OF FOUR. Athi, 2026-08-21: *"why do we need a round trip, can't the js send
   * all the required information in one shot? We have built most of the stuff as lazy load, and for each lazy
   * load if we have to do a round trip, that will feel like waiting forever."*
   *
   * ⚠️⚠️ THIS SCREEN MADE FOUR SEPARATE FETCHES — /entities/me, /governance/readiness, /channels and
   * /governance/profile — because each was added by whoever needed it, in its own loader, each with its own
   * latch. Nothing was wrong with any one of them. From India to Railway that is 200–400ms EACH, so over a
   * second of network before the profile is complete, and the sections arrive one at a time in front of you.
   *
   * ⭐ THE SUB-LOADERS ARE NOT DELETED, and that is deliberate. iamLoadTrade / iamLoadChannels / loadVault stay
   * exactly as they are for every path that does not come through here — a section opened directly, a refresh
   * after a save, an actor profile. What changes is that their LATCHES are set from this response, so on the
   * common path they find the work already done and return without fetching.
   */
  /* ⭐ meTake() HANDS BACK THE REQUEST THAT WAS ALREADY IN FLIGHT, started at sign-in before this screen
     existed. If none is waiting it fetches exactly as before — the include list is identical, so the two paths
     cannot return different shapes. See mePrefetchStart in app.html. */
  try {
    const e = (await meTake()) || {};
    UI._me = e;
    _profSeedIncluded(e);
    /* ⚠️ RE-QUERY THE HOST AFTER THE AWAIT. bgRenderApp() rebuilds the screen wholesale, so a repaint that lands
       while this fetch is in flight — switching viewport, opening the menu — detaches the node captured above.
       Writing to that stale reference paints into a node no longer in the document and the panel stays blank
       with no error anywhere. Every await in this file that is followed by a DOM write has the same hazard. */
    const element = document.getElementById('profbody');
    if (!element) return;
    element.innerHTML = profSecHTML(profSec(), e);
    profSnapshot();
    if (profSec() === 'vault') loadVault(); // the trade documents vault (async — pre-fills authority forms)
  } catch (e) {
    const element = document.getElementById('profbody');
    if (element) element.innerHTML = scrErr(e);
  } finally {
    _profBusy = false;
  }
}

/**
 * ⭐ THE FOUR NAMES, AND WHICH ARE COMPULSORY (Athi, 2026-08-16: *"need to mention about user name context, entity
 * name, employee naming convention and end customer user name convention, what is must, what it means etc"*).
 *
 * ⚠️ EVERY RULE HERE IS READ OFF THE SERVER'S OWN VALIDATORS, not written from memory — `routes/entities.js`
 * (display_name, user_id), `routes/actors.js` (display_name, actor_key), `lib/bridgeid.js` (the alphabet), and
 * `routes/catalogue.js` (the customer row). If a validator changes and this text does not, this becomes the stale
 * copy the rest of today was spent removing. **Cite the file when you edit it.**
 */
/* ⚠️ NAMING lived here — the table that explained Bridge ID, User ID and the rest. Its only renderer
   (namingRulesHTML) went with the dead __iam_old branch, leaving it unreferenced data. Athi: *"in fact this
   information should not be appearing anywhere."* One reference survives at line ~3050 and it is a COMMENT
   pointing here — left deliberately, because the naming rules still exist, in NAMING.md and the API. */
/**
 * ⭐⭐ IAM — who can act for this business, and what each of them may do.
 *
 * ── WHY BOUNDARY, NOT CLASS ─────────────────────────────────────────────────────────────────────────────────
 *
 * Athi listed five classes and then said *"do not take my words as decision, think and provide a better
 * alternate if possible."* Testing his five against what this business actually ADMINISTERS:
 *
 *     this business    yes          co-assists       yes (machines are co-assists — same table, actor_type)
 *     customers        NO — they self-identify with a one-time code; you set terms, not identities
 *     suppliers        NO — another business, with its own IAM; you hold a relationship
 *
 * ⚠️ Five rows with an "Access" column implies you grant access to all five. You cannot. Three would sit
 * permanently empty, and an empty column reads as "not built yet" rather than "not yours to set" — which would
 * contradict the sovereignty the whole rail rests on. So the spine is INSIDE · EDGE · OUTSIDE, and the
 * asymmetry becomes the content instead of an apology.
 *
 * ── WHY TWO TABS ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * ⭐ Identity and access have DIFFERENT TRUTH VALUES, and one table would hide that. Naming is solid — the rules
 * are real and enforced by server validators. Access was a promise two-fifths kept until this afternoon: the hat
 * existed, was offered as a choice, and was enforced in two places out of ~130. One table would have rendered
 * "View-only" beside a real name and a real key, in the same weight, as though all three were equally true.
 *
 * They are also read on different days: naming is set up once, access is checked whenever someone arrives or
 * leaves.
 *
 * ── ⭐⭐ PROVENANCE IS A COLUMN, BECAUSE "WHY CAN'T I DO THIS?" IS THE REAL QUESTION ─────────────────────────
 *
 * Athi asked whether access is *"direct, derived and so on"*, and then *"what about network?"*. The network is
 * not a fourth bucket — it is the EDGE ACCESS FLOWS ALONG, and it appears in all three:
 *
 *     DIRECT    set on this identity, here          the hat · can_see_costs
 *     DERIVED   follows from WHERE YOU SIT          a co-assist's reach follows its node in the tree
 *     CAPPED    descends from your operator         "a store can be no more open than the thing it sits inside
 *                                                    — the narrowest wins" (lib/network-build.js)
 *     THEIRS    another business decided            not shown as a permission at all, because it is not ours
 *
 * ⚠️ DERIVED and CAPPED are the two nobody can find today, because no screen says "this is true because of where
 * you sit". Naming the provenance is what makes this page answer the question people actually ask.
 */
function iamTab() {
  return UI.iamTab || 'me';
}
/* setIamTab removed with the tab strip it drove — see iamHTML. */

/* ⚠️ SAME API AS CO-ASSISTS — Athi: "assume we need to have it in another place, then that has to be the same
   api and should behave the same way." This is `api('actors')`, the endpoint cap-workforce already uses, cached
   on UI so switching tabs does not re-fetch. IAM never writes an actor; it links to Co-assists to do that. */
async function iamLoadActors() {
  if (UI._iamActors) return UI._iamActors;
  try {
    UI._iamActors = (await api('actors', { query: { status: 'all' } })) || [];
  } catch (_) {
    UI._iamActors = [];
  }
  return UI._iamActors;
}

var IAM_HAT = {
  manager: ['Manager', 'acts, and assigns work to others'],
  act: ['Act', 'does the work'],
  audit: ['Audit', 'review only'],
  mis: ['MIS', 'reports'],
  view_only: ['View-only', 'read only']
};
var IAM_WRITES = ['act', 'manager'];

function iamHTML(e) {
  var Q = String.fromCharCode(39);
  var tab = iamTab();
  /* kick the fetch on first paint; the tab repaints when it lands */
  if (!UI._iamActors) {
    iamLoadActors().then(function () {
      if (profSec() === 'identity') {
        _capShowDetail();
        loadProfile();
      }
    });
  }

  /**
   * ⭐⭐ THREE TABS, AND THE FIRST ONE IS THE ONLY ONE THAT ACTS. Athi, 2026-08-19: *"in the IAM tab, we can
   * bring it as tabs, because he is going to look at only his profile, others are for information only."*
   *
   * ⚠️ HE IS DESCRIBING AN ASYMMETRY I HAD FLATTENED. Two of these tabs are REFERENCE — a map of who else
   * exists and what each may do, every row linking elsewhere to change anything. One is a FORM: the reader's
   * own business, with fields they edit and a Save button. Putting the form third, below two pages of other
   * people's rows, buries the only thing on the screen they came to do.
   *
   * So "My profile" leads, and the rest is labelled for what it is.
   */
  /**
   * ⭐ FOUR TABS, ONE PER KIND OF PARTY — the shape Athi approved in the profiles design.
   *
   * The earlier three (mine · everyone else · what they may do) split by ROLE OF THE SCREEN, which put a
   * business, an employee and a customer on one page and then forced every row to explain which it was.
   * Splitting by PARTY means each tab shows one thing and needs no sentence saying so — which is the point:
   * *"we do not need any explanation."*
   */
  /**
   * ⭐⭐ TWO TABS. Athi, 2026-08-20: *"only two tabs, others are variation of the same."*
   *
   * NETWORK went because a network node IS an entity — *"there is nothing called network tab"* — and the
   * Business tab already says whether you are part of one. CUSTOMER went because there is no customer
   * profile in this app at all: a customer token is accepted only by middleware/customer-auth and can never
   * reach app.html, so their profile lives on the STOREFRONT. Four tabs implied four places to manage
   * people; there are two.
   */
  /* ⚠️⚠️ THE TAB STRIP IS GONE. Athi, 2026-08-20: *"remove the employee tab, move what matters beside the
     picker."* The Employee tab was 195 words of reference prose describing the access model — on a screen
     where nobody chooses an access level. The two facts worth keeping moved to where the choice is made:
     "cannot raise a dispute" into the Commenter option (ACCESS_CHOICES, app.html) and "a label; it grants
     nothing" beside the Role field (cap-workforce). Everything else described what the other screen does.

     ⭐ AND ONE TAB IS NOT A TAB. With Employee gone the strip would have offered a single choice, which is a
     control that cannot be used — the same false affordance as a disabled input or a link to a closed shop. */

  /* ⚠️ _misHead ESCAPES BOTH ARGUMENTS — it takes text, not markup. I passed HTML and it printed a literal
     "&amp;" and a raw <b> tag on Athi's screen. Plain text only here. */
  /**
   * ⚠️⚠️ THE SUBTITLE IS GONE BECAUSE IT HAD BECOME FALSE, WHICH IS WORSE THAN REDUNDANT. Athi, 2026-08-20:
   * *"do we really need this statement — Who can act for this business, and what they may do — in IAM screen?"*
   *
   * It described the screen as it was when co-assists were managed here. They are not: this screen now holds
   * Identity, Business, Storefront, Rights and Documents, and the people live under Co-assists. So the one
   * sentence at the top of the screen was telling a reader the screen was about something it no longer
   * contains — a sentence nobody updated because nobody owns a subtitle.
   *
   * ⭐ AND THE HEADING ALONE ANSWERS IT. Five named sections say what is here better than a sentence
   * generalising over them, and this is the fourth explanatory line removed from this screen today. The
   * pattern is consistent: a description of a screen ages the moment the screen changes, while the sections
   * cannot — they ARE the screen.
   */
  return (
    _misHead('IAM · Identity and Access Management', '') +
    /* ⚠️ TWO BRANCHES, BECAUSE THERE ARE TWO TABS. 'node' and 'cust' were still routed here after their tabs
       were removed — unreachable, and exactly the kind of leftover that makes the next reader believe a
       Network tab exists somewhere they have not looked. */
    /* ⚠️ NO EMPLOYEE BRANCH HERE, AND THERE MUST NOT BE ONE. I put one here and it was dead code:
       loadProfile() routes an actor to loadActorProfile() before this function is ever called, so an employee
       cannot reach iamHTML at all. The employee's own screen is rendered THERE — one place, see the note on
       loadActorProfile. A branch here would be unreachable and would read to the next person as though this
       screen served both parties. */
    iamMeHTML(e)
  );
}

/* ══ shared pieces ══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️⚠️ _iamCard, _iamHead and _iamZone LIVED HERE and went with iamWhoHTML/iamAccessHTML on 2026-08-19.
 *
 * Nothing else called them — so removing their two callers orphaned them, and dead-surface went UP from 9 to
 * 10 rather than down. That is how the cascade announced itself, and it is the argument for reading a dead
 * SET together rather than one at a time: the second layer only becomes visible once the first is gone.
 */
/**
 * ⭐⭐ ONE TAB PER PARTY, AS ROWS. Athi, 2026-08-19: *"this is the perfect way of saying"* (the profiles design)
 * and *"we do not need any explanation."*
 *
 * ⚠️ THE PROSE WAS THE BUG, NOT THE CONTENT. Everything these rows say was already on the old screen — buried
 * in sentences that explained which party a row belonged to, because one page held all of them. Splitting by
 * party means each tab shows ONE kind of thing, so the explanation is structural and the words can go.
 *
 * ⭐ AND THE ONE VISUAL RULE FROM THE DESIGN CARRIES OVER: an IDENTIFIER is monospace, a NAME is not. You can
 * see which field is unique without being told — which is the distinction that cost a day to get straight.
 */
var IAM_PARTY = {
  emp: {
    title: 'Employee',
    who: 'Works for this business, inside its boundary.',
    nav: ["navTo('coassists')", 'Co-assists'],
    rows: function (e, acts) {
      var uid = e.user_id || 'your-user-id';
      var n = acts.filter(function (item) {
        return !item.actor_type || item.actor_type === 'human';
      }).length;
      var costs = acts.filter(function (item) {
        return item.can_see_costs;
      }).length;
      /**
       * ⚠️ THIS COUNTED WRONG THE MOMENT b173 LANDED. It read (a.hat || 'act'), so an actor carrying the new
       * access_level and no hat defaulted to 'act' and was counted as a writer — the tab cheerfully reported
       * "3 people, 3 can write" for one editor and two who cannot. A fallback chain has to be read in the same
       * order everywhere, and lib/access.js is the order: level first, hat only when the level is absent.
       */
      var LEVEL_OF = { act: 'editor', manager: 'editor', audit: 'commenter', mis: 'commenter', view_only: 'commenter' };
      var writes = acts.filter(function (item) {
        var lvl = item.access_level || LEVEL_OF[item.hat] || 'editor';
        return lvl === 'editor';
      }).length;
      return [
        /**
         * ⭐⭐ TWO NAMES, AND BOTH TRAVEL OUTWARD. Athi, 2026-08-20: *"Display Name — this can be visible in
         * internal conversation, his employee records etc. External name: employee@entity - Display name.
         * Need to distinguish and both should be there in external conversation."*
         *
         * The PAIR is the point. `ravi@acmetraders` alone is machine-shaped and says nothing about who a
         * person is; "Ravi Kumar" alone is ambiguous — several businesses have a Ravi. A counterparty needs
         * WHICH BUSINESS and WHICH PERSON, so outward they go together.
         */
        ['Display name', 'Their own — used inside', 0, 'May repeat. Internal conversation and their record.'],
        ['External name', 'ravi@' + uid + ' — Ravi Kumar', 1, 'Both halves travel: which business, and which person.'],

        /**
         * ⚠️⚠️ THIS ROW USED TO ADVERTISE FIVE PERMISSIONS AND THERE ARE TWO. It read
         * "Act · Manager · Audit · MIS · View-only — what they may do, enforced on every write", and a manager
         * reading that reasonably concluded the five differed. They do not: `act` and `manager` behave
         * IDENTICALLY, and `audit`, `mis` and `view_only` behave identically to each other.
         *
         * ⭐ Athi, 2026-08-20, diagnosing it better than I had: *"we are talking about two different things
         * here. One is role and another one is access. Here the access is nothing but editable or read only…
         * the role is multiple level in the organisation. Here we are not building multiple level of
         * organisation structure — that is out of scope."*
         *
         * So the CODE is right and the VOCABULARY was wrong: it presented role-words as permission-words. The
         * row now states the two access levels that exist, and lists the five names as what they map to.
         * The person who would otherwise discover this is an employee who asked for a hat that changed nothing.
         */
        /**
         * ⭐⭐ VIEWER · COMMENTER · EDITOR — adopted from Google Workspace, not invented. Athi, 2026-08-20:
         * *"if at all any standards to follow or how other platform quotes… then follow that."*
         *
         * ⚠️ HE HAD ALREADY DESCRIBED "COMMENTER" WITHOUT A NAME FOR IT — *"read only is internal messaging
         * only, not external messaging."* When a description lands on a standard's definition unprompted, the
         * standard is the right one. Google's three are also pure CAPABILITY words with no job title in them,
         * which is the property that matters: what this replaces was five ROLE words posing as permissions.
         *
         * ⭐ AND TWO FLAGS CARRY WHAT THE NAMES USED TO SMUGGLE. Five hats could never express "an editor who
         * sees every branch" — there was no sixth name, and adding one is how five becomes eight.
         */
        ['Access', 'Viewer · Commenter · Editor', 0, 'Three levels. Google Workspace’s, so nobody has to learn ours.'],
        ['Viewer', 'Reads', 0, 'Looks, and says nothing.'],
        [
          'Commenter',
          'Reads · replies INTERNALLY',
          0,
          'Sees everything including external threads, and may reply to colleagues. Cannot answer the other party, and cannot raise a dispute — someone auditing who participates is not auditing.'
        ],
        ['Editor', 'Changes records · messages anyone', 0, 'Inside or outside.'],
        ['Sees the whole business', 'A separate switch', 0, 'Reach normally follows their node. This lifts it — inside this entity only.'],
        ['Can see costs', costs + ' of ' + acts.length, 0, 'Buying price and what a job has cost. Margin is never shown. Also a separate switch.'],
        ['Who can change it', 'The account owner, never themselves', 0, 'Every change is recorded — who, when, from what, and why.'],

        ['Role', 'Free text', 0, 'A label. It grants nothing — access does that.'],
        ['Where they sit', 'A node in your structure', 0, 'Their reach follows the node, not the job title.'],
        ['How many', n + (n === 1 ? ' person' : ' people') + ' · ' + writes + ' can write', 0, '']
      ];
    }
  },
  /**
   * ⚠️ DEAD SINCE 2026-08-20 — kept, not deleted, per Athi's rule: *"mark it as dead and later if it is not
   * accessed at all, then remove."* The Network and Customer TABS are gone (IAM-SPEC §26.3): a network node IS
   * an entity, and a customer never reaches this app at all. Nothing routes here any more.
   *
   * The content is not worthless — it is the clearest statement of how a node and a customer are NAMED — which
   * is why it waits for a home rather than a delete. Network naming belongs on the Business tab; customer
   * naming belongs on the storefront.
   */
  node: {
    title: 'Network node',
    who: 'A branch, unit or counter. Its own entity, under yours.',
    nav: ["navTo('network')", 'Network'],
    rows: function (e) {
      var uid = e.user_id || 'your-user-id';
      return [
        ['Store name', 'Its own', 0, 'May repeat'],
        ['Handle', uid + '.store', 1, 'Unique across the platform'],
        ['Bridge ID', 'Its own, generated', 1, 'Different from yours'],
        ['Sits under', e.display_name || 'you', 0, 'The root of the tree'],
        ['Who can see it', 'Capped by its parent', 0, 'The narrowest wins'],
        ['Who works there', 'Co-assists placed at the node', 0, 'Their reach follows it']
      ];
    }
  },
  cust: {
    title: 'Customer',
    who: 'Someone who ordered. You never created this identity.',
    nav: ["profSetSec('storefront')", 'Storefront'],
    rows: function (e) {
      var bid = e.bridge_id || 'CB…';
      return [
        ['Name', 'As they type it', 0, 'No format rule · may repeat'],
        ['Verified by', 'phone@' + bid + '.cr', 1, 'Unique at this shop'],
        ['or', 'email=domain@' + bid + '.cr', 1, 'The @ becomes = so two providers stay two people'],
        ['Proves it with', 'A one-time code', 0, 'No password'],
        ['Access', e.storefront_access === 'login' ? 'Sign in first' : 'Browse first', 0, 'One rule for every customer'],
        ['Hat', 'None', 0, 'Not staff — cannot be granted or restricted']
      ];
    }
  }
};

/**
 * ⭐ MY PROFILE — the only tab on this screen that ACTS. Everything else is a map.
 *
 * ⚠️ It leads and it is the default, because a reader opening IAM is almost always here to change something
 * about their own business. Two tabs of other people's rows in front of that is a screen that makes you scroll
 * past everyone else to reach yourself.
 */
/**
 * ⭐⭐ THREE COLLAPSIBLE SECTIONS, GROUPED BY WHO OWNS THE ROW. Athi, 2026-08-20: *"Maybe three different
 * sections, clearly laid out what we are showcasing, as collapsible… if we have to bring a bit more, we have
 * to categorise and showcase accordingly."*
 *
 * ⭐ AND NAMED BY CONCERN, which answers the question he asked in the critique — *"have we worked as per IAM
 * definition or have we mixed up?"* We had. Roughly half of this tab is not identity or access at all: a
 * licence number is business profile, a storefront is commerce presence. Naming the boxes says so on the
 * screen, so a reader knows when they have left IAM:
 *
 *     Identity & access      ← IAM proper. Always open: opening your own profile, this is what you came for.
 *     Business profile       ← licence, address. Collapsed.
 *     Presence & governance  ← constitution, trading, storefront. Collapsed — reference, rarely acted on.
 *
 * ⚠️ EVERY INPUT ID IS UNCHANGED — pf_name, pf_uid, pf_gstn, pf_addr, pf_bs. saveProfile() reads them by id,
 * and a restructure that quietly renamed one would break saving in a way no parse check catches.
 */
function iamSection(key, title, body, opts) {
  var o = opts || {};
  var open = UI._iamOpen && Object.prototype.hasOwnProperty.call(UI._iamOpen, key) ? UI._iamOpen[key] : !!o.openByDefault;
  var Q = String.fromCharCode(39);
  return (
    '<div style="border:1px solid var(--line);border-radius:11px;margin-bottom:9px;background:var(--card);color:var(--on-card);overflow:hidden">' +
    '<button data-cbsid="ACC002-B27" type="button" data-testid="iam-sec-' +
    key +
    '" aria-expanded="' +
    (open ? 'true' : 'false') +
    '"' +
    ' onclick="iamToggle(' +
    Q +
    key +
    Q +
    ')"' +
    ' style="width:100%;display:flex;align-items:center;gap:8px;cursor:pointer;font:inherit;text-align:start;' +
    'border:0;background:var(--paper);color:var(--on-bg);padding:10px 13px;font-weight:700;font-size:var(--fs-2)">' +
    '<span style="font-size:11px;color:var(--grey)">' +
    (open ? '▾' : '<span class=arw>▸</span>') +
    '</span>' +
    esc(title) +
    (o.hint ? '<span style="margin-inline-start:auto;font-weight:400;font-size:var(--fs-1);color:var(--grey)">' + esc(o.hint) + '</span>' : '') +
    '</button>' +
    (open ? '<div style="padding:11px 13px 14px">' + body + '</div>' : '') +
    '</div>'
  );
}

/**
 * ⚠️ COLLAPSING A SECTION DESTROYS ITS INPUTS, so this is a real exit and is guarded like one. iamSection
 * renders its body only when open — closing a section with an edit in it discards that edit silently, which is
 * the exact loss Athi asked to be asked about. Guarding only page navigation would have missed the click
 * people make most often.
 */
function iamToggle(k) {
  profGuard(function () {
    UI._iamOpen = UI._iamOpen || {};
    /* the default for a key that has never been touched is whatever the section declared, so the first click
       must flip THAT, not flip an assumed-false */
    var cur = Object.prototype.hasOwnProperty.call(UI._iamOpen, k) ? UI._iamOpen[k] : k === 'ident';
    UI._iamOpen[k] = !cur;
    renderApp();
    _capShowDetail();
    loadProfile();
  });
}

/**
 * ⭐⭐ ONE ROW RENDERER FOR THE WHOLE PROFILE. Athi, 2026-08-20: *"anywhere else if the treatment is different
 * just complete those, so all looks similar."*
 *
 * There were THREE shapes doing one job — idRow stacked the label above the value with a dashed rule,
 * rowHtml put the label to the left, and each repeated the same uppercase-label styling inline. Three copies
 * of a style is three places for it to drift, and it had: the same fact looked different depending on which
 * section a reader was in.
 *
 * ⚠️ box() IS DELIBERATELY NOT FOLDED IN. Rights and Trade ready are a GRID OF INDEPENDENT FACTS — Athi asked
 * for boxes there specifically (*"can we make it as boxes, with gaps, more presentable"*) — and a grid is a
 * different thing from a list, not a different style for the same thing.
 *
 * Label left, value right, message BENEATH the value — his convention, once.
 */
/**
 * ⭐⭐ WHERE THIS VALUE CAME FROM, MARKED THE SAME WAY EVERY TIME. Athi, 2026-08-21: *"these settings can fall
 * from governance layer / blueprint / user selected — do we make a mark, how it is derived?"*
 *
 * ⚠⚠ THE VOCABULARY ALREADY EXISTED AND WAS AD HOC, which is the actual defect. Different rows said 'Set
 * above you', 'from your region', 'you set this', 'your device — not set for the business' — four phrasings for
 * three ideas, each invented at the moment its row was written. A reader could not tell whether two rows
 * saying different things meant different things.
 *
 * ⚠️ BLUEPRINT IS DELIBERATELY ABSENT. Athi's model has three sources and the code has three too, but they
 * are not the same three: nothing in the codebase lets a blueprint or work pattern supply a locale value —
 * checked, not assumed. Adding a label that can never appear would document an intention as if it were a
 * behaviour, which is the failure mode this whole table exists to end. When a blueprint does supply one, it
 * gets a row here and the mark starts firing on its own.
 *
 * ⚠️ DEFAULT IS A REAL SOURCE, NOT AN ABSENCE. 'Nobody chose this' is the single most useful thing a reader
 * can learn about a setting that looks wrong — it says the fix is to choose, not to hunt for who overrode you.
 */
var PROF_SRC = {
  gov: ['Governed', 'decided above you — not yours to change'],
  biz: ['Business', 'set on the business record'],
  you: ['You', 'your own choice, on this account'],
  def: ['Default', 'nobody chose — following your region']
};

/**
 * ⭐⭐ THE MARKS ARE OPT-IN. Athi, 2026-08-21: *"in the profile screen you can have a toggle button to see the
 * source if required."* — *if required* is the operative half.
 *
 * ⚠️ I HAD SHIPPED THEM ALWAYS-ON, WHICH SPENDS THE TEXT BUDGET ON THE WRONG READER. Where a value came from
 * is a question people ask when something looks WRONG — rarely, and deliberately. Eleven permanent chips make
 * every reader pay, every visit, for an answer almost none of them wanted, on a screen already measured at 56%
 * explanation. Off by default; one click when the question arises.
 *
 * ⚠️ THE NOTES STAY VISIBLE EITHER WAY. '{cur} no longer permitted' and 'your device — the business is in IN'
 * are exceptions a reader must see unprompted; only the routine provenance chip hides.
 */
/* ⚠️ typeof-GUARDED, LIKE ITS NEIGHBOURS. apGet lives in app.html; this file is a lazily-loaded capability,
   and a render that throws because an OPTIONAL affordance could not read a preference would blank the whole
   profile to hide a chip nobody asked for. The same shape as the themeGet/TEXT_SIZES guards above. */
function profSrcOn() {
  try {
    return typeof apGet === 'function' && apGet('cb_prof_src', '') === '1';
  } catch (_) {
    return false;
  }
}
function profSrcToggle() {
  apSet('cb_prof_src', profSrcOn() ? '' : '1');
  loadProfile();
}

/** The control itself — a quiet line, not a switch competing with the content. */
function profSrcBtn() {
  var on = profSrcOn();
  return (
    '<a data-cbsid="ACC002-C01" href="#" data-testid="prof-src-toggle" onclick="profSrcToggle();return false" ' +
    'style="color:var(--blue);font-size:var(--fs-1);text-decoration:none">' +
    (on ? tx('Hide where these come from') : tx('Show where these come from')) +
    '</a>'
  );
}

function _srcMark(src) {
  if (!profSrcOn()) return ''; /* opt-in — see the note above */
  var s = Object.prototype.hasOwnProperty.call(PROF_SRC, src) ? PROF_SRC[src] : null;
  if (!s) return '';
  /* ⚠️ COLOUR CARRIES NOTHING HERE. Every mark is the same grey: making 'Governed' red would read as a
     warning, and being governed is not a problem. The word is the information. */
  return (
    '<span title="' +
    esc(s[1]) +
    '" style="font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;' +
    'text-transform:uppercase;color:var(--grey);border:1px solid var(--line);border-radius:4px;' +
    'padding:0 4px;white-space:nowrap">' +
    esc(s[0]) +
    '</span>'
  );
}

function profRow(label, value, note, isHtml, src) {
  var mark = _srcMark(src);
  return (
    '<div style="display:flex;gap:12px;align-items:flex-start;padding:5px 0">' +
    '<b style="min-width:88px;flex:0 0 88px;font-size:var(--fs-1);color:var(--grey);text-transform:uppercase;' +
    'letter-spacing:.04em;line-height:1.7">' +
    esc(label) +
    '</b>' +
    '<div style="flex:1;min-width:0">' +
    /* ⚠️ isHtml MEANS "THIS VALUE IS MARKUP" — the jump-to-control arrow, the employee login chip.
         Everything else is escaped and stays escaped: raw HTML must be opted into deliberately. */
    '<div>' +
    (isHtml ? value : esc(value)) +
    '</div>' +
    /* ⚠️ THE MARK SHARES THE NOTE LINE rather than taking a row of its own. Every row gaining a third line
         would add eleven lines to this section for information most readers need once. */
    (mark || note
      ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px;line-height:1.5;' +
        'display:flex;gap:6px;align-items:baseline;flex-wrap:wrap">' +
        mark +
        (note ? '<span>' + esc(note) + '</span>' : '') +
        '</div>'
      : '') +
    '</div></div>'
  );
}

/** ⭐ And ONE group heading — larger, ruled, with its rows indented beneath it. */
function profGroup(title, rowsHtml) {
  if (!rowsHtml) return '';
  return (
    '<div style="font-size:var(--fs-2);font-weight:700;color:var(--on-card);' +
    'margin:14px 0 6px;padding-bottom:4px;border-block-end:1px solid var(--line)">' +
    esc(title) +
    '</div>' +
    '<div style="padding-inline-start:6px">' +
    rowsHtml +
    '</div>'
  );
}

function iamMeHTML(e) {
  var Q = String.fromCharCode(39);
  /* ⚠️ KICKED FROM THE RENDERER because this screen has no mount step — same as iamLoadDocs, same latch. */
  iamLoadTrade();
  iamLoadChannels();

  /* ── 1 · IDENTITY & ACCESS ─────────────────────────────────────────────────────────────────────────────
   * ⚠️⚠️ NAME EDITABLE, USER ID FIXED — and it was exactly reversed before. This app's own naming table says
   * display_name is *"change it any time — nothing cites it, everything cites your ID"*, and the screen had
   * made the NAME read-only text and the USER ID an editable input. The mutable fact was pinned and the
   * load-bearing one was loose. */
  /**
   * ⭐ THE PENCIL IS THE AFFORDANCE, NOT A SENTENCE. Athi, 2026-08-20: *"in the name field show editable
   * icon."* Two rows sit together — one editable, one fixed — and the difference now shows in the row itself
   * rather than being inferred from the fact that one is an <input>.
   */
  var ident =
    '<label class="fl">' +
    tx('Name') +
    ' <span style="color:var(--grey);font-weight:400" title="' +
    esc(tx('You can change this')) +
    '">✎</span></label>' +
    '<input data-cbsid="ACC002-I15" class="inp" id="pf_name" value="' +
    esc(e.display_name || '') +
    '">' +
    /* ⚠️⚠️ THE THREE-LINE EXPLANATION IS GONE. Athi: *"we don't want this info — that is what we are showcasing
       in employee."* It said co-assists sign in as key@handle, which the EMPLOYEE's own screen already shows
       them as their actual login. Explaining someone else's screen on yours is the definition of the text this
       product carries too much of; the 🔒 says the one thing left that is not visible from the value. */
    '<div style="margin-top:12px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--on-bg)">' +
    (e.user_id
      ? '<div style="font-size:var(--fs-1);text-transform:uppercase;letter-spacing:.05em;color:var(--grey);font-weight:600">' +
        tx('User ID') +
        ' <span title="' +
        esc(tx('Cannot be changed')) +
        '">🔒</span></div>' +
        '<div class="mono" style="font-size:var(--fs-3);color:var(--gold);margin-top:2px">' +
        esc(e.user_id) +
        '</div>'
      : '<label class="fl" style="margin-top:0">' +
        tx('User ID') +
        '</label>' +
        '<input data-cbsid="ACC002-I16" class="inp" id="pf_uid" value="" autocapitalize="off" spellcheck="false">' +
        /* ⚠️ THIS ONE STAYS. It is not explanation — it is the rule you must satisfy to fill the box, and it
             is unrecoverable if you get it wrong. Set-once means there is no second attempt to learn from. */
        '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:5px;line-height:1.5">' +
        '8+ characters · letters, numbers, dashes · no <b>@</b> or <b>.</b> · <b>' +
        tx('permanent') +
        '</b></div>') +
    '</div>';

  /* ⚠️⚠️ THE BRIDGE ID ROW IS GONE, AND NOT ONLY FROM HERE. Athi: *"we don't need to say minted, never typed —
     in fact this information should not be appearing anywhere."* A bridge_id is a PRIMARY KEY: it exists so
     rows can reference each other without depending on anything a person may change. Putting it on screen
     asks someone to know an implementation detail, and — worse — two supplier screens were labelling it
     "User ID", so a person could read it and quote it to a supplier as their handle. See e2e/bridge-id-audit. */

  /* ── 2 · BUSINESS PROFILE — MOVED to app/cap-shop.js (SET1): the same card CB Settings › Your shop edits (shopLicLabel · shopFieldsHTML) ── */
  var licLabel = shopLicLabel();
  var profile = shopFieldsHTML(e, licLabel); /* ⚠️ REGIONAL LEFT THIS SECTION. Athi, 2026-08-20: *"can we keep regional as a separate collapsable
           unit — it is under business, I was searching for something on its own."* He went looking for it as a
           thing and found it as a footnote. A block a person searches FOR is a section; a block they read in
           passing is a row. Which it is was decided by how he tried to use it, not by where the data lives. */

  /* ── 3 · PRESENCE & GOVERNANCE ─────────────────────────────────────────────────────────────────────────
   * Read-only rows come from the constitution and the operator; the editable one is trading status. */
  var vis = e.catalogue_visibility || 'private';
  var st = e.business_status || 'open';
  /* ⚠️ DECLARED HERE, NOT BORROWED. I first wrote the capped-visibility branch below using `cap` and `capped`
     from storefrontCardHTML — variables in a different function, which is a ReferenceError at render time and
     invisible to node --check. Third time today that a remembered name compiled and would not have run. */
  var cap = e.visibility_cap || { max: 'public', by: null, reason: '' };
  var capped = cap.max === 'private';
  /**
   * ⭐⭐ ONE RESOLVED SENTENCE, NOT TWO FACTS TO JOIN. Athi, 2026-08-19: *"we have to state explicitly that your
   * storefront is visible to public — that depends on the open, close, away status."*
   *
   * ⚠️⚠️ AND THE OLD NOTE HERE IS NOW FALSE. It read *"this is whether you are trading — nothing to do with who
   * may see your catalogue"*, which was TRUE of the old code and is not true of the new: `closed` now hides the
   * catalogue outright (IAM-SPEC §12). A backend fix that leaves a contradicting sentence on the screen has
   * moved the bug rather than fixed it.
   */
  /**
   * ⭐⭐ IS THERE A STOREFRONT AT ALL. Everything in this section follows from this one boolean — the link, the
   * customer-access mode, and the network line. That is the coupling Athi named: *"both should work together —
   * when no link, why do you need browse first?"*
   *
   * ⚠️⚠️ AND A NETWORK WITH NOTHING PUBLISHED UNDER IT IS NOT LIVE. *"By default it is a PRIVATE network, so no
   * storefront. But if you have any store under you is public, then the storefront will be public."* Without
   * this clause the screen offered a link for a network whose every member was private — a link that opens an
   * empty shop, which is the false affordance this whole section keeps being fixed for.
   *
   * ⚠️ `== null` IS DELIBERATE: it catches undefined AND null — a server that could not take the count, and an
   * older API that does not send one. Neither is evidence that the network is empty, so neither hides the
   * link. Only a real zero does.
   */
  var live = st !== 'closed' && vis !== 'private' && !(vis === 'network' && e.network_public_count === 0);

  /**
   * ⭐⭐ TWO CONTROLS, ADJACENT, AND NOTHING ELSE. The resolved sentence is gone: it restated in prose what the
   * two selects say in two words, and it was the third of four places this screen named the same fact.
   *
   * ⚠️ THE CONTROL ITSELF MOVED HERE FROM THE STOREFRONT PANEL. Visibility was read-only here with a link
   * saying "Change in Storefront", which is a screen telling you to go to another screen to change something
   * it is already showing you. If it can display it, it can set it.
   */
  var governed =
    '<div style="display:flex;gap:11px;flex-wrap:wrap">' +
    '<div style="flex:1 1 150px"><label class="fl" style="margin-top:0">' +
    tx('Trading') +
    '</label>' +
    '<select data-cbsid="ACC002-S08" class="inp" id="pf_bs" style="margin:0">' +
    opt(['open', 'away', 'closed'], st) +
    '</select></div>' +
    /* ⚠️ THE CAP IS HONOURED HERE OR THE CONTROL LIES. visibility_cap can pin an entity to private from a layer
       above it; offering "public" in that state would be a choice the server refuses. Disabled, and the reason
       is the only sentence in this section — because a control that cannot be used and does not say why is the
       one place where removing the explanation would remove the information. */
    '<div style="flex:1 1 150px"><label class="fl" style="margin-top:0">' +
    tx('Visible to') +
    '</label>' +
    '<select data-cbsid="ACC002-S09" class="inp" id="pf_vis" style="margin:0"' +
    (capped ? ' disabled' : '') +
    '>' +
    opt(capped ? ['private'] : ['public', 'network', 'private'], vis) +
    '</select></div>' +
    '</div>' +
    (capped ? '<div class="misnote" style="margin-top:6px">' + esc(cap.reason || tx('Set above you.')) + '</div>' : '') +
    /* ⚠️ THE STOREFRONT LINK OPENS IN A NEW WINDOW — and that does NOT protect the session, which was the
       stated reason for it. Same origin means the same localStorage. We are safe today because shop.html
       holds no session at all; the rule to keep is that a customer token must never be written to cb_sess. */
    /**
     * ⚠️⚠️ THE CUSTOMER-ACCESS MODE CAME WITH IT, OR IT WOULD HAVE BEEN LOST. Folding the Storefront panel into
     * this section made storefrontCardHTML unreachable — and that card held `storefront_access` (browse-first
     * vs login-first), a real setting with no other home. Deleting the panel without carrying this across is
     * the same failure as the localisation rows an hour ago: not removed on purpose, left behind by a regroup.
     */
    /**
     * ⚠️⚠️ THE CUSTOMER-ACCESS MODE ONLY EXISTS WHILE THERE IS A STOREFRONT. Athi, 2026-08-20: *"private, link
     * is gone, but browse-first window is visible — both should work together. When no link, why do you need
     * browse first?"*
     *
     * ⭐ THAT IS A COUPLING, AND IT IS THE ONE THE LINK ALREADY OBEYS. "Browse first or sign in first" answers
     * a question about people arriving at a shop; with no shop nobody arrives, and the control sets a rule for
     * a situation that cannot occur. Two controls describing one thing must appear and vanish together, or the
     * screen says the shop is shut and in the next line asks how visitors should enter it.
     *
     * ⚠️ DROPPED FROM THE DOM, NOT DISABLED — which also puts it beyond PROF_FIELDS, so the per-section Save
     * cannot send an access mode for a storefront that does not exist. Registered in INVARIANTS.md.
     */
    /* ⚠️ BUILT INLINE — opt() takes a flat value list, and there is no label/value variant. I wrote `opt2(...)`
       from memory and it does not exist anywhere: the sixth invented name today, and the only one caught
       before it shipped, because I checked instead of assuming. */
    (live
      ? '<label class="fl">' +
        tx('Customers') +
        '</label>' +
        '<select data-cbsid="ACC002-S10" class="inp" id="pf_sfaccess" style="max-width:320px">' +
        [
          ['browse', tx('Browse first')],
          ['login', tx('Sign in first')]
        ]
          .map(function (item) {
            return (
              '<option value="' + esc(item[0]) + '"' + ((e.storefront_access || 'browse') === item[0] ? ' selected' : '') + '>' + esc(item[1]) + '</option>'
            );
          })
          .join('') +
        '</select>' +
        pfExposureDefaultsHTML(e)
      : '') +
    /**
     * ⭐ THE NETWORK ANSWER IS DERIVED, NOT STORED. Athi, 2026-08-20: *"if you change the option to network, by
     * default it is a PRIVATE network, so no storefront. But if you have any store under you is public, then
     * the storefront will be public. This way we are avoiding another status field."*
     *
     * ⭐⭐ A PRIVATE NETWORK NEEDS NO FLAG — it is a network where nobody has published. The question already
     * has an answer in the data, and a second stored answer beside it is two facts that can disagree.
     *
     * ⚠️ null IS NOT ZERO. The server sends null when the count could not be taken; "nothing under you is
     * public" is a definite statement and this is the absence of one, so the line simply does not appear.
     */
    (vis === 'network' && e.network_public_count != null
      ? '<div class="kv" style="margin-top:9px"><b>' +
        tx('Network') +
        '</b> · ' +
        (e.network_public_count > 0
          ? esc(txf('{n} store(s) under you are public', { n: e.network_public_count }))
          : '<span style="color:var(--grey)">' + tx('nothing under you is public') + '</span>') +
        '</div>'
      : '') +
    '<div class="kv" style="margin-top:11px"><b>' +
    tx('Link') +
    '</b> · ' +
    (live && (e.user_id || e.bridge_id)
      ? '<a href="/shop.html?s=' +
        encodeURIComponent(e.user_id || e.bridge_id) +
        '" target="_blank" rel="noopener noreferrer"' +
        ' style="color:var(--blue)">' +
        esc(location.host + '/shop.html?s=' + (e.user_id || e.bridge_id)) +
        ' <span class=arw>↗</span></a>'
      : '<span style="color:var(--grey)">' + tx('nothing to show while private or closed') + '</span>') +
    '</div>'; /* ⚠️ CHANNELS LEFT THIS SECTION, for the same reason Regional did. Athi: *"same way, the channel under
           storefront, can we keep it separate as Channel? And point to channel settings?"* Both were things he
           went LOOKING for and found buried — and the test is not where the data belongs but how a person
           reaches for it. The storefront link answers "can customers see my catalogue"; the channels answer
           "where does work arrive". Related, and not the same question. */

  /* ⭐ THE OTHER HALF OF "how is this store reached" — the link answers the catalogue, these answer the
       messages. Both are outward facts; neither is configured here. */
  /**
   * ⭐⭐ FIVE SECTIONS, ONE SCREEN, NO RAIL. Athi, 2026-08-20: *"we have other three panel in profile —
   * storefront, your rights and documents — it can come over to the first page itself… see what we have
   * repeated… no explanatory text, the details have to be intuitive and information should not be missed."*
   *
   * ⚠️⚠️ CATALOGUE VISIBILITY WAS STATED FOUR TIMES. "You have no public storefront", "Who may see your
   * catalogue · private", "Storefront · not visible right now" — three read-only restatements on THIS screen —
   * and then the Storefront panel, which owns the actual control. Three of the four were echoes.
   *
   * ⚠️⚠️ AND TRADING STATUS SAT APART FROM VISIBILITY WITH EACH PANEL APOLOGISING FOR THE SPLIT. This screen
   * carried "⚠️ Separate from who can see your catalogue — that lives under Storefront" and Storefront carried
   * "⚠️ This is not whether you are trading — that is under Identity". Two panels explaining why they are not
   * each other is the split being wrong, not the labels. They are one subject — `closed` already hides the
   * catalogue outright (§12) — so they now sit together and both disclaimers deleted themselves.
   *
   * ⭐ THE HINT CARRIES THE ANSWER SO THE SECTION NEED NOT BE OPENED. That is what replaces the prose: a
   * reader learns "private · open" from the closed header, and opens it only to change something.
   */
  /**
   * ⚠️⚠️ THE HINT IS WHY THESE SECTIONS EXIST CLOSED. Athi could not find the channels or the Regional block —
   * both sit inside sections that default to collapsed, so the feature was shipped, correct, and invisible.
   *
   * ⭐ THE FIX IS NOT TO OPEN EVERYTHING. It is the rule this screen already follows: the hint carries the
   * ANSWER so the section need not be opened. A reader who wants "public · open · 2 channels" now has it
   * without a click, and opens the section only to change something.
   */
  var _regHint = [e.country || null, e.currency_code || null, e.timezone || null].filter(Boolean).join(' · ') || tx('not set');
  var _chanN = Array.isArray(UI._chans) ? UI._chans.length : null;
  /* ⚠️ AFTER _chanN, NOT BEFORE.  hoists the NAME and not the VALUE, so reading it one line earlier gave
     undefined — falsy — and the hint would have said "none yet" for every entity, always. A silent
     always-wrong, and the third this session that only a check for declaration order would find. */
  /* ⚠️ null (not read / failed) IS NOT ZERO — the hint stays empty rather than claiming none. */
  var _chanHint = _chanN === null ? '' : _chanN ? _chanN + ' ' + (_chanN === 1 ? tx('bound') : tx('bound')) : tx('none yet');
  var _sfHint = [e.catalogue_visibility || 'private', e.business_status || 'open'].join(' · ');
  /* ⭐ COUNTRY AND CURRENCY IN THE HINT — the two Regional facts a reader is most likely to be checking, and
     the reason they open this section at all. */
  /* ⭐ country and currency moved OUT of this hint with the block they describe — a hint must summarise its
     own section, or the closed screen answers the wrong question. */
  var _licHint = [e.supplies || 'goods', e.gstn ? licLabel : null, e.address ? 'address' : null].filter(Boolean).join(' · ') || tx('not set');

  /* ⭐ EACH SECTION CARRIES ITS OWN SAVE — and Rights carries none, because nothing in it is yours to set.
     A Save button on a read-only card is the same false affordance as a disabled input. */
  return (
    iamSection('ident', tx('Identity'), ident + profSaveBtn('ident'), { openByDefault: true, hint: [e.user_id, e.bridge_id].filter(Boolean).join(' · ') }) +
    iamSection('profile', tx('Business'), profile + profSaveBtn('profile'), { hint: _licHint }) +
    /* ⚠️ THE SAVE BUTTON WENT WITH THE PICKER. It was rendered when the constitution permitted more than one
       currency — the section's only writable control. With the picker in Settings, a Save here would submit an
       empty section: a button that does nothing is worse than no button, because a reader who presses it and
       sees 'saved' believes something was written. */
    iamSection('regional', tx('Regional'), iamGovernedRows(e), { hint: _regHint }) +
    /**
     * ⭐ HOW THIS BUSINESS READS ITS WORK — stated here because a person looking at their own profile should not
     * have to open Settings to find out. Athi, 2026-08-24: *"show the same in profile as the selected choice."*
     *
     * ⚠️ READ-ONLY, and pointing at where it IS changed. Two places that both edit one setting is two places to
     * keep in step, and the first time they disagree nobody can tell which one is the setting.
     */
    /* ⚠️ THE VALUE GOES IN THE HINT, not only in the body — a section is collapsed until someone opens it, and
       a choice you have to expand a panel to read is not "shown in the profile". The body carries the why. */
    iamSection('detail', tx('Detail page'), iamDetailDesignRow(e), { hint: iamDetailDesignName() }) +
    iamSection('channels', tx('Channels'), iamChannelRows(), { hint: _chanHint }) +
    iamSection('governed', tx('Storefront'), governed + profSaveBtn('governed'), { hint: _sfHint }) +
    /* ⭐ TRADE READY SITS BESIDE RIGHTS, not among the editable sections — both answer "what may this
       business do", one from the platform and one from the world. Neither takes a Save. */
    iamSection('trade', tx('Trade ready'), iamTradeBody(), { hint: iamTradeHint() }) +
    iamSection('rights', tx('Rights'), iamRightsBody(e), { hint: tx('resolved') }) +
    iamSection('docs', tx('Documents'), iamVaultBody(), { hint: UI._vaultHint || '' }) +
    /* Last, and collapsed: consulted, not maintained. The hint carries the total so the number is readable
       without opening the panel — the one figure anyone actually wants at a glance. */
    iamSection('usage', tx('Usage'), usageBody(), { hint: UI._usage && UI._usage.total_cost_usd != null ? _usageMoney(UI._usage.total_cost_usd) : '' })
  );
}

/**
 * The resolved-rights card, moved off its own panel.
 *
 * ⚠️ THE PARAGRAPH THAT USED TO SIT UNDER IT IS GONE — three sentences explaining that this is the answer and
 * the seven layers are the derivation. The button says "The seven layers →", which is the same information in
 * four words, and the reader who does not care never reads a paragraph telling them they might.
 */
function iamRightsBody(e) {
  var Q = String.fromCharCode(39);
  return (
    (govCardHTML(e.governance) || '<div class="misnote">' + tx('Nothing resolved yet.') + '</div>') +
    '<button data-cbsid="ACC002-B28" class="composebtn" style="margin-top:9px" data-testid="gov-to-layers" ' +
    'onclick="navTo(' +
    Q +
    'settings' +
    Q +
    ');setSetSec(' +
    Q +
    'governance' +
    Q +
    ')">' +
    tx('The seven layers') +
    ' <span class=arw>→</span></button>'
  );
}

/**
 * The trade-documents vault, moved off its own panel.
 *
 * ⚠️ IT LOADS ASYNCHRONOUSLY AND MUST ONLY DO SO WHEN THE SECTION IS OPEN. The vault was a whole panel a
 * person navigated to deliberately; as a collapsed section it would otherwise fetch on every profile paint for
 * every reader who never opens it — the on-demand rule exactly.
 */
function iamVaultBody() {
  var open = UI._iamOpen && UI._iamOpen.docs;
  if (!open) return '';
  setTimeout(function () {
    if (typeof loadVault === 'function') loadVault();
  }, 0);
  return '<div id="vaulthost"><div class="loadwrap"><span class="spin"></span> ' + tx('loading…') + '</div></div>';
}

/**
 * ⚠️⚠️ SESSION_IS_ACTOR LIVED HERE AND IS GONE, IN TWO STAGES, BOTH WORTH RECORDING.
 *
 * It first read `SESSION.identity_type` (never set anywhere — my line was the only reader in the repo) and
 * `UI.profile.identity_type` (UI.profile belongs to cap-readiness.js: the TRADE DECLARATION). So it returned
 * false for everyone: not a crash, a silent always-false. e2e/session-keys.cjs now catches that class.
 *
 * Then it turned out not to be needed at all. loadProfile() already routes an actor to loadActorProfile()
 * before iamHTML runs, so the branch it gated was unreachable no matter what it returned. The right question
 * was never "is this reader an actor" — it was "where does an employee's profile already render", and that
 * had an answer before I started.
 *
 * ⭐ TWO BUGS, ONE CAUSE: I searched for where the IAM SCREEN renders instead of where an EMPLOYEE'S PROFILE
 * renders, and built beside a function I never looked for.
 */

/**
 * ⭐⭐ THE EMPLOYEE'S OWN PROFILE. Athi, 2026-08-20: *"in the employee profile, there is nothing mentioned
 * about his access level, like reviewer, edit and the other one, which one he belongs to."*
 *
 * Three things an employee needs about themselves, and the screen showed none of them:
 *   1. WHO they are here      — the login they type, which is key@business and is not theirs to change
 *   2. WHAT THEY MAY DO       — the access level, with the other levels visible so the answer has a scale
 *   3. HOW TO CHANGE IT       — they cannot; the owner can. Said plainly rather than left to be discovered.
 *
 * ⚠️ ALL THREE ARE READ-ONLY BY DESIGN. Athi, on the walk: *"current hat, display below what other hats are
 * possible. Request your manager to modify if required."* An editable control here would be a lie — the API
 * refuses it (routes/actors.js is entity-only), so the screen must not offer what the server will decline.
 */
function iamSelfEmployeeHTML(e) {
  /* ⚠️ KICKED OFF FROM THE RENDERER because there is no other hook — this screen has no mount step. The latch
     inside iamLoadDocs is what keeps that from being a render loop. */
  iamLoadDocs();
  var lvl = accessLevelOf(e);
  var login = e.actor_key && e.parent_user_id ? e.actor_key + '@' + e.parent_user_id : null;

  /**
   * ── 1 · WHO YOU ARE — name, login, access level. ALL READ-ONLY. ───────────────────────────────────────
   *
   * ⭐⭐ Athi, 2026-08-20: *"the access the employee cannot change, it should be done by entity and it should
   * be visible here as part of WHO YOU ARE — name, id, and access level."*
   *
   * ⚠️ THE NAME WAS AN EDITABLE INPUT AND IS NOT ANY MORE. It sits in the list of things Athi called visible,
   * beside two facts nobody disputes are the entity's; and the external name a counterparty sees is
   * key@business — Display Name, so a person who could rename themselves freely could present as someone
   * else to the other side of a trade. ⚠️ ASSUMPTION FLAGGED: if an employee should be able to change their
   * own display name, this is the line to change, and the API needs a matching route — /actors/:id is
   * entity-only today, so an input here would have been refused anyway.
   *
   * ⭐ THREE FACTS, ONE BLOCK, NO FORM. Nothing here is editable, so nothing here should look editable.
   */
  /* ⚠️ idRow WAS ITS OWN SHAPE — label stacked ABOVE the value with a dashed rule, while Regional put the
     label to the left. Same job, two looks, and a reader crossing between the employee profile and the
     business profile met the same kind of fact dressed differently. It is profRow now; the value may be
     markup here (the login chip), which is why the fourth argument is true. */
  var idRow = function (label, value, note) {
    return profRow(label, value, note, true);
  };

  var who =
    idRow(tx('Name'), '<span style="font-size:var(--fs-3);font-weight:700">' + esc(e.display_name || '—') + '</span>', tx('Set by your employer.')) +
    idRow(
      tx('Your login'),
      login
        ? '<span class="mono" style="font-size:var(--fs-3);color:var(--gold)">' + esc(login) + '</span>'
        : '<span class="mono" style="color:var(--grey)">' + esc(e.actor_key || '—') + '</span>',
      tx("Your key, then your employer's User ID. Issued with your account and cannot be changed.")
    ) +
    idRow(
      tx('Access'),
      '<span class="optchip" style="background:var(--blue-tint);color:var(--blue-d);border-color:var(--blue-tint-line)">' +
        esc(ACCESS_LABEL[lvl] || lvl) +
        '</span>' +
        (e.whole_entity === true ? ' <span class="optchip">' + tx('Whole business') + '</span>' : '') +
        (e.can_see_costs === true ? ' <span class="optchip">' + tx('Sees costs') + '</span>' : ''),
      tx('Only your employer can change this.')
    );

  /* ⚠️ NO BRIDGE ID ROW. Athi: *"this information should not be appearing anywhere."* An employee has a
       login they type and a name colleagues read; the internal key is neither, and showing it here would
       invite them to quote it to someone. e2e/bridge-id-audit.cjs holds the line. */ /**
   * ── 2 · YOUR IDENTITY RECORD ─────────────────────────────────────────────────────────────────────────
   *
   * ⭐ RENDERED BY THE SHARED MODULE, NOT BY THIS FILE. Athi: *"as a separate module to update."* The same
   * block appears on the Co-assists form; two copies would drift, and the copy that lost the Aadhaar
   * sentence would be the one that mattered. In 'self' mode it splits itself into what this person may add
   * and what their employer recorded. UI._idocs is filled by iamLoadDocs().
   *
   * ⚠️ THE SEPARATE "YOUR ACCESS" SECTION IS GONE. The ladder of three levels was a good way to show a level
   * in isolation and the wrong answer to what Athi actually asked for — access belongs *"as part of who you
   * are, name, id, and access level"*. One line in the identity block beats a section a reader must open to
   * learn one word, and this product's measured problem is that 56% of its on-screen words are explanation.
   */
  var docs = typeof CBIdDocs !== 'undefined' ? CBIdDocs.html(UI._idocs || [], 'self') : '<div class="misnote">' + tx('Loading…') + '</div>';

  return (
    iamSection('ident', tx('Who you are'), who, { openByDefault: true, hint: ACCESS_LABEL[lvl] || '' }) +
    iamSection('docs', tx('Your identity record'), docs, { hint: iamDocsHint() })
  );
}

/** "2 of 6 verified" — the summary an owner or an employee reads before opening the section. */
function iamDocsHint() {
  var list = UI._idocs || [];
  if (!list.length) return '';
  var ok = list.filter(function (x) {
    return x.status === 'verified';
  }).length;
  return ok + ' of ' + (CBIdDocs ? CBIdDocs.ORDER.length : 6) + ' verified';
}

/**
 * ⭐⭐ TRADE READY, AS THE OUTWARD ANSWER — not the workbench.
 *
 * Athi, 2026-08-20: *"Trade ready — I guess that also, if we make it crisp, then it can get into profile.
 * That is how other suppliers will view this person."*
 *
 * ⚠️ SO THE 535-LINE SCREEN DOES NOT MOVE. cap-readiness is a workbench — lanes, destinations, AI drafting,
 * registry verification — and a person goes there to DO something. What belongs on a profile is the thing a
 * counterparty reads: how much is proved, and how well. Copying the workbench here would have given the app a
 * second place to work on the same records, which is the duplication this whole day removed.
 *
 * ⭐ THE RUNGS ARE THE CONTENT, and they are already the product's own vocabulary — verified beats attested
 * beats documented ([[project-attestation-layer]]). A supplier asking "can I trade with them" is asking which
 * rung, not how many rows.
 */
function iamTradeHint() {
  var s = UI._rdSum;
  if (!s) return '';
  if (!s.total) return tx('not started');
  return s.verified + ' ' + tx('verified') + ' · ' + s.met + '/' + s.total;
}

function iamTradeBody() {
  var s = UI._rdSum;
  if (s === undefined) return '<div class="misnote">' + tx('Loading…') + '</div>';
  /* ⚠️ null means the read FAILED. That is not "nothing is ready" — a definite claim from an absent answer is
     the mistake the network count already avoids. */
  if (s === null) return '<div class="misnote">' + tx('Could not read your trade record.') + '</div>';
  if (!s.total) return '<div class="misnote">' + tx('Nothing recorded yet.') + '</div>' + iamTradeLink();

  var box = function (label, value, sub, tone) {
    return (
      '<div style="flex:1 1 130px;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:11px;' +
      'background:var(--paper);color:var(--on-bg)">' +
      '<div style="font-size:var(--fs-1);text-transform:uppercase;letter-spacing:.05em;color:var(--grey);font-weight:600">' +
      esc(label) +
      '</div>' +
      '<div style="margin-top:3px;font-size:var(--fs-4);font-weight:700' +
      (tone ? ';color:' + tone : '') +
      '">' +
      esc(value) +
      '</div>' +
      (sub ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' + esc(sub) + '</div>' : '') +
      '</div>'
    );
  };

  /* The trust ladder, highest rung first — that is the order a counterparty reads it in. */
  var rungs =
    '<div style="display:flex;flex-wrap:wrap;gap:9px">' +
    box(tx('Verified'), String(s.verified), tx('checked at source'), 'var(--ok-3)') +
    box(tx('Attested'), String(s.attested), tx('third party'), '') +
    box(tx('Documented'), String(s.documented), tx('self-declared'), '') +
    '</div>';

  /* ⚠️ ONLY WHAT NEEDS ACTION APPEARS. A row reading "expired: 0" is a fact nobody needs; the absence of the
     row is the same answer and costs no attention. */
  var flags = [];
  if (s.expiring) flags.push(['⚠️', s.expiring + ' ' + tx('expiring'), 'var(--warn-3)']);
  if (s.expired) flags.push(['✕', s.expired + ' ' + tx('expired'), 'var(--disp-2)']);
  if (s.pending) flags.push(['○', s.pending + ' ' + tx('not started'), 'var(--grey)']);

  return (
    rungs +
    (flags.length
      ? '<div class="kv" style="margin-top:10px">' +
        flags
          .map(function (item) {
            return '<span style="color:' + item[2] + ';margin-inline-end:12px">' + item[0] + ' ' + esc(item[1]) + '</span>';
          })
          .join('') +
        '</div>'
      : '') +
    iamTradeLink()
  );
}

/* ⭐ THE WORK HAPPENS ON THE OTHER SCREEN, and the button is the whole instruction. */
function iamTradeLink() {
  var Q = String.fromCharCode(39);
  return (
    '<button data-cbsid="ACC002-B29" class="composebtn" style="margin-top:10px" data-testid="prof-to-readiness" ' +
    'onclick="navTo(' +
    Q +
    'readiness' +
    Q +
    ')">' +
    tx('Trade readiness') +
    ' <span class=arw>→</span></button>'
  );
}

/**
 * ⚠️ LATCHED, like the identity record — this sets UI._rdSum and then repaints, and the renderer reads
 * UI._rdSum. Without the latch that is a cycle which pins a core and looks like a slow screen.
 */
async function iamLoadTrade() {
  if (UI._rdSumLoaded) return;
  UI._rdSumLoaded = true;
  try {
    var reply = await fetch(CFG.API_BASE + '/api/governance/readiness', { headers: { Authorization: 'Bearer ' + SESSION.token } });
    UI._rdSum = reply.ok ? (await reply.json()).summary || null : null;
  } catch (_) {
    UI._rdSum = null;
  }
  bgRenderApp();
  _capShowDetail();
  loadProfile();
}

/**
 * Fetch the record once, then re-render.
 *
 * ⚠️ GUARDED AGAINST A RENDER LOOP. It sets UI._idocs and calls renderApp, and renderApp calls the renderer
 * that reads UI._idocs — so without the _idocsLoaded latch this is an infinite cycle that pins a CPU core and
 * looks, from the outside, exactly like a slow screen.
 */
async function iamLoadDocs() {
  if (UI._idocsLoaded) return;
  UI._idocsLoaded = true;
  try {
    await ensureCap('iddocs');
    UI._idocs = await CBIdDocs.load();
    /* ⚠️ loadProfile() TOO — the employee screen is painted by loadActorProfile, which renderApp alone does
       not re-run. Without it the documents arrive, sit in UI._idocs, and the section keeps showing "Loading…"
       until something else happens to repaint. Same trio iamToggle uses; anything less is a half-repaint. */
    bgRenderApp();
    _capShowDetail();
    loadProfile();
  } catch (_) {
    /* the record is additive — its absence must not take the profile down */
  }
}

/**
 * The constitutional facts — read-only here by design. Athi, 2026-08-19: *"in my eyes this would be coming
 * from constitution based on the installation, so it should be read only."*
 *
 * ⚠️ AND THE LABEL HAS TO SAY WHOSE THEY ARE, or "read-only" reads as "you cannot change your language" —
 * which is false. There are TWO locale concepts sharing words: the ENTITY's (country of business, the
 * currency it trades in — a fact about the business) and the PERSON's (what THIS reader reads, editable in
 * Settings). This block is the entity's.
 */
/**
 * ⚠️⚠️ TWO CONCEPTS WERE SHARING ONE VALUE, AND MY OWN TEXT TRIM MADE IT WORSE.
 *
 * These rows read Time zone and Number format out of CBLocale — which is the READER's setting, written by the
 * picker in Settings › Localisation. Under a heading called Business, beside Country of business, they said a
 * personal display preference was a fact about the company. The row that used to distinguish them was the
 * sentence *"From your installation. Your own reading language and formats are separate…"* — and I deleted it
 * an hour ago as explanation, which removed the only thing holding the two apart.
 *
 * ⭐ THE FIX IS NOT TO PUT THE SENTENCE BACK. It is to show the facts that ARE the business's, from the
 * ENTITY record: country and trading currency, both already on /entities/me. Time zone and number format
 * belong to the reader and live in Settings, where they can be changed — one owner per fact.
 *
 * ⚠️ AND THIS IS WHAT PASS 3 IS FOR. The duplication was not two labels saying the same thing; it was one
 * value answering two different questions, which no label-comparison would have found.
 */
/**
 * ⭐⭐ HOW THIS BUSINESS IS REACHED, ON THE SCREEN THAT ANSWERS THAT. Athi, 2026-08-20: *"channels, we setup in
 * settings, but it has to be exposed as the channel in profile? This is how this store is accessed."*
 *
 * ⭐ SAME TEST AS TRADE READY, SAME ANSWER. Settings › Channels is where you BIND a number and verify it — a
 * workbench. What belongs on a profile is the outward fact: the addresses a counterparty can actually reach.
 * The storefront link was already here answering half that question; the channels are the other half.
 *
 * ⚠️⚠️ A DECLARED CHANNEL IS NOT A WAY TO REACH ANYONE. status is declared|verified, and Settings already says
 * it plainly — "not confirmed yet: messages sent to this number reach nobody". Listing one here as though it
 * worked would put a false contact route on the screen a counterparty trusts, so it is shown as inactive
 * rather than hidden: hiding it would leave an owner wondering where their number went.
 */
function iamChannelRows() {
  var Q0 = String.fromCharCode(39);
  var list = UI._chans;
  if (list === undefined) return ''; // not read yet — say nothing rather than "none"
  if (list === null) return ''; // the read failed — same rule as the network count
  /**
   * ⚠️⚠️ AN EMPTY LIST STILL RENDERS. It used to return nothing, so an owner who had not bound a number saw no
   * trace of the feature — indistinguishable from "not built". That is the same mistake as hiding a declared
   * channel, applied to the empty case: I reasoned that a business with no channels "has nothing to say here",
   * which is true of the DATA and false of the PERSON, who needs to know the row exists and how to fill it.
   */
  if (!list.length)
    return (
      '<div class="kv" style="margin-top:2px">' +
      '<span style="color:var(--grey)">' +
      tx('no channel yet') +
      '</span>' +
      ' <a data-cbsid="ACC002-C02" href="#" onclick="navTo(' +
      Q0 +
      'settings' +
      Q0 +
      ');setSetSec(' +
      Q0 +
      'channels' +
      Q0 +
      ');return false" style="color:var(--blue);font-size:var(--fs-1);margin-inline-start:6px">' +
      tx('Add one in Channel settings') +
      ' <span class=arw>→</span></a></div>'
    );
  var Q = String.fromCharCode(39);
  /* ⚠️ NO INNER HEADING. The section is called Channels; repeating it one line down reads as a rendering
     fault — the same reason the Regional block lost its own title when it was promoted. */
  return (
    '' +
    list
      .map(function (item) {
        var ok = item.status === 'verified';
        return (
          '<div class="kv" style="margin-top:3px">' +
          '<span style="color:' +
          (ok ? 'var(--ok-3)' : 'var(--grey)') +
          '">' +
          (ok ? '✓' : '○') +
          '</span> ' +
          '<span class="mono">' +
          esc(item.address || '') +
          '</span>' +
          '<span style="color:var(--grey);font-size:var(--fs-1)"> · ' +
          esc(item.label || item.channel || '') +
          (ok ? '' : ' · ' + tx('not receiving yet')) +
          '</span></div>'
        );
      })
      .join('') +
    '<div class="kv" style="margin-top:6px"><a data-cbsid="ACC002-C03" href="#" onclick="navTo(' +
    Q +
    'settings' +
    Q +
    ');setSetSec(' +
    Q +
    'channels' +
    Q +
    ');return false" style="color:var(--blue);font-size:var(--fs-1)">' +
    tx('Channel settings') +
    ' <span class=arw>→</span></a></div>'
  );
}

/** ⚠️ Latched, like the identity record and the trade summary — this repaints, and the renderer reads it. */
async function iamLoadChannels() {
  if (UI._chansLoaded) return;
  UI._chansLoaded = true;
  try {
    var reply = await fetch(CFG.API_BASE + '/api/channels', { headers: { Authorization: 'Bearer ' + SESSION.token } });
    var j = reply.ok ? await reply.json() : null;
    /**
     * ⚠️⚠️ THE BOUND ADDRESSES ARE IN channels[].bindings[], NOT channels[]. I wrote
     *  from memory without reading lib/channels.js:  is the CATALOGUE OF
     * CHANNEL TYPES (whatsapp · email · sms · web) and each type carries its own bindings. So the profile was
     * rendering four type objects that have no address and no status — the same remembered-name mistake as
     * SESSION.identity_type, applied to an API contract instead of a variable.
     *
     * ⭐ AN API SHAPE IS A NAME LIKE ANY OTHER: reading it costs one minute, guessing it costs a screen that
     * silently shows nothing.
     */
    UI._chans =
      j && Array.isArray(j.channels)
        ? j.channels.reduce(function (all, item) {
            return all.concat(item.bindings || []);
          }, [])
        : null;
  } catch (_) {
    UI._chans = null;
  }
  bgRenderApp();
  _capShowDetail();
  loadProfile();
}

/**
 * ⭐⭐ COUNTRY · CURRENCY · TIME ZONE · TIMESTAMP, IN ONE PLACE. Athi, 2026-08-20: *"country, currency,
 * timezone, timestamp — if all in one place in profile that would be great. We can take them to settings to
 * change it."*
 *
 * ⚠️⚠️ TWO OF THESE ARE THE BUSINESS'S AND TWO ARE THE READER'S, AND THAT IS WHY THEY WERE SPLIT AN HOUR AGO.
 * Country and currency come from the ENTITY record; time zone and timestamp format come from CBLocale, which
 * is this reader's own setting. Putting them together is right — a person wants to see the four facts at once
 * — but presenting them as one KIND of fact is what made Profile claim a personal preference was a company
 * fact in the first place.
 *
 * ⭐ SO THE MESSAGE LINE CARRIES THE DIFFERENCE, WHICH IS ATHI'S OWN CONVENTION: value first, message under it.
 * "Business" and "Yours" are two words that do what a paragraph did, and they are true at a glance.
 *
 * ⚠️ THE TIMESTAMP IS SHOWN AS AN EXAMPLE, NOT A FORMAT CODE. "en-IN" tells a reader nothing; the current
 * moment rendered the way their chits will be is the same fact, legible.
 */
/* ⚠️ A CODE IS NOT A LANGUAGE TO A READER. "ta" tells a person nothing; the endonym tells them everything,
   and seeing their own script is how they confirm the setting took. */
var _LANG_NAME = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', ar: 'العربية', fr: 'Français' };
function _langName(l) {
  var n = _LANG_NAME[l];
  return n ? n + ' (' + l + ')' : String(l || '');
}

/**
 * ⭐ A FLAG AND A SYMBOL, BOTH DERIVED — no asset, no lookup table to fall out of date. Athi, 2026-08-20:
 * *"under currency, we are not showcasing the currency symbol, country flag etc? Can we."*
 *
 * The flag is the ISO-3166 code as regional-indicator codepoints: IN → 🇮🇳. Any country that exists has one,
 * automatically, including ones added after this line was written.
 *
 * ⚠️⚠️ AND ON WINDOWS IT WILL RENDER AS "IN", NOT A FLAG. Windows ships no colour flag glyphs, so Chrome draws
 * the two letters — which is why this is an ADDITION beside the name and never a replacement for it. A flag
 * that silently degrades to a country code is fine; a flag REPLACING the code would show Athi two letters
 * where he expected a picture and nothing where he expected the code.
 */
function _flag(cc) {
  var text = String(cc || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(text)) return ''; // only a 2-letter ISO code makes a flag; "India" does not
  try {
    return text.replace(/./g, function (label) {
      return String.fromCodePoint(127397 + label.charCodeAt(0));
    });
  } catch (_) {
    return '';
  }
}

/**
 * ⚠️ NOT EVERY CURRENCY HAS A SYMBOL, and Intl says so honestly — AED formats as "AED". When the symbol IS the
 * code there is nothing to add, so nothing is added rather than printing "AED AED".
 */
function _curSym(cur) {
  try {
    var list = new Intl.NumberFormat(CBLocale.locale ? CBLocale.locale() : 'en', { style: 'currency', currency: cur }).formatToParts(1);
    var c = list.find(function (x) {
      return x.type === 'currency';
    });
    return c && c.value && c.value !== cur ? c.value : '';
  } catch (_) {
    return '';
  }
}

/**
 * Do these two zones actually put the clock in a different place right now?
 *
 * ⭐ COMPARING NAMES IS WRONG — Asia/Calcutta === Asia/Kolkata, Europe/Kiev === Europe/Kyiv, and a dozen more
 * aliases besides. Comparing the RENDERED INSTANT answers the only question a reader has: will my timestamps
 * read differently from the business's? Two names for one zone answer "no", which is correct.
 */
function _tzDiffers(a, b) {
  if (!a || !b) return false;
  if (a === b) return false;
  try {
    var t = Date.now();
    var f = function (z) {
      return new Intl.DateTimeFormat('en-GB', { timeZone: z, dateStyle: 'short', timeStyle: 'short' }).format(t);
    };
    return f(a) !== f(b);
  } catch (_) {
    return false;
  } /* an unknown zone is not evidence of a difference */
}

/**
 * The detail-page choice, as the profile states it.
 *
 * ⚠️ IT READS THE SAME SOURCE THE SETTING WRITES — `SESSION.policy_flags`, carried on `/entities/me` — not a
 * second copy. A profile that renders a remembered value is a profile that eventually contradicts Settings.
 */
/**
 * The chosen design's NAME — one source, read by the collapsed hint and the open body alike.
 *
 * ⚠️ typeof-guarded: the shell owns SESSION and this module is rendered standalone by the guards. That is the
 * codebase's own pattern for a cross-module call — a bare call passes in the browser and fails the guard.
 */
function iamDetailDesignName() {
  var v = typeof detailDesignPref === 'function' ? detailDesignPref() : 'chit';
  return v === 'lines' ? tx('Line level') : tx('Order level');
}

function iamDetailDesignRow(e) {
  var Q = String.fromCharCode(39);
  var v = typeof detailDesignPref === 'function' ? detailDesignPref() : 'chit';
  var name = iamDetailDesignName();
  var why = v === 'lines' ? tx('Each line has its own person, parts and cost.') : tx('The chit is the unit of work — one state, one value.');
  /**
   * ⚠️⚠️ THIS SAID "change in Settings" IN GREY, AND WAS NOT A LINK. Athi, 2026-08-29: *"where in settings
   * we are changing it, it is not directly taking us to change in settings?"* A row that names the place you
   * must go and does not take you there is worse than one that says nothing — it looks like a control, so the
   * reader clicks it, nothing happens, and they go hunting through eight sections.
   *
   * ⚠️ AND "Settings" WAS NOT ENOUGH OF AN ANSWER EITHER. Settings has eight sections and this lives under
   * Policy, which is not the word anyone would guess for how a job reads. The destination is named now.
   *
   * ⭐ The idiom was already on THIS screen five times — navTo('settings') then setSetSec(<section>), used by
   * Channels twice, Localisation, Appearance and Governance. Detail page was the only row that told the reader
   * to go and left them to find it.
   */
  return (
    '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:2px 0">' +
    '<div style="min-width:0"><div style="font-weight:600;font-size:var(--fs-3)">' +
    esc(name) +
    '</div>' +
    '<div style="color:var(--grey);font-size:var(--fs-2);margin-top:2px">' +
    esc(why) +
    '</div></div>' +
    '<a data-cbsid="ACC002-C04" href="#" data-testid="prof-detail-design"' +
    ' onclick="navTo(' +
    Q +
    'settings' +
    Q +
    ');setSetSec(' +
    Q +
    'policy' +
    Q +
    ');return false"' +
    ' style="font-size:var(--fs-1);color:var(--blue);white-space:nowrap">' +
    esc(tx('change in Settings › Policy')) +
    ' <span class=arw>→</span></a></div>'
  );
}

function iamGovernedRows(e) {
  var rows = [];
  var Q = String.fromCharCode(39);
  var country = (e && e.country) || null;
  try {
    var r = CBLocale.regionInfo && CBLocale.regionInfo();
    /* ⚠️ THE FLAG IS APPENDED, NEVER SUBSTITUTED — on Windows it renders as two letters, so the name must
       still be there. A flag that degrades to a country code is fine; one that REPLACES the name shows a
       reader two letters where they expected a picture and nothing where they expected the name. */
    /**
     * ⚠️⚠️ THE ENTITY'S COUNTRY, NEVER THE READER'S REGION. My first version preferred regionInfo().code — which
     * is the READER's region — so a UAE business showed the INDIAN flag to an Indian reader. The third time
     * today that a reader-side locale value was used for an entity-side fact, and the most visibly wrong:
     * currency and time zone disagree quietly, a flag disagrees in colour.
     *
     * ⭐ AND NO FLAG IS BETTER THAN THE WRONG FLAG. If the entity's country is stored as a NAME ("India") there
     * is no code to derive from, so nothing is drawn — borrowing the reader's would be inventing a fact about
     * someone else's business.
     */
    var _cc = country && String(country).length === 2 ? country : null;
    rows.push(['Country', ((country || (r && r.name) || 'Not set') + ' ' + _flag(_cc)).trim(), '', false, 'biz', country ? 'biz' : 'def']);
  } catch (_) {
    if (country) rows.push(['Country', country, '', false, 'biz', 'biz']);
  }
  /**
   * ⚠️⚠️ CURRENCY AND TIME ZONE CAN CONTRADICT RIGHTS › BASICS, AND ATHI ASKED THE RIGHT QUESTION.
   *
   * Basics resolves currency, timezone and region from the INSTALLATION, bounded by the constitution
   * (lib/govresolve.js). Regional read them from the ENTITY ROW. Two sources, one word.
   *
   * ⚠️ AND identities.currency_code IS  WITH NOTHING IN THE APP EVER WRITING IT — no control,
   * no update path. So it is not the business's choice; it is an unset column showing a default. On any
   * non-INR installation the two screens disagree TODAY: Basics says AED, Regional says INR.
   *
   * ⭐ THE FIX IS THE RULE THIS SCREEN ALREADY FOLLOWS — one owner per fact. The governed value is the answer
   * unless this entity has explicitly chosen otherwise, and the message column says WHICH, so a reader is
   * never left comparing two numbers with no way to know which governs.
   */
  /**
   * ⚠️⚠️ THE GOVERNED VALUE WINS, AND MY FIRST ATTEMPT HAD IT BACKWARDS. I preferred the entity column and fell
   * back to governance — which never fires, because identities.currency_code is . The column
   * is ALWAYS truthy, so a UAE installation still showed INR beside Basics saying AED: the contradiction
   * Athi asked about, with a comment on top explaining it was fixed.
   *
   * ⭐ THE COLUMN CANNOT EXPRESS "NOT CHOSEN" — a default that is a real value is indistinguishable from a
   * decision. And nothing in the app ever WRITES it: there is no control, no update path. So it is not a
   * choice today, and the governed value is the answer until something makes it one.
   */
  /**
   * ⭐⭐ REGION BOUNDS THE SET; THE ENTITY PICKS ONE. Athi, 2026-08-20: *"if the region changes, can it have
   * different currency? Under region there can be MULTIPLE currencies, one of the currency will be chosen."*
   *
   * ⚠️ I HAD THIS WRONG TWICE. First the entity column won — which never fires, because currency_code is
   * DEFAULT INR and always truthy. Then governance won — which removes the choice Athi is describing. The
   * model is neither: the CONSTITUTION names what is permitted, and the entity picks from inside it.
   *
   * ⭐ SO THE ROW IS A CONTROL ONLY WHEN THERE IS A CHOICE. One permitted currency is a fact and renders as a
   * fact; two or more is a decision and renders as a picker. A select with one option is a control that
   * cannot be used — the same false affordance as a link to a closed shop.
   */
  var gb = (e && e.governance && e.governance.basics) || {};
  var gal = (e && e.governance && e.governance.allowed) || {};
  var perm = Array.isArray(gal.currencies) ? gal.currencies : null;
  /**
   * ⚠️⚠️ PRECEDENCE FOLLOWS WHETHER A CHOICE EXISTS AT ALL — that is the piece both my earlier attempts missed.
   *   · the layer permits SEVERAL  → the entity's pick wins; it is a decision
   *   · the layer permits ONE      → that one; there is nothing to decide
   *   · the layer permits NOTHING EXPLICIT → the governed value wins, because the column is DEFAULT INR and
   *     never written, so it is not a choice — it is a default masquerading as one. This is the case that
   *     made Rights say AED and Regional say INR on the same screen.
   */
  var hasChoice = !!(perm && perm.length > 1);
  var curr = hasChoice ? (e && e.currency_code) || gb.currency || null : gb.currency || (e && e.currency_code) || null;
  /* ⚠️ A STORED VALUE OUTSIDE THE ENVELOPE IS NOT SILENTLY SUBSTITUTED — it is named, because a business
     trading in a currency its layer no longer permits needs to know, not to have it quietly corrected. */
  /* ⚠️ THE STORED VALUE, NOT THE RESOLVED ONE. Checking  could never fire once governance won the
     precedence — so a business whose saved currency is no longer permitted would have been silently shown the
     permitted one and never told. The question is about what THEY hold, not what we chose to display. */
  var stored = (e && e.currency_code) || null;
  var outside = !!(perm && perm.length && stored && perm.indexOf(stored) < 0);
  /**
   * ⭐⭐ A FACT, NOT A CONTROL — THE PICKER THAT WAS HERE IS NOW IN SETTINGS. Athi, 2026-08-21: *"why have we
   * brought the currency to choose here? Let it be in settings only."*
   *
   * ⚠️ HE HAD ALREADY GIVEN THE RULE AND THIS ROW BROKE IT: *"settings is where we can change the value,
   * profile is the personal preference — settings snapshot."* One editable <select> in a column of read-only
   * rows also reads as an accident, because the eye takes a control as permission and every neighbour said no.
   *
   * ⚠️ AND IT WAS WRITING TO THE WRONG ROW ANYWAY. PATCH /profile writes req.identity.identity_id — the
   * CALLER'S record — so a co-assist changing 'the business currency' landed it on their own actor row, where
   * nothing reads it. The screen said saved, the business still priced in the old currency. Same shape as the
   * user_id theft, minus the global name: the API now refuses it outright (CURRENCY_ENTITY_ONLY).
   */
  var stored = (e && e.currency_code) || null;
  var outside = !!(perm && perm.length && stored && perm.indexOf(stored) < 0);
  if (curr) {
    /* ⚠️ LABELLED BY WHERE THE VALUE CAME FROM, not by whether a list exists. With no allowed set the governed
       value wins — and calling that "Business" was the original lie in a new place. */
    var fromGov = (curr === gb.currency && curr !== stored) || (!stored && !!gb.currency);
    /* ⭐ SYMBOL BESIDE THE CODE — '₹ INR'. The code is what a system needs; the symbol is what a person
       recognises. Neither replaces the other, and not every currency has one (AED formats as AED). */
    rows.push([
      'Currency',
      esc((_curSym(curr) ? _curSym(curr) + ' ' : '') + curr) + _locLink(tx('Currency'), 'loc-currency'),
      outside ? txf('{cur} no longer permitted', { cur: stored }) : '',
      true,
      'biz',
      fromGov ? 'gov' : 'biz'
    ]); /* ⚠️ blank where the GROUP HEADING already says it — the message column is for exceptions only */
  }
  /**
   * ⚠️⚠️ THE ZONE IS THE BUSINESS'S, AND THE READER'S IS THE FALLBACK — NOT THE OTHER WAY ROUND.
   * Athi, 2026-08-20: *"how come it is mine? It is entity's timezone and currency, country, clock."* He is
   * right, and the code could not say so: identities had no timezone until b176. A chit is a shared record —
   * "received 19:00" must mean one instant with one reading inside a business, or two colleagues discussing
   * the same chit are discussing different times.
   *
   * ⚠️ WHEN b176 HAS NOT RUN, OR NOBODY HAS PICKED ONE, IT SAYS SO. Showing the reader's zone under a
   * "Business" label would be the original mistake with a better label on it.
   */
  var bizTz = (e && e.timezone) || null;
  try {
    /* ⚠️ SAME THREE-WAY ANSWER AS CURRENCY: the entity's own zone if b176 gave it one, else the governed zone
       from the installation, else this device — each labelled, so Rights and Regional can never look like two
       opinions about one fact. */
    if (bizTz) rows.push(['Time zone', bizTz, '', false, 'biz', 'biz']);
    else if (gb.timezone) rows.push(['Time zone', gb.timezone, '', false, 'biz', 'gov']);
    else if (CBLocale.timezone) rows.push(['Time zone', CBLocale.timezone(), tx('your device — not set for the business'), false, 'biz', 'def']);
    /* ⚠️ A LIVE EXAMPLE, so a wrong setting is obvious rather than encoded. */
    /* ⚠️ THE TIMESTAMP FORMAT IS STILL THE READER'S, AND SAYING OTHERWISE WOULD BE A LIE. b176 stores the
       business's ZONE; every date on every screen still renders through CBLocale. Redirecting that is a
       deliberate change across the whole app, not a side effect of adding a column — so the label states what
       is true today rather than what the design intends. */
    /**
     * ⭐⭐ LANGUAGE AND DIRECTION JOIN THIS GROUP. Athi, 2026-08-20: *"under regional, language and read
     * right-to-left or left-to-right settings, under 'how you read it' title — the title can be separate so it
     * can show the preferred language, 1, 2 and 3."*
     *
     * ⚠️ DIRECTION IS NOT A SETTING, IT IS A CONSEQUENCE. CBLocale.dir() derives it from the language via
     * Intl.Locale.getTextInfo — Arabic reads right-to-left because it is Arabic, not because someone ticked a
     * box. Offering it as a choice would let a person set a combination no language on earth uses, which is
     * the same reasoning that keeps number grouping tied to the region.
     *
     * ⭐ AND THE ORDER IS THE MEANING. 1, 2, 3 is a fallback chain (RFC 4647): show me Tamil, else Hindi, else
     * English. Rendering them as an unordered list would lose the only thing that distinguishes them.
     */
    var _langs = (CBLocale.langs ? CBLocale.langs() : [CBLocale.lang && CBLocale.lang()]).filter(Boolean);
    _langs.forEach(function (item, index) {
      rows.push([
        (index === 0 ? tx('Language') : ' ') + ' ' + (index + 1),
        _langName(item),
        index === 0 ? tx('first choice') : tx('then'),
        false,
        'read',
        /**
         * ⚠⚠ 'IS cb_langs SET' IS NOT 'DID YOU CHOOSE IT'. setRegion() WRITES the language list as a side
         * effect — pick India and cb_langs becomes ['en'] without anyone touching a language control. Testing
         * for the key's presence therefore marked every reader's languages as their own choice, which is the
         * precise lie this mark exists to prevent: it would send someone hunting for a decision they never made.
         *
         * ⭐ SO IT IS DERIVED BY COMPARISON, not by a flag. Still the region's own first language, alone? That
         * is the default. Anything else — a second language, a different first — required a human to act.
         */
        _langsAreDefault() ? 'def' : 'you'
      ]);
    });
    if (CBLocale.dir)
      /* ⚠️ NO MARK. Direction is not derived from a SOURCE, it is derived from the language — there is no layer
       that could have set it and no choice a reader could make. Marking it 'Default' would invite someone to
       look for the control that overrides it. */
      rows.push(['Reads', CBLocale.dir() === 'rtl' ? tx('right to left') : tx('left to right'), tx('follows the language'), false, 'read']);
    /**
     * ⚠️⚠️ THE READER'S ZONE BELONGS IN THIS GROUP, and leaving it out is what made Settings look broken.
     * Athi, 2026-08-21: *"when I click the language and formats hyperlink it goes to settings, but it shows
     * something different from what is there in the profile."*
     *
     * Measured: changing the zone in Settings moved the profile TIMESTAMP (07:11 → 02:41, the same instant in
     * London) while the row labelled TIME ZONE went on saying Asia/Kolkata. Both were correct — that row is
     * the BUSINESS's clock (b176) and the picker sets the READER's device — but a person who changes a
     * setting called Time zone and watches a row called Time zone not move concludes the save failed.
     *
     * ⭐ SO THE TIMESTAMP NAMES THE ZONE IT IS RENDERED IN, and only when it differs from the business's.
     * When they agree there is nothing to disambiguate and a second zone row would be noise; when they differ,
     * that difference is the explanation for a timestamp that just moved.
     */
    var _readTz = (CBLocale.timezone && CBLocale.timezone()) || null;
    var _bizTz2 = (e && e.timezone) || null;
    /**
     * ⭐⭐ THE REGION THE SAMPLES ARE WRITTEN FOR, NAMED. Athi, 2026-08-21, holding the two screens side by
     * side: *"still looks different — one from profile and another one from settings?"* Profile said COUNTRY:
     * IN; Settings said PRESENTATION: United States. Both correct, and together they read as a bug.
     *
     * ⚠⚠ THEY ARE TWO DIFFERENT FACTS WEARING SIMILAR NAMES. `Country` is identities.country — where the
     * BUSINESS is. `Region` is cb_region — how THIS READER wants figures written. A business in India read by
     * someone on a US-configured device is a perfectly ordinary state, and nothing on the profile said so: the
     * only evidence was 12,345,678.9 grouping the American way under a row that said IN.
     *
     * ⚠️ I HAD ALREADY FIXED THIS EXACT SHAPE FOR THE TIME ZONE and did not generalise it. The timestamp
     * names its zone when it differs from the business's; the number format named nothing at all. My own
     * alignment guard called Region 'demonstrated — drives every sample', which is too weak a standard: a
     * sample proves the EFFECT and never lets a reader check the SETTING. It is NAMED now, and the guard says so.
     *
     * ⚠️ THE NOTE APPEARS ONLY WHEN THEY DIFFER. When the reader's region and the business's country agree
     * there is nothing to disambiguate, and a permanent line explaining a non-difference is the text budget
     * being spent on nobody.
     */
    try {
      var _fr = CBLocale.region && CBLocale.region();
      var _fri = CBLocale.regionInfo && CBLocale.regionInfo();
      var _ftag = CBLocale.tag ? CBLocale.tag() : CBLocale.locale && CBLocale.locale();
      /* ⚠️ THE BASE TAG ONLY. en-IN-u-fw-sun-nu-deva is a machine's answer to a human's question; every -u-
         extension is spelled out in the note beside it, so showing both would be the same fact twice, once
         illegibly. split('-u-')[0] rather than a regex — the separator is literal and fixed by BCP 47. */
      if (_ftag) _ftag = String(_ftag).split('-u-')[0];
      if (_fr || _ftag) {
        var _fname = (_fri && _fri.name) || _fr || '';
        /**
         * ⭐⭐ AND THE THREE SETTINGS THAT HAD NO NAME ANYWHERE RIDE HERE. Athi, 2026-08-21: *"even the
         * numbering system etc shows wrong."* They were not wrong — measured, `nu=deva` really does render
         * १,२३,४५,६७८.९ and `ca=indian` really does render 30 Sravana. They were UNNAMED: a reader who chose
         * Devanagari digits saw them under a row called NUMBERS with nothing saying which setting did that.
         *
         * ⚠️ ONE LINE, NOT THREE ROWS. Numbering system, hour cycle and calendar are each a rarely-touched
         * refinement of the same question this row already answers. Three permanent rows would spend the text
         * budget on settings almost nobody changes and push the group past six; one note, listing only what was
         * actually overridden, costs nothing when nothing was.
         *
         * ⚠️ AND ONLY OVERRIDES — the region's own defaults are already visible in the samples below. Naming
         * a default is not information, it is noise that makes the real choices harder to spot.
         */
        var _ov = [];
        try {
          if (CBLocale.getExt) {
            var _nu = CBLocale.getExt('nu'),
              _hc = CBLocale.getExt('hc'),
              _ca = CBLocale.getExt('ca');
            if (_nu) _ov.push(_locName(NUMERALS, _nu));
            if (_hc) _ov.push(_locName(HOURS, _hc));
            if (_ca) _ov.push(_locName(CALS, _ca));
            /* ⚠️ FIRST DAY OF WEEK WAS 'NAMED' ONLY AS THE SUBTAG -u-fw-sun INSIDE en-IN-u-fw-sun. That is
               named the way a licence plate names a car: technically identifying, unreadable by the person
               who set it. It says 'Week starts Sunday' now, and the tag below drops its -u- extensions. */
            var _fw = CBLocale.getExt('fw');
            if (_fw) _ov.push(txf('week starts {d}', { d: _locName(WEEK, _fw) }));
          }
        } catch (_) {
          /* no ext layer — the row still names the region */
        }
        var _diff =
          _fr && country && String(_fr).toUpperCase() !== String(country).toUpperCase() ? txf('your device — the business is in {c}', { c: country }) : '';
        /* ⚠️ THE ARROW POINTS AT THE REGION PICKER, the control that decides most of this row — and the
           override names in the note each carry their own, so 'Devanagari →' lands on the numeral picker
           rather than making the reader guess which of six controls produced it. */
        var _fval = esc(_fname ? _fname + (_ftag ? ' (' + _ftag + ')' : '') : _ftag) + _locLink(tx('Region'), 'loc-region');
        rows.push([
          'Format',
          _fval,
          [_diff].concat(_ov).filter(Boolean).join(' · '),
          true,
          'fmt',
          CBLocale.region() || (CBLocale.getExt && CBLocale.getExt('locale')) ? 'you' : 'def'
        ]);
      }
    } catch (_) {
      /* absent locale layer — the samples below still speak for themselves */
    }
    if (CBLocale.datetime)
      rows.push([
        'Timestamp',
        esc(CBLocale.datetime(Date.now())) + _locLink(tx('Time zone'), 'loc-tz'),
        /**
         * ⚠️ THE COMPARISON IS THE CLOCK, NOT THE NAME. Asia/Calcutta and Asia/Kolkata are THE SAME ZONE under a
         * legacy alias, and a string compare called them different — so the note claimed a reader was on another
         * clock when they were not. The note exists to explain a timestamp that DIFFERS; if the two zones render
         * the same instant identically there is nothing to explain, whatever they are called.
         */
        _tzDiffers(_readTz, _bizTz2) ? txf('shown in {tz} — your device', { tz: _readTz }) : '',
        true,
        'fmt'
      ]); /* ⚠️ isHtml — the value now carries the jump-to-control arrow */
    /* ⭐ NUMBERS, AS AN EXAMPLE FOR THE SAME REASON AS THE TIMESTAMP. India groups 12,34,56,789 and the US
       groups 123,456,789 — a reader recognises their own grouping instantly and would have to decode
       'en-IN'. Athi: *"number system also."* */
    if (CBLocale.number) rows.push(['Numbers', esc(CBLocale.number(12345678.9)) + _locLink(tx('Numbering system'), 'loc-nu'), '', true, 'fmt']);
    else if (CBLocale.locale)
      rows.push(['Numbers', esc((12345678.9).toLocaleString(CBLocale.locale())) + _locLink(tx('Numbering system'), 'loc-nu'), '', true, 'fmt']);
    /**
     * ⭐⭐ THEME AND TEXT SIZE JOIN "HOW YOU READ IT" — because that is literally what they are. Athi,
     * 2026-08-21: *"under profile, personal preference the colour scheme and the size of the char, say 75%,
     * 100% etc. can be shown, set? That brings all in one place."*
     *
     * ⚠️ THE CONTROLS ALREADY EXIST — Settings › Appearance has both, and the size is already expressed as a
     * percentage. So this is not a second control; it is the same answer, shown where a person is already
     * reading their other reading preferences. Two pickers for one setting is how a screen disagrees with
     * itself, which is what the goods/services pointer avoided an hour ago.
     *
     * ⭐ AND THE PERCENTAGE IS THE USEFUL PART. "Large" means nothing next to "Default"; 115% says how much.
     */
    /**
     * ⭐⭐ THE SNAPSHOT MUST COVER EVERY SETTING, OR IT IS NOT A SNAPSHOT. Athi, 2026-08-21: *"settings is where
     * we can change the value, profile is the personal preference — settings snapshot, and it has to be
     * aligned. Check for all the values in settings."*
     *
     * ⚠️ SETTINGS CAN CHANGE NINE THINGS; THIS NAMED FOUR. Region, format, languages, numbering system, hour
     * cycle, calendar, first day of week, working days, time zone. Numbering, hour cycle and calendar are
     * DEMONSTRATED by the Timestamp and Numbers samples — a reader sees ١٢٣ or a 24-hour clock without being
     * told the setting's name. But WORKING WEEK appears in no sample at all, so a person could set it and
     * find no trace of it here.
     *
     * ⭐ SO: demonstrated is enough for a format; invisible is not. The working week gets a row.
     */
    try {
      if (CBLocale.workdays) {
        var _D = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
        var _wd = CBLocale.workdays() || [];
        if (_wd.length)
          rows.push([
            'Working week',
            esc(
              _wd
                .map(function (item) {
                  return _D[item] || item;
                })
                .join(' ')
            ) + _locLink(tx('Working days'), 'loc-workdays'),
            '',
            true,
            'fmt',
            CBLocale.hasWorkdayOverride && CBLocale.hasWorkdayOverride() ? 'you' : 'def'
          ]);
      }
    } catch (_) {
      /* absent locale layer — show what we have */
    }

    try {
      if (typeof THEMES !== 'undefined' && typeof themeGet === 'function') {
        var _th = THEMES[themeGet()] || {};
        rows.push([
          'Theme',
          esc(_th.name || themeGet()) + _locLink(tx('Theme'), 'theme-' + themeGet(), 'appearance'),
          _th.a11y ? txf('meets WCAG {level}', { level: _th.a11y.level }) : '',
          true,
          'look',
          'you'
        ]);
      }
      if (typeof TEXT_SIZES !== 'undefined' && typeof textSize === 'function') {
        var _ts = TEXT_SIZES.filter(function (x) {
          return x[0] === textSize();
        })[0];
        if (_ts)
          rows.push([
            'Text size',
            esc(_ts[1] + ' · ' + Math.round(_ts[2] * 100) + '%') + _locLink(tx('Text size'), 'ap-fs-' + textSize(), 'appearance'),
            '',
            true,
            'look',
            'you'
          ]);
      }
    } catch (_) {
      /* appearance layer absent — show what we have rather than nothing */
    }
  } catch (_) {
    /* locale layer absent — show what we have rather than nothing */
  }

  if (!rows.length) return '';
  /**
   * ⭐⭐ THE GROUP IS CALLED "REGIONAL". Athi, 2026-08-20: *"that group, how do we call it? Any industry
   * standard name for it, other than locale?"*
   *
   * LOCALE is the engineering word — POSIX, CLDR, ICU, Intl — and it is precise, which is why it is in the
   * code and not on the screen. REGIONAL is what the same set is called wherever a person meets it: Windows
   * "Region and language", macOS "Language & Region", Android "Regional preferences". A word people have
   * already learned somewhere else costs nothing to learn here.
   *
   * Rejected: "Jurisdiction" (already means the governance layer in this product — a collision), "Formatting
   * conventions" (CLDR's own phrase, and four syllables of nobody's vocabulary), "Territory" (CLDR's word
   * for the country alone, so it under-names the group).
   */
  /* ⚠️ NO TOP RULE OR MARGIN NOW — those separated it from the licence rows it used to sit under. A section
     already has its own frame, and a divider inside one reads as a second, emptier section. */
  /**
   * ⭐⭐ TWO TITLED GROUPS, NOT A SOURCE COLUMN ON EVERY ROW. Athi, 2026-08-20: *"under 'how you read it'
   * title — the title can be separate."*
   *
   * The message column was doing a heading's job one row at a time: "Business, Business, Business, How you
   * read it, How you read it". A heading says it once and groups what it governs, which is what a person is
   * actually scanning for — whose fact is this, and can I change it.
   *
   * ⚠️ THE PER-ROW MESSAGE SURVIVES WHERE IT SAYS SOMETHING THE HEADING CANNOT — "Set above you" on a currency
   * the layer chose, "no longer permitted" on one it has withdrawn, "first choice / then" on the language
   * chain. A heading cannot carry an exception.
   */
  /**
   * One Regional row. Athi, 2026-08-20: *"if the comment takes space bring it underneath."*
   *
   * ⭐⭐ THAT IS HIS OWN CONVENTION, APPLIED CONSISTENTLY — value first, message beneath it, settled on the
   * governance boxes ("base@v1" then "Platform set"). Here the message sat in a right-hand column instead,
   * competing with the value for width on a narrow screen and pushing "no longer permitted" onto its own line
   * anyway. Underneath, it costs nothing horizontally and reads in the order a person needs it: what it is,
   * then whose it is.
   */
  /* ⭐ Regional rows go through the SAME renderer as every other profile row — see profRow. x[3] flags markup. */
  /* ⚠️ x[4] IS THE GROUP, x[5] THE SOURCE — positional, because these rows are built by twenty push() calls
   across three hundred lines and converting them all to objects is a change with no test behind it. The
   cost is that a row written with four elements gets no mark, which _srcMark answers with silence. */
  var rowHtml = function (x) {
    return profRow(x[0], x[1], x[2], !!x[3], x[5]);
  };
  /**
   * ⚠️ A HEADING MUST NOT LOOK LIKE A ROW LABEL. Athi, 2026-08-20: *"can you make indentation or size
   * difference or underline for the heading — some difference should be there between heading and text."*
   *
   * It was uppercase-small-grey — the SAME treatment as the row labels beside it — so "BUSINESS" and
   * "COUNTRY" read as two items in one list rather than a group and its contents. Three differences now,
   * because on a dense screen one is easy to miss: it is LARGER, it carries a RULE beneath it, and the rows
   * are INDENTED under it. Contrast is already measured by a11y-contrast; hierarchy was not measured by
   * anything, which is why it drifted.
   */
  /* ⭐ and the SAME group heading — see profGroup. */
  var grp = function (title, list) {
    return list.length ? profGroup(title, list.map(rowHtml).join('')) : '';
  };
  return (
    '<div>' +
    /* ⚠️ THE IN-BLOCK 'Regional' HEADING WENT WITH THE PROMOTION — the section header says it now, and a
       title repeated immediately under itself reads as a rendering fault. */
    /**
     * ⭐⭐ FOUR SMALL GROUPS, NOT TWO WITH ONE OF THEM SEVEN ROWS LONG. Athi, 2026-08-21: *"a small list is
     * always good, human brain cannot take multiple things in one go — so small groups like identity, business;
     * if too many in one single group, split it with a subgroup."*
     *
     * ⚠️ 'How you read it' HAD BECOME A DRAWER. It started as language and direction — two rows that genuinely
     * belong together — and then timestamp, numbers, working week, theme and text size were each added to it
     * because it was the group that existed. Seven unrelated rows under one heading is a list, which is the
     * thing the heading was there to prevent.
     *
     * ⚠️ THE SPLIT IS BY QUESTION ANSWERED, NOT BY ROW COUNT. Cutting seven at the midpoint would produce two
     * groups nobody could name; the test of a real group is that its heading is a question a reader would ask —
     * where are you · what language · how are values written · how does it look.
     *
     * ⚠️ ONE TABLE DRIVES IT, so a fifth group is a line here plus a key on the row — not a fourth copy of
     * .filter(r[4] === '…'), which is how the drawer formed in the first place.
     */
    [
      ['biz', tx('Business')],
      ['read', tx('How you read it')],
      ['fmt', tx('How values are written')],
      ['look', tx('How it looks')]
    ]
      .map(function (item) {
        /* ⚠️ 'biz' MATCHES AN ABSENT KEY TOO — a row pushed without a group must land somewhere visible,
           not vanish because a five-element array was written with four. */
        return grp(
          item[1],
          rows.filter(function (nestedR) {
            return (nestedR[4] || 'biz') === item[0];
          })
        );
      })
      .join('') +
    /* ⭐ ONE LINK OUT, NOT FOUR. Athi: *"we can take them to settings to change it."* */
    /* ⚠️ TWO DESTINATIONS, BECAUSE THE GROUP HAS TWO OWNERS. Language and formats are set in Localisation;
       theme and text size in Appearance. One link would send half the readers to the wrong screen, and a
       link that lands you somewhere without the control you came for is worse than no link. */
    '<div style="margin-top:9px;display:flex;gap:14px;flex-wrap:wrap">' +
    '<a data-cbsid="ACC002-C05" href="#" onclick="navTo(' +
    Q +
    'settings' +
    Q +
    ');setSetSec(' +
    Q +
    'locale' +
    Q +
    ');return false" style="color:var(--blue);font-size:var(--fs-1)">' +
    tx('Language and formats') +
    ' <span class=arw>→</span></a>' +
    '<a data-cbsid="ACC002-C06" href="#" onclick="navTo(' +
    Q +
    'settings' +
    Q +
    ');setSetSec(' +
    Q +
    'appearance' +
    Q +
    ');return false" style="color:var(--blue);font-size:var(--fs-1)">' +
    tx('Theme and text size') +
    ' <span class=arw>→</span></a>' +
    /* ⚠️ WITH THE TWO LINKS, NOT ABOVE THE ROWS. This line answers a question about the rows rather than
       being one of them; putting it at the top would make every reader step over it to reach the content they
       came for, which is the cost the opt-in exists to avoid. */
    profSrcBtn() +
    '</div>' +
    '</div>'
  );
}

/** The boundary badge. ⚠️ Same three words everywhere, so the spine is learnable in one read. */

/* ══ WHO ════════════════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ iamWhoHTML and iamAccessHTML LIVED HERE and were removed 2026-08-19. They rendered the old "who can
 * act" and "what access" panes, which the four IAM tabs replaced — orphaned by my own restructure, and
 * found by e2e/dead-surface.cjs rather than by me remembering.
 */
/* namingRulesHTML lived here — removed with its only caller (the dead __iam_old branch). It was the table
 * that explained what a Bridge ID is, and that is the explanation Athi asked to remove everywhere. */
/* ⚠️ AN ASYNC SECTION PAINTS ITS OWN END MARKER. "— end —" says the panel is complete; appended here it landed
   directly under the vault's "loading…", telling the reader they had seen everything while nothing had arrived.
   The vault is the only section whose body is a placeholder rather than its content — see loadVault(). */
/**
 * ── USAGE ──────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Athi, 2026-08-23: *"complete cost on the chit if it is small, and give me a screen to look at the details in
 * the profile."*
 *
 * ⚠️⚠️ THE ONE THING THIS SCREEN MUST NEVER DO IS CALL THIS "CHITS SENT". A meter is best-effort by design —
 * it may never fail a send — so the ledger counts what was BILLED, and that can legitimately sit below the
 * number of chits in the mailbox. **The gap is the finding**: it means events were not billed. A screen that
 * blurs the two invites someone to reconcile the difference away and throw the finding out, so the word
 * "billed" is on the number itself, not in a footnote.
 *
 * ⭐ Loaded only when the section is opened — nothing here is needed to paint a profile.
 */
function iamLoadUsage() {
  if (UI._usageBusy) return;
  UI._usageBusy = true;
  api('entityUsage')
    .then(function (reply) {
      UI._usage = reply || {};
    })
    .catch(function (e) {
      /* A read that failed and a ledger that is empty are different claims; say which. */
      UI._usage = { _err: (e && e.message) || 'Could not read your usage.' };
    })
    .then(function () {
      UI._usageBusy = false;
      if (profSec() === 'usage') bgRenderApp();
    });
}

function _usageMoney(n) {
  var v = Number(n || 0);
  return '$' + (Math.round(v * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00');
}

/**
 * ⚠️⚠️ THE FIRST VERSION OF THIS WAS UNREACHABLE, and the test suite could not have told me. I added it to
 * `PROF_SECS` — a registry whose rail was removed weeks ago, so `profSec()` now only ever returns 'identity'
 * and the four panels live as sections inside `iamMeHTML`. render-smoke went green because it called
 * `usageHTML()` directly: **it proved the renderer works, not that anything reaches it.** Athi found it in
 * about a minute by opening the profile and not seeing it.
 *
 * ⭐ So it is an `iamSection` like every other panel, and the body is only built when the section is OPEN —
 * which is also what keeps the profile's read count where it is.
 */
function usageBody() {
  var open = !!(UI._iamOpen && UI._iamOpen.usage);
  if (!open) return '<div class="mut" style="font-size:var(--fs-2)">' + tx('Open to read your usage.') + '</div>';
  return usageHTML();
}

function usageHTML() {
  var u = UI._usage;
  /* No outer heading: iamSection supplies the title, and two would read as two panels. */
  if (!u) {
    iamLoadUsage();
    return '<div class="mut">' + tx('Reading your usage…') + '</div>';
  }
  if (u._err) return scrErr(u._err);
  if (u.not_enabled) {
    return '<div class="mut">' + tx('Usage recording is not switched on for this deployment yet.') + '</div>';
  }

  var out = '';

  /* ── the headline, and the caveat as part of it ── */
  out +=
    '<div class="card" style="padding:12px 14px">' +
    '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:baseline">' +
    '<div><div style="font-size:var(--fs-6);font-weight:700">' +
    _usageMoney(u.total_cost_usd) +
    '</div>' +
    '<div class="mut" style="font-size:var(--fs-1)">' +
    txf('billed over {n} days', { n: u.window_days }) +
    '</div></div>' +
    '<div><div style="font-size:var(--fs-5);font-weight:600">' +
    ((u.counts && u.counts.billed) || 0) +
    '</div>' +
    '<div class="mut" style="font-size:var(--fs-1)">' +
    tx('events billed') +
    '</div></div>' +
    (u.rate_card
      ? '<div><div class="mono" style="font-size:var(--fs-2)">' +
        esc(u.rate_card) +
        '</div>' +
        '<div class="mut" style="font-size:var(--fs-1)">' +
        tx('rate card') +
        '</div></div>'
      : '') +
    '</div>' +
    /* ⚠️ Stated on the screen, not only in the code: this is billed, not sent. */
    '<div class="mut" style="font-size:var(--fs-1);margin-top:8px">' +
    tx(
      'Counts what was billed. Recording never blocks a send, so this can sit below the chits in your mailbox — that difference means those events were not billed.'
    ) +
    '</div></div>';

  /* ── by meter ── */
  if ((u.by_meter || []).length) {
    out += '<div class="sec">' + tx('By kind') + '</div><div class="card" style="padding:4px 0">';
    u.by_meter.forEach(function (item) {
      out +=
        '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 14px;border-bottom:1px solid var(--line)">' +
        '<span class="mono" style="font-size:var(--fs-2)">' +
        esc(item.meter) +
        '</span>' +
        '<span class="mut" style="font-size:var(--fs-2)">' +
        item.events +
        ' × &nbsp;' +
        _usageMoney(item.cost) +
        '</span></div>';
    });
    out += '</div>';
  }

  /* ── per day: the accumulation Athi described ── */
  if ((u.daily || []).length) {
    out += '<div class="sec">' + tx('Per day') + '</div><div class="card" style="padding:4px 0">';
    u.daily.slice(0, 14).forEach(function (item) {
      out +=
        '<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 14px">' +
        '<span style="font-size:var(--fs-2)">' +
        esc(String(item.day).slice(0, 10)) +
        '</span>' +
        '<span class="mut" style="font-size:var(--fs-2)">' +
        item.events +
        ' × &nbsp;' +
        _usageMoney(item.cost) +
        '</span></div>';
    });
    out += '</div>';
  }

  /* ── the rows, with what they charged FOR and on what basis ── */
  if ((u.recent || []).length) {
    out += '<div class="sec">' + tx('Recent') + '</div><div class="card" style="padding:4px 0">';
    u.recent.slice(0, 25).forEach(function (item) {
      var meta = item.meta || {};
      var rate = meta.rate || {};
      var basis = meta.basis != null ? meta.basis : rate.basis;
      out +=
        '<div style="padding:8px 14px;border-bottom:1px solid var(--line)">' +
        '<div style="display:flex;justify-content:space-between;gap:10px">' +
        '<span class="mono" style="font-size:var(--fs-2)">' +
        esc(item.meter) +
        '</span>' +
        '<span style="font-size:var(--fs-2)">' +
        _usageMoney(item.cost_usd) +
        '</span></div>' +
        '<div class="mut" style="font-size:var(--fs-1);margin-top:2px">' +
        esc(String(item.created_at).slice(0, 16).replace('T', ' ')) +
        /* ⭐ the reference back to the trade — this is what makes the ledger row explainable */
        (item.detail ? ' · ' + tx('ref') + ' ' + esc(String(item.detail).slice(0, 8)) : '') +
        (basis != null ? ' · ' + txf('on {v}', { v: basis }) + (meta.basis_currency ? ' ' + esc(meta.basis_currency) : '') : '') +
        (rate.card ? ' · ' + esc(rate.model || '') : '') +
        '</div></div>';
    });
    out += '</div>';
  }
  return out;
}

function profSecHTML(k, e) {
  var b = _profSecBody(k, e);
  if (!b) return '';
  return k === 'vault' ? b : b + _capEnd();
}
function _profSecBody(k, e) {
  if (k === 'identity') return iamHTML(e);
  /* ⚠️⚠️ THE __iam_old BRANCH WAS DELETED HERE, AND IT TOOK namingRulesHTML WITH IT.
     No section key is ever '__iam_old' — PROF_SECS has identity/storefront/governance/vault — so this was
     unreachable, and it was the ONLY caller of namingRulesHTML. That table explained what a Bridge ID is,
     which is precisely the information Athi asked to stop showing anywhere: *"in fact this information
     should not be appearing anywhere."* Removing a dead branch and finding it was the last thing keeping a
     whole explanatory table alive is the same cascade dead-surface caught on 2026-08-19. */
  /**
   * ⚠️⚠️ THE storefront / governance / vault BRANCHES WERE DELETED HERE — all three unreachable.
   *
   * profSec() only ever returns 'identity' now: the rail that set it is gone and its four panels live as
   * sections inside iamHTML. Leaving the branches would have left THREE renderers for three screens that are
   * rendered elsewhere, and the next person to change the Storefront would have had even odds of editing the
   * dead one.
   *
   * ⚠️ THE CUSTOMER-ACCESS MODE WAS CARRIED ACROSS FIRST. storefrontCardHTML held
   * (browse-first vs login-first) and nothing else did — deleting this branch before moving that control
   * would have removed a real setting silently, which is exactly how the localisation rows nearly went.
   */
  return '';
}
// "Your governance" — the entity's resolved governance (from attributes): where it's minted, its platform, its basics
// (with provenance ⟵ platform), rights + allowances + jurisdiction. Entity-simple; honest "minted, not enforced yet".
/**
 * The resolved-governance card — as BOXES, not a stack of key-value lines.
 *
 * Athi, 2026-08-20: *"your governance, can we make it as boxes, with gaps, more presentable."*
 *
 * ⭐⭐ AND THE GRID IS NOT DECORATION — IT IS THE CONTENT. These are five independent facts that happen to
 * arrive together: who governs you, where you run, what you may do, how much, and under whose law. Stacked as
 *  rows they read as one paragraph with bold bits, and a reader scanning for their
 * rights has to read the allowances to get there. One box per fact makes them separately findable, which is
 * what a person actually does with this card.
 *
 * ⚠️ EMPTY BOXES ARE NOT RENDERED. A grid of "—" would be a promise of five facts and delivery of two; a box
 * appears only when there is something in it, so the card is honest about how much is resolved.
 */
function govCardHTML(g) {
  if (!g) return '';
  var inst = g.installation || {},
    b = g.basics || {},
    j = g.jurisdiction || {};
  var caps = (g.capabilities || [])
    .map(function (item) {
      return '<span class="optchip" style="background:var(--blue-tint);color:var(--blue-d);border-color:var(--blue-tint-line)">' + esc(item) + '</span>';
    })
    .join(' ');
  var allow = (g.allowances || [])
    .map(function (item) {
      return esc(item.limit + ' ' + item.resource);
    })
    .join(' · ');
  var langs = (b.languages || []).join(', ');
  var list = [inst.cloud, inst.region, inst.zone].filter(Boolean).join(' · ');

  /* ⚠️ EACH BOX NAMES ITS INK BECAUSE IT PAINTS ITS GROUND — guard check 11. */
  var box = function (label, value, sub) {
    if (!value) return '';
    return (
      '<div style="flex:1 1 200px;min-width:0;padding:11px 13px;border:1px solid var(--line);border-radius:11px;' +
      'background:var(--paper);color:var(--on-bg)">' +
      '<div style="font-size:var(--fs-1);text-transform:uppercase;letter-spacing:.05em;color:var(--grey);font-weight:600">' +
      esc(label) +
      '</div>' +
      '<div style="margin-top:4px;font-size:var(--fs-2);line-height:1.5">' +
      value +
      '</div>' +
      (sub ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px">' + esc(sub) + '</div>' : '') +
      '</div>'
    );
  };

  var boxes = [
    /**
     * ⭐⭐ THE VALUE FIRST, THE MESSAGE UNDER IT. Athi, 2026-08-20: *"any message you want to provide, that has
     * to be below the value — base@v1, and then platform set. It has to be shown separately as a message… in
     * principle we settle this way."*
     *
     * ⚠️ SO THE VERSION IS PART OF THE VALUE, NOT THE MESSAGE. "base@v1" is one identifier — splitting the @v1
     * into the grey line below would make the version look like commentary about the constitution rather than
     * part of its name, and a rights question is always about a specific version. The message line is reserved
     * for WHERE IT CAME FROM, which is the only thing a reader cannot see by looking at the value.
     */
    box(tx('Governed by'), esc(g.constitution || '') + (g.constitution_version ? esc('@' + g.constitution_version) : ''), tx('Platform set')),
    box(tx('Installation'), esc(inst.label || inst.key || ''), list),
    box(tx('Basics'), [b.currency, b.timezone, langs].filter(Boolean).map(esc).join(' · '), tx('Platform set')),
    box(tx('Rights'), caps, tx('Cascaded to you')),
    box(tx('Allowances'), allow ? esc(allow) : '', tx('Cascaded to you'))
  ]
    .filter(Boolean)
    .join('');

  if (!boxes) return '';
  return (
    '<div style="display:flex;flex-wrap:wrap;gap:9px">' +
    boxes +
    '</div>' +
    (j.disclaimer ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:9px;line-height:1.5">' + esc(j.disclaimer) + '</div>' : '')
  );
}
/**
 * ⭐⭐ ONE SAVE PER SECTION. Athi, 2026-08-20: *"if each section has to have a separate save button to do so."*
 *
 * ⚠️⚠️ AND IT FIXES A LIVE BUG STRUCTURALLY RATHER THAN DEFENSIVELY. One button at the bottom read fields from
 * every section — but iamSection renders its body ONLY WHEN OPEN, and val() returns "" for a missing element.
 * The API declares `business_status: optional().isIn(['open','closed','away'])`, and "" is not undefined, so
 * .optional() does not skip it and isIn rejects it: collapse Storefront, edit your name, press Save → 400
 * Validation failed, on a field the person never touched and could not see. gstn and address escaped only
 * because the UPDATE happens to COALESCE them.
 *
 * ⭐ A save that belongs to a section can only ever send that section's fields — the whole class of bug goes
 * away rather than being guarded against, and the button now sits where the reader's attention already is.
 */
var PROF_FIELDS = {
  ident: [
    ['pf_name', 'display_name'],
    ['pf_uid', 'user_id']
  ],
  profile: SHOP_FIELDS /* the Business section's inputs — app/cap-shop.js (SET1): CB Settings › Your shop sends the same list */,
  governed: [
    ['pf_bs', 'business_status'],
    ['pf_vis', 'catalogue_visibility'],
    ['pf_sfaccess', 'storefront_access']
  ],
  /* ⚠️ REGIONAL SAVES NOTHING NOW, AND THE EMPTY ARRAY IS THE POINT. Its one control (pf_cur) moved to
     Settings; leaving ['pf_cur','currency_code'] here would make profDirtySections read an element that no
     longer exists, and the section would offer a Save button with nothing behind it. A read-only section is
     an honest one — it says the value is decided elsewhere. */
  regional: []
};

/**
 * ⚠️ ACCESS-AWARE. Athi: *"it should work perfectly for each different access."* Only the business itself may
 * write its own profile — routes/entities.js writes req.identity.identity_id, so a co-assist saving here would
 * quietly write gstn and address onto their OWN actor row, where nothing reads them. An employee cannot reach
 * this screen today (loadProfile routes them to loadActorProfile), but a button that would silently misfile
 * data must not exist on the strength of a route that might change.
 */
function profCanEdit() {
  return !(typeof SESSION !== 'undefined' && SESSION && SESSION.actorId);
}

function profSaveBtn(sec) {
  if (!profCanEdit()) return '';
  var Q = String.fromCharCode(39);
  return (
    '<div class="err" id="pf_err_' +
    sec +
    '" style="margin-top:8px"></div>' +
    '<button data-cbsid="CMP001" class="composebtn" data-testid="prof-save-' +
    sec +
    '" style="margin-top:6px" ' +
    'onclick="saveProfile(' +
    Q +
    sec +
    Q +
    ')">' +
    tx('Save') +
    '</button>'
  );
}

/* ════ UNSAVED CHANGES ════════════════════════════════════════════════════════════════════════════════════
 *
 * Athi, 2026-08-20: *"if the user edit something and came out without saving, we have to ask confirmation —
 * you have edited but not saved — and a confirmation message for both save and cancel."*
 *
 * ⭐⭐ THE SNAPSHOT IS TAKEN FROM THE DOM AT RENDER, NOT FROM THE SERVER PAYLOAD. Comparing against `e` would
 * call a field dirty whenever the server normalised it — an address the API trimmed, a status it defaulted —
 * so a person who typed nothing would be asked to save nothing. What was ON THE SCREEN is the only honest
 * baseline for "did you change it".
 *
 * ⚠️ AND IT MUST SURVIVE A REPAINT. iamToggle re-renders the whole panel, so the snapshot is re-taken after
 * every paint; a snapshot captured once at load would go stale on the first collapse and report every
 * subsequent edit as clean.
 */
var _profSnap = {};

/**
 * ⭐⭐ SETTINGS GETS THE SAME GUARD, FROM THE SAME FUNCTIONS. Profile lost work silently until today; Settings
 * still can — three of its sections need a Save (Work, Auto-assign, Documents) and clicking another rail row
 * discards whatever was typed. The policy flags and channels apply on change and have nothing to lose, so
 * they are deliberately not listed: a guard that fires for controls which cannot lose work would be the same
 * false affordance as a link to a closed shop.
 *
 * ⚠️ THE HELPERS TAKE A FIELD MAP RATHER THAN BEING COPIED. A second snapshot/dirty pair would drift from the
 * first the moment either changed — the standing rule, and the reason Profile and Settings can now never
 * disagree about what unsaved means.
 */
var SET_FIELDS = {
  work: [
    ['st_am', 'assignment_model'],
    ['st_mt', 'default_max_tasks']
  ],
  assign: [
    ['st_aam', 'mode'],
    ['st_ada', 'default_assignee']
  ]
};

function setSnapshot() {
  profSnapshot(SET_FIELDS);
}
function setGuard(go) {
  return profGuard(go, SET_FIELDS, { work: tx('Work'), assign: tx('Auto-assign') });
}

/** Re-read every profile field currently on screen. Called after each paint. */
function profSnapshot(map) {
  map = map || PROF_FIELDS;
  _profSnap = {};
  Object.keys(map).forEach(function (item) {
    map[item].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (el) _profSnap[pair[0]] = el.value;
    });
  });
}

/** Which sections have an on-screen field whose value differs from the snapshot. */
function profDirtySections(map) {
  map = map || PROF_FIELDS;
  var out = [];
  Object.keys(map).forEach(function (item) {
    var dirty = map[item].some(function (pair) {
      var el = document.getElementById(pair[0]);
      /* ⚠️ A FIELD NOT ON SCREEN IS NOT DIRTY. A collapsed section cannot have been edited, and treating its
         absence as a change would prompt on every single navigation. */
      return el && Object.prototype.hasOwnProperty.call(_profSnap, pair[0]) && el.value !== _profSnap[pair[0]];
    });
    if (dirty) out.push(item);
  });
  return out;
}

/**
 * profGuard(go) — run `go`, or ask first if something is unsaved.
 *
 * ⚠️ THE PROMPT NAMES WHAT IS UNSAVED. "You have unsaved changes" makes a person hunt through five collapsed
 * sections for something they may not have touched; naming the section turns the question into an answer.
 *
 * ⚠️ THREE OUTCOMES, NOT TWO. Save-and-go, discard-and-go, and STAY — because a person interrupted mid-edit
 * often wants neither. A two-button dialog forces a decision about the data in order to answer a question
 * about the navigation.
 */
function profGuard(go, map, nameMap) {
  /* ⚠️ THE MAP IS REMEMBERED FOR profGuardDo — it saves the dirty sections after the person chooses, and
     without this it would save PROFILE fields when the prompt came from Settings. */
  UI._guardMap = map || PROF_FIELDS;
  var dirty = profDirtySections(UI._guardMap);
  if (!dirty.length) return go();
  var Q = String.fromCharCode(39);
  var names = nameMap || { ident: tx('Identity'), profile: tx('Business'), governed: tx('Storefront') };
  var what = dirty
    .map(function (item) {
      return names[item] || item;
    })
    .join(', ');

  UI._profGo = go;
  /**
   * ⚠️ modal() TAKES ONE HTML STRING, NOT (title, body, buttons). I wrote the three-argument call from memory
   * and only the first would have rendered — the fourth remembered-signature mistake today, after
   * SESSION.identity_type, PURPOSE.profile and the borrowed `capped`. The house markup is mhd / mbody / mfoot,
   * as confirmAsk builds it; confirmAsk itself is two-button and this needs three.
   */
  modal(
    '<div class="mhd"><div class="t">' +
      esc(tx('Not saved')) +
      '</div></div>' +
      '<div class="mbody"><div style="font-size:var(--fs-2);line-height:1.55;color:var(--ink)">' +
      tx('You changed') +
      ' <b>' +
      esc(what) +
      '</b> ' +
      tx('and have not saved it.') +
      '</div></div>' +
      '<div class="mfoot">' +
      '<button data-cbsid="ACC002-B30" data-testid="prof-guard-stay" onclick="profGuardDo(' +
      Q +
      'stay' +
      Q +
      ')">' +
      esc(tx('Stay here')) +
      '</button>' +
      '<button data-cbsid="ACC002-B31" data-testid="prof-guard-discard" onclick="profGuardDo(' +
      Q +
      'discard' +
      Q +
      ')">' +
      esc(tx('Discard')) +
      '</button>' +
      '<button data-cbsid="ACC002-B32" class="pri" data-testid="prof-guard-save" onclick="profGuardDo(' +
      Q +
      'save' +
      Q +
      ')">' +
      esc(tx('Save and continue')) +
      '</button>' +
      '</div>'
  );
  /* ⚠️ ESCAPE AND THE BACKDROP MEAN STAY, NOT DISCARD. A dialog dismissed by accident must never be the thing
     that throws away work — the safe default is the one that changes nothing. */
  UI._modalDismiss = function () {
    UI._profGo = null;
  };
}

/** ⭐ EVERY OUTCOME CONFIRMS ITSELF. Athi: *"a confirmation message for both save and cancel."* Silence after
 *  discarding is indistinguishable from silence after saving, and the difference is the person's work. */
async function profGuardDo(which) {
  var go = UI._profGo;
  UI._profGo = null;
  if (typeof closeModal === 'function') closeModal();
  if (which === 'stay') {
    toast(tx('Staying — nothing was changed.'));
    return;
  }
  var map = UI._guardMap || PROF_FIELDS;
  if (which === 'save') {
    var secs = profDirtySections(map);
    /* ⚠️ WHICH SAVER DEPENDS ON WHICH SCREEN ASKED. A single saveProfile() here would have written Profile
       fields in response to a Settings prompt — the map is what tells them apart. */
    for (var index = 0; index < secs.length; index++) {
      if (map === PROF_FIELDS) await saveProfile(secs[index]);
      else if (secs[index] === 'work') await saveSettings();
      else if (secs[index] === 'assign') await saveAutoAssign();
    }
    toast(tx('Saved.'));
  } else {
    profSnapshot(map); // whatever is on screen becomes the new baseline
    toast(tx('Changes discarded.'));
  }
  if (typeof go === 'function') go();
}

async function saveProfile(sec) {
  /* ⚠️ DEFAULTS TO EVERY SECTION so an older call site (or a test) that calls saveProfile() with no argument
     still saves what is on screen rather than silently saving nothing. */
  var secs = sec ? [sec] : Object.keys(PROF_FIELDS);
  var x = document.getElementById('pf_err_' + (sec || secs[0])) || document.getElementById('pf_err');
  if (x) x.textContent = '';

  var _b = {};
  secs.forEach(function (item) {
    Object.assign(_b, profFieldsBody(PROF_FIELDS[item]));
  }); /* one rule for "what a section sends" — app/cap-shop.js */

  if (!Object.keys(_b).length) {
    if (x) x.textContent = tx('Nothing to save.');
    return;
  }
  try {
    await api('saveProfile', { body: _b });
    toast(MSG.profileSaved());
    UI._me = null;
    loadProfile();
  } catch (e) {
    if (x) x.textContent = e.message;
  }
}
// 🛍️ Customer storefront — the shareable public shop link + the browse-first / login-first access mode.
/* sfCopy removed with storefrontCardHTML, the card whose copy button called it. */
/**
 * ⚠️⚠️ THIS FUNCTION WAS DELETED BY ACCIDENT AND RESTORED FROM GIT (commit a823180).
 *
 * A scripted cut() removing storefrontCardHTML and saveStorefront over-reached and took loadActorProfile with
 * it. Nothing complained: the file parsed, every gate passed, and render-smoke kept reporting 9/9 — because it
 * calls iamSelfEmployeeHTML directly and never goes through loadProfile. The ONLY symptom would have been an
 * employee opening Profile and getting a blank pane from a ReferenceError.
 *
 * ⭐ FOUND BY dead-surface REPORTING iamSelfEmployeeHTML AND saveActorPin AS ORPHANS — not by any test, and not
 * by reading the diff. A function with no callers is usually dead code; twice today it has instead meant that
 * something which SHOULD call it has gone missing. The orphan count going UP after a deletion is the signal.
 */
/**
 * loadActorProfile — THE employee's own profile. There is exactly one, and finding that out was the whole
 * problem.
 *
 * ⚠️⚠️ I BUILT A SECOND ONE AND IT WAS UNREACHABLE. Athi asked why his access level was not shown; I added an
 * employee branch inside iamHTML and shipped it. But loadProfile() short-circuits three lines in —
 * `if(SESSION.role==='actor') return loadActorProfile(h)` — so iamHTML is NEVER CALLED for an employee and
 * the new screen could not render for anyone. Two renderers for one screen, and the one I wrote was the dead
 * one. Athi's report, twice, was simply "still not rendering".
 *
 * ⭐ THE STANDING RULE EXISTS FOR EXACTLY THIS: a second call site means find the first one. I searched for
 * where the IAM screen renders instead of where an EMPLOYEE's profile renders, found iamHTML, and built
 * beside a function I never looked for. The content below is the same iamSelfEmployeeHTML — now called from
 * the one place that actually runs.
 *
 * ⚠️ AND IT NEEDS /me, NOT THE TOKEN. The old version read everything from jwtPayload, which is why it could
 * only say "your hat is managed by your entity" without naming it: the level deliberately is NOT in the JWT,
 * so that an owner demoting someone takes effect immediately rather than at token expiry. Naming the level
 * therefore costs one round trip, and that is the correct price for the answer being current.
 */
async function loadActorProfile(node) {
  /* ⭐ A COLLAPSIBLE SECTION LIKE THE OTHERS. Athi, 2026-08-20: *"pin number again as a collapsable stuff"* and
     *"change your pin is fine"* — so the wording stays and only the container changes. Three sections that
     behave the same way beat two accordions and one loose card sitting under them. */
  const pinBody = `<label class="fl">${tx('Current PIN')}</label><input data-cbsid="ACC002-I17" class="inp" id="pf_cpin" inputmode="numeric" maxlength="4" style="max-width:150px" placeholder="4 digits">
      <label class="fl">${tx('New PIN')}</label><input data-cbsid="ACC002-I18" class="inp" id="pf_npin" inputmode="numeric" maxlength="4" style="max-width:150px" placeholder="4 digits">
      <label class="fl">${tx('Confirm new PIN')}</label><input data-cbsid="ACC002-I19" class="inp" id="pf_npin2" inputmode="numeric" maxlength="4" style="max-width:150px" placeholder="4 digits">
      <div class="err" id="pf_err"></div><button data-cbsid="ACC002-B33" class="composebtn" style="margin-top:9px" onclick="saveActorPin()">${tx('Change PIN')}</button>`;
  const pinCard = iamSection('pin', tx('Change your PIN'), pinBody, { hint: tx('4 digits') });

  /* Paint immediately from the token so the screen is never blank, then replace once /me lands. */
  const p = (typeof jwtPayload === 'function' && jwtPayload(SESSION.token)) || {};
  if (!UI._me) {
    node.innerHTML =
      `<div class="sec">${tx('Your profile')}</div>` +
      `<div class="misnote">${esc(SESSION.name || p.display_name || '')} — loading your access…</div>` +
      pinCard;
  }

  let e = UI._me;
  if (!e) {
    /* ⭐ meNow() — the warm request started at sign-in, or a fetch. An actor never passes through
         loadProfile (it returns here first), so before this the co-assist path always paid a full round
         trip while a perfectly good one was already in flight. */
    try {
      e = (await meNow()) || {};
      UI._me = e;
    } catch (err) {
      e = { display_name: SESSION.name || p.display_name, actor_key: p.actor_key, identity_type: 'actor' };
    }
  }
  /* ⚠️ RE-QUERY AFTER THE AWAIT — renderApp rebuilds the shell, so the node captured above may be detached.
     Every await in this file followed by a DOM write has the same hazard. */
  const h2 = document.getElementById('profbody');
  if (!h2) return;
  h2.innerHTML =
    `<div class="sec">${tx('Your profile')}</div>` +
    iamSelfEmployeeHTML(e) +
    pinCard +
    `<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px;line-height:1.5">${txf('Set your {what} from the top bar.', { what: '<b>' + tx('Duty / Break') + '</b>' })}</div>`;
}

async function saveActorPin() {
  const x = document.getElementById('pf_err');
  if (x) x.textContent = '';
  const c = val('pf_cpin'),
    n = val('pf_npin'),
    n2 = val('pf_npin2');
  if (!/^\d{4}$/.test(n)) {
    if (x) x.textContent = 'New PIN must be 4 digits.';
    return;
  }
  if (n !== n2) {
    if (x) x.textContent = "New PINs don't match.";
    return;
  }
  try {
    await api('changePin', { body: { current_pin: c, new_pin: n, confirm_pin: n2 } });
    toast('PIN changed ✓');
    ['pf_cpin', 'pf_npin', 'pf_npin2'].forEach(function (item) {
      var el = document.getElementById(item);
      if (el) el.value = '';
    });
  } catch (e) {
    if (x) x.textContent = e.message;
  }
}
/* ---- SETTINGS + governance (7-layer perception stub) ---- */
/**
 * ⭐ MODEL A — GOVERNANCE DECLARES, EVERY OTHER SCREEN REFERS (Athi, 2026-08-16: *"model a, we need to bring
 * unification. then only we can refer in only one place."*).
 *
 * GOV is the single declaration table. Before this, several rows here were ALSO hardcoded in the screen that acts
 * on them — the attachment list `image, pdf, docx, xlsx, csv, zip` existed as two independent string literals in
 * this one file, so Governance and Settings → Policy could disagree and nothing would notice.
 *
 * ⚠️ A CONSUMER MUST NOT COPY THE VALUE. Read it with govDecl(label) and render what comes back. If a label is
 * renamed here the lookup returns null and the consumer shows "not declared" — loud, and better than a stale copy
 * that keeps rendering the old answer forever. Full audit: RECONCILE-declarations.md.
 */
/**
 * The catalogue-visibility CAP, read from the entity rather than asserted. `UI._me` is the profile payload, so
 * this is whatever the server last said. Before Profile has been opened there is nothing to read — and it says so
 * rather than guessing, because a governance row inventing "private" is exactly the drift being removed.
 */
/**
 * ⚠️ THE CAP CARRIES MORE THAN A MAXIMUM, and the old row dropped all of it. The server returns
 * `{max, by, enforced, reason}` — e.g. *"The free plan declares no public catalogue, but plan enforcement is off"*
 * with `enforced:false`. A cap that is DECLARED BUT NOT ENFORCED is a different fact from one that binds, and it is
 * precisely the kind of thing a governance screen exists to say out loud. Printing only "private (cap)" threw away
 * both who set it and whether it actually holds.
 */
function govCatVis() {
  var e = UI._me;
  if (!e) return 'open Profile → Storefront to read it';
  var cap = e.visibility_cap || {};
  var vis = e.catalogue_visibility || 'private';
  var out = vis;
  if (cap.max && cap.max !== 'public') out += ' · capped at ' + cap.max + (cap.by ? ' by ' + cap.by : '');
  /* Say when a declared cap is NOT binding — otherwise the screen implies a constraint that is not applied. */
  if (cap.max && cap.max !== 'public' && cap.enforced === false) out += ' (declared, not enforced)';
  return out;
}
/**
 * The assignment model as SAVED, not as asserted. The row read a literal 'both · entity setting' while the real
 * value is written by Settings → Work through saveSettings — so changing it there left Governance still claiming
 * "both".
 *
 * ⚠️ It also says the value is not enforced, because Settings' own banner says exactly that ("saved but not yet
 * active"). A governance screen repeating a stored value while omitting that nothing acts on it is the same
 * overstatement as a cap that does not bind.
 */
/**
 * ⭐ STANDARDS AND UNITS COME FROM THE CATALOGUE MODEL, not from a dash in this file.
 *
 * Both rows read `—` while `catalogue-model.js` has held the real registries all along — `STD_SCHEMES`
 * (HS · GS1 GPC · Schema.org · UNSPSC · custom) and `STANDARDS` — and Definitions already surfaces them, citing
 * "app/catalogue-model.js · STD_SCHEMES" as its source. So the governance screen was showing "not configured" for
 * something configured in two other places.
 *
 * ⚠️ NAMES ONLY, AND CAPPED. The point of the row is that a registry exists and where it lives — not to mirror
 * its contents, which is how a second copy starts. Definitions remains the place to read them in full.
 */
/**
 * ⭐ THE PLAN IS A DECLARATION; ITS CONSUMPTION IS A METRIC (Athi, 2026-08-16: *"metered for constitution are
 * really the MIS? … setting up here and show the outcome in MIS"*).
 *
 * Constitution used to carry five "metered" rows — Entities provisioned · Networks formed · Chits issued · Data
 * stored · Plan tier — mixing the two. Four were MEASUREMENTS sitting on a configuration screen, and two of them
 * (`Chits issued`, `Data stored`) rendered as `—` while **MIS was computing the real chit count on the next
 * screen along**. A governance card showing a dash for a number the product already knows is the clearest
 * possible case for splitting declaration from outcome.
 *
 * Governance now declares PLAN and nothing else. MIS reads the same object and reports usage against it.
 */
/**
 * ⭐ A PLAN IS A SUBSCRIPTION, so it has a validity window (Athi, 2026-08-16: *"valid from and to date need to
 * bring in if it is a subscription model"*). Right — a plan with no period cannot express renewal, lapse, or
 * "this limit applied last month but not this one".
 *
 * ⚠️ THE DATES ARE DECLARED AS A SHAPE, NOT AS DATA — validFrom/validTo are null because NOTHING SUPPLIES THEM.
 * There is no plan_tier, plan_expires, subscription or billing column in the API, and lib/assist-kb.js:68 states
 * plainly that "Subscription tiers, usage quotas … are in design, not yet live". Putting plausible dates here
 * would make a stub look like a record — the exact failure just removed from Currency and the clearance count.
 *
 * The precedent for the real thing already exists in this codebase: product versions carry valid_from/valid_to
 * and are queried by instant (`routes/products.js`). A plan should follow that shape, not invent its own.
 */
var PLAN = { tier: 'Free', entities: 5, chitsPerDay: 10, networks: 1, validFrom: null, validTo: null };
/* Where a plan sits in time. Returns null when there is no window to reason about — callers must not guess. */
function planWindow() {
  if (!PLAN.validFrom && !PLAN.validTo) return null;
  var now = Date.now();
  var from = PLAN.validFrom ? Date.parse(PLAN.validFrom) : null;
  var to = PLAN.validTo ? Date.parse(PLAN.validTo) : null;
  if (to && now > to) return { state: 'expired', to: to, days: Math.ceil((now - to) / 864e5) };
  if (from && now < from) return { state: 'not yet started', from: from, days: Math.ceil((from - now) / 864e5) };
  return { state: 'active', to: to, days: to ? Math.ceil((to - now) / 864e5) : null };
}
function govPlanBlock() {
  return (
    '<div style="margin:15px 0 2px;font-family:\'Space Grotesk\';font-weight:700;font-size:var(--fs-2);color:var(--purple-2)">' +
    tx('↑ Your plan · what it entitles you to') +
    '</div>' +
    govRowHtml('Plan tier', esc(PLAN.tier), 'bound') +
    /* The subscription period. `free` is the honest class: not yours to set, and not set by anyone else either. */
    govRowHtml('Valid from', PLAN.validFrom ? esc(PLAN.validFrom) : 'no subscription record yet', PLAN.validFrom ? 'bound' : 'free') +
    govRowHtml('Valid to', PLAN.validTo ? esc(PLAN.validTo) : 'no subscription record yet', PLAN.validTo ? 'bound' : 'free') +
    govRowHtml('Entities allowed', String(PLAN.entities), 'bound') +
    govRowHtml('Chits per day', String(PLAN.chitsPerDay), 'bound') +
    govRowHtml('Networks allowed', String(PLAN.networks), 'bound') +
    '<div class="misnote" style="margin-top:9px">These are the limits. <b data-cbsid="ACC002-C07" onclick="navTo(\'mis\');UI.misBand=\'plan\'" style="cursor:pointer;color:var(--blue)">See what you have used in MIS <span class=arw>→</span></b></div>'
  );
}
function govCodeStandards() {
  var M = typeof CBCatalogue !== 'undefined' ? CBCatalogue : null;
  var s = M && M.STD_SCHEMES;
  if (!s || !s.length) return 'no scheme registry loaded';
  return s.slice(0, 4).join(' · ') + (s.length > 4 ? ' +' + (s.length - 4) : '') + ' — see Definitions';
}
/**
 * ⚠️ I GOT THIS WRONG FIRST TIME and it is worth recording. This row is "Units of measure", and I pointed it at
 * `CBCatalogue.STANDARDS` because the name looked close enough — but STANDARDS holds ADOPTED SPECIFICATIONS
 * (JSON Schema 2020-12, RFC 7386 merge-patch, GS1 GTIN, PIM, MDM survivorship). It reported "19 declared" for a
 * registry of units that does not exist. A confident number pointing at the wrong table is worse than a dash,
 * because a dash invites the question and a number closes it.
 *
 * ⚠️ THERE IS NO CENTRAL UNITS REGISTRY. The only list is `CW_UNITS` inside the catalogue wizard (cap-catalogue.js),
 * which is a screen, not a model — so units cannot be declared, referenced or governed. That is a real Model A gap
 * and it is stated here rather than papered over.
 */
/**
 * ⭐⭐ LOCALISATION RESOLVES INTO GOVERNANCE LAYER 2 (Athi, 2026-08-18: *"where is the localisation layer, it is
 * missing in the governance layer?"*).
 *
 * ⚠️ HE WAS RIGHT AND IT WAS HALF-THERE. Layer 2 · Jurisdiction has said "locale bundle lands partly here" since
 * it was written, and carries a "Date / number format" row — which read a literal em-dash. The DECLARATION
 * existed and nothing resolved it, so the layer claimed to govern something it could not see.
 *
 * That is the same defect `govCatVis` was written to fix: a row asserting a value independently of the thing it
 * describes, which is fine until the two disagree and the screen keeps saying the old answer.
 *
 * ⚠️ FUNCTIONS, NOT THEIR RESULTS. GOV is a const built once at load, before CBLocale has read storage —
 * `govLocaleFormat()` here would freeze on whatever was true at parse time. govVal() unwraps them at render.
 *
 * ── MODEL A, the same shape as visibility ─────────────────────────────────────────────────────────────────
 * The LAYER declares what a jurisdiction permits. Settings › Localisation is where a person CHOOSES WITHIN it.
 * The layer caps; the profile chooses. Localisation is not a separate concern from governance — it is one of
 * the seven layers, and the settings screen is its chooser.
 */
function govLocaleLang() {
  try {
    var m = { en: 'English', hi: 'हिन्दी (Hindi)', ta: 'தமிழ் (Tamil)', fr: 'Français (French)' };
    var l = CBLocale.lang();
    return (m[l] || l) + ' · interface';
  } catch (_) {
    return '—';
  }
}
function govLocaleFormat() {
  try {
    return CBLocale.locale() + ' · ' + CBLocale.money(1234567890.5, 'INR') + ' · ' + CBLocale.date(Date.now());
  } catch (_) {
    return '—';
  }
}
function govLocaleDir() {
  try {
    return CBLocale.dir() === 'rtl' ? 'right to left (RTL)' : 'left to right (LTR)';
  } catch (_) {
    return '—';
  }
}
function govUnits() {
  /* Reads the MODEL now, not the wizard — so it resolves whether or not the catalogue capability has been opened.
     Reaching across to another lazily-loaded capability's global was the reason this row used to read empty. */
  var M = typeof CBCatalogue !== 'undefined' ? CBCatalogue : null;
  var u = M && M.UNITS;
  if (!u || !u.length) return 'no units registry loaded';
  return u.length + ' declared · ' + u.slice(0, 5).join(' · ') + (u.length > 5 ? ' +' + (u.length - 5) : '');
}
function govAssignModel() {
  var s = UI._set && UI._set.s;
  if (!s) return 'open Settings → Work to read it';
  return (s.assignment_model || 'both') + ' — saved, not yet enforced';
}
/* The cap's own explanation, when the server gives one. Shown under the row rather than truncated into it. */
function govCatVisWhy() {
  var cap = (UI._me && UI._me.visibility_cap) || {};
  return cap.reason ? String(cap.reason) : '';
}
/**
 * ⚠️ THE VALUE, NOT A SECOND CONTROL (Athi: *"whatever is there in profile if already works, remove the stub in
 * governance and bring the same here"*). Right — the stub is gone and Governance now shows the REAL value.
 *
 * But it shows it read-only, with a link to where it is set. Putting Profile's `<select>` here too would give one
 * value two controls, which is the duplication being removed, only worse: two places to change it and no way to
 * tell which one last won. One owner, many viewers.
 */
function govOwnedElsewhere(where, nav) {
  return '<button data-cbsid="ACC002-B34" class="govref-go" onclick="' + nav + '">change in ' + esc(where) + ' <span class=arw>→</span></button>';
}
/* A declared value may be a literal or a function of live state — resolve it the same way everywhere, so no
   consumer has to know which kind it got. */
function govVal(v) {
  try {
    return typeof v === 'function' ? v() : v;
  } catch (_) {
    return '—';
  }
}
function govDecl(label) {
  for (var index = 0; index < GOV.length; index++) {
    var rows = GOV[index].rows || [];
    for (var j = 0; j < rows.length; j++) {
      if (rows[j][0] === label) return { value: govVal(rows[j][1]), klass: rows[j][2], layer: GOV[index].n, layerIndex: index };
    }
  }
  return null;
}
/* Render a declared value read-only, with where it was declared and a way to go there. The consumer screen shows
   the value; it does not own it. */
function govRefHTML(label) {
  var d = govDecl(label);
  if (!d) return '<div class="misnote">⚠️ <b>' + esc(label) + '</b> is not set — nothing to show.</div>';
  return (
    '<div class="govref"><span class="govref-k">' +
    esc(label) +
    '</span>' +
    '<span class="govref-v">' +
    esc(d.value) +
    '</span>' +
    '<button data-cbsid="ACC002-B35" class="govref-go" onclick="govGoTo(' +
    d.layerIndex +
    ')" title="Open the layer that declares this">' +
    esc(d.layer) +
    ' <span class=arw>→</span></button></div>'
  );
}
function govGoTo(i) {
  UI.govTab = i;
  UI.setSec = 'governance';
  if (UI.vp === 'mob') {
    UI.mdetail = true;
  }
  renderApp();
  if (typeof loadSettings === 'function') loadSettings();
}

const GOV = [
  {
    n: '1 · Constitution',
    tag: 'platform · top layer',
    desc: 'Platform-wide rules every entity inherits at mint. Set the locale here → it flows down into the boilerplate.',
    rows: [
      ['Message max length', 'unbounded', 'advisory'],
      ['Max schemas / entity', '2', 'bound'],
      /* ⚠️ RESOLVED, NOT HARDCODED. This row read a literal 'private (cap)' while the real cap lives on the entity
       as `visibility_cap` (server-set, applied by Profile → Storefront, which disables the control and says "set
       by your network operator"). The behaviour was already Model A — the layer caps, Profile chooses within it —
       but this row asserted a value independently, so a network operator lifting the cap would leave Governance
       still saying "private" with nothing to notice. Reads the same source now. */
      /* ⚠️ THE FUNCTION, NOT ITS RESULT. GOV is a const built once at load, so `govCatVis()` here would evaluate
       before UI._me exists and freeze on "not read yet" forever. A declaration that depends on live state has to
       be resolved at RENDER time — govVal() below unwraps it. */
      ['Catalogue visibility', govCatVis, 'chosen'],
      ['Attachment types', 'image, pdf, docx, xlsx, csv, zip', 'advisory'],
      ['Attachment max size', '10 MB', 'advisory']
    ]
  },
  /* ⚠️ THE LOCALISATION ROWS RESOLVE LIVE — see govLocaleLang/Format/Dir above. They read '—' until 2026-08-18:
     the layer declared it governed the locale bundle and could not see it. Chosen in Settings › Localisation,
     which is this layer's chooser, exactly as Profile → Storefront is the chooser for visibility. */
  {
    n: '2 · Jurisdiction',
    tag: 'country / legal · localisation',
    desc: 'Country-specific legal & tax frame, and the locale bundle: language, formats and reading direction. Chosen in Settings › Localisation.',
    rows: [
      ['Country', '—', 'free'],
      ['Tax regime (GST / VAT)', '—', 'free'],
      ['Legal framework', '—', 'free'],
      ['Interface language', govLocaleLang, 'chosen'],
      ['Date / number format', govLocaleFormat, 'chosen'],
      ['Reading direction', govLocaleDir, 'chosen'],
      ['Sort order', 'follows the format locale', 'free']
    ]
  },
  {
    n: '3 · Vertical',
    tag: 'business type',
    desc: 'Defaults for your line of business.',
    rows: [
      ['Business vertical', '—', 'free'],
      ['Default units', '—', 'free'],
      ['Vertical currency default', '—', 'free']
    ]
  },
  {
    n: '4 · Standards',
    tag: 'codes / units',
    desc: 'Measurement & coding standards.',
    rows: [
      ['Units of measure', govUnits, 'free'],
      ['Code standards (HSN / SKU)', govCodeStandards, 'free']
    ]
  },
  {
    n: '5 · Content',
    tag: 'shared assets · versioned',
    desc: 'Shared catalogue / manuals / images published once & carried by reference, not copied.',
    rows: [
      ['Shared catalogue / manuals / images', 'published once · referenced', 'free'],
      ['Asset reference', 'asset_id @ version', 'free'],
      ['On update', 'new version; frozen chits keep the old', 'free']
    ]
  },
  {
    n: '6 · ERP',
    tag: 'integration',
    desc: 'System integration adapters.',
    rows: [
      ['ERP adapter', '—', 'free'],
      ['Sync mode', '—', 'free']
    ]
  },
  {
    n: '7 · Consolidation',
    tag: '→ boilerplate the entity inherits',
    desc: 'The 7 layers consolidate into the Boilerplate every entity copies at registration; the locale below is inherited from Constitution.',
    rows: [
      ['Assignment model', govAssignModel, 'entity'],
      ['Default max tasks / co-assist', '10 · entity setting', 'entity']
    ]
  } /* ⚠️ the SECOND site of this label — the reason TERM exists */
];
/**
 * ⚠️ REWRITTEN FOR A READER, NOT A DEVELOPER. These were 9.5px Space Mono chips reading "advisory · mutable",
 * "lock · bound", "free · TBD" — below the 11px legibility floor, in the data font, and in vocabulary that only
 * means anything if you already know the model. Every row carried one, so a layer was a wall of nine-colour
 * jargon and the actual question ("can I change this?") was the hardest thing on the screen to answer.
 *
 * Now: plain words, at the floor, and only where they add something the GROUP HEADING has not already said.
 */
var GOV_KLASS = {
  advisory: { say: 'you can change this', tone: 'yours' },
  entity: { say: 'you set this', tone: 'yours' },
  bound_set: { say: 'choose from a fixed list', tone: 'yours' },
  chosen: { say: 'you can only make it stricter', tone: 'yours' },
  bound: { say: 'locked by the layer above', tone: 'fixed' },
  inherited: { say: 'inherited, frozen', tone: 'fixed' },
  protected: { say: 'set by the platform', tone: 'fixed' },
  metered: { say: 'counted for licensing', tone: 'fixed' },
  free: { say: 'not set yet', tone: 'none' }
};
/**
 * ⚠️ PERMISSION IS NOT THE SAME AS "THERE IS A CONTROL HERE", and conflating them made this screen lie.
 *
 * The class says what the LAYER permits. Translating `advisory · mutable` to the plain "you can change this" read
 * as a promise about THIS SCREEN — and 4 of the 19 rows carrying it (Message max length, Catalogue visibility,
 * Attachment types, Attachment max size) are rendered as plain text with nothing to click. The old jargon was
 * vague enough to survive that gap; plain English is not, which is a good argument for plain English and a bad
 * argument for leaving it unchecked.
 *
 * So the wording now depends on whether the row actually offers a control. Same governance, honest sentence.
 */
function govKlass(k, hasControl) {
  var x = GOV_KLASS[k] || GOV_KLASS.free;
  var col =
    x.tone === 'yours'
      ? ['var(--ok-tint)', 'var(--ok-2)']
      : x.tone === 'fixed'
        ? ['var(--blue-tint-bg)', 'var(--blue-2)']
        : ['var(--warn-tint)', 'var(--grey-2)'];
  var say = x.say;
  /**
   * ⚠️ `=== false`, NOT `!hasControl`. Only a caller that has actually LOOKED may claim there is no control.
   * policyFlagsCard calls govKlass(def.gov) with one argument and renders its select separately, so `undefined`
   * was read as "no control" and every policy flag suddenly said "no control here yet" beside a working dropdown.
   * The same mistake as the rows this caveat was written to fix, pointing the other way: an assertion made from
   * absence of information rather than from evidence.
   */
  if (x.tone === 'yours' && hasControl === false) {
    col = ['var(--warn-tint)', 'var(--warn-3)'];
    say = say + ' — no control here yet';
  }
  return '<span class="govtag" style="background:' + col[0] + ';color:' + col[1] + '">' + say + '</span>';
}
/**
 * ⚠️ TIMEZONES / LANGS / GOVSET / govSetVal / govSel WERE HERE AND ARE DELETED (2026-08-16).
 *
 * They existed only to drive three <select>s on this card that wrote to localStorage `cb_govset` — a store no
 * other code in the app ever read. Removing the decoy controls left all five with zero callers, so keeping them
 * would leave the machinery for a fake setting sitting in the file waiting to be wired up by mistake.
 *
 * ⚠️ CURRENCIES is NOT removed — it is a shared global from Core, used elsewhere.
 */
/**
 * ⚠️ WRAPS INSTEAD OF PUSHING THE PANE SIDEWAYS. Label + value + class-tag on one non-wrapping flex line needed
 * ~469px; inside Settings the pane is ~358px, so the row forced the WHOLE DETAIL PANE to scroll horizontally
 * (measured: 111px over) and the tags read "advisory · mut…". A row that cannot fit should fold onto a second
 * line — the pane scrolling sideways is never the right answer, it just moves the problem to the whole screen.
 */
/**
 * ⭐ THREE COLUMNS — name : value : what it means (Athi, 2026-08-16: *"like Currency : data : comment"*).
 *
 * It was a single flex line with the value and a jargon chip crowded after the label, wrapping raggedly when it
 * did not fit. As a table it can be READ DOWN: every label starts at the same x, every value at the same x, and
 * the comment column answers "can I change this?" on the row itself rather than in a legend at the bottom.
 *
 * ⚠️ The comment repeats within a group, and that is fine HERE — a column of like values is scannable, where
 * the same text as loose chips after each value was noise. The layout is what changed the answer.
 */
function govRowHtml(label, valHtml, klass) {
  /* Does this row actually offer a way to change it? Read from the rendered value, so the comment can never drift
     from the control — add a select to a row and its wording corrects itself. */
  var hasControl = /<select|<input|<textarea|<button/i.test(String(valHtml));
  /* Rows whose value is owned by another screen say where, so the reader is never left hunting for the control —
     and there is still only ONE control. */
  /**
   * ⚠️ THE MAP HAD TWO ENTRIES AND THE PRODUCT NOW HAS FIVE OWNED VALUES. Localisation and Appearance were
   * built after this map was written, so their governance rows declared a rule and offered no way to reach the
   * control — the exact "left hunting for the control" this map exists to prevent, reintroduced by growth.
   */
  var OWNER = {
    'Catalogue visibility': ['Profile → Storefront', "navTo('profile');UI.profSec='storefront'"],
    'Assignment model': ['Settings → Work', "setSetSec('work')"],
    'Interface language': ['Settings → Localisation', "setSetSec('locale')"],
    'Date / number format': ['Settings → Localisation', "setSetSec('locale')"],
    'Reading direction': ['Settings → Localisation', "setSetSec('locale')"],
    /* CAT-162: units and code standards are read here, set in Catalogue setup (Definitions) — one place per setting */
    'Units of measure': ['Catalogue setup → Definitions', "navTo('catsetup')"],
    'Code standards (HSN / SKU)': ['Catalogue setup → Definitions', "navTo('catsetup')"]
  };
  var own = OWNER[label];
  var why = label === 'Catalogue visibility' ? govCatVisWhy() : '';
  return (
    '<div class="govrow"><span class="govrow-k">' +
    esc(label) +
    '</span>' +
    '<span class="govrow-v">' +
    valHtml +
    /* ⚠️ THROUGH THE HELPER, not inlined. govOwnedElsewhere() was written for exactly this, with the
         "one owner, many viewers" reasoning attached to it, and then this line duplicated its body — so the
         helper sat uncalled while its explanation applied to code somewhere else. Found by the dead-surface
         scan, which reported it as unreachable when it was really un-adopted. */
    (own ? ' ' + govOwnedElsewhere(own[0], own[1]) : '') +
    '</span>' +
    '<span class="govrow-c">' +
    govKlass(klass, hasControl || !!own) +
    '</span></div>' +
    (why ? '<div class="govwhy">' + esc(why) + '</div>' : '')
  );
}
/* In Settings the layers are rail rows, so the RAIL has to repaint too (to move the highlight); elsewhere the
   in-place swap is still right. renderApp covers both — Settings paints from cache, so it is not a re-fetch. */
/* Open state is per-group and sticks while you move between layers — you are usually asking the same question
   ("what can I change?") of each one in turn, and re-collapsing on every switch would fight that. */
function govToggleGrp(k) {
  UI.govOpen = UI.govOpen || { yours: true, fixed: false, none: false };
  UI.govOpen[k] = !UI.govOpen[k];
  var node = document.getElementById('govblock');
  if (node) node.outerHTML = govLayersBlock();
}
function govSetTab(i) {
  UI.govTab = i;
  if (UI.nav === 'settings') {
    if (UI.vp === 'mob') {
      UI.mdetail = true;
    }
    renderApp();
    if (typeof loadSettings === 'function') loadSettings();
    return;
  }
  var node = document.getElementById('govblock');
  if (node) node.outerHTML = govLayersBlock();
}
function govLayersBlock() {
  var t = UI.govTab || 0;
  var L = GOV[t];
  var tabs = GOV.map(function (item, index) {
    return (
      '<button data-cbsid="ACC002-B36" class="composebtn' +
      (index === t ? ' on' : '') +
      '" style="font-size:var(--fs-1);padding:5px 9px" onclick="govSetTab(' +
      index +
      ')">' +
      esc(item.n) +
      '</button>'
    );
  }).join('');
  /**
   * ⭐ SPLIT BY WHO CONTROLS IT (Athi, 2026-08-16: *"we have to see how we can split between what is static and
   * what can change"*). The distinction already existed — it was encoded in a nine-value class on every row — but
   * it was a small chip at the right edge, so answering "what can I actually change here?" meant decoding nine
   * tags line by line. It is the first question anyone brings to a governance screen, so it becomes the structure.
   *
   * ⚠️ THREE GROUPS, NOT TWO. `free` means "not configured yet, lands here later" — it is neither yours to change
   * nor fixed above you, and filing it under either would be a claim the data does not make.
   */
  var YOURS = { advisory: 1, entity: 1, bound_set: 1, chosen: 1 }; // set it, pick from a set, or tighten it
  var FIXED = { bound: 1, inherited: 1, protected: 1, metered: 1 }; // decided upstream or by the platform
  var _rows = [];
  var push = function (label, val, klass) {
    _rows.push([label, val, klass]);
  };
  /**
   * ⚠️ THE THREE DECOY CONTROLS ARE GONE. Currency, Timezone and Language were working `<select>`s that persisted
   * to localStorage (`cb_govset`) and were read by NOTHING except this screen. Money renders from
   * `SESSION.currency` via myCur(); timezone and language have no store and no reader at all. So the only
   * editable controls on the governance card were the three that changed nothing — the most convincing thing on
   * the screen and the least real. A stub you cannot edit is honest; one that accepts and remembers your input
   * is not.
   *
   * Now: Currency shows the entity's ACTUAL value, read-only because no write path exists (adding a select before
   * the endpoint would recreate exactly the problem). Timezone and Language say plainly that nothing sets them.
   */
  if (t === 0) {
    /**
     * ⚠️⚠️ TWO SOURCES FOR ONE FACT, AND THEY CAN DISAGREE. This row read the ENTITY RECORD
     * (identities.currency_code, via myCur()). Profile › Your rights reads the RESOLVED governance
     * (basics.currency — the installation's currency, bounded by the platform's allowed list,
     * lib/govresolve.js:49). Two different columns, both rendered as the authoritative answer, on two screens.
     *
     * ⭐ The resolved value is the one that GOVERNS — it is what the platform and installation permit. The
     * entity record is what this business set. Where they differ that is worth SEEING, not hiding behind
     * whichever screen you happened to open, so the row shows both and names them.
     */
    (function () {
      var _rec = moneyCode();
      var _gov = (UI._me && UI._me.governance && UI._me.governance.basics && UI._me.governance.basics.currency) || '';
      if (_gov && _rec && String(_gov).toUpperCase() !== String(_rec).toUpperCase()) {
        push(
          'Currency',
          esc(_gov) +
            ' <span style="color:var(--warn-2)">— governed. Your entity record says ' +
            esc(_rec) +
            ', which is what your prices are stamped with.</span>',
          'bound'
        );
      } else {
        push('Currency', esc(_gov || _rec) + ' — from your installation, matched by your entity record', 'bound');
      }
    })();
    push('Timezone', 'not stored anywhere yet', 'free');
    push('Language', 'not stored anywhere yet', 'free');
  }
  /* ⚠️ The Consolidation view inherited from GOVSET — the localStorage decoy — so it echoed a value nothing
     used. It reads the same real sources the Constitution row does, and says so where there is none. */
  else if (t === 6) {
    push('Currency (inherited)', esc(moneyCode() || '-') + ' · from your entity record', 'inherited');
    push('Timezone (inherited)', 'nothing to inherit — not stored', 'free');
    push('Language (inherited)', 'nothing to inherit — not stored', 'free');
  }
  L.rows.forEach(function (item) {
    push(item[0], esc(govVal(item[1])), item[2]);
  }); // literal or live — govVal resolves both
  /**
   * ⭐ COLLAPSIBLE GROUPS (Athi, 2026-08-16). A layer can run to nineteen rows, and the three groups are not
   * equally interesting: "Yours to set" is the reason you opened the screen, "Fixed above you" is reference, and
   * "Not configured yet" is a placeholder. Opening all three every time buries the actionable one under the other
   * two — so the one you can act on opens, the rest stay shut with their count visible and open on a click.
   *
   * ⚠️ The count sits in the HEADER, not inside the panel, so a shut group still tells you how much is in it.
   * A collapsed section that hides even its own size is just missing information.
   */
  var grp = function (key, title, note, pick) {
    var list = _rows.filter(function (item) {
      return pick(item[2]);
    });
    if (!list.length) return '';
    UI.govOpen = UI.govOpen || { yours: true, fixed: false, none: false };
    var open = !!UI.govOpen[key];
    return (
      '<div class="govgrp' +
      (open ? ' open' : '') +
      '">' +
      '<button data-cbsid="ACC002-B37" class="govgrp-h" data-testid="gov-grp-' +
      key +
      '" onclick="govToggleGrp(\'' +
      key +
      '\')" aria-expanded="' +
      open +
      '">' +
      '<span class="govchev">' +
      (open ? '▾' : '<span class=arw>▸</span>') +
      '</span><span class="govgrp-t">' +
      title +
      '</span>' +
      '<span class="govcount">' +
      list.length +
      '</span><span class="govnote">' +
      note +
      '</span></button>' +
      (open
        ? '<div class="govgrp-b">' +
          list
            .map(function (item) {
              return govRowHtml(item[0], item[1], item[2]);
            })
            .join('') +
          '</div>'
        : '') +
      '</div>'
    );
  };
  var rowsHtml =
    grp('yours', 'Yours to set', 'you control these', function (k) {
      return YOURS[k];
    }) +
    grp('fixed', 'Fixed above you', 'inherited or platform-bound', function (k) {
      return FIXED[k];
    }) +
    grp('none', 'Not configured yet', 'arrives from the layer later', function (k) {
      return !YOURS[k] && !FIXED[k];
    });
  if (t === 0) {
    rowsHtml +=
      '<div style="margin:13px 0 2px;font-family:\'Space Grotesk\';font-weight:700;font-size:var(--fs-2);color:var(--grey-2)">' +
      tx('⚙ Installation · platform-only (master)') +
      '</div>' +
      govRowHtml('Cloud provider', 'AWS', 'protected') +
      govRowHtml('Region', 'ap-south-1', 'protected') +
      govRowHtml('Storage adapter', 'db <span class=arw>→</span> S3 / Azure / GCS', 'protected') +
      govRowHtml('Storage bucket', 'chitbridge-prod-•••', 'protected') +
      govRowHtml('Secrets / keys', '•••• managed (never exposed)', 'protected') +
      govRowHtml('System health', '● healthy', 'protected');
    rowsHtml += govPlanBlock();
  }
  var inRail = UI.nav === 'settings'; /* rail carries the layers in Settings; chips elsewhere */
  /* ⭐ THE INSTRUCTION STAYS, THE MECHANISM MOVES. "boilerplate every entity copies at registration" and
     "freeze onto each chit at send" are how it works; a person on this tab is choosing a value. */
  var foot =
    t === 0
      ? 'Change a value above, then open <b>tab 7 · Consolidation</b>. <i>⏳ ' +
        tx('Pending') +
        '</i>' +
        specNote('governance.inherit', 'Values are inherited by the entity from the layer that set them.')
      : t === 6
        ? '<i>⏳ ' +
          tx('Pending') +
          '</i>' +
          specNote(
            'governance.boilerplate',
            'These come down into the <b>boilerplate</b> every entity copies at registration, and <b>freeze</b> onto each chit at send.'
          ) /* ⚠️ THE GENERIC LEGEND IS GONE. It defined `bound` / `advisory` / `free` — words this screen no longer uses,
   because every row now says what it means in plain English on the row itself. A legend for vocabulary that is
   not on the page is the stale-copy bug in its purest form: correct once, then quietly describing nothing. */
        : '';
  /* ⚠️ "stub · perception" was internal shorthand on a user-facing screen. The honest part of it — that these are
     not enforced yet — is worth keeping and is now said in words a reader can act on. */
  /**
   * ⭐ THE LAYER IS THE SUBJECT, so it is the heading — name first, then which of the seven it is, then what it
   * means, then the groups. It used to open with "🏛️ Governance · 7 layers" (which the rail already says) and
   * carry the layer name in smaller type underneath, so the screen led with its category instead of its content.
   *
   * ⚠️ The layer NAME comes from GOV[i].n, which is "1 · Constitution" — the ordinal is stripped for the heading
   * and stated properly as "Layer 1 of 7", rather than printing "1 · Constitution" beside "Layer 1 of 7" twice.
   */
  /* The layer's own name, ordinal and all — "1 · Constitution" — is the heading. The separate "Layer 1 of 7" line
     said the same thing a second way; the rail shows all seven, so position is already visible there. */
  return (
    '<div id="govblock" style="' +
    _CARD +
    '">' +
    (inRail ? '' : '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:11px">' + tabs + '</div>') +
    '<div class="govtitle">' +
    esc(L.n) +
    '</div>' +
    '<div class="govsub">' +
    esc(L.tag) +
    ' <span class="govtag" style="background:var(--warn-tint);color:var(--warn-3)">shown, not enforced yet</span></div>' +
    '<div class="govdesc">' +
    esc(L.desc) +
    '</div>' +
    rowsHtml +
    (foot ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:11px;line-height:1.5">' + foot + '</div>' : '') +
    /**
     * ⭐⭐ GOVERNANCE SETS THE ENVELOPE; SETTINGS PICKS A POINT INSIDE IT — and this footer is where that
     * relationship stops being implicit.
     *
     * Athi, 2026-08-18: *"localisation, appearance and standards, can they get into governance layer?"*
     *
     * ⚠️ THE ANSWER IS NO, AND THE REASON IS THE SPLIT THIS SCREEN ALREADY MAKES. Every row above is either
     * YOURS or FIXED. Governance answers "by what authority, and how far may I move?"; Settings answers "where
     * inside that am I?". Moving the day-to-day pickers in here would bury a control someone uses weekly inside
     * the screen they visit twice a year — and moving the authority out to Settings would leave governance
     * describing rules it could not point at.
     *
     * ⚠️ SO THEY ARE LINKED, NOT MERGED. The rows above already RESOLVE live from the same source the settings
     * screens write (govLocaleLang/Format/Dir), so the two can never disagree; these links close the loop by
     * sending a reader from the rule to the place the choice is made.
     */
    '<div style="margin-top:12px;padding-top:10px;border-block-start:1px solid var(--line);font-size:var(--fs-1);line-height:1.6">' +
    '<div style="color:var(--grey);margin-bottom:5px"><b>This sets the limits. You choose inside them:</b></div>' +
    '<a data-cbsid="ACC002-C08" href="#" data-testid="gov-to-locale" onclick="setSetSec(' +
    "'locale'" +
    ');return false" style="color:var(--blue);font-weight:600">Localisation <span class=arw>→</span></a>' +
    '<span style="color:var(--grey)"> language, formats, time zone, working days &nbsp;·&nbsp; </span>' +
    '<a data-cbsid="ACC002-C09" href="#" data-testid="gov-to-appearance" onclick="setSetSec(' +
    "'appearance'" +
    ');return false" style="color:var(--blue);font-weight:600">Appearance <span class=arw>→</span></a>' +
    '<span style="color:var(--grey)"> theme, text size, motion &nbsp;·&nbsp; </span>' +
    '<a data-cbsid="ACC002-C10" href="#" data-testid="gov-to-standards" onclick="setSetSec(' +
    "'standards'" +
    ');return false" style="color:var(--blue);font-weight:600">Standards <span class=arw>→</span></a>' +
    '<span style="color:var(--grey)"> the authority every rule above derives from, and what each one removes</span>' +
    '</div>' +
    '</div>'
  );
}
/* ═══ SETTINGS ══════════════════════════════════════════════════════════════════════════════════════════════
 * Eight cards in one scroll — governance layers, assignment, auto-assign, attachment policy, AI, channels, policy
 * flags, blueprints — with nothing marking where one subject ended and the next began. Grouped into five sections
 * in the same two-pane shell the rest of the app uses.
 *
 * ⚠️ The "saved but NOT YET ACTIVE" warning stays exactly where it is. It is the most useful sentence on the
 * screen: a preference that is stored and unenforced looks identical to one that works.
 */
var SET_SECS = [
  /* ⭐ FIRST, because it is the most basic thing anyone can say about their shop, and because two of the
     four columns it writes decide whether anybody can find them at all. See ACCESS-MATRIX.md. */
  { key: 'business', name: 'Your business', q: 'What you do, and who can see it' },
  { key: 'work', name: 'Work', q: 'How tasks reach people' },
  { key: 'policy', name: 'Policy', q: 'Rules on your records' },
  { key: 'channels', name: 'Channels', q: 'Where work arrives from' },
  { key: 'integrations', name: 'Integrations', q: 'Keys other systems call with' },
  { key: 'governance', name: 'Governance layers', q: 'Where your rights come from' },
  /* ⚠️ NAMED FOR WHAT IT RENDERS. I called this "Blueprints · Shared catalogue designs" when splitting Settings
     into sections, taking the name from the function (blueprintSettingsHTML) without reading its output — it
     renders WORK_PATTERNS, "Governed by work pattern". Nothing about catalogue blueprints appears on it. */
  { key: 'blueprints', name: 'Work patterns', q: 'How each action is governed' },
  /* ⚠️ ITS OWN SECTION, NOT A ROW UNDER SOMETHING ELSE. Localisation is eight decisions — language, direction,
     numerals, numbers, money, dates, times and sort order — and they were scattered across five files and three
     hardcoded 'en-IN' pins. A concern that large filed under "Work" is a concern nobody finds. */
  { key: 'locale', name: 'Localisation', q: 'Language, formats and direction' },
  /**
   * ⭐ APPEARANCE IS ITS OWN SECTION, because it outgrew the avatar dropdown the moment the themes started
   * explaining themselves. Fifteen themes, five of which carry an audience and a standard, do not fit a menu
   * that hangs off a topbar — the phone-sized scrolling panel there is a patch, and this is the real home.
   *
   * ⚠️ AND BECAUSE TEXT SIZE AND MOTION BELONG NEXT TO THE THEMES. They are the same decision — "can I use
   * this?" — and splitting them across a menu and a settings page means someone who needs two of the three
   * finds one of them. Athi: *"we can see how to bring the look and feel as a separate unit."*
   */
  { key: 'appearance', name: 'Appearance', q: 'Theme, text size and motion', moved: 'the avatar menu' },
  /**
   * ⭐⭐ STANDARDS — what the PLATFORM follows, what YOU follow, and what your TRADE follows.
   *
   * Athi, 2026-08-18: *"under standards, possibly we can bring two section — what this platform follows, what
   * the end user is going to follow. All implementation standards can be specified here, so all comes under one
   * roof. And then specific to entity for commercial standard."*
   *
   * ⚠️ THE STATUS COLUMN IS THE WHOLE POINT, and a list without it would be marketing. Some of these are
   * implemented and tested, some are half-done, some are only decided — and a compliance page that flattens
   * those three into one tick is worse than no page, because someone will rely on it. Anything not in force
   * says what is missing, in its own row.
   */
  { key: 'standards', name: 'Standards', q: 'What you follow, and the register', moved: 'standards.html' }
];
function setSec() {
  return UI.setSec || 'work';
}
/* Same reason as profSetSec — the hook fires before #setbody exists, so drive the load explicitly. */
/**
 * ⚠️ SWITCHING SECTIONS IS AN EXIT, and it discards whatever was typed. Three Settings sections need a Save
 * (Work, Auto-assign, Documents); clicking another rail row threw that away silently, which is the exact loss
 * Athi asked to be warned about on Profile. Same guard, same three outcomes, same functions.
 */
function setSetSec(k) {
  setGuard(function () {
    UI.setSec = k;
    renderApp();
    _capShowDetail();
    loadSettings();
  });
}

function settingsScreen() {
  /**
   * ⭐ THE 7 GOVERNANCE LAYERS ARE RAIL ROWS (Athi, 2026-08-16: *"under governance you can bring all 7 layers and
   * each can bring its own data right side"*). They were a strip of chips INSIDE the right pane — a second
   * navigation nested in a section, so the screen had two different ways of choosing a thing depending on how
   * deep you were. The rail already is the way you choose a thing; the layers just belong in it.
   *
   * They appear only while Governance is the open section, so the rail stays five rows when it is not.
   */
  /* P0: a section marked `moved` has its customer home (frozen, not deleted; setSetSec('standards') still opens it) — no rail row. */
  var rail = SET_SECS.filter(function (item) {
    return !item.moved;
  })
    .map(function (item) {
      var row =
        '<div data-cbsid="ACC002-C11" class="row misrow' +
        (setSec() === item.key ? ' sel' : '') +
        '" data-testid="set-sec-' +
        item.key +
        '" onclick="setSetSec(\'' +
        item.key +
        '\')">' +
        '<div class="main2"><div class="l1"><span class="code">' +
        esc(item.name) +
        '</span></div><div class="l2">' +
        esc(item.q) +
        '</div></div></div>';
      if (item.key === 'integrations' && setSec() === 'integrations') {
        row += INT_TABS.map(function (entry) {
          return (
            '<div data-cbsid="ACC002-C12" class="row misrow sub' +
            (intTab() === entry.key ? ' sel' : '') +
            '" data-testid="int-tab-' +
            entry.key +
            '" onclick="intSetTab(\'' +
            entry.key +
            '\')">' +
            '<div class="main2"><div class="l1"><span class="code">' +
            esc(tx(entry.n)) +
            '</span></div>' +
            '<div class="l2">' +
            esc(tx(entry.q)) +
            '</div></div></div>'
          );
        }).join('');
      }
      if (item.key === 'governance' && setSec() === 'governance' && typeof GOV !== 'undefined') {
        row += GOV.map(function (entry, index) {
          var on = (UI.govTab || 0) === index;
          return (
            '<div data-cbsid="ACC002-C13" class="row misrow sub' +
            (on ? ' sel' : '') +
            '" data-testid="gov-layer-' +
            index +
            '" onclick="govSetTab(' +
            index +
            ')">' +
            '<div class="main2"><div class="l1"><span class="code">' +
            esc(entry.n) +
            '</span></div>' +
            '<div class="l2">' +
            esc(entry.tag || '') +
            '</div></div></div>'
          );
        }).join('');
      }
      return row;
    })
    .join('');
  var list =
    '<div class="list"><div class="lh" style="padding:0"><div class="misbar"><span class="misttl">' +
    tx('⚙️ Settings') +
    '</span></div></div>' +
    '<div class="rows" id="set_rail">' +
    rail +
    '</div></div>';
  var detail =
    '<div class="detail" id="detailpane"><div id="setbody"><button data-cbsid="CMP006" class="dback" data-testid="cap-back" onclick="backToList()">‹ Back</button></div></div>';
  var divider =
    '<div class="divider" id="divider" onmousedown="startDrag(event)" ontouchstart="startDrag(event)" role="separator" aria-label="Resize panes"><span class="grip"></span></div>';
  if (UI.misLw == null) UI.misLw = 320;
  var lw = Math.min(UI.misLw, Math.max(260, Math.round((window.innerWidth || 1200) * 0.42)));
  return (
    '<div class="panel' +
    (UI.vp === 'mob' && UI.mdetail ? ' showdetail' : '') +
    '" id="panel" style="--lw:' +
    lw +
    'px;--lh:' +
    (UI.lh || 300) +
    'px">' +
    list +
    divider +
    detail +
    '</div>'
  );
}
// AI assists settings = a REDIRECT to Co-assists (the enable + rule live WITH the actor, next to Human/IoT/ERP —
// a lit AI slot is an actor whose actions are disputable chits, so its control belongs where it's held accountable).
function aiSettingsCard() {
  return (
    '<div style="' +
    _CARD +
    '"><div class="sec" style="margin:0 0 6px">🤖 AI assists <span style="font-size:var(--fs-1);font-family:\'Space Mono\';background:var(--warn-tint);color:var(--warn-3);border-radius:5px;padding:1px 6px">governed</span></div>' +
    /**
     * ⭐ SIMPLIFIED, NOT MERELY SHORTENED. Athi, 2026-08-20: *"this text has to be simplified, no one understands
     * rung floor etc."*
     *
     * Three pieces of jargon carried the old sentence — "the human gate", "bounded by the rung floor (you can
     * only tighten)", and "a lit AI slot is an actor" — and none of them is needed to understand what the button
     * underneath does. The two facts a reader actually needs are that an AI assist is governed like a person,
     * and that what it does is disputable.
     *
     * ⚠️ "actor" WENT TOO. It is the database's word (identity_type='actor'), never the product's — TERM.coassist
     * is what a person reads.
     */
    '<div style="font-size:var(--fs-2);color:var(--grey);line-height:1.55">An AI assist is a ' +
    TERM.coassist +
    '. ' +
    'It works to a rule you set, and everything it does is a chit you can dispute.</div>' +
    '<button data-cbsid="ACC002-B38" class="composebtn" style="margin-top:10px" onclick="goCoassistAI()">Configure AI assists in Co-assists <span class=arw>→</span></button></div>'
  );
}
function goCoassistAI() {
  try {
    if (typeof UI !== 'undefined') UI.acTypeF = 'ai';
  } catch (_) {}
  if (typeof navTo === 'function') navTo('coassists');
  else if (typeof go === 'function') go('#/coassists');
}
/**
 * ⚠️ FETCH ONCE, PAINT MANY. Switching section is not a reason to re-read settings and the actor list — and until
 * this cache existed every switch fired both again, so the pane sat on its spinner while a round trip completed
 * for data it already had.
 */
async function loadSettings() {
  const node = document.getElementById('setbody');
  if (!node) return;
  if (UI._set) {
    return (function () {
      var r = paintSettings(UI._set.s, UI._set.daOpts);
      setSnapshot();
      return r;
    })();
  }
  try {
    const [s, _acts] = await Promise.all([
      api('getSettings').then((reply) => reply || {}),
      api('actors')
        .then((reply) => (reply || []).map(mapApiActor))
        .catch(() => [])
    ]);
    const _assign = _acts.filter((item) => hatAssignable(item.hat));
    const _daOpts =
      '<option value="">— none (leave in pool) —</option>' +
      _assign.map((item) => `<option value="${item.id}"${s.default_assignee_actor_id === item.id ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
    UI._set = { s: s, daOpts: _daOpts };
    paintSettings(s, _daOpts);
    /* ⚠️ THE BASELINE IS TAKEN AFTER EVERY PAINT — one captured at load goes stale the first time a
       section changes, and every later edit then reads as clean. Same rule as Profile. */
    setSnapshot();
  } catch (e) {
    node.innerHTML = scrErr(e);
  }
}
/**
 * ⭐⭐ THE LOCALISATION SCREEN.
 *
 * ⚠️ THE LIVE PREVIEW IS THE MOST IMPORTANT COMPONENT ON IT, and it is not decoration. Every other control here
 * is an abstraction — nobody can predict what `ar-EG` does to a number, or that Arabic switches the page
 * direction, or that French moves the currency symbol to the end. Showing the result BEFORE the choice is the
 * difference between a setting and a guess. Ship this without the preview and people will set a locale, meet
 * unexpected digits somewhere else entirely, and file it as a bug.
 *
 * ⭐ LANGUAGE AND FORMAT ARE TWO CONTROLS, deliberately. An Indian trader may want English words with Indian
 * grouping; a Gulf buyer Arabic words with Western digits. Tying them forces a choice nobody asked to make.
 *
 * ⚠️ DIRECTION IS SHOWN, NOT CHOSEN. It follows the language, and offering it as a control invites somebody to
 * pick an unreadable combination and then report the app as broken.
 */

/**
 * The Appearance screen — theme, text size and motion, with the standard stated on every claim.
 *
 * ⚠️ IT REUSES themePaletteHTML() RATHER THAN DRAWING ITS OWN SWATCHES. Two renderers for the same fifteen
 * themes would drift the day someone adds a sixteenth, and the one that was forgotten would be the one a
 * reader happened to be looking at. One palette, two places it can appear.
 */

/**
 * ⭐ SETTINGS › STANDARDS KEEPS WHAT IS ABOUT YOUR OWN SETTINGS (2026-10-03). The register itself — what ChitBridge follows, what is
 * still missing, the argument for following standards, the sample record, the commercial standards — is READ on its own page,
 * /standards.html (docs/design/standards-page), with the matrix, the list and the two sheets; the register's data stays in
 * cap-standards.js, which that page and the Legend read. Here is the one thing that belongs next to the settings it describes:
 * a live reading of the conventions YOUR screens follow, and the door to the page.
 *
 * ⚠️ THE STATUS COLUMN WAS THE WHOLE POINT of the old four tabs and it moved with them: In force / Partly / Planned, and what is
 * missing in the row itself, are on the page. Do not rebuild a second list here.
 */
function standardsSettingsHTML() {
  var card = function (inner) {
    return '<div style="' + _CARD + '">' + inner + '</div>';
  };
  /* ⚠️ READ FROM THE LIVE SETTINGS, never a stored copy. A page describing what you follow that had drifted
   from what you actually set would be the one place a wrong answer is guaranteed to be believed. */
  var DAY = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
  var r = CBLocale.regionInfo();
  var th = (typeof THEMES !== 'undefined' && THEMES[typeof themeGet === 'function' ? themeGet() : 'cream']) || {};
  var mine = [
    ['Region', r ? r.name : 'Not set'],
    [
      'Languages',
      CBLocale.langs()
        .map(function (x, index) {
          return index + 1 + '. ' + CBLocale.langName(x);
        })
        .join('  ·  ')
    ],
    ['Reading order', CBLocale.dir() === 'rtl' ? 'Right to left ←' : 'Left to right →'],
    ['Locale tag', '<code>' + esc(CBLocale.tag()) + '</code>'],
    ['Numbers', esc(CBLocale.number(123456789.5))],
    ['Money', esc(fmtMoney(123456.5, moneyCode()))],
    ['Date', esc(CBLocale.date(Date.now()))],
    ['Time', esc(CBLocale.time(Date.now()))],
    ['Time zone', esc(CBLocale.timezone())],
    [
      'Working days',
      CBLocale.workdays()
        .map(function (item) {
          return DAY[item];
        })
        .join(' ') + (CBLocale.hasWorkdayOverride() ? '  (you set these)' : '  (regional default)')
    ],
    ['Theme', esc(th.name || '—') + (th.a11y ? '  · meets WCAG ' + esc(th.a11y.level) : '')],
    [
      'Text size',
      typeof TEXT_SIZES !== 'undefined' && typeof textSize === 'function'
        ? (function () {
            var m = TEXT_SIZES.filter(function (x) {
              return x[0] === textSize();
            })[0];
            return m ? m[1] + ' (' + Math.round(m[2] * 100) + '%)' : '—';
          })()
        : '—'
    ],
    ['Motion', typeof motionPref === 'function' ? { auto: 'Follow my device', reduce: 'Reduced', full: 'Always animate' }[motionPref()] || '—' : '—']
  ];
  var body =
    card(
      '<div style="font-size:var(--fs-2);line-height:1.6;color:var(--on-card)">' +
        'The conventions <b>your</b> screens follow. Every line here is a live reading of your own settings, ' +
        'not a stored copy — change one in Localisation or Appearance and this moves with it.' +
        '</div>'
    ) +
    card(
      '<div data-testid="std-yours">' +
        mine
          .map(function (x) {
            return (
              '<div style="display:flex;gap:10px;padding:5px 0;border-block-start:1px solid var(--line);font-size:var(--fs-2)">' +
              '<span style="min-width:112px;color:var(--grey)">' +
              x[0] +
              '</span>' +
              '<b style="color:var(--on-card);min-width:0;word-break:break-word">' +
              x[1] +
              '</b></div>'
            );
          })
          .join('') +
        '</div>'
    ) +
    card(
      '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.6">' +
        '⚠️ <b>' +
        tx('None of this changes what anyone wrote.') +
        '</b> These settings govern the chrome and the way figures ' +
        'are written. Product names, catalogue entries, chit subjects, messages and dispute reasons stay in the ' +
        'language and the currency their author used — a chit is a shared record, and one that read differently ' +
        'to each party would not be a record.</div>'
    );

  /* the door to the page: its counts are the register's own (stdCounts), never typed here */
  var n = stdCounts();
  var door = card(
    '<div style="font-size:var(--fs-2);line-height:1.6;color:var(--on-card)">' +
      '<b>' +
      tx('What we follow, and what is still missing') +
      '</b> — the laws and standards, each with its status, ' +
      'now has its own page.' +
      '<div style="margin-top:6px;font-size:var(--fs-1);color:var(--grey)" data-testid="std-door-counts">' +
      '<b style="color:var(--ok-2)">' +
      n.live +
      ' in force</b> · <b style="color:var(--warn-2)">' +
      n.part +
      ' partly</b> · ' +
      n.plan +
      ' planned.</div>' +
      '<div style="margin-top:9px"><a href="/standards.html" data-testid="std-open-page" style="color:var(--blue);font-weight:700">' +
      tx('Open Standards') +
      ' <span class=arw>→</span></a></div>' +
      '</div>'
  );

  return _misHead('Standards', '') + door + body;
}

function appearanceSettingsHTML() {
  var card = function (inner) {
    return '<div style="' + _CARD + '">' + inner + '</div>';
  };
  /* ⚠️ Q IS DEFINED HERE, in the SHIPPED function — not in the script that generated it. This is the fourth
     time a generator-only constant has been emitted into shipped code (BT, then Q twice, now this). It always
     PARSES, because a bare identifier is valid syntax, so node --check and the guard both pass and it only
     dies when the line finally runs — reaching Athi as "the buttons do nothing". A generator that writes code
     must be tested by RUNNING its output, which is what caught this one before it shipped. */
  var Q = String.fromCharCode(39);
  var cur = typeof textSize === 'function' ? textSize() : 'm';
  var mot = typeof motionPref === 'function' ? motionPref() : 'auto';

  var pill = function (id, on, click, label, sub) {
    return (
      '<button data-cbsid="ACC002-B39" type="button" data-testid="' +
      id +
      '" onclick="' +
      click +
      '"' +
      ' aria-pressed="' +
      (on ? 'true' : 'false') +
      '"' +
      ' style="flex:1;min-width:0;cursor:pointer;font:inherit;text-align:center;padding:7px 6px;border-radius:9px;' +
      'border:2px solid ' +
      (on ? 'var(--blue)' : 'var(--line)') +
      ';' +
      'background:' +
      (on ? 'var(--blue-tint-bg)' : 'var(--card)') +
      ';color:var(--on-card)">' +
      '<span style="display:block;font-weight:' +
      (on ? 800 : 600) +
      ';font-size:var(--fs-2)">' +
      esc(label) +
      '</span>' +
      (sub ? '<span style="display:block;font-size:var(--fs-1);color:var(--grey);margin-top:2px">' + esc(sub) + '</span>' : '') +
      '</button>'
    );
  };

  var sizes = (typeof TEXT_SIZES !== 'undefined' ? TEXT_SIZES : [])
    .map(function (x) {
      return pill('ap-fs-' + x[0], cur === x[0], 'textSizeSet(' + Q + x[0] + Q + ')', x[1], Math.round(x[2] * 100) + '%');
    })
    .join('');

  var motions = [
    ['auto', 'Follow my device', 'the usual'],
    ['reduce', 'Reduce motion', 'no animation'],
    ['full', 'Always animate', 'override']
  ]
    .map(function (x) {
      return pill('ap-motion-' + x[0], mot === x[0], 'motionSet(' + Q + x[0] + Q + ')', x[1], x[2]);
    })
    .join('');

  return (
    _misHead('Appearance', '') +
    card(
      '<label class="fl">' +
        tx('Theme') +
        '</label>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.5;margin:0 0 8px">' +
        'Fifteen themes. The five under <b>' +
        tx('Designed for specific needs') +
        '</b> each name who they are for and which ' +
        'standard they meet — and those levels are computed by a test, so a card claiming 7:1 has been checked.' +
        '</div>' +
        (typeof themePaletteHTML === 'function' ? themePaletteHTML() : '')
    ) +
    card(
      '<label class="fl">' +
        tx('Text size') +
        '</label>' +
        '<div style="display:flex;gap:7px;margin:5px 0 7px">' +
        sizes +
        '</div>' +
        /* ⚠️ THE SENTENCE THAT WAS HERE IS GONE — "the whole type scale moves together, so headings stay
           larger than captions" is a description of the implementation, and the line BELOW it demonstrates
           the same thing by being rendered at the chosen size. A demonstration outlives an explanation:
           this text is showing at 115% is checkable by looking at it. Athi: *"if some adjustment needed in
           settings, please do so."* */
        '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.5">' +
        '<b>This text is showing at ' +
        esc(
          String(
            Math.round(
              (TEXT_SIZES.filter(function (x) {
                return x[0] === cur;
              })[0] || [0, 0, 1])[2] * 100
            )
          )
        ) +
        '%.</b>' +
        '</div>'
    ) +
    card(
      '<label class="fl">' +
        tx('Motion') +
        '</label>' +
        '<div style="display:flex;gap:7px;margin:5px 0 7px">' +
        motions +
        '</div>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.5">' +
        '⚠️ <b>' +
        tx('Movement is a health setting, not a matter of polish.') +
        '</b> Animation triggers migraine, nausea and ' +
        'vertigo for people with vestibular disorders. <b>' +
        tx('Follow my device') +
        '</b> honours the setting you already ' +
        'made in Windows, macOS, iOS or Android — you should not have to ask us separately.' +
        '</div>'
    ) +
    /* ⚠️ WHAT IS NOT HERE YET, SAID PLAINLY. A settings page that silently lacks the control someone came for
       wastes their time twice: once looking, once wondering whether they missed it. */
    card(
      '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);margin-bottom:5px">' +
        tx('Not here yet') +
        '</div>' +
        '<div style="font-size:var(--fs-2);line-height:1.6;color:var(--on-card)">' +
        '<b>' +
        tx('Typeface') +
        '</b> — a dyslexia-friendly face (Atkinson Hyperlegible, free, from the Braille Institute) needs ' +
        'the font shipped with the app before it can be offered.<br>' +
        '<b>' +
        tx('Colour-vision preview') +
        '</b> — showing you what deuteranopia does to your own screen, rather than asking ' +
        'you to take the Colour Vision theme on trust.<br>' +
        '<b>' +
        tx('These follow you, not this browser.') +
        '</b> Sign in on another device and they come with you.' +
        '</div>'
    ) +
    '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.5;margin-top:8px">' +
    'Standards: <b>WCAG 2.2</b> (1.4.3 contrast · 1.4.4 resize text · 2.3.3 animation from interactions) · ' +
    'colour-blind palette <b>' +
    tx('Okabe–Ito') +
    '</b>.' +
    '</div>'
  );
}

/**
 * ⭐ THE LOCALE LABEL TABLES, AT MODULE SCOPE — they were `var`s INSIDE localeSettingsHTML, which made them
 * invisible to the profile. Writing 'Devanagari' a second time over in iamGovernedRows is how the Settings
 * picker and the Profile note start disagreeing about what a code is called: two tables, one meaning, no force
 * keeping them equal. The pickers still read these; nothing else changed for them.
 */
var NUMERALS = [
  ['', 'Follow the format'],
  ['latn', 'Western'],
  ['arab', 'Eastern Arabic'],
  ['deva', 'Devanagari']
];
var HOURS = [
  ['', 'Follow the format'],
  ['h12', '12-hour'],
  ['h23', '24-hour']
];
var CALS = [
  ['', 'Follow the format'],
  ['gregory', 'Gregorian'],
  ['islamic-umalqura', 'Hijri (Umm al-Qura)'],
  ['indian', 'Indian national'],
  ['buddhist', 'Buddhist']
];
var WEEK = [
  ['', 'Follow the format'],
  ['mon', 'Monday'],
  ['sun', 'Sunday'],
  ['sat', 'Saturday']
];

/**
 * The short name for a stored code — 'deva' → 'Devanagari'. The tables carry a sample after an em dash
 * ('Devanagari — १२३') because a PICKER should show one; a note beside the value should not repeat digits the
 * reader can already see, so the sample is trimmed here rather than kept in a second table.
 *
 * ⚠️ .find() ON AN ARRAY, not a bracket lookup on an object — no prototype chain to walk past, so an unknown
 * code returns the code itself instead of something truthy from Object.prototype.
 */
/**
 * ⭐⭐ WHAT THIS OPTION WOULD ACTUALLY DO, RENDERED. Athi, 2026-08-21: *"I changed to Indian calendar and the
 * result was Sravana, but I was not aware what Indian calendar means until I saw the result. If you change
 * this control, this is the effect — that has to be spelt then and there explicitly."*
 *
 * ⚠️ 'Indian national' NAMES A STANDARD AND DESCRIBES NOTHING. Nobody picks a calendar from its title; they
 * pick it from the date it produces. Numerals and hour cycle already carried a sample and the calendar list —
 * the one whose options are genuinely unguessable — was the single list without one.
 *
 * ⚠⚠ GENERATED, NOT TYPED, AND THAT IS THE REAL CHANGE. The samples that did exist were hand-written strings:
 * 'Devanagari — १२३' was a CLAIM about what Intl does, maintained by whoever last remembered. These are
 * produced by the same engine that will render the app, against today's date, in the reader's own base locale,
 * so a sample can never promise something the setting does not deliver.
 */
function _locSample(kind, code) {
  if (!code) return ''; /* 'Follow the format' has no effect of its own to show */
  var base = String((CBLocale.tag ? CBLocale.tag() : 'en') || 'en').split('-u-')[0];
  var now = new Date();
  try {
    if (kind === 'nu') return new Intl.NumberFormat(base + '-u-nu-' + code).format(12345678.9);
    if (kind === 'hc') return new Intl.DateTimeFormat(base + '-u-hc-' + code, { hour: '2-digit', minute: '2-digit' }).format(now);
    if (kind === 'ca') return new Intl.DateTimeFormat(base + '-u-ca-' + code, { day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  } catch (_) {
    /* ⚠️ an engine that does not know this extension shows the NAME alone rather than a wrong
                    sample — silence is honest here, a guess is not. */
  }
  return '';
}

/** [code, name] → [code, 'name — sample'], for the pickers. One place, so every list gets the same treatment. */
function _locWithSamples(table, kind) {
  return table.map(function (item) {
    var s = _locSample(kind, item[0]);
    return [item[0], s ? item[1] + ' — ' + s : item[1]];
  });
}

/**
 * ⭐⭐ TAKE ME TO THE CONTROL THAT DECIDES THIS. Athi, 2026-08-21: *"bringing the format together, that is
 * good — but if we can see the place where the control is changing, that would be great."*
 *
 * ⚠️ THE TWO LINKS AT THE FOOT OF THE SECTION WERE NOT ENOUGH. 'Language and formats →' lands you on a screen
 * with ten controls on it and leaves you to work out which one produced 30 Sravana. A link that gets you to
 * the right SCREEN has done half the job and taken credit for all of it.
 *
 * ⚠️ THE HIGHLIGHT IS THE POINT, NOT THE NAVIGATION. Scrolling to an element that looks like its nine
 * neighbours leaves the reader hunting anyway, so the control is outlined for a moment when it arrives — long
 * enough to find, short enough not to become part of the design.
 *
 * ⚠️ AFTER A PAINT, NOT BEFORE. setSetSec() re-renders; querying for the element in the same tick finds the
 * OLD screen, or nothing. requestAnimationFrame twice — one to let the render commit, one to let layout settle,
 * because scrollIntoView on an element the browser has not measured yet scrolls to the wrong place.
 */
function _locGoto(testid, sec) {
  navTo('settings');
  setSetSec(sec || 'locale');
  var tries = 0;
  var find = function () {
    var el = document.querySelector('[data-testid="' + testid + '"]');
    /* ⚠️ A BOUNDED RETRY, NOT A LOOP. The settings body paints asynchronously; if the element never appears
       (a control removed, a testid renamed) this must give up quietly rather than spin — the reader is already
       on the right screen, which is the fallback the old links offered. */
    if (!el) {
      if (++tries < 20) requestAnimationFrame(find);
      return;
    }
    requestAnimationFrame(function () {
      try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (_) {
        el.scrollIntoView();
      }
      var prev = el.style.outline,
        prevOff = el.style.outlineOffset;
      el.style.outline = '2px solid var(--blue)';
      el.style.outlineOffset = '3px';
      setTimeout(function () {
        el.style.outline = prev;
        el.style.outlineOffset = prevOff;
      }, 2200);
    });
  };
  requestAnimationFrame(find);
  return false;
}

/**
 * The little arrow beside a value: where this one is decided.
 *
 * ⚠️ AN ARROW, NOT A SENTENCE. 'You can change this in Settings › Localisation › Calendar' is eleven words
 * per row on a screen that already measured 56% explanation. The affordance carries the meaning; the title
 * attribute carries the name for anyone who wants it.
 */
function _locLink(label, testid, sec) {
  var Q = String.fromCharCode(39);
  return (
    ' <a data-cbsid="ACC002-C14" href="#" title="' +
    esc(label) +
    '" onclick="return _locGoto(' +
    Q +
    testid +
    Q +
    (sec ? ', ' + Q + sec + Q : '') +
    ')" style="color:var(--blue);text-decoration:none;font-size:var(--fs-1)">→</a>'
  );
}

/** Are the reader's languages simply what their region hands out, untouched? See the note at its call site. */
function _langsAreDefault() {
  try {
    var mine = (CBLocale.langs && CBLocale.langs()) || [];
    var ri = CBLocale.regionInfo && CBLocale.regionInfo();
    if (!ri || !ri.langs || !ri.langs.length) return !mine.length;
    return mine.length === 1 && mine[0] === ri.langs[0];
  } catch (_) {
    return true;
  } /* ⚠️ unknown → 'Default'. Claiming a choice nobody made is the worse error. */
}

function _locName(table, code) {
  var row = table.find(function (item) {
    return item[0] === code;
  });
  return row ? String(row[1]).split(' — ')[0] : code;
}

/**
 * ⭐⭐ SETTINGS STAGES, IT NO LONGER APPLIES. Athi, 2026-08-21: *"can we create a save button for each section
 * if they are going to change? So it is a deliberate change per item. This will not happen every day, but I
 * believe this will have a larger impact."*
 *
 * ⚠⚠ HE IS RIGHT AND MY FIRST ANSWER WAS TOO NARROW. I had reasoned that these are reader preferences in
 * this browser, instantly visible and instantly reversible, so a Save button would make you commit before you
 * could see the result. The part I left out: every one of them is PUSHED to the account through CBPrefs, so a
 * mis-click does not stay in this browser — it follows the person to every device they sign in on. That is the
 * larger impact, and it makes deliberateness worth more than immediacy.
 *
 * ⭐ SO BOTH, RATHER THAN A TRADE: the card previews the pending choice live, and nothing leaves until Save.
 * The preview works by REPLAYING the staged calls against real storage, rendering, and rolling back — the same
 * code path a save takes, so what you see is what you get rather than a second implementation's guess.
 *
 * ⚠️ AND THE REST OF THE APP KEEPS THE SAVED FORMAT while you are choosing. Only this card previews. A whole
 * screen lurching into Devanagari on the way past a dropdown is the mis-click Athi is describing, not the cure.
 */
/**
 * The pending bar — what is waiting, and the two ways out of it. Absent entirely when nothing is staged, so
 * the screen a reader normally sees is unchanged.
 */
/**
 * ⭐ THE CURRENCY MENU — the region's answer alone at the top, every ISO 4217 code below it.
 *
 * ⚠️ A SUGGESTION IS NOT A FILTER, and the difference is the bug this replaced. Athi, 2026-08-21: *"if the
 * region is selected the currency should be filtered for that region, but otherwise they should be able to set
 * for any currency — the entire table can be showcased."* Both halves matter: floating SGD to the top for a
 * Singapore business saves a scroll through 162 rows; REMOVING the other 161 would recreate the four-currency
 * cap in a nicer costume.
 *
 * ⚠️ THE CURRENT VALUE IS ALWAYS IN THE LIST even when it is neither suggested nor enumerable — an engine
 * without Intl.supportedValuesOf returns null, and a <select> that silently drops what is saved would show the
 * business a currency it does not use and write it on the next save.
 */
function _curPicker(cur) {
  var all = (CBLocale.currencies && CBLocale.currencies()) || null;
  var mine = (CBLocale.regionCurrencies && CBLocale.regionCurrencies()) || [];
  var top = mine.slice();
  if (cur && top.indexOf(cur) < 0) top.unshift(cur); /* what you use is never buried */
  var rest = (all || []).filter(function (item) {
    return top.indexOf(item) < 0;
  });
  if (!all) rest = []; /* cannot enumerate → offer what we know, say nothing false */

  var label = function (c) {
    var nm = (CBLocale.currencyName && CBLocale.currencyName(c)) || c;
    return esc(c) + (nm && nm !== c ? ' — ' + esc(nm) : '');
  };
  var optsOf = function (list) {
    return list
      .map(function (item) {
        return '<option value="' + esc(item) + '"' + (item === cur ? ' selected' : '') + '>' + label(item) + '</option>';
      })
      .join('');
  };

  /* ⚠️ regionInfo(), NOT a regionName() I remembered writing — it does not exist. locale.js exposes the
     whole record; the name is a field on it. */
  var _ri = CBLocale.regionInfo && CBLocale.regionInfo();
  var regionName = (_ri && _ri.name) || CBLocale.region();
  return (
    '<select data-cbsid="ACC002-S11" class="inp" id="loc-cur" style="margin:0;max-width:320px" onchange="localeSetCurrency(this.value)">' +
    (top.length ? '<optgroup label="' + esc(regionName ? tx('Used in') + ' ' + regionName : tx('In use')) + '">' + optsOf(top) + '</optgroup>' : '') +
    (rest.length ? '<optgroup label="' + esc(tx('All currencies')) + '">' + optsOf(rest) + '</optgroup>' : '') +
    '</select>'
  );
}

/**
 * ⚠⚠ THIS ONE WRITES TO THE SERVER, unlike every other setter on this screen — so it must survive a refusal.
 * The API bounds the value by the constitution and answers CURRENCY_NOT_ALLOWED with the permitted set named;
 * showing that message beats a silent revert, which is what a fire-and-forget save would have produced.
 */
async function localeSetCurrency(code) {
  var want = String(code || '').toUpperCase();
  if (!want) return;
  try {
    /* ⚠️ api() TAKES A REGISTERED KEY, NOT A PATH — api('saveProfile', {body}) is the house call; a raw path
       with {method} is a shape this codebase does not have. */
    await api('saveProfile', { body: { currency_code: want } });
    if (typeof SESSION !== 'undefined' && SESSION) SESSION.currency = want;
    UI._me = null;
    loadProfile(); /* re-read, exactly as saveProfile does */
    toast(txf('Prices are now written in {cur}', { cur: want }));
  } catch (err) {
    /* ⚠️ PUT THE OLD VALUE BACK ON THE SCREEN. A <select> that keeps showing the refused choice tells the
       reader it was accepted. */
    toast((err && err.message) || tx('That currency could not be set.'), 'err');
    UI._me = null;
    loadProfile();
  }
}

function _locPendingBar() {
  var list = UI._locStage || [];
  if (!list.length) return '';
  var Q = String.fromCharCode(39);
  var rowOf = function (o) {
    /* ⚠️ THE VALUE AS THE PICKER SHOWS IT, not the raw code. 'ca=indian' is the thing Athi could not read;
       repeating it in the confirmation would repeat the problem at the moment it matters most. */
    var v = o.args[o.args.length - 1];
    var shown = Array.isArray(v)
      ? v.length
        ? v.join(', ')
        : tx('follow the region')
      : o.fn === 'setExt'
        ? _locName(o.args[0] === 'nu' ? NUMERALS : o.args[0] === 'hc' ? HOURS : o.args[0] === 'ca' ? CALS : WEEK, v) +
          (_locSample(o.args[0], v) ? ' — ' + _locSample(o.args[0], v) : '')
        : v || tx('follow the region');
    return (
      '<div style="display:flex;gap:8px;padding:2px 0">' +
      '<b style="min-width:132px;font-size:var(--fs-1);color:var(--grey);text-transform:uppercase;letter-spacing:.04em">' +
      esc(o.what) +
      '</b><div style="flex:1;min-width:0">' +
      esc(shown) +
      '</div></div>'
    );
  };
  /* ⚠️ A SURFACE MUST NAME ITS TEXT COLOUR. guard-static flagged this: painting a background and letting
     the text inherit means the two themes can disagree — warn-tint is light in both, so dark-mode inherited
     ink would be pale text on a pale panel.

     ⚠️⚠️ AND THIS COMMENT USED TO SIT BETWEEN `return` AND ITS VALUE. A block comment containing a newline
     counts as a line terminator, so AUTOMATIC SEMICOLON INSERTION turned the statement into a bare `return;`
     — the bar below became unreachable, the function returned undefined, and `_locPendingBar() + body`
     rendered the literal word "undefined" at the top of the pane. Nothing threw and nothing logged.

     ⭐ THE UNSAVED-CHANGES BAR WAS THE ONE THING THAT COULD NOT AFFORD TO FAIL SILENTLY: staging still
     worked, so a change was held and never announced. You would edit a setting, see no confirmation, and
     reasonably conclude it had saved. A comment moved one line up is the whole fix. */
  return (
    '<div data-testid="loc-pending" style="position:sticky;top:0;z-index:3;background:var(--warn-tint);color:var(--on-card);' +
    'border:1px solid var(--warn-2);border-radius:9px;padding:10px 12px;margin-bottom:10px">' +
    '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;' +
    'color:var(--on-card);margin-bottom:6px">' +
    tx('Not saved yet') +
    '</div>' +
    list.map(rowOf).join('') +
    '<div style="display:flex;gap:8px;margin-top:9px">' +
    '<button data-cbsid="CMP001" class="btn pri" style="flex:1" onclick="localeSaveLocale()">' +
    tx('Save') +
    '</button>' +
    '<button data-cbsid="ACC002-B40" class="btn" style="flex:1" onclick="localeDiscardLocale()">' +
    tx('Discard') +
    '</button>' +
    '</div></div>'
  );
}

function localeSettingsHTML() {
  if (!UI._locStage || !UI._locStage.length) return _localeSettingsBody();
  var snap = CBLocale.snapshot();
  /* ⚠️ QUIETLY — a preview that pushed would sync a value nobody chose, and the rollback would be the only
     part that stayed local. See CBLocale.quietly. */
  return CBLocale.quietly(function () {
    /* ⚠️ THE BAR IS BUILT INSIDE THE PREVIEW, so its sample renders in the pending calendar too — a
       confirmation showing today's date in the OLD calendar would be describing what you are leaving. */
    try {
      _locReplay();
      return _locPendingBar() + _localeSettingsBody();
    } finally {
      CBLocale.restore(snap);
    }
  });
}

function _localeSettingsBody() {
  /* ⚠️ THE QUOTE IS BUILT HERE, NOT IN THE SCRIPT THAT WROTE THIS FILE. Third time: BT, then Q in the palette,
     now Q again. A generator-only constant emitted into shipped code PARSES fine and dies at render. The only
     check that catches it is running the function — which is what caught this one, before it shipped. */
  var Q = String.fromCharCode(39);
  var d = CBLocale.describe();

  /* The option lists and the two builders every card below uses. ⚠️ These were lost when the language/format
     blocks were replaced — the render harness caught it immediately, which is the whole reason it exists. */
  var FORMATS = [
    ['', 'Same as region'],
    ['en-IN', 'India — 12,34,56,789.50 (lakh · crore)'],
    ['en-US', 'United States — 123,456,789.50 (million)'],
    ['en-GB', 'United Kingdom — 123,456,789.50'],
    ['de-DE', 'Germany — 123.456.789,50'],
    ['fr-FR', 'France — 123 456 789,50'],
    ['ar-AE', 'UAE — Arabic, Western digits'],
    ['ar-EG', 'Egypt — Arabic, Eastern digits ١٢٣'],
    ['ja-JP', 'Japan — 123,456,789.50']
  ];

  var cur = CBLocale.getExt('locale'); /* CU3: the layer's own read, not a second one of its storage */
  var sel = function (id, list, val, fn) {
    return (
      '<select data-cbsid="ACC002-S12" class="inp" data-testid="' +
      id +
      '" onchange="' +
      fn +
      '(this.value)">' +
      /* ⚠️ ESCAPE THE VALUE TOO, not only the label. `o[0]` lands inside `value="…"` — an unescaped quote
         there closes the attribute and everything after it becomes markup. Every list passed here today is
         ours or the engine's, so nothing is exploitable right now; that is precisely why it would survive
         until the day someone passes a list built from stored data, which is one edit away on this screen. */
      list
        .map(function (item) {
          return '<option value="' + esc(item[0]) + '"' + (val === item[0] ? ' selected' : '') + '>' + esc(item[1]) + '</option>';
        })
        .join('') +
      '</select>'
    );
  };
  var card = function (inner) {
    return '<div style="' + _CARD + '">' + inner + '</div>';
  };
  var line = function (k, v) {
    return (
      '<div style="display:flex;gap:10px;padding:4px 0;font-size:var(--fs-2)">' +
      '<span style="min-width:108px;color:var(--grey)">' +
      k +
      '</span>' +
      '<b style="color:var(--on-card);min-width:0;word-break:break-word">' +
      v +
      '</b></div>'
    );
  };
  /* Working-day chips. ⚠️ ISO numbering (1 = Monday … 7 = Sunday) throughout, because that is what
     Intl.Locale.weekInfo returns — mixing it with Date.getDay()'s 0 = Sunday moves every due date by one. */
  var DAYFULL = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
  var work = CBLocale.workdays();
  var dayChips = [1, 2, 3, 4, 5, 6, 7]
    .map(function (item) {
      var on = work.indexOf(item) >= 0;
      return (
        '<button data-cbsid="ACC002-B41" type="button" data-testid="loc-day-' +
        item +
        '" onclick="localeToggleWorkday(' +
        item +
        ')"' +
        ' aria-pressed="' +
        (on ? 'true' : 'false') +
        '"' +
        ' style="cursor:pointer;font:inherit;border-radius:8px;padding:5px 10px;font-size:var(--fs-2);' +
        'border:1px solid ' +
        (on ? 'var(--ok)' : 'var(--line)') +
        ';' +
        'background:' +
        (on ? 'var(--ok-tint)' : 'var(--card)') +
        ';' +
        'color:' +
        (on ? 'var(--ok-2)' : 'var(--grey)') +
        ';font-weight:' +
        (on ? 700 : 500) +
        '">' +
        DAYFULL[item] +
        '</button>'
      );
    })
    .join('');

  /* ⚠️ The zone list comes from the ENGINE (Intl.supportedValuesOf), not a table we would have to edit twice a
     year. Where the engine will not supply one, a short list beats an empty select. */
  var tzCur = CBLocale.getExt('tz'); /* the override only ('' = the device's zone) — CBLocale.timezone() would fill the default */
  var tzAll = CBLocale.zones();
  /* ⚠️ esc() — the zone comes from localStorage (and, via b165, from a row another device wrote), so it is not
     ours to trust. Every OTHER render of it on this screen was escaped; this one label was not, which is exactly
     how one gets missed: the value LOOKS like a constant because it usually reads "Asia/Kolkata". */
  var tzOpts = [['', 'Follow this device — ' + esc(CBLocale.timezone())]].concat(
    (tzAll.length ? tzAll : ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'UTC']).map(function (item) {
      return [item, item.split('/').join(' / ')];
    })
  );

  var myCurCode = moneyCode();
  var wi = CBLocale.weekInfo() || {};
  var DAY = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };
  var weekend =
    (wi.weekend || [])
      .map(function (x) {
        return DAY[x] || x;
      })
      .join(' + ') || '—';

  /**
   * ⭐⭐ PRESENTATION AND LANGUAGE ARE NOW TWO SEPARATE CHOICES, AND THE FIRST BOUNDS THE SECOND.
   *
   * Athi, 2026-08-18: *"under locale, we have to split presentation style and languages separately… if the
   * language and the style contradicts then it will be a problem, so we have to specify, for this style, these
   * are the languages compatible out of which you can choose say two or three max."*
   *
   * ⚠️ Before this the screen offered four language buttons and nine formats as independent lists — 36
   * combinations, most of which no reader on earth wants. Arabic words with lakh grouping and a Buddhist
   * calendar was two clicks away and nothing said it was wrong.
   */
  var d = CBLocale.describe();
  var region = CBLocale.region();
  var chosen = CBLocale.langs();
  var allowed = CBLocale.allowedLangs();

  var regionOpts = [['', 'Not set — show me everything']].concat(
    Object.keys(CBLocale.REGIONS).map(function (item) {
      var r = CBLocale.REGIONS[item];
      return [
        item,
        r.name +
          ' — ' +
          r.format +
          ' · ' +
          r.langs
            .slice(0, 4)
            .map(function (x) {
              return CBLocale.langName(x);
            })
            .join(', ') +
          (r.langs.length > 4 ? ' …' : '')
      ];
    })
  );

  /**
   * ⚠️ A LANGUAGE IS A TOGGLE IN AN ORDERED LIST, NOT A RADIO. RFC 4647 calls this a language priority list —
   * "I read Tamil, then English, then Hindi" — and the ORDER is what decides which version of a catalogue a
   * reader is shown when several exist. So each chosen language carries its rank, visibly.
   */
  var langChips = allowed
    .map(function (code) {
      var at = chosen.indexOf(code);
      var on = at >= 0;
      var full = !on && chosen.length >= CBLocale.MAX_LANGS;
      return (
        '<button data-cbsid="ACC002-B42" type="button" data-testid="loc-lang-' +
        code +
        '"' +
        ' onclick="localeToggleLang(' +
        Q +
        code +
        Q +
        ')"' +
        ' aria-pressed="' +
        (on ? 'true' : 'false') +
        '"' +
        (full ? ' disabled' : '') +
        ' style="border:1px solid ' +
        (on ? 'var(--blue)' : 'var(--line)') +
        ';' +
        'background:' +
        (on ? 'var(--blue-tint-bg)' : 'var(--card)') +
        ';' +
        'color:' +
        (on ? 'var(--blue)' : full ? 'var(--grey-4)' : 'var(--on-card)') +
        ';' +
        'opacity:' +
        (full ? '.5' : '1') +
        ';cursor:' +
        (full ? 'not-allowed' : 'pointer') +
        ';' +
        'border-radius:9px;padding:5px 11px;font-size:var(--fs-2);font-weight:' +
        (on ? 700 : 500) +
        ';margin:0 6px 6px 0">' +
        (on ? '<b style="font-family:\'Space Mono\',monospace">' + (at + 1) + '</b> ' : '') +
        esc(CBLocale.langName(code)) +
        '</button>'
      );
    })
    .join('');

  return (
    _misHead('Localisation', '') +
    /* ── 1 · PRESENTATION ───────────────────────────────────────────────────────────────────────────────── */
    card(
      '<label class="fl">Presentation <span style="font-weight:400;color:var(--grey)">— how figures are written</span></label>' +
        sel('loc-region', regionOpts, region, 'localeSetRegion') +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px;line-height:1.55">' +
        'A region sets the number, money, date and time conventions <b>and the languages it makes sense to read ' +
        'in</b>. Choosing one prunes any language it does not admit, rather than leaving a combination that ' +
        'contradicts itself.<br>' +
        '⚠️ <b>' +
        tx('Grouping is not a separate switch, and that is deliberate.') +
        '</b> Millions or lakhs is a property of ' +
        'the region itself — CLDR knows India groups 12,34,56,789 and the US groups 123,456,789. Offering it ' +
        'apart would let you pick a combination no locale on earth uses.' +
        '</div>'
    ) +
    card(
      '<label class="fl">Or a format directly <span style="font-weight:400;color:var(--grey)">— if no region fits</span></label>' +
        sel('loc-format', FORMATS, cur, 'localeSetFormat')
    ) +
    /* ── 2 · LANGUAGES ──────────────────────────────────────────────────────────────────────────────────── */
    card(
      '<label class="fl">Languages you read <span style="font-weight:400;color:var(--grey)">— up to ' +
        CBLocale.MAX_LANGS +
        ', in order</span></label>' +
        '<div style="margin:4px 0 6px">' +
        langChips +
        '</div>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.55">' +
        'The <b>order matters</b>. When a catalogue exists in more than one language you are shown the highest ' +
        'one on this list that its author actually wrote. This is a <b>language priority list</b> (RFC 4647) — ' +
        'the same thing your browser sends every website as <code>' +
        tx('Accept-Language') +
        '</code>.' +
        (region ? '' : '<br>⚠️ No region set, so every language we name is offered. Pick a region above to see only the ones that fit.') +
        '</div>'
    ) +
    /* ⚠️⚠️ THE RULE THAT MATTERS MOST ON THIS SCREEN, RAISED FROM A FOOTNOTE TO ITS OWN CARD. Athi, twice:
       *"the panel and content in the panel, catalogue should stay in the language the origin is, no direct
       conversion at all."* Everything above chooses BETWEEN versions a human wrote. Nothing here produces text
       no human wrote, and that boundary is the reason a chit can be a shared record at all. */
    '<div style="' +
    _CARD +
    ';border-color:var(--warn-tint);background:var(--warn-tint);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--warn-2);margin-bottom:5px">' +
    tx('Content is never converted') +
    '</div>' +
    '<div style="font-size:var(--fs-2);line-height:1.6">' +
    'These settings change the <b>chrome</b> — labels, buttons, and how figures are written. They never touch ' +
    'what people wrote. A product name, a catalogue entry, a chit subject, a message and a dispute reason stay ' +
    'in the language their author used.<br>' +
    '<b>' +
    tx('Choosing a language picks between versions a human wrote — it does not translate anything.') +
    '</b> ' +
    'A chit is a shared record, and one that read differently to each party would not be a record.' +
    '</div>' +
    '</div>' +
    card(
      '<label class="fl">Numbering system <span style="font-weight:400;color:var(--grey)">— <code>-u-nu-</code></span></label>' +
        sel('loc-nu', _locWithSamples(NUMERALS, 'nu'), CBLocale.getExt('nu'), 'localeSetNu')
    ) +
    card(
      '<label class="fl">Hour cycle <span style="font-weight:400;color:var(--grey)">— <code>-u-hc-</code></span></label>' +
        sel('loc-hc', _locWithSamples(HOURS, 'hc'), CBLocale.getExt('hc'), 'localeSetHc')
    ) +
    card(
      '<label class="fl">Calendar <span style="font-weight:400;color:var(--grey)">— <code>-u-ca-</code></span></label>' +
        sel('loc-ca', _locWithSamples(CALS, 'ca'), CBLocale.getExt('ca'), 'localeSetCa')
    ) +
    card(
      '<label class="fl">First day of week <span style="font-weight:400;color:var(--grey)">— <code>-u-fw-</code></span></label>' +
        sel('loc-fw', WEEK, CBLocale.getExt('fw'), 'localeSetFw') +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:7px;line-height:1.55">' +
        'Which column a calendar starts on. Separate from which days you actually <i>work</i> — that is below.' +
        '</div>'
    ) +
    /* ══ WORKING DAYS ═══════════════════════════════════════════════════════════════════════════════════════
     * ⚠️⚠️ LOAD-BEARING, NOT A PREFERENCE. "Due in three working days" lands on a different DATE depending on
     * this, and until now the app had no idea. CLDR supplies the region's answer; a business overrides it
     * because a shop that opens on Sunday is a fact, not an error to be corrected. */
    card(
      '<label class="fl">Working days <span style="font-weight:400;color:var(--grey)">— what a due date counts</span></label>' +
        '<div data-testid="loc-workdays" style="display:flex;gap:5px;flex-wrap:wrap;margin:5px 0 7px">' +
        dayChips +
        '</div>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.55">' +
        (CBLocale.hasWorkdayOverride()
          ? 'You have set these yourself. <a data-cbsid="ACC002-C15" href="#" onclick="localeResetWorkdays();return false" data-testid="loc-workdays-reset" style="color:var(--blue)">' +
            tx('Use the regional default') +
            '</a> instead.'
          : 'These come from <b>' + tx('CLDR') + '</b> for your region — ' + esc(weekend) + ' is the weekend here. Tap a day to override.') +
        '<br>⚠️ <b>' +
        tx('The weekend is not Saturday and Sunday everywhere.') +
        "</b> Saudi Arabia's is Friday + Saturday; " +
        "India's is Sunday alone; the UAE moved to Saturday + Sunday in 2022. Any due date counted in " +
        '<i>working</i> days lands on a different day in Riyadh, Mumbai and Berlin.' +
        '</div>'
    ) +
    /* ══ TIME ZONE ══════════════════════════════════════════════════════════════════════════════════════════
     * ⚠️ One immutable event, three different answers to "when did this happen", because every date was rendered
     * in whatever zone the browser happened to be in. */
    card(
      '<label class="fl">' +
        tx('Time zone') +
        '</label>' +
        sel('loc-tz', tzOpts, tzCur, 'localeSetTz') +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px;line-height:1.55">' +
        'Now showing times in <b>' +
        esc(CBLocale.timezone()) +
        '</b>. ' +
        'A chit stamped 19:00 in Dubai reads 20:30 in Mumbai and 16:00 in London — the same instant, three ' +
        "answers. Leave this on your device unless you want your <i>business's</i> clock wherever you are." +
        '</div>'
    ) +
    /* ══ CURRENCY ═══════════════════════════════════════════════════════════════════════════
     * ⭐⭐ THE CONTROL LIVES HERE NOW — IT USED TO POINT AT THE PROFILE, AND THE PROFILE POINTED BACK. Athi,
     * 2026-08-21: *"why have we brought the currency to choose in profile? Let it be in settings only."* His
     * rule from the day before decides it: Settings changes, Profile shows.
     *
     * ⚠️ THIS IS THE ONE CONTROL ON THIS SCREEN THAT IS NOT YOURS. Everything else in Localisation is a reader
     * preference in this browser's storage; currency is a column on the business and changes what every
     * colleague and every counterparty sees. So it is gated to the entity and says whose it is — an employee
     * reads it, and reading is the correct amount of power over a company's trading currency.
     *
     * ⚠️ THE LIST IS GROUPED, NOT DUMPED. Athi, 2026-08-21: *"a small list is always good, human brain
     * cannot take multiple things in one go."* 162 codes in one flat menu is the failure he is describing, so
     * the region's own currency sits alone at the top and the rest are one <optgroup> below it — a list of one
     * for the answer that is almost always right, with everything still reachable.
     */
    card(
      '<label class="fl">' +
        tx('Currency') +
        '</label>' +
        '<div data-testid="loc-currency" style="font-size:var(--fs-2);line-height:1.6;color:var(--on-card)">' +
        (profCanEdit()
          ? _curPicker(myCurCode)
          : '<b>' +
            esc(myCurCode) +
            ' ' +
            esc(CBLocale.symbol(myCurCode)) +
            '</b> · ' +
            '<span style="color:var(--grey)">' +
            tx('set by the business') +
            '</span>') +
        '<div style="margin-top:7px;color:var(--grey)">' +
        tx('Your prices are written in this.') +
        ' ' +
        esc(CBLocale.money(123456.5, myCurCode)) +
        '</div>' +
        '<div style="margin-top:7px;color:var(--warn-2)">⚠️ ' +
        tx('Amounts are never converted.') +
        ' ' +
        '<span style="color:var(--grey)">' +
        tx('A supplier quoting in USD stays') +
        ' ' +
        esc(CBLocale.money(123456.5, 'USD')) +
        '.</span></div>' +
        '</div>'
    ) +
    /* THE PREVIEW — see the note on this function. Every control above is an abstraction; this is the only place
       the choice becomes visible before it is made. */
    '<div style="' +
    _CARD +
    ';background:var(--neutral-tint);color:var(--on-card)" data-testid="loc-preview">' +
    '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);margin-bottom:6px">' +
    tx('How this looks') +
    '</div>' +
    line('Number', esc(CBLocale.number(123456789.5))) +
    line('Money', esc(CBLocale.money(123456.5, 'INR')) + ' &nbsp;·&nbsp; ' + esc(CBLocale.money(123456.5, 'USD'))) +
    line('Date', esc(CBLocale.date(Date.now()))) +
    line('Time', esc(CBLocale.time(Date.now()))) +
    line('Sorting', esc(CBLocale.sort(['Zebra', 'Ähnlich', 'apple', 'Ökonom', 'banana']).join(' · '))) +
    line('Direction', d.dir === 'rtl' ? 'right to left ←' : 'left to right →') +
    line('Locale tag', '<code>' + esc(CBLocale.tag()) + '</code>') +
    '</div>' +
    card(
      '<div style="font-size:var(--fs-1);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--grey);margin-bottom:5px">' +
        tx('What is never translated') +
        '</div>' +
        '<div style="font-size:var(--fs-2);line-height:1.55;color:var(--on-card)">' +
        'Product names, chit subjects, message text and dispute reasons stay in the words their author wrote. ' +
        '<b>' +
        tx('A chit is a shared record') +
        '</b> — one that read differently to each party would not be a record.</div>'
    )
  );
}
/** Choosing a region sets the format AND prunes languages it does not admit — see the note in locale.js. */
/**
 * ⭐⭐ NOTHING APPLIES UNTIL SAVE. Athi, 2026-08-21: *"can we create a save button for each section if they
 * are going to change? So it is a deliberate change per item. This will not happen every day, but I believe
 * this will have a larger impact."*
 *
 * ⚠⚠ I FIRST ARGUED AGAINST THIS AND THE ARGUMENT HAD A HOLE. My reasoning was that these are reader
 * preferences in this browser — instantly visible, instantly reversible — so a Save button would make you
 * commit before you could see the result. What I left out is that every one of them is PUSHED to the account
 * through CBPrefs. A mis-click does not stay in this browser; it follows the person to every device they sign
 * in on. That is the larger impact, and it outweighs immediacy.
 *
 * ⭐ SO BOTH, RATHER THAN A TRADE. The card previews the pending choice live — you still see the date before
 * you keep it — and nothing leaves until Save.
 *
 * ⚠️ ONE BAR NAMING EVERY PENDING ITEM, NOT ONE BUTTON PER CARD. These controls are not independent:
 * choosing a region PRUNES languages it does not admit. A Save button on the Region card that committed only
 * the region would be claiming a separation the data does not have — and one that committed the language loss
 * too would be doing something its label did not say. The bar lists each pending change by name, which is the
 * per-item deliberateness Athi asked for, without inventing an independence these settings do not have.
 */
/**
 * ⭐ ONE STAGED CHANGE. The control does not apply — it records what it WOULD do, and the card repaints
 * showing that. Nothing reaches storage or the account until Save.
 *
 * ⚠️ OPERATIONS, NOT VALUES. setRegion() prunes languages the region does not admit; setWorkdays() refuses
 * to empty the week. Staging the VALUE and writing it at Save would skip those rules, so the preview would
 * show one outcome and the save produce another. Replaying the CALL is the only way the two agree.
 *
 * ⚠️ LAST WRITE PER CONTROL WINS. Picking three regions in a row must stage one change, not three — and a
 * replay of all three would be slower and, for setRegion, would prune against the intermediate ones.
 */
function _locStage(what, fn, args) {
  UI._locStage = (UI._locStage || []).filter(function (item) {
    /* setExt is four controls sharing one function — they are the same control only if the subtag matches. */
    return item.fn !== fn || (fn === 'setExt' && item.args[0] !== args[0]);
  });
  UI._locStage.push({ what: what, fn: fn, args: args });
  loadSettings(); /* ⚠️ the CARD repaints; renderApp() deliberately does not run — see the wrapper. */
}

function _locReplay() {
  (UI._locStage || []).forEach(function (item) {
    CBLocale[item.fn].apply(CBLocale, item.args);
  });
}

/** What is waiting, named — so the Save button can say what it is about to do. */
function _locPending() {
  var seen = [];
  (UI._locStage || []).forEach(function (item) {
    if (seen.indexOf(item.what) < 0) seen.push(item.what);
  });
  return seen;
}

/**
 * ⚠️ UNDO SURVIVES THE SAVE, and it is not redundant with staging. Staging stops the ACCIDENT — a stray
 * click on a dropdown. Undo covers the DELIBERATE change that turned out wrong once you saw the whole app in
 * it. Different mistakes, different moments.
 */
function localeSaveLocale() {
  var pending = _locPending();
  if (!pending.length) return;
  var before = CBLocale.snapshot();
  _locReplay();
  UI._locStage = [];
  renderApp();
  _capShowDetail();
  loadSettings();
  toast(txf('{what} saved', { what: pending.join(', ') }), function () {
    CBLocale.restore(before);
    renderApp();
    _capShowDetail();
    loadSettings();
    toast(txf('{what} put back', { what: pending.join(', ') }));
  });
}

function localeDiscardLocale() {
  if (!(UI._locStage || []).length) return;
  UI._locStage = [];
  loadSettings();
  toast(tx('Nothing was changed.'));
}

function localeSetTz(v) {
  _locStage(tx('Time zone'), 'setTimezone', [v]);
}
/**
 * ⚠️ THE LAST WORKING DAY CANNOT BE REMOVED. A business with no working days has no due dates at all, and every
 * SLA calculation would divide by an empty week — a state the UI should refuse rather than the maths discover.
 */
/**
 * ⚠⚠ A TOGGLE READS BEFORE IT WRITES, SO IT MUST READ THE STAGED LIST. CBLocale.workdays() and .langs()
 * return what is SAVED. Untick Saturday, then untick Friday: the second call would still see Saturday and
 * hand it back, so the first click would silently undo itself. The single-value pickers escape this because
 * they overwrite; a toggle accumulates, and accumulating onto a stale base loses every click but the last.
 */
function _locStaged(fn, live) {
  var last = null;
  (UI._locStage || []).forEach(function (item) {
    if (item.fn === fn) last = item;
  });
  return last ? last.args[0].slice() : live();
}

function localeToggleWorkday(n) {
  var list = _locStaged('setWorkdays', function () {
      return CBLocale.workdays();
    }),
    at = list.indexOf(n);
  if (at >= 0) {
    if (list.length > 1) list.splice(at, 1);
  } else list.push(n);
  _locStage(tx('Working days'), 'setWorkdays', [list]);
}
/** Clearing the override returns to CLDR's answer for the region — not to a hardcoded Mon–Fri. */
function localeResetWorkdays() {
  _locStage(tx('Working days'), 'setWorkdays', [[]]);
}
function localeSetRegion(v) {
  _locStage(tx('Region'), 'setRegion', [v]);
}
/**
 * ⚠️ APPEND, DO NOT REPLACE — the list is ORDERED and the order is the feature. Toggling a language on puts it
 * last (lowest priority); toggling it off closes the gap. Reordering by re-selecting is a smaller, separate
 * design problem, and pretending a toggle could express rank would have made the order silently arbitrary.
 * ⚠️ The last remaining language cannot be removed: a reader with no languages matches nothing at all.
 */
function localeToggleLang(code) {
  var list = _locStaged('setLangs', function () {
      return CBLocale.langs();
    }),
    at = list.indexOf(code);
  if (at >= 0) {
    if (list.length > 1) list.splice(at, 1);
  } else if (list.length < CBLocale.MAX_LANGS) list.push(code);
  _locStage(tx('Languages'), 'setLangs', [list]);
}
function localeSetFormat(v) {
  _locStage(tx('Format'), 'setLocale', [v]);
}
/* One handler shape per subtag — each re-renders so the preview above moves with the choice. */
function localeSetNu(v) {
  _locStage(tx('Numbering system'), 'setExt', ['nu', v]);
}
function localeSetHc(v) {
  _locStage(tx('Hour cycle'), 'setExt', ['hc', v]);
}
function localeSetCa(v) {
  _locStage(tx('Calendar'), 'setExt', ['ca', v]);
}
function localeSetFw(v) {
  _locStage(tx('First day of week'), 'setExt', ['fw', v]);
}

/**
 * ⭐ INTEGRATIONS — API KEYS FOR OTHER SYSTEMS. Athi, 2026-09-05: "create the entire offer as a capability and attach it to
 * any other systems". A key is minted here, shown ONCE, scoped (offers today), listed with its last four characters,
 * revocable in one press. The services it opens: /api/offers kinds · evaluate · explain; the contract at
 * /api/offers/openapi.json. Only a signed-in person mints or revokes — a key cannot breed.
 */
var _KEYS,
  _KEY_SHOWN = ''; /* the minted key, shown once — survives the list repaint, cleared on the next mint/revoke/leave */
var _INT_CAT, _INT_RUN, _INT_MAP; /* the connector catalogue, the connectors that have checked in, the profile map — lazy, like the keys */
/**
 * ⭐ THE PROFILE MAP (Athi, 2026-09-05: "do we have a map of what we look for, how do we fill it, what is the authenticity?").
 * One row per field we look for: the value we hold, where it came from (typed · Tally · Zoho · a file · derived from the
 * GSTIN), when, and its rung — declared · copied · checked · verified — plus any check that failed (a GSTIN whose check
 * digit is wrong, a PIN in another state). The connector's sync-profile fills it; a higher rung is never overwritten.
 */
function intProfileMapHTML() {
  if (_INT_MAP === undefined) {
    _INT_MAP = null;
    api('intProfileMap')
      .then(function (reply) {
        _INT_MAP = reply || {};
        if (setSec() === 'integrations') loadSettings();
      })
      .catch(function () {
        _INT_MAP = {};
        if (setSec() === 'integrations') loadSettings();
      });
  }
  var m = _INT_MAP;
  if (!m || !m.fields)
    return (
      '<div style="' +
      _CARD +
      '"><div class="sec" style="margin:0 0 6px">' +
      tx('The store, as we know it') +
      '</div><div style="color:var(--grey)">' +
      tx(m === null ? 'reading…' : 'no map') +
      '</div></div>'
    );
  var rungStyle = {
    declared: 'background:var(--warn-tint);color:var(--warn-2)',
    copied: 'background:var(--blue-tint);color:var(--blue-2)',
    checked: 'background:var(--ok-tint);color:var(--ok-2)',
    verified: 'background:var(--ok-2);color:var(--on-ok)'
  }; /* ⚠️ was #fff on a THEMED ground — the text vanishes in any theme that lightens --ok-2 (guard-static, 2026-09-27); --on-ok is the token for ink on the ok colour */
  var rows = (m.order || [])
    .map(function (item) {
      var f = m.fields[item] || {};
      var src = f.source ? String(f.source) : '';
      var when = f.as_of ? String(f.as_of).slice(0, 10) : '';
      return (
        '<tr data-testid="int-map-' +
        esc(item) +
        '"><td style="padding:5px 8px;border-top:1px solid var(--line)"><b>' +
        esc(f.label || item) +
        '</b><div style="font-size:var(--fs-1);color:var(--grey)">' +
        esc(f.why || '') +
        '</div></td>' +
        '<td style="padding:5px 8px;border-top:1px solid var(--line);font-family:monospace">' +
        (f.value != null ? esc(String(f.value)) : '<span style="color:var(--warn-3)">' + esc(tx('missing')) + '</span>') +
        (f.issues && f.issues.length ? '<div style="color:var(--warn-3);font-size:var(--fs-1)">⚠ ' + esc(f.issues.join('; ')) + '</div>' : '') +
        '</td>' +
        '<td style="padding:5px 8px;border-top:1px solid var(--line);font-size:var(--fs-1);color:var(--grey)">' +
        esc(src) +
        (when ? ' · ' + esc(when) : '') +
        '<div>' +
        esc(f.sources && (f.sources.tally || '') ? intWhereFrom(f, src) : '') +
        '</div></td>' +
        '<td style="padding:5px 8px;border-top:1px solid var(--line)">' +
        (f.rung
          ? '<span data-testid="int-map-rung-' +
            esc(item) +
            '" style="font-size:var(--fs-1);font-weight:800;border-radius:5px;padding:1px 6px;' +
            (rungStyle[f.rung] || '') +
            '">' +
            esc(f.rung) +
            '</span>'
          : '') +
        '</td></tr>'
      );
    })
    .join('');
  return (
    '<div style="' +
    _CARD +
    '"><div class="sec" style="margin:0 0 6px">' +
    tx('The store, as we know it') +
    ' <span style="font-weight:400;color:var(--grey);font-size:var(--fs-1)">' +
    esc(String(m.filled || 0) + ' ' + tx('of') + ' ' + String(m.total || 0) + ' ' + tx('filled')) +
    (m.state_name ? ' · ' + esc(m.state_name) : '') +
    '</span></div>' +
    '<div style="font-size:var(--fs-2);margin-bottom:6px">' +
    tx(
      'What we look for, where it came from, and how far it is trusted: declared (typed) → copied (from your own system, with source and date) → checked (the GSTIN check digit, PAN and state agree) → verified (the registry). A connector fills it with sync-profile; a higher rung is never overwritten.'
    ) +
    '</div>' +
    '<div style="overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:var(--fs-2)"><thead><tr><th style="text-align:start;padding:4px 8px">' +
    tx('Field') +
    '</th><th style="text-align:start;padding:4px 8px">' +
    tx('Value') +
    '</th><th style="text-align:start;padding:4px 8px">' +
    tx('Source · when') +
    '</th><th style="text-align:start;padding:4px 8px">' +
    tx('Rung') +
    '</th></tr></thead><tbody>' +
    rows +
    '</tbody></table></div></div>'
  );
}
/* ⭐ THE HANDSHAKE ON THE ROW (Athi, 2026-09-06): a connector is approved for ONE PC. The row says which PC and which Tally company asked,
   and why it waits; Approve is the owner's act, Reject revokes the key (the kit stops at its next call). */
/** ⭐ where this field lives in the system that filled it — Tally, Zoho, GoFrugal or a CSV column (2026-09-07) */
function intWhereFrom(f, src) {
  var srcs = (f && f.sources) || {};
  var key = String(src || '').toLowerCase();
  var named = { tally: 'Tally', zoho: 'Zoho Books', csv: 'CSV', gofrugal: 'GoFrugal' };
  var pick = srcs[key] ? key : Object.keys(srcs)[0] || '';
  if (!pick || !srcs[pick]) return '';
  return (named[pick] || pick) + ': ' + srcs[pick];
}
function intEnrolHTML(r) {
  var e = r.enrol;
  if (!e) return '';
  var facts = [e.host, e.company, e.gstin].filter(Boolean).map(esc).join(' · ');
  if (e.approved === false)
    return (
      '<div style="font-weight:400;font-size:var(--fs-1);margin-top:3px"><span style="color:var(--warn-2);font-weight:700">⚠ ' +
      tx('waiting for approval') +
      '</span> — ' +
      facts +
      (e.reason ? ' <span style="color:var(--grey)">(' + esc(e.reason) + ')</span>' : '') +
      '<div style="display:flex;gap:6px;margin-top:5px"><button data-cbsid="ACC002-B43" class="composebtn" data-testid="int-approve-' +
      esc(r.actor_id) +
      '" onclick="intApprove(\'' +
      esc(r.actor_id) +
      '\')">✓ ' +
      tx('Approve this PC') +
      '</button>' +
      (r.key_jti ? '<button data-cbsid="ACC002-B44" class="btn2" onclick="intReject(\'' + esc(r.key_jti) + '\')">' + tx('Reject') + '</button>' : '') +
      '</div></div>'
    );
  return '<div style="font-weight:400;font-size:var(--fs-1);color:var(--ok-2);margin-top:3px">✓ ' + tx('approved') + (facts ? ' · ' + facts : '') + '</div>';
}
async function intApprove(id) {
  try {
    await api('intApprove', { params: { id: id } });
    toast(tx('Approved — the connector starts within a minute.'));
    _INT_RUN = undefined;
    loadSettings();
  } catch (e) {
    toast(tx('Could not approve') + ': ' + ((e && e.message) || e));
  }
}
async function intReject(jti) {
  try {
    await api('keysRevoke', { params: { jti: jti } });
    toast(tx('Key revoked — that kit can no longer connect.'));
    _INT_RUN = undefined;
    _KEYS = undefined;
    loadSettings();
  } catch (e) {
    toast(tx('Could not revoke') + ': ' + ((e && e.message) || e));
  }
}

/** the kit through the session (kitDownload, app/cap-settings.js — the one fetch); the workshop says the outcome in a toast */
async function intDownloadKit(id, adapter) {
  try {
    await kitDownload(id, adapter);
    toast(tx('Downloaded — your key is inside. Unzip on the Tally PC and double-click start.cmd.'));
    _INT_RUN = undefined; /* the new key shows under Your keys on the next paint */
  } catch (e) {
    toast(tx('Could not download') + ': ' + ((e && e.message) || e));
  }
}
/**
 * ⭐ THE HOME OF CONNECTORS (Athi, 2026-09-05: "include the tally connector as a downloadable option in the system itself …
 * all should reside as part of Integrations; if we build more, it should stay there"). The catalogue comes from the API
 * (routes/integrations.js CATALOGUE) so a new connector appears here the day it is built; the download is a zip of the kit
 * with connector.json pre-filled for THIS API and adapter — the key stays empty, a secret never rides a link.
 */
/** what this connector carries — the streams it owns (2026-09-07). Silent until the ownership map has been read. */
/** the OTHER system's health as of this connector's last run — "live" says the connector checked in, never that Tally answered. */
function intSourceHTML(r) {
  var sc = r.source;
  if (!sc || sc.ok === null || sc.ok === undefined) return '';
  var when = sc.at ? fmtDateTime(sc.at) : '';
  var sys = r.adapter || tx('the other system');
  if (sc.ok)
    return (
      '<div style="width:100%;font-size:var(--fs-1);color:var(--ok-2)" data-testid="int-source-' +
      esc(r.id) +
      '">✓ ' +
      esc(txf('{sys} answered', { sys: sys })) +
      (when ? ' · ' + esc(when) : '') +
      '</div>'
    );
  return (
    '<div style="width:100%;font-size:var(--fs-1);color:var(--warn-3)" data-testid="int-source-' +
    esc(r.id) +
    '">⚠ ' +
    esc(txf('{sys} did not answer', { sys: sys })) +
    (when ? ' · ' + esc(when) : '') +
    (sc.why ? ' · ' + esc(sc.why) : '') +
    ' — ' +
    tx('the connector keeps trying and starts by itself when it comes back') +
    '</div>'
  );
}
/** from a running row to that system's own card — the instructions live in one place (2026-09-07) */
function intToSetup(id) {
  UI.intOpen = id;
  lsSet('cb_int_open', id);
  intSetTab('connectors');
}
function intCarriesHTML(r) {
  var d = _INT_STR;
  if (!d || !d.owner) return '';
  var mine = (d.streams || []).filter(function (item) {
    return d.owner[item.id] === r.id;
  });
  if (!mine.length)
    return (
      '<div style="width:100%;font-size:var(--fs-1);color:var(--warn-2)" data-testid="int-carries-' +
      esc(r.id) +
      '">' +
      tx('carries nothing — every stream it can carry belongs to another connector') +
      '</div>'
    );
  return (
    '<div style="width:100%;font-size:var(--fs-1);color:var(--grey)" data-testid="int-carries-' +
    esc(r.id) +
    '">' +
    esc(tx('carries')) +
    ': ' +
    mine
      .map(function (item) {
        return esc(tx(item.label));
      })
      .join(' · ') +
    '</div>'
  );
}
function intConnectorsHTML() {
  if (_INT_CAT === undefined) {
    _INT_CAT = null;
    api('intCatalogue')
      .then(function (reply) {
        _INT_CAT = (reply && reply.connectors) || [];
        if (setSec() === 'integrations') loadSettings();
      })
      .catch(function () {
        _INT_CAT = [];
        if (setSec() === 'integrations') loadSettings();
      });
  }
  if (_INT_RUN === undefined) {
    _INT_RUN = null;
    api('intStatus')
      .then(function (reply) {
        _INT_RUN = (reply && reply.connectors) || [];
        if (setSec() === 'integrations') loadSettings();
      })
      .catch(function () {
        _INT_RUN = [];
        if (setSec() === 'integrations') loadSettings();
      });
  }
  var base = (typeof CFG !== 'undefined' && CFG.API_BASE) || '';
  var list = _INT_CAT || [],
    run = _INT_RUN || [];
  var use = intInUse();
  var chosen = use.length
    ? list.filter(function (item) {
        return use.indexOf(item.id) >= 0;
      })
    : list;
  var rest = use.length
    ? list.filter(function (item) {
        return use.indexOf(item.id) < 0;
      })
    : [];
  var cards = list.length
    ? chosen
        .map(function (item) {
          /* ⭐ through the session, not a bare link: the API mints a connector key INTO the zip's connector.json (Athi, 2026-09-06: "download option should autofill everything") */
          /* CX6 (K1): the SERVER says whether this connector works for the shop's country (may/why from the pack) — a refused one stays shown, greyed WITH its sentence */
          var may = item.may || { ok: true },
            no = may.ok === false;
          var adapters = (item.adapters || [])
            .map(function (a) {
              return (
                '<button data-cbsid="ACC002-B45" class="composebtn" data-testid="int-download-' +
                esc(item.id) +
                '-' +
                esc(a) +
                '"' +
                (no
                  ? ' disabled aria-disabled="true" title="' + esc(may.why || '') + '" style="opacity:.55;cursor:not-allowed"'
                  : ' onclick="intDownloadKit(\'' + esc(item.id) + "','" + esc(a) + '\')"') +
                '>⬇ ' +
                esc(tx('Download')) +
                ' · ' +
                esc(a) +
                '</button>'
              );
            })
            .join(' ');
          var open = intOpen() === item.id;
          var nestedMore =
            '<span data-cbsid="ACC002-C16" data-testid="int-card-' +
            esc(item.id) +
            '-toggle" onclick="intToggleCard(\'' +
            esc(item.id) +
            '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);user-select:none">' +
            (open ? '▾ ' + tx('less') : '▸ ' + txf('what to do for {name}', { name: item.name })) +
            '</span>';
          var steps = open ? intCardDetailHTML(item) : '';
          var doc = item.docs
            ? '<a href="' +
              esc(base + item.docs) +
              '" target="_blank" rel="noopener" data-testid="int-docs-' +
              esc(item.id) +
              '" style="font-size:var(--fs-1);color:var(--blue)">📄 ' +
              esc(tx('Instructions')) +
              '</a>'
            : '';
          var tick =
            '<label style="display:inline-flex;gap:5px;align-items:center;font-size:var(--fs-1);color:var(--grey);cursor:pointer"><input data-cbsid="ACC002-I20" type="checkbox" data-testid="int-use-' +
            esc(item.id) +
            '"' +
            (use.indexOf(item.id) >= 0 ? ' checked' : '') +
            ' onchange="intUseToggle(\'' +
            esc(item.id) +
            '\', this.checked)">' +
            esc(tx('we use this')) +
            '</label>';
          return (
            '<div data-testid="int-connector-' +
            esc(item.id) +
            '" style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="flex:1">' +
            esc(item.name) +
            '</b>' +
            tick +
            ' ' +
            doc +
            ' ' +
            adapters +
            '</div>' +
            '<div style="font-size:var(--fs-2);margin-top:6px">' +
            esc(item.does) +
            '</div>' +
            (no
              ? '<div data-testid="int-why-' +
                esc(item.id) +
                '" style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' +
                esc(may.why || '') +
                '</div>'
              : '') +
            '<div style="margin-top:6px">' +
            nestedMore +
            '</div>' +
            (open
              ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' +
                esc(tx('Runs on')) +
                ': ' +
                esc(item.runs_on) +
                ' · ' +
                esc(item.status) +
                '</div>'
              : '') +
            steps +
            '</div>'
          );
        })
        .join('')
    : '<div style="color:var(--grey)">' + tx(_INT_CAT === null ? 'reading…' : 'No connectors published yet.') + '</div>';
  var rows = run.length
    ? run
        .map(function (item) {
          var ago = item.last_seen ? Math.round((Date.now() - new Date(item.last_seen).getTime()) / 60000) : null;
          var c = item.counters || {};
          return (
            '<div data-testid="int-running-' +
            esc(item.id) +
            '" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line);font-size:var(--fs-2)"><b style="flex:1">' +
            esc(item.name) +
            intEnrolHTML(item) +
            '</b><span style="color:var(--grey);font-size:var(--fs-1)">' +
            esc(item.adapter || '') +
            ' · ' +
            esc(item.host || '') +
            ' · ' +
            (ago == null ? '' : ago < 1 ? tx('just now') : txf('{n} min ago', { n: String(ago) })) +
            ' · ' +
            esc(tx('products')) +
            ' ' +
            esc(String(c.products_ok || 0)) +
            ' · ' +
            esc(tx('orders')) +
            ' ' +
            esc(String(c.orders_ok || 0)) +
            (c.receipts_ok ? ' · ' + esc(tx('receipts')) + ' ' + esc(String(c.receipts_ok)) : '') +
            (c.failed ? ' · <span style="color:var(--warn-3)">' + esc(tx('failed')) + ' ' + esc(String(c.failed)) + '</span>' : '') +
            (item.note ? ' · ' + esc(item.note) : '') +
            ' · <span data-cbsid="ACC002-C17" data-testid="int-row-help-' +
            esc(item.id) +
            '" onclick="intToSetup(\'' +
            esc(item.adapter || '') +
            '\')" style="cursor:pointer;color:var(--blue)">' +
            esc(txf('what to do for {name}', { name: item.adapter || 'this' })) +
            '</span></span>' +
            intSourceHTML(item) +
            intCarriesHTML(item) +
            '</div>'
          );
        })
        .join('')
    : '<div style="color:var(--grey);font-size:var(--fs-2)">' +
      tx(_INT_RUN === null ? 'reading…' : 'None has checked in yet — a connector reports here each time it runs, and every five minutes while it watches.') +
      '</div>';
  if (intTab() === 'running')
    return (
      '<div style="' +
      _CARD +
      '"><div class="sec" style="margin:0 0 6px">' +
      tx('Running connectors') +
      '</div>' +
      intFold('running', [
        'One row per connector that has checked in.',
        'It reports every run, and every five minutes while it watches.',
        '"Answered" is the other system. "Live" is only the connector itself.',
        'Approve a PC once — a kit is approved for one PC at a time.'
      ]) +
      rows +
      '</div>'
    );
  var more = rest.length
    ? '<div style="margin-top:10px;font-size:var(--fs-1);color:var(--grey)" data-testid="int-rest">' +
      esc(
        txf('{n} you do not use: {names}', {
          n: String(rest.length),
          names: rest
            .map(function (item) {
              return item.name;
            })
            .join(', ')
        })
      ) +
      ' — ' +
      tx('tick "we use this" on one to bring it back') +
      '</div>'
    : '';
  return (
    '<div style="' +
    _CARD +
    '"><div class="sec" style="margin:0 0 6px">' +
    tx('Connectors') +
    '</div>' +
    intFold('connectors', [
      'A small program that runs beside your own system — Tally, Zoho, a folder of files.',
      'It carries products and stock up, offers back, and orders down as vouchers.',
      'Download, unzip, double-click start.cmd. Your key is already inside.'
    ]) +
    cards +
    more +
    '</div>'
  );
}
/**
 * ⭐⭐ INTEGRATIONS, ONE QUESTION PER PANE (Athi, 2026-09-07: "the integration screen is overwhelming … it takes time to digest").
 * The rail expands these under Integrations exactly as it expands Governance's layers — no new control to learn — and each pane answers
 * one question: what can I attach · who is checked in · who carries what · did it land · what do the books say about me · what other
 * systems sign in with.
 */
var INT_TABS = [
  { key: 'connectors', n: 'Connectors', q: 'what you can attach' },
  { key: 'running', n: 'Running', q: 'who is checked in, and is the other system answering' },
  { key: 'streams', n: 'Who owns what', q: 'one owner per stream' },
  { key: 'books', n: 'In the books', q: 'did it land, and what is late' },
  { key: 'store', n: 'The store', q: 'what your own books say about you' },
  { key: 'netoffers', n: 'Network offers', q: 'offers a brand releases to its stores, and which ones each store takes' },
  { key: 'counters', n: 'Counters', q: 'every till on your shop \u2014 where it is, when it last spoke' },
  { key: 'keys', n: 'Keys & services', q: 'what other systems sign in with' }
];
function intOpen() {
  return UI.intOpen !== undefined ? UI.intOpen : lsGet('cb_int_open', '');
}
function intToggleCard(id) {
  var next = intOpen() === id ? '' : id;
  UI.intOpen = next;
  lsSet('cb_int_open', next);
  loadSettings();
}
/** the four things a person needs about ONE system, in its own card (2026-09-07) */
function intCardDetailHTML(c) {
  var group = function (title, lines) {
    if (!lines || !lines.length) return '';
    return (
      '<div style="margin-top:8px"><div style="font-size:var(--fs-1);font-weight:700;color:var(--grey);text-transform:uppercase;letter-spacing:.04em">' +
      esc(tx(title)) +
      '</div>' +
      '<ul style="margin:3px 0 0;padding-inline-start:18px;font-size:var(--fs-2)">' +
      lines
        .map(function (item) {
          return '<li style="margin:2px 0">' + esc(tx(item)) + '</li>';
        })
        .join('') +
      '</ul></div>'
    );
  };
  return (
    '<div data-testid="int-detail-' +
    esc(c.id) +
    '" style="border-top:1px solid var(--line);margin-top:8px;padding-top:2px">' +
    group('Before you start', c.needs) +
    group('What to do', c.steps) +
    group('If it does not work', c.watch_out) +
    group('Once it runs, look here', [
      'Running — is it checked in, and did ' + (c.default_adapter || c.id) + ' answer it',
      'Who owns what — which streams this connector carries',
      'In the books — whether each order reached it, and what is late'
    ]) +
    '</div>'
  );
}
function intTab() {
  var k = UI.intTab || lsGet('cb_int_tab', 'connectors');
  return INT_TABS.some(function (item) {
    return item.key === k;
  })
    ? k
    : 'connectors';
}
/* ⚠️ THE RAIL IS PART OF THE PAINT (Athi, 2026-09-07: "when I click the submenu the details change on the right, but the menu marked
   in a different colour does not change"). loadSettings() repaints the BODY only, so the highlight stayed on the old row — the same
   reason govSetTab calls renderApp() first. Copying that, rather than inventing a second way to move a selection. */
function intSetTab(k) {
  UI.intTab = k;
  lsSet('cb_int_tab', k);
  if (typeof renderApp === 'function') renderApp();
  loadSettings();
}
/** ⭐ the prose folds, and stays folded — an explanation is worth reading once, not on every visit (2026-09-07) */
function intFold(key, lines) {
  var open = lsGet('cb_fold_' + key, '1') === '1';
  var list = (Array.isArray(lines) ? lines : [lines])
    .map(function (item) {
      return '<li style="margin:2px 0">' + esc(tx(item)) + '</li>';
    })
    .join('');
  return (
    '<div style="font-size:var(--fs-2);margin-bottom:6px">' +
    '<span data-cbsid="ACC002-C18" data-testid="int-fold-' +
    esc(key) +
    '" onclick="intFoldToggle(\'' +
    esc(key) +
    '\')" style="cursor:pointer;color:var(--grey);font-size:var(--fs-1);user-select:none">' +
    (open ? '▾ ' + tx('less') : '▸ ' + tx('what this is')) +
    '</span>' +
    (open ? '<ul style="margin:4px 0 0;padding-inline-start:18px">' + list + '</ul>' : '') +
    '</div>'
  );
}
function intFoldToggle(key) {
  lsSet('cb_fold_' + key, lsGet('cb_fold_' + key, '1') === '1' ? '0' : '1');
  loadSettings();
}
/** ⭐ which systems this account actually runs. A DISPLAY choice, not a connection: it puts them first and folds the rest away. */
function intInUse() {
  var list = ((typeof SESSION !== 'undefined' && SESSION.policy_flags) || {}).connectors_in_use;
  return Array.isArray(list)
    ? list.filter(function (x) {
        return x !== 'none';
      })
    : [];
}
async function intUseToggle(id, on) {
  var now = intInUse().filter(function (x) {
    return x !== id;
  });
  if (on) now.push(id);
  try {
    var reply = await api('policySet', { body: { connectors_in_use: now.length ? now : ['none'] } });
    if (typeof SESSION !== 'undefined')
      SESSION.policy_flags = (reply && reply.flags) || Object.assign({}, SESSION.policy_flags || {}, { connectors_in_use: now });
    loadSettings();
  } catch (e) {
    toast(tx('Could not save') + ': ' + ((e && e.message) || e));
  }
}

/**
 * ⭐⭐ WHO OWNS WHICH STREAM (Athi, 2026-09-07: "say quantity gets posted in ERP, sales record in Tally and possibly Zoho CRM — will it
 * not confuse the purpose?"). Many systems on one account is a real setup; many systems on one STREAM is not. The first connector to
 * carry a stream claims it, so an account with one system is never asked a question — this card is where a migration hands one over.
 */
var _INT_STR;
function intStreamsHTML() {
  if (_INT_STR === undefined) {
    _INT_STR = null;
    api('intStreams')
      .then(function (reply) {
        _INT_STR = reply || {};
        if (setSec() === 'integrations') loadSettings();
      })
      .catch(function () {
        _INT_STR = { error: true };
        if (setSec() === 'integrations') loadSettings();
      });
  }
  var d = _INT_STR || {};
  var list = d.streams || [],
    own = d.owner || {},
    con = d.connectors || [];
  if (_INT_STR === null)
    return (
      '<div style="' +
      _CARD +
      '"><div class="sec" style="margin:0 0 6px">' +
      tx('Who owns what') +
      '</div><div style="color:var(--grey);font-size:var(--fs-2)">' +
      tx('reading…') +
      '</div></div>'
    );
  var nameOf = function (id) {
    var c = con.find(function (x) {
      return x.id === id;
    });
    return c ? c.name + ' · ' + (c.adapter || '') : id;
  };
  var body;
  if (!con.length)
    body =
      '<div style="color:var(--grey);font-size:var(--fs-2)">' +
      tx('No connector has checked in yet. The first one to run claims the streams it can carry.') +
      '</div>';
  else if (con.length === 1 && Object.keys(own).length)
    body =
      '<div style="font-size:var(--fs-2)" data-testid="int-streams-single">' +
      txf('{name} carries everything.', { name: con[0].name }) +
      ' ' +
      tx('A second connector claims only what is still free, and this is where you would hand a stream over.') +
      '</div>';
  else
    body =
      '<div style="overflow:auto"><table style="border-collapse:collapse;width:100%;font-size:var(--fs-2)"><thead><tr>' +
      '<th style="text-align:start;padding:4px 8px">' +
      tx('Stream') +
      '</th><th style="text-align:start;padding:4px 8px">' +
      tx('What travels') +
      '</th><th style="text-align:start;padding:4px 8px">' +
      tx('Carried by') +
      '</th></tr></thead><tbody>' +
      list
        .map(function (item) {
          var sel =
            '<select data-cbsid="ACC002-S13" class="inp" data-testid="int-stream-' +
            esc(item.id) +
            '" onchange="intStreamSet(\'' +
            esc(item.id) +
            '\', this.value)">' +
            '<option value="">' +
            esc(tx('nobody')) +
            '</option>' +
            con
              .map(function (c) {
                return '<option value="' + esc(c.id) + '"' + (own[item.id] === c.id ? ' selected' : '') + '>' + esc(nameOf(c.id)) + '</option>';
              })
              .join('') +
            (own[item.id] &&
            !con.find(function (c) {
              return c.id === own[item.id];
            })
              ? '<option value="' + esc(own[item.id]) + '" selected>' + esc(own[item.id]) + ' (' + esc(tx('not running')) + ')</option>'
              : '') +
            '</select>';
          return (
            '<tr><td style="padding:5px 8px;border-top:1px solid var(--line)"><b>' +
            esc(tx(item.label)) +
            '</b><div style="font-size:var(--fs-1);color:var(--grey)">' +
            esc(item.dir === 'in' ? tx('into the network') : tx('out to the other system')) +
            '</div></td>' +
            '<td style="padding:5px 8px;border-top:1px solid var(--line);font-size:var(--fs-1);color:var(--grey)">' +
            esc(tx(item.what)) +
            '</td>' +
            '<td style="padding:5px 8px;border-top:1px solid var(--line)">' +
            sel +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>';
  return (
    '<div style="' +
    _CARD +
    '"><div class="sec" style="margin:0 0 6px">' +
    tx('Who owns what') +
    '</div>' +
    intFold('streams', [
      'Several connectors are fine — a POS for stock, the books for vouchers, a CRM for parties.',
      'Each stream belongs to exactly one of them, or the same order becomes a voucher in two ledgers.',
      'The first connector to carry a stream claims it. Change it here when a migration ends.'
    ]) +
    body +
    '</div>'
  );
}
async function intStreamSet(stream, kit) {
  try {
    var body = {};
    body[stream] = kit || null;
    await api('intStreamsSet', { body: body });
    toast(kit ? tx('Stream handed over — the connector picks it up within a minute.') : tx('Stream left unowned — nobody carries it now.'));
    _INT_STR = undefined;
    loadSettings();
  } catch (e) {
    toast(tx('Could not change it') + ': ' + ((e && e.message) || e));
  }
}

/**
 * ⭐⭐ RECONCILIATION — did what left this account actually land in the books? (Athi, 2026-09-07: "need to be sure of reconciliation").
 * Booked orders are COUNTED, per system; the list is what needs attention — refused (with the reason the other system gave), due, and
 * OVERDUE, which is the answer to "is it posted before the next day?": released by the trigger more than books_overdue_hours ago and
 * still not in the books.
 * ⚠️ THIS RECONCILES DISPATCH, NOT BALANCES — it proves each order reached the other system once, not that two ledgers agree.
 */
/**
 * ⭐⭐ WHAT IT MEANS, AND WHAT TO DO (2026-09-07). The other system answers in its own words — Tally in XML, Zoho in error codes — and
 * a shopkeeper should never have to read either. Each known answer becomes one sentence and one instruction; anything unrecognised
 * keeps its own words rather than pretending to understand it, and the raw text is always one click away.
 */
function recPlain(r) {
  var sys = r.system || tx('the other system');
  var w = String(r.why || '');
  if (r.state === 'refused') {
    if (/<RESPONSE>|CREATED>0|LASTVCHID/i.test(w))
      return {
        line: txf('{sys} did not create the voucher.', { sys: sys }),
        todo: tx(
          'Almost always a name on the order does not exist in that company yet — a stock item, a ledger, or the voucher type. Open that company, add the missing name, then press Ask again.'
        )
      };
    if (/gstin mismatch/i.test(w))
      return {
        line: tx('The company in the books has a different GSTIN from this account.'),
        todo: tx('Correct the GSTIN in that company, or approve this PC under Running once — then press Ask again.')
      };
    if (/organization_id/i.test(w))
      return {
        line: tx('The books do not recognise the organisation this connector was set up with.'),
        todo: tx('Run start.cmd on that PC again and pick your organisation from the list it prints.')
      };
    if (/IGST|interstate/i.test(w))
      return {
        line: tx('The tax on the invoice did not match the customer’s state.'),
        todo: tx('This was fixed on 7 September. Press Ask again — it should go straight in.')
      };
    if (/401|unauthor|token|oauth|invalid_client/i.test(w))
      return { line: txf('{sys} signed us out.', { sys: sys }), todo: tx('Run start.cmd on that PC and answer yes when it offers to get a new code.') };
    if (/ECONNREFUSED|ETIMEDOUT|connect|closed|not answer/i.test(w))
      return {
        line: txf('{sys} was not open when we tried.', { sys: sys }),
        todo: tx('Open it on that PC. Nothing else — the connector tries again by itself every five minutes.')
      };
    if (/date/i.test(w) && /voucher/i.test(w))
      return {
        line: tx('The books refused the date on the voucher.'),
        todo: tx('The Educational edition of Tally accepts the 1st, 2nd and 31st only. The connector already uses the 2nd — if you see this, tell us.')
      };
    return {
      line: txf('{sys} refused it.', { sys: sys }),
      todo: tx('The connector tries again every five minutes. If it keeps failing, open the technical detail below and send it to us.')
    };
  }
  if (r.state === 'overdue')
    return {
      line: tx('Nothing has answered yet.'),
      todo: tx(
        'Check under Running that the connector is checked in and the other system answered it. If it is, press Ask again; if the PC is off, switch it on — nothing is lost.'
      )
    };
  if (r.state === 'due') return { line: tx('On its way.'), todo: tx('Nothing to do — it usually lands within a minute.') };
  if (r.state === 'waiting')
    return {
      line: tx('Not released yet.'),
      todo: tx('It goes to the books when the order reaches the state you chose in Settings — or when you press Send to books on the order itself.')
    };
  if (r.state === 'before_connector')
    return {
      line: tx('This order is older than your connector.'),
      todo: tx('Nothing was listening when it happened, so it is not late. Press Ask again if you want it in the books anyway, or set it aside.')
    };
  if (r.state === 'set_aside')
    return {
      line: tx('You set this one aside.'),
      todo: tx('It will not go to the books and nothing will ask again. Press Send after all to change your mind.')
    };
  return { line: '', todo: '' };
}
var _INT_REC;
function intReconcileHTML() {
  if (_INT_REC === undefined) {
    _INT_REC = null;
    api('intReconcile', { query: { days: 30 } })
      .then(function (reply) {
        _INT_REC = reply || {};
        if (setSec() === 'integrations') loadSettings();
      })
      .catch(function () {
        _INT_REC = { error: true };
        if (setSec() === 'integrations') loadSettings();
      });
  }
  var d = _INT_REC || {};
  if (_INT_REC === null)
    return (
      '<div style="' +
      _CARD +
      '"><div class="sec" style="margin:0 0 6px">' +
      tx('In the books') +
      '</div><div style="color:var(--grey);font-size:var(--fs-2)">' +
      tx('reading…') +
      '</div></div>'
    );
  var c = d.counts || {},
    rows = d.rows || [];
  var chip = function (n, label, nestedColour, testid) {
    return (
      '<span data-testid="' +
      testid +
      '" style="display:inline-flex;gap:5px;align-items:center;border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:var(--fs-1);' +
      (nestedColour ? 'color:' + nestedColour + ';font-weight:700' : 'color:var(--grey)') +
      '"><b>' +
      esc(String(n || 0)) +
      '</b> ' +
      esc(label) +
      '</span>'
    );
  };
  var bySys = Object.keys(d.by_system || {})
    .map(function (item) {
      return esc(item) + ' ' + esc(String(d.by_system[item]));
    })
    .join(' · ');
  var head =
    c.overdue || c.refused
      ? '<div style="font-size:var(--fs-2);color:var(--warn-3);font-weight:700;margin-bottom:4px" data-testid="int-rec-head">' +
        esc(txf('{n} order(s) need a look — each one below says what to do.', { n: String((c.overdue || 0) + (c.refused || 0)) })) +
        '</div>'
      : '<div style="font-size:var(--fs-2);color:var(--ok-2);margin-bottom:4px" data-testid="int-rec-head">' +
        esc(tx('Nothing needs you. Anything on the way lands by itself.')) +
        '</div>';
  var chips =
    head +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 8px">' +
    chip(c.booked, tx('in the books'), 'var(--ok-2)', 'int-rec-booked') +
    chip(c.overdue, tx('overdue'), c.overdue ? 'var(--warn-3)' : '', 'int-rec-overdue') +
    chip(c.refused, tx('refused'), c.refused ? 'var(--warn-3)' : '', 'int-rec-refused') +
    chip(c.due, tx('on the way'), '', 'int-rec-due') +
    chip(c.waiting, tx('waiting for the trigger'), '', 'int-rec-waiting') +
    (c.before_connector ? chip(c.before_connector, tx('older than the connector'), '', 'int-rec-older') : '') +
    (c.set_aside ? chip(c.set_aside, tx('set aside'), '', 'int-rec-aside') : '') +
    '</div>';
  /* what a person is being asked about — an order older than the connector, or one set aside, is stated below but asks nothing */
  var open = rows.filter(function (item) {
    return item.state === 'overdue' || item.state === 'refused' || item.state === 'due' || item.state === 'before_connector' || item.state === 'set_aside';
  });
  var word = { overdue: tx('overdue'), refused: tx('refused'), due: tx('on the way'), before_connector: tx('older'), set_aside: tx('set aside') };
  var colour = { overdue: 'var(--warn-3)', refused: 'var(--warn-3)', due: 'var(--grey)', before_connector: 'var(--grey)', set_aside: 'var(--grey)' };
  var when = fmtDateTime;
  var list = open.length
    ? open
        .slice(0, 40)
        .map(function (item) {
          var short = String(item.chit_id).slice(0, 8),
            p = recPlain(item),
            raw = lsGet('cb_rec_raw_' + short, '0') === '1';
          return (
            '<div data-testid="int-rec-row-' +
            esc(short) +
            '" style="display:flex;gap:10px;align-items:baseline;padding:8px 0;border-top:1px solid var(--line);font-size:var(--fs-2)">' +
            '<span style="font-weight:700;color:' +
            colour[item.state] +
            ';flex:0 0 92px">' +
            esc(word[item.state] || item.state) +
            '</span>' +
            '<span style="flex:1">' +
            '<b>' +
            esc(item.subject || tx('Order')) +
            '</b>' +
            (item.party ? '<span style="color:var(--grey)"> · ' + esc(item.party) + '</span>' : '') +
            '<div style="margin-top:2px">' +
            esc(p.line) +
            '</div>' +
            (p.todo ? '<div style="color:var(--grey);font-size:var(--fs-1);margin-top:2px">' + esc(p.todo) + '</div>' : '') +
            '<div style="color:var(--grey-4);font-size:var(--fs-1);margin-top:3px">' +
            esc(when(item.released_at || item.created_at)) +
            (item.why
              ? ' · <span data-cbsid="ACC002-C19" data-testid="int-rec-raw-' +
                esc(short) +
                '" onclick="intRecRaw(\'' +
                esc(short) +
                '\')" style="cursor:pointer;color:var(--blue)">' +
                (raw ? esc(tx('hide the technical detail')) : esc(tx('technical detail'))) +
                '</span>'
              : '') +
            '</div>' +
            (raw && item.why
              ? '<div style="margin-top:3px;font-family:monospace;font-size:var(--fs-1);color:var(--warn-2);word-break:break-word">' + esc(item.why) + '</div>'
              : '') +
            '</span>' +
            '<span style="display:flex;gap:6px;flex:0 0 auto">' +
            '<button data-cbsid="CMP010" class="btn2" data-testid="int-rec-open-' +
            esc(short) +
            '" onclick="intRecOpen(\'' +
            esc(item.chit_id) +
            "','" +
            esc(item.side || '') +
            '\')">' +
            tx('Open') +
            '</button>' +
            (item.state === 'set_aside'
              ? '<button data-cbsid="ACC002-B46" class="btn2" data-testid="int-rec-unskip-' +
                esc(short) +
                '" onclick="intRecSkip(\'' +
                esc(item.chit_id) +
                '\', false)">' +
                tx('Send after all') +
                '</button>'
              : '<button data-cbsid="ACC002-B47" class="btn2" data-testid="int-rec-retry-' +
                esc(short) +
                '" onclick="intRecRetry(\'' +
                esc(item.chit_id) +
                '\')">' +
                tx('Ask again') +
                '</button>' +
                '<button data-cbsid="ACC002-B48" class="btn2" data-testid="int-rec-skip-' +
                esc(short) +
                '" onclick="intRecSkip(\'' +
                esc(item.chit_id) +
                '\', true)" title="' +
                esc(tx('it will not go to the books, and nothing will ask again')) +
                '">' +
                tx('Not for the books') +
                '</button>') +
            '</span></div>'
          );
        })
        .join('')
    : '<div style="color:var(--ok-2);font-size:var(--fs-2)" data-testid="int-rec-clear">✓ ' +
      tx('Everything has reached the books. Nothing for you to do.') +
      '</div>';
  return (
    '<div style="' +
    _CARD +
    '"><div class="sec" style="margin:0 0 6px">' +
    tx('In the books') +
    '</div>' +
    intFold('books', [
      'The last ' + String(d.days || 30) + ' days of orders, and where each stands in the other system.',
      'Overdue: the trigger released it more than ' + String(d.overdue_hours || 12) + ' hours ago and nothing answered.',
      'Ask again re-requests one — the connector never books the same order twice.'
    ]) +
    chips +
    (bySys ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-bottom:6px">' + esc(tx('Booked by')) + ': ' + bySys + '</div>' : '') +
    list +
    '</div>'
  );
}
/** set an order aside, or bring it back — reversible, and recorded with who and when (2026-09-07) */
async function intRecSkip(id, on) {
  try {
    await api('intBooksSkip', { body: { chit_id: id, on: !!on } });
    toast(on ? tx('Set aside — it will not go to the books.') : tx('Back in the queue — the connector books it within a minute.'));
    _INT_REC = undefined;
    loadSettings();
  } catch (e) {
    toast(tx('Could not change it') + ': ' + ((e && e.message) || e));
  }
}
function intRecRaw(short) {
  lsSet('cb_rec_raw_' + short, lsGet('cb_rec_raw_' + short, '0') === '1' ? '0' : '1');
  loadSettings();
}
/** open the order itself — a sale sits in Task, an order you placed in Order (2026-09-07) */
function intRecOpen(id, side) {
  try {
    if (typeof navTo === 'function') navTo(side === 'purchase' ? 'order' : 'task');
    setTimeout(function () {
      if (typeof openChit === 'function') openChit(id);
    }, 300);
  } catch (e) {
    toast(tx('Could not open it') + ': ' + ((e && e.message) || e));
  }
}
async function intRecRetry(id) {
  try {
    await api('chitBooks', { params: { id: id } });
    toast(tx('Asked again — the connector books it within a minute.'));
    _INT_REC = undefined;
    loadSettings();
  } catch (e) {
    toast(tx('Could not ask') + ': ' + ((e && e.message) || e));
  }
}

/**
 * ── ⭐⭐⭐ COUNTERS — WHERE THIS SHOP IS OPEN, AND HOW MANY TIMES ─────────────────────────────────────────────
 *
 * Athi, 2026-09-16, with one PC pushing bills and another silent: *"can we build IP level information for every
 * counter app, installed, browsed, is it possible to connect with bridge id, in how many places the store is
 * opened and to close the duplicates?"*
 *
 * ⚠️⚠️ "NEVER REACHED CHITBRIDGE" IS THE LOUDEST ROW HERE, AND IT IS A DIFFERENT FAULT FROM EVERY OTHER ONE. A
 * counter we have never heard from is not being refused by us — nothing from it is arriving, which points at the
 * network in front of it rather than at anything on this side. That single distinction is the difference between
 * hunting a permissions problem for an afternoon and telephoning an office firewall.
 *
 * ⚠️ A KEY IS A COUNTER. Minting another does not replace the last, it adds a second — and each one keeps its OWN
 * copy of the bills on its machine (the counter's tillStore() is named after the key), so a pairing nobody uses is
 * a place sales can go unnoticed. This page exists so that is visible before it becomes a mystery.
 */
/**
 * ── ⭐⭐⭐ THE COUNTERS THIS SHOP HAS — created once, opened and closed as often as needed, one PC at a time ─────
 * Athi, 2026-09-17: *"it has to be like a co-assist — I know the counter number, and I open and close it again and
 * again, but in only one PC."* This is that register. The pairings further down are the older way in, kept visible
 * so nothing a shop has already billed through disappears from view.
 */
/**
 * ── ⭐⭐⭐ NETWORK OFFERS (Athi, 2026-09-17) ──────────────────────────────────────────────────────────────────────
 * *"Only offers the store opts into — that can be a setting, opt-in, opt-out … a controlled mechanism of releasing the
 * offer … those offers reflect in every store and every counter."*
 * A BRAND sees its model and its offers, and releases or withdraws each — at the next opening unless it says "now".
 * A STORE sees each network it belongs to and takes or declines each released offer. Every change is pushed: the
 * brand's release to every member store, and each store to its own counters.
 */
var _NETO,
  _NETO_ARMED = null;
/* ⚠️ a release changes what the offer chips say on the product page and in Catalogue setup (netRelChip) — those caches go too */
function netoReload() {
  _NETO = undefined;
  if (typeof _DEFS !== 'undefined') delete _DEFS.offer;
  if (typeof UI !== 'undefined') UI._ctOffers = undefined;
  if (typeof CATSET_DEFS !== 'undefined') delete CATSET_DEFS.offer;
  loadSettings();
}
function _netWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return String(iso).slice(0, 16);
  }
}
function _netRelWords(r) {
  if (!r) return tx('not released');
  var now = Date.now(),
    at = r.at ? new Date(r.at).getTime() : 0,
    until = r.until ? new Date(r.until).getTime() : 0;
  if (until && until <= now) return tx('withdrawn') + ' ' + _netWhen(r.until);
  var w = at > now ? tx('released — starts') + ' ' + _netWhen(r.at) : tx('running since') + ' ' + _netWhen(r.at);
  if (until) w += ' · ' + tx('ends') + ' ' + _netWhen(r.until);
  return w;
}
function netOffersHTML() {
  if (_NETO === undefined) {
    _NETO = null;
    api('netOffers')
      .then(function (reply) {
        _NETO = reply || {};
        if (setSec() === 'integrations') loadSettings();
      })
      .catch(function (e) {
        _NETO = { error: (e && e.message) || true };
        if (setSec() === 'integrations') loadSettings();
      });
  }
  if (_NETO === null) return '<div style="' + _CARD + '">' + tx('reading…') + '</div>';
  if (_NETO.error) return '<div style="' + _CARD + ';color:var(--warn)">' + tx('Could not read network offers.') + '</div>';
  var b = _NETO.brand || {},
    nets = (_NETO.store && _NETO.store.networks) || [];
  var out = '';

  if (b.is_brand) {
    var pol = b.policy || 'opt_in';
    var polBtn = function (k, label, hint) {
      return (
        '<button data-cbsid="BUS004-B23" class="' +
        (pol === k ? 'pri' : '') +
        '" data-testid="neto-policy-' +
        k +
        '" onclick="netoPolicy(\'' +
        k +
        '\')"' +
        ' title="' +
        esc(hint) +
        '">' +
        tx(label) +
        '</button>'
      );
    };
    var rows = (b.offers || [])
      .map(function (item) {
        var r = item.released,
          live = item.status === 'live';
        var running = r && (!r.until || new Date(r.until).getTime() > Date.now());
        var armed = _NETO_ARMED === 'now:' + item.id;
        return (
          '<div data-testid="neto-offer-' +
          esc(item.id) +
          '" style="display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line);flex-wrap:wrap">' +
          '<span style="flex:1 1 220px;min-width:0"><b>' +
          esc(item.name) +
          '</b>' +
          '<div style="font-size:var(--fs-1);color:var(--' +
          (running ? 'ok' : 'grey') +
          ')" data-testid="neto-state-' +
          esc(item.id) +
          '">' +
          (live ? esc(_netRelWords(r)) : tx('draft — make it live before releasing')) +
          /* ⚠️ edited since release: the stores are still on the released version until this goes out */
          (item.changed
            ? ' · <b style="color:var(--warn)" data-testid="neto-changed-' +
              esc(item.id) +
              '">' +
              tx('changed since release — stores still have the released version') +
              '</b>'
            : '') +
          '</div></span>' +
          (live && (!running || item.changed)
            ? '<button data-cbsid="BUS004-B24" class="pri" data-testid="neto-release-' +
              esc(item.id) +
              '" onclick="netoRelease(\'' +
              esc(item.id) +
              '\',false)">' +
              tx('Release at next opening') +
              '</button>' +
              '<button data-cbsid="BUS004-B25" data-testid="neto-release-now-' +
              esc(item.id) +
              '" onclick="netoRelease(\'' +
              esc(item.id) +
              '\',true)">' +
              (armed ? tx('Release NOW — mid-day, every store') : tx('Release now')) +
              '</button>'
            : '') +
          (running
            ? '<button data-cbsid="BUS004-B26" class="warn" data-testid="neto-withdraw-' +
              esc(item.id) +
              '" onclick="netoWithdraw(\'' +
              esc(item.id) +
              '\')">' +
              tx('Withdraw at next opening') +
              '</button>'
            : '') +
          '</div>'
        );
      })
      .join('');
    out +=
      '<div style="' +
      _CARD +
      '">' +
      '<div class="sec" style="margin:0 0 6px">' +
      tx('Your network') +
      ' · ' +
      (b.stores || 0) +
      ' ' +
      tx('store(s)') +
      '</div>' +
      /* ⭐ WHO IS IN — and the network decides (src/services/network: the side that did not ask approves) */
      netMembersHTML(b.members || []) +
      '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:8px">' +
      tx(
        'Offers you release reach every store that uses your catalogue, and every counter in those stores. A release takes effect at the next opening, so nothing changes in the middle of a trading day unless you choose to.'
      ) +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
      polBtn('opt_in', 'Stores choose which offers to take', 'opt-in: an offer applies only in stores that take it') +
      polBtn('opt_out', 'Every released offer applies', 'opt-out: an offer applies unless a store declines it') +
      '</div>' +
      (rows ||
        '<div style="color:var(--grey);padding:6px 0">' + tx('No offers yet — declare them under Offers, make them live, then release them here.') + '</div>') +
      '</div>';
    (b.catalogue || []).forEach(function (item) {
      out += netCatBrandHTML(item, b.stores || 0);
    });
  }

  var notes = (_NETO.store && _NETO.store.price_notices) || [];
  if (notes.length) out += netCatNoticesHTML(notes);

  nets.forEach(function (item) {
    var optIn = item.policy !== 'opt_out';
    var lines = (item.offers || [])
      .map(function (entry) {
        var btn = entry.applies
          ? '<button data-cbsid="BUS004-B27" data-testid="neto-out-' +
            esc(entry.id) +
            '" onclick="netoChoice(\'' +
            esc(entry.id) +
            "','" +
            (optIn ? '' : 'out') +
            '\')">' +
            tx(optIn ? 'Stop taking it' : 'Decline') +
            '</button>'
          : '<button data-cbsid="BUS004-B28" class="pri" data-testid="neto-in-' +
            esc(entry.id) +
            '" onclick="netoChoice(\'' +
            esc(entry.id) +
            "','" +
            (optIn ? 'in' : '') +
            '\')">' +
            tx('Take this offer') +
            '</button>';
        return (
          '<div data-testid="neto-net-' +
          esc(entry.id) +
          '" style="display:flex;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line);flex-wrap:wrap">' +
          '<span style="flex:1 1 220px;min-width:0"><b>' +
          esc(entry.name) +
          '</b>' +
          '<div style="font-size:var(--fs-1);color:var(--' +
          (entry.applies ? 'ok' : 'grey') +
          ')">' +
          (entry.applies ? tx('applies at your counters') : tx('not applied here')) +
          ' · ' +
          esc(_netRelWords({ at: entry.at, until: entry.until })) +
          '</div></span>' +
          (entry.live ? btn : '<span style="color:var(--grey);font-size:var(--fs-1)">' + tx('no longer live at the brand') + '</span>') +
          '</div>'
        );
      })
      .join('');
    out +=
      '<div style="' +
      _CARD +
      '">' +
      /* ⭐ one card per brand this store sells for — a store can be in several networks, each with its own offers and prices */
      netStandingHTML(item) +
      (((item.membership || {}).state || 'active') === 'active'
        ? '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:6px">' +
          tx(
            optIn
              ? 'Your network lets each store choose. An offer applies here only if you take it.'
              : 'Your network applies every released offer. You can decline one for this store.'
          ) +
          '</div>' +
          (lines || '<div style="color:var(--grey);padding:6px 0">' + tx('Nothing released yet.') + '</div>')
        : '') +
      '</div>';
  });

  if (!out)
    out =
      '<div style="' +
      _CARD +
      ';color:var(--grey)">' +
      tx(
        "This shop is not part of a network. A brand shares its catalogue with its stores — a store that adopts it sees the brand's offers here, and a brand releases them from here."
      ) +
      '</div>';
  return out;
}
/**
 * ── ⭐⭐ PUBLISH CHANGES — the brand's products, to its stores (Athi, 2026-09-17) ────────────────────────────────────
 * *"if the price changed it has to reflect to the store"* → *"suggest only, build publish changes as you recommended."*
 * A store sells from the brand's PUBLISHED copy, so an edit to a brand product reaches nobody until it is published here.
 * Like an offer: at the next opening unless "now" is pressed twice. A store still at the brand's price follows it; a store
 * with its own price is asked, never overwritten (lib/network-catalogue.js).
 */
var _NETC_ADD = {},
  _NETC_OUT = {};
var _NETC_WORDS = { price: 'price', mrp: 'MRP', name: 'name', category: 'category', hsn: 'HSN', unit: 'unit', image: 'picture', desc: 'description' };
function _netMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  try {
    return fmtMoney(Number(n), moneyCode());
  } catch (_) {
    return String(n);
  }
}
function _netFieldWords(f) {
  var money = f.field === 'price' || f.field === 'mrp';
  var v = function (x) {
    return f.field === 'image' ? (x ? tx('a picture') : tx('none')) : money ? _netMoney(x) : x === null || x === '' ? '—' : String(x);
  };
  return tx(_NETC_WORDS[f.field] || f.field) + ' ' + esc(v(f.from)) + ' → ' + esc(v(f.to));
}
function netCatBrandHTML(c, stores) {
  var key = c.source_key,
    sel = _NETC_ADD[key] || {};
  var nSel = Object.keys(sel).filter(function (item) {
    return sel[item];
  }).length;
  var outSel = _NETC_OUT[key] || {};
  var nOut = Object.keys(outSel).filter(function (item) {
    return outSel[item];
  }).length;
  var armed = _NETO_ARMED === 'pub:' + key;
  var changes = (c.changes || [])
    .map(function (item, index) {
      return (
        '<div data-testid="netc-change-' +
        index +
        '" style="padding:6px 0;border-top:1px solid var(--line);font-size:var(--fs-2)">' +
        '<b>' +
        esc(item.name) +
        '</b>' +
        (item.was ? ' <span style="color:var(--grey)">(' + tx('was') + ' ' + esc(item.was) + ')</span>' : '') +
        ' — ' +
        (item.kind === 'withdrawn'
          ? tx('withdrawn from your stores')
          : item.kind === 'withdrawn_at'
            ? tx('withdrawn from') + ' ' + (item.stores || []).length + ' ' + tx('store(s)')
            : item.kind === 'restored_at'
              ? tx('offered again at') + ' ' + (item.stores || []).length + ' ' + tx('store(s)')
              : (item.kind === 'added' ? tx('new to your stores') + ' · ' : '') + (item.fields || []).map(_netFieldWords).join(' · ')) +
        '</div>'
      );
    })
    .join('');
  var cands = (c.candidates || [])
    .map(function (item) {
      return (
        '<label data-testid="netc-add-' +
        esc(item.item_id) +
        '" style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:var(--fs-2)">' +
        '<input data-cbsid="BUS004-I45" type="checkbox" ' +
        (sel[item.item_id] ? 'checked ' : '') +
        'onchange="netcTick(\'' +
        esc(key) +
        "','" +
        esc(item.item_id) +
        '\',this.checked)">' +
        esc(item.name) +
        ' <span style="color:var(--grey)">' +
        esc(_netMoney(item.price)) +
        '</span></label>'
      );
    })
    .join('');
  var waiting = c.pending
    ? '<div data-testid="netc-pending" style="padding:8px 0;color:var(--warn-2);font-size:var(--fs-2)">⏳ ' +
      esc((c.pending.changes || []).length + ' ' + tx('change(s) go to your stores') + ' ' + _netWhen(c.pending.at)) +
      ' <button data-cbsid="CMP003" class="warn" data-testid="netc-cancel" onclick="netcCancel(\'' +
      esc(key) +
      '\')">' +
      tx('Cancel') +
      '</button></div>'
    : '';
  var any = (c.changes || []).length || nSel || nOut;
  /* ⭐ WITHDRAW — tick what the stores should stop selling; it goes with the next publish (lib/network-catalogue.diff) */
  var missing = {};
  (c.missing || []).forEach(function (item) {
    missing[item] = true;
  });
  /* ⭐ …or from SOME stores: each product opens a row of its stores, ticked where it is (or will be) withdrawn */
  var atSel = _NETC_AT[key] || {},
    cur = c.withdrawn_at || {},
    storeList = c.stores || [];
  var nAt = netcAtChanges(c).count;
  any = any || nAt;
  var shared = (c.published || [])
    .map(function (item, index) {
      var now = cur[item] || [],
        want = atSel[item] || null;
      var isOut = function (id) {
        return want && id in want ? !!want[id] : now.indexOf(id) >= 0;
      };
      var outCount = storeList.filter(function (entry) {
        return isOut(entry.id);
      }).length;
      var open = _NETC_OPEN === key + '|' + item;
      return (
        '<div data-testid="netc-out-' +
        index +
        '" style="padding:3px 0;font-size:var(--fs-2)">' +
        '<label style="display:flex;gap:8px;align-items:center">' +
        '<input data-cbsid="BUS004-I46" type="checkbox" ' +
        (outSel[item] ? 'checked ' : '') +
        'onchange="netcOut(\'' +
        esc(key) +
        "'," +
        index +
        ',this.checked)">' +
        '<span style="' +
        (outSel[item] ? 'text-decoration:line-through;color:var(--warn-2)' : '') +
        '">' +
        esc(item) +
        '</span>' +
        (missing[item] ? ' <span style="color:var(--grey);font-size:var(--fs-1)">' + tx('no longer in your products') + '</span>' : '') +
        (outSel[item] ? ' <span style="color:var(--warn-2);font-size:var(--fs-1)">' + tx('withdrawn from your stores when you publish') + '</span>' : '') +
        (!outSel[item] && storeList.length
          ? ' <span data-cbsid="BUS004-B29" role="button" tabindex="0" data-testid="netc-at-open-' +
            index +
            '" onclick="event.preventDefault();netcAtOpen(\'' +
            esc(key) +
            "'," +
            index +
            ')"' +
            ' style="color:var(--blue);cursor:pointer;font-size:var(--fs-1)">' +
            esc(outCount ? tx('withdrawn from') + ' ' + outCount + ' ' + tx('store(s)') + ' ▾' : tx('by store') + ' ▸') +
            '</span>'
          : '') +
        '</label>' +
        (open && !outSel[item]
          ? '<div data-testid="netc-at-' +
            index +
            '" style="display:flex;gap:10px;flex-wrap:wrap;margin:4px 0 4px 26px">' +
            storeList
              .map(function (entry, j) {
                var changed = want && entry.id in want && !!want[entry.id] !== now.indexOf(entry.id) >= 0;
                return (
                  '<label data-testid="netc-at-' +
                  index +
                  '-' +
                  j +
                  '" style="display:flex;gap:4px;align-items:center;font-size:var(--fs-1)' +
                  (changed ? ';font-weight:700' : '') +
                  '">' +
                  '<input data-cbsid="BUS004-I47" type="checkbox" ' +
                  (isOut(entry.id) ? 'checked ' : '') +
                  'onchange="netcAt(\'' +
                  esc(key) +
                  "'," +
                  index +
                  ',' +
                  j +
                  ',this.checked)">' +
                  esc(tx('withdraw at') + ' ' + entry.name) +
                  '</label>'
                );
              })
              .join('') +
            '</div>'
          : '') +
        '</div>'
      );
    })
    .join('');
  var log = (c.log || [])
    .map(function (item) {
      var state = item.cancelled_at
        ? tx('cancelled')
        : item.applied_at
          ? tx('with your stores since') + ' ' + _netWhen(item.applied_at)
          : tx('waiting for') + ' ' + _netWhen(item.at);
      return (
        '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">' +
        esc(_netWhen(item.published_at)) +
        ' · ' +
        esc((item.changes || []).length + ' ' + tx('change(s)')) +
        ' · ' +
        esc(state) +
        '</div>'
      );
    })
    .join('');
  return (
    '<div style="' +
    _CARD +
    '" data-testid="netc-' +
    esc(key) +
    '">' +
    '<div class="sec" style="margin:0 0 6px">' +
    tx('Catalogue') +
    ' · ' +
    esc(c.title || key) +
    ' · ' +
    (c.items || 0) +
    ' ' +
    tx('product(s) with your stores') +
    '</div>' +
    waiting +
    (changes
      ? '<div style="font-size:var(--fs-2);margin-bottom:4px">' + tx('Changed since your stores last received it:') + '</div>' + changes
      : '<div data-testid="netc-uptodate" style="color:var(--grey);font-size:var(--fs-2);padding:4px 0">' + tx('Your stores have every change.') + '</div>') +
    (cands ? '<div style="font-size:var(--fs-2);margin:8px 0 2px">' + tx('Not shared with your stores yet — tick to add:') + '</div>' + cands : '') +
    /* ⚠️ the fold REMEMBERS it is open — every tick repaints the screen, and a list that snapped shut would lose the brand's place */
    (shared
      ? '<details data-testid="netc-shared"' +
        (_NETC_SHOW[key] || nOut || nAt || (c.missing || []).length ? ' open' : '') +
        ' ontoggle="_NETC_SHOW[\'' +
        esc(key) +
        '\']=this.open" style="margin-top:8px"><summary data-testid="netc-shared-open" style="cursor:pointer;font-size:var(--fs-2)">' +
        esc(tx('With your stores') + ' (' + (c.published || []).length + ') — ' + tx('tick to withdraw')) +
        '</summary>' +
        shared +
        '</details>'
      : '') +
    (any
      ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<button data-cbsid="BUS004-B30" class="pri" data-testid="netc-publish" onclick="netcPublish(\'' +
        esc(key) +
        '\',false)">' +
        tx('Publish at next opening') +
        '</button>' +
        '<button data-cbsid="BUS004-B31" data-testid="netc-publish-now" onclick="netcPublish(\'' +
        esc(key) +
        '\',true)">' +
        (armed ? tx('Publish NOW — mid-day, every store') : tx('Publish now')) +
        '</button>' +
        '</div>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' +
        esc(
          tx('A store still selling at your price moves to the new one. A store with its own price keeps it and is shown yours.') +
            (stores ? '' : ' ' + tx('No store uses this catalogue yet.'))
        ) +
        '</div>'
      : '') +
    (log ? '<div style="margin-top:8px">' + log + '</div>' : '') +
    '</div>'
  );
}
var _NETC_AT = {},
  _NETC_OPEN = null,
  _NETC_SHOW = {};
function _netcCat(key) {
  return (
    (((_NETO || {}).brand || {}).catalogue || []).filter(function (x) {
      return x.source_key === key;
    })[0] || null
  );
}
function netcAtOpen(key, i) {
  var c = _netcCat(key),
    n = c && (c.published || [])[i];
  if (!n) return;
  _NETC_OPEN = _NETC_OPEN === key + '|' + n ? null : key + '|' + n;
  loadSettings();
}
function netcAt(key, i, j, on) {
  var c = _netcCat(key),
    n = c && (c.published || [])[i],
    s = c && (c.stores || [])[j];
  if (!n || !s) return;
  _NETC_AT[key] = _NETC_AT[key] || {};
  _NETC_AT[key][n] = _NETC_AT[key][n] || {};
  _NETC_AT[key][n][s.id] = !!on;
  loadSettings();
}
/** what the per-store ticks change against what is already withdrawn → { withdraw_at, restore_at, count } */
function netcAtChanges(c) {
  var sel = _NETC_AT[c.source_key] || {},
    cur = c.withdrawn_at || {},
    w = {},
    r = {},
    count = 0;
  Object.keys(sel).forEach(function (item) {
    Object.keys(sel[item]).forEach(function (id) {
      var was = (cur[item] || []).indexOf(id) >= 0;
      if (sel[item][id] && !was) {
        (w[item] = w[item] || []).push(id);
        count++;
      }
      if (!sel[item][id] && was) {
        (r[item] = r[item] || []).push(id);
        count++;
      }
    });
  });
  return { withdraw_at: w, restore_at: r, count: count };
}
function netCatAtFor(key) {
  var c = _netcCat(key);
  return c ? netcAtChanges(c) : { withdraw_at: {}, restore_at: {}, count: 0 };
}
function netcOut(key, i, on) {
  var c = (((_NETO || {}).brand || {}).catalogue || []).filter(function (x) {
    return x.source_key === key;
  })[0];
  var name = c && (c.published || [])[i];
  if (!name) return;
  _NETC_OUT[key] = _NETC_OUT[key] || {};
  _NETC_OUT[key][name] = !!on;
  loadSettings();
}
function netcTick(key, id, on) {
  _NETC_ADD[key] = _NETC_ADD[key] || {};
  _NETC_ADD[key][id] = !!on;
  loadSettings();
}
async function netcPublish(key, now) {
  if (now && _NETO_ARMED !== 'pub:' + key) {
    _NETO_ARMED = 'pub:' + key;
    loadSettings();
    return;
  }
  _NETO_ARMED = null;
  var sel = _NETC_ADD[key] || {};
  try {
    var outs = _NETC_OUT[key] || {};
    var at = netCatAtFor(key);
    var reply = await api('netCatPublish', {
      body: {
        source_key: key,
        at: now ? 'now' : undefined,
        add: Object.keys(sel).filter(function (item) {
          return sel[item];
        }),
        withdraw: Object.keys(outs).filter(function (item) {
          return outs[item];
        }),
        withdraw_at: at.withdraw_at,
        restore_at: at.restore_at
      }
    });
    delete _NETC_ADD[key];
    delete _NETC_OUT[key];
    delete _NETC_AT[key];
    _NETC_OPEN = null;
    toast(reply && reply.applied ? tx('Published — your stores have it now') : tx('Published — your stores get it at the next opening'));
    netoReload();
  } catch (e) {
    toast((e && e.message) || tx('Could not publish'), true);
  }
}
async function netcCancel(key) {
  try {
    await api('netCatCancel', { body: { source_key: key } });
    toast(tx('Cancelled — nothing goes to your stores'));
    netoReload();
  } catch (e) {
    toast((e && e.message) || tx('Could not cancel'), true);
  }
}
function netCatNoticesHTML(notes) {
  return (
    '<div style="' +
    _CARD +
    '" data-testid="netc-notices">' +
    '<div class="sec" style="margin:0 0 6px">' +
    tx('From your brand') +
    '</div>' +
    notes
      .map(function (item, index) {
        if (item.kind === 'restored')
          return (
            '<div data-testid="netc-notice-' +
            index +
            '" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line)">' +
            '<span style="flex:1 1 240px;min-width:0"><b>' +
            esc(item.name) +
            '</b><div style="font-size:var(--fs-1);color:var(--ok)">' +
            esc((item.brand_name || tx('Your brand')) + ' ' + tx('offers this to your store again — it is back on your counter and storefront')) +
            '</div></span>' +
            '<button data-cbsid="CMP004" data-testid="netc-ok-' +
            index +
            '" onclick="netcAnswer(' +
            index +
            ",'ok')\">" +
            tx('OK') +
            '</button></div>'
          );
        if (item.kind === 'withdrawn')
          return (
            '<div data-testid="netc-notice-' +
            index +
            '" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line)">' +
            '<span style="flex:1 1 240px;min-width:0"><b>' +
            esc(item.name) +
            '</b><div style="font-size:var(--fs-1);color:var(--warn-2)">' +
            esc(
              (item.brand_name || tx('Your brand')) +
                ' ' +
                (item.only_here
                  ? tx('withdrew this from your store — it is off your counter and storefront since')
                  : tx('no longer offers this — it is off your counter and storefront since')) +
                ' ' +
                _netWhen(item.at)
            ) +
            '</div></span>' +
            '<button data-cbsid="CMP004" data-testid="netc-ok-' +
            index +
            '" onclick="netcAnswer(' +
            index +
            ",'ok')\">" +
            tx('OK') +
            '</button></div>'
          );
        return (
          '<div data-testid="netc-notice-' +
          index +
          '" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--line)">' +
          '<span style="flex:1 1 240px;min-width:0"><b>' +
          esc(item.name) +
          '</b><div style="font-size:var(--fs-1);color:var(--grey)">' +
          esc(
            (item.brand_name || tx('Your brand')) +
              ' ' +
              tx('suggests') +
              ' ' +
              _netMoney(item.suggested) +
              ' · ' +
              tx('you sell at') +
              ' ' +
              _netMoney(item.yours)
          ) +
          '</div></span>' +
          '<button data-cbsid="BUS004-B32" class="pri" data-testid="netc-use-' +
          index +
          '" onclick="netcAnswer(' +
          index +
          ",'use')\">" +
          esc(tx('Use') + ' ' + _netMoney(item.suggested)) +
          '</button>' +
          '<button data-cbsid="BUS004-B33" data-testid="netc-keep-' +
          index +
          '" onclick="netcAnswer(' +
          index +
          ",'keep')\">" +
          esc(tx('Keep') + ' ' + _netMoney(item.yours)) +
          '</button>' +
          '</div>'
        );
      })
      .join('') +
    '</div>'
  );
}
async function netcAnswer(i, choice) {
  var n = (((_NETO || {}).store || {}).price_notices || [])[i];
  if (!n) return;
  try {
    await api('netCatPrice', { body: { source_key: n.source_key, name: n.name, key: n.key, choice: choice } });
    toast(choice === 'use' ? tx('Your price now follows the brand') : choice === 'ok' ? tx('Noted') : tx('Kept your price'));
    netoReload();
  } catch (e) {
    toast((e && e.message) || tx('Could not save'), true);
  }
}
async function netoPolicy(k) {
  try {
    await api('netOfferPolicy', { body: { policy: k } });
    if (typeof toast === 'function') toast(tx('Saved — every store is told'));
    netoReload();
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not save'), true);
  }
}
async function netoRelease(id, now) {
  /* ⚠️ "now" is a mid-day change for every store — two presses, and the second one says so */
  if (now && _NETO_ARMED !== 'now:' + id) {
    _NETO_ARMED = 'now:' + id;
    loadSettings();
    return;
  }
  _NETO_ARMED = null;
  try {
    var reply = await api('netOfferRelease', { params: { id: id }, body: now ? { at: 'now' } : {} });
    if (typeof toast === 'function') toast(tx('Released') + ' — ' + ((reply && reply.pushed && reply.pushed.stores) || 0) + ' ' + tx('store(s) told'));
    netoReload();
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not release'), true);
  }
}
async function netoWithdraw(id) {
  try {
    await api('netOfferWithdraw', { params: { id: id }, body: {} });
    if (typeof toast === 'function') toast(tx('Withdrawn from the next opening'));
    netoReload();
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not withdraw'), true);
  }
}
/**
 * ── ⭐⭐ MEMBERSHIP — THE NETWORK'S OWN EDGES (Athi, 2026-09-17) ──────────────────────────────────────────────────────
 * *"brand should approve and remove members … using our network architecture … we have that logic already."* Every button
 * here is an existing /api/network call (netConnect · netApprove · netDecline · netSuspend · netResume · netDisconnect);
 * the server decides who may press it from the signed-in business. built = a store the brand made (can be paused, not
 * removed); joined = an existing business that asked or was invited (can be removed).
 */
var _NET_STATE = { active: 'in the network', suspended: 'paused', requested: 'waiting' };
function netMembersHTML(list) {
  var rows = list
    .map(function (item, index) {
      var btns = '';
      if (item.state === 'requested' && item.asked_by === 'store')
        btns =
          '<button data-cbsid="BUS004-B34" class="pri" data-testid="netm-approve-' +
          index +
          "\" onclick=\"netmAct('netApprove','" +
          esc(item.edge_id) +
          '\')">' +
          tx('Approve') +
          '</button>' +
          '<button data-cbsid="BUS004-B35" data-testid="netm-decline-' +
          index +
          "\" onclick=\"netmAct('netDecline','" +
          esc(item.edge_id) +
          '\')">' +
          tx('Decline') +
          '</button>';
      else if (item.state === 'requested')
        btns =
          '<button data-cbsid="BUS004-B36" data-testid="netm-cancel-' +
          index +
          "\" onclick=\"netmAct('netDecline','" +
          esc(item.edge_id) +
          '\')">' +
          tx('Cancel invitation') +
          '</button>';
      else if (item.state === 'suspended' && item.edge_id)
        btns =
          '<button data-cbsid="BUS004-B37" class="pri" data-testid="netm-resume-' +
          index +
          "\" onclick=\"netmAct('netResume','" +
          esc(item.edge_id) +
          '\')">' +
          tx('Resume') +
          '</button>';
      else if (item.state === 'active' && item.via === 'joined')
        btns =
          _NETO_ARMED === 'rm:' + item.edge_id
            ? '<button data-cbsid="BUS004-B38" class="warn" data-testid="netm-remove-' +
              index +
              "\" onclick=\"netmAct('netDisconnect','" +
              esc(item.edge_id) +
              '\')">' +
              tx('Remove — their counters stop selling your products') +
              '</button>'
            : '<button data-cbsid="CMP008" data-testid="netm-remove-' +
              index +
              '" onclick="_NETO_ARMED=\'rm:' +
              esc(item.edge_id) +
              '\';loadSettings()">' +
              tx('Remove') +
              '</button>';
      else if (item.state === 'active' && item.edge_id)
        btns = '<button data-cbsid="BUS004-B39" data-testid="netm-pause-' + index + "\" onclick=\"netmAct('netSuspend','" + esc(item.edge_id) + '\')">' + tx('Pause') + '</button>';
      var words =
        item.state === 'requested'
          ? item.asked_by === 'store'
            ? tx('asks to join')
            : tx('invited — waiting for them')
          : tx(_NET_STATE[item.state] || item.state);
      return (
        '<div data-testid="netm-' +
        index +
        '" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:5px 0;border-top:1px solid var(--line)">' +
        '<span style="flex:1 1 200px;min-width:0"><b>' +
        esc(item.name || item.id) +
        '</b> <span style="font-size:var(--fs-1);color:var(--' +
        (item.state === 'active' ? 'ok' : 'warn-2') +
        ')">' +
        esc(words) +
        (item.via === 'built' ? ' · ' + esc(tx('your store')) : '') +
        '</span></span>' +
        btns +
        '</div>'
      );
    })
    .join('');
  return (
    '<div data-testid="neto-members" style="margin-bottom:8px">' +
    rows +
    '<div style="display:flex;gap:6px;align-items:center;margin-top:6px">' +
    '<input data-cbsid="BUS004-I48" id="netm_handle" data-testid="netm-handle" placeholder="' +
    esc(tx('Invite a store by its handle')) +
    '" style="flex:1;min-width:0">' +
    '<button data-cbsid="BUS004-B40" data-testid="netm-invite" onclick="netmInvite()">' +
    tx('Invite') +
    '</button></div></div>'
  );
}
function netStandingHTML(nw) {
  var m = nw.membership || { state: 'active' },
    name = esc(nw.brand_name || tx('this brand'));
  var head = function (words, color) {
    return '<div class="sec" style="margin:0 0 6px" data-testid="neto-network-' + esc(nw.brand_id) + '">' + words + '</div>' + (color ? '' : '');
  };
  if (m.state === 'active') return head(tx('Member of') + ' ' + name);
  var note = function (words, btns) {
    return (
      head(name) +
      '<div data-testid="neto-standing-' +
      esc(nw.brand_id) +
      '" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:var(--fs-2);color:var(--warn-2);margin-bottom:6px"><span style="flex:1 1 220px">' +
      words +
      '</span>' +
      (btns || '') +
      '</div>'
    );
  };
  if (m.state === 'invited')
    return note(
      esc(tx('invited your store to its network')),
      '<button data-cbsid="BUS004-B41" class="pri" data-testid="neto-accept-' +
        esc(nw.brand_id) +
        "\" onclick=\"netmAct('netApprove','" +
        esc(m.edge_id) +
        '\')">' +
        tx('Accept') +
        '</button>' +
        '<button data-cbsid="BUS004-B20" data-testid="neto-refuse-' +
        esc(nw.brand_id) +
        "\" onclick=\"netmAct('netDecline','" +
        esc(m.edge_id) +
        '\')">' +
        tx('Decline') +
        '</button>'
    );
  if (m.state === 'asked')
    return note(
      esc(tx('You asked to join — its products show here once it approves.')),
      '<button data-cbsid="BUS004-B21" data-testid="neto-unask-' +
        esc(nw.brand_id) +
        "\" onclick=\"netmAct('netDecline','" +
        esc(m.edge_id) +
        '\')">' +
        tx('Cancel request') +
        '</button>'
    );
  if (m.state === 'suspended') return note(esc(tx('paused your store — its products and offers are not shown here for now.')));
  return note(
    esc(tx('Not in its network — its products are not shown here.')),
    m.brand_node
      ? '<button data-cbsid="BUS004-B22" class="pri" data-testid="neto-ask-' +
          esc(nw.brand_id) +
          '" onclick="netmAsk(\'' +
          esc(m.brand_node) +
          '\')">' +
          tx('Ask to join') +
          '</button>'
      : ''
  );
}
function _netmDone() {
  if (typeof _DEFS !== 'undefined') delete _DEFS.offer;
  if (typeof UI !== 'undefined') UI._ctOffers = undefined;
  _NETO_ARMED = null;
  netoReload();
}
async function netmAct(ep, edgeId) {
  try {
    await api(ep, { params: { id: edgeId }, body: {} });
    toast(tx('Done'));
    _netmDone();
  } catch (e) {
    toast((e && e.message) || tx('Could not do that'), true);
  }
}
async function netmAsk(brandNode) {
  try {
    await api('netConnect', { body: { parentId: brandNode, type: 'commercial' } });
    toast(tx('Asked — the brand decides'));
    _netmDone();
  } catch (e) {
    toast((e && e.message) || tx('Could not ask'), true);
  }
}
async function netmInvite() {
  var el = document.getElementById('netm_handle'),
    h = el && el.value.trim();
  if (!h) return;
  try {
    await api('netConnect', { body: { childHandle: h, type: 'commercial' } });
    toast(tx('Invited — they decide'));
    _netmDone();
  } catch (e) {
    toast((e && e.message) || tx('Could not invite'), true);
  }
}
async function netoChoice(id, choice) {
  try {
    await api('netOfferChoice', { params: { id: id }, body: { choice: choice || null } });
    if (typeof toast === 'function') toast(tx('Saved — your counters are told'));
    netoReload();
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not save'), true);
  }
}
var _CTRS;
function ctrReload() {
  _CTRS = undefined;
  loadSettings();
}
function ctrRegisterHTML() {
  if (_CTRS === undefined) {
    _CTRS = null;
    api('counters')
      .then(function (reply) {
        _CTRS = reply || { counters: [] };
        if (setSec() === 'integrations') loadSettings();
      })
      .catch(function (e) {
        _CTRS = { counters: [], error: (e && e.message) || true };
        if (setSec() === 'integrations') loadSettings();
      });
  }
  if (_CTRS === null) return '<div style="' + _CARD + '">' + tx('reading…') + '</div>';
  var list = (_CTRS && _CTRS.counters) || [];
  var rows = list
    .map(function (item) {
      /* ⚠️ a counter on break is still HELD by its PC — shown as such, and still releasable only as a last resort */
      var onBreak = item.state === 'break',
        open = item.state === 'open' || onBreak,
        h = item.held_by || {};
      var where = onBreak
        ? '☕ ' +
          tx('on break') +
          (item.break_since ? ' ' + tx('since') + ' ' + esc(new Date(item.break_since).toTimeString().slice(0, 5)) : '') +
          (item.break_by ? ' · ' + esc(item.break_by) : '') +
          ' · ' +
          esc(h.name || tx('a PC'))
        : open
          ? tx('open on') +
            ' ' +
            esc(h.name || tx('a PC')) +
            (h.seen && h.seen.ip ? ' · ' + esc(h.seen.ip) : '') +
            (h.seen && h.seen.at ? ' · ' + esc(_keyAgo(h.seen.at)) : '')
          : item.state === 'opening'
            ? tx('opening…')
            : item.closed_at
              ? tx('closed') + ' ' + esc(_keyAgo(item.closed_at))
              : tx('not opened yet');
      var armed = _CLOSE_ARMED === 'rel:' + item.id;
      return (
        '<div data-testid="ctr-' +
        esc(item.id) +
        '" style="display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)">' +
        '<b class="mono" style="font-size:1.15em;min-width:2.4em">' +
        esc(item.id) +
        '</b>' +
        '<span style="flex:1;min-width:0"><span data-testid="ctr-name-' +
        esc(item.id) +
        '">' +
        esc(item.name) +
        '</span>' +
        '<div style="color:var(--grey);font-size:var(--fs-1)">' +
        (item.last_no ? tx('last bill') + ' ' + esc(item.last_no) + ' · ' : '') +
        (item.next ? tx('next') + ' ' + esc(String(item.next).padStart(4, '0')) + ' · ' : '') +
        '<span style="color:var(--' +
        (onBreak ? 'warn' : open ? 'ok' : 'grey') +
        ')" data-testid="ctr-state-' +
        esc(item.id) +
        '">' +
        where +
        '</span></div>' +
        (h.diag && h.diag.verdict ? '<div style="color:var(--warn);font-size:var(--fs-1)">🩺 ' + esc(h.diag.verdict) + '</div>' : '') +
        '</span>' +
        (open
          ? '<button data-cbsid="ACC002-B49" class="warn" data-testid="ctr-release-' +
            esc(item.id) +
            '" onclick="ctrRelease(\'' +
            esc(item.id) +
            '\')" title="' +
            esc(tx('only for a PC that cannot close the counter itself')) +
            '">' +
            (armed ? tx('Release — unsent bills stay on that PC') : tx('Release')) +
            '</button>'
          : '<button data-cbsid="ACC002-B50" class="pri" data-testid="ctr-open-' +
            esc(item.id) +
            '" onclick="ctrOpenHere(\'' +
            esc(item.id) +
            '\')"' +
            (item.state === 'opening' ? ' disabled' : '') +
            '>' +
            tx('Open on this PC') +
            '</button>') +
        '</div>'
      );
    })
    .join('');
  return (
    '<div style="' +
    _CARD +
    '">' +
    '<div class="sec" style="margin:0 0 6px">' +
    tx('Counters') +
    ' · ' +
    list.length +
    '</div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:6px">' +
    tx(
      'Each counter keeps its own number and its own bill series. Open it on a PC to bill; close it from that counter (☰ → Close this counter) and it can be opened again — here or on another PC — carrying on from its last bill. Only one PC can hold a counter at a time.'
    ) +
    '</div>' +
    (rows || '<div style="color:var(--grey);padding:6px 0">' + tx('No counters yet.') + '</div>') +
    '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
    '<input data-cbsid="ACC002-I21" class="inp" id="ctr_new_name" data-testid="ctr-new-name" placeholder="' +
    esc(tx('Name — Front desk, Billing 2 …')) +
    '" style="flex:1 1 220px">' +
    '<button data-cbsid="ACC002-B51" class="pri" data-testid="ctr-add" onclick="ctrAdd()">' +
    tx('Add a counter') +
    '</button></div>' +
    (_CTRS && _CTRS.error ? '<div style="color:var(--warn);font-size:var(--fs-1);margin-top:6px">' + tx('Could not read the counters.') + '</div>' : '') +
    '</div>'
  );
}
async function ctrAdd() {
  var el = document.getElementById('ctr_new_name');
  try {
    await api('counterAdd', { body: { name: ((el && el.value) || '').trim() } });
    if (typeof toast === 'function') toast(tx('Counter added'));
    ctrReload();
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not add the counter'), true);
  }
}
/**
 * ⭐ OPEN ON THIS PC — the key is minted FOR this counter and handed to the counter page, which takes the counter's
 * number and carries on its series. The same address shape counterGo() uses, so the counter checks it is the shop
 * it was opened for.
 */
async function ctrOpenHere(id) {
  try {
    var reply = await api('counterOpen', { params: { id: id } });
    if (!reply || !reply.key) throw new Error(tx('no key came back'));
    ctrOpenTill(reply.key); /* app/cap-settings.js — the one opener, CB Settings › Counters & keys calls it too */
    ctrReload();
  } catch (e) {
    /* ⚠️ held elsewhere is the ordinary refusal — say who has it, in the server's own words */
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not open the counter'), true);
    ctrReload();
  }
}
async function ctrRelease(id) {
  if (_CLOSE_ARMED !== 'rel:' + id) {
    _CLOSE_ARMED = 'rel:' + id;
    loadSettings();
    return;
  }
  _CLOSE_ARMED = null;
  try {
    await api('counterRelease', { params: { id: id } });
    if (typeof toast === 'function') toast(tx('Counter released'));
    ctrReload();
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not release it'), true);
  }
}
function intCountersHTML() {
  return ctrRegisterHTML() + '<div style="margin-top:12px">' + intPairingsHTML() + '</div>';
}
/* ⚠️ the pairings made before the register existed — still listed, because they may still hold bills */
function intPairingsHTML() {
  if (_KEYS === undefined) {
    _KEYS = null;
    api('keysList')
      .then(function (reply) {
        _KEYS = reply || { keys: [] };
        if (typeof setSec === 'function' && setSec() === 'integrations') loadSettings();
      })
      .catch(function () {
        _KEYS = { keys: [], error: true };
        if (setSec() === 'integrations') loadSettings();
      });
  }
  if (_KEYS === null) return '<div style="' + _CARD + '">' + tx('reading…') + '</div>';
  var tills = ((_KEYS && _KEYS.keys) || []).filter(function (item) {
    return item && (item.scopes || []).indexOf('till') >= 0;
  });
  var bridge = (typeof S !== 'undefined' && S && S.bridgeId) || '';
  if (!tills.length)
    return (
      '<div style="' +
      _CARD +
      '"><div class="sec" style="margin:0 0 6px">' +
      tx('Counters') +
      '</div>' +
      '<div style="color:var(--grey)">' +
      tx('No PC has been paired to this shop yet.') +
      '</div></div>'
    );

  var live = tills.filter(function (item) {
    return _keySeenAt(item) && Date.now() - _keySeenAt(item) < 900000;
  });
  var never = tills.filter(function (item) {
    return !_keySeenAt(item);
  });
  /* ⭐ two counters reporting the same address are one PC paired twice — much the commonest duplicate */
  var byIp = {};
  tills.forEach(function (item) {
    var ip = item.seen && item.seen.ip;
    if (ip) (byIp[ip] = byIp[ip] || []).push(item);
  });
  var dupIps = Object.keys(byIp).filter(function (item) {
    return byIp[item].length > 1;
  });

  var rows = tills
    .slice()
    .sort(function (first, second) {
      return _keySeenAt(second) - _keySeenAt(first);
    })
    .map(function (item) {
      var at = _keySeenAt(item),
        ip = (item.seen && item.seen.ip) || null,
        d = item.diag || null;
      var shut = !!(item.till && item.till.closed_at);
      var state = shut
        ? { c: 'grey', t: tx('closed') + ' ' + _keyAgo(item.till.closed_at) + (item.till.id ? ' · ' + item.till.id : '') }
        : !at
          ? { c: 'warn', t: tx('never reached us') }
          : Date.now() - at < 900000
            ? { c: 'ok', t: tx('open now') }
            : { c: Date.now() - at > 86400000 ? 'warn' : 'grey', t: _keyAgo(item.seen.at) };
      var armed = _CLOSE_ARMED === item.jti;
      return (
        '<div data-testid="int-counter-' +
        esc(item.jti) +
        '" style="display:flex;gap:10px;align-items:baseline;padding:8px 0;border-top:1px solid var(--line)">' +
        '<span style="flex:1"><b>' +
        esc(item.name || 'counter') +
        '</b>' +
        (ip && byIp[ip].length > 1 ? ' <span style="color:var(--warn);font-size:var(--fs-1)">' + tx('same PC as another counter') + '</span>' : '') +
        '<div style="color:var(--grey);font-size:var(--fs-1)">' +
        esc(bridge || tx('no bridge id')) +
        ' · …' +
        esc(item.last4 || '') +
        ' · ' +
        tx('paired') +
        ' ' +
        esc(String(item.created_at || '').slice(0, 10)) +
        (ip ? ' · ' + esc(ip) : '') +
        (item.seen && item.seen.agent ? ' · ' + esc(_agentName(item.seen.agent)) : '') +
        '</div>' +
        /* ⭐ what the counter itself last said — it can see things this side never will */
        (d && d.verdict
          ? '<div style="color:var(--warn);font-size:var(--fs-1)" data-testid="int-counter-said-' + esc(item.jti) + '">🩺 ' + esc(d.verdict) + '</div>'
          : '') +
        '</span>' +
        '<span style="color:var(--' +
        state.c +
        ');font-size:var(--fs-1);white-space:nowrap">' +
        esc(state.t) +
        '</span>' +
        /* ⚠️ two presses, and the second one SAYS WHAT IT COSTS — closing strands whatever that PC has not sent */
        '<button data-cbsid="ACC002-B52" class="warn" data-testid="int-counter-close-' +
        esc(item.jti) +
        '" onclick="intCounterClose(\'' +
        esc(item.jti) +
        '\')">' +
        (armed ? tx('Really close — unsent bills stay on that PC') : tx('Close')) +
        '</button>' +
        '</div>'
      );
    })
    .join('');

  var note = '';
  if (never.length)
    note +=
      '<div style="color:var(--warn);font-size:var(--fs-2);margin-top:10px" data-testid="int-counter-unreached">' +
      esc(
        never.length +
          ' ' +
          tx(
            'counter(s) have never reached us. They are not being refused — nothing from them has arrived at all, so look at the network or firewall on those PCs rather than at permissions here.'
          )
      ) +
      '</div>';
  if (dupIps.length)
    note +=
      '<div style="color:var(--warn);font-size:var(--fs-2);margin-top:10px" data-testid="int-counter-dups">' +
      esc(tx('The same PC is paired more than once. Each pairing keeps its own copy of the bills on that machine and only the one in use is sent from.')) +
      ' <button data-cbsid="ACC002-B53" data-testid="int-counter-close-dups" onclick="intCounterCloseDups()">' +
      tx('Close the unused duplicates') +
      '</button></div>';

  return (
    '<div style="' +
    _CARD +
    '">' +
    '<div class="sec" style="margin:0 0 6px">' +
    tx('Pairings — every PC ever paired to this shop') +
    ' · ' +
    tills.length +
    (live.length ? ' · ' + live.length + ' ' + tx('open now') : '') +
    '</div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-bottom:6px">' +
    tx('Each pairing is one PC opening a counter. A closed pairing is kept as history; its counter can be opened again above.') +
    '</div>' +
    rows +
    note +
    '</div>'
  );
}
/* _keySeenAt · _keyAgo · _agentName → app/cap-settings.js (T3-SETTINGS: CB Settings › Counters & keys reads them too) */
var _CLOSE_ARMED = null;
/**
 * ⚠️⚠️ CLOSING A COUNTER REVOKES ITS KEY EVERYWHERE, AND ANYTHING IT HAD NOT SENT IS STRANDED ON THAT PC. The
 * bills are not destroyed — they sit in that machine's own copy — but nothing can send them once the key is gone.
 * So the second press says that, in those words, instead of asking "are you sure?" about a cost it never names.
 */
async function intCounterClose(jti) {
  if (_CLOSE_ARMED !== jti) {
    _CLOSE_ARMED = jti;
    loadSettings();
    return;
  }
  _CLOSE_ARMED = null;
  try {
    await api('keysRevoke', { params: { jti: jti } });
    _KEYS = undefined;
    if (typeof toast === 'function') toast(tx('Counter closed'));
    loadSettings();
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not close it'), true);
  }
}
/**
 * ⭐ CLOSE THE UNUSED DUPLICATES — where one PC holds several pairings, keep the one that spoke most recently and
 * close the rest.
 * ⚠️⚠️ NEVER A COUNTER THAT HAS NEVER REPORTED. We cannot tell whether it is idle or simply unable to reach us,
 * and closing the one that cannot call for help is the worst guess available — it is also exactly the counter
 * somebody is most likely to be trying to fix.
 */
async function intCounterCloseDups() {
  var tills = ((_KEYS && _KEYS.keys) || []).filter(function (item) {
    return item && (item.scopes || []).indexOf('till') >= 0;
  });
  var byIp = {};
  tills.forEach(function (item) {
    var ip = item.seen && item.seen.ip;
    if (ip) (byIp[ip] = byIp[ip] || []).push(item);
  });
  var kill = [];
  Object.keys(byIp).forEach(function (item) {
    byIp[item]
      .slice()
      .sort(function (first, second) {
        return _keySeenAt(second) - _keySeenAt(first);
      })
      .slice(1)
      .forEach(function (entry) {
        if (_keySeenAt(entry)) kill.push(entry);
      });
  });
  if (!kill.length) {
    if (typeof toast === 'function') toast(tx('There are no duplicates that can be closed safely.'));
    return;
  }
  if (_CLOSE_ARMED !== 'dups') {
    _CLOSE_ARMED = 'dups';
    if (typeof toast === 'function') toast(tx('Press again to close') + ' ' + kill.length + ' ' + tx('duplicate counter(s). The newest on each PC is kept.'));
    return;
  }
  _CLOSE_ARMED = null;
  for (var index = 0; index < kill.length; index++) {
    try {
      await api('keysRevoke', { params: { jti: kill[index].jti } });
    } catch (_) {}
  }
  _KEYS = undefined;
  loadSettings();
}
function integrationsSettingsHTML() {
  if (_KEYS === undefined) {
    _KEYS = null;
    api('keysList')
      .then(function (reply) {
        _KEYS = reply || { keys: [] };
        if (typeof setSec === 'function' && setSec() === 'integrations') loadSettings();
      })
      .catch(function () {
        _KEYS = { keys: [], error: true };
        if (setSec() === 'integrations') loadSettings();
      });
  }
  var keys = (_KEYS && _KEYS.keys) || [];
  var base = (typeof CFG !== 'undefined' && CFG.API_BASE) || '';
  /**
   * ⭐⭐ WHEN EACH KEY LAST SPOKE, AND FROM WHERE. Athi, 2026-09-16, with one counter pushing bills and another
   * silent: *"can we trace the ip for each counter app and see what the restrictions are?"* The list named every
   * key and said nothing about whether any of them was alive.
   * ⚠️⚠️ "NEVER REACHED" IS THE LOUD ANSWER, NOT A BLANK. A counter that has never arrived here is not being
   * refused by us — it is not getting here, which points at the network in front of it. That distinction is the
   * difference between hunting a permissions bug and telephoning an office firewall, so it is said in words.
   */
  var _keyAgo = function (iso) {
    if (!iso) return null;
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return tx('just now');
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 172800) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  };
  var _keySeen = function (k) {
    var sn = k && k.seen;
    if (!sn || !sn.at) return '<span data-testid="int-key-seen-' + esc(k.jti) + '" style="color:var(--warn)">' + tx('never reached us') + '</span>';
    var quiet = Date.now() - new Date(sn.at).getTime() > 86400000;
    return (
      '<span data-testid="int-key-seen-' +
      esc(k.jti) +
      '" style="color:var(--' +
      (quiet ? 'warn' : 'ok') +
      ')">' +
      esc(_keyAgo(sn.at)) +
      (sn.ip ? ' · ' + esc(sn.ip) : '') +
      '</span>'
    );
  };
  var rows = keys.length
    ? keys
        .map(function (item) {
          return (
            '<div class="row" data-testid="int-key-' +
            esc(item.jti) +
            '" style="display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line)"><b style="flex:1">' +
            esc(item.name) +
            '</b><span style="color:var(--grey);font-size:var(--fs-1)">' +
            esc((item.scopes || []).join(', ')) +
            ' · …' +
            esc(item.last4 || '') +
            ' · ' +
            esc(String(item.created_at || '').slice(0, 10)) +
            ' · ' +
            _keySeen(item) +
            '</span><button data-cbsid="ACC002-B54" class="warn" data-testid="int-key-revoke-' +
            esc(item.jti) +
            '" onclick="intKeyRevoke(\'' +
            esc(item.jti) +
            '\')">' +
            tx('Revoke') +
            '</button></div>'
          );
        })
        .join('')
    : '<div style="color:var(--grey)">' + tx(_KEYS === null ? 'reading…' : 'No keys yet.') + '</div>';
  var tab = intTab();
  var head = _misHead(
    'Integrations',
    tx(
      (
        INT_TABS.filter(function (item) {
          return item.key === tab;
        })[0] || {}
      ).q || 'Connectors, services and the keys they use'
    )
  );
  if (tab === 'connectors' || tab === 'running') return head + intConnectorsHTML();
  if (tab === 'streams') return head + intStreamsHTML();
  if (tab === 'books') return head + intReconcileHTML();
  if (tab === 'store') return head + intProfileMapHTML();
  if (tab === 'counters') return head + intCountersHTML();
  if (tab === 'netoffers') return head + netOffersHTML();
  return (
    head +
    '<div style="' +
    _CARD +
    '"><div class="sec" style="margin:0 0 6px">' +
    tx('The services') +
    '</div>' +
    '<div style="font-size:var(--fs-2)">' +
    tx(
      'Another system sends lines and gets back the governed answer — the unit price at a quantity, what comes off and why, the tax, the whole invoice — from the same engines the storefront, compose and the chit use.'
    ) +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px"><code>/api/offers</code> · <code>/api/pricing</code> · <code>/api/tax</code> · <code>/api/invoice</code> — <a href="' +
    esc(base) +
    '/api/openapi.json" target="_blank" rel="noopener">' +
    tx('the contract (openapi.json)') +
    '</a></div></div>' +
    '<div style="' +
    _CARD +
    '"><div class="sec" style="margin:0 0 6px">' +
    tx('Your keys') +
    '</div>' +
    rows +
    '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><input data-cbsid="ACC002-I22" class="inp" id="int_key_name" data-testid="int-key-name" placeholder="' +
    esc(tx('Name — which system')) +
    '" style="flex:1 1 200px"><select data-cbsid="ACC002-S14" class="inp" id="int_key_scope" data-testid="int-key-scope" style="flex:0 0 220px">' +
    KEY_SCOPES.map(function (item) {
      return '<option value="' + esc(item[0]) + '">' + esc(tx(item[1])) + '</option>';
    }).join('') +
    '</select><button data-cbsid="ACC002-B55" class="pri" data-testid="int-key-mint" onclick="intKeyMint()">' +
    tx('Mint a key') +
    '</button></div>' +
    '<div id="int_key_out">' +
    (_KEY_SHOWN || '') +
    '</div></div>'
  );
}
async function intKeyMint() {
  var node = (document.getElementById('int_key_name') || {}).value || '';
  var sc = (document.getElementById('int_key_scope') || {}).value || 'offers';
  /* a connector key also evaluates offers — the scope names the larger surface (routes/keys.js · middleware/auth.js KEY_ROUTES) */
  try {
    var reply = await api('keysMint', { body: { name: node || 'key', scopes: keyScopesOf(sc) } });
    _KEY_SHOWN =
      '<div data-testid="int-key-shown" style="margin-top:10px;padding:10px;border:1px dashed var(--warn-3);border-radius:9px;font-size:var(--fs-1)"><b>' +
      tx('Copy it now — it is shown once.') +
      '</b><div style="word-break:break-all;font-family:monospace;margin-top:6px" data-testid="int-key-value">' +
      esc(reply.key) +
      '</div><div style="color:var(--grey);margin-top:6px">' +
      tx('Send it as') +
      ' <code>X-Api-Key: …</code> ' +
      tx('or') +
      ' <code>Authorization: Bearer …</code></div></div>';
    _KEYS = undefined;
    if (typeof toast === 'function') toast(tx('Key minted ✓'));
    loadSettings(); /* the list repaints; the shown key rides _KEY_SHOWN into the repaint */
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not mint'), true);
  }
}
async function intKeyRevoke(jti) {
  try {
    await api('keysRevoke', { params: { jti: jti } });
    _KEYS = undefined;
    _KEY_SHOWN = '';
    if (typeof toast === 'function') toast(tx('Key revoked'));
    loadSettings();
  } catch (e) {
    if (typeof toast === 'function') toast((e && e.message) || tx('Could not revoke'), true);
  }
}
/**
 * ── ⭐⭐⭐ TWO QUESTIONS, IN WORDS A SHOPKEEPER ALREADY USES ────────────────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"this is what the user is going to see, he won't understand public, private etc. so we
 * have to provide a very easy way of doing things, please follow standard or borrow from other systems."*
 *
 * So nothing on this screen says public, private, internal, entity or catalogue. It asks what the shop DOES,
 * and stores the setting. Google Business asks *"do customers visit you?"* rather than *"set location type"*;
 * Xero asks *"do you sell this?"* rather than *"set item classification"*. Same move.
 *
 * ⚠️ FOUR OPTIONS, NOT TWO CHECKBOXES. Xero's ☐ buy ☐ sell works because those are independent facts. Goods
 * vs services is ONE question with four answers, and "neither" cannot be said by leaving both boxes empty —
 * an empty pair reads as "did not answer", which must stay different from "supplies nothing". Same trap as
 * `plan` defaulting to free before b230.
 *
 * ⚠️ AND THREE THINGS ARE DELIBERATELY ABSENT:
 *   · "only my network"  — set when the network is DRAWN (network-design.js mints each node with its
 *                          visibility) and the operator can cap it. Never the shop's to answer.
 *   · root or branch     — follows from the network they were invited into. "Am I a billing root?" has no
 *                          good answer from a branch manager.
 *   · internal           — not a choice a shop can make. It is what WE are.
 */
var BIZ_DOES = [
  ['goods', 'I sell products', 'A shop, a wholesaler, a trader.'],
  ['services', 'I do jobs for customers', 'A garage, a helpdesk, an accountant \u2014 the work is quoted, not listed.'],
  ['both', 'Both', 'Jobs and the parts that go with them.'],
  ['none', 'Neither \u2014 I only buy for my own use', 'Nothing is sold on. Stock is consumed.']
];
var BIZ_LIST = [
  ['public', 'Show it to customers', 'Anyone on the rail can see what you sell and order from it.'],
  ['private', 'Keep it internal \u2014 I bill from it', 'Your list stays yours. You can still be found, and still be sent work.']
];

function bizChoice(group, val, cur, rows) {
  return rows
    .map(function (item) {
      var on = String(cur) === item[0];
      return (
        '<label data-testid="biz-' +
        group +
        '-' +
        item[0] +
        '" style="display:flex;gap:10px;align-items:flex-start;' +
        'padding:11px 13px;border-bottom:1px solid var(--line-soft);cursor:pointer;' +
        /* ⚠️ THE CHOSEN ROW NEEDS MORE THAN A TINT. --wash against --card is nearly invisible in a dark theme
         — on Athi's screenshot the radio dot was carrying the selection on its own. A left bar in --blue is
         a border, not a background, so it survives every one of the fifteen themes at full strength. */
        (on ? 'background:var(--wash);box-shadow:inset 3px 0 0 var(--blue)' : 'box-shadow:inset 3px 0 0 transparent') +
        '">' +
        '<input data-cbsid="ACC002-I23" type="radio" name="biz_' +
        group +
        '" value="' +
        esc(item[0]) +
        '"' +
        (on ? ' checked' : '') +
        ' onchange="bizPick(\'' +
        group +
        '\', this.value)" style="margin-top:3px;flex:none">' +
        '<span style="flex:1"><span style="font-weight:650;font-size:var(--fs-2)">' +
        esc(tx(item[1])) +
        '</span>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px;line-height:1.45">' +
        esc(tx(item[2])) +
        '</div></span></label>'
      );
    })
    .join('');
}

function businessSettingsHTML(s) {
  var me = (s && s.entity) || UI._me || {};
  /* ⚠️ unknown is never OFFERED. It is what the column holds until somebody answers, and showing it as a
     choice would invite people to pick "I have not decided", which is not a fact about a business. */
  var does = me.supplies && me.supplies !== 'unknown' ? me.supplies : '';
  var list = me.catalogue_visibility === 'public' ? 'public' : me.catalogue_visibility === 'private' ? 'private' : '';
  var card = function (title, sub, inner, note) {
    return (
      '<div style="border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;' +
      'margin-bottom:var(--sp-4);background:var(--card);color:var(--on-card)">' +
      '<div style="padding:12px 13px 9px"><div style="font-weight:700;font-size:var(--fs-3);' +
      "font-family:'Space Grotesk'\">" +
      esc(tx(title)) +
      '</div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
      esc(tx(sub)) +
      '</div></div>' +
      inner +
      (note || '') +
      '</div>'
    );
  };
  /* ⭐ the network row is SHOWN, never editable, and only when it applies — so a shop in a group can see why
     its list behaves differently without being offered a switch that is not theirs to throw. */
  var netNote =
    me.catalogue_visibility === 'network'
      ? '<div style="color:var(--on-card);padding:10px 13px;background:var(--blue-tint);font-size:var(--fs-1);line-height:1.5">' +
        '<b>' +
        tx('Your group decides this one.') +
        '</b> ' +
        tx('Your list is shared with the shops in your group. That was set when your group was built, and it is not changed here.') +
        '</div>'
      : '';
  return (
    '<div style="max-width:560px">' +
    /* SET-46 (walk 2026-10-25 W5/W29): a choice MARKS, Save + confirm writes (Settings: Save + confirm); the box is repainted from the answer */
    card('What do you do?', 'This is how other businesses understand you.', '<div id="biz_does_box">' + bizChoice('does', does, does, BIZ_DOES) + '</div>') +
    card('Your price list', 'Your products and what they cost.', netNote ? '' : '<div id="biz_list_box">' + bizChoice('list', list, list, BIZ_LIST) + '</div>', netNote) +
    '<div style="margin:-6px 0 var(--sp-4)"><button data-cbsid="CMP001" type="button" class="act" id="biz_save" data-testid="biz-save" disabled onclick="bizSaveAsk()">' +
    esc(tx('Save')) +
    '</button></div>' +
    /* ⚠️⚠️ A PRESELECTED RADIO ASSERTS AN ANSWER NOBODY GAVE. 'goods' is this column's long-standing DEFAULT
       (b238), so a legacy row shows 'I sell products' chosen whether the shop said so or not — and from here
       it is indistinguishable from a real answer. The radio cannot be un-chosen honestly, so the screen SAYS
       so instead, once, quietly. New registrations read 'unknown' and show nothing selected, which is why
       this line only appears for the older rows. */
    (me.supplies === 'goods' && !me._supplies_confirmed
      ? '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.5;margin:-8px 0 var(--sp-4)">' +
        tx('If that is not right, change it — it was filled in for you, not chosen by you.') +
        '</div>'
      : '') +
    /* NET-39 (Athi, 2026-10-25): most trade stays inside; a shop is shown on other installations only when it opts in (trade_mode = export). Painted after a read, saved with a confirm. */
    card('Selling abroad', 'Most trade stays on your own ChitBridge. This is for shops that want buyers elsewhere.', '<div id="biz_abroad" data-testid="biz-abroad" style="padding:0 13px 12px;font-size:var(--fs-1);color:var(--grey)">' + esc(tx('Reading…')) + '</div>') +
    '<div id="biz_said" style="font-size:var(--fs-1);color:var(--grey);min-height:18px"></div>' +
    /* ⭐ THE LEDGER'S SWITCH (Athi, 2026-10-01: "add the switch-on control in settings"). Owner only — the server
       refuses everyone else. Painted from GET /api/books/status once the card is on the screen (bizLedgerLoad), so
       the card never asserts a state it has not read. */
    (SESSION.role === 'entity' /* the shop's own session is its owner (routes/books.js isOwner: no api key, no parent entity); an actor is not */
      ? card(
          'Ledger',
          'A record of what is owed and paid, kept by double-entry.',
          '<div id="biz_ledger" data-testid="biz-ledger" style="padding:0 13px 12px;font-size:var(--fs-1);color:var(--grey)">' + esc(tx('Reading…')) + '</div>'
        )
      : '') +
    '</div>'
  );
}
/** the Selling abroad card: the switch is the shop's trade profile (trade_mode = export), read once, saved only after a Save and a confirm */
async function bizAbroadLoad() {
  var box = document.getElementById('biz_abroad');
  if (!box) return;
  try {
    var profile = await api('profileGet');
    UI._abroadProfile = profile;
    var on = profile && profile.trade_mode === 'export';
    box.innerHTML =
      '<label style="display:flex;gap:8px;align-items:flex-start;color:var(--on-card)"><input data-cbsid="ACC002-I24" type="checkbox" id="biz_abroad_on" data-testid="biz-abroad-on"' +
      (on ? ' checked' : '') +
      ' style="margin-top:3px"><span>' +
      esc(tx('Show my shop to buyers on other ChitBridge installations and abroad')) +
      '</span></label><div style="margin-top:8px"><button data-cbsid="CMP001" type="button" class="act" data-testid="biz-abroad-save" onclick="bizAbroadSave()">' +
      esc(tx('Save')) +
      '</button></div>';
  } catch (ex) {
    box.textContent = tx('Could not read this setting. Try again.');
    console.warn('bizAbroadLoad: profile unread', ex && ex.message);
  }
}
/** Save → confirm → PUT the whole profile with only trade_mode changed (markets, sectors and certificates are kept as they are) */
function bizAbroadSave() {
  var box = document.getElementById('biz_abroad_on');
  var profile = UI._abroadProfile;
  if (!box || !profile) return;
  var on = !!box.checked;
  confirmAsk(
    on ? 'Show my shop to buyers on other ChitBridge installations and abroad?' : 'Stop showing my shop outside your own ChitBridge?',
    on
      ? 'Buyers elsewhere can find your shop and see your public price list. Your private details stay private.'
      : 'Only buyers on your own ChitBridge will find your shop.',
    on ? 'Show it' : 'Keep it here',
    async function () {
      try {
        UI._abroadProfile = await api('profilePut', {
          body: { trade_mode: on ? 'export' : 'domestic', markets: profile.markets || [], sectors: profile.sectors || [], adopted: profile.adopted || [] }
        });
        toast(tx(on ? 'Saved ✓ — your shop shows outside your own ChitBridge' : 'Saved ✓ — your shop shows only on your own ChitBridge'));
      } catch (ex) {
        toast(ex && ex.message ? ex.message : tx('Not saved. Try again.'));
        bizAbroadLoad();
      }
    }
  );
}
/** the Ledger card's one read — nothing is shown until the server has answered */
async function bizLedgerLoad() {
  var box = document.getElementById('biz_ledger');
  if (!box) return;
  try {
    var reply = await api('booksStatus');
    box.innerHTML = bizLedgerHTML(reply || {});
  } catch (e) {
    box.innerHTML = esc(tx('Could not read the Ledger’s state.'));
  }
}
function bizLedgerHTML(r) {
  if (r.migrated === false) return '<span data-testid="biz-ledger-state">' + esc(tx('Not ready on this server yet.')) + '</span>';
  /* ⭐ CS1: the server says whether the books MAY open here (r.country, from engines regulation.status) — a country with no pack, no country, or
     the setup still to do: the switch is not offered; its sentence is, with the one button that fixes it (Country setup) */
  if (r.country && r.country.books === false && !r.enabled) {
    return (
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span data-testid="biz-ledger-state">○ ' +
      esc(tx('Off')) +
      '</span>' +
      '<span data-testid="biz-ledger-country" style="color:var(--warn-2)">' +
      esc(r.country.why || '') +
      '</span>' +
      '<a data-cbsid="ACC002-C20" class="pri" data-testid="biz-ledger-country-setup" data-to="#/country" onclick="go(this.dataset.to)" style="cursor:pointer">' +
      esc(tx('Country setup')) +
      '</a></div>'
    );
  }
  if (r.enabled) {
    return (
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span data-testid="biz-ledger-state" style="color:var(--ok)">● ' +
      esc(tx('On')) +
      '</span>' +
      '<span>' +
      esc(tx('Walk-in sales recorded per')) +
      ' <b>' +
      esc(tx(r.walkin_grain === 'bill' ? 'bill' : r.walkin_grain === 'shift' ? 'shift' : 'day')) +
      '</b></span>' +
      '<button data-cbsid="ACC002-B56" data-testid="biz-ledger-off" onclick="bizLedgerSwitch(false)">' +
      esc(tx('Switch off')) +
      '</button></div>'
    );
  }
  return (
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span data-testid="biz-ledger-state">○ ' +
    esc(tx('Off')) +
    '</span>' +
    '<button data-cbsid="ACC002-B57" class="pri" data-testid="biz-ledger-on" onclick="bizLedgerSwitch(true)">' +
    esc(tx('Switch on')) +
    '</button>' +
    '<span>' +
    esc(tx('From today. What people owed before goes in as opening balances.')) +
    '</span></div>'
  );
}
/** on: POST /api/books/enable (seeds the chart, this year’s months, a number for every party) · off: POST /setting */
function bizLedgerSwitch(on) {
  var box = document.getElementById('biz_ledger');
  if (!box) return;
  /* ⭐ the words, the confirm's wording and the call are CBLedger's (app/accounts-shell.js) — the CB Accounts page and
     the index tile switch the Ledger on through the same one; only the box and what follows are this card's */
  CBLedger.run(on, {
    ask: confirmAsk,
    working: function () {
      box.innerHTML = esc(tx('Working…'));
    },
    call: function (nestedOn) {
      return CBLedger.call({ api: api }, nestedOn);
    },
    done: async function (nestedOn) {
      SESSION.booksOn = nestedOn;
      if (nestedOn) {
        try {
          await ensureCap('books');
        } catch (_) {}
      }
      bgRenderApp(); /* the Ledger door appears (or goes) on the menu */
      await bizLedgerLoad();
      toast(nestedOn ? tx('The Ledger is on.') : tx('The Ledger is off.'));
    },
    failed: function (e) {
      box.innerHTML = esc(tx('Could not switch it.')) + ' ' + esc(typeof friendlyErr === 'function' ? friendlyErr(e) : '');
    }
  });
}

/** ⚠️ SAVES ON CHANGE, and says so. A Save button on two radio groups is a button people forget to press. */
/** the answer each card shows: what is pending, else what is saved */
function bizCurrent(group) {
  var entity = (UI._set && UI._set.s && UI._set.s.entity) || UI._me || {};
  var pend = UI._bizPending || {};
  if (pend[group] != null) return pend[group];
  return group === 'does' ? bizSavedSupplies(entity) : bizSavedVisibility(entity);
}
/** what the shop supplies as saved: goods, services..., or '' while it is still unknown */
function bizSavedSupplies(entity) {
  return entity.supplies && entity.supplies !== 'unknown' ? entity.supplies : '';
}
/** the price list's saved visibility: 'public' or 'private', else '' (not chosen yet) */
function bizSavedVisibility(entity) {
  return entity.catalogue_visibility === 'public' || entity.catalogue_visibility === 'private' ? entity.catalogue_visibility : '';
}
/** repaint ONE card's choices and the Save button from the current answers (repaint locally) */
function bizRepaint() {
  [['does', BIZ_DOES], ['list', BIZ_LIST]].forEach(function (card) {
    var box = document.getElementById('biz_' + card[0] + '_box');
    if (box) box.innerHTML = bizChoice(card[0], bizCurrent(card[0]), bizCurrent(card[0]), card[1]);
  });
  var btn = document.getElementById('biz_save');
  if (btn) btn.disabled = !Object.keys(UI._bizPending || {}).length;
}
/** a choice is marked, not saved */
function bizPick(group, val) {
  UI._bizPending = UI._bizPending || {};
  var entity = (UI._set && UI._set.s && UI._set.s.entity) || UI._me || {};
  var saved = group === 'does' ? entity.supplies : entity.catalogue_visibility;
  if (String(saved) === String(val)) delete UI._bizPending[group];
  else UI._bizPending[group] = val;
  var said = document.getElementById('biz_said');
  if (said) said.textContent = Object.keys(UI._bizPending).length ? tx('Not saved yet — press Save.') : '';
  bizRepaint();
}
/** Save → confirm, naming what changes and who it reaches → write */
function bizSaveAsk() {
  var pend = UI._bizPending || {};
  var rows = [];
  if (pend.does) rows.push(tx('What you do') + ': ' + tx((BIZ_DOES.find(function (choice) { return choice[0] === pend.does; }) || [0, pend.does])[1]));
  if (pend.list) rows.push(tx('Your price list') + ': ' + tx((BIZ_LIST.find(function (choice) { return choice[0] === pend.list; }) || [0, pend.list])[1]) + ' — ' + tx((BIZ_LIST.find(function (choice) { return choice[0] === pend.list; }) || [0, 0, ''])[2]));
  if (!rows.length) return;
  confirmAsk(tx('Save these changes?'), rows.map(function (sentence) { return '<div style="margin-bottom:6px">' + esc(sentence) + '</div>'; }).join(''), tx('Save'), function () {
    bizSave(pend);
  });
}
/** writes the pending answers of the two cards, then mirrors them into the held entity and repaints */
async function bizSave(pend) {
  var said = document.getElementById('biz_said');
  if (said) said.textContent = tx('Saving…');
  var body = {};
  if (pend.does) body.supplies = pend.does;
  if (pend.list) body.catalogue_visibility = pend.list;
  try {
    /* ⚠️ 'saveProfile', not a name I invented. My first version called api('profileUpdate') — no such
       endpoint, so every save would have thrown 'no endpoint profileUpdate' and the catch below would have
       shown that to a shopkeeper. Caught by grepping EP before trusting the name. */
    await api('saveProfile', { body: body });
    [UI._me, UI._set && UI._set.s && UI._set.s.entity].forEach(function (holder) {
      if (!holder) return;
      if (body.supplies) holder.supplies = body.supplies;
      if (body.catalogue_visibility) holder.catalogue_visibility = body.catalogue_visibility;
    });
    UI._bizPending = {};
    bizRepaint();
    if (said) said.textContent = tx('Saved.');
    toast(tx('Saved'));
  } catch (e) {
    /* ⚠️ the reason, not a shrug. A refused save that says nothing leaves the radio looking chosen. */
    if (said) said.textContent = tx('Not saved') + ' — ' + String((e && e.message) || e);
    loadSettings();
  }
}
/**
 * ── ⭐⭐⭐ WHERE WORK GOES — the screen, so nobody writes SQL ────────────────────────────────────────────────────
 *
 * Athi, 2026-09-14: *"it has to be very simple, we should not raise a SQL, it should be configurable"* —
 * *"because we should be able to give this model to anyone who wants to run a simple helpdesk service."*
 *
 * ⭐ THAT SECOND SENTENCE DECIDED WHERE IT LIVES. Not the operator's Platform screen: every entity routes its
 * OWN work, so a shop running a helpdesk points faults at one person and requests at another, exactly as CBINC
 * does. Settings › Work already asks *"how tasks reach people"* — this is the answer to that question.
 *
 * ⭐ ONE ROW PER KIND, THREE ANSWERS: which folder, which person, which team. Saved the moment it is chosen —
 * there is no Save button, because a routing rule is one dropdown and a form that needs confirming for one
 * dropdown is a form that gets abandoned half-set.
 *
 * ⚠️ AND EVERY LIST COMES FROM THE SERVER WITH THE ROWS. Populating three dropdowns from three other calls is
 * three chances to offer a folder that was deleted this morning.
 */
var _WROUTE = null;

async function workRoutingLoad(force) {
  if (_WROUTE && !force) return _WROUTE;
  try {
    _WROUTE = await api('workRouting', {});
  } catch (e) {
    _WROUTE = { error: String((e && e.message) || e) };
  }
  return _WROUTE;
}

function workRoutingHTML() {
  var d = _WROUTE;
  if (!d) return '<div style="color:var(--grey);font-size:var(--fs-2)">' + '<span class="spin"></span> ' + tx('reading where work goes…') + '</div>';
  if (d.error) {
    /* ⚠️ said plainly, with the remedy. "Could not load" on its own sends somebody to ask me. */
    return (
      '<div style="color:var(--warn-3);background:var(--warn-tint);border:1px solid var(--warn-2);border-radius:var(--r-md);' +
      'padding:9px 11px;font-size:var(--fs-1);line-height:1.5"><b>' +
      esc(tx('Not set up yet')) +
      '</b><div>' +
      esc(d.error) +
      '</div></div>'
    );
  }
  var sel = function (id, kind, field, cur, list, none) {
    return (
      '<select data-cbsid="ACC002-S15" class="inp" data-testid="wr-' +
      field +
      '-' +
      kind +
      '" ' +
      'style="min-width:132px;padding:4px 7px;font-size:var(--fs-1);border-radius:var(--r-sm)" ' +
      'onchange="workRoutingSet(\'' +
      kind +
      "','" +
      field +
      '\',this.value)">' +
      '<option value="">' +
      esc(tx(none)) +
      '</option>' +
      list
        .map(function (item) {
          return '<option value="' + esc(item[0]) + '"' + (String(cur || '') === String(item[0]) ? ' selected' : '') + '>' + esc(item[1]) + '</option>';
        })
        .join('') +
      '</select>'
    );
  };
  var folders = (d.folders || []).map(function (item) {
    return [item.folder_id, item.name];
  });
  var people = (d.people || []).map(function (item) {
    return [item.identity_id, item.display_name];
  });
  var teams = (d.teams || []).map(function (item) {
    return [item.identity_id, item.display_name];
  });

  var rows = (d.kinds || [])
    .map(function (item) {
      return (
        '<tr>' +
        '<td style="padding:7px 9px;border-bottom:1px solid var(--line-soft);white-space:nowrap">' +
        '<b style="font-weight:650">' +
        esc(tx(item.label)) +
        '</b>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);font-weight:400">' +
        esc(tx(item.hint)) +
        '</div></td>' +
        '<td style="padding:7px 9px;border-bottom:1px solid var(--line-soft)">' +
        sel('', item.kind, 'folder', item.folder_id, folders, 'no folder') +
        '</td>' +
        '<td style="padding:7px 9px;border-bottom:1px solid var(--line-soft)">' +
        sel('', item.kind, 'person', item.assignee_actor_id, people, 'nobody in particular') +
        '</td>' +
        '<td style="padding:7px 9px;border-bottom:1px solid var(--line-soft)">' +
        (teams.length
          ? sel('', item.kind, 'team', item.route_to_entity_id, teams, 'keep it here')
          : /* ⚠️ absent rather than empty: an enabled dropdown with one option teaches nothing, and a disabled one
            with no explanation reads as broken. */
            '<span style="font-size:var(--fs-1);color:var(--grey-4)">' + esc(tx('no teams yet')) + '</span>') +
        '</td></tr>'
      );
    })
    .join('');

  var th = function (t) {
    return (
      '<th style="text-align:left;padding:6px 9px;font-size:var(--fs-1);color:var(--grey);' +
      'font-weight:600;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid var(--line)">' +
      esc(tx(t)) +
      '</th>'
    );
  };

  return (
    '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.55;margin-bottom:9px">' +
    esc(tx('When work of each kind arrives, this is where it lands and whose it becomes. ' + 'Leave a row blank and it stays here, unassigned.')) +
    '</div>' +
    '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;min-width:560px">' +
    '<thead><tr>' +
    th('Kind of work') +
    th('Folder') +
    th('Person') +
    th('Team') +
    '</tr></thead>' +
    '<tbody>' +
    rows +
    '</tbody></table></div>' +
    '<div id="wr_say" style="font-size:var(--fs-1);color:var(--grey);margin-top:7px;min-height:17px"></div>' +
    (teams.length
      ? ''
      : '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:7px;line-height:1.5">' +
        esc(
          tx('A team is a branch of your own network — build one in Network design and it appears here. ' + 'Work can only be routed inside your own network.')
        ) +
        '</div>')
  );
}

/** ⭐ saved on change, and it SAYS so — a silent save is one people repeat because they cannot tell. */
async function workRoutingSet(kind, field, value) {
  var node = document.getElementById('wr_say');
  var cur =
    ((_WROUTE && _WROUTE.kinds) || []).find(function (item) {
      return item.kind === kind;
    }) || {};
  var body = {
    kind: kind,
    folder_id: field === 'folder' ? value : cur.folder_id || '',
    assignee_actor_id: field === 'person' ? value : cur.assignee_actor_id || '',
    route_to_entity_id: field === 'team' ? value : cur.route_to_entity_id || ''
  };
  if (node) node.textContent = tx('Saving…');
  try {
    await api('workRoutingSet', { body: body });
    /* keep the local copy in step, or the next change on the same row would send the stale two fields back */
    if (field === 'folder') cur.folder_id = value || null;
    if (field === 'person') cur.assignee_actor_id = value || null;
    if (field === 'team') cur.route_to_entity_id = value || null;
    if (node) node.textContent = tx('Saved.');
  } catch (e) {
    if (node) node.textContent = '';
    toast(String((e && e.message) || tx('Could not save it')), true);
    /* ⚠️ put the control back to what the SERVER has: a dropdown showing a value that was refused is a lie the
       reader will act on. */
    await workRoutingLoad(true);
    if (typeof loadSettings === 'function') loadSettings();
  }
}

function paintSettings(s, _daOpts) {
  const node = document.getElementById('setbody');
  if (!node) return;
  /* fetched when the Work section is actually opened, and the pane repainted in place when it arrives -
     not the whole screen, which would throw away anything half-typed in the fields below it. */
  if (setSec() === 'work' && !_WROUTE) {
    workRoutingLoad().then(function () {
      var element = document.getElementById('wr_pane');
      if (element) element.innerHTML = workRoutingHTML();
    });
  }
  {
    const k = setSec();
    /* ⚠️ scoped: everything from 'Task assignment' down is stored and not yet read by anything. 'Where work
       goes' above it IS read — lib/workroute resolves every ticket through it. */
    const notYetWork =
      '<div style="background:var(--danger-tint);border:1px solid #f0c9c6;border-radius:9px;padding:8px 11px;font-size:var(--fs-1);color:var(--disp);margin:15px 0 11px">⏳ The settings <b>below</b> are saved but <b>not yet active</b> — assignment, limits and breaks don\'t change behaviour yet. <i>Where work goes</i>, above, is live.</div>';
    var out = '';
    if (k === 'business') out = businessSettingsHTML(s);
    else if (k === 'locale') out = localeSettingsHTML();
    else if (k === 'integrations') out = integrationsSettingsHTML();
    else if (k === 'appearance') out = appearanceSettingsHTML();
    else if (k === 'standards') {
      /**
       * ⚠️ THE REGISTER MOVED TO ITS OWN CAPABILITY (shared with the Legend), so it may not be here yet. Calling
       * standardsSettingsHTML() blind would throw on `STANDARDS is not defined` and paint an empty pane —
       * which reads as "we follow no standards", the worst possible failure for this particular screen.
       */
      if (typeof STANDARDS === 'undefined') {
        out = _misHead('Standards', '') + '<div style="' + _CARD + ';color:var(--grey);font-size:var(--fs-2)">' + tx('Loading the register…') + '</div>';
        ensureCap('standards')
          .then(function () {
            if (setSec() === 'standards') {
              _capShowDetail();
              loadSettings();
            }
          })
          .catch(function (e) {
            var element = document.getElementById('setbody');
            if (element) element.innerHTML = scrErr(e);
          });
      } else out = standardsSettingsHTML();
    } else if (k === 'work')
      out =
        _misHead('Work', '') +
        `<div style="${_CARD}">
      ${
        /**
         * ⭐⭐ THE SAME CONTROL, NOT A SECOND ONE. Athi, 2026-08-20: *"in the settings, we have to include to
         * change the type, either goods or service, in the settings so the type of work it takes care of."*
         *
         * ⚠️ IT WRITES THE SAME COLUMN AND READS THE SAME VALUE as the Business section on the profile. Two
         * pickers for one fact is how a screen comes to disagree with itself — the thing this whole day has
         * been removing. Here it is a POINTER, not a copy: it states what is set and sends the reader to the
         * one place that sets it. Settings › Work is where a person asks "what kind of work do we do", so the
         * answer belongs on it; the CONTROL does not have to.
         */ ''
      }
      <div class="kv" style="margin-bottom:9px"><b>${tx('Supplies')}</b> · ${esc((UI._me && UI._me.supplies) || 'goods')}
        <a data-cbsid="ACC002-C21" href="#" onclick="navTo('profile');profSetSec('identity');UI._iamOpen=Object.assign(UI._iamOpen||{},{profile:true});return false"
           style="color:var(--blue);font-size:var(--fs-1);margin-inline-start:6px">${tx('Change in Business')} <span class=arw>→</span></a></div>
      ${
        /**
         * WHERE WORK GOES - the answer to this section's own question, which it had never actually
         * answered. Athi, 2026-09-14: *"we should not raise a SQL, it should be configurable."*
         * Loaded on demand and repainted when it lands: reading it up front would make every Settings
         * visit pay for a screen most of them are not opening. [[feedback-on-demand-loading]]
         */ ''
      }
      <div style="border-top:1px solid var(--line);margin:13px 0 11px;padding-top:11px">
        <div style="font-family:'Space Grotesk';font-weight:700;font-size:var(--fs-3);margin-bottom:3px">${tx('Where work goes')}</div>
        <div id="wr_pane">${workRoutingHTML()}</div>
      </div>
      ${notYetWork}
      <label class="fl">${tx('Task assignment')}${helpQ('work.assignment', 'How tasks reach people')}</label><select data-cbsid="ACC002-S16" class="inp" id="st_am">${opt(['pull', 'push', 'both'], s.assignment_model || 'both')}</select>
      <label class="fl">${tx('Default max tasks per')} ${TERM.coassist}</label><input data-cbsid="ACC002-I25" class="inp" id="st_mt" inputmode="numeric" value="${esc(s.default_max_tasks || 10)}">
      <label class="fl" style="display:flex;gap:8px;align-items:center"><input data-cbsid="ACC002-I26" type="checkbox" id="st_av" ${s.all_task_visible ? 'checked' : ''}> All tasks visible to all co-assists</label>
      <label class="fl" style="display:flex;gap:8px;align-items:center"><input data-cbsid="ACC002-I27" type="checkbox" id="st_ar" ${s.auto_return_on_short_break ? 'checked' : ''}> ${tx('Auto-return tasks on short break')}</label>
      <div class="err" id="st_err"></div><button data-cbsid="ACC002-B58" class="composebtn" style="margin-top:9px" onclick="saveSettings()">${tx('Save settings')}</button></div>` +
        /* ⚠️ A DEAD CROSS-REFERENCE LIVED HERE. It sent a reader to "Profile → Identity" for the naming rules,
         set UI._namingOpen to expand them, and pointed at NAMING — a table deleted earlier today with its only
         renderer. The link would have opened the right screen and shown nothing.

         ⭐ A POINTER IS A DEPENDENCY. It survived because deleting the target did not touch the file that
         pointed at it, which is the same drift as a subtitle nobody owns. The naming rules still exist in
         NAMING.md and are enforced by the API; a screen does not need to say so. */
        autoAssignCard(s, _daOpts) +
        aiSettingsCard();
    else if (k === 'policy')
      out =
        _misHead('Policy', '') +
        policyFlagsCard() +
        /**
         * ⚠️ THIS CARD USED TO RE-DECLARE THE ATTACHMENT RULES. It carried its own `<input>`s pre-filled with
         * `image, pdf, docx, xlsx, csv, zip` and `10` — the exact strings ALSO written into the Constitution layer,
         * as two independent literals in this same file. Nothing read one from the other, nothing compared them, and
         * neither was saved anywhere, so they could sit disagreeing forever with no symptom.
         *
         * Under Model A the declaration lives in GOV and this screen REFERS to it. The inputs are gone on purpose:
         * an editable field for a value this screen does not own is the same lie as "you can change this" on a row
         * with no control. When the layer marks it `advisory` AND an edit path exists, the control belongs here —
         * not before.
         */
        '<div style="border:1px solid var(--line);border-radius:12px;padding:13px;margin-top:10px">' +
        '<div class="sec" style="margin:0 0 8px">' +
        tx('📎 Attachment policy') +
        '</div>' +
        '<div class="misnote" style="margin-bottom:9px">Set for your business. Shown here.</div>' +
        govRefHTML('Attachment types') +
        govRefHTML('Attachment max size') +
        '</div>';
    else if (k === 'channels') {
      out = _misHead('Channels', '') + channelsCard();
      loadChannels(); // async — the card paints itself in when the read lands
    }
    /* ⚠️ NO SECTION HEADING HERE (Athi: *"governance, the layers your entity minted under, not required.. just
       1. Constitution under Governance"*). The rail row already says Governance and the selected layer is the
       subject — repeating the section name above it pushed the actual content down for no information. */
    else if (k === 'governance') out = _misBack() + govLayersBlock();
    else if (k === 'blueprints') out = _misHead('Work patterns', '') + blueprintSettingsHTML();
    /* One assignment, so the end marker is appended in one place rather than five — and cannot be forgotten on a
       branch added later. */
    node.innerHTML = out + (out ? _capEnd() : '');
    if (k === 'business') bizLoadCards(); /* the Abroad and Ledger cards read their state after they are on the screen */
  }
}
/** the Business section's cards that read their own state once painted */
function bizLoadCards() {
  bizAbroadLoad();
  bizLedgerLoad();
}
async function saveSettings() {
  const x = document.getElementById('st_err');
  if (x) x.textContent = '';
  try {
    await api('saveSettings', {
      body: {
        assignment_model: val('st_am'),
        default_max_tasks: +val('st_mt') || 10,
        all_task_visible: document.getElementById('st_av').checked,
        auto_return_on_short_break: document.getElementById('st_ar').checked
      }
    });
    toast(MSG.settingsSaved());
  } catch (e) {
    if (x) x.textContent = e.message;
  }
}
/* ---- POLICY FLAGS — per-entity governance toggles, SERVER-PERSISTED (b130).
 *
 * Athi, 2026-08-09: *"make the policy flags real, move it to settings."*
 *
 * They were a localStorage prototype: the card said "set ✓", nothing left the browser, and the server that has to
 * ENFORCE them never heard. `self_copy_pref` was the sharpest version of that — it has a real, enforced column, and
 * this card wrote past it into localStorage, so the one flag with teeth was the one the UI had disconnected.
 *
 * The VALUES come from and go to /api/entities/policy, which validates against its own whitelist.
 *
 * ⭐ T2-POLICY (2026-10-14): AND SO DO THE ROWS. A second table of these flags lived here (label · help · level · gov ·
 * labels · scale) beside lib/policy.js FLAGS, and the two drifted — self_copy_pref's default was stated three times, two
 * of them wrong. The server now sends each flag's card row as `schema[key].ui` (and `bound_schema` for the locked ones);
 * polDefs() reads them. Nothing about a flag is defined in this file.
 */
/* polDefsOf · polShown · polStored → app/cap-settings.js (T3-SETTINGS × T2-POLICY): the workshop's Business rules card and CB Settings › Policy
   paint the SAME server schema (schema[key].ui + bound_schema) through one reader — no flag list on the web */
function polDefs() {
  return polDefsOf(_POL.schema, _POL.bound);
}
var _POL = { flags: null, schema: null, bound: null, may: null, busy: false, err: null, migrated: true };
function _polVal(def) {
  var o = _POL.flags || {};
  return o[def.key] !== undefined ? o[def.key] : def.def;
}
function _polLocked(gov) {
  return gov === 'bound' || gov === 'protected' || gov === 'inherited';
}
/* R121b: a rule here is a DRAFT, like CB Settings › Policy. The card draws its rows with CBSettings.policyControl / policyEditButtons and writes only through
   CBSettings.policyRun (app/cap-settings.js): Save asks first, Cancel writes nothing, a refusal is said on the row in the server's words. There is no
   write on change — setPolFlag, which saved the moment a box changed, is gone. */
/** one flag as the shared row wants it: { key, def, v, may } — the server's may when it gave one (an older server: the PATCH still decides) */
function _polRow(flag) {
  return { key: flag.key, def: flag, v: _polVal(flag), may: (_POL.may || {})[flag.key] || { ok: true } };
}
/** wire the card's node once: typing shows Save/Cancel, Save and Cancel do their one thing (CBSettings.policyRowEdit) */
function _polWire(node) {
  if (node._polWired) return;
  node._polWired = true;
  CBSettings.policyRowEdit(node, {
    rowOf: function (key) {
      var flag = polDefs().filter(function (item) {
        return item.key === key;
      })[0];
      return flag && _polRow(flag);
    },
    shown: CBSettings.policyShown,
    /** the server's flags after a save become the card's own, then it repaints from them */
    onSaved: function (saved) {
      _POL.flags = (saved && saved.flags) || _POL.flags;
      paintPolicy();
    }
  });
}
async function loadPolicy() {
  _POL.busy = true;
  _POL.err = null;
  paintPolicy();
  try {
    var reply = await api('policyGet');
    _POL.flags = (reply && reply.flags) || {};
    _POL.schema = (reply && reply.schema) || null;
    _POL.bound = (reply && reply.bound_schema) || null;
    _POL.may = (reply && reply.may) || null;
    _POL.migrated = !(_POL.flags._migrated === false);
  } catch (e) {
    _POL.err = (e && e.message) || 'Could not read your policy flags.';
  }
  _POL.busy = false;
  paintPolicy();
}
function paintPolicy() {
  var node = document.getElementById('polflags');
  if (node) {
    node.innerHTML = policyFlagsInner();
    _polWire(node);
  }
}
function _polControl(def) {
  var v = _polVal(def);
  if (_polLocked(def.gov))
    return (
      '<span style="font-weight:700;font-size:var(--fs-2)">' +
      esc(String(v)) +
      '</span> <span style="font-size:var(--fs-1)" title="locked / inherited — cannot change here">🔒</span>'
    );
  /* ⚠️ THE VALUE IS THE CODE; THE LABEL IS FOR A PERSON (a dropdown that offered "both · sent · received" for self-chits, where the words are Task and Order).
     CBSettings.policyControl keeps value = code and shows the server's labels; a scaled number is shown in the unit a person reads (0.50 %) and stored in its own (50 bp). */
  var row = _polRow(def);
  return (
    CBSettings.policyControl(row) +
    CBSettings.policyEditButtons(row) +
    '<span class="sub" id="sx_pol_ok_' + esc(def.key) + '" data-testid="pol-ok-' + esc(def.key) + '"></span>'
  );
}

/* ---- CHANNELS — the inbound on-ramps. Which number / address reaches THIS entity's intake inbox (b123).
 *
 * Athi, 2026-08-09: *"is there a new panel in the front end as Channels, underneath we can specify whatsapp,
 * email and so on?"*
 *
 * The capture pipeline has been complete except for this: a message arrives on a public webhook carrying nothing
 * but a destination number, and the server has to know whose inbox that is. It may not read it off the payload —
 * that would let anyone post an obligation into anyone's intake — so it reads it here.
 *
 * ⚠️ TWO FACTS, SHOWN SEPARATELY, BECAUSE ONLY THE PAIR RECEIVES ANYTHING.
 *   · PROVIDER CONFIGURED — the server really holds the secret for that channel (read from the environment, never
 *     from anything typed on this screen).
 *   · BOUND — this entity has claimed a number / address.
 * A panel that collapsed those into one green tick would tell an owner "WhatsApp: connected" when no account
 * exists, and their customer's message would vanish while the screen insisted all was well. So each is stated,
 * and the row says plainly which of the two is missing.
 */
var _CH = { data: null, busy: false, err: null, adding: null };

function channelsCard() {
  return '<div style="' + _CARD + ';margin-top:10px" id="ch_card">' + channelsInner() + '</div>';
}
function channelsInner() {
  var head =
    '<div class="sec" style="margin:0 0 4px">📡 Channels ' +
    '<span style="font-size:var(--fs-1);font-family:\'Space Mono\';background:var(--ok-tint);color:var(--ok-2);border-radius:5px;padding:1px 6px">inbound · live</span></div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.5;margin-bottom:8px">Bind the number or address customers write to. Anything sent there lands in <b>' +
    tx('📨 Intake') +
    '</b> — raw, for you to confirm into a chit. Nothing here can send on your behalf.</div>';
  if (_CH.busy && !_CH.data)
    return head + '<div class="loadwrap" style="justify-content:flex-start;padding:6px 0"><span class="spin"></span> reading your channels…</div>';
  /* ⚠️ A MISSING ENDPOINT IS NOT A BROKEN SCREEN, and must not be reported as one. The API deploys separately from
     this page, so a web release can land first — "Could not read your channels" would send someone hunting for a
     fault in their own account. Name the actual state: the server has not shipped this yet. */
  if (_CH.notDeployed) return head + pendingNote('this server has not shipped channels yet');
  if (_CH.err)
    return (
      head +
      '<div style="background:var(--danger-tint);border:1px solid #f0c9c6;border-radius:9px;padding:9px 11px;font-size:var(--fs-2);color:var(--disp)">' +
      esc(_CH.err) +
      '</div>'
    );
  if (!_CH.data) return head + '<div style="font-size:var(--fs-2);color:var(--grey)">Not loaded.</div>';
  /* The route answers 200 with a note when the table is not there — say which it is, because "no channels" and
     "the store does not exist" look identical on screen and mean entirely different things. */
  if (_CH.data.note)
    return (
      head +
      '<div style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:9px 11px;font-size:var(--fs-2);color:var(--warn-3)">The channel map is not migrated on this environment (' +
      esc(_CH.data.note) +
      '). The panel is here; the table is not.</div>'
    );
  return head + (_CH.data.channels || []).map(_chRow).join('');
}
function _chRow(c) {
  var bound = (c.bindings || []).length;
  /* ⚠️ RECEIVING requires BOTH. Anything else is a state worth naming, not a colour to average out. */
  /* ⚠️ RECEIVING NEEDS A VERIFIED BINDING, not just any binding (b124). A claim is not a permission: until the
     platform confirms the number is yours, it resolves to nothing and messages sent there reach nobody. Counting a
     declared claim as "receiving" would be the panel telling the exact lie the migration exists to stop. */
  var verified = (c.bindings || []).filter(function (item) {
    return item.status === 'verified';
  }).length;
  var live = c.provider_configured && verified;
  var pill = live
    ? ['var(--ok-2)', 'var(--ok-tint)', 'receiving']
    : bound && !verified
      ? ['var(--warn-2)', 'var(--warn-tint)', 'claimed — awaiting confirmation']
      : !c.provider_configured && bound
        ? ['var(--warn-2)', 'var(--warn-tint)', 'waiting on a provider account']
        : c.provider_configured && !bound
          ? ['var(--warn-2)', 'var(--warn-tint)', 'configured — nothing bound yet']
          : ['var(--grey-2)', 'var(--blue-tint-bg)', 'not set up'];
  return (
    '<div style="padding:10px 0;border-bottom:1px solid var(--line)" data-testid="ch-row-' +
    esc(c.key) +
    '">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
    '<span style="font-weight:600;font-size:var(--fs-2)">' +
    esc(c.name) +
    '</span>' +
    '<span style="font-size:var(--fs-1);font-weight:800;color:' +
    pill[0] +
    ';background:' +
    pill[1] +
    ';border-radius:5px;padding:1px 7px" data-testid="ch-status-' +
    esc(c.key) +
    '">' +
    pill[2] +
    '</span>' +
    '<span data-cbsid="ACC002-C22" style="margin-inline-start:auto;font-size:var(--fs-1);color:var(--blue);cursor:pointer;font-weight:600" data-testid="ch-add-' +
    esc(c.key) +
    '" onclick="chToggleAdd(\'' +
    esc(c.key) +
    '\')">' +
    (_CH.adding === c.key ? 'cancel' : '+ bind') +
    '</span>' +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
    esc(c.hint) +
    '</div>' +
    /* ⚠️ REPLIES ARE A SEPARATE CREDENTIAL, so a separate line. Receiving and sending are not one switch: the app
       secret verifies inbound, WHATSAPP_TOKEN sends. Saying "connected" once would promise replies we cannot make.
       Only shown where the channel actually has a return leg. */
    (c.key === 'whatsapp'
      ? '<div style="font-size:var(--fs-1);margin-top:3px;color:' +
        (c.outbound_configured ? 'var(--ok-2)' : 'var(--grey)') +
        '">' +
        (c.outbound_configured
          ? '↩ replies on — status changes go back to the customer, within their 24-hour window'
          : '↩ replies off — needs WHATSAPP_TOKEN. Messages still arrive; nothing goes back.') +
        '</div>'
      : '') +
    (c.bindings || [])
      .map(function (item) {
        return (
          '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:var(--fs-2)">' +
          '<span style="font-family:ui-monospace,Menlo,monospace">' +
          esc(item.address) +
          '</span>' +
          (item.label ? '<span style="color:var(--grey)">' + esc(item.label) + '</span>' : '') +
          /* declared vs verified — asserted is not confirmed, and the difference is visible. */
          /* declared vs verified — and what DECLARED actually costs you, said in the row rather than in a footnote:
             a claim that has not been confirmed receives nothing at all. */
          '<span style="font-size:var(--fs-1);font-weight:800;color:' +
          (item.status === 'verified' ? 'var(--ok-2)' : 'var(--warn-2)') +
          ';background:' +
          (item.status === 'verified' ? 'var(--ok-tint)' : 'var(--warn-tint)') +
          ';border-radius:5px;padding:1px 6px" title="' +
          (item.status === 'verified'
            ? 'confirmed by the platform — messages sent here reach you'
            : 'not confirmed yet — messages sent to this number reach nobody') +
          '">' +
          esc(item.status === 'verified' ? 'verified' + (item.verified_via ? ' · ' + item.verified_via : '') : 'declared — not receiving yet') +
          '</span>' +
          '<span data-cbsid="ACC002-C23" style="margin-inline-start:auto;cursor:pointer;color:var(--grey-4)" title="Unbind" data-testid="ch-del" onclick="chUnbind(\'' +
          esc(item.id) +
          '\')">✕</span></div>' +
          /**
           * ⚠️ HANDS-FREE, PER LINE (b131). Athi: *"no one will sit and create a chit from whatsapp, it has to be
           * automatic without anyone's presence."*
           *
           * ⚠️ THE SWITCH IS NOT THE PERMISSION, and the row says so: on an unverified line it reads "waiting on
           * verification" rather than "on", because a binding that receives nothing cannot raise anything either.
           * Two independent conditions, and a toggle that claimed otherwise would be the lie.
           */
          (item.auto_raise === undefined
            ? ''
            : '<label style="display:flex;align-items:center;gap:6px;margin:5px 0 0 10px;font-size:var(--fs-1);color:var(--grey);cursor:pointer">' +
              '<input data-cbsid="ACC002-I28" type="checkbox" data-testid="ch-autoraise" ' +
              (item.auto_raise ? 'checked' : '') +
              ' onchange="chSetAutoRaise(\'' +
              esc(item.id) +
              '\',this.checked)">' +
              '<span>Raise messages on this line <b>automatically</b>' +
              (item.auto_raise && item.status !== 'verified' ? ' <span style="color:var(--warn-2);font-weight:700">— waiting on verification</span>' : '') +
              '<br><span style="font-size:var(--fs-1)">' +
              txf(
                'A chit appears in your Task list with nobody present. It is still an {inquiry} — a record, not an obligation — and anything the co-assist cannot read stays here in Intake.',
                { inquiry: '<b>' + tx('inquiry') + '</b>' }
              ) +
              '</span></span></label>') +
          /* ⚠️ TEMPLATES ARE PER-NUMBER, so they hang off the BINDING and not the channel. Meta approves for one
             WhatsApp account; another business's approval says nothing about this one. */
          (c.key === 'whatsapp'
            ? (c.templates || [])
                .map(function (t) {
                  var state = (item.templates || {})[t.name] || 'none';
                  var col =
                    state === 'approved'
                      ? ['var(--ok-2)', 'var(--ok-tint)']
                      : state === 'pending'
                        ? ['var(--warn-2)', 'var(--warn-tint)']
                        : ['var(--grey-2)', 'var(--blue-tint-bg)'];
                  return (
                    '<div style="margin:5px 0 0 10px;padding:7px 9px;border-inline-start:2px solid var(--line);font-size:var(--fs-1)">' +
                    '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><span style="font-family:ui-monospace,Menlo,monospace">' +
                    esc(t.name) +
                    '</span>' +
                    '<span style="font-size:var(--fs-1);font-weight:800;color:' +
                    col[0] +
                    ';background:' +
                    col[1] +
                    ';border-radius:5px;padding:1px 6px">' +
                    esc(state === 'none' ? 'not approved' : state) +
                    '</span>' +
                    '<span style="color:var(--grey)">' +
                    esc(t.category) +
                    ' · ' +
                    esc(t.language) +
                    '</span>' +
                    '<span data-cbsid="ACC002-C24" style="margin-inline-start:auto;color:var(--blue);cursor:pointer;font-weight:600" data-testid="ch-tpl-toggle" onclick="chSetTemplate(\'' +
                    esc(item.id) +
                    "','" +
                    esc(t.name) +
                    "','" +
                    (state === 'approved' ? 'pending' : 'approved') +
                    '\')">' +
                    (state === 'approved' ? 'mark not approved' : 'mark approved') +
                    '</span></div>' +
                    /* Show the submission text VERBATIM. Describing it would guarantee a mismatch with what Meta
                   approved, and a template whose text differs from the approved one is simply rejected. */
                    '<div style="margin-top:4px;color:var(--grey)">Submit this to Meta word for word:</div>' +
                    '<div style="margin-top:2px;padding:5px 7px;background:var(--paper);border-radius:6px;font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-1);white-space:pre-wrap;color:var(--on-bg)">' +
                    esc(t.body) +
                    '</div>' +
                    (state !== 'approved'
                      ? '<div style="margin-top:3px;color:var(--warn-2)">Until approved: no sending beyond 24h after the customer writes.</div>'
                      : '') +
                    '</div>'
                  );
                })
                .join('')
            : '')
        );
      })
      .join('') +
    (_CH.adding === c.key
      ? '<div style="display:flex;gap:6px;margin-top:8px"><input data-cbsid="ACC002-I29" class="inp" id="ch_addr" placeholder="' +
        esc(c.placeholder) +
        '" data-testid="ch-addr" style="flex:1">' +
        '<input data-cbsid="ACC002-I30" class="inp" id="ch_label" placeholder="label (optional)" data-testid="ch-label" style="max-width:140px">' +
        '<button data-cbsid="ACC002-B59" class="composebtn" data-testid="ch-save" onclick="chBind(\'' +
        esc(c.key) +
        '\')">' +
        tx('Bind') +
        '</button></div>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
        txf('{addr} — the address customers write TO. It is a {claim}: not active until your number is confirmed.', {
          addr: esc(c.address_label),
          claim: '<b>' + tx('claim') + '</b>'
        }) +
        '</div>'
      : '') +
    '</div>'
  );
}
function chPaint() {
  var node = document.getElementById('ch_card');
  if (node) node.innerHTML = channelsInner();
}
async function loadChannels() {
  _CH.busy = true;
  _CH.err = null;
  _CH.notDeployed = false;
  chPaint();
  try {
    _CH.data = await api('channelsList');
  } catch (e) {
    var m = (e && e.message) || '';
    if (/does not exist|not found|404/i.test(m)) _CH.notDeployed = true;
    else _CH.err = m || 'Could not read your channels.';
  }
  _CH.busy = false;
  chPaint();
}
function chToggleAdd(k) {
  _CH.adding = _CH.adding === k ? null : k;
  chPaint();
}
async function chBind(channel) {
  var addr = val('ch_addr'),
    label = val('ch_label');
  if (!String(addr || '').trim()) {
    toast('Enter the number or address first.', true);
    return;
  }
  try {
    await api('channelBind', { body: { channel: channel, address: addr, label: label } });
    _CH.adding = null;
    await loadChannels();
    toast('Channel bound ✓');
  } catch (e) {
    toast((e && e.message) || 'Could not bind that.', true);
  }
}
/* ⚠️ CONFIRMED WHEN TURNING IT ON, not when turning it off. Switching it on changes what happens while nobody is
   watching, which is exactly the kind of change that should be read once before it takes effect. Switching it off
   only ever means "back to a person pressing Raise" — nothing to warn about. Repaints from the server either way. */
function chSetAutoRaise(id, on) {
  if (!on) return _chSetAutoRaise(id, false);
  confirmAsk(
    'Raise messages on this line automatically?',
    'A chit will appear in your Task list <b>without anyone present</b>. It is an inquiry — a record, not an ' +
      'obligation — and it still says the sender is unverified.' +
      '<div style="margin-top:7px">' +
      txf('Anything the co-assist cannot read stays in {intake} for you.', { intake: '<b>' + tx('Intake') + '</b>' }) +
      '</div>',
    'Turn it on',
    function () {
      _chSetAutoRaise(id, true);
    }
  );
  /* ⚠️ The toggle already moved on screen. Cancelling must put it back, and only a reload knows the real state. */
  loadChannels();
}
async function _chSetAutoRaise(id, on) {
  try {
    await api('channelAutoRaise', { params: { id: id }, body: { on: !!on } });
    await loadChannels();
  } catch (e) {
    toast((e && e.message) || 'Could not change that.', true);
    await loadChannels();
  }
}
async function chSetTemplate(id, name, state) {
  try {
    await api('channelTemplate', { params: { id: id }, body: { name: name, state: state } });
    await loadChannels();
  } catch (e) {
    toast((e && e.message) || 'Could not update the template.', true);
  }
}
function chUnbind(id) {
  confirmAsk(
    'Unbind this address?',
    'Messages sent to it will <b>stop reaching your intake inbox</b>.' + '<div style="margin-top:7px">Captures you have already received are untouched.</div>',
    'Unbind',
    function () {
      _chUnbind(id);
    },
    true
  );
}
async function _chUnbind(id) {
  try {
    await api('channelUnbind', { params: { id: id } });
    await loadChannels();
  } catch (e) {
    toast((e && e.message) || 'Could not unbind that.', true);
  }
}

/* S2 — the owner's SHOWCASE chooser: the registered templates (app/showcase-templates.js), one tap to choose (saved as the policy flag
   showcase_template via CBSettings.policyRun — one write), and the live preview is the shop's own page in a frame (shop.html ?showcase=). */
function showcaseCard() {
  if (typeof CBShowcase === 'undefined') return '';
  /* T3-P2-CRM: the chooser is app/cap-showcase.js (CBShowcasePick) — ONE copy, drawn here and on CB CRM's Shop window; a click on a template saves the flag (scPick) */
  var cur = ((_POL && _POL.flags) || {}).showcase_template || CBShowcase.DEFAULT,
    id = (SESSION && SESSION.bridgeId) || '';
  return (
    '<div style="' +
    _CARD +
    ';margin-top:10px" id="scard"><div class="sec" style="margin:0 0 6px">' +
    tx('Your shop window') +
    '</div>' +
    (typeof CBShowcasePick !== 'undefined' ? CBShowcasePick.html({ current: cur, shopId: id, t: tx, cls: 'btn', clsOn: 'btn primary', origin: '' }) : '') +
    '</div>'
  );
}
document.addEventListener('click', function (ev) {
  var node = ev.target.closest && ev.target.closest('#scard [data-sc-pick]');
  if (node && !node.disabled) scPick(node.getAttribute('data-sc-pick'));
});
/** a shop-window template is chosen by a tap, so the tap asks first and goes through the same write as a rule's Save (CBSettings.policyRun) */
function scPick(n) {
  var from = ((_POL && _POL.flags) || {}).showcase_template || CBShowcase.DEFAULT;
  if (String(from) === String(n)) return;
  var btn = document.querySelector('#scard [data-sc-pick="' + n + '"]');
  CBSettings.policyRun(btn, 'showcase_template', n, tx('Change {rule} from {from} to {to}?').replace('{rule}', tx('Your shop window')).replace('{from}', from).replace('{to}', n), {
    onFail: function (words) {
      toast(words, true);
    },
    outcome: function (saved) {
      _POL.flags = (saved && saved.flags) || _POL.flags;
      paintShowcase();
    }
  });
}
function paintShowcase() {
  var node = document.getElementById('scard');
  if (node) node.outerHTML = showcaseCard();
}
function policyFlagsCard() {
  loadPolicy();
  return '<div style="' + _CARD + ';margin-top:10px" id="polflags">' + policyFlagsInner() + '</div>';
}
function policyFlagsInner() {
  var rows = polDefs()
    .map(function (item) {
      return (
        '<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)">' +
        '<div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><span style="font-weight:600;font-size:var(--fs-2)">' +
        esc(item.label) +
        '</span>' +
        govKlass(item.gov) +
        '<span style="font-size:var(--fs-1);font-family:\'Space Mono\';background:var(--neutral-tint);color:var(--grey-2);border-radius:5px;padding:1px 6px">' +
        esc(item.level) +
        '</span></div>' +
        /* ⚠️ AN EMPTY help RENDERS NOTHING, NOT AN EMPTY DIV. Four of these were trimmed to direction today and
       one removed outright; without this each would leave a 2px-margined empty element under its control —
       a gap that reads as a rendering fault. Same fix as _misHead when its subtitle went. */
        (item.help ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px;line-height:1.45">' + esc(item.help) + '</div>' : '') +
        '</div>' +
        '<div style="flex:none;text-align:end;min-width:120px">' +
        _polControl(item) +
        '</div></div>'
      );
    })
    .join('');
  /* A setting that cannot be stored must SAY so rather than accept a change it will lose — that is the whole
     failure this card is being rebuilt out of. */
  var warn = !_POL.migrated ? pendingNote('not available on this environment — changes will not save') + '<div style="height:7px"></div>' : '';
  var err = _POL.err ? '<div style="color:var(--disp);font-size:var(--fs-1);margin-top:6px">' + esc(_POL.err) + '</div>' : '';
  return (
    '<div class="sec" style="margin:0 0 4px">🚩 Business rules <span style="font-size:var(--fs-1);font-family:\'Space Mono\';background:var(--ok-tint);color:var(--ok-2);border-radius:5px;padding:1px 6px">saved to your entity</span></div>' +
    /* ⭐ GOVERNANCE GRAMMAR → SPEC. "class + level", "platform-bound", "tighten-only" is our vocabulary for
       our mechanism. The person here is deciding one toggle; the grammar behind it is what a reviewer wants. */
    specNote(
      'settings.policy-flags.grammar',
      'Per-entity toggles cover what the 7-layer block does not yet carry — same governance grammar ' +
        '(<b>class</b> + <b>level</b>): 🔒 <b>platform-bound</b> cannot be relaxed · <b>tighten-only</b> may be ' +
        'made stricter · <b>entity</b> is set freely.'
    ) +
    warn +
    (rows || (_POL.busy ? '<div style="font-size:var(--fs-1);color:var(--grey);padding:8px 0">' + tx('Reading your business rules…') + '</div>' : '')) +
    err +
    '<div style="font-size:var(--fs-1);color:var(--grey);font-style:italic;margin-top:8px">' +
    txf('Stored on your business, not on this device. {enforced} whether you keep a copy, and whether you buy or sell. Expiry and retention: ⏳ {pending}.', {
      enforced: '<b>' + tx('Working today:') + '</b>',
      pending: tx('pending')
    }) +
    '</div>'
  );
}
function autoAssignCard(s, daOpts) {
  const m = s.auto_assign_mode || 'off';
  return `<div style="${_CARD};margin-top:10px"><div class="sec" style="margin:0 0 6px">🧭 Auto-assign on receipt <span style="font-size:var(--fs-1);font-family:'Space Mono';background:var(--ok-tint);color:var(--ok-2);border-radius:5px;padding:1px 6px">active</span></div>
    <label class="fl">${tx('Mode')}${helpQ('work.autoassign', 'How auto-assign picks someone')}</label><select data-cbsid="ACC002-S17" class="inp" id="st_aam">
      <option value="off"${m === 'off' ? ' selected' : ''}>${tx('Off — received chits wait in the pool')}</option>
      <option value="default_assignee"${m === 'default_assignee' ? ' selected' : ''}>${tx('Default assignee — all to one person')}</option>
      <option value="least_loaded"${m === 'least_loaded' ? ' selected' : ''}>${tx('Least-loaded — balance across the team')}</option>
    </select>
    <label class="fl">${tx('Default / overflow assignee')}</label><select data-cbsid="ACC002-S18" class="inp" id="st_ada">${daOpts}</select>
    ${
      /* ⚠️⚠️ THE PARAGRAPH THAT WAS HERE IS NOW BEHIND THE "?". Athi, 2026-08-20: *"do we need this message —
          again a ? can take it to assistant and can answer the same."* It explained three separate rules at once:
          who may be assigned, how least-loaded breaks ties and overflows, and what happens on leave. None of them
          is needed to CHOOSE a mode; all of them are needed if you ask why. That is exactly the split the
          assistant exists for — the screen states, the assistant explains.

          ⚠️ IT WAS ALSO WRONG UNTIL AN HOUR AGO: it said "Act / Manager", two levels retired in b173. A
          paragraph nobody re-reads is a paragraph nobody corrects, which is its own argument for moving it. */ ''
    }
    <div class="err" id="st_aerr"></div><button data-cbsid="ACC002-B60" class="composebtn" style="margin-top:9px" onclick="saveAutoAssign()">${tx('Save auto-assign')}</button></div>`;
}
async function saveAutoAssign() {
  const x = document.getElementById('st_aerr');
  if (x) x.textContent = '';
  const mode = val('st_aam'),
    da = val('st_ada');
  if (mode === 'default_assignee' && !da) {
    if (x) x.textContent = 'Pick a default assignee for this mode.';
    return;
  }
  try {
    await api('saveSettings', { body: { auto_assign_mode: mode, default_assignee_actor_id: da || null } });
    toast('Auto-assign saved ✓');
  } catch (e) {
    if (x) x.textContent = e.message;
  }
}

/* ---- ASSISTANT — knowledge base: the help desk publishes answers to its own catalogue -> served live ----
   Queries are handled the hard way (chits in GOV-01-Help's Task inbox: message + close). This screen is the
   one new atom: Publish-to-catalogue. loadGaps() name kept (renderApp dispatch) — it now loads the KB screen. */
function assistReviewScreen() {
  return scr('🧠 Assistant — knowledge base', 'kbbody', 'assistreview');
}
var _kbItems = [],
  _kbEditId = '';
async function loadGaps() {
  const node = document.getElementById('kbbody');
  if (!node) return;
  const me = typeof SESSION !== 'undefined' ? SESSION : {};
  const isHelp = me.name === 'GOV-01-Help' || me.isHelpdesk;
  const form = isHelp
    ? '<div style="' +
      _CARD +
      '"><div class="sec" id="kb_formhd" style="margin:0 0 6px">' +
      tx('Publish an answer') +
      '</div>' +
      '<label class="fl">' +
      tx('Question') +
      '</label><input data-cbsid="BUS015-I01" class="inp" id="kb_q" data-testid="kb-question" placeholder="e.g. How do I export to Excel?">' +
      '<label class="fl">' +
      tx('Answer') +
      '</label><textarea data-cbsid="BUS015-T01" class="inp" id="kb_a" data-testid="kb-answer" rows="4" placeholder="The answer the assistant should give…" style="width:100%;resize:vertical"></textarea>' +
      '<label class="fl">Context <span style="color:var(--grey);font-size:var(--fs-1)">— screens (comma), or * for everywhere</span></label><input data-cbsid="BUS015-I02" class="inp" id="kb_c" data-testid="kb-context" placeholder="e.g. task, order  (or *)" value="*">' +
      '<div class="err" id="kb_err"></div><div style="display:flex;gap:7px;margin-top:9px"><button data-cbsid="BUS015-B01" class="composebtn" id="kb_pub" data-testid="kb-publish" onclick="publishAnswer()">' +
      tx('📣 Publish to catalogue') +
      '</button><button data-cbsid="BUS015-B02" class="composebtn ghost" data-testid="kb-new" onclick="kbNew()">＋ New / clear</button></div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">' +
      txf('Add a new answer, or press {edit} on one below to refine it.', {
        edit: '<b>' + tx('Edit') + '</b>'
      }) +
      '</div>' +
      /* ⭐ "catalogue → projection" is how it works, not what to do. */
      specNote('assist.answers.projection', 'Answers are served to the assistant instantly (catalogue <span class=arw>→</span> projection).') +
      '</div>'
    : '<div style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:11px 13px;font-size:var(--fs-2);color:var(--warn-3);margin-bottom:11px">This is the help-desk knowledge base. Queries arrive as chits in <b>' +
      tx('GOV-01-Help') +
      "</b>'s Task inbox — operate as GOV-01-Help to answer, close, and publish here.</div>";
  node.innerHTML =
    form +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin:12px 0 6px">' +
    tx('Published answers (') +
    '<span id="kb_n">…</span>)</div><div id="kb_list"><div class="loadwrap"><span class="spin"></span> loading…</div></div>';
  if (window.CBOffline) CBOffline.autodraft(node, 'kb.form'); // draft the question/answer/context you're writing
  try {
    _kbItems = (await api('assistQuestions')) || [];
    const element = document.getElementById('kb_n');
    if (element) element.textContent = _kbItems.length;
    const target = document.getElementById('kb_list');
    if (target)
      target.innerHTML = _kbItems.length
        ? _kbItems
            .map(function (e) {
              const eb = isHelp
                ? '<button data-cbsid="CMP012" class="composebtn" style="padding:2px 9px;font-size:var(--fs-1);flex:none" onclick="kbEdit(\'' +
                  esc(e.id) +
                  '\')">' +
                  tx('Edit') +
                  '</button>'
                : '';
              return (
                '<div style="' +
                _CARD +
                ';padding:9px 11px"><div style="display:flex;gap:8px;align-items:flex-start"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:var(--fs-2)">' +
                esc(e.q) +
                '</div><div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
                esc(e.a) +
                '</div><div style="font-size:var(--fs-1);color:var(--grey-4);margin-top:3px">' +
                esc(Array.isArray(e.context) ? e.context.join(', ') : '') +
                '</div></div>' +
                eb +
                '</div></div>'
              );
            })
            .join('')
        : '<div style="color:var(--grey);font-size:var(--fs-2)">None yet.</div>';
  } catch (e) {
    const element = document.getElementById('kb_list');
    if (element) element.innerHTML = scrErr(e);
  }
}
function kbEdit(id) {
  const it = _kbItems.find(function (x) {
    return x.id === id;
  });
  if (!it) return;
  _kbEditId = id;
  const node = document.getElementById('kb_q'),
    a = document.getElementById('kb_a'),
    c = document.getElementById('kb_c'),
    hd = document.getElementById('kb_formhd'),
    pb = document.getElementById('kb_pub');
  if (node) node.value = it.q || '';
  if (a) a.value = it.a || '';
  if (c) c.value = Array.isArray(it.context) ? it.context.join(', ') : '*';
  if (hd) hd.textContent = 'Edit answer';
  if (pb) pb.textContent = '💾 Update';
  if (node && node.scrollIntoView) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function kbNew() {
  if (window.CBOffline) CBOffline.clearDraft('kb.form');
  _kbEditId = '';
  const node = document.getElementById('kb_q'),
    a = document.getElementById('kb_a'),
    c = document.getElementById('kb_c'),
    hd = document.getElementById('kb_formhd'),
    pb = document.getElementById('kb_pub'),
    x = document.getElementById('kb_err');
  if (node) node.value = '';
  if (a) a.value = '';
  if (c) c.value = '*';
  if (hd) hd.textContent = 'Publish an answer';
  if (pb) pb.textContent = '📣 Publish to catalogue';
  if (x) x.textContent = '';
}
async function publishAnswer() {
  const x = document.getElementById('kb_err');
  if (x) x.textContent = '';
  const q = val('kb_q'),
    a = val('kb_a');
  const c = (val('kb_c') || '')
    .split(',')
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
  if (!q || !a) {
    if (x) x.textContent = 'Question and answer are both required.';
    return;
  }
  try {
    await api('assistPublish', { body: { question: q, answer: a, context: c, qa_id: _kbEditId || undefined } });
    toast(_kbEditId ? 'Updated ✓ — live' : 'Published ✓ — live in the assistant');
    kbNew();
    loadGaps();
  } catch (e) {
    if (x) x.textContent = (e && e.message) || 'Could not publish';
  }
}

/* ⚠️ storefrontCardHTML and saveStorefront were removed on 2026-08-20. The Storefront PANEL they drew was
   folded into iamHTML as a section, which made both unreachable; their one irreplaceable control
   (storefront_access) was carried across FIRST, then the pair deleted. Two renderers for one screen is
   how the next person edits the dead one. */
