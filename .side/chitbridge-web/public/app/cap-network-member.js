/**
 * cap-network-member.js — the MEMBER half of the Network panel (P2 split of cap-network.js, by job).
 *
 * cap-network.js keeps the DESIGN job (the builder: nodes, capabilities, build/mint). This file holds what a store INSIDE someone's
 * network does: see the live network read-only, ask "where is it?", browse a sibling's catalogue and send a request. Moved whole from
 * cap-network.js (lines deleted there in the same change — one definition of each function); loaded with it by ensureCap('network')
 * (app.html CAP_WITH) in the shared global scope, so the call sites in networkScreen() are unchanged.
 
 * CALLED BY public/app/cap-network.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
/*
 * OWNS      the member half of the Network panel: the read-only live network, where-is-it, a sibling's catalogue and the request
 * CALLED BY ensureCap('network') pulls it in first through CAP_WITH (public/app.html:6098); scripts/cap-network-render.test.mjs:154
 * FLOW      ensureCap('network') -> this half loads -> networkScreen() in cap-network.js calls it in the shared global scope
 * CARD      04-network/network-app-member-view
 */
/**
 * A MEMBER'S VIEW — the same network, read-only.
 *
 * Athi, 2026-08-08: *"if we login with any of the store, it has to show the same network, but can't create or
 * update or modify the network."*
 *
 * The design document belongs to the operator and is RLS-scoped to it, so a member could never load it anyway.
 * What a member should see is the LIVE network — the tree it actually sits on — with no controls at all. Showing
 * them a design canvas would invite them to draw a second, private network that Build would refuse to touch.
 */
function _netMemberScreen() {
  var L = UI._netLive || {};
  var mine = String((L.me && (L.me.bridgeId || L.me.bridge_id)) || '');
  // A real DEPTH-FIRST walk, siblings by name — the same rule the operator's tree uses, so both read identically.
  // Sorting the flat list by `path` (which is what the server returns) orders by bridge id, i.e. at random.
  var all = (L.nodes || []).slice();
  var childrenOf = {};
  all.forEach(function (item) {
    var p = String(item.path || '');
    var i = p.lastIndexOf('.');
    var parent = i < 0 ? '' : p.slice(0, i);
    (childrenOf[parent] = childrenOf[parent] || []).push(item);
  });
  Object.keys(childrenOf).forEach(function (item) {
    childrenOf[item].sort(_netByName);
  });
  var rows = [];
  (function walk(parentPath) {
    (childrenOf[parentPath] || []).forEach(function (item) {
      rows.push(item);
      walk(String(item.path || ''));
    });
  })('');
  var list = rows
    .map(function (item) {
      var bid = String(item.bridgeId || item.bridge_id || '');
      var depth = Math.max(0, String(item.path || '').split('.').length - 1);
      var isMe = bid === mine;
      return (
        '<div style="padding:8px 10px 8px ' +
        (12 + depth * 18) +
        'px;font-size:var(--fs-2);border-bottom:1px solid var(--line);' +
        (isMe ? 'background:var(--purple-tint);border-inline-start:3px solid var(--purple-2);' : '') +
        ';color:var(--on-card)">' +
        (depth ? '<span style="color:var(--grey)">└ </span>' : '◆ ') +
        (isMe
          ? '<b>' + esc(item.name || bid) + '</b> <span style="font-size:var(--fs-1);color:var(--purple-2);font-weight:700"><span class=arw>←</span> you</span>'
          : esc(item.name || bid)) +
        ' <span style="font-size:var(--fs-1);color:var(--grey);font-family:ui-monospace,Menlo,monospace">' +
        esc(bid) +
        '</span>' +
        // b117 — carried onto the store at Build, so a MEMBER can read why each branch exists. Until then this tree
        // was a list of names, which tells a new store nothing about the network it just joined.
        (item.purpose ? '<div style="font-size:var(--fs-1);color:var(--grey-3);margin-top:2px;line-height:1.4">' + esc(item.purpose) + '</div>' : '') +
        // b119 — where it is, for a member reading the network. A store you may be asked to transfer goods to is a
        // place before it is a name.
        (item.city || item.lat != null
          ? '<div style="font-size:var(--fs-1);color:var(--grey-3);margin-top:1px">📍 ' +
            esc(item.city || '') +
            (item.lat != null && item.lng != null ? ' · locatable' : ' · not locatable') +
            (item.service_km ? ' · serves ' + esc(item.service_km) + ' km' : '') +
            '</div>'
          : '') +
        '</div>'
      );
    })
    .join('');
  var rootName = (rows[0] && (rows[0].name || rows[0].bridge_id)) || 'the network operator';
  return (
    '<div style="padding:22px;max-width:640px">' +
    '<div style="font-size:var(--fs-5);font-weight:800">' +
    tx('🔗 Your network') +
    '</div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin:8px 0 14px;line-height:1.6">You are part of <b>' +
    esc(rootName) +
    '</b>. The structure is set by the network operator — you can see it here, and you look after your own store, its catalogue and its people.</div>' +
    '<div style="border:1px solid var(--line);border-radius:12px;background:var(--card);overflow:hidden;color:var(--on-card)">' +
    list +
    '</div>' +
    '<div style="margin-top:14px;padding:11px 13px;border:1px solid var(--line);border-radius:9px;background:var(--card);font-size:var(--fs-2);color:var(--grey);line-height:1.6">' +
    'Only <b>' +
    esc(rootName) +
    '</b> can add, change or remove stores in this network. ' +
    'Ask them if something here is wrong.</div></div>'
  );
}

/* ── WHO IN MY NETWORK HAS THIS? ──────────────────────────────────────────────────────────────────────────────
   Athi, 2026-08-08: *"if there is a query about one product, how can we provide where exactly the product is and
   how quickly this can be sent across?"*

   Every number on this screen is REAL — quantity, source, date and distance all come from
   GET /api/network-design/availability. It waited for lib/availability.js to exist rather than shipping a screen
   of invented figures, which is why it is worth reading.

   The two states the rendering leads with are the ones that decide whether a person can trust it:
     UNKNOWN   a store carrying the item that has never reported. Never drawn as 0.
     STALE     a figure old enough that acting on it is a gamble, said out loud rather than shaded away.  */
