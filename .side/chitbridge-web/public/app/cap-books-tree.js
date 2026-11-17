/* app/cap-books-tree.js — CB ACCOUNTS: the Ledgers tab tree: bands, groups, ledgers and the parties under a control account. Split out of cap-books.js, code moved verbatim; nothing is added up here — every figure is the server's.
 * OWNS      the ledger tree: bkBalances · bkShort · bkLtBal · bkLtParties · bkLtPrefs* · bkLtNodes · bkLtTreeHTML · bkLtTreePaint · bkLtFocus · bkLtPaneHTML
 * CALLED BY public/accounts.html (script tag, after cap-books.js) · app.html CAP_WITH books; its functions are global and are called by cap-books.js at run time
 * FLOW      Ledgers tab → bkLedgers (cap-books.js) → bkBalances (the ONE trial-balance read) → bkLtNodes → bkLtTreeHTML → bkLtTreePaint
 * CARD      16-finance/cb-finance
 */
'use strict';
/** ⭐ ONE read of the trial balance gives every ledger's balance — never one read per row */
async function bkBalances() {
  var reply = await api('booksTB', { query: { asOf: bkToday() } }),
    map = {};
  ((reply && reply.rows) || []).forEach(function (x) {
    map[String(x.code)] = Number(x.dr_minor || 0) - Number(x.cr_minor || 0);
  });
  return { map: map, cur: reply && reply.currency };
}
/**
 * ⭐ THE SHORT NAME (docs/design/ledgers-page README, "Anything else I'd change" #2): what a name is called where a long one would wrap.
 * The API's own `short_name` when it sends one; else the official name WITHOUT its trailing bracket ("Customers (Sundry Debtors)" → "Customers")
 * and with its legal form shortened ("Private Limited" → "Pvt Ltd"). DISPLAY ONLY — never stored, never sent; the full name is the
 * tooltip, and stays on bills and in CB CRM.
 */
function bkShort(o, name) {
  var s = o && (o.short_name || o.short);
  if (s) return String(s);
  var text = String(name == null ? '' : name).trim();
  var t = text
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\bPrivate Limited\b/i, 'Pvt Ltd')
    .replace(/\bLimited\b/i, 'Ltd')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t || text;
}
/** a ledger's figure in the tree: "₹12,400.00 Dr" — from the ONE trial-balance read; "—" when the trial balance does not list it, never a made-up nil */
function bkLtBal(code) {
  var list = BK.lt.bal;
  if (!list) return '';
  var v = list.map[code];
  if (v === undefined) return '<span class="am nil" data-testid="bal-' + esc(code) + '" title="' + esc(tx('Not on the trial balance')) + '">—</span>';
  return '<span class="am' + (v ? '' : ' nil') + '" data-testid="bal-' + esc(code) + '">' + (v ? esc(bkDrCr(v, list.cur)) : '—') + '</span>';
}
/** the parties of a control account, from the one /dues read, ordered by party no (the ledger's key on screen) */
function bkLtParties(ctrl) {
  return Object.keys(BK.dues || {})
    .map(function (item) {
      return BK.dues[item];
    })
    .filter(function (item) {
      return bkDuesSide(item) === BK_CTRL[ctrl].side;
    })
    .sort(function (first, second) {
      return String(first.party_no || '').localeCompare(String(second.party_no || ''), undefined, { numeric: true });
    });
}
function bkPartyShort(id, fallback) {
  var d = id && BK.dues && BK.dues[id];
  return bkShort(d, (d && d.name) || fallback || '');
}
/** the last month end both sides agreed (the API sends it per party when the monthly agreement runs); nothing is drawn without it */
function bkAgreedTo(o) {
  var v = o && (o.agreed_to || o.agreedTo);
  return v ? String(v).slice(0, 10) : '';
}

/* ── what a person chose here is remembered on this device, per person: the tree's width, what is folded, the last ledger ──
   (the API has no `ledgers` preference kind yet — CBPrefs would carry it across devices; listed in the PR) */
