/* public/app/list-legacy.js — the legacy list names (listCtl search, filter, sort, count; lazyWrap) kept until the lists move onto CBList
 * OWNER     cb-ux-locale
 * OWNS      the card-list helpers listCtl* and lazyWrap (with lazyBar, lazyReveal, lazyAttach and the LAZY reveal state) for lists not yet on CBList (not the column lists)
 * FLOW      list rows -> listCtlRowsHTML / lazyWrap -> card list with search and sort
 * CALLED BY public/app.html and public/accounts.html (script tags)
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/functions/small-app-shell-page-frame-cblist-list-controls.md
 * RISK      plain
 */
/**
 * ── list-legacy.js — THE THIN LEGACY NAMES, kept ONLY while their callers move to CBList (public/app/list-ctl.js) ───────
 * OWNS       listCtl* (search, filter, sort, count for a browser-held card list) and lazyWrap / lazyReveal (50 at a time); SCR041-I01, S01, S02, B01, B02
 * CALLED BY  2 pages by <script src> (grep -lE 'src="/?app/list-legacy.js' public/*.html): accounts.html, app.html. Callers of listCtl / lazyWrap (grep -lE 'listCtl|lazyWrap' public/app):
 *            the Categories, Disputes, Intake and Workforce screens' scripts, all lazy-loaded in app.html
 * FLOW       a screen calls listCtl(key, cfg) → draws its search / filter / sort → listCtlView(key).matched feeds its rows → lazyWrap reveals them in chunks
 * CARD       29-qa-test-tooling-ux-locale-and-design-system/list-control
 *
 *
 * 2026-10-02: list-ctl.js became CBList, a self-sustaining unit that reads nothing from its page. What stayed behind is what
 * the two CARD lists (Intake, Disputes) and the non-column lists (catalogue, messages, the activity feeds) still call:
 *   · listCtl* — search · filters · sort · count for a list the browser holds, drawn as CARDS (no column header)
 *   · lazyWrap — 50-at-a-time rendering of any container
 * They borrow tx() / esc() / emptyState() from the page, which is exactly why they are NOT in list-ctl.js. MOVED here, not
 * copied: nothing of them is left in list-ctl.js. Delete this file when those lists move onto CBList.mount.
 */
'use strict';
/** key → { cfg, q, sort, f:{} } — one entry per list, kept across repaints so a search survives one */
var LISTCTL = {};

/**
 * ⚠️ HOW MANY ROWS ARE DRAWN IS `lazyWrap`'S BUSINESS, NOT THIS FILE'S — it keeps that in its own `LAZY` map.
 * But a control change must send it back to the top: narrowing 812 rows to 150 while it still believes 400 are
 * revealed would draw the entire narrowed answer at once, and look identical to nothing having been filtered.
 * ⚠️ `LAZY` is a top-level `const` in app.html, so it is NOT on `window` and it is in the temporal dead zone
 * until that script runs — `typeof` THROWS on a TDZ binding, hence the try. [[feedback-probe-the-right-scope]]
 */