var _avT = null;
function netAvailSearch(v) {
  UI._avQ = String(v || '');
  if (_avT) clearTimeout(_avT);
  var q = UI._avQ.trim();
  if (q.length < 2) {
    UI._avRes = null;
    UI._avBusy = false;
    _netPaintAvail();
    return;
  }
  UI._avBusy = true;
  _netPaintAvail();
  // Debounced: a keystroke is not a question, and this walks every store in the network.
  _avT = setTimeout(function () {
    api('netAvail', { query: { q: q } })
      .then(function (reply) {
        UI._avBusy = false;
        UI._avRes = reply;
        _netPaintAvail();
      })
      .catch(function (e) {
        UI._avBusy = false;
        UI._avRes = { error: (e && e.message) || 'Search failed' };
        _netPaintAvail();
      });
  }, 400);
}
/** Open one product group. Clicking the open one closes it, so a long list can be collapsed back down. */
function netAvailToggle(key) {
  UI._avOpen = UI._avOpen === key ? null : key;
  _netPaintAvail();
}

/** Repaint only this pane — the rest of the page has nothing to do with the answer. */
function _netPaintAvail() {
  var el = typeof document !== 'undefined' ? document.getElementById('netAvailBody') : null;
  if (el) el.innerHTML = _netAvailBody();
}
function _netAvailBody() {
  var text = String(UI._avQ || '').trim();
  if (text.length < 2) {
    return (
      '<div style="padding:26px 4px;color:var(--grey);font-size:var(--fs-2);line-height:1.7">' +
      'Type a product name or code. Every store in your network is asked, and each answers with what it has, ' +
      '<b>where the number came from</b> and <b>when it was last true</b>.' +
      '<div style="margin-top:10px;font-size:var(--fs-2)">A store that has never reported comes back as <b>unknown</b> — ' +
      'not as zero. The two are different, and only one of them can be fixed by asking.</div></div>'
    );
  }
  if (UI._avBusy) return '<div style="padding:22px 4px;color:var(--grey);font-size:var(--fs-2)">' + tx('Asking every store…') + '</div>';
  var R = UI._avRes;
  if (!R) return '';
  if (R.error) return '<div style="padding:20px 4px;color:var(--disp-2);font-size:var(--fs-2)">' + esc(R.error) + '</div>';
  if (R.not_in_network) {
    return (
      '<div style="padding:22px 4px;color:var(--grey);font-size:var(--fs-2)">This business is not part of a network, ' + 'so there is nobody else to ask.</div>'
    );
  }
  var rows = R.rows || [];
  if (!rows.length) {
    return (
      '<div style="padding:22px 4px;color:var(--grey);font-size:var(--fs-2)">No store in your network carries anything ' + 'matching “' + esc(text) + '”.</div>'
    );
  }
  /**
   * ── GROUPED BY PRODUCT, NOT BY ROW ──────────────────────────────────────────────────────────────────────
   * Athi, 2026-08-08: *"if the same shop has similar names, it is bringing all the items, but each product one
   * line item with shop name etc — can't we group together and make it selectable?"*
   *
   * He is right, and the flat list had the shape of the QUERY rather than of the question. Searching "test"
   * matched three different products, so North appeared three times and a person had to reassemble "which
   * product is this row about" from the small print. The question is "where is THIS PRODUCT", so the product is
   * the heading and the stores are what sit under it.
   *
   * Grouped by code where there is one, and by name where there is not — a code is the identity, a name is a
   * label two stores may spell differently.
   */
  var groups = [],
    byKey = {};
  rows.forEach(function (item) {
    var key = item.code ? 'c:' + String(item.code).toLowerCase() : 'n:' + String(item.name).toLowerCase();
    if (!byKey[key]) {
      byKey[key] = { key: key, name: item.name, code: item.code, rows: [] };
      groups.push(byKey[key]);
    }
    byKey[key].rows.push(item);
  });
  // Most-answerable product first: the one with stock somewhere, then the one with the most stores holding it.
  groups.forEach(function (item) {
    item.have = item.rows.filter(function (x) {
      return x.qty !== null && x.qty !== undefined && x.qty > 0;
    });
    item.total = item.have.reduce(function (total, x) {
      return total + x.qty;
    }, 0);
    item.unknown = item.rows.filter(function (x) {
      return x.qty === null || x.qty === undefined;
    }).length;
  });
  groups.sort(function (first, second) {
    return second.have.length - first.have.length || second.total - first.total;
  });

  var one = groups.length === 1;
  var body = groups
    .map(function (item) {
      var open = one || UI._avOpen === item.key;
      var head =
        '<div data-cbsid="SCR031-C01" onclick="netAvailToggle(\'' +
        item.key +
        '\')" style="cursor:pointer;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;' +
        'padding:11px 2px;border-bottom:1px solid var(--line);background:' +
        (open ? 'transparent' : 'var(--card)') +
        '">' +
        '<span style="color:var(--grey);font-size:var(--fs-2);width:12px">' +
        (open ? '▾' : '<span class=arw>▸</span>') +
        '</span>' +
        '<b style="font-size:var(--fs-3)">' +
        esc(item.name) +
        '</b>' +
        (item.code ? '<span style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-1);color:var(--grey)">' + esc(item.code) + '</span>' : '') +
        '<span style="margin-inline-start:auto;font-size:var(--fs-2);color:' +
        (item.have.length ? 'var(--ok-2)' : 'var(--blue-2)') +
        ';font-weight:700">' +
        (item.have.length ? item.total + ' across ' + item.have.length + ' store' + (item.have.length === 1 ? '' : 's') : 'nobody has reported any') +
        (item.unknown ? '<span style="font-weight:400;color:var(--warn-2)"> · ' + item.unknown + ' unknown</span>' : '') +
        '</span></div>';
      return head + (open ? item.rows.map(storeRow).join('') : '');
    })
    .join('');

  function storeRow(r) {
    var f = r.freshness || {};
    var unknown = r.qty === null || r.qty === undefined;
    var none = !unknown && r.qty <= 0;
    var qtyTxt = unknown ? 'not reported' : r.qty + ' in stock';
    var qtyCol = unknown ? 'var(--blue-2)' : none ? 'var(--disp-2)' : 'var(--ok-2)';
    return (
      '<div style="padding:11px 2px;border-bottom:1px solid var(--line);' +
      (unknown || none ? 'opacity:.75;' : '') +
      '">' +
      '<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">' +
      '<b style="font-size:var(--fs-3)">' +
      esc(r.store) +
      '</b>' +
      (r.is_me
        ? '<span style="font-size:var(--fs-1);font-weight:800;color:var(--purple-2);background:var(--purple-tint);border-radius:5px;padding:1px 6px">' +
          tx('YOU') +
          '</span>'
        : '') +
      (r.city ? '<span style="font-size:var(--fs-2);color:var(--grey)">' + esc(r.city) + '</span>' : '') +
      '<span style="font-size:var(--fs-2);color:var(--grey)">' +
      (r.km === null || r.km === undefined ? 'distance unknown' : r.km + ' km') +
      '</span>' +
      '<b style="margin-inline-start:auto;font-size:var(--fs-3);color:' +
      qtyCol +
      '">' +
      qtyTxt +
      '</b></div>' +
      // WHEN, next to how many — the question was never just "who has it".
      (function () {
        var e = r.eta || {};
        if (e.declared) {
          return (
            '<div style="font-size:var(--fs-2);color:var(--ok-2);font-weight:700;margin-top:3px">' +
            (e.days === 0 ? 'today' : e.days === 1 ? 'tomorrow' : 'in ' + e.days + ' days') +
            ' <span style="font-weight:400;color:var(--grey)">· ' +
            esc(e.basis || '') +
            '</span></div>'
          );
        }
        // Not "unknown days" — WHICH number is missing, so somebody can go and get it.
        return '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:3px">how soon: not declared · ' + esc(e.basis || '') + '</div>';
      })() +
      '<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:4px">' +
      '<span style="font-size:var(--fs-2);color:var(--grey)">' +
      esc(r.name) +
      (r.code ? ' · ' + esc(r.code) : '') +
      '</span>' +
      // The holding store's OWN price, in its OWN currency, as it stamped it. Shown as a code and never converted —
      // what this store would charge is a fact about that store, and turning it into your currency here would be
      // inventing a rate nobody agreed.
      (r.price !== null && r.price !== undefined
        ? '<span style="font-size:var(--fs-2);font-weight:700">' +
          esc(r.price_currency || '') +
          ' ' +
          CBLocale.number(Number(r.price), { maximumFractionDigits: 2 }) +
          '</span>'
        : '<span style="font-size:var(--fs-1);color:var(--grey)">no price set</span>') +
      // The provenance of the number, always. A quantity without it is not an answer.
      '<span style="margin-inline-start:auto;font-size:var(--fs-1);font-weight:800;letter-spacing:.03em;border-radius:5px;padding:1px 6px;' +
      (f.stale ? 'background:var(--warn-tint);color:var(--warn-2)' : 'background:var(--ok-tint);color:var(--ok-2)') +
      '">' +
      esc((r.source || 'no source') + ' · ' + (f.label || 'no date')) +
      '</span></div>' +
      (unknown
        ? '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:4px">This store carries the item but has never reported a quantity. <b>' +
          tx('Unknown is not zero') +
          '</b> — worth asking before routing around it.</div>'
        : f.stale
          ? '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:4px">This figure is ' + esc(f.label) + '. Acting on it is a guess.</div>'
          : '') +
      // ── ASK FOR IT ────────────────────────────────────────────────────────────────────────────────────────
      // The point of knowing who has it. This is an ordinary chit — the same rail as every other request between
      // two businesses — so it lands in their Task list, carries a line item, and can be disputed like anything
      // else. Nothing new is invented for "internal" transfers: a store asking a sibling is still two parties.
      (r.is_me
        ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:5px">This is your own stock.</div>'
        : '<div style="margin-top:7px"><button data-cbsid="SCR031-B01" onclick="netAskFor(\'' +
          esc(r.entity_id) +
          "','" +
          esc(r.store) +
          "','" +
          esc(String(r.name).replace(/'/g, '')) +
          "','" +
          esc(r.bridge_id || '') +
          "'," +
          (r.price === null || r.price === undefined ? 'null' : Number(r.price)) +
          ')" style="padding:5px 12px;font-size:var(--fs-2)">' +
          (unknown ? 'Ask if they have it' : 'Request from ' + esc(r.store)) +
          '</button></div>') +
      '</div>'
    );
  }
  return (
    '<div style="padding:13px 2px 4px;font-size:var(--fs-3);font-weight:700">' +
    esc(R.summary || '') +
    '</div>' +
    body +
    // Two paths can cap an answer, and they cap DIFFERENT things: the fan-out runs out of stores, the single
    // network query (b122) runs out of rows. Saying "asked the first undefined of undefined stores" for the
    // second would be worse than saying nothing — a cap must be reported in the terms it was actually applied in.
    (R.truncated
      ? '<div style="font-size:var(--fs-1);color:var(--warn-2);padding:9px 2px">' +
        (R.truncated.of
          ? 'Asked the first ' + R.truncated.asked + ' of ' + R.truncated.of + ' stores.'
          : 'Showing the first ' + R.truncated.shown + ' matches across the network — narrow the search to see the rest.') +
        '</div>'
      : '')
  );
}
/**
 * Ask a store in the network to send goods.
 *
 * Athi, 2026-08-08: *"now we have to see how to trigger a request to the store which has got the goods."*
 *
 * It is an ORDINARY CHIT. A store asking a sibling is still two parties, so it goes down the same rail as every
 * other request between businesses: it lands in their Task list, carries the item as a line, and can be disputed
 * like anything else. Nothing separate is invented for "internal" movement — the moment it were, the transfer
 * would stop being reconcilable against everything else, which is the whole reason CB exists.
 */
function netAskFor(entityId, storeName, itemName, bridgeId, rowPrice) {
  /**
   * ⚠️ THE COMPOSE PATH, NOT A CHIT FIRED FROM A PROMPT.
   *
   * Athi, 2026-08-08: *"request sent, but immature — it has to pull the request form designed by the store,
   * compose page, and fill the details of the requestor and send it like any other chit. The same compose path
   * for the storefront or supplier."*
   *
   * He is right, and my first version was a shortcut with real consequences. A chit assembled here would carry
   * whatever THIS page happened to think a request looks like, and would bypass everything the receiving store
   * has declared about how it wants to be asked — its order form, its required fields, its line-item shape. Two
   * ways to ask the same store for the same thing is how one of them quietly stops matching.
   *
   * So it goes down the SAME path a supplier order takes (composeFromSupplier): open compose, locked to that
   * store, with THEIR catalogue loaded, and the item this search found already on the first line. One compose,
   * one contract, one place where a request is made.
   */
  var openCompose = function (items) {
    if (typeof compose !== 'function') {
      if (typeof toast === 'function') toast('Compose is not available on this screen', true);
      return;
    }
    /**
     * ⚠️ THE PRE-FILLED LINE MUST CARRY THEIR PRICE, NOT ZERO.
     *
     * Athi, 2026-08-08: *"the item came with qty 1 and price as 0."* It did — I hardcoded a zero. A request that
     * opens at zero is not a blank waiting to be filled; it reads as an offer of nothing, and pressing send would
     * commit a line the supplier never agreed to at a number they never quoted.
     *
     * The price comes from THEIR catalogue first — the same list the dropdown is built from, matched by name — and
     * from what the search reported second. Only if neither knows does it fall back to 0, which by then genuinely
     * means "nobody has priced this".
     */
    var match = null,
      want = String(itemName || '')
        .trim()
        .toLowerCase();
    (items || []).forEach(function (item) {
      if (
        !match &&
        String(item.particulars || '')
          .trim()
          .toLowerCase() === want
      )
        match = item;
    });
    var price = match && match.price ? match.price : rowPrice !== undefined && rowPrice !== null && rowPrice !== '' ? Number(rowPrice) : 0;
    compose({
      supplier: { name: storeName, bridge: bridgeId || null, entity_id: entityId },
      recipients: [{ name: storeName, role: 'to', bridge: bridgeId || null, entity_id: entityId }],
      catalogue: items,
      // The line this search was about, so the person is not asked to find it again in a list they just searched.
      items: [{ particulars: (match && match.particulars) || itemName, unit: (match && match.unit) || 'unit', price: price, qty: 1 }]
    });
  };
  /**
   * ⚠️ OPEN FIRST, THEN FILL. Athi, 2026-08-08: *"the compose window takes time to load."*
   *
   * It waited for the supplier's whole catalogue before showing anything, so pressing Request sat on a dead screen
   * for a round trip. But the search already knows the one item this is about — its name and its price — so compose
   * can open immediately with that, and the rest of their catalogue arrives behind it.
   *
   * The thing being requested is therefore correct from the first frame. What fills in late is only the OTHER
   * items in the picker, which is the part nobody is waiting on.
   */
  var known = [{ particulars: itemName, unit: 'unit', price: rowPrice === undefined || rowPrice === null || rowPrice === '' ? 0 : Number(rowPrice) }];
  openCompose(known);

  if (typeof supCatalogueFull !== 'function') return;
  // supCatalogueFull is a plain function, not an EP key — it bypasses api() on purpose (it needs the sibling
  // fields that unwrap() would drop), and it is the SAME reader the supplier compose uses.
  supCatalogueFull(entityId)
    .then(function (reply) {
      var items = ((reply && reply.items) || []).map(function (item) {
        var d = item.item_data || item;
        return { particulars: d.name || d.product || 'item', unit: d.unit || 'unit', price: typeof cbAmount === 'function' ? cbAmount(d.price) : 0 };
      });
      if (!items.length) return;
      // Swap the picker's source in place. The composed LINES are untouched — a list arriving late must never
      // rewrite something the person has already started editing.
      if (typeof STORE !== 'undefined') STORE.catalogue = items;
      var node = typeof document !== 'undefined' ? document.getElementById('cc_pick') : null;
      if (node) {
        node.innerHTML = items
          .map(function (item, index) {
            return (
              '<option value="' +
              index +
              '">' +
              esc(item.particulars) +
              ' · ' +
              (typeof inr === 'function' ? inr(item.price) : item.price) +
              '/' +
              esc(item.unit || 'unit') +
              '</option>'
            );
          })
          .join('');
      }
    })
    .catch(function () {
      /* their catalogue is unreadable — the request can still be written */
    });
}

/* ── BROWSE A STORE'S CATALOGUE, THE SUPPLIER WAY ─────────────────────────────────────────────────────────────
   Athi, 2026-08-08: *"we have to have a mechanism of opening the store's catalogue from network, same style as
   supplier — everything works faster in the supplier menu."*

   He is right about the speed, and the reason is structural rather than mysterious: the supplier menu loads ONE
   store's catalogue ONCE and keeps it, while the search asks every store on every keystroke. Browsing is a
   different question — "show me what this store sells" — and it deserves the cheaper shape.

   So this uses the SAME reader the supplier menu uses (supCatalogueFull), which means the same one call and the
   same speed. Not a second implementation that would drift from it. */
/* ── THE STORE CART, HELD ─────────────────────────────────────────────────────────────────────────────────────
   `UI._netCart` is the handle, `UI._netCartFor` the store's entity_id. Released when you browse a DIFFERENT store,
   and deliberately NOT on netBrowseBack — going back to the store list is a look, not an abandonment, and the
   namespaced cart survived it too. At most one is held at a time. */
function _netCartRelease() {
  if (UI._netCart) UI._netCart.destroy();
  UI._netCart = null;
  UI._netCartFor = null;
  if (UI._netFlow) UI._netFlow.destroy();
  UI._netFlow = null;
  UI._netOrder = null;
}
function _netCartOpts() {
  return {
    listEl: 'cbpick_net',
    barEl: 'cbcartbar_net',
    renderer: CBCatUI,
    cartTitle: 'Your request',
    checkoutLabel: 'Check out →',
    // ⚠️ THE ONE SCREEN THAT ASKS FOR STOCK. A supplier publishes a catalogue; a network store also reports
    // what it HAS, and which store to ask is the question this screen exists to answer. Everywhere else
    // hideAvail stays true (its default), so no other catalogue grows an "avl —" on every row for a report
    // it never claimed to make. Absent is not zero, and a quantity with no date is a rumour — cart-ui keeps
    // those three states distinct.
    hideAvail: false,
    staleDays: 14,
    onCheckout: function () {
      if (UI._netFlow) UI._netFlow.next();
    },
    // Only the footer: adding a line unblocks "Check out" and changes nothing else. The cart repaints its
    // own bar and list; repainting the panel would rebuild the catalogue under the cursor.
    onChange: function () {
      if (UI._netFlow) UI._netFlow.paintFoot();
    }
  };
}
/** Your own store is in your own network. Ordering from yourself is not a transfer, it is a mistake. */
function netIsMe() {
  var L = UI._brStores,
    s = UI._brSel;
  if (!L || !s) return false;
  var hit =
    (L.stores || []).filter(function (x) {
      return x.entity_id === s.entity_id;
    })[0] || {};
  return hit.is_me === true;
}
function _netOrderState() {
  if (!UI._netOrder) UI._netOrder = { subject: '', by: '', addr: '', note: '' };
  return UI._netOrder;
}
function _netDefaultSubject() {
  return 'Request — ' + ((UI._brSel && UI._brSel.name) || 'store');
}
/**
 * ── THE STORE REQUEST, IN STEPS ───────────────────────────────────────────────────────────────────────────────
 * Identical in shape to Suppliers, and that is deliberate: ordering from a sibling store is the same act as
 * ordering from a supplier — pick who, pick what, say when, send. THREE steps; the store IS the recipient.
 */
function _netStepsFor() {
  return CBSteps.create({
    steps: [
      { k: 'items', n: 'Items', t: 'What do you need from them?' },
      { k: 'details', n: 'Details', t: 'When, where, and anything they should know' },
      { k: 'review', n: 'Review', t: 'Check it, then send' }
    ],
    railEl: 'net_rail',
    bodyEl: 'net_body',
    footEl: 'net_foot',
    subEl: 'net_sub',
    render: function (k) {
      return k === 'items' ? _netStepItems() : k === 'details' ? _netStepDetails() : _netStepReview();
    },
    guard: function (k) {
      // ⚠️ Checked on EVERY step, not just the first: you can reach Review and then discover it. Said on the chip
      // too, because a warning behind a tap is a warning found too late.
      if (netIsMe()) return 'This is your own store — pick another.';
      if (k === 'items' && !(UI._netCart && UI._netCart.lines())) return 'Add at least one item.';
      if (k === 'details' && !_netOrderState().subject.trim()) return 'A subject is required.';
      return null;
    },
    nextLabel: function (k) {
      return k === 'items' ? 'Check out →' : null;
    },
    sendLabel: function () {
      return 'Send request to ' + ((UI._brSel && UI._brSel.name) || 'them');
    },
    cancelLabel: '‹ all stores',
    draftLabel: 'Save draft',
    onCancel: netBrowseBack,
    onDraft: function () {
      netSendCart(true);
    },
    onSend: function () {
      netSendCart(false);
    },
    onStep: function () {
      _netPaintBrowse();
    }
  });
}
function _netStepItems() {
  var c = UI._netCart;
  if (!c) return '';
  return (
    (netIsMe()
      ? '<div style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:9px 12px;font-size:var(--fs-2);color:var(--warn-3);margin:0 0 9px">⚠ This is your own store. You cannot send yourself a request — pick another store.</div>'
      : '') +
    /* ⭐ The redesigned row (app/catalogue-ui.js), shared with Compose and Suppliers. The placeholder differs
       here because it is somebody else's store, not yours. */
    CBCatUI.pickerHTML(c, {
      placeholder: 'Search this store’s catalogue…',
      checkoutLabel: 'Check out →',
      emptyHint: 'Press + on what you need',
      empty: 'Nothing in this store’s catalogue matches that.',
      barEl: 'cbcartbar_net',
      listEl: 'cbpick_net',
      searchTestid: 'pick-search-net',
      listTestid: 'pick-net'
    })
  );
}
function _netStepDetails() {
  var o = _netOrderState();
  if (!o.subject) o.subject = _netDefaultSubject();
  return (
    '<div class="sec">Your request to ' +
    esc((UI._brSel && UI._brSel.name) || '') +
    '</div>' +
    '<label class="fl">Subject <span style="color:var(--disp)">*</span></label>' +
    '<input data-cbsid="SCR031-I01" class="inp" data-testid="net-subject" value="' +
    esc(o.subject) +
    '" oninput="UI._netOrder.subject=this.value;UI._netFlow&&UI._netFlow.paintFoot()">' +
    '<div style="display:flex;gap:10px"><div style="flex:1"><label class="fl">' +
    tx('Needed by') +
    '</label>' +
    '<input data-cbsid="SCR031-I02" class="inp" type="date" data-testid="net-by" value="' +
    esc(o.by) +
    '" oninput="UI._netOrder.by=this.value"></div>' +
    '<div style="flex:1"><label class="fl">' +
    tx('Deliver to') +
    '</label>' +
    '<input data-cbsid="SCR031-I03" class="inp" data-testid="net-addr" value="' +
    esc(o.addr) +
    '" placeholder="site / address" oninput="UI._netOrder.addr=this.value"></div></div>' +
    '<label class="fl">' +
    tx('Note') +
    '</label>' +
    '<input data-cbsid="SCR031-I04" class="inp" data-testid="net-note" value="' +
    esc(o.note) +
    '" placeholder="instructions" oninput="UI._netOrder.note=this.value">' +
    /* The same rail as any other chit — nothing separate is invented for "internal" movement, or it stops being
       reconcilable against everything else. */
    '<div style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:9px 12px;font-size:var(--fs-2);color:var(--warn-3);margin:10px 0">' +
    'This goes as an ordinary chit: it lands in their Task list and can be disputed like any other.</div>'
  );
}
function _netStepReview() {
  var o = _netOrderState(),
    c = UI._netCart,
    list = c ? c.selected() : []; /* the money block is the cart's (reviewHTML) */
  /* ⭐ THE CART FORMATS ITS OWN MONEY — see cart-ui's money(). This screen printed String(line_total), copied
     verbatim from the supplier review, so both said an amount with no currency on the last page before an order
     goes out. Athi reported the supplier one; this is the same defect on a screen he had not reached yet. */
  var _netMoney = function (n) {
    return c ? c.money(n) : n == null || !isFinite(n) ? '—' : String(n);
  };
  var s = UI._brSel || {};
  var row = function (k, v) {
    return (
      '<div style="display:flex;gap:10px;padding:8px 12px;border-top:1px solid var(--line);font-size:var(--fs-2)">' +
      '<span style="min-width:96px;color:var(--grey);font-size:var(--fs-1)">' +
      k +
      '</span><span style="flex:1">' +
      v +
      '</span></div>'
    );
  };
  var card = function (h, inner, edit) {
    return (
      '<div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-top:8px">' +
      '<div style="background:var(--paper);padding:8px 12px;font-size:var(--fs-1);font-weight:800;color:var(--grey);text-transform:uppercase;letter-spacing:.05em;display:flex">' +
      h +
      (edit != null
        ? '<span data-cbsid="SCR031-C02" style="margin-inline-start:auto;color:var(--blue);cursor:pointer;text-transform:none;letter-spacing:0;font-size:var(--fs-1)" onclick="UI._netFlow.go(' +
          edit +
          ')">' +
          tx('Change') +
          '</span>'
        : '') +
      '</div>' +
      inner +
      '</div>'
    );
  };
  return (
    card(
      'To<span style="margin-inline-start:auto;font-weight:400;text-transform:none;letter-spacing:0">fixed — this is their request</span>',
      '<div style="padding:8px 12px;font-size:var(--fs-2)"><b>' +
        esc(s.name || '') +
        '</b> <span style="color:var(--grey);font-size:var(--fs-1)">' +
        esc(s.user_id || s.bridge_id || '') +
        '</span></div>'
    ) +
    card(
      'Items · ' + list.length,
      list
        .map(function (item) {
          return row(
            item.qty + ' × ' + esc(item.unit),
            '<span style="flex:1">' + esc(item.name) + '</span>' + '<b style="float:inline-end">' + esc(_netMoney(item.line_total)) + '</b>'
          );
        })
        .join('') +
        /* ONE LINE, ONE SOURCE: the cart prints its own money block — see CBCart.reviewHTML */
        (c ? c.reviewHTML({ totalTestid: 'net-total', taxTestid: 'net-tax' }) : ''),
      0
    ) +
    card(
      'Details',
      row('Subject', esc(o.subject)) +
        row('Needed by', o.by ? esc(o.by) : '—') +
        row('Deliver to', o.addr ? esc(o.addr) : '—') +
        row('Note', o.note ? esc(o.note) : '—'),
      1
    ) +
    /* Money is stamped per entity and NEVER converted. A store trading in another currency shows its own. */
    '<div style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:9px;padding:9px 12px;font-size:var(--fs-2);color:var(--warn-3);margin:10px 0">' +
    'Their price, in their currency, exactly as their catalogue states it. Nothing is converted.</div>'
  );
}
/* netPickSearch lived here — the third of three identical one-line wrappers around cart.search(). CBCart.pickerHTML
   now calls CBCart.search directly, so all three are gone rather than left as doors nobody uses. */
function netBrowse(entityId, name, bridgeId) {
  UI._brSel = { entity_id: entityId, name: name, bridge_id: bridgeId };
  UI._brItems = null;
  UI._brCat = null;
  UI._brBusy = true;
  if (UI._netCartFor && UI._netCartFor !== entityId) _netCartRelease();
  _netPaintBrowse();
  if (typeof supCatalogueFull !== 'function') {
    UI._brBusy = false;
    _netPaintBrowse();
    return;
  }
  supCatalogueFull(entityId)
    .then(function (reply) {
      UI._brBusy = false;
      // The WHOLE payload is kept, not a flattened copy: the picker needs `groups` to put a product's sizes under
      // one heading, and a mapped list would have thrown that away — the same drift catalogue-lines.js exists to stop.
      UI._brCat = reply || {};
      UI._brItems = (reply && reply.items) || [];
      /**
       * ⚠️ THE CART IS CREATED HERE, where a catalogue ARRIVES — not in _netBrowseBody, which repaints on every
       * press of + and would hand back a new empty cart each time.
       *
       * A DIFFERENT STORE IS A DIFFERENT BASKET: carrying lines between two stores' catalogues would compose an
       * order to someone who never listed the item. The SAME store keeps what you were filling, so stepping back
       * to the store list to check something and returning does not cost you the basket — which is what the
       * namespaced cart did, by matching a signature. Here the screen knows, so nothing has to guess.
       */
      if (UI._netCart && UI._netCartFor === entityId) UI._netCart.setCatalogue(UI._brCat);
      else {
        _netCartRelease();
        UI._netCart = CBCart.create(UI._brCat, _netCartOpts());
        UI._netCartFor = entityId;
        UI._netFlow = _netStepsFor();
      }
      _netPaintBrowse();
    })
    .catch(function (e) {
      UI._brBusy = false;
      UI._brItems = [];
      UI._brErr = (e && e.message) || 'Could not read it';
      _netPaintBrowse();
    });
}
function netBrowseBack() {
  UI._brSel = null;
  UI._brItems = null;
  UI._brCat = null;
  UI._brErr = null;
  _netPaintBrowse();
}
/**
 * netSendCart — send the cart, as ONE request to that store.
 *
 * Athi, 2026-08-08: *"they should be able to select more product and then send button."*
 *
 * ⚠️ ONE CHIT, NOT ONE PER LINE. Five items picked from one store is one order with five lines — the same thing a
 * supplier order is. Firing five separate requests would give the receiving store five things to answer, five
 * things to dispute and nothing that adds up, which is precisely the reconciliation CB exists to make possible.
 *
 * ⚠️ IT SENDS, through sendChit() — the same one submitCompose and the Suppliers flow use. There is exactly one
 * createChit in this app, so a store request is the same kind of chit as any other and reconciles against them.
 * netOpenInCompose() below is the escape hatch for what three steps cannot express (CC, attachments, an unlisted
 * line); it is the old behaviour, kept and made explicit rather than removed.
 */
function netSendCart(isDraft) {
  var s = UI._brSel;
  if (!s || netIsMe()) return;
  var picked = UI._netCart ? UI._netCart.selected() : [];
  if (!isDraft && !picked.length) return;
  if (typeof sendChit !== 'function') {
    if (typeof toast === 'function') toast('Sending is not available on this screen', true);
    return;
  }
  // THEIR price, as they stamped it — never zero, never converted. Same rule as the single-item request.
  var amt = function (p) {
    var v = typeof cbAmount === 'function' ? cbAmount(p.price) : p.price;
    return v === null || v === undefined || v === '' ? 0 : Number(v) || 0;
  };
  var o = _netOrderState(),
    subj = o.subject || _netDefaultSubject();
  sendChit({
    recipients: [{ name: s.name, role: 'to', self: false }],
    isDraft: !!isDraft,
    send_as_label: (typeof SESSION !== 'undefined' && SESSION.entity) || '',
    subject: subj,
    schema_values: { subject: subj, delivery_by: o.by || '', deliver_to: o.addr || '', note: o.note || '' },
    line_items: picked.map(function (item) {
      return { particulars: item.name, quantity: +item.qty || 0, price: amt(item), total: (+item.qty || 0) * amt(item) };
    }),
    priority: 'normal',
    onSent: function () {
      _netCartRelease();
      netBrowseBack();
    },
    onError: function (m) {
      if (typeof toast === 'function') toast(m, true);
    }
  });
}
/** The full compose form, carrying everything the flow already collected. */
function netOpenInCompose() {
  var s = UI._brSel;
  if (!s || typeof compose !== 'function') return;
  var picked = UI._netCart ? UI._netCart.selected() : [];
  var amt = function (p) {
    var v = typeof cbAmount === 'function' ? cbAmount(p.price) : p.price;
    return v === null || v === undefined || v === '' ? 0 : Number(v) || 0;
  };
  var full = (UI._brItems || []).map(function (item) {
    var d = item.item_data || item;
    return { particulars: d.name || d.product || 'item', unit: d.unit || 'unit', price: typeof cbAmount === 'function' ? cbAmount(d.price) : d.price };
  });
  compose({
    subject: _netOrderState().subject || '',
    supplier: { name: s.name, bridge: s.bridge_id || null, entity_id: s.entity_id },
    recipients: [{ name: s.name, role: 'to', bridge: s.bridge_id || null, entity_id: s.entity_id }],
    catalogue: full,
    // The quantity set at the ROW travels through — it is not re-asked in compose, which would make the stepper a
    // suggestion rather than a decision. Still editable there, as every compose line is.
    items: picked.map(function (item) {
      return { particulars: item.name, unit: item.unit, price: amt(item), qty: item.qty || 1 };
    })
  });
}
function _netPaintBrowse() {
  var el = typeof document !== 'undefined' ? document.getElementById('netBrowseBody') : null;
  if (el) el.innerHTML = _netBrowseBody();
}
function _netBrowseBody() {
  if (UI._brSel) {
    var s = UI._brSel;
    /* THE CHIP — who you are ordering from, and the one warning that must never hide behind a tap. */
    var head =
      '<div style="padding-bottom:10px;border-bottom:1px solid var(--line)">' +
      '<span data-cbsid="SCR031-C03" onclick="netBrowseBack()" style="cursor:pointer;color:var(--blue);font-size:var(--fs-2)">‹ all stores</span>' +
      '<div data-testid="net-chip" style="display:inline-flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:22px;padding:6px 13px;background:var(--card);margin-inline-start:8px;color:var(--on-card)">' +
      '<b style="font-size:var(--fs-3)">' +
      esc(s.name) +
      '</b>' +
      (s.user_id || s.bridge_id
        ? '<span style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-1);color:var(--grey)">' + esc(s.user_id || s.bridge_id) + '</span>'
        : '') +
      (netIsMe()
        ? '<span style="background:var(--gold-soft);border:1px solid var(--gold-line);border-radius:20px;padding:2px 9px;font-size:var(--fs-1);color:var(--warn-2);font-weight:700">⚠ this is your own store</span>'
        : '') +
      '</div></div>';
    if (UI._brBusy) return head + '<div style="padding:20px 2px;color:var(--grey);font-size:var(--fs-2)">' + tx('Reading their catalogue…') + '</div>';
    var items = UI._brItems || [];
    if (!items.length) {
      return (
        head +
        '<div style="padding:20px 2px;color:var(--grey);font-size:var(--fs-2)">' +
        (UI._brErr ? esc(UI._brErr) : 'Nothing in this catalogue that you can see.') +
        '</div>'
      );
    }
    /**
     * ── THE SAME PICKER THE SUPPLIERS SCREEN USES ────────────────────────────────────────────────────────────────
     * Athi, 2026-08-08: *"in supplier and network, the same pattern. with check box, and search, they should be
     * able to select more product and then send button."* — and then: *"like normal cart… show the cart symbol so
     * there show how many items selected."*
     *
     * So this screen no longer renders its own item rows. It renders the shared picker (app/catalogue-lines.js for
     * the rules, the held CBCart for the house style) and a cart strip on top. A store's catalogue is the same one
     * whether you reached it through Suppliers or through the Network; two renderers would eventually disagree
     * about what a variant is, which is the divergence the shared walk was written to end.
     */
    var c = UI._netCart,
      f = UI._netFlow;
    if (!c || !f) return head + '<div style="padding:20px 2px;color:var(--grey);font-size:var(--fs-2)">' + tx('Reading their catalogue…') + '</div>';
    return (
      head +
      '<div id="net_rail">' +
      f.railHTML() +
      '</div>' +
      '<div id="net_sub" style="font-size:var(--fs-1);color:var(--grey);margin:0 0 8px">' +
      esc(f.steps()[f.index()].t || '') +
      '</div>' +
      '<div id="net_body">' +
      f.bodyHTML() +
      '</div>' +
      '<div id="net_foot" style="margin-top:12px;padding-top:11px;border-top:1px solid var(--line)">' +
      f.footHTML() +
      '</div>' +
      (f.isLast()
        ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">Need CC, attachments or a line they do not list? ' +
          '<span data-cbsid="SCR031-C04" data-testid="net-open-compose" onclick="netOpenInCompose()" style="cursor:pointer;color:var(--blue);font-weight:600">Open in compose <span class=arw>→</span></span></div>'
        : '')
    );
  }

  var L = UI._brStores;
  if (L === undefined) return '<div style="padding:20px 2px;color:var(--grey);font-size:var(--fs-2)">' + tx('Loading the network…') + '</div>';
  if (L === null) return '<div style="padding:20px 2px;color:var(--disp-2);font-size:var(--fs-2)">Could not load the network.</div>';
  if (L.not_in_network) return '<div style="padding:20px 2px;color:var(--grey);font-size:var(--fs-2)">This business is not part of a network.</div>';
  var stores = L.stores || [];
  if (!stores.length) return '<div style="padding:20px 2px;color:var(--grey);font-size:var(--fs-2)">No store in this network is visible to you.</div>';
  return stores
    .map(function (item) {
      return (
        '<div data-cbsid="SCR031-C05" onclick="netBrowse(\'' +
        esc(item.entity_id) +
        "','" +
        esc(String(item.name).replace(/'/g, '')) +
        "','" +
        esc(item.bridge_id || '') +
        '\')"' +
        ' style="cursor:pointer;padding:11px 2px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">' +
        '<b style="font-size:var(--fs-3)">' +
        esc(item.name) +
        '</b>' +
        (item.is_me
          ? '<span style="font-size:var(--fs-1);font-weight:800;color:var(--purple-2);background:var(--purple-tint);border-radius:5px;padding:1px 6px">' +
            tx('YOU') +
            '</span>'
          : '') +
        (item.city ? '<span style="font-size:var(--fs-2);color:var(--grey)">' + esc(item.city) + '</span>' : '') +
        (item.km !== null && item.km !== undefined ? '<span style="font-size:var(--fs-2);color:var(--grey)">' + item.km + ' km</span>' : '') +
        (item.currency ? '<span style="font-size:var(--fs-1);color:var(--grey)">' + esc(item.currency) + '</span>' : '') +
        '<span style="margin-inline-start:auto;color:var(--blue);font-size:var(--fs-2)">open catalogue ›</span>' +
        (item.purpose ? '<div style="width:100%;font-size:var(--fs-1);color:var(--grey-3)">' + esc(item.purpose) + '</div>' : '') +
        '</div>'
      );
    })
    .join('');
}
function _netBrowseScreen() {
  // The list is fetched ONCE per visit, not per render — the network does not change while you read it.
  if (UI._brStores === undefined && !UI._brBusyList) {
    UI._brBusyList = true;
    api('netStores')
      .then(function (reply) {
        UI._brStores = reply || { stores: [] };
        UI._brBusyList = false;
        _netPaintBrowse();
      })
      .catch(function () {
        UI._brStores = null;
        UI._brBusyList = false;
        _netPaintBrowse();
      });
  }
  return (
    '<div style="padding:18px 22px;max-width:760px">' +
    '<div style="font-size:var(--fs-5);font-weight:800">' +
    tx('🗂️ Store catalogues') +
    '</div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-top:4px;line-height:1.6">Open any store in your network ' +
    'and see what it sells — the same reader the Suppliers screen uses, so the same one call and the same speed.</div>' +
    '<div id="netBrowseBody" style="margin-top:14px">' +
    _netBrowseBody() +
    '</div></div>'
  );
}

function _netAvailScreen() {
  return (
    '<div style="padding:18px 22px;max-width:760px">' +
    '<div style="font-size:var(--fs-5);font-weight:800">🔎 Where is it?</div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-top:4px;line-height:1.6">Ask every store in your network ' +
    'what it has. The answer carries the quantity, the system it came from and when it was last true.</div>' +
    /* ⚠️ THIS BOX IS THE SCREEN'S SEARCH and it had no testid — so nothing could drive it and e2e/list-controls
       could not see it either, recording a gap against a control that has worked since August. */
    '<input data-cbsid="SCR031-I05" data-testid="net-avail-search" value="' +
    esc(UI._avQ || '') +
    '" oninput="netAvailSearch(this.value)" placeholder="a product name or code — e.g. impeller, IMP-90"' +
    ' style="width:100%;margin-top:13px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;font-size:var(--fs-3);box-sizing:border-box">' +
    '<div id="netAvailBody">' +
    _netAvailBody() +
    '</div>' +
    '</div>'
  );
}