function bkLtPrefKey() {
  var s = (typeof SESSION !== 'undefined' && SESSION) || {};
  return 'cb_lt.' + (s.entityId || s.entity || '') + '.' + (s.bridgeId || s.name || '');
}
/* read the ledger tree's saved preferences once from localStorage */
function bkLtPrefsRead() {
  if (BK.lt.prefs) return;
  BK.lt.prefs = true;
  var v = null;
  try {
    v = JSON.parse(localStorage.getItem(bkLtPrefKey()) || 'null');
  } catch (failure) {
    bkQuiet('ledger-prefs-read', failure);
  }
  v = v || {};
  if (v.open && typeof v.open === 'object') BK.lt.open = v.open;
  if (typeof v.w === 'number') BK.lt.w = Math.max(240, Math.min(520, v.w));
  if (typeof v.folded === 'boolean') BK.lt.folded = v.folded;
  if (v.last && v.last.code) BK.lt.last = v.last;
}
function bkLtPrefsSave() {
  var s = BK.lt.sel;
  try {
    localStorage.setItem(
      bkLtPrefKey(),
      JSON.stringify({ open: BK.lt.open, w: BK.lt.w, folded: BK.lt.folded, last: s ? { code: s.code, party: s.party || null } : BK.lt.last || null })
    );
  } catch (failure) {
    bkQuiet('ledger-prefs-write', failure);
  }
}
function bkLtFolded() {
  if (BK.lt.over) return false;
  return BK.lt.folded == null ? typeof window !== 'undefined' && window.innerWidth <= 1200 : !!BK.lt.folded;
}
/** on a narrow laptop (pane ≤ 1100 px) the tree comes back OVER the list for one pick, never beside it: the list keeps the width its tools row needs, so the head stays within 20% */
function bkLtOverlay() {
  var e = document.getElementById('bk_lt');
  return !!e && e.clientWidth > 620 && e.clientWidth <= 1100;
}
function bkLtNarrow() {
  var e = document.getElementById('bk_lt');
  return !!e && e.clientWidth > 0 && e.clientWidth <= 620;
}