function listCtlResetRows(key) {
  try {
    if (LAZY) delete LAZY[key];
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
}

/**
 * Declare a list. Safe to call on every render: the CONFIG is replaced (so a closure never goes stale) and the
 * STATE — what was typed, what was chosen, how far it was scrolled — is kept.
 *
 * @param key     a name for this list, e.g. 'customers'
 * @param cfg.rows      () => the full array the browser holds
 * @param cfg.text      (row) => the text a search should look in
 * @param cfg.sorts     [{ key, label, cmp }]  — the FIRST is the default
 * @param cfg.filters   [{ key, label, all, options:[{v,label}], match(row, v) }]
 * @param cfg.repaint   () => repaint the list body and the count
 * @param cfg.noun      'customer' — for "812 customers"
 */
function listCtl(key, cfg) {
  var s = LISTCTL[key] || (LISTCTL[key] = { q: '', sort: 0, f: {} });
  s.cfg = cfg;
  return s;
}
function listCtlS(key) {
  return LISTCTL[key] || { cfg: null, q: '', sort: 0, f: {} };
}

/**
 * What the screen should draw: everything, what matched, and the slice to render.
 * ⚠️ `matched` is computed every call rather than cached. A cached count is a count that disagrees with the rows
 * the first time somebody adds a customer without telling the cache.
 */
function listCtlView(key) {
  var list = listCtlS(key),
    c = list.cfg;
  if (!c) return { all: [], matched: [] };
  var all = (c.rows && c.rows()) || [];
  var q = String(list.q || '')
    .trim()
    .toLowerCase();
  var matched = all.filter(function (row) {
    if (
      q &&
      String((c.text && c.text(row)) || '')
        .toLowerCase()
        .indexOf(q) < 0
    )
      return false;
    for (var index = 0; index < (c.filters || []).length; index++) {
      var f = c.filters[index],
        v = list.f[f.key];
      if (v && !f.match(row, v)) return false;
    }
    return true;
  });
  var sorts = c.sorts || [];
  var srt = sorts[list.sort] || sorts[0];
  /* ⚠️ sort a COPY. Sorting `matched` in place is fine, but `matched` is `all` itself when nothing is filtered,
     and reordering the screen's own array is how a list silently changes under everything else reading it. */
  if (srt && srt.cmp) matched = matched.slice().sort(srt.cmp);
  if (list.rev) matched = matched.slice().reverse(); /* a heading clicked twice (tblSortBy) */
  return { all: all, matched: matched };
}

/**
 * ⭐ THE ROWS — every match handed to `lazyWrap`, which draws the first 50 and reveals the rest as the sentinel
 * comes into view or the reader presses its button. The COUNT it prints is the true one, because `matched` is
 * the true one: what changes is how many are DRAWN, never what the list claims to hold.
 */
function listCtlRowsHTML(key, rowFn, emptyHTML) {
  var v = listCtlView(key);
  return lazyWrap(key, v.matched, rowFn, emptyHTML || '');
}

/* ── the controls ──────────────────────────────────────────────────────────────────────────────────────────── */

/** search · filters · sort, in one row. The screen places it; this decides nothing about where. */
function listCtlToolbarHTML(key) {
  var list = listCtlS(key),
    c = list.cfg;
  if (!c) return '';
  var k = "'" + key + "'";
  /* ⚠️ oninput, NOT onkeydown. Enter-only is how "search is broken" happens: the box takes typing and the list
     does not move, with nothing on screen saying why. The watcher checks for exactly this. */
  var search =
    '<div class="srch" style="flex:1 1 150px;min-width:130px">🔍 <input data-cbsid="SCR041-I01" data-testid="listctl-search-' +
    esc(key) +
    '"' +
    ' placeholder="' +
    esc(tx('Search')) +
    '" value="' +
    esc(list.q || '') +
    '"' +
    ' oninput="listCtlSetQ(' +
    k +
    ',this.value)"></div>';

  var filters = (c.filters || [])
    .map(function (item) {
      var opts =
        '<option value="">' +
        esc(item.all || tx('All')) +
        '</option>' +
        (item.options || [])
          .map(function (o) {
            return '<option value="' + esc(o.v) + '"' + (list.f[item.key] === o.v ? ' selected' : '') + '>' + esc(o.label) + '</option>';
          })
          .join('');
      return (
        '<select data-cbsid="SCR041-S01" class="inp" data-testid="listctl-filter-' +
        esc(item.key) +
        '" title="' +
        esc(item.label) +
        '"' +
        ' style="width:auto;padding:3px 6px;font-size:var(--fs-1)"' +
        ' onchange="listCtlSetFilter(' +
        k +
        ",'" +
        esc(item.key) +
        '\',this.value)">' +
        opts +
        '</select>'
      );
    })
    .join('');

  var sorts =
    (c.sorts || []).length > 1
      ? '<select data-cbsid="SCR041-S02" class="inp" data-testid="listctl-sort-' +
        esc(key) +
        '" title="' +
        esc(tx('Sort order')) +
        '"' +
        ' style="width:auto;padding:3px 6px;font-size:var(--fs-1)"' +
        ' onchange="listCtlSetSort(' +
        k +
        ',this.value)">' +
        c.sorts
          .map(function (item, index) {
            return '<option value="' + index + '"' + (index === list.sort ? ' selected' : '') + '>' + esc(item.label) + '</option>';
          })
          .join('') +
        '</select>'
      : '';

  return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px">' + search + filters + sorts + '</div>';
}

/**
 * ⭐ HOW MANY MATCHED — and, only while some are undrawn, how many are drawn.
 * ⚠️ It never reports the drawn number ALONE. "100 customers" when there are 812 is the exact sentence that made
 * Athi ask for all of this.
 */
function listCtlCountHTML(key) {
  var s = listCtlS(key),
    c = s.cfg,
    v = listCtlView(key);
  var noun = (c && c.noun) || 'row';
  var plural = v.matched.length === 1 ? noun : (c && c.plural) || noun + 's';
  var narrowed = v.matched.length !== v.all.length;
  /* ⭐ how many are DRAWN is not said here — lazyWrap's own sentinel says "50 of 812" at the foot of the rows,
     where somebody who has run out of list is actually looking. Saying it twice would be two places to keep
     agreeing, and the pager on the Platform screen taught that lesson once already. */
  return esc(v.matched.length + ' ' + plural) + (narrowed ? ' <span style="color:var(--grey-4)">' + esc(tx('of') + ' ' + v.all.length) + '</span>' : '');
}

/* ⚠️ EVERY CHANGE SENDS THE ROWS BACK TO THE TOP. Narrowing while lazyWrap still believes 400 are revealed
   would draw the whole of a narrower answer at once — and look identical to no filtering having happened. */
function listCtlSetQ(key, v) {
  var s = listCtlS(key);
  s.q = v;
  listCtlResetRows(key);
  if (s.cfg && s.cfg.repaint) s.cfg.repaint();
}
function listCtlSetFilter(key, f, v) {
  var s = listCtlS(key);
  s.f[f] = v;
  listCtlResetRows(key);
  if (s.cfg && s.cfg.repaint) s.cfg.repaint();
}
function listCtlSetSort(key, i) {
  var list = listCtlS(key);
  list.sort = Number(i) || 0;
  list.rev = false;
  listCtlResetRows(key);
  if (list.cfg && list.cfg.repaint) list.cfg.repaint();
}

/**
 * ⭐ THE EMPTY CASE IS TWO DIFFERENT SENTENCES, and telling them apart is the whole value of saying anything.
 * "No customers yet" is an invitation; "nothing matches 'ravi'" is a correction, and showing the first when the
 * second is true tells somebody their data is gone. [[feedback-write-for-the-shopkeeper]]
 */
function listCtlEmptyHTML(key, icon, title, sub) {
  var s = listCtlS(key),
    v = listCtlView(key);
  var narrowed =
    s.q ||
    Object.keys(s.f || {}).some(function (item) {
      return s.f[item];
    });
  if (v.all.length && narrowed) {
    return emptyState(
      icon || '🔍',
      tx('Nothing matches'),
      tx('No row here matches what you have typed or chosen. Clear the search or the filters to see the rest.')
    );
  }
  return emptyState(icon || '📄', title, sub);
}

/* ═══ ⭐ UNIVERSAL CLIENT-SIDE LAZY LIST — MOVED from app.html (the Task screen, the catalogue and every list keep calling lazyWrap) ═══ */
/* ── universal client-side lazy list — reveals N rows at a time in ANY container ────────────
   IntersectionObserver auto-reveal + a "Show more" button fallback (never stuck) + total/end marker.
   For lists whose endpoint returns everything at once: lazyWrap(id, items, cardFn, emptyHtml). */
var LAZY = {};
/**
 * ── ⚠️⚠️⚠️ A REPAINT MUST NOT TAKE BACK THE ROWS SOMEBODY ASKED FOR ───────────────────────────────────────────
 *
 * Athi, INC-260912-0XJN: *"it says 500 products but only 12 rows are listed."*
 *
 * ⚠️⚠️ AND THE COUNT WAS RIGHT. `shown` was reset to 50 on EVERY rebuild — and this list rebuilds constantly:
 * the twenty-second refresh, the categories arriving, the tax slabs, the offers, every late loader calls
 * paintProdList. So you press "Show 50 more" three times, reach row 200, a timer fires, and you are back at
 * fifty while the header still says how many there really are. Measured on the deployed page: revealed 60,
 * repainted, `LAZY.prodlist.shown` was 50 again.
 *
 * ⚠️ AND IT TOOK THE SCROLL WITH IT. paintProdList carefully restores scrollTop onto a box that just lost
 * three quarters of its height, so the restore lands past the end and the list jumps. Two symptoms, one cause.
 *
 * ⭐ SO THE WINDOW IS KEPT, and it is kept HERE rather than at the one call site that complained — the same
 * reset was under the chit history, the message thread and both dispute lists, none of which had been
 * noticed. [[feedback-repaint-locally]]
 *
 * ⚠️ KEPT ONLY WHILE IT STILL FITS. If the list has shrunk below what was revealed — a filter narrowed it,
 * rows were deleted — the window goes back to one chunk: showing "150 of 12" is a worse lie than collapsing.
 * ⚠️ And never below `chunk`, so a list that grows never shows fewer rows than a fresh one would.
 */
function lazyWrap(id, items, cardFn, empty) {
  items = items || [];
  const kept = LAZY[id];
  if (kept && kept._io) {
    try {
      kept._io.disconnect();
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }
  if (!items.length) return empty || '';
  const chunk = 50;
  var shown = Math.min(chunk, items.length);
  if (kept && kept.shown > shown && kept.shown <= items.length) shown = kept.shown;
  LAZY[id] = { items, cardFn, chunk, shown: shown, total: items.length, _io: null };
  setTimeout(function () {
    lazyAttach(id);
  }, 0);
  return items.slice(0, LAZY[id].shown).map(cardFn).join('') + lazyBar(id);
}
function lazyBar(id) {
  const s = LAZY[id];
  if (!s) return '';
  const left = s.total - s.shown;
  const inner =
    left <= 0
      ? '<div class="listend">' + s.total + ' total · end of list</div>'
      : '<div class="listend"><button data-cbsid="SCR041-B01" class="composebtn" onclick="lazyReveal(\'' +
        id +
        '\')">↓ Show ' +
        Math.min(s.chunk, left) +
        ' more</button> <span style="color:var(--grey)">' +
        s.shown +
        ' of ' +
        s.total +
        '</span></div>';
  return '<div class="lazysent" id="lzs_' + id + '">' + inner + '</div>';
}
function lazyReveal(id) {
  const s = LAZY[id];
  if (!s) return;
  const sent = document.getElementById('lzs_' + id);
  if (!sent) return;
  const next = s.items.slice(s.shown, s.shown + s.chunk);
  if (next.length) {
    sent.insertAdjacentHTML('beforebegin', next.map(s.cardFn).join(''));
    s.shown += next.length;
  }
  const left = s.total - s.shown;
  if (left <= 0) {
    sent.innerHTML = '<div class="listend">' + s.total + ' total · end of list</div>';
    if (s._io) {
      try {
        s._io.disconnect();
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
      s._io = null;
    }
  } else
    sent.innerHTML =
      '<div class="listend"><button data-cbsid="SCR041-B02" class="composebtn" onclick="lazyReveal(\'' +
      id +
      '\')">↓ Show ' +
      Math.min(s.chunk, left) +
      ' more</button> <span style="color:var(--grey)">' +
      s.shown +
      ' of ' +
      s.total +
      '</span></div>';
}
function lazyAttach(id) {
  const s = LAZY[id];
  if (!s || s.shown >= s.total) return;
  const sent = document.getElementById('lzs_' + id);
  if (!sent) return;
  try {
    s._io = new IntersectionObserver(
      function (list) {
        if (
          list.some(function (e) {
            return e.isIntersecting;
          })
        )
          lazyReveal(id);
      },
      { rootMargin: '0px' }
    );
    s._io.observe(sent);
  } catch (_) { /* best effort: failing here changes nothing the user sees */ }
}