/* ── the tree: bands → groups → ledgers → parties, ONE line per node, the figure in one aligned column ── */
function bkLtOpenNow(id, def) {
  if (String(BK.lt.tq || '').trim()) return true;
  var v = BK.lt.open[id];
  return v === undefined ? def : !!v;
}
function bkLtSet(id, v) {
  BK.lt.open[id] = !!v;
  bkLtPrefsSave();
}
function bkLtLedgerNode(a, parties) {
  var d = !!BK_CTRL[a.code];
  return { t: 'ledger', id: 'L:' + a.code, code: a.code, name: a.short || bkShort(null, a.name), full: a.name, ctrl: d, parties: parties || [] };
}
/** the nodes the person sees — the find box filters them as they type (a code finds its ledger: "6010" finds Rent; a name finds a ledger or a party) */
function bkLtNodes() {
  var q = String(BK.lt.tq || '')
      .trim()
      .toLowerCase(),
    out = [];
  var hit = function () {
    return !q || Array.prototype.slice.call(arguments).join(' ').toLowerCase().indexOf(q) >= 0;
  };
  (BK.lt.model || []).forEach(function (item) {
    var kids = [],
      index = 0;
    item.ctrl.forEach(function (entry) {
      var all = bkLtParties(entry.code),
        self = !q || String(entry.code).indexOf(q) === 0 || hit(entry.name, bkShort(entry, entry.name));
      var ps = all.filter(function (element) {
        return hit(element.party_no, element.name, bkShort(element, element.name));
      });
      if (q && !self && !ps.length) return;
      index++;
      kids.push(
        bkLtLedgerNode(
          entry,
          (self && !ps.length ? all : ps).map(function (element) {
            return {
              t: 'party',
              id: 'P:' + element.party_id,
              party: element.party_id,
              ctrl: entry.code,
              name: bkShort(element, element.name),
              full: bkPartyLabel(element.party_id, element.name),
              fig: Number(element.balance_minor || 0),
              ok: !!bkAgreedTo(element)
            };
          })
        )
      );
    });
    item.groups.forEach(function (g, gi) {
      var list = g.accts.filter(function (entry) {
        return !q || String(entry.code).indexOf(q) === 0 || hit(entry.name, bkShort(entry, entry.name));
      });
      if (!list.length) return;
      index += list.length;
      kids.push({
        t: 'grp',
        id: 'G:' + item.id + '/' + gi,
        name: tx(g.title),
        tid: 'lt-group-' + g.title,
        count: list.length,
        kids: list.map(function (entry) {
          return bkLtLedgerNode(entry);
        })
      });
    });
    if (kids.length) out.push({ t: 'band', id: 'B:' + item.id, name: tx(item.title), tid: 'lt-band-' + item.id, count: index, kids: kids });
  });
  return out;
}
function bkLtMark(s) {
  var text = String(BK.lt.tq || '').trim();
  if (!text) return esc(s);
  var i = String(s).toLowerCase().indexOf(text.toLowerCase());
  if (i < 0) return esc(s);
  return esc(s.slice(0, i)) + '<mark>' + esc(s.slice(i, i + text.length)) + '</mark>' + esc(s.slice(i + text.length));
}
/* the HTML of the ledger tree: bands, ledgers and parties with their balances */
function bkLtTreeHTML() {
  var sel = BK.lt.sel,
    narrow = bkLtNarrow(),
    h = '',
    c = BK.lt.bal && BK.lt.bal.cur,
    widest = 6;
  var selId = sel ? (sel.party ? 'P:' + sel.party : 'L:' + sel.code) : '';
  /* the balance text on the right of one tree row */
  function amt(n) {
    if (n.t === 'band' || n.t === 'grp') return '<span class="am">' + n.count + '</span>';
    /* the open ledger shows no figure here: the title row beside it already does (on a phone's first page there is no title row, so it does) */
    if (n.id === selId && !narrow) return '<span class="am"></span>';
    if (n.t === 'party') {
      var t = n.fig ? bkDrCr(n.fig, BK.duesCur) : '—';
      widest = Math.max(widest, t.length);
      return (
        '<span class="am' +
        (n.fig ? '' : ' nil') +
        '">' +
        (n.ok ? '<span class="ck" aria-label="' + esc(tx('agreed')) + '" title="' + esc(tx('Agreed at the last month end')) + '">✓</span>' : '') +
        esc(t) +
        '</span>'
      );
    }
    var b = bkLtBal(n.code);
    var m = /<span[^>]*>([^<]*)<\/span>/.exec(b);
    if (m) widest = Math.max(widest, m[1].length);
    return b;
  }
  /* write one tree node and, when it is open, its children */
  function walk(n, lvl) {
    var kids = n.t === 'ledger' ? n.parties.length : (n.kids || []).length,
      open = kids ? bkLtOpenNow(n.id, n.t === 'ledger' ? false : true) : false;
    var tid = n.tid || (n.t === 'ledger' ? 'lg-acc-' + n.code : n.t === 'party' ? 'lg-party-' + n.party : '');
    h +=
      '<button data-cbsid="CMP043-K02"' + bkMountAttribute('CMP043') + ' type="button" class="tn ltn ' +
      n.t +
      (n.id === selId ? ' on' : '') +
      '" role="treeitem" data-tn="' +
      esc(n.id) +
      '"' +
      (n.t === 'party' ? ' data-ctrl="' + esc(n.ctrl) + '"' : '') +
      ' aria-level="' +
      (lvl + 1) +
      '"' +
      (kids ? ' aria-expanded="' + open + '"' : '') +
      (n.t === 'ledger' || n.t === 'party' ? ' aria-selected="' + (n.id === selId) + '"' : '') +
      ' tabindex="-1" data-testid="' +
      esc(tid) +
      '"' +
      (n.full && n.full !== n.name ? ' title="' + esc(n.full) + '"' : '') +
      ' style="--lvl:' +
      lvl +
      '"><span class="tw" aria-hidden="true">' +
      (kids ? (open ? '▾' : '▸') : '') +
      '</span><span class="nm">' +
      bkLtMark(n.name) +
      '</span>' +
      amt(n) +
      '</button>';
    if (kids && open)
      (n.t === 'ledger' ? n.parties : n.kids).forEach(function (item) {
        walk(item, lvl + 1);
      });
  }
  bkLtNodes().forEach(function (item) {
    walk(item, 0);
  });
  BK.lt.amW = widest + 1;
  return (
    h ||
    '<div class="lt-empty">' +
      esc(String(BK.lt.tq || '').trim() ? txf('No ledger or party called “{q}”.', { q: String(BK.lt.tq).trim() }) : tx('No ledgers yet')) +
      (String(BK.lt.tq || '').trim()
        ? '<br><button data-cbsid="CMP014-B01"' + bkMountAttribute('CMP014') + ' type="button" class="lt-btn" data-lt="clear" data-testid="lt-clear">' + esc(tx('Clear')) + '</button>'
        : '') +
      '</div>'
  );
}
/* repaint the ledger tree and put the keyboard focus back where it was */
function bkLtTreePaint(focusId) {
  var node = document.getElementById('lt_tree');
  if (!node) return;
  var ae = document.activeElement,
    keep = focusId || (ae && node.contains(ae) && ae.getAttribute && ae.getAttribute('data-tn'));
  node.innerHTML = bkLtTreeHTML();
  node.style.setProperty('--am-w', (BK.lt.amW || 12) + 'ch');
  var all = node.querySelectorAll('.tn'),
    f = (keep && node.querySelector('[data-tn="' + keep.replace(/"/g, '') + '"]')) || node.querySelector('.tn[aria-selected="true"]') || all[0];
  if (f) f.tabIndex = 0;
  if (focusId && f) f.focus();
}
/* move the keyboard focus to one tree row (roving tabindex) */
function bkLtFocus(id) {
  var node = document.getElementById('lt_tree');
  if (!node) return;
  var all = node.querySelectorAll('.tn');
  Array.prototype.forEach.call(all, function (x) {
    x.tabIndex = -1;
  });
  var b = node.querySelector('[data-tn="' + id + '"]');
  if (b) {
    b.tabIndex = 0;
    b.focus();
  }
}
function bkLtTitle() {
  var s = BK.lt.sel;
  if (!s) return '';
  if (s.party) return bkPartyShort(s.party, ((BK.lt.r && BK.lt.r.party) || {}).name);
  var a = bkLtAcct(s.code);
  return a ? a.short || bkShort(null, a.name) : s.code;
}
function bkLtPaneHTML() {
  var sel = BK.lt.sel;
  if (!sel) return emptyState('📒', tx('Pick a ledger'), esc(tx('Open a group on the left, then a ledger, to see its entries.')));
  return '<div id="lg_out" data-testid="lg_out"></div><div id="lg_pager" data-testid="lg-pager"></div>';
}
