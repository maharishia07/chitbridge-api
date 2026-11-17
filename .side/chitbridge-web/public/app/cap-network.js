/* app/cap-network.js — DESIGN-FIRST network builder. Lazy via ensureCap('network').
 * DESIGN a tree under your OWN entity (top node) — a DRAFT; nothing is minted while you design.
 *   OWNED   (branch / unit / depot) — part of you; at Build → a real entity + a login key YOU hold (Co-assist pattern).
 *   PARTNER (external business)      — a peer under the network; at Build → a handshake (no key). Its catalogue is visible here.
 * Each node declares a PURPOSE (line 1) and WHAT IT HOLDS via capability checkboxes. Ticking one EXPANDS its config:
 *   🗂️ Catalogue → catalogue spec (common-catalogue pick → fields, commercial method, max-items constraint).
 *   🛒 Storefront → exposure (public / protected). Off ⇒ private/internal.
 *   (Co-assists · Transact · Trade-ready · Dispute — checkboxes now; their expansions come in later slices.)
 * Draft persists per-entity (localStorage + server, b111), survives reopen. "Build" is a dry-run (mints nothing);
 * real mint wiring is Phase B (through the real API / capability modules), added when that step is built.
 * OWNS      the DESIGN-first network builder: a draft tree under your own entity (nodes, the capabilities each holds, per-node config), its draft store
 *           (localStorage + /api/network-design) and the dry-run Build. Draws only inside app.html (the workshop), never on a customer page.
 * CALLED BY public/app.html (ensureCap('network'); loadNetwork() at :6493, _netFlush() at :5609, capScreen('networkScreen') at :22202) and
 *           public/app/cap-network-member.js (_netByName as the sort callback, :35). No customer page loads it by <script src>; network-app.js (network.html) calls none of its symbols.
 * FLOW      ensureCap('network') -> loadNetwork -> _netInit -> netWhereAmI (operator | member | standalone) -> the tree paints -> netSelect / netCapYes / netCapNo edit the draft -> Build (dry run).
 * CARD      04-network/network-design-builder
 * IDS       SUPPORT file (reached only through app.html, Athi: back office later): no data-cbsid here yet, header only (14 Nov).
 */

/* ---- capabilities a node can HOLD (checkboxes) ---- */
var NET_CAPS = [
  { k: 'catalogue', icon: '🗂️', label: 'Catalogue' },
  { k: 'storefront', icon: '🛒', label: 'Storefront' },
  { k: 'coassist', icon: '🧑‍🤝‍🧑', label: 'Co-assists' },
  { k: 'transact', icon: '🔄', label: 'Transact' },
  { k: 'tradeready', icon: '🛡️', label: 'Trade-ready' },
  { k: 'dispute', icon: '⚖️', label: 'Dispute' },
  /* ── PLACEMENTS ONLY — nothing behind these yet (2026-08-08) ──────────────────────────────────────────────
     Athi: *"assume Grundfos as a global supplier and its dealer / sub-dealer network across the globe — if we
     have to set it up, what do we need? Just do a placement, don't wire anything."*

     Each answers ONE question that a global distribution chain asks and CB currently cannot:
       place        where is it, and how far does it serve?        → "closest store" is a geometry question
       territory    what may it sell, where, at what tier?         → keeps a chain legal rather than chaotic
       stock        what does it actually hold, and how fresh?     → "who has it nearest" needs a number
       fulfil       how do goods reach a customer from here?       → lateral transfer, drop-ship, back-order
       pricepolicy  what may it charge?                            → a BAND, not a price
       localise     what changes when it crosses a border?         → same pump, different product
     See SPEC-global-distribution.md for the reasoning and what each would need underneath. */
  /* 🌍 GLOBAL — Athi, 2026-08-08: *"only the currency and the location, timestamp changes are the ones which
     make it global; if we make it as a separate tab that would be good."* Right, and they belong together: they
     are the three things that differ because a store is somewhere ELSE. Place folds in here rather than sitting
     as its own tab — one subject, one page, and one fewer tab. */
  { k: 'place', icon: '🌍', label: 'Global' },
  { k: 'territory', icon: '🗺️', label: 'Territory & authority', soon: true },
  { k: 'stock', icon: '📦', label: 'Stock & policy', soon: true },
  { k: 'fulfil', icon: '🚚', label: 'How fast' },
  { k: 'pricepolicy', icon: '💱', label: 'Price policy', soon: true },
  { k: 'localise', icon: '📜', label: 'Localisation', soon: true }
];

/* What each placement would capture. Written as the QUESTION it answers, then the fields — so the panel is
   useful to think with before any of it exists. `have` names what CB already has to build on; `need` is honest
   about what is missing, because a placeholder that implies more than it does is worse than no placeholder. */
var NET_SOON = {
  place: {
    q: 'Where is this node, and how far does it serve?',
    fields: ['Address · city · country', 'Latitude / longitude (or geohash)', 'Service radius', 'Time zone · working days'],
    have: 'cb_entity already carries latitude, longitude, geohash, city and country — dormant, unused.',
    need: 'the place on the LIVE entity, and a spatial index. Nearest-node is unanswerable without it.'
  },
  territory: {
    q: 'What may it sell, where, and at what tier?',
    fields: [
      'Tier — branch · distributor · dealer · sub-dealer · installer',
      'Authorised markets (country / state)',
      'Product lines it may carry',
      'Exclusive or shared',
      'Valid from / to'
    ],
    have: "source-governed distribution: the brand's rules travel with the catalogue to any distributor.",
    need: 'territory as a CHECKABLE attribute — so a Tamil Nadu dealer cannot answer a Kenya order.'
  },
  stock: {
    q: 'What does it actually hold — and how old is that number?',
    fields: [
      'Stocking or non-stocking',
      'Per-item min / max',
      'On hand · reserved · available',
      'Replenishment lead time',
      'Where the number comes from (ERP · IoT · manual) and when it was last true'
    ],
    have: 'the four-leg model can FEED this — system leg → ERP/IoT connector.',
    need: 'an availability record with a FRESHNESS stamp. A stock figure with no timestamp is a rumour.'
  },
  fulfil: {
    q: 'How do goods reach a customer from here?',
    fields: [
      'From own stock',
      'Lateral transfer from a sibling or nearby dealer',
      'From the regional warehouse',
      'Drop-ship from the source',
      'Back-order',
      'Transit days · who invoices · Incoterm per route'
    ],
    have: 'the chit rail already carries the instruction, and trace edges already record the handoff.',
    need: 'the ROUTES declared, with transit times — today nothing says goods may move sideways at all.'
  },
  pricepolicy: {
    q: 'What may it charge?',
    fields: [
      'Currency (already per entity)',
      'Basis — source list · territory list · its own',
      'Floor and ceiling, or margin band',
      'Who may discount, and by how much',
      'Tax treatment'
    ],
    have: 'money is stamped per entity and never converted; the catalogue already models price basis and by-ref.',
    need: 'the BAND. Today a price is yours or referenced — there is no "within these limits".'
  },
  localise: {
    q: 'What changes when this catalogue crosses a border?',
    fields: [
      'Destination markets served',
      'Required certifications (CE · UL · BIS · WRAS)',
      'Variants — voltage · frequency · fittings',
      'Language · labelling',
      'Import documents',
      'Warranty terms'
    ],
    have: 'per-copy overlay with per-field provenance, trade-lane confidence, compliance-by-catalogue.',
    need: 'the localisation MAP — which fields a market may override, and which the source freezes.'
  }
};
function _capMeta(k) {
  for (var index = 0; index < NET_CAPS.length; index++) if (NET_CAPS[index].k === k) return NET_CAPS[index];
  return null;
}

/* ---- catalogue spec vocabulary (leg/type vocab lives in the shared model, app/catalogue-model.js) ---- */
var CAT_TYPES = CBCatalogue.TYPES;
var CAT_METHODS = [
  { k: 'text', label: 'Text only', hint: 'no quantity, no price — information only' },
  { k: 'qty', label: 'Quantity only', hint: 'order a count; no price' },
  { k: 'cart', label: 'Cart (qty + price)', hint: 'standard: quantity × price' },
  { k: 'range', label: 'Price as a range', hint: 'price varies within a band' },
  { k: 'qtyprice', label: 'Price + qty vary', hint: 'both negotiable per order' }
];
var COASSIST_KINDS = [
  { k: 'human', icon: '🧑', label: 'Human workforce' },
  { k: 'erp', icon: '🔗', label: 'ERP connectors' },
  { k: 'iot', icon: '📡', label: 'IoT devices / streams' },
  { k: 'ai', icon: '🤖', label: 'AI agents' }
];
var ERP_SYSTEMS = ['SAP', 'Oracle', 'NetSuite', 'Dynamics', 'Tally', 'Other'];
var AI_AUTONOMY = ['propose', 'authorize', 'confirm', 'delegate'];
var IOT_TYPES = ['Raspberry Pi', 'Industrial gateway', 'PLC', 'Direct sensor', 'Other'];
var CAT_LOADS = ['manual', 'ERP sync', 'CSV', 'Excel', 'on-demand']; // how the LIST (catalogue) is built
var OFF_RAIL_CHANNELS = ['WhatsApp', 'email', 'scan']; // off-rail capture inlets — a message to a handle you own → captured to a chit
var COLLECT_CADENCE = ['per order', 'regular'];
// The four-leg information chain: every required field is routed to ONE origin leg; the record is then fed back to systems.
// Vocabulary + catalogue shape come from the shared model (app/catalogue-model.js). ONE definition — the UI and headless consumers (e.g. the EOQ harness) route through it.
var CAT_LEGS = CBCatalogue.LEGS;
var STD_SCHEMES = CBCatalogue.STD_SCHEMES;
var PRICE_BASIS = CBCatalogue.PRICE_BASIS;
var PRICE_BY = CBCatalogue.PRICE_BY;
function _viaFor(leg) {
  return CBCatalogue.viaFor(leg);
} // system → ERP/IoT · compute → AI/ERP

/* ---- draft state + per-entity persistence (localStorage only; nothing hits the server) ---- */
/* server persistence (b111): localStorage = instant/offline cache; server = cross-device truth.
   A persisted "dirty" flag (unpushed local edits) survives reloads, so a stale server copy never
   clobbers newer local work. Debounced push + a keepalive flush on tab-close/logout so nothing is lost. */
function _netDraftKey() {
  return 'cb_netdraft_' + (SESSION.entityId || SESSION.entity || 'anon');
}
function _netDirtyKey() {
  return 'cb_netdirty_' + (SESSION.entityId || SESSION.entity || 'anon');
}
function _netLoggedIn() {
  return typeof SESSION !== 'undefined' && !!SESSION.token;
}
function _netIsDirty() {
  try {
    return localStorage.getItem(_netDirtyKey()) === '1';
  } catch (e) {
    return false;
  }
}
function _netSetDirty(on) {
  try {
    if (on) localStorage.setItem(_netDirtyKey(), '1');
    else localStorage.removeItem(_netDirtyKey());
  } catch (e) { /* storage blocked or full: the page works without it */ }
}
function _netStripView(net) {
  try {
    var parsed = JSON.parse(JSON.stringify(net));
    delete parsed.sel;
    delete parsed.tab;
    delete parsed.openCap;
    delete parsed.catTab;
    delete parsed.collapsed;
    return parsed;
  } catch (e) {
    return net;
  }
} // don't sync transient view state across devices
var _netPushTimer = null;
function _netPushServer() {
  if (!_netLoggedIn() || !UI.net) return;
  try {
    api('netDesignPut', { body: { draft: _netStripView(UI.net) } })
      .then(function () {
        _netSetDirty(false);
      })
      .catch(function (err) {
        _netQueuePush(); // retry the latest state after an in-flight push / transient failure
        if (typeof toast === 'function' && !/Already working/.test((err && err.message) || '')) toast('Design saved on this device — not synced yet');
      });
  } catch (e) { /* best effort: failing here changes nothing the user sees */ }
}
function _netQueuePush() {
  if (!_netLoggedIn()) return;
  if (_netPushTimer) clearTimeout(_netPushTimer);
  _netPushTimer = setTimeout(_netPushServer, 1500);
}
function _netFlush() {
  // synchronous best-effort send on tab close / logout — keepalive lets it outlive the page
  if (!_netLoggedIn() || !UI.net || !_netIsDirty() || typeof CFG === 'undefined') return;
  try {
    fetch(CFG.API_BASE + '/api/network-design', {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SESSION.token },
      body: JSON.stringify({ draft: _netStripView(UI.net) })
    });
  } catch (e) { /* best effort: failing here changes nothing the user sees */ }
}
function _netPullServer() {
  if (!_netLoggedIn() || UI._netPulled || UI._netPulling) return;
  UI._netPulling = true; // guard concurrent pulls across re-renders (GET is not lock-guarded)
  try {
    api('netDesignGet')
      .then(function (reply) {
        UI._netPulling = false;
        UI._netPulled = true; // latch only on success — a failed pull retries next render
        if (_netIsDirty()) {
          _netPushServer();
          return;
        } // this device has unpushed edits → local wins; never overwrite with a stale server copy
        if (reply && reply.draft && reply.draft.nodes) {
          // server holds the shared design → adopt it
          UI.net = reply.draft;
          _netInit();
          try {
            localStorage.setItem(_netDraftKey(), JSON.stringify(UI.net));
          } catch (e) { /* storage blocked or full: the page works without it */ }
          if (typeof renderApp === 'function') renderApp();
        } else if (UI.net && UI.net.nodes) {
          // server empty but this device has a design → migrate it up once
          _netPushServer();
        }
      })
      .catch(function () {
        UI._netPulling = false;
      }); // leave _netPulled false → retried on next render
  } catch (e) {
    UI._netPulling = false;
  }
}
if (typeof window !== 'undefined' && !window._netFlushBound) {
  // bind the unload flush once
  window._netFlushBound = true;
  window.addEventListener('pagehide', _netFlush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') _netFlush();
  });
}
function _netSave() {
  try {
    if (UI.net) localStorage.setItem(_netDraftKey(), JSON.stringify(UI.net));
  } catch (e) { /* storage blocked or full: the page works without it */ }
  _netSetDirty(true);
  _netQueuePush();
}
function _netMark() {
  if (UI.net) UI.net.built = false;
  _netSave();
}
function _netLoad() {
  try {
    var s = localStorage.getItem(_netDraftKey());
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}
function _netInit() {
  if (UI.net === undefined || UI.net === null) UI.net = _netLoad() || null;
  if (UI.net && UI.net.nodes)
    UI.net.nodes.forEach(function (item) {
      // upgrade older drafts to the current model
      if (item.owned === undefined) item.owned = true;
      if (!item.holds) item.holds = [];
      if (item.note && item.purpose === undefined) {
        item.purpose = item.note;
        delete item.note;
      }
      if (item.holds.indexOf('catalogue') >= 0 && !item.catalogue) item.catalogue = { template: 'custom', fields: [] };
      if (item.holds.indexOf('storefront') >= 0) {
        _ensureOrder(item);
      } // NEVER default exposure to public — an unset choice is private, decided on the node
      if (item.holds.indexOf('coassist') >= 0) item.coassist = _normCoassist(item.coassist);
      if (item.holds.indexOf('transact') >= 0 && !item.transact) item.transact = { flow: 'both', copyOperator: true };
      if (item.holds.indexOf('tradeready') >= 0 && !item.tradeready) item.tradeready = { mode: 'inherit', certs: [] };
      if (item.holds.indexOf('dispute') >= 0 && !item.dispute) item.dispute = { informed: true };
    });
}
function _netKey() {
  return 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
}
function _netNode(key) {
  return ((UI.net && UI.net.nodes) || []).find(function (item) {
    return item.key === key;
  });
}
// netWhereAmI no longer draws anything — it resolves WHO THIS ENTITY IS in the network (operator · member ·
// standalone), which decides whether the design builder or the read-only member screen is shown.
function loadNetwork() {
  _netInit();
  netWhereAmI();
}

/**
 * netWhereAmI — the LIVE network this store actually belongs to, and where it sits.
 *
 * Athi, 2026-08-06: *"I am in dept-warehouse, and if this store is part of the network then the network
 * architecture should be visible and where they are should be informed in the value chain. Mark the store in
 * bold."*
 *
 * The Network screen renders the DESIGN draft — a thing you are sketching. It never showed the tree you are
 * actually on. So a warehouse whose whole reason for existing is that it sits under a departmental store had no
 * way to see that from inside the app; it only showed up in what a fellow department could read.
 *
 * ⚠️ The design draft and the live tree are DIFFERENT THINGS and this does not merge them. One is what you are
 * planning; the other is what is true right now. Showing a plan as if it were the live structure is how a person
 * ends up trusting a diagram nobody implemented.
 *
 * "Not on a network" is a normal answer, not an error — most entities are their own root.
 */
async function netWhereAmI() {
  var host = document.getElementById('netWhereAmI');
  if (!host) {
    var body = document.getElementById('netbody') || document.getElementById('mainbody');
    if (!body) return;
    host = document.createElement('div');
    host.id = 'netWhereAmI';
    host.style.marginBottom = '12px';
    body.insertBefore(host, body.firstChild);
  }
  /**
   * ⚠️ FETCH ONCE, RE-INSERT ALWAYS. Athi, 2026-08-08: *"the view is hiding and appearing again and again."*
   *
   * renderApp() rewrites #root, so this card is destroyed on every re-render and has to be put back — and it was
   * putting back "checking your place…" and then re-running the whole lookup each time. The design page
   * re-renders on every keystroke-ish action and on each plan refresh, so the card blanked and repopulated
   * continuously.
   *
   * The live structure does not change while you type. So it is fetched ONCE, the rendered card is cached, and
   * every subsequent render just re-inserts it — synchronously, with nothing to see. `UI._netPlaceHtml = null`
   * invalidates it, which is what a build does.
   */
  if (UI._netPlaceHtml !== undefined && UI._netPlaceHtml !== null) {
    host.innerHTML = UI._netPlaceHtml;
    return;
  }
  if (UI._netPlaceBusy) return; // in flight — leave whatever is there rather than blanking it
  UI._netPlaceBusy = true;
  /* ⚠️ A SPINNER, NOT 12px GREY PROSE. Athi: "it takes long time to bring the data, but processing message
     not appears". The message WAS there — one line of the faintest text on the screen, in the corner of a card,
     while the pane it belongs to sat unchanged for three seconds. A progress indicator nobody notices is the
     same as none, and "is it working?" is the question it exists to answer. */
  host.innerHTML =
    '<div class="loadwrap" style="display:flex;align-items:center;gap:9px;padding:14px 2px;' +
    'font-size:var(--fs-2);color:var(--on-card)"><span class="spin"></span>' +
    'Finding where you sit in the network…</div>';
  try {
    // The bridge id, self-healing. An empty one used to be answered with a confident "not part of a network",
    // which is the worst possible failure here: indistinguishable from the truth, and it hands a member of a
    // network the Design-your-network screen. If the session does not have it, ask /me once and cache it.
    if (!SESSION.bridgeId) {
      /* ⭐ meNow() — this already had its own ask-once gate (`if(!SESSION.bridgeId)`); now the answer can
         come from what the app already holds instead of a fourth private cache of /me. */
      try {
        var r0 = await meNow();
        var e0 = (r0 && (r0.entity || r0)) || {};
        if (e0.bridge_id) {
          SESSION.bridgeId = e0.bridge_id;
          if (typeof setSession === 'function') setSession({ bridgeId: e0.bridge_id });
        }
      } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    }
    if (!SESSION.bridgeId) {
      UI._netRole = null;
      UI._netPlaceBusy = false;
      host.innerHTML = '';
      return;
    } // unknown ≠ alone: say nothing
    /**
     * ⭐⭐ ONE CALL, NOT FOUR. This was: lookup(me) → subtree(me) → read the root out of the path → lookup(root)
     * → subtree(root). Every step needs the previous one's answer, so none of it could be parallelised here —
     * four full round trips before the screen has anything to show.
     *
     * ⚠️ MEASURED against production 2026-08-18: entities/me 3986ms · network-design 1578ms ·
     * network/entities/lookup 2373ms. At those latencies the chain is 6–10 SECONDS of an empty pane. The same
     * walk server-side is two cheap queries on one pool with no network in between — GET /network/place.
     *
     * ⚠️ THE OLD CHAIN IS KEPT AS A FALLBACK, deliberately: the API deploys separately from the web app, so for
     * the minutes between the two deploys /place does not exist yet. Without this the screen would break for
     * everyone during that window — and a 404 here is indistinguishable from "you are not in a network", which
     * is the one wrong answer this code has already been burned by.
     */
    var place = await api('netPlace', { query: { bridgeId: SESSION.bridgeId } }).catch(function () {
      return null;
    });
    var me, nodes;
    if (place && place.found) {
      me = place.entity;
      nodes = place.nodes || [];
    } else if (place && place.found === false) {
      UI._netRole = 'alone';
      UI._netPlaceBusy = false;
      UI._netPlaceHtml = '';
      host.innerHTML = '';
      return;
    } else {
      // /place not deployed yet (or it failed) — walk it the old way rather than claim the user is alone.
      var self = await api('netLookup', { query: { bridgeId: SESSION.bridgeId } }).catch(function () {
        return null;
      });
      me = self && (self.entity || self);
      if (!me || !me.id) {
        UI._netRole = 'alone';
        UI._netPlaceBusy = false;
        UI._netPlaceHtml = '';
        host.innerHTML = '';
        return;
      }
      var myTree = await api('netSubtree', { params: { id: me.id } }).catch(function () {
        return [];
      });
      myTree = Array.isArray(myTree) ? myTree : (myTree && myTree.nodes) || [];
      var myPath = (myTree[0] && myTree[0].path) || '';
      var rootLabel = myPath ? myPath.split('.')[0] : '';
      var rootBridge = rootLabel ? rootLabel.replace(/_/g, '-') : '';
      nodes = myTree;
      if (rootBridge && rootBridge !== String(me.bridgeId || me.bridge_id || '')) {
        var rootSelf = await api('netLookup', { query: { bridgeId: rootBridge } }).catch(function () {
          return null;
        });
        var rootId = rootSelf && (rootSelf.entity || rootSelf) && (rootSelf.entity || rootSelf).id;
        if (rootId) {
          var whole = await api('netSubtree', { params: { id: rootId } }).catch(function () {
            return null;
          });
          whole = Array.isArray(whole) ? whole : (whole && whole.nodes) || null;
          if (whole && whole.length) nodes = whole;
        }
      }
    }
    if (!me || !me.id) {
      UI._netRole = 'alone';
      UI._netPlaceBusy = false;
      UI._netPlaceHtml = '';
      host.innerHTML = '';
      return;
    }

    // WHO AM I IN THIS NETWORK? Athi, 2026-08-08: *"if we login with any of the store, it has to show the same
    // network, but can't create or update or modify the network."* The design belongs to the OPERATOR — the root
    // of the tree. A member sees the same network, read-only. Someone on no tree at all is simply standalone.
    var wasRole = UI._netRole;
    UI._netRole = rootBridge && rootBridge === String(me.bridgeId || me.bridge_id || '') ? 'operator' : nodes.length > 1 ? 'member' : 'alone';
    UI._netLive = { me: me, nodes: nodes, rootBridge: rootBridge };
    // A member's whole screen IS this tree, so the card would be the same thing twice. The operator keeps it —
    // there it earns its place by showing the LIVE structure beside the design, which are different things.
    UI._netPlaceBusy = false;
    /**
     * NO CARD ABOVE THE DESIGN. Athi, 2026-08-08: *"for the root I don't want the top panel at all — 'you are
     * here', that is not required. It is required only for the stores underneath."*
     *
     * The operator IS the top. Telling them where they sit answers a question they never had, and it took the eye
     * first, above the thing they came to work on. A MEMBER still sees the whole structure — but as its own
     * screen (_netMemberScreen), which shows purposes and places and is the better version of this anyway.
     *
     * The lookup still runs: it is what decides operator vs member vs standalone. Only the card is gone.
     */
    UI._netPlaceHtml = '';
    host.innerHTML = '';
    if (wasRole !== UI._netRole && typeof renderApp === 'function') renderApp(); // the panel below depends on it
  } catch (e) {
    UI._netRole = 'alone';
    UI._netPlaceBusy = false;
    UI._netPlaceHtml = '';
    host.innerHTML = '';
  }
}
function _netRerender() {
  // keep the detail pane's scroll position stable across re-render (no more jumping)
  var node = typeof document !== 'undefined' ? document.getElementById('netDetailPane') : null;
  var st = node ? node.scrollTop : 0;
  if (typeof renderApp === 'function') renderApp();
  var p2 = typeof document !== 'undefined' ? document.getElementById('netDetailPane') : null;
  if (p2) p2.scrollTop = st;
}

function netNewNetwork() {
  var ent = SESSION.entity || SESSION.name || 'My entity';
  promptAsk('Name this network', { label: 'What is it for?', value: ent + ' network', okLabel: 'Create' }, function (purpose) {
    var rootKey = _netKey();
    UI.net = {
      id: 'net-' + Date.now().toString(36),
      purpose: purpose,
      built: false,
      nodes: [{ key: rootKey, name: ent, parent_key: null, owned: true, root: true, holds: [], purpose: 'This entity — the top of the network.' }],
      sel: rootKey
    };
    _netSave();
    _netRerender();
  });
}
/* ⚠️ ONE ADD, TWO OWNERSHIPS. netAddChild and netAddPartner were the same twelve lines differing in a boolean
   and a sentence — a second call site is a helper, so this is it. What actually differs is the ONLY thing worth
   spelling out: whether you hold its key. */
function _netAddNode(parentKey, owned) {
  _netInit();
  if (!UI.net) return;
  var P = _netNode(parentKey);
  if (!P) return;
  promptAsk(
    owned ? 'New owned node' : 'New partner',
    {
      label: 'Name',
      placeholder: owned ? 'a branch, unit or depot you own' : 'an independent business joining you',
      okLabel: 'Add',
      hint:
        'Under <b>' +
        esc(P.name) +
        '</b>. ' +
        (owned
          ? 'You hold its key — it is part of your entity.'
          : 'You will <b>not</b> hold its key; it stays an independent business, and its catalogue shows here.')
    },
    function (name) {
      var n = {
        key: _netKey(),
        name: name,
        parent_key: parentKey,
        owned: !!owned,
        holds: ['catalogue'],
        purpose: '',
        catalogue: { template: 'custom', fields: [] }
      };
      UI.net.nodes.push(n);
      UI.net.sel = n.key;
      UI.net.tab = 'general';
      UI.net.built = false;
      _netSave();
      _netRerender();
    }
  );
}
function netAddChild(parentKey) {
  _netAddNode(parentKey, true);
}
function netAddPartner(parentKey) {
  _netAddNode(parentKey, false);
}
// Selecting a different store lands on GENERAL rather than wherever you happened to be — the tab that was open
// for the last store is rarely the one you want for this one, and arriving mid-subject hides who you are editing.
/* ⚠️ ON A PHONE, PICKING A NODE MUST BRING THE DETAIL FORWARD. The two panes are one screen at that width
   (.appwrap.m .panel.showdetail), so without this a tap selected a node and left you looking at the list it was
   selected in, with no indication anything had happened. Every other two-pane screen already does this — it came
   free with the layout this screen was not using. */
function netSelect(key) {
  _netInit();
  if (UI.net) {
    UI.net.sel = key;
    UI.net.tab = 'general';
  }
  if (UI.vp === 'mob') UI.mdetail = true;
  _netRerender();
}
function netRename(key) {
  var n = _netNode(key);
  if (!n) return;
  promptAsk('Rename node', { label: 'Name', value: n.name, okLabel: 'Rename' }, function (name) {
    n.name = name;
    _netMark();
    _netRerender();
  });
}
function netSetPurpose(key, val) {
  var n = _netNode(key);
  if (!n) return;
  n.purpose = val;
  _netSave();
} // no re-render while typing
function netSetPartnerRef(key, val) {
  var n = _netNode(key);
  if (!n) return;
  n.partner_ref = String(val || '').trim();
  _netSave();
}
/* A claim code lasts 7 days and is shown once. Without this, a store whose code lapsed — or whose owner lost the
   slip of paper — would be permanently unreachable, which is the review's §4 lesson in a new costume. */
function netReissueKey(userId) {
  api('netReissue', { body: { user_id: userId } })
    .then(function (reply) {
      var body =
        '<div style="padding:16px 20px;font-size:var(--fs-2);line-height:1.7">' +
        'New sign-in code for <b style="font-family:ui-monospace,Menlo,monospace">' +
        esc(reply.user_id) +
        '</b>:' +
        '<div style="margin:11px 0;font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-5);font-weight:700;letter-spacing:.1em;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:9px;padding:10px;color:var(--on-card)">' +
        esc(reply.claim_code) +
        '</div>' +
        '<div style="color:var(--grey);font-size:var(--fs-2)">Expires in 7 days. The previous code no longer works.</div>' +
        '<button data-cbsid="BUS004-B01" class="pri" onclick="netCopyKey(\'' +
        esc(reply.user_id) +
        "','" +
        esc(reply.claim_code) +
        '\')" style="margin-top:12px;width:100%;padding:9px">' +
        tx('Copy') +
        '</button></div>';
      if (typeof modal === 'function')
        modal('<div class="mhd"><div class="t">' + tx('🔑 New code') + '</div></div><div class="mbody" style="padding:0">' + body + '</div>', true);
    })
    .catch(function (e) {
      if (typeof toast === 'function') toast((e && e.message) || 'Could not issue a code', true);
    });
}
// Each capability is a clear YES / NO. Yes ⇒ the node holds it (and its detail opens). No ⇒ it doesn't. Sticky decision.
function netCapYes(key, capKey) {
  var n = _netNode(key);
  if (!n) return;
  n.holds = n.holds || [];
  if (n.holds.indexOf(capKey) < 0) {
    n.holds.push(capKey);
    if (capKey === 'catalogue' && !n.catalogue) n.catalogue = { template: 'custom', fields: [] };
    if (capKey === 'storefront') {
      _ensureOrder(n);
    } // ticking a capability must not publish a shop
    if (capKey === 'coassist' && !n.coassist) n.coassist = _defCoassist();
    if (capKey === 'transact' && !n.transact) n.transact = { flow: 'both', copyOperator: true };
    if (capKey === 'tradeready' && !n.tradeready) n.tradeready = { mode: 'inherit', certs: [] };
    if (capKey === 'dispute' && !n.dispute) n.dispute = { informed: true };
  }
  // Turning something on SELECTS its tab, so the page you just enabled is the one in front of you.
  UI.net.tab = capKey;
  // `collapsed` belonged to the accordion and nothing reads it now; cleared so an old draft stops carrying it.
  if (UI.net.collapsed) delete UI.net.collapsed[capKey];
  _netMark();
  _netRerender();
}
function netCapNo(key, capKey) {
  var n = _netNode(key);
  if (!n) return;
  n.holds = n.holds || [];
  var i = n.holds.indexOf(capKey);
  if (i >= 0) n.holds.splice(i, 1);
  // The tab STAYS selected — turning something off should not also move you somewhere else, or the screen
  // changing under you reads as though something worse happened than what you asked for.
  UI.net.tab = capKey;
  _netMark();
  _netRerender();
}
/* catalogue spec editing */
function _ensureCat(n) {
  if (!n.catalogue) n.catalogue = {};
  return CBCatalogue.ensure(n.catalogue);
} // shape + migration live in the shared model
function netSetCatLoad(key, v) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).loadedBy = v;
  _netMark();
  _netRerender();
}
/* catalogue purpose (the story that drives the gap analysis) + feed-back destinations */
function netSetCatStory(key, v) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).story = v;
  _netSave();
} // no re-render while typing
function netAddFeedback(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).feedback.push({ system: '', format: '', onRail: false });
  _netMark();
  _netRerender();
}
function netDelFeedback(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).feedback.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetFeedback(key, i, v) {
  var n = _netNode(key);
  if (!n) return;
  var fb = _ensureCat(n).feedback;
  if (i >= 0 && i < fb.length) {
    fb[i].system = v;
    _netMark();
  }
} // no re-render while typing
function netCatTab(key, tab) {
  if (UI.net) UI.net.catTab = tab;
  _netRerender();
} // which catalogue sub-panel is showing (few inputs at a time)
function netExportCat(key) {
  // export the node's catalogue draft as JSON — the harness (and later Build) reads this exact shape
  var n = _netNode(key);
  if (!n) return;
  var c = _ensureCat(n);
  var payload = { node: n.name, key: n.key, catalogue: c, order: (n.holds || []).indexOf('storefront') >= 0 ? _ensureOrder(n) : undefined };
  try {
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'catalogue-' + ((c.product || 'draft').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'draft') + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 100);
    if (typeof toast === 'function') toast('Draft exported');
  } catch (e) {
    if (typeof toast === 'function') toast('Export failed');
  }
}
/* catalogue Part B — known-as: the same item's local code/name in each system (a reference, never a mirror) */
function netAddRef(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).refs.push({ system: '', code: '' });
  _netMark();
  _netRerender();
}
function netDelRef(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).refs.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetRef(key, i, prop, v) {
  var n = _netNode(key);
  if (!n) return;
  var r = _ensureCat(n).refs;
  if (i >= 0 && i < r.length) {
    r[i][prop] = v;
    _netMark();
    if (prop === 'system') _netRerender();
  }
} // code via oninput: no re-render
/* G3 · BOM — related line items a reorder cascades to */
function netAddBom(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).bom.push({ item: '', qty: 1 });
  _netMark();
  _netRerender();
}
function netDelBom(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).bom.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetBom(key, i, prop, v) {
  var n = _netNode(key);
  if (!n) return;
  var b = _ensureCat(n).bom;
  if (i < 0 || i >= b.length) return;
  if (prop === 'qty') {
    var x = parseFloat(v);
    b[i].qty = v === '' || isNaN(x) || x < 0 ? 0 : x;
    _netMark();
  } else {
    b[i][prop] = v;
    _netMark();
  }
} // item via oninput: no re-render
/* G1 · loop — when a watched signal crosses a threshold, take an action */
function netAddTrigger(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).triggers.push({ watch: 'stock', op: 'below', value: '', action: 'reorder', target: '' });
  _netMark();
  _netRerender();
}
function netDelTrigger(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).triggers.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetTrigger(key, i, prop, v) {
  var n = _netNode(key);
  if (!n) return;
  var t = _ensureCat(n).triggers;
  if (i >= 0 && i < t.length) {
    t[i][prop] = v;
    _netMark();
    if (prop === 'op' || prop === 'action') _netRerender();
  }
} // text via oninput: no re-render
/* G4 · outbound adapter — the format + on/off-rail of each feed-back destination */
function netSetFeedbackFmt(key, i, prop, v) {
  var n = _netNode(key);
  if (!n) return;
  var fb = _ensureCat(n).feedback;
  if (i < 0 || i >= fb.length) return;
  if (prop === 'onRail') {
    fb[i].onRail = !fb[i].onRail;
    _netMark();
    _netRerender();
  } else {
    fb[i][prop] = v;
    _netMark();
  }
} // format via oninput: no re-render
/* Part C · standards — external classification, by reference (HS / GS1 / Schema.org) */
function netAddStd(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).standards.push({ scheme: 'HS', code: '', label: '' });
  _netMark();
  _netRerender();
}
function netDelStd(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).standards.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetStd(key, i, prop, v) {
  var n = _netNode(key);
  if (!n) return;
  var s = _ensureCat(n).standards;
  if (i >= 0 && i < s.length) {
    s[i][prop] = v;
    _netMark();
    if (prop === 'scheme') _netRerender();
  }
} // code/label via oninput: no re-render
/* Part D · pricing — governance context + priced entries (by ref / by value) */
function netSetContext(key, prop, v) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).context[prop] = v;
  _netSave();
} // currency/region text: no re-render while typing
function netAddPrice(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).pricing.push({ label: '', basis: 'global', by: 'ref', source: '', amount: null, currency: '', region: '', validFrom: '', validTo: '' });
  _netMark();
  _netRerender();
}
function netDelPrice(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).pricing.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetPrice(key, i, prop, v) {
  var n = _netNode(key);
  if (!n) return;
  var p = _ensureCat(n).pricing;
  if (i < 0 || i >= p.length) return;
  if (prop === 'amount') {
    var x = parseFloat(v);
    p[i].amount = v === '' || isNaN(x) ? null : x;
    _netMark();
  } else {
    p[i][prop] = v;
    _netMark();
    if (prop === 'basis' || prop === 'by') _netRerender();
  }
} // text via oninput: no re-render
/* catalogue Part A — identity + order (product · variants · base + alternative units) */
function netSetCatProduct(key, v) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).product = v;
  _netSave();
}
function netSetBaseUnit(key, v) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).baseUnit = v;
  _netSave();
}
function netAddVariant(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).variants.push({ name: '' });
  _netMark();
  _netRerender();
}
function netDelVariant(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).variants.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetVariant(key, i, v) {
  var n = _netNode(key);
  if (!n) return;
  var a = _ensureCat(n).variants;
  if (i >= 0 && i < a.length) {
    a[i].name = v;
    _netMark();
  }
}
function netAddAltUnit(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).altUnits.push({ unit: '', num: 1, den: 1 });
  _netMark();
  _netRerender();
}
function netDelAltUnit(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).altUnits.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetAltUnit(key, i, prop, v) {
  var n = _netNode(key);
  if (!n) return;
  var a = _ensureCat(n).altUnits;
  if (i < 0 || i >= a.length) return;
  if (prop === 'num' || prop === 'den') {
    var x = parseInt(v, 10);
    a[i][prop] = v === '' || isNaN(x) || x < 1 ? 1 : x;
    _netMark();
  } else {
    a[i][prop] = v;
    _netMark();
  }
}
// A 'system feed' / 'computed' leg is only real if the node carries the matching co-assist (ERP connector, IoT connection, or AI slot).
function _legBacked(n, f) {
  if (f.leg !== 'system' && f.leg !== 'compute') return true;
  if ((n.holds || []).indexOf('coassist') < 0) return false;
  var cc = _normCoassist(n.coassist);
  if (f.leg === 'compute') return f.via === 'ERP' ? cc.erp.connectors.length > 0 : cc.ai.count > 0;
  return f.via === 'IoT' ? (cc.iot.connections || []).length > 0 : cc.erp.connectors.length > 0;
}
/* order form (lives under Storefront): commercial method + max + collect-back + how the CHIT arrives */
function _ensureOrder(n) {
  if (!n.order) {
    var lc = n.catalogue || {};
    n.order = { method: lc.method || 'cart', maxItems: lc.maxItems != null ? lc.maxItems : null, collectBack: [], inlets: [] };
    if (lc.method !== undefined) delete lc.method;
    if (lc.maxItems !== undefined) delete lc.maxItems;
  }
  if (!n.order.collectBack) n.order.collectBack = [];
  if (!n.order.inlets) n.order.inlets = [];
  if (n.order.chitChannel) {
    if (['WhatsApp', 'email', 'scan'].indexOf(n.order.chitChannel) >= 0) n.order.inlets.push({ channel: n.order.chitChannel, handle: '' });
    delete n.order.chitChannel;
  }
  if (!n.order.method) n.order.method = 'cart';
  if (!n.order.attachments) n.order.attachments = [];
  if (!n.order.states) n.order.states = []; // G2 · lifecycle states the chit moves through
  if (n.order.notes === undefined) n.order.notes = '';
  return n.order;
}
/* G2 · state machine — the ordered lifecycle states a chit moves through (open→fulfilled→closed) */
function netAddState(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).states.push({ name: '' });
  _netMark();
  _netRerender();
}
function netDelState(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).states.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetState(key, i, v) {
  var n = _netNode(key);
  if (!n) return;
  var s = _ensureOrder(n).states;
  if (i >= 0 && i < s.length) {
    s[i].name = v;
    _netMark();
  }
} // via oninput: no re-render
function netMoveState(key, i, dir) {
  var n = _netNode(key);
  if (!n) return;
  var s = _ensureOrder(n).states;
  var j = i + dir;
  if (i < 0 || i >= s.length || j < 0 || j >= s.length) return;
  var t = s[i];
  s[i] = s[j];
  s[j] = t;
  _netMark();
  _netRerender();
}
function netSetOrderMethod(key, m) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).method = m;
  _netMark();
  _netRerender();
}
function netSetOrderMax(key, v) {
  var n = _netNode(key);
  if (!n) return;
  var num = parseInt(v, 10);
  _ensureOrder(n).maxItems = v === '' || isNaN(num) ? null : num;
  _netSave();
} // no re-render while typing
function netAddInlet(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).inlets.push({ channel: 'WhatsApp', handle: '' });
  _netMark();
  _netRerender();
}
function netDelInlet(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).inlets.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetInlet(key, i, prop, val) {
  var n = _netNode(key);
  if (!n) return;
  var il = _ensureOrder(n).inlets;
  if (i >= 0 && i < il.length) {
    il[i][prop] = val;
    _netMark();
    if (prop === 'channel') _netRerender();
  }
} // handle via oninput: no re-render
function netAddAttach(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).attachments.push({ name: '' });
  _netMark();
  _netRerender();
}
function netDelAttach(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).attachments.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetAttach(key, i, val) {
  var n = _netNode(key);
  if (!n) return;
  var a = _ensureOrder(n).attachments;
  if (i >= 0 && i < a.length) {
    a[i].name = val;
    _netMark();
  }
} // no re-render while typing
function netSetOrderNotes(key, val) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).notes = val;
  _netSave();
} // no re-render while typing
function netAddCollectBack(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).collectBack.push({ name: '', cadence: 'per order' });
  _netMark();
  _netRerender();
}
function netDelCollectBack(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ensureOrder(n).collectBack.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetCollectBack(key, i, prop, val) {
  var n = _netNode(key);
  if (!n) return;
  var cb = _ensureOrder(n).collectBack;
  if (i >= 0 && i < cb.length) {
    cb[i][prop] = val;
    _netMark();
    if (prop === 'cadence') _netRerender();
  }
} // name via oninput: no re-render
function netAddCatField(key) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).fields.push({ name: '', leg: 'cb', via: '', type: 'text' });
  _netMark();
  _netRerender();
} // default leg = the gap CB fills
function netDelCatField(key, i) {
  var n = _netNode(key);
  if (!n) return;
  var c = _ensureCat(n);
  c.fields.splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetCatField(key, i, prop, val) {
  var n = _netNode(key);
  if (!n) return;
  var c = _ensureCat(n);
  var f = c.fields[i];
  if (!f) return;
  f[prop] = val;
  if (prop === 'leg') f.via = val === 'system' || val === 'compute' ? _viaFor(val)[0] : '';
  _netMark();
  if (prop !== 'name') _netRerender();
} // name via oninput: no re-render
/* ── SHOW THE CHANGE ON THE MAP BEFORE MAKING IT ──────────────────────────────────────────────────────────────
   Athi, 2026-08-08: *"bring the store name in the toast and say these stores are moving from public to network by
   your confirmation and then perform… it is highly unlikely that people understand the difference between map
   changes and update behind the scene. Once you show the difference they assume it is changed. In fact show the
   entire map and highlight the change by striking public and network replacement text."*

   He is right, and the toast was the wrong shape twice over: it came AFTER the change, and it counted rather than
   named. Worse, a person who sees the map redraw assumes the live shops moved too — so the map and the shops must
   never diverge without being shown side by side and agreed to.

   So: compute the consequence without touching anything, draw the WHOLE tree with the affected rows striking the
   old value through, and only mutate on confirm.                                                              */

/** What would narrowing `startKey` to `val` do — to it and everything under it? Computed, never applied. */
function _netPlanNarrow(startKey, val) {
  var changes = [];
  var start = startKey ? _netNode(startKey) : null;
  if (start) {
    var sv = start.exposure || 'private';
    if (sv !== val) changes.push({ key: start.key, name: start.name, from: sv, to: val });
  }
  (function walk(parentKey, ceil) {
    (UI.net.nodes || [])
      .filter(function (x) {
        return x.parent_key === parentKey && !x.root && x.owned;
      })
      .forEach(function (item) {
        var cv = item.exposure || 'private';
        var next = NET_RANK[cv] > NET_RANK[ceil] ? ceil : cv;
        if (next !== cv) changes.push({ key: item.key, name: item.name, from: cv, to: next });
        walk(item.key, next);
      });
  })(startKey || (_netRootNode() || {}).key || null, val);
  return changes;
}
function _netRootNode() {
  return (
    (UI.net &&
      (UI.net.nodes || []).filter(function (item) {
        return item.root;
      })[0]) ||
    null
  );
}

/** The whole map, with the rows that move showing `Public → Network` and the old value struck through. */
function _netChangeMap(changes) {
  var byKey = {};
  changes.forEach(function (item) {
    byKey[item.key] = item;
  });
  var lab = function (k) {
    return (
      (
        NET_EXPOSURE.filter(function (item) {
          return item.k === k;
        })[0] || {}
      ).label || k
    ).replace(/^\S+\s/, '');
  };
  var rows = [];
  (function walk(parentKey, depth) {
    (UI.net.nodes || [])
      .filter(function (x) {
        return x.parent_key === parentKey;
      })
      .sort(_netByName)
      .forEach(function (item) {
        var ch = byKey[item.key];
        var chip = ch
          ? '<span style="font-size:var(--fs-1)"><s style="color:var(--disp-2)">' +
            esc(lab(ch.from)) +
            '</s>' +
            ' <b style="color:var(--ok-2)"><span class=arw>→</span> ' +
            esc(lab(ch.to)) +
            '</b></span>'
          : item.root || !item.owned
            ? ''
            : '<span style="font-size:var(--fs-1);color:var(--grey)">' + esc(lab(item.exposure || 'private')) + '</span>';
        rows.push(
          '<div style="display:flex;gap:9px;align-items:baseline;padding:5px 12px 5px ' +
            (12 + depth * 18) +
            'px;' +
            (ch ? 'background:var(--warn-tint);' : '') +
            ';color:var(--on-card)">' +
            '<span style="font-size:var(--fs-2);' +
            (ch ? 'font-weight:700' : '') +
            '">' +
            (depth ? '└ ' : '◆ ') +
            esc(item.name) +
            '</span>' +
            '<span style="margin-inline-start:auto">' +
            chip +
            '</span></div>'
        );
        walk(item.key, depth + 1);
      });
  })(null, 0);
  return '<div style="border:1px solid var(--line);border-radius:9px;overflow:hidden;background:var(--card);color:var(--on-card)">' + rows.join('') + '</div>';
}

/** Ask, showing the map. `apply` runs only if the person agrees. */
function _netConfirmNarrow(title, lead, changes, apply) {
  if (!changes.length) return apply();
  UI._netApply = apply;
  var names = changes.map(function (item) {
    return item.name;
  });
  var body =
    '<div style="padding:14px 16px;max-height:66vh;overflow:auto">' +
    '<div style="font-size:var(--fs-2);line-height:1.6;margin-bottom:11px">' +
    lead +
    '</div>' +
    '<div style="font-size:var(--fs-2);line-height:1.6;margin-bottom:11px"><b>' +
    names.length +
    ' store' +
    (names.length === 1 ? '' : 's') +
    '</b> will change: ' +
    esc(names.join(', ')) +
    '.</div>' +
    _netChangeMap(changes) +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:11px;line-height:1.55">This changes the <b>design</b>. ' +
    'Stores that are already live keep serving customers until you press <b>' +
    tx('Apply changes') +
    '</b>.</div>' +
    '<div style="display:flex;gap:9px;margin-top:14px">' +
    '<button data-cbsid="CMP003" onclick="netCancelNarrow()" style="flex:1;padding:9px">' +
    tx('Cancel') +
    '</button>' +
    '<button data-cbsid="BUS004-B02" class="pri" onclick="netRunNarrow()" style="flex:1;padding:9px">' +
    tx('Make these changes') +
    '</button>' +
    '</div></div>';
  if (typeof modal === 'function')
    modal('<div class="mhd"><div class="t">' + esc(title) + '</div></div><div class="mbody" style="padding:0">' + body + '</div>', true);
  else apply();
}
function netCancelNarrow() {
  UI._netApply = null;
  if (typeof closeModal === 'function') closeModal();
}
function netRunNarrow() {
  var f = UI._netApply;
  UI._netApply = null;
  if (typeof closeModal === 'function') closeModal();
  if (f) f();
}

function netSetExposure(key, val) {
  var n = _netNode(key);
  if (!n) return;
  var changes = _netPlanNarrow(key, val);
  var below = changes.filter(function (item) {
    return item.key !== key;
  });
  var apply = function () {
    changes.forEach(function (item) {
      var t = _netNode(item.key);
      if (t) t.exposure = item.to;
    });
    if (!changes.length) n.exposure = val;
    _netMark();
    _netRerender();
  };
  // Only ASK when something OTHER than the node you clicked is affected. Confirming your own click back to you is
  // noise, and noise is how a confirmation stops being read.
  if (!below.length) return apply();
  _netConfirmNarrow(
    'Closing "' + n.name + '" closes what is inside it',
    'A store can never be more open than the department containing it, so closing <b>' + esc(n.name) + '</b> closes the stores underneath.',
    changes,
    apply
  );
}
/* structure */
function _netDescendants(key, list) {
  list = list || [];
  (UI.net.nodes || []).forEach(function (item) {
    if (item.parent_key === key) {
      list.push(item.key);
      _netDescendants(item.key, list);
    }
  });
  return list;
}
function netDelete(key) {
  var n = _netNode(key);
  if (!n) return;
  if (!n.parent_key) {
    if (typeof toast === 'function') toast('The top node is your entity — it stays.');
    return;
  }
  var cnt = _netDescendants(key).length;
  var go = function () {
    var kill = _netDescendants(key);
    kill.push(key);
    UI.net.nodes = UI.net.nodes.filter(function (x) {
      return kill.indexOf(x.key) < 0;
    });
    if (kill.indexOf(UI.net.sel) >= 0) UI.net.sel = n.parent_key;
    _netMark();
    _netRerender();
  };
  // ⚠️ "nothing is lost" is only true for a node that was never built. Removing a LIVE store from the drawing does
  // not remove the store — it keeps trading, keeps its catalogue and keeps its login, and the design simply stops
  // tracking it. Saying otherwise would be the most expensive sentence on the page.
  var live = _netDescendants(key)
    .concat([key])
    .filter(function (item) {
      var x = _netNode(item);
      return x && x.built;
    }).length;
  var msg =
    'Remove <b>' +
    esc(n.name) +
    '</b>' +
    (cnt ? ' and its ' + cnt + ' sub-node' + (cnt === 1 ? '' : 's') : '') +
    ' from the design?<br><br>' +
    (live
      ? '<b>' +
        live +
        ' of these ' +
        (live === 1 ? 'is a live store' : 'are live stores') +
        '</b> — they keep trading and keep their logins. This design just stops tracking them, and rebuilding will not adopt them back.'
      : 'Nothing was created yet, so nothing is lost.');
  /* ⚠️ No `window.confirm` fallback. It was unreachable — confirmAsk lives in app.html and is loaded before any
     capability — and an unreachable fallback is just a browser dialog waiting for a refactor to expose it. */
  confirmAsk(live ? 'Remove from the design?' : 'Remove node', msg, 'Remove', go, true);
}

/* ── CHANGING YOUR MIND ───────────────────────────────────────────────────────────────────────────────────────
   Athi, 2026-08-08: *"how can they change their decision? Is there any way a cancel button or an X mark can be
   introduced to revert the decision?"*

   Everything in the pending list is a decision not yet acted on, so each one must be undoable in a click — and
   undoable WITHOUT knowing what it used to be, which is the part a person cannot be expected to remember. The
   server's plan carries `from`, so the revert target is known exactly rather than guessed. */
var NET_PLAT_TO_DESIGN = { public: 'public', network: 'protected', private: 'private' };

function netRevertOne(key) {
  var n = _netNode(key);
  if (!n) return;
  var pl = _netPlanFor(n);
  if (!pl) return;
  if (pl.kind === 'create') return netDelete(key); // never created → undo means take it off the drawing

  // A purpose-only edit reverts to the wording the store actually carries. Handled first so the visibility branch
  // below never has to cope with a `from` that isn't there.
  var raw =
    ((UI._netPlan || {}).update || []).filter(function (x) {
      return x.key === key;
    })[0] || {};
  if (raw.purpose && !raw.from) {
    n.purpose = raw.purpose.from || '';
    if (typeof toast === 'function') toast('"' + n.name + '" text left as it is on the store');
    _netMark();
    _netRerender();
    return;
  }
  if (raw.purpose) n.purpose = raw.purpose.from || ''; // both moved → put both back

  var back = NET_PLAT_TO_DESIGN[pl.from] || 'private';
  // A revert cannot break the cascade: if what it sits inside is closed, putting it back to public is not
  // available, and the honest answer is to say which node to revert instead of quietly doing something else.
  var ceil = _netCeilingFor(n);
  if (NET_RANK[back] > NET_RANK[ceil]) {
    var p = _netNode(n.parent_key);
    if (typeof toast === 'function')
      toast(
        '"' +
          n.name +
          '" cannot go back to ' +
          _netLab(back) +
          ' while ' +
          (p && !p.root ? '"' + p.name + '"' : 'the network') +
          ' is closed — revert that first.',
        true
      );
    return;
  }
  n.exposure = back;
  if (typeof toast === 'function') toast('"' + n.name + '" left as ' + _netLab(back));
  _netMark();
  _netRerender();
}

/** Put the whole drawing back to what the live network actually is. */
function netRevertAll() {
  var P = UI._netPlan || {};
  var creates = P.create || [],
    changes = P.update || [];
  if (!creates.length && !changes.length) return;
  var go = function () {
    var kill = [];
    creates.forEach(function (item) {
      kill.push(item.key);
      _netDescendants(item.key).forEach(function (entry) {
        kill.push(entry);
      });
    });
    if (kill.length) {
      UI.net.nodes = UI.net.nodes.filter(function (x) {
        return kill.indexOf(x.key) < 0;
      });
      if (kill.indexOf(UI.net.sel) >= 0) UI.net.sel = (_netRootNode() || {}).key || null;
    }
    changes.forEach(function (item) {
      var t = _netNode(item.key);
      if (!t) return;
      if (item.from) t.exposure = NET_PLAT_TO_DESIGN[item.from] || 'private';
      if (item.purpose) t.purpose = item.purpose.from || '';
    });
    _netMark();
    _netRerender();
  };
  var lines = creates
    .map(function (item) {
      return 'remove <b>' + esc(item.name) + '</b> (never created)';
    })
    .concat(
      changes.map(function (item) {
        return (
          '<b>' +
          esc(item.name) +
          '</b> back to ' +
          [item.from ? esc(_netPlatLab[item.from] || item.from) : '', item.purpose ? 'its current wording' : ''].filter(Boolean).join(' and ')
        );
      })
    );
  if (typeof confirmAsk === 'function')
    confirmAsk(
      'Discard the changes you have not applied?',
      'The design goes back to matching the live network:<br><br>' + lines.join('<br>') + '<br><br>No live store is touched — none of this has happened yet.',
      'Discard them',
      go,
      true
    );
  else go();
}
function netStartOver() {
  var go = function () {
    try {
      localStorage.removeItem(_netDraftKey());
    } catch (e) { /* storage blocked or full: the page works without it */ }
    UI.net = null;
    _netRerender();
  };
  var built =
    (UI.net &&
      (UI.net.nodes || []).filter(function (item) {
        return item.built;
      }).length) ||
    0;
  // ⚠️ Once stores exist, "start over" is no longer harmless. It mints fresh node keys, so the receipts the server
  // re-attaches BY KEY no longer match: the design forgets stores that are still live, and the next Build proposes
  // handles that are already taken. The stores themselves are untouched — which is precisely why this needs saying
  // out loud rather than a cheerful "nothing is lost there".
  if (built) {
    var msg =
      'This network has <b>' +
      built +
      ' live store' +
      (built === 1 ? '' : 's') +
      '</b>.<br><br>' +
      'Starting over discards the drawing only — <b>the stores keep existing</b>, keep their catalogues and keep ' +
      'their logins. But this design will no longer know about them, and rebuilding will not adopt them back.<br><br>' +
      'Use this only if you want to draw something unrelated.';
    if (typeof confirmAsk === 'function')
      return confirmAsk('Start over? ' + built + ' store' + (built === 1 ? '' : 's') + ' are live', msg, 'Discard the drawing', go, true);
    return go();
  }
  if (typeof confirmAsk === 'function')
    confirmAsk('Start over', 'Discard this design and start a new one? Nothing was created on the server, so nothing is lost there.', 'Start over', go, true);
  else go();
}
/* Build DRY-RUN — reads the design (via the shared model's deriveComputeJob) and shows the exact
   wiring plan against EXISTING capabilities. It CALLS NOTHING and mints NOTHING. The real mint is
   the gated next phase (human live-run). This is G7 (build contract) + the safe half of G8. */
function _buildPlanNode(n) {
  var owned = !n.root && n.owned,
    partner = !n.owned,
    holds = n.holds || [],
    lines = [],
    warns = [];
  if (n.root) lines.push('anchor: the top entity (you) — no new entity');
  else if (owned) {
    lines.push('register <b>entity</b> + issue a <b>login key</b> (co-assist pattern)');
    // Stated for EVERY store, not only ones with a storefront ticked — visibility is the decision the network is
    // being built to express, so it must be legible in the plan without opening anything.
    var vis =
      (
        NET_EXPOSURE.filter(function (x) {
          return x.k === (n.exposure || 'private');
        })[0] || {}
      ).label || '— Private';
    lines.push('catalogue visible to: <b>' + esc(vis) + '</b>');
  } else lines.push('send a <b>handshake</b> — independent business, <b>no key held</b>');
  if (holds.indexOf('catalogue') >= 0) {
    var c = _ensureCat(n),
      job = CBCatalogue.deriveComputeJob(c);
    lines.push('catalogue <b>' + esc(c.product || '(unnamed)') + '</b> · ' + (c.variants || []).length + ' variant(s) · base ' + esc(c.baseUnit || '—'));
    if (job.standards.length)
      lines.push(
        '· ' +
          job.standards.length +
          ' standard(s) <i>by reference</i> (' +
          job.standards
            .map(function (item) {
              return esc(item.scheme);
            })
            .join(', ') +
          ')'
      );
    if (job.pricing.length)
      lines.push(
        '· ' +
          job.pricing.length +
          ' price(s) in ' +
          esc([job.context.currency, job.context.region].filter(Boolean).join(' · ') || 'no context') +
          ' (' +
          job.pricing
            .map(function (item) {
              return item.by;
            })
            .join('/') +
          ')'
      );
    if (job.feeds.length) lines.push('· bind ' + job.feeds.length + ' <b>system-fed</b> field(s) to connector(s)');
    if (job.computed.length)
      lines.push('· ' + job.computed.length + ' <b>computed</b> field(s) <span class=arw>→</span> co-assist computes, <b>rail seals</b>');
    if (job.fromCustomer.length) lines.push('· ' + job.fromCustomer.length + ' customer-collected field(s)');
    if (job.stored.length) lines.push('· ' + job.stored.length + ' CB-stored field(s) <i>(the gap)</i>');
    if (job.bom.length) lines.push('· ' + job.bom.length + ' BOM component(s)');
    if (job.triggers.length) lines.push('· wire ' + job.triggers.length + ' <b>loop</b> trigger(s)');
    if (job.feedback.length)
      lines.push(
        '· ' +
          job.feedback.length +
          ' <b>feed-back adapter(s)</b>: ' +
          job.feedback
            .map(function (item) {
              return esc(item.system) + (item.onRail ? ' (chit)' : ' (' + esc(item.format || '?') + ')');
            })
            .join(', ')
      );
    (c.fields || []).forEach(function (item) {
      if ((item.leg === 'system' || item.leg === 'compute') && !_legBacked(n, item))
        warns.push(
          '“' +
            esc(item.name || '?') +
            '” needs ' +
            (item.leg === 'compute' ? esc(item.via) + ' (AI/ERP)' : 'a ' + esc(item.via) + ' connector') +
            " this node doesn't carry"
        );
    });
    CBCatalogue.validate(c).issues.forEach(function (item) {
      warns.push(esc(item));
    });
  }
  if (holds.indexOf('storefront') >= 0) {
    var o = _ensureOrder(n);
    lines.push(
      'storefront: ' +
        esc(n.exposure || 'private') +
        ' · order ' +
        esc(o.method || 'cart') +
        ((o.states || []).length ? ' · ' + o.states.length + ' lifecycle state(s)' : '')
    );
  }
  if (holds.indexOf('coassist') >= 0) {
    var cc = _normCoassist(n.coassist);
    var list = [];
    if (cc.human.count) list.push(cc.human.count + ' human');
    if ((cc.iot.connections || []).length) list.push((cc.iot.connections || []).length + ' IoT');
    if (cc.erp.connectors.length) list.push(cc.erp.connectors.length + ' ERP');
    if (cc.ai.count) list.push(cc.ai.count + ' AI slot');
    lines.push('co-assists: ' + (list.join(' · ') || 'none set'));
  }
  if (holds.indexOf('transact') >= 0) {
    var tr = n.transact || {};
    lines.push('transact: ' + esc(tr.flow || 'both') + (tr.copyOperator ? ' · copy operator (traceability + MIS)' : ''));
  }
  if (holds.indexOf('tradeready') >= 0) {
    var tt = n.tradeready || {};
    lines.push('trade-ready: ' + (tt.mode === 'own' ? (tt.certs || []).length + ' own cert(s)' : 'inherit network certs'));
  }
  if (holds.indexOf('dispute') >= 0) {
    lines.push('dispute: ' + ((n.dispute || {}).informed ? 'informed party (per-party scoping)' : 'not involved'));
  }
  return { node: n, owned: owned, partner: partner, lines: lines, warns: warns };
}
function netBuild() {
  _netInit();
  if (!UI.net) return;
  var nodes = UI.net.nodes || [];
  var plans = nodes.map(_buildPlanNode);
  var t = { owned: 0, partners: 0, cat: 0, co: 0, trig: 0, adapt: 0, std: 0, price: 0, warn: 0 };
  plans.forEach(function (item) {
    if (item.owned) t.owned++;
    if (item.partner) t.partners++;
    t.warn += item.warns.length;
  });
  nodes.forEach(function (item) {
    var h = item.holds || [];
    if (h.indexOf('catalogue') >= 0) {
      var job = CBCatalogue.deriveComputeJob(_ensureCat(item));
      t.cat++;
      t.trig += job.triggers.length;
      t.adapt += job.feedback.length;
      t.std += job.standards.length;
      t.price += job.pricing.length;
    }
    if (h.indexOf('coassist') >= 0) {
      var cc = _normCoassist(item.coassist);
      t.co += (cc.human.count ? 1 : 0) + cc.erp.connectors.length + (cc.iot.connections || []).length + (cc.ai.count ? 1 : 0);
    }
  });
  var chip = function (v, label) {
    return (
      '<span style="display:inline-block;font-size:var(--fs-1);background:var(--blue-tint-bg);border-radius:6px;padding:2px 8px;margin:2px 4px 2px 0;color:var(--on-card)"><b>' +
      v +
      '</b> ' +
      label +
      '</span>'
    );
  };
  var totals =
    '<div style="padding:12px 16px;border-bottom:1px solid var(--line)">' +
    chip(t.owned, 'entities + keys') +
    chip(t.partners, 'partner handshake' + (t.partners === 1 ? '' : 's')) +
    chip(t.cat, 'catalogue' + (t.cat === 1 ? '' : 's')) +
    chip(t.co, 'co-assists') +
    chip(t.std, 'standards') +
    chip(t.price, 'prices') +
    chip(t.trig, 'triggers') +
    chip(t.adapt, 'adapters') +
    (t.warn
      ? '<span style="display:inline-block;font-size:var(--fs-1);background:var(--danger-tint);color:var(--disp-2);border-radius:6px;padding:2px 8px;margin:2px 4px"><b>' +
        t.warn +
        '</b> ⚠ to resolve</span>'
      : '<span style="display:inline-block;font-size:var(--fs-1);color:var(--ok-2);padding:2px 8px">' + tx('✓ no blockers') + '</span>') +
    '</div>';
  var blocks = plans
    .filter(function (item) {
      return !item.node.root || item.lines.length > 1;
    })
    .map(function (item) {
      var n = item.node;
      // BUILT vs DESIGNED, said on every row. Athi: *"how do we differentiate between design and already built
      // network?"* Until now the plan read identically whether a node existed or not, which is the one thing a
      // person needs to know before pressing anything.
      var badge = n.root ? 'ANCHOR' : n.built ? 'BUILT' : item.owned ? 'TO CREATE' : 'PARTNER · invite';
      var bcol = n.root ? 'var(--blue-2)' : n.built ? 'var(--ok-2)' : item.owned ? 'var(--blue-2)' : 'var(--warn-2)';
      var hnd = _netHandleOf(n);
      var rows = item.lines
        .map(function (entry) {
          return (
            '<div style="font-size:var(--fs-2);color:var(--ink-2);line-height:1.55;padding:1px 0">' +
            (entry.indexOf('·') === 0
              ? '<span style="color:var(--grey);padding-inline-start:12px">' + entry + '</span>'
              : '<span class=arw>▸</span> ' + entry) +
            '</div>'
          );
        })
        .join('');
      var w = item.warns.length
        ? '<div style="margin-top:6px;padding:6px 9px;border:1px solid #e6c4bf;border-radius:6px;background:var(--danger-tint);font-size:var(--fs-1);color:var(--disp-2)">' +
          item.warns
            .map(function (x) {
              return '⚠ ' + x;
            })
            .join('<br>') +
          '</div>'
        : '';
      return (
        '<div style="padding:11px 16px;border-bottom:1px solid var(--line)">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px"><b style="font-size:var(--fs-2)">' +
        esc(n.name) +
        '</b><span style="font-size:var(--fs-1);font-weight:700;letter-spacing:.03em;color:' +
        bcol +
        ';border:1px solid ' +
        bcol +
        '55;border-radius:4px;padding:1px 5px">' +
        badge +
        '</span></div>' +
        (hnd
          ? '<div style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-1);color:var(--blue-2);margin-bottom:4px">' + esc(hnd) + '</div>'
          : '') +
        rows +
        w +
        '</div>'
      );
    })
    .join('');
  var gate =
    '<div style="padding:13px 16px">' +
    '<div style="padding:11px 13px;border:1px solid #b7a3d6;border-radius:9px;background:var(--purple-tint);font-size:var(--fs-2);color:var(--purple-2);line-height:1.6">🔒 <b>Nothing has been created yet.</b> This is the wiring plan for the capabilities each node holds. The next step names the actual stores and asks before creating anything.</div>' +
    '<button data-cbsid="BUS004-B03" class="pri" onclick="netMint()" style="margin-top:11px;width:100%;padding:10px;font-size:var(--fs-2)">🔨 Name the stores and create them <span class=arw>→</span></button>' +
    '</div>';
  var body = '<div style="max-height:66vh;overflow:auto">' + totals + blocks + gate + '</div>';
  if (typeof modal === 'function')
    modal(
      '<div class="mhd"><div class="t">' + tx('🔨 Build plan — nothing created yet') + '</div></div><div class="mbody" style="padding:0">' + body + '</div>',
      true
    );
  else if (typeof toast === 'function') toast('Build plan ready.');
}

/* ═══ THE MINT ═══════════════════════════════════════════════════════════════════════════════════════════════
   Two screens, deliberately. The server computes the plan (POST /build {dry_run:true}) and we SHOW IT — the
   exact handles, the exact visibility, and every node that will NOT be built and why — before anything is
   created. The confirm button then runs the same endpoint for real.

   The plan is never computed here. A preview drawn by different code from the thing it previews is a preview
   that can lie, and this one is showing a person the names their business will carry.                        */
function _mintRow(c) {
  var vis = { 'public': ['🌐 public', 'var(--ok-2)'], 'network': ['🔒 network only', 'var(--warn-2)'], 'private': ['— private', 'var(--blue-2)'] }[
    c.visibility
  ] || ['—', 'var(--blue-2)'];
  return (
    '<div style="display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid var(--line)">' +
    '<div style="flex:1;min-width:0"><b style="font-size:var(--fs-2)">' +
    esc(c.name) +
    '</b>' +
    '<div style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-2);color:var(--blue-2);margin-top:2px">' +
    esc(c.handle) +
    '</div></div>' +
    '<span style="font-size:var(--fs-1);color:' +
    vis[1] +
    '">' +
    vis[0] +
    '</span></div>'
  );
}
function netMint() {
  _netInit();
  if (!UI.net) return;
  // SAVE FIRST, AND WAIT. The server plans from the SAVED design, so the fire-and-forget flush used elsewhere
  // could plan against a draft one edit old — and the operator would be shown, approve, and then create the
  // wrong names. Autosave is a 1.5s debounce; a person clicks faster than that.
  api('netDesignPut', { body: { draft: _netStripView(UI.net) } })
    .then(function () {
      _netSetDirty(false);
      return api('netBuild', { body: { dry_run: true } });
    })
    .then(function (reply) {
      var create = reply.create || [],
        update = reply.update || [],
        invite = reply.invite || [],
        probs = (reply.problems || []).concat([]),
        notes = reply.notes || [];
      var body =
        '<div style="max-height:64vh;overflow:auto">' +
        '<div style="padding:12px 16px;border-bottom:1px solid var(--line);font-size:var(--fs-2);line-height:1.6">' +
        'Your network is named <b style="font-family:ui-monospace,Menlo,monospace">' +
        esc(reply.root) +
        '</b>' +
        (reply.root_claimed ? ' — <b>this will become your User ID</b>, and every store below is named from it.' : '. Every store below is named from it.') +
        '</div>' +
        (create.length
          ? '<div style="padding:9px 16px 4px;font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;color:var(--grey)">WILL BE CREATED — ' +
            create.length +
            '</div>' +
            create.map(_mintRow).join('')
          : '') +
        // Enhancing an existing network: a store already built whose visibility the design now disagrees with. Shown
        // as a from → to so nobody discovers after the fact that a live shop changed who can see it.
        (update.length
          ? '<div style="padding:9px 16px 4px;font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;color:var(--warn-2)">WILL BE CHANGED — ' +
            update.length +
            '</div>' +
            update
              .map(function (item) {
                return (
                  '<div style="padding:8px 16px;border-bottom:1px solid var(--line)">' +
                  '<b style="font-size:var(--fs-2)">' +
                  esc(item.name) +
                  '</b>' +
                  '<div style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-2);color:var(--blue-2);margin-top:2px">' +
                  esc(item.handle) +
                  '</div>' +
                  '<div style="font-size:var(--fs-2);color:var(--warn-2);margin-top:3px">who can see it: <b>' +
                  esc(item.from) +
                  '</b> <span class=arw>→</span> <b>' +
                  esc(item.to) +
                  '</b></div></div>'
                );
              })
              .join('')
          : '') +
        (invite.length
          ? '<div style="padding:9px 16px 4px;font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;color:var(--grey)">WILL BE INVITED — ' +
            invite.length +
            '</div>' +
            invite
              .map(function (item) {
                return (
                  '<div style="padding:8px 16px;border-bottom:1px solid var(--line);font-size:var(--fs-2)">🤝 <b>' +
                  esc(item.name) +
                  '</b> <span style="color:var(--grey)"><span class=arw>→</span> ' +
                  esc(item.ref) +
                  '</span><div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">A request they must accept. They are not added to your network by you.</div></div>'
                );
              })
              .join('')
          : '') +
        ((reply.skip || []).length
          ? '<div style="padding:9px 16px;font-size:var(--fs-1);color:var(--grey)">' + reply.skip.length + ' already built — untouched.</div>'
          : '') +
        (probs.length
          ? '<div style="padding:9px 16px 4px;font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;color:var(--disp-2)">NOT BUILT — ' +
            probs.length +
            '</div>' +
            probs
              .map(function (x) {
                return (
                  '<div style="padding:7px 16px;font-size:var(--fs-2);color:var(--disp-2);border-bottom:1px solid var(--line)"><b>' +
                  esc(x.name || '—') +
                  '</b> — ' +
                  esc(x.reason) +
                  '</div>'
                );
              })
              .join('')
          : '') +
        (notes.length
          ? notes
              .map(function (item) {
                return '<div style="padding:7px 16px;font-size:var(--fs-2);color:var(--warn-2)">⚠ ' + esc(item) + '</div>';
              })
              .join('')
          : '') +
        '<div style="padding:13px 16px">' +
        (create.length || update.length || invite.length
          ? (create.length
              ? '<div style="padding:10px 13px;border:1px solid #e0d3b0;border-radius:9px;background:var(--warn-tint);font-size:var(--fs-2);color:var(--warn-3);line-height:1.6">Each new store gets a <b>sign-in code shown once</b> on the next screen. Write them down or hand them over then — you can issue a fresh one later, but you cannot look this one up again.</div>'
              : '') +
            '<button data-cbsid="BUS004-B04" class="pri" onclick="netMintGo()" style="margin-top:11px;width:100%;padding:10px;font-size:var(--fs-2)">' +
            [
              create.length ? 'Create ' + create.length + ' store' + (create.length === 1 ? '' : 's') : '',
              update.length ? 'change ' + update.length : '',
              invite.length ? 'send ' + invite.length + ' invitation' + (invite.length === 1 ? '' : 's') : ''
            ]
              .filter(Boolean)
              .join(' · ') +
            '</button>' +
            '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px;line-height:1.5">Nothing is deleted or renamed. Removing a node from the drawing does not remove the store.</div>'
          : '<div style="font-size:var(--fs-2);color:var(--grey)">The network already matches this design. Add a node, or change a store\'s visibility.</div>') +
        '</div></div>';
      if (typeof modal === 'function')
        modal(
          '<div class="mhd"><div class="t">' + tx('🔨 Confirm — nothing created yet') + '</div></div><div class="mbody" style="padding:0">' + body + '</div>',
          true
        );
    })
    .catch(function (e) {
      // A 409 here is the useful case: the root handle is unusable or taken, and the message says which.
      if (typeof toast === 'function') toast((e && e.message) || 'Could not plan the build', true);
    });
}
function netMintGo() {
  if (typeof toast === 'function') toast('Creating…');
  api('netBuild', { body: {} })
    .then(function (reply) {
      // Take the receipts IMMEDIATELY, not when the person clicks Done. Between the build and that click, autosave
      // could push this page's copy — which has no `built` markers — and the next Build would treat existing stores
      // as new. The server now also refuses to drop them, but the client should not be sending stale state at all.
      api('netDesignGet')
        .then(function (response) {
          if (response && response.draft && response.draft.nodes) {
            UI.net = response.draft;
            _netSetDirty(false);
          }
          UI._netPlan = null;
          UI._netPlanSig = null; // the outstanding list is now stale by definition — re-ask
          UI._netPlaceHtml = null; // and so is the live tree above it
        })
        .catch(function () {
          UI._netPlan = null;
          UI._netPlanSig = null;
          UI._netPlaceHtml = null;
        });
      var created = reply.created || [],
        invited = reply.invited || [],
        updated = reply.updated || [],
        probs = reply.problems || [];
      var body =
        '<div style="max-height:64vh;overflow:auto">' +
        (created.length
          ? '<div style="padding:11px 16px;border-bottom:1px solid var(--line);font-size:var(--fs-2);line-height:1.6"><b>' +
            created.length +
            ' store' +
            (created.length === 1 ? '' : 's') +
            ' created.</b> Each signs in at the login page with the <b>handle</b> and the <b>code</b> below. Codes last 7 days.<br><span style="color:var(--disp-2)">This is the only time these codes are shown.</span></div>'
          : '') +
        created
          .map(function (item) {
            return (
              '<div style="padding:10px 16px;border-bottom:1px solid var(--line)">' +
              '<div style="font-size:var(--fs-2)"><b>' +
              esc(item.name) +
              '</b> <span style="font-size:var(--fs-1);color:var(--grey)">' +
              esc(item.user_id || item.bridge_id) +
              '</span></div>' +
              '<div style="display:flex;gap:14px;align-items:center;margin-top:5px;flex-wrap:wrap">' +
              '<span style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-2);color:var(--blue-2)">' +
              esc(item.handle) +
              '</span>' +
              '<span style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-3);font-weight:700;letter-spacing:.08em;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:2px 10px;color:var(--on-card)">' +
              esc(item.claim_code) +
              '</span>' +
              '<button data-cbsid="BUS004-B05" onclick="netCopyKey(\'' +
              esc(item.handle) +
              "','" +
              esc(item.claim_code) +
              '\')" style="padding:4px 10px;font-size:var(--fs-1)">' +
              tx('Copy') +
              '</button>' +
              '</div></div>'
            );
          })
          .join('') +
        (updated.length
          ? '<div style="padding:9px 16px 4px;font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;color:var(--warn-2)">CHANGED — ' +
            updated.length +
            '</div>' +
            updated
              .map(function (item) {
                return (
                  '<div style="padding:7px 16px;font-size:var(--fs-2);border-bottom:1px solid var(--line)">' +
                  esc(item.name) +
                  ' <span style="color:var(--grey)">' +
                  esc(item.from) +
                  ' <span class=arw>→</span> ' +
                  esc(item.to) +
                  '</span></div>'
                );
              })
              .join('')
          : '') +
        (invited.length
          ? '<div style="padding:9px 16px 4px;font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;color:var(--grey)">' +
            tx('INVITED — awaiting their acceptance') +
            '</div>' +
            invited
              .map(function (item) {
                return (
                  '<div style="padding:7px 16px;font-size:var(--fs-2);border-bottom:1px solid var(--line)">🤝 ' +
                  esc(item.name) +
                  ' <span style="color:var(--grey)">' +
                  esc(item.handle || '') +
                  ' · ' +
                  esc(item.status || '') +
                  '</span></div>'
                );
              })
              .join('')
          : '') +
        (probs.length
          ? probs
              .map(function (x) {
                return (
                  '<div style="padding:7px 16px;font-size:var(--fs-2);color:var(--disp-2)"><b>' + esc(x.name || '—') + '</b> — ' + esc(x.reason) + '</div>'
                );
              })
              .join('')
          : '') +
        '<div style="padding:13px 16px"><button data-cbsid="BUS004-B06" class="pri" onclick="netMintDone()" style="width:100%;padding:10px;font-size:var(--fs-2)">' +
        tx('I have the codes — done') +
        '</button></div>' +
        '</div>';
      if (typeof modal === 'function')
        modal(
          '<div class="mhd"><div class="t">✅ ' + esc(reply.message || 'Built') + '</div></div><div class="mbody" style="padding:0">' + body + '</div>',
          true
        );
    })
    .catch(function (e) {
      if (typeof toast === 'function') toast((e && e.message) || 'Build failed', true);
    });
}
function netCopyKey(handle, code) {
  var txt = 'Sign in at ChitBridge\nUser ID: ' + handle + '\nCode: ' + code;
  if (navigator.clipboard)
    navigator.clipboard.writeText(txt).then(function () {
      if (typeof toast === 'function') toast('Copied');
    });
}
function netMintDone() {
  // Re-read the design from the server: the build wrote `built` onto each node, and that is what makes a second
  // Build a no-op. Reading it back is also the only honest confirmation that the write landed.
  if (typeof closeModal === 'function') closeModal();
  api('netDesignGet')
    .then(function (reply) {
      if (reply && reply.draft && reply.draft.nodes) {
        UI.net = reply.draft;
        _netRerender();
      }
    })
    .catch(function () {});
}

/* ---- render (two panes, same style) ---- */
function _capDots(n) {
  return (n.holds || [])
    .map(function (item) {
      var c = _capMeta(item);
      return c ? c.icon : '';
    })
    .join('');
}
/**
 * ONE ORDER, EVERYWHERE.
 *
 * Athi, 2026-08-08: *"one is from the network and another from the child — why are the store alignments different?
 * It has to be identical… the already stored entities should retain the placement so it looks the same for
 * anyone."*
 *
 * Right, and NEITHER order meant anything. The operator's tree listed nodes in the order they were added to the
 * drawing; the member's tree came back `ORDER BY path`, and a path label is the BRIDGE ID — so the live view was
 * sorted by a random string and would reshuffle for every network.
 *
 * Name is the only key both sides genuinely share: the design has no bridge ids until Build, and the live tree has
 * no design keys at all. So siblings sort by name, case-insensitively, everywhere the network is drawn.
 *
 * ⚠️ The trade: this is NOT "the order you added them", and there is no hand-arranged order yet. If one is wanted,
 * it needs a stored position on the entity — the order has to live somewhere both readers can see, which is
 * exactly the thing that was missing here.
 */
function _netByName(a, b) {
  // b118 — a deliberate ARRANGEMENT wins, and name is the tiebreak. An un-arranged store has no position at all
  // (not zero), so it sorts after the arranged ones and a network nobody has touched keeps the order it has.
  var pa = _netPos(a),
    pb = _netPos(b);
  if (pa !== pb) return pa - pb;
  var x = String((a && a.name) || '').toLowerCase(),
    y = String((b && b.name) || '').toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
/** A node's position, from the DESIGN (`pos`) or from the live store (`sort_order`). Absent → last. */
function _netPos(n) {
  var v = n && (n.pos !== undefined && n.pos !== null ? n.pos : n.sort_order);
  return v === undefined || v === null || v === '' ? Number.MAX_SAFE_INTEGER : Number(v);
}

/**
 * Move a store up or down among its siblings.
 *
 * Athi, 2026-08-08: *"yes, add the stored position so we can arrange the order."*
 *
 * The first move on a branch NUMBERS it — every sibling gets the position it currently displays at, and only then
 * does the swap happen. Numbering on demand rather than at creation is what lets an existing network keep its
 * current order until somebody actually decides to change it.
 */
function netMove(key, dir) {
  var n = _netNode(key);
  if (!n) return;
  var sibs = (UI.net.nodes || [])
    .filter(function (x) {
      return x.parent_key === n.parent_key && !x.root;
    })
    .sort(_netByName);
  sibs.forEach(function (item, index) {
    item.pos = index;
  }); // freeze what is on screen, then move within it
  var i = sibs.findIndex(function (item) {
    return item.key === key;
  });
  var j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return; // already at the end — nothing to do, and no false toast
  var t = sibs[i].pos;
  sibs[i].pos = sibs[j].pos;
  sibs[j].pos = t;
  _netMark();
  _netRerender();
}

/**
 * Currency and country in the tree — on the ROOT always, on a store only when it DIFFERS.
 *
 * The network's own line is the reference everything else is read against, so it always shows. A store repeating
 * the same two values adds a line of noise per store and hides the one that matters; a store that trades in
 * another currency is genuinely worth spotting from across the tree.
 */
function _netGlobalChip(n) {
  var netCur = String((typeof SESSION !== 'undefined' && SESSION.currency) || '').toUpperCase();
  var netCty = String((typeof SESSION !== 'undefined' && SESSION.country) || '').toUpperCase();
  if (n.root) {
    if (!netCur && !netCty) return '';
    return (
      '<div style="font-size:var(--fs-1);color:var(--grey-3);margin:2px 0 0 13px">' +
      esc([netCur, netCty].filter(Boolean).join(' · ')) +
      ' <span style="opacity:.8">— the network\'s</span></div>'
    );
  }
  var p = n.place || {};
  var cur = String(p.currency || '').toUpperCase(),
    cty = String(p.country || '').toUpperCase();
  var out = [];
  if (cur && cur !== netCur) out.push(cur);
  if (cty && cty !== netCty) out.push(cty);
  if (!out.length) return '';
  return '<div style="font-size:var(--fs-1);font-weight:700;color:var(--warn-2);margin:2px 0 0 13px">🌍 ' + esc(out.join(' · ')) + '</div>';
}

function _netTree(parentKey, depth) {
  var kids = (UI.net.nodes || [])
    .filter(function (item) {
      return item.parent_key === (parentKey || null);
    })
    .sort(_netByName);
  return kids
    .map(function (item) {
      var sel = UI.net.sel === item.key;
      var dots = _capDots(item);
      return (
        '<div data-cbsid="BUS004-C01" onclick="netSelect(\'' +
        item.key +
        '\')" style="cursor:pointer;padding:7px 9px;padding-inline-start:' +
        (9 + depth * 16) +
        'px;border-radius:9px;font-size:var(--fs-2);' +
        (sel ? 'background:var(--blue-tint-bg);color:var(--blue-2);font-weight:700' : 'color:var(--ink-2)') +
        '">' +
        (item.parent_key ? '└ ' : '◆ ') +
        esc(item.name) +
        (item.owned ? '' : ' <span title="partner">🤝</span>') +
        // The visibility flag, in the tree. It is the decision this whole page exists to make, so it must be
        // readable across the WHOLE network at a glance — not one node at a time. Re-rendered by netSetExposure,
        // so changing it on the right updates here immediately.
        (item.root || !item.owned ? '' : _netVisChip(item)) +
        (dots ? '<span style="font-size:var(--fs-1);margin-inline-start:5px;opacity:.9">' + dots + '</span>' : '') +
        // WHAT THIS STORE IS FOR, under its name. Athi, 2026-08-08: *"if we can bring the purpose of the store as a
        // comment or readable text under each store, that makes the network tree more meaningful."* The purpose was
        // captured on the first day and then only ever shown on the node you happened to have selected — so the
        // tree read as a list of names, and a name does not tell you why a branch exists. One line, clamped, with
        // the full text on hover: it must add meaning without turning the tree into a document.
        (item.purpose
          ? '<div title="' +
            esc(item.purpose) +
            '" style="font-size:var(--fs-1);color:var(--grey-3);line-height:1.4;' +
            'margin:2px 0 0 13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
            esc(item.purpose) +
            '</div>'
          : '') +
        // ⚠️ SHOW THE EXCEPTION, NOT THE RULE. Athi, 2026-08-08: *"if the currency changes, then we can bring it in
        // the left menu — otherwise only the top node shows the currency and country."* Repeating "INR · IN" on every
        // store says nothing and buries the one store that is different. So it appears only where it DIFFERS.
        _netGlobalChip(item) +
        '</div>' +
        _netTree(item.key, depth + 1)
      );
    })
    .join('');
}
/** The Network panel has two jobs: DESIGN the network, and ASK it a question. One strip, at the very top. */
function _netModeStrip() {
  var m = UI._netMode || 'design';
  var tab = function (k, icon, label) {
    var on = m === k;
    return (
      '<span data-cbsid="BUS004-C02" onclick="netMode(\'' +
      k +
      '\')" style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;' +
      'padding:8px 13px;border-radius:9px;font-size:var(--fs-2);font-weight:' +
      (on ? '700' : '500') +
      ';' +
      'background:' +
      (on ? 'var(--blue)' : 'transparent') +
      ';color:' +
      (on ? 'var(--on-accent)' : 'var(--ink-2)') +
      ';' +
      'border:1px solid ' +
      (on ? 'var(--blue)' : 'var(--line)') +
      '">' +
      '<span style="width:16px;text-align:center;font-size:var(--fs-3)">' +
      icon +
      '</span>' +
      label +
      '</span>'
    );
  };
  return (
    '<div style="display:flex;gap:6px;padding:12px 22px 0;flex-wrap:wrap">' +
    tab('design', '🔗', 'The network') +
    tab('find', '🔎', 'Where is it?') +
    tab('browse', '🗂️', 'Store catalogues') +
    '</div>'
  );
}
function netMode(m) {
  UI._netMode = m;
  _netRerender();
}

function networkScreen() {
  _netInit();
  _netPullServer(); // b111 — once per session, adopt the entity's server-saved design (cross-device)
  /**
   * "Where is it?" is available to EVERYONE on a network, operator and member alike — a store asking who has a
   * part is the commonest question in a chain, and it is not an owner's privilege. The answer is already bounded
   * by the catalogue's own visibility rule, so a member sees exactly what it is entitled to see and no more.
   */
  if (UI._netRole === 'member' || UI._netRole === 'operator') {
    if (UI._netMode === 'find') return _netModeStrip() + _netAvailScreen();
    if (UI._netMode === 'browse') return _netModeStrip() + _netBrowseScreen();
  }
  // A member of someone else's network never gets the builder — not disabled, absent. See _netMemberScreen.
  if (UI._netRole === 'member') return _netModeStrip() + _netMemberScreen();
  // ⚠️ While the role is UNKNOWN, offer nothing. Painting "Design your network" first and correcting it a moment
  // later is how a store that IS in a network gets invited to draw a second one — which is exactly what happened.
  if (UI._netRole === undefined || UI._netRole === null) {
    return '<div style="padding:44px 22px;color:var(--grey);font-size:var(--fs-2)">' + tx('Checking your place in the network…') + '</div>';
  }
  if (!UI.net) {
    var ent = SESSION.entity || SESSION.name || 'your entity';
    return (
      '<div style="padding:44px 22px;max-width:580px"><div style="font-size:var(--fs-5);font-weight:800">' +
      tx('🔗 Design your network') +
      '</div>' +
      '<div style="font-size:var(--fs-2);color:var(--grey);margin:8px 0 8px;line-height:1.6">Draw your structure first — <b>' +
      esc(ent) +
      '</b> is the top node. Add <b>owned</b> nodes (branches, units, depots) beneath it, or bring in a <b>partner</b> business. For each: a purpose, and tick <b>what it holds</b> (catalogue, storefront…) to fill in its spec. This is a <b>design</b>: it saves here and survives closing the app. <b>' +
      tx('Nothing is created') +
      '</b> until you choose to Build.</div>' +
      '<button data-cbsid="BUS004-B07" class="pri" onclick="netNewNetwork()" style="padding:10px 16px;margin-top:10px">＋ Start designing</button></div>'
    );
  }
  var sel = UI.net.sel ? _netNode(UI.net.sel) : null;
  var right = sel
    ? _netNodeView(sel)
    : '<div style="padding:24px;color:var(--grey);font-size:var(--fs-2)">Select a node to edit it, or add a child under it.</div>';
  /**
   * ⚠️⚠️ THE APP'S TWO-PANE LAYOUT, NOT A SECOND ONE (Athi, 2026-08-17: *"the network screen is not following
   * the two sided panel principle so the middle screen is not adjustable and the right hand side looks
   * clumsy"*).
   *
   * This screen had hand-rolled its own columns: a left pane pinned at a hardcoded `width:300px`, a plain
   * flex child on the right, and nothing between them. Everything the standard `.panel` carries was therefore
   * missing — the drag handle, the remembered `--lw` width, the `calc(100% - 300px)` cap that stops the list
   * eating the detail, and `.appwrap.m .panel.showdetail` which is how the two panes become one screen on a
   * PHONE. That last one is the reason this matters beyond taste: on a phone the network screen was showing a
   * 300px column and whatever was left, instead of one pane at a time.
   *
   * ⚠️ Same class of bug as the chip stylesheet and the phantom modal classes: the shared thing existed, was
   * not used, and the copy silently lacked everything the original had accumulated.
   */
  var showDetail = !!(UI.mdetail && sel);
  var list = '<div class="list" id="netLeftPane" style="overflow:auto;padding:12px 8px">' + _netLeftPane() + '</div>';
  var divider =
    '<div class="divider" id="divider" onmousedown="startDrag(event)" ontouchstart="startDrag(event)"' +
    ' role="separator" aria-label="Resize panes"><span class="grip"></span></div>';
  var detail = '<div class="detail" id="netDetailPane" style="overflow:auto">' + right + '</div>';
  return (
    '<div style="display:flex;flex-direction:column;height:100%;min-height:0">' +
    _netModeStrip() +
    '<div class="panel' +
    (showDetail ? ' showdetail' : '') +
    '" id="panel"' +
    ' style="--lw:' +
    (UI.lw || 340) +
    'px;--lh:' +
    (UI.lh || 260) +
    'px">' +
    list +
    divider +
    detail +
    '</div></div>'
  );
}

/**
 * The left column, on its own, so the plan refresh can repaint JUST THIS.
 *
 * Athi, 2026-08-08: *"I don't want the flickering to happen, I couldn't concentrate on what I am thinking."*
 *
 * The outstanding-work list comes back from the server a moment after every edit, and the only way to show it used
 * to be `_netRerender()` — which rebuilds the entire application shell, flashing the whole page each time. Nothing
 * outside this column depends on the plan, so nothing outside it should be redrawn.
 */
function _netLeftPane() {
  if (!UI.net) return '';
  var tree = _netTree(null, 0) || '<div style="color:var(--grey);font-size:var(--fs-2);padding:8px 6px">No nodes yet.</div>';
  var count = (UI.net.nodes || []).length - 1;
  var built = (UI.net.nodes || []).filter(function (item) {
    return item.built;
  }).length;
  _netRefreshPlan(); // ask the server what is outstanding (debounced by design signature)
  var P = UI._netPlan || {};
  var toCreate = P.create || [],
    toChange = P.update || [],
    probs = P.problems || [];
  var pendingCount = toCreate.length + toChange.length;
  /* The outstanding work, as LINE ITEMS. Athi: *"show the newly created store under the apply changes as a line
     item, yet to be created."* A number tells you something is outstanding; a list tells you what. */
  var pendingList = pendingCount
    ? '<div style="margin:8px 8px 0;border:1px solid #e0d3b0;border-radius:9px;background:var(--warn-tint);overflow:hidden;color:var(--on-card)">' +
      // Each row carries its own ✕ — a decision that cannot be taken back in one click is a decision people avoid
      // making at all. The revert target comes from the plan's `from`, so nobody has to remember what it used to be.
      toCreate
        .map(function (item) {
          return (
            '<div style="display:flex;gap:6px;align-items:flex-start;padding:6px 9px;font-size:var(--fs-1);border-bottom:1px solid #efe4cc">' +
            '<div style="flex:1;min-width:0"><b style="color:var(--blue-2)">NEW</b> ' +
            esc(item.name) +
            '<div style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-1);color:var(--grey)">' +
            esc(item.handle) +
            ' · ' +
            esc(_netPlatLab[item.visibility] || item.visibility) +
            '</div></div>' +
            '<span data-cbsid="BUS004-C03" onclick="netRevertOne(\'' +
            item.key +
            '\')" title="Remove it — it was never created" style="cursor:pointer;color:var(--grey-3);font-weight:700;padding:0 3px">✕</span></div>'
          );
        })
        .join('') +
      toChange
        .map(function (item) {
          return (
            '<div style="display:flex;gap:6px;align-items:flex-start;padding:6px 9px;font-size:var(--fs-1);border-bottom:1px solid #efe4cc">' +
            '<div style="flex:1;min-width:0"><b style="color:var(--warn-2)">' +
            tx('CHANGE') +
            '</b> ' +
            esc(item.name) +
            (item.from
              ? '<div style="font-size:var(--fs-1);color:var(--grey)"><s>' +
                esc(_netPlatLab[item.from] || item.from) +
                '</s> <span class=arw>→</span> <b>' +
                esc(_netPlatLab[item.to] || item.to) +
                '</b></div>'
              : '') +
            (item.purpose
              ? '<div style="font-size:var(--fs-1);color:var(--grey)">text: <s>' +
                esc(item.purpose.from || '(none)') +
                '</s> <span class=arw>→</span> <b>' +
                esc(item.purpose.to || '(none)') +
                '</b></div>'
              : '') +
            (item.order ? '<div style="font-size:var(--fs-1);color:var(--grey)">moved in the order</div>' : '') +
            (item.place
              ? '<div style="font-size:var(--fs-1);color:var(--grey)">place updated' +
                (item.place.to && item.place.to.city ? ' · ' + esc(item.place.to.city) : '') +
                '</div>'
              : '') +
            '</div>' +
            '<span data-cbsid="BUS004-C04" onclick="netRevertOne(\'' +
            item.key +
            '\')" title="Leave it as ' +
            esc(_netPlatLab[item.from] || item.from) +
            '" style="cursor:pointer;color:var(--grey-3);font-weight:700;padding:0 3px">✕</span></div>'
          );
        })
        .join('') +
      '<div style="display:flex;gap:8px;align-items:center;padding:6px 9px;font-size:var(--fs-1);color:var(--warn-2)">' +
      '<span style="flex:1">Nothing above has happened yet.</span>' +
      '<span data-cbsid="BUS004-C05" onclick="netRevertAll()" style="cursor:pointer;color:var(--blue);font-weight:600">' +
      tx('↺ Discard all') +
      '</span></div></div>'
    : '';
  var problemList = probs.length
    ? '<div style="margin:8px 8px 0;font-size:var(--fs-1);color:var(--disp-2);line-height:1.5">' +
      probs
        .map(function (x) {
          return '⚠ ' + esc(x.name || '') + ' — ' + esc(x.reason);
        })
        .join('<br>') +
      '</div>'
    : '';
  return (
    '' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--grey);letter-spacing:.05em;padding:2px 8px 3px">' +
    esc(UI.net.purpose || 'NETWORK') +
    '</div>' +
    // Once stores exist it is no longer a design — it is the network, and calling it a draft understates what
    // pressing Build actually did. Athi, 2026-08-08: *"after creation it should say your network."*
    '<div style="font-size:var(--fs-1);color:' +
    (built ? 'var(--ok-2)' : 'var(--blue-2)') +
    ';padding:0 8px 10px">' +
    (built ? '✓ your network · ' + built + ' store' + (built === 1 ? '' : 's') + ' live' : 'design · saved for this network · nothing created yet') +
    '</div>' +
    tree +
    '<div style="border-top:1px solid var(--line);margin-top:12px;padding-top:10px">' +
    '<button data-cbsid="BUS004-B08" class="pri" onclick="netBuild()" style="width:calc(100% - 16px);margin:0 8px;padding:9px">' +
    (built ? '🔨 Apply changes' + (pendingCount ? ' (' + pendingCount + ')' : '') : '🔨 Build network' + (count ? ' (' + count + ')' : '')) +
    '</button>' +
    pendingList +
    problemList +
    (pendingCount
      ? ''
      : '<div style="font-size:var(--fs-1);color:var(--grey);padding:8px 8px 2px">' +
        (built
          ? '✓ the live network matches this design'
          : count
            ? count + ' node' + (count === 1 ? '' : 's') + ' designed · nothing created yet'
            : 'add nodes, then build') +
        '</div>') +
    '<div data-cbsid="BUS004-C06" style="font-size:var(--fs-1);color:var(--blue);padding:6px 8px;cursor:pointer" onclick="netStartOver()">' +
    tx('↺ Start over') +
    '</div>' +
    '</div>'
  );
}
function _capSummary(n, k) {
  if (k === 'place') {
    var pl = n.place || {};
    return (
      (pl.city || pl.address || 'no address') + (pl.lat != null && pl.lng != null ? ' · locatable' : ' · not locatable') + (pl.km ? ' · ' + pl.km + ' km' : '')
    );
  }
  if (NET_SOON[k]) {
    var sv = (n.soon && n.soon[k]) || {};
    var got = Object.keys(sv).filter(function (x) {
      return String(sv[x] || '').trim();
    }).length;
    return got ? got + ' noted · not enforced' : 'nothing noted yet';
  }
  if (k === 'catalogue') {
    var c = n.catalogue || {};
    var nf = (c.fields || []).length;
    return nf + ' field' + (nf === 1 ? '' : 's') + ' · ' + (c.loadedBy || 'manual');
  }
  if (k === 'storefront') {
    var o = n.order || {};
    var ml =
      (
        CAT_METHODS.filter(function (x) {
          return x.k === (o.method || 'cart');
        })[0] || {}
      ).label || '';
    return (n.exposure || 'private') + ' · ' + ml;
  }
  if (k === 'coassist') {
    var cc = _normCoassist(n.coassist);
    var list = [];
    if (cc.human.count) list.push(cc.human.count + ' human');
    var iotDev = (cc.iot.connections || []).reduce(function (total, x) {
      return total + (parseInt(x.devices, 10) || 0);
    }, 0);
    if (iotDev || (cc.iot.connections || []).length) list.push(iotDev + ' IoT');
    if (cc.erp.connectors.length) list.push(cc.erp.connectors.length + ' ERP');
    if (cc.ai.count) list.push(cc.ai.count + ' AI');
    return list.length ? list.join(' · ') : 'none set';
  }
  if (k === 'transact') {
    var t = n.transact || {};
    var f = t.flow || 'both';
    var base = f === 'both' ? 'sends & receives' : f === 'send' ? 'sends only' : 'receives only';
    return base + (t.copyOperator !== false ? ' · HQ copied' : '');
  }
  if (k === 'tradeready') {
    var tr = n.tradeready || {};
    return tr.mode === 'own' ? 'own · ' + (tr.certs || []).length + ' cert' + ((tr.certs || []).length === 1 ? '' : 's') : "network's certs";
  }
  if (k === 'dispute') return (n.dispute || {}).informed !== false ? 'informed' : 'not involved';
  return 'set up next';
}
function _catFieldRow(n, f, i) {
  var legOpts = CAT_LEGS.map(function (item) {
    return '<option value="' + item.k + '"' + (f.leg === item.k ? ' selected' : '') + '>' + item.short + '</option>';
  }).join('');
  var typOpts = CAT_TYPES.map(function (item) {
    return '<option value="' + item + '"' + (f.type === item ? ' selected' : '') + '>' + item + '</option>';
  }).join('');
  var viaSel = '';
  if (f.leg === 'system' || f.leg === 'compute') {
    var viaList = _viaFor(f.leg);
    var viaOpts = viaList
      .map(function (item) {
        return '<option value="' + item + '"' + ((f.via || viaList[0]) === item ? ' selected' : '') + '>' + item + '</option>';
      })
      .join('');
    var ok = _legBacked(n, f);
    viaSel =
      '<select data-cbsid="BUS004-S01" onchange="netSetCatField(\'' +
      n.key +
      "'," +
      i +
      ',\'via\',this.value)" title="' +
      (ok ? 'co-assist present' : 'no matching co-assist on this node') +
      '" style="font-size:var(--fs-1);padding:4px;border:1px solid ' +
      (ok ? 'var(--line)' : 'var(--disp)') +
      ';border-radius:6px;background:' +
      (ok ? 'var(--card)' : 'var(--danger-tint)') +
      ';color:' +
      (ok ? 'var(--on-card)' : 'var(--on-card)') +
      '">' +
      viaOpts +
      '</select>';
  }
  var col = (
    CAT_LEGS.filter(function (item) {
      return item.k === f.leg;
    })[0] || {}
  ).col || ['var(--blue-2)', 'var(--blue-tint-bg)'];
  return (
    '<div style="display:flex;gap:6px;align-items:center;padding:3px 0;border-inline-start:3px solid ' +
    col[0] +
    ';padding-inline-start:7px">' +
    '<input data-cbsid="BUS004-I01" value="' +
    esc(f.name || '') +
    '" oninput="netSetCatField(\'' +
    n.key +
    "'," +
    i +
    ',\'name\',this.value)" placeholder="what you need to know" style="flex:1;min-width:0;font-size:var(--fs-2);padding:5px 7px;border:1px solid var(--line);border-radius:6px">' +
    '<select data-cbsid="BUS004-S02" onchange="netSetCatField(\'' +
    n.key +
    "'," +
    i +
    ',\'leg\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
    legOpts +
    '</select>' +
    viaSel +
    '<select data-cbsid="BUS004-S03" onchange="netSetCatField(\'' +
    n.key +
    "'," +
    i +
    ',\'type\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
    typOpts +
    '</select>' +
    '<span data-cbsid="BUS004-C07" onclick="netDelCatField(\'' +
    n.key +
    "'," +
    i +
    ')" title="remove" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 4px">×</span>' +
    '</div>'
  );
}
/**
 * ── HOW A STORE PRICES WHAT IT ADOPTED ────────────────────────────────────────────────────────────────────────
 * Athi, 2026-08-08: *"root is Euro and under it each store is another currency. The stores inherit the product,
 * but the money should be updated with local currency… we can give the option at catalogue level: conversion to
 * your currency, or you decide the price. Just place the option now."*
 *
 * So the option is placed, and nothing more. What it settles is the split that matters:
 *
 *     THE PRODUCT   held BY REFERENCE — name, spec, pictures, video stay the network's, and a correction at the
 *                   top reaches every store without anyone confirming anything, because nobody overrode it.
 *     THE PRICE     always the store's own, stamped in its own currency and never converted afterwards.
 *
 * Conversion is therefore a CALCULATOR that proposes a number a person accepts — not a live formula the platform
 * re-evaluates. A live formula means every price in the network moves whenever a rate moves and nobody agreed to
 * any of them.
 *
 * ⚠️ CAPTURED, NOT ENFORCED. Nothing reads this yet. The rate source, how often it is re-read, and who confirms a
 * new proposal are the maintenance question, and they are deliberately unanswered.
 */
var CAT_PRICE_SRC = [
  {
    k: 'convert',
    label: 'Convert from the network',
    hint: 'A rate and the local add-ons propose a price; the store confirms it. Right where the reference price is the real price.'
  },
  {
    k: 'own',
    label: 'This store decides the price',
    hint: "The network's price is shown for context only. Right where local cost, duty and competition set the number."
  }
];
function netSetPriceSrc(key, v) {
  var n = _netNode(key);
  if (!n) return;
  _ensureCat(n).priceSrc = v;
  _netMark();
  _netRerender();
}
function _adoptedPricing(n, c) {
  var cur = (n.place && n.place.currency) || (typeof SESSION !== 'undefined' && SESSION.currency) || "the network's";
  var v = c.priceSrc || 'own';
  return (
    '<div style="margin:10px 0 14px;padding:11px 13px;border:1px solid var(--line);border-inline-start:3px solid var(--blue-2);border-radius:9px;background:var(--blue-tint-bg);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em">HOW THIS STORE PRICES WHAT IT ADOPTED' +
    ' <span style="background:var(--blue-tint-bg);color:var(--blue);border-radius:5px;padding:1px 6px;margin-inline-start:5px">' +
    tx('CAPTURED, NOT ENFORCED') +
    '</span></div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px;line-height:1.5">The <b>product</b> stays the ' +
    "network's — a corrected picture or spec reaches every store. Only the <b>price</b> is ever this store's, " +
    'stamped in <b>' +
    esc(cur) +
    '</b> and never converted afterwards.</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">' +
    CAT_PRICE_SRC.map(function (item) {
      var on = v === item.k;
      return (
        '<div data-cbsid="BUS004-C08" onclick="netSetPriceSrc(\'' +
        n.key +
        "','" +
        item.k +
        '\')" style="cursor:pointer;flex:1;min-width:210px;' +
        'padding:10px 12px;border:1px solid ' +
        (on ? 'var(--blue-2)' : 'var(--line)') +
        ';border-radius:9px;background:' +
        (on ? 'var(--blue-tint-bg)' : 'var(--card)') +
        ';color:' +
        (on ? 'var(--on-card)' : 'var(--on-card)') +
        '">' +
        '<b style="font-size:var(--fs-2);color:' +
        (on ? 'var(--blue-2)' : 'var(--blue-2)') +
        '">' +
        (on ? '● ' : '○ ') +
        esc(item.label) +
        '</b>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px;line-height:1.5">' +
        item.hint +
        '</div></div>'
      );
    }).join('') +
    '</div>' +
    // The rollover. This part is NOT speculation — adoption by reference and hiding unpriced adopted lines from a
    // price-showing shop are both live behaviour today, and the second was a real defect once.
    '<div style="margin-top:11px;border-top:1px dashed var(--line);padding-top:9px;font-size:var(--fs-1);line-height:1.7;color:var(--grey)">' +
    '<b style="color:var(--ink-2)">When the network changes the catalogue</b><br>' +
    '· a new item appears here, because the catalogue is held by reference<br>' +
    '· on <b>' +
    tx('Convert') +
    '</b> it arrives with a proposed price · on <b>' +
    tx('Decide') +
    '</b> it arrives <b style="color:var(--disp-2)">unpriced</b>, ' +
    'and an unpriced adopted item stays out of a shop that shows prices — that is live behaviour, not a plan<br>' +
    '· a corrected picture, video or spec reaches every store immediately; nobody confirms it, because nobody had overridden it' +
    '</div></div>'
  );
}

function _catConfig(n) {
  var c = _ensureCat(n);
  var fields =
    (c.fields || [])
      .map(function (item, index) {
        return _catFieldRow(n, item, index);
      })
      .join('') ||
    '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">No requirements yet — add what this catalogue must know, then route each to a leg.</div>';
  var loadOpts = CAT_LOADS.map(function (item) {
    return '<option value="' + item + '"' + ((c.loadedBy || 'manual') === item ? ' selected' : '') + '>' + item + '</option>';
  }).join('');
  var unbacked = (c.fields || []).filter(function (item) {
    return (item.leg === 'system' || item.leg === 'compute') && !_legBacked(n, item);
  });
  var legNote = unbacked.length
    ? '<div style="font-size:var(--fs-1);color:var(--disp-2);margin-top:6px;border-top:1px dotted var(--line);padding-top:5px">⚠ ' +
      unbacked.length +
      ' field' +
      (unbacked.length > 1 ? 's' : '') +
      " needing a co-assist that this node doesn't carry — add the ERP / IoT / AI co-assist, or route " +
      (unbacked.length > 1 ? 'them' : 'it') +
      ' to another leg.</div>'
    : '';
  var legLegend = CAT_LEGS.map(function (item) {
    return (
      '<span style="font-size:var(--fs-1);color:' +
      item.col[0] +
      ';background:' +
      item.col[1] +
      ';border-radius:4px;padding:1px 6px;margin-inline-end:4px">' +
      item.short +
      '</span>'
    );
  }).join('');
  var _in = 'font-size:var(--fs-1);padding:5px 7px;border:1px solid var(--line);border-radius:6px';
  var variantRows = (c.variants || [])
    .map(function (item, index) {
      return (
        '<div style="display:flex;gap:6px;align-items:center;padding:2px 0"><input data-cbsid="BUS004-I02" value="' +
        esc(item.name || '') +
        '" oninput="netSetVariant(\'' +
        n.key +
        "'," +
        index +
        ',this.value)" placeholder="variant (e.g. Sunlit Ivory · Matte · 4L)" style="flex:1;min-width:0;' +
        _in +
        '"><span data-cbsid="BUS004-C09" onclick="netDelVariant(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
      );
    })
    .join('');
  var altRows = (c.altUnits || [])
    .map(function (item, index) {
      return (
        '<div style="display:flex;gap:4px;align-items:center;padding:2px 0"><input data-cbsid="BUS004-I03" value="' +
        esc(item.unit || '') +
        '" oninput="netSetAltUnit(\'' +
        n.key +
        "'," +
        index +
        ',\'unit\',this.value)" placeholder="unit" style="width:66px;' +
        _in +
        '"><span style="font-size:var(--fs-1);color:var(--grey)">1=</span><input data-cbsid="BUS004-I04" type="number" min="1" value="' +
        (item.num || 1) +
        '" oninput="netSetAltUnit(\'' +
        n.key +
        "'," +
        index +
        ',\'num\',this.value)" style="width:48px;' +
        _in +
        '"><span style="font-size:var(--fs-1);color:var(--grey)">/</span><input data-cbsid="BUS004-I05" type="number" min="1" value="' +
        (item.den || 1) +
        '" oninput="netSetAltUnit(\'' +
        n.key +
        "'," +
        index +
        ',\'den\',this.value)" style="width:48px;' +
        _in +
        '"><span style="font-size:var(--fs-1);color:var(--grey)">' +
        esc(c.baseUnit || 'base') +
        '</span><span data-cbsid="BUS004-C10" onclick="netDelAltUnit(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
      );
    })
    .join('');
  var partA =
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em;margin-top:12px;border-top:1px solid var(--line);padding-top:9px">' +
    tx('A · IDENTITY + ORDER') +
    '</div>' +
    '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:8px">' +
    tx('Product (browse name)') +
    '</label>' +
    '<input data-cbsid="BUS004-I06" value="' +
    esc(c.product || '') +
    '" oninput="netSetCatProduct(\'' +
    n.key +
    '\',this.value)" placeholder="product / family name" style="width:100%;margin-top:4px;box-sizing:border-box;' +
    _in +
    '">' +
    '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:9px">Variants <span style="color:var(--faint,var(--grey-3))">(the orderable unit — the chit freezes the variant; none = product is its own)</span></label>' +
    variantRows +
    '<div data-cbsid="BUS004-C11" onclick="netAddVariant(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600;padding:4px 0">＋ variant</div>' +
    '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:6px">Base unit <span style="color:var(--faint,var(--grey-3))">(lowest indivisible — kg, litre)</span></label>' +
    '<input data-cbsid="BUS004-I07" value="' +
    esc(c.baseUnit || '') +
    '" oninput="netSetBaseUnit(\'' +
    n.key +
    '\',this.value)" placeholder="e.g. kg" style="width:120px;margin-top:4px;' +
    _in +
    '">' +
    '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:9px">Alternative units <span style="color:var(--faint,var(--grey-3))">(integer conversion — 1 crate = 20/1 kg)</span></label>' +
    altRows +
    '<div data-cbsid="BUS004-C12" onclick="netAddAltUnit(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600;padding:4px 0">＋ unit</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);font-style:italic;margin-top:2px">Orderable unit is resolved by the buyer\'s tier; unit + factor freeze on the chit.</div>';
  var refRows = (c.refs || [])
    .map(function (item, index) {
      return (
        '<div style="display:flex;gap:6px;align-items:center;padding:2px 0"><input data-cbsid="BUS004-I08" value="' +
        esc(item.system || '') +
        '" oninput="netSetRef(\'' +
        n.key +
        "'," +
        index +
        ',\'system\',this.value)" placeholder="system (ERP, Tally, Supplier A)" style="width:150px;' +
        _in +
        '"><input data-cbsid="BUS004-I09" value="' +
        esc(item.code || '') +
        '" oninput="netSetRef(\'' +
        n.key +
        "'," +
        index +
        ',\'code\',this.value)" placeholder="their code / local name" style="flex:1;min-width:0;' +
        _in +
        '"><span data-cbsid="BUS004-C13" onclick="netDelRef(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
      );
    })
    .join('');
  var partB =
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em;margin-top:14px;border-top:1px solid var(--line);padding-top:9px">B · KNOWN AS <span style="font-weight:500;color:var(--faint,var(--grey-3));letter-spacing:0">(the same item — its name in each system)</span></div>' +
    refRows +
    '<div data-cbsid="BUS004-C14" onclick="netAddRef(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600;padding:4px 0">＋ system name</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);font-style:italic;margin-top:2px">CB stores the reference {system · their code}, not their data — so it can gather from, and order in, each system\'s own name.</div>';
  var bomRows = (c.bom || [])
    .map(function (b, index) {
      return (
        '<div style="display:flex;gap:6px;align-items:center;padding:2px 0"><input data-cbsid="BUS004-I10" value="' +
        esc(b.item || '') +
        '" oninput="netSetBom(\'' +
        n.key +
        "'," +
        index +
        ',\'item\',this.value)" placeholder="component / related item" style="flex:1;min-width:0;' +
        _in +
        '"><span style="font-size:var(--fs-1);color:var(--grey)">×</span><input data-cbsid="BUS004-I11" type="number" min="0" step="any" value="' +
        (b.qty != null ? b.qty : 1) +
        '" oninput="netSetBom(\'' +
        n.key +
        "'," +
        index +
        ',\'qty\',this.value)" style="width:64px;' +
        _in +
        '"><span style="font-size:var(--fs-1);color:var(--grey)">' +
        esc(c.baseUnit || 'unit') +
        '</span><span data-cbsid="BUS004-C15" onclick="netDelBom(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
      );
    })
    .join('');
  var partBOM =
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em;margin-top:14px;border-top:1px solid var(--line);padding-top:9px">MADE OF <span style="font-weight:500;color:var(--faint,var(--grey-3));letter-spacing:0">(related line items — a reorder cascades to these)</span></div>' +
    bomRows +
    '<div data-cbsid="BUS004-C16" onclick="netAddBom(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600;padding:4px 0">＋ component</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);font-style:italic;margin-top:2px">Ordering the parent proposes its components (a BOM), not a full MRP explosion.</div>';
  // Part C · standards (by reference)
  var stdRows = (c.standards || [])
    .map(function (item, index) {
      var scOpts = STD_SCHEMES.map(function (x) {
        return '<option' + (item.scheme === x ? ' selected' : '') + '>' + x + '</option>';
      }).join('');
      return (
        '<div style="display:flex;gap:6px;align-items:center;padding:2px 0"><select data-cbsid="BUS004-S04" onchange="netSetStd(\'' +
        n.key +
        "'," +
        index +
        ',\'scheme\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
        scOpts +
        '</select><input data-cbsid="BUS004-I12" value="' +
        esc(item.code || '') +
        '" oninput="netSetStd(\'' +
        n.key +
        "'," +
        index +
        ',\'code\',this.value)" placeholder="code (e.g. 8544.49)" style="width:120px;' +
        _in +
        '"><input data-cbsid="BUS004-I13" value="' +
        esc(item.label || '') +
        '" oninput="netSetStd(\'' +
        n.key +
        "'," +
        index +
        ',\'label\',this.value)" placeholder="what it classifies (optional)" style="flex:1;min-width:0;' +
        _in +
        '"><span data-cbsid="BUS004-C17" onclick="netDelStd(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
      );
    })
    .join('');
  var partStd =
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em;margin-top:14px;border-top:1px solid var(--line);padding-top:9px">C · STANDARDS <span style="font-weight:500;color:var(--faint,var(--grey-3));letter-spacing:0">(classification — by reference, never mirrored)</span></div>' +
    stdRows +
    '<div data-cbsid="BUS004-C18" onclick="netAddStd(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600;padding:4px 0">＋ standard</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);font-style:italic;margin-top:2px">HS / GS1 / Schema.org codes point OUT to the authority; CB holds the reference, not the scheme.</div>';
  // Part D · pricing (governance context + by ref / by value)
  var ctx = c.context || { currency: '', region: '' };
  var priceRows =
    (c.pricing || [])
      .map(function (item, index) {
        var basisOpts = PRICE_BASIS.map(function (b) {
          return '<option' + (item.basis === b ? ' selected' : '') + '>' + b + '</option>';
        }).join('');
        var byOpts = PRICE_BY.map(function (b) {
          return '<option value="' + b + '"' + (item.by === b ? ' selected' : '') + '>by ' + b + '</option>';
        }).join('');
        var valField =
          item.by === 'value'
            ? '<input data-cbsid="BUS004-I14" type="number" step="any" value="' +
              (item.amount != null ? item.amount : '') +
              '" oninput="netSetPrice(\'' +
              n.key +
              "'," +
              index +
              ',\'amount\',this.value)" placeholder="amount" style="width:88px;' +
              _in +
              '"><input data-cbsid="BUS004-I15" value="' +
              esc(item.currency || '') +
              '" oninput="netSetPrice(\'' +
              n.key +
              "'," +
              index +
              ',\'currency\',this.value)" placeholder="' +
              esc(ctx.currency || 'ccy') +
              '" style="width:56px;' +
              _in +
              '">'
            : '<input data-cbsid="BUS004-I16" value="' +
              esc(item.source || '') +
              '" oninput="netSetPrice(\'' +
              n.key +
              "'," +
              index +
              ',\'source\',this.value)" placeholder="source ref (LBMA fix · SAP ZPR0 · buyer offer)" style="flex:1;min-width:0;' +
              _in +
              '">';
        return (
          '<div style="border:1px solid var(--line);border-radius:9px;padding:7px 9px;margin-top:6px">' +
          '<div style="display:flex;gap:6px;align-items:center"><input data-cbsid="BUS004-I17" value="' +
          esc(item.label || '') +
          '" oninput="netSetPrice(\'' +
          n.key +
          "'," +
          index +
          ',\'label\',this.value)" placeholder="price label (list · trade · spot)" style="flex:1;min-width:0;' +
          _in +
          '"><span data-cbsid="BUS004-C19" onclick="netDelPrice(\'' +
          n.key +
          "'," +
          index +
          ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>' +
          '<div style="display:flex;gap:6px;align-items:center;margin-top:5px"><select data-cbsid="BUS004-S05" onchange="netSetPrice(\'' +
          n.key +
          "'," +
          index +
          ',\'basis\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
          basisOpts +
          '</select><select data-cbsid="BUS004-S06" onchange="netSetPrice(\'' +
          n.key +
          "'," +
          index +
          ',\'by\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
          byOpts +
          '</select>' +
          valField +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center;margin-top:5px;font-size:var(--fs-1);color:var(--grey)">valid <input data-cbsid="BUS004-I18" type="date" value="' +
          esc(item.validFrom || '') +
          '" onchange="netSetPrice(\'' +
          n.key +
          "'," +
          index +
          ',\'validFrom\',this.value)" style="' +
          _in +
          '"><span class=arw>→</span><input data-cbsid="BUS004-I19" type="date" value="' +
          esc(item.validTo || '') +
          '" onchange="netSetPrice(\'' +
          n.key +
          "'," +
          index +
          ',\'validTo\',this.value)" style="' +
          _in +
          '"> · region <input data-cbsid="BUS004-I20" value="' +
          esc(item.region || '') +
          '" oninput="netSetPrice(\'' +
          n.key +
          "'," +
          index +
          ',\'region\',this.value)" placeholder="' +
          esc(ctx.region || 'inherit') +
          '" style="width:78px;' +
          _in +
          '"><span style="margin-inline-start:auto;font-size:var(--fs-1);font-weight:600;color:' +
          (item.by === 'value' ? 'var(--ok-2)' : 'var(--purple-2)') +
          '">' +
          (item.by === 'value' ? 'frozen' : 'loose · resolves at seal') +
          '</span></div>' +
          '</div>'
        );
      })
      .join('') || '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">No prices — information-only catalogue.</div>';
  var partPricing =
    '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:10px"><b style="font-weight:800;color:var(--blue-2);letter-spacing:.05em">' +
    tx('D · PRICING') +
    '</b> <span style="color:var(--faint,var(--grey-3))">— governed by context; by ref (loose) or by value (frozen)</span></label>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;padding:6px 9px;border:1px dashed var(--line);border-radius:9px;background:var(--blue-tint-bg);color:var(--on-card)"><span style="font-size:var(--fs-1);color:var(--grey)">Context governs <span class=arw>→</span></span><input data-cbsid="BUS004-I21" value="' +
    esc(ctx.currency || '') +
    '" oninput="netSetContext(\'' +
    n.key +
    '\',\'currency\',this.value)" placeholder="currency (INR)" style="width:108px;' +
    _in +
    '"><input data-cbsid="BUS004-I22" value="' +
    esc(ctx.region || '') +
    '" oninput="netSetContext(\'' +
    n.key +
    '\',\'region\',this.value)" placeholder="region (IN)" style="width:108px;' +
    _in +
    '"></div>' +
    priceRows +
    '<div data-cbsid="BUS004-C20" onclick="netAddPrice(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600;padding:5px 0">＋ price</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);font-style:italic;margin-top:2px">Currency &amp; region inherit the context unless overridden. A by-ref price (and its FX rate) freezes only when the chit is sealed.</div>';
  var fbRows = (c.feedback || [])
    .map(function (item, index) {
      var onRail = !!item.onRail;
      var railBtn =
        '<span data-cbsid="BUS004-C21" onclick="netSetFeedbackFmt(\'' +
        n.key +
        "'," +
        index +
        ',\'onRail\')" title="is this party on C&B?" style="cursor:pointer;font-size:var(--fs-1);font-weight:700;padding:3px 9px;border-radius:12px;border:1px solid ' +
        (onRail ? 'var(--ok-2)' : 'var(--line)') +
        ';color:' +
        (onRail ? 'var(--on-accent)' : 'var(--grey)') +
        ';background:' +
        (onRail ? 'var(--ok-2)' : 'var(--card)') +
        '">' +
        (onRail ? 'on C&B' : 'off-rail') +
        '</span>';
      var fmt = onRail
        ? '<span style="font-size:var(--fs-1);color:var(--ok-2);flex:1">native chit — CB delivers it directly</span>'
        : '<input data-cbsid="BUS004-I23" value="' +
          esc(item.format || '') +
          '" oninput="netSetFeedbackFmt(\'' +
          n.key +
          "'," +
          index +
          ',\'format\',this.value)" placeholder="their format (EDI 850, cXML PO, PDF…)" style="flex:1;min-width:0;' +
          _in +
          '">';
      return (
        '<div style="border:1px solid var(--line);border-radius:9px;padding:6px 8px;margin-top:5px"><div style="display:flex;gap:6px;align-items:center"><input data-cbsid="BUS004-I24" value="' +
        esc(item.system || '') +
        '" oninput="netSetFeedback(\'' +
        n.key +
        "'," +
        index +
        ',this.value)" placeholder="system / party to feed back (SAP, Supplier A)" style="flex:1;min-width:0;' +
        _in +
        '">' +
        railBtn +
        '<span data-cbsid="BUS004-C22" onclick="netDelFeedback(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div><div style="display:flex;gap:6px;align-items:center;margin-top:5px">' +
        fmt +
        '</div></div>'
      );
    })
    .join('');
  var trigRows =
    (c.triggers || [])
      .map(function (item, index) {
        var opSel = ['below', 'above', 'equals']
          .map(function (o) {
            return '<option' + (item.op === o ? ' selected' : '') + '>' + o + '</option>';
          })
          .join('');
        var actSel = ['reorder', 'alert', 'feed back']
          .map(function (a) {
            return '<option' + (item.action === a ? ' selected' : '') + '>' + a + '</option>';
          })
          .join('');
        var sm = 'font-size:var(--fs-1);padding:4px 5px;border:1px solid var(--line);border-radius:6px';
        return (
          '<div style="border:1px solid var(--line);border-radius:9px;padding:7px 9px;margin-top:5px;display:flex;gap:5px;align-items:center;flex-wrap:wrap;font-size:var(--fs-1);color:var(--grey)">' +
          'When <input data-cbsid="BUS004-I25" value="' +
          esc(item.watch || '') +
          '" oninput="netSetTrigger(\'' +
          n.key +
          "'," +
          index +
          ',\'watch\',this.value)" placeholder="stock" style="width:78px;' +
          sm +
          '">' +
          ' is <select data-cbsid="BUS004-S07" onchange="netSetTrigger(\'' +
          n.key +
          "'," +
          index +
          ',\'op\',this.value)" style="' +
          sm +
          '">' +
          opSel +
          '</select>' +
          ' <input data-cbsid="BUS004-I26" value="' +
          esc(item.value || '') +
          '" oninput="netSetTrigger(\'' +
          n.key +
          "'," +
          index +
          ',\'value\',this.value)" placeholder="EOQ / min" style="width:70px;' +
          sm +
          '">' +
          ' <span class=arw>→</span> <select data-cbsid="BUS004-S08" onchange="netSetTrigger(\'' +
          n.key +
          "'," +
          index +
          ',\'action\',this.value)" style="' +
          sm +
          '">' +
          actSel +
          '</select>' +
          ' to <input data-cbsid="BUS004-I27" value="' +
          esc(item.target || '') +
          '" oninput="netSetTrigger(\'' +
          n.key +
          "'," +
          index +
          ',\'target\',this.value)" placeholder="supplier / system" style="width:110px;' +
          sm +
          '">' +
          '<span data-cbsid="BUS004-C23" onclick="netDelTrigger(\'' +
          n.key +
          "'," +
          index +
          ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px;margin-inline-start:auto">×</span></div>'
        );
      })
      .join('') ||
    '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">No triggers — the catalogue is static (a human decides when to act).</div>';
  // ---- five focused tabs: a human fills a few things at a time (no more one long scroll) ----
  var tab = (UI.net && UI.net.catTab) || 'purpose';
  var nfields = (c.fields || []).length;
  var TABS = [
    { k: 'purpose', label: 'Purpose' },
    { k: 'identity', label: 'Identity' },
    { k: 'reqs', label: 'Requirements' + (nfields ? ' · ' + nfields : '') },
    { k: 'pricing', label: 'Pricing' + ((c.pricing || []).length ? ' · ' + c.pricing.length : '') },
    { k: 'loop', label: 'Loop' + ((c.triggers || []).length ? ' · ' + c.triggers.length : '') },
    { k: 'feedback', label: 'Feed back' + ((c.feedback || []).length ? ' · ' + c.feedback.length : '') },
    { k: 'chain', label: '🔗 Chain' }
  ];
  var tabBar =
    '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:9px">' +
    TABS.map(function (item) {
      var on = tab === item.k;
      return (
        '<span data-cbsid="BUS004-C24" onclick="netCatTab(\'' +
        n.key +
        "','" +
        item.k +
        '\')" style="cursor:pointer;font-size:var(--fs-1);font-weight:600;padding:4px 11px;border-radius:14px;border:1px solid ' +
        (on ? 'var(--blue-2)' : 'var(--line)') +
        ';color:' +
        (on ? 'var(--on-accent)' : 'var(--grey)') +
        ';background:' +
        (on ? 'var(--blue-2)' : 'var(--card)') +
        '">' +
        item.label +
        '</span>'
      );
    }).join('') +
    '</div>';
  var body = '';
  if (tab === 'purpose') {
    body =
      '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:10px">Purpose <span style="color:var(--faint,var(--grey-3))">(what this catalogue is for — in your words)</span></label>' +
      '<textarea data-cbsid="BUS004-T01" oninput="netSetCatStory(\'' +
      n.key +
      '\',this.value)" onchange="netCatTab(\'' +
      n.key +
      '\',\'purpose\')" placeholder="e.g. Gather stock from ERP + Tally, work out the reorder, and send POs to my suppliers by EOQ." rows="3" style="width:100%;margin-top:4px;box-sizing:border-box;resize:vertical;' +
      _in +
      '">' +
      esc(c.story || '') +
      '</textarea>' +
      '<div style="margin-top:6px;padding:7px 9px;border:1px dashed #b7a3d6;border-radius:9px;background:var(--purple-tint);font-size:var(--fs-1);color:var(--purple-2)">🤖 An AI assistant will read this, pull the canonical fields for this material / service, check them against your existing systems, and propose the routing. <i>Wiring later — route by hand for now.</i></div>' +
      _catInfer(n) +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px">Next: <b>' +
      tx('Identity') +
      '</b> <span class=arw>→</span> name the product · <b>' +
      tx('Requirements') +
      '</b> <span class=arw>→</span> route each field · <b>' +
      tx('Feed back') +
      '</b> <span class=arw>→</span> where it goes · <b>' +
      tx('Chain') +
      '</b> <span class=arw>→</span> the finished picture.</div>';
  } else if (tab === 'identity') {
    body = partA + partB + partStd + partBOM;
  } else if (tab === 'pricing') {
    body = _adoptedPricing(n, c) + partPricing;
  } else if (tab === 'loop') {
    body =
      '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:10px"><b style="font-weight:800;color:var(--blue-2);letter-spacing:.05em">' +
      tx('LOOP') +
      '</b> <span style="color:var(--faint,var(--grey-3))">— when a watched signal crosses a threshold, act automatically</span></label>' +
      trigRows +
      '<div data-cbsid="BUS004-C25" onclick="netAddTrigger(\'' +
      n.key +
      '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600;padding:5px 0">＋ trigger</div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);font-style:italic;margin-top:2px">The signal is usually a Computed value (e.g. EOQ) or a System-fed one (e.g. stock). The action fires down a Feed-back destination.</div>';
  } else if (tab === 'reqs') {
    body =
      '<div style="margin-top:10px"><b style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em">' +
      tx('REQUIREMENTS') +
      '</b> <span style="color:var(--faint,var(--grey-3))">— what you need to know, and where each part comes from</span></div>' +
      '<div style="margin:6px 0 2px">' +
      legLegend +
      '</div>' +
      fields +
      '<div data-cbsid="BUS004-C26" onclick="netAddCatField(\'' +
      n.key +
      '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-2);font-weight:600;padding:5px 0">＋ requirement</div>' +
      legNote +
      '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:10px">List is built by <span style="color:var(--faint,var(--grey-3))">(how the catalogue itself is loaded)</span></label>' +
      '<select data-cbsid="BUS004-S09" onchange="netSetCatLoad(\'' +
      n.key +
      '\',this.value)" style="margin-top:4px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2)">' +
      loadOpts +
      '</select>';
  } else if (tab === 'feedback') {
    body =
      '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:10px"><b style="font-weight:800;color:var(--blue-2);letter-spacing:.05em">' +
      tx('FEED BACK') +
      '</b> <span style="color:var(--faint,var(--grey-3))">— once complete, push the record to these systems (with a receipt)</span></label>' +
      fbRows +
      '<div data-cbsid="BUS004-C27" onclick="netAddFeedback(\'' +
      n.key +
      '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600;padding:4px 0">＋ system to feed back</div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px">Nothing here = CB is the end of the chain (it just holds the record).</div>';
  } else {
    body =
      _catChain(n) +
      _catRecordPreview(n) +
      '<div data-cbsid="BUS004-C28" onclick="netExportCat(\'' +
      n.key +
      '\')" style="cursor:pointer;display:inline-block;margin-top:10px;font-size:var(--fs-1);font-weight:600;color:var(--blue);border:1px solid var(--line);border-radius:6px;padding:5px 11px">⤓ Export draft (JSON)</div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px">' +
      tx('Feeds the compute') +
      '<span class=arw>→</span>seal harness — the design drives the run.</div>';
  }
  return (
    '<div style="margin-top:10px;padding:12px 13px;border:1px solid var(--line);border-inline-start:3px solid var(--blue-2);border-radius:9px;background:var(--blue-tint-bg);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em">' +
    tx('🗂️ CATALOGUE — complete the information chain') +
    '</div>' +
    tabBar +
    '<div style="margin-top:6px">' +
    body +
    '</div>' +
    '</div>'
  );
}
/** The order-form preview. Takes the store's CURRENCY CODE — a hardcoded symbol here showed ₹ to a store
    trading in dollars, which is the defect currency-matrix already records against the storefront. */
function _methodControl(m, cur) {
  cur = cur || (typeof SESSION !== 'undefined' && SESSION.currency) || '';
  var inp =
    'display:inline-block;border:1px solid var(--line);border-radius:5px;padding:2px 8px;font-size:var(--fs-1);color:var(--grey);background:var(--card)';
  var btn = 'display:inline-block;background:var(--blue-2);color:var(--on-accent);border-radius:5px;padding:3px 10px;font-size:var(--fs-1);font-weight:600';
  if (m === 'text') return '<span style="font-size:var(--fs-1);color:var(--grey)">Information only — nothing to order.</span>';
  if (m === 'qty') return '<span style="' + inp + '">' + tx('Qty ▢') + '</span> &nbsp; <span style="' + btn + '">' + tx('Order') + '</span>';
  if (m === 'cart')
    return (
      '<span style="' +
      inp +
      '">' +
      tx('Qty ▢') +
      '</span> <span style="font-size:var(--fs-1);color:var(--grey)">× ' +
      esc(cur) +
      ' price</span> &nbsp; <span style="' +
      btn +
      '">' +
      tx('Add to cart') +
      '</span>'
    );
  if (m === 'range')
    return (
      '<div style="font-size:var(--fs-1);color:var(--grey)">' +
      esc(cur) +
      ' min ──●────── ' +
      esc(cur) +
      ' max</div><div style="margin-top:5px"><span style="' +
      inp +
      '">' +
      tx('Qty ▢') +
      '</span> &nbsp; <span style="' +
      btn +
      '">' +
      tx('Order') +
      '</span></div>'
    );
  if (m === 'qtyprice')
    return (
      '<span style="' +
      inp +
      '">' +
      tx('Qty ▢') +
      '</span> <span style="' +
      inp +
      '">' +
      tx('Your price ▢') +
      '</span> &nbsp; <span style="' +
      btn +
      '">' +
      tx('Send offer') +
      '</span>'
    );
  return '';
}
function _methodPreview(m) {
  var inner = _methodControl(m);
  if (!inner) return '';
  return (
    '<div style="margin-top:6px;padding:9px 10px;border:1px dashed var(--line-strong,#c8d0d9);border-radius:9px;background:var(--card);color:var(--on-card)"><div style="font-size:var(--fs-1);color:var(--faint,var(--grey-3));text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">' +
    tx('Customer sees') +
    '</div>' +
    inner +
    '</div>'
  );
}
/* ---- the REAL OUTPUT visuals ---- */
function _sampleVal(type) {
  if (type === 'number') return '123.4';
  if (type === 'choice') return 'A';
  if (type === 'range') return '10–20';
  if (type === 'date') return '2026-07-25';
  return 'text';
}
function _legBadge(leg) {
  var l = CAT_LEGS.filter(function (x) {
    return x.k === leg;
  })[0] || { short: '—', col: ['var(--blue-2)', 'var(--blue-tint-bg)'] };
  return (
    '<span style="font-size:var(--fs-1);font-weight:700;text-transform:uppercase;color:' +
    l.col[0] +
    ';background:' +
    l.col[1] +
    ';border-radius:4px;padding:1px 5px">' +
    esc(l.short) +
    '</span>'
  );
}
/* the headline: the four-leg information chain, drawn from the routed requirements */
function _catChain(n) {
  var c = n.catalogue || {};
  var fs = c.fields || [];
  var _cx = c.context || {};
  var ctxLabel = [_cx.currency, _cx.region].filter(Boolean).map(esc).join(' · ');
  var chip = function (txt, col) {
    return (
      '<span style="display:inline-block;font-size:var(--fs-1);color:#1c2128;background:' +
      col[1] +
      ';border:1px solid ' +
      col[0] +
      '55;border-radius:5px;padding:1px 6px;margin:2px 3px 0 0">' +
      esc(txt) +
      '</span>'
    );
  };
  var list = (c.feedback || []).filter(function (x) {
    return x.system;
  });
  if (!fs.length && !c.product && !list.length) return '';
  var fbCol = ['var(--purple-2)', 'var(--purple-tint)'];
  var card = function (head, hint, col, itemsHtml, count) {
    return (
      '<div style="flex:1;min-width:118px;border:1px solid var(--line);border-top:3px solid ' +
      col[0] +
      ';border-radius:9px;padding:8px 9px;background:var(--card);color:var(--on-card)">' +
      '<div style="font-size:var(--fs-1);font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:' +
      col[0] +
      '">' +
      esc(head) +
      ' <span style="color:var(--faint,var(--grey-3))">' +
      count +
      '</span></div>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin:1px 0 4px">' +
      esc(hint) +
      '</div>' +
      (itemsHtml || '<span style="font-size:var(--fs-1);color:var(--faint,var(--grey-3))">—</span>') +
      '</div>'
    );
  };
  var cards = CAT_LEGS.map(function (item) {
    var items = fs
      .filter(function (f) {
        return f.leg === item.k;
      })
      .map(function (f) {
        return chip((f.name || '—') + ((item.k === 'system' || item.k === 'compute') && f.via ? ' · ' + f.via : ''), item.col);
      });
    if (item.k === 'cb') {
      // identity + units are always CB-stored (the gap CB fills by definition)
      if (c.baseUnit) items.unshift(chip('units · ' + c.baseUnit, item.col));
      if (c.product) items.unshift(chip(c.product + ' (identity)', item.col));
    }
    return card(item.short, item.hint, item.col, items.join(''), items.length);
  }).join('');
  cards += card(
    'Feed back',
    'record pushed out',
    fbCol,
    list
      .map(function (x) {
        return chip(x.system + (x.onRail ? ' · C&B' : x.format ? ' · ' + x.format : ''), fbCol);
      })
      .join(''),
    list.length
  );
  var trigs = (c.triggers || []).filter(function (item) {
    return item.watch || item.value;
  });
  var loopBanner = trigs.length
    ? '<div style="margin-top:8px;padding:6px 10px;border:1px solid #cdbfe6;border-radius:9px;background:var(--purple-tint);font-size:var(--fs-1);color:var(--purple-2)">⟳ ' +
      trigs
        .map(function (item) {
          return (
            'when <b>' +
            esc(item.watch || '?') +
            '</b> ' +
            esc(item.op || '') +
            ' <b>' +
            esc(item.value || '?') +
            '</b> <span class=arw>→</span> <b>' +
            esc(item.action || '') +
            '</b>' +
            (item.target ? ' to ' + esc(item.target) : '')
          );
        })
        .join(' · ') +
      '</div>'
    : '';
  var bomList = (c.bom || []).filter(function (b) {
    return b.item;
  });
  var bomBanner = bomList.length
    ? '<div style="margin-top:6px;font-size:var(--fs-1);color:var(--grey)">Made of: ' +
      bomList
        .map(function (b) {
          return esc(b.item) + '×' + (b.qty != null ? b.qty : 1);
        })
        .join(' · ') +
      ' <i>(reorder cascades)</i></div>'
    : '';
  var stds = (c.standards || []).filter(function (item) {
    return item.code || item.label;
  });
  var stdBanner = stds.length
    ? '<div style="margin-top:6px;font-size:var(--fs-1);color:var(--grey)">Standards: ' +
      stds
        .map(function (item) {
          return esc(item.scheme) + ' ' + esc(item.code || item.label);
        })
        .join(' · ') +
      ' <i>(by reference)</i></div>'
    : '';
  var prices = (c.pricing || []).filter(function (item) {
    return item.label || item.amount != null || item.source;
  });
  var priceBanner = prices.length
    ? '<div style="margin-top:6px;font-size:var(--fs-1);color:var(--grey)">Pricing: ' +
      prices
        .map(function (item) {
          var r = CBCatalogue.resolvePrice(c, item);
          return (
            esc(r.label) +
            ' — ' +
            (item.by === 'value' ? (r.amount != null ? r.amount + ' ' + esc(r.currency || '') : 'value') : esc(item.source || 'ref')) +
            ' <i>[' +
            (item.by === 'value' ? 'frozen' : 'ref') +
            ']</i>'
          );
        })
        .join(' · ') +
      (ctxLabel ? ' · in ' + ctxLabel : '') +
      '</div>'
    : '';
  return (
    '<div style="margin-top:12px;padding-top:9px;border-top:1px solid var(--line)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em;margin-bottom:6px">🔗 INFORMATION CHAIN — how this catalogue is completed</div>' +
    '<div style="display:flex;gap:7px;flex-wrap:wrap">' +
    cards +
    '</div>' +
    loopBanner +
    bomBanner +
    stdBanner +
    priceBanner +
    '</div>'
  );
}
/* a first, honest reading of the purpose story — rule-based today, the AI takes this over later */
function _catInfer(n) {
  var text = ((n.catalogue || {}).story || '').toLowerCase();
  if (!text.trim()) return '';
  var systems = ['erp', 'sap', 'oracle', 'netsuite', 'dynamics', 'tally', 'quickbooks', 'zoho'].filter(function (item) {
    return text.indexOf(item) >= 0;
  });
  var feedsBack = /supplier|vendor|purchase order|\bpo\b|reorder|replenish|feed ?back|send.*to my/.test(text);
  var fromCust = /customer|buyer|client|order from|they send|storefront/.test(text);
  var computes = [];
  if (/eoq|reorder|replenish|economic order|min.?max|stock level/.test(text)) computes.push('reorder / EOQ');
  if (/combine|combined|consolidat|merge|aggregat/.test(text)) computes.push('combined view');
  var bits = [];
  if (systems.length)
    bits.push(
      '<b style="color:var(--warn-2)">' +
        tx('System feed') +
        '</b> — ' +
        systems
          .map(function (x) {
            return x.toUpperCase();
          })
          .join(', ')
    );
  if (fromCust) bits.push('<b style="color:var(--blue-2)">' + tx('From customer') + '</b> — order details at request time');
  if (computes.length)
    bits.push('<b style="color:var(--purple)">' + tx('Computed') + '</b> — ' + computes.join(', ') + ' (a co-assist computes, the rail seals)');
  bits.push('<b style="color:var(--ok-2)">' + tx('Store in CB') + '</b> — the consolidated record (the gap CB fills)');
  if (feedsBack) bits.push('<b style="color:var(--purple-2)">' + tx('Feed back') + '</b> — suppliers / the named system');
  return (
    '<div style="margin-top:8px;padding:8px 10px;border:1px solid #bcd0e8;border-radius:9px;background:var(--blue-tint-bg);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--blue-2);margin-bottom:4px">Reading your purpose <span style="font-weight:500;color:var(--grey);text-transform:none">— a first guess; confirm it as you route the requirements</span></div>' +
    '<div style="font-size:var(--fs-1);color:var(--ink-2);line-height:1.6">' +
    bits.join('<br>') +
    '</div></div>'
  );
}
function _catRecordPreview(n) {
  var c = n.catalogue || {};
  var fs = c.fields || [];
  if (!fs.length && !c.product) return '';
  var name = c.product || 'Item';
  var v0 = (c.variants || [])[0];
  var au = (c.altUnits || [])[0];
  var unitLine = c.baseUnit
    ? 'base ' + esc(c.baseUnit) + (au && au.unit ? ' · 1 ' + esc(au.unit) + ' = ' + (au.num || 1) + '/' + (au.den || 1) + ' ' + esc(c.baseUnit) : '')
    : '';
  var refs = (c.refs || []).filter(function (item) {
    return item.system && item.code;
  });
  var refsLine = refs.length
    ? refs
        .map(function (item) {
          return esc(item.system) + ':' + esc(item.code);
        })
        .join(' · ')
    : '';
  var rows = fs
    .map(function (item) {
      return (
        '<div style="display:flex;align-items:center;gap:8px;padding:2px 0;font-size:var(--fs-1)"><span style="flex:0 0 116px;color:var(--grey);font-family:monospace;overflow:hidden;text-overflow:ellipsis">' +
        esc(item.name || '—') +
        '</span><span style="flex:1;color:var(--ink-2)">' +
        _sampleVal(item.type) +
        '</span>' +
        _legBadge(item.leg) +
        '</div>'
      );
    })
    .join('');
  return (
    '<div style="margin-top:12px;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);color:var(--faint,var(--grey-3));text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">' +
    tx('📄 Stored as a record — one item') +
    '</div>' +
    '<div style="font-weight:700;font-size:var(--fs-2)">' +
    esc(name) +
    (v0 && v0.name ? ' <span style="font-weight:500;color:var(--grey);font-size:var(--fs-1)"><span class=arw>▸</span> ' + esc(v0.name) + '</span>' : '') +
    '</div>' +
    (unitLine ? '<div style="font-size:var(--fs-1);color:var(--grey);font-family:monospace;margin:2px 0 2px">' + unitLine + '</div>' : '') +
    (refsLine
      ? '<div style="font-size:var(--fs-1);color:var(--faint,var(--grey-3));font-family:monospace;margin:1px 0 5px">known as ' + refsLine + '</div>'
      : '<div style="margin-bottom:4px"></div>') +
    rows +
    '<div style="border-top:1px dashed var(--line);margin-top:6px;padding-top:5px;font-size:var(--fs-1);color:var(--grey);font-family:monospace">🔒 sealed · content_hash a1b2c3…  ·  loaded by ' +
    esc(c.loadedBy || 'manual') +
    '</div>' +
    '</div>'
  );
}
function _chitPreview(n) {
  var c = n.catalogue || {};
  var fs = c.fields || [];
  var o = _ensureOrder(n);
  var e = n.exposure || 'private';
  var name = c.product || 'Item';
  var expBadge =
    '<span style="font-size:var(--fs-1);font-weight:700;text-transform:uppercase;color:' +
    (e === 'public' ? 'var(--ok-2)' : 'var(--warn-2)') +
    ';background:' +
    (e === 'public' ? 'var(--ok-tint)' : 'var(--warn-tint)') +
    ';border-radius:4px;padding:1px 5px">' +
    esc(e) +
    '</span>';
  var specRows =
    fs
      .slice(0, 6)
      .map(function (item) {
        return (
          '<div style="display:flex;justify-content:space-between;font-size:var(--fs-1);padding:1px 0"><span style="color:var(--grey)">' +
          esc(item.name || '—') +
          '</span><span style="color:var(--faint,var(--grey-3));font-family:monospace">' +
          _sampleVal(item.type) +
          '</span></div>'
        );
      })
      .join('') || '<div style="font-size:var(--fs-1);color:var(--grey)">no fields</div>';
  var cb = (o.collectBack || []).filter(function (x) {
    return x.name;
  });
  var collectLine = cb.length
    ? '<div style="margin-top:7px;font-size:var(--fs-1);color:var(--blue-2)">You provide: <b>' +
      cb
        .map(function (x) {
          return esc(x.name);
        })
        .join(', ') +
      '</b></div>'
    : '';
  var arrive = ['on the rail']
    .concat(
      (o.inlets || [])
        .filter(function (x) {
          return x.channel;
        })
        .map(function (x) {
          return x.channel;
        })
    )
    .join(' · ');
  var list = (o.states || []).filter(function (x) {
    return x.name;
  });
  var stateFlow = list.length
    ? '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px;align-items:center">' +
      list
        .map(function (x, index) {
          return (
            (index ? '<span style="color:var(--faint,var(--grey-3));font-size:var(--fs-1)"><span class=arw>→</span></span>' : '') +
            '<span style="font-size:var(--fs-1);font-weight:600;color:var(--ink-2);background:var(--blue-tint-bg);border-radius:4px;padding:1px 6px">' +
            esc(x.name) +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    : '';
  return (
    '<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:9px"><div style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);letter-spacing:.05em">' +
    tx('🧾 CHIT — what the customer sees') +
    '</div>' +
    '<div style="margin-top:7px;max-width:290px;border:1px solid var(--line);border-top:3px solid var(--blue-2);border-radius:12px;box-shadow:0 1px 3px rgba(20,30,45,.08);padding:12px 13px;background:var(--card);color:var(--on-card)">' +
    '<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:700;font-size:var(--fs-2)">' +
    esc(name) +
    '</span>' +
    expBadge +
    '</div>' +
    '<div style="margin-top:6px">' +
    specRows +
    '</div>' +
    '<div style="margin-top:9px">' +
    _methodControl(o.method, (n.place && n.place.currency) || (typeof SESSION !== 'undefined' && SESSION.currency) || '') +
    '</div>' +
    collectLine +
    stateFlow +
    '<div style="border-top:1px dashed var(--line);margin-top:9px;padding-top:5px;font-size:var(--fs-1);color:var(--faint,var(--grey-3))">arrives: ' +
    esc(arrive) +
    '</div>' +
    '</div></div>'
  );
}
function _storefrontConfig(n) {
  var e = n.exposure || 'private';
  var o = _ensureOrder(n);
  var opt = function (val, label, hint) {
    var on = e === val;
    return (
      '<div data-cbsid="BUS004-C29" onclick="netSetExposure(\'' +
      n.key +
      "','" +
      val +
      '\')" style="cursor:pointer;padding:8px 10px;border:1px solid ' +
      (on ? 'var(--ok-2)' : 'var(--line)') +
      ';border-radius:9px;background:' +
      (on ? 'var(--ok-tint)' : 'var(--card)') +
      ';color:' +
      (on ? 'var(--on-card)' : 'var(--on-card)') +
      ';margin-top:6px">' +
      '<b style="font-size:var(--fs-2);color:' +
      (on ? 'var(--ok-2)' : 'var(--ink-2)') +
      '">' +
      (on ? '● ' : '○ ') +
      label +
      '</b>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
      hint +
      '</div></div>'
    );
  };
  // Visibility MOVED to the node itself (_netVisibilityBlock). Two controls for one value is how a person sets it
  // in one place and finds it changed in the other; this panel now only REPORTS it and points at the real control.
  var curLabel =
    (
      NET_EXPOSURE.filter(function (x) {
        return x.k === (n.exposure || 'private');
      })[0] || {}
    ).label || '— Private';
  var view =
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);letter-spacing:.05em">' +
    tx('👁️ WHO SEES IT') +
    '</div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-top:5px;line-height:1.55">Currently <b>' +
    esc(curLabel) +
    "</b> — set at the top of this node, under <b>Who can see this store's catalogue</b>.</div>";
  void opt;
  var methOpts = CAT_METHODS.map(function (item) {
    return '<option value="' + item.k + '"' + ((o.method || 'cart') === item.k ? ' selected' : '') + '>' + item.label + '</option>';
  }).join('');
  var mh =
    (
      CAT_METHODS.filter(function (item) {
        return item.k === (o.method || 'cart');
      })[0] || {}
    ).hint || '';
  var inletRows = (o.inlets || [])
    .map(function (item, index) {
      var chOpts = OFF_RAIL_CHANNELS.map(function (ch) {
        return '<option value="' + ch + '"' + (item.channel === ch ? ' selected' : '') + '>' + ch + '</option>';
      }).join('');
      return (
        '<div style="display:flex;gap:6px;align-items:center;padding:3px 0"><select data-cbsid="BUS004-S10" onchange="netSetInlet(\'' +
        n.key +
        "'," +
        index +
        ',\'channel\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
        chOpts +
        '</select><input data-cbsid="BUS004-I28" value="' +
        esc(item.handle || '') +
        '" oninput="netSetInlet(\'' +
        n.key +
        "'," +
        index +
        ',\'handle\',this.value)" placeholder="the number / address customers use" style="flex:1;min-width:0;font-size:var(--fs-1);padding:4px 7px;border:1px solid var(--line);border-radius:6px"><span data-cbsid="BUS004-C30" onclick="netDelInlet(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
      );
    })
    .join('');
  var cbRows =
    (o.collectBack || [])
      .map(function (cb, index) {
        var cadOpts = COLLECT_CADENCE.map(function (item) {
          return '<option value="' + item + '"' + (cb.cadence === item ? ' selected' : '') + '>' + item + '</option>';
        }).join('');
        return (
          '<div style="display:flex;gap:6px;align-items:center;padding:3px 0"><input data-cbsid="BUS004-I29" value="' +
          esc(cb.name || '') +
          '" oninput="netSetCollectBack(\'' +
          n.key +
          "'," +
          index +
          ',\'name\',this.value)" placeholder="what to collect (e.g. delivery location)" style="flex:1;min-width:0;font-size:var(--fs-1);padding:4px 7px;border:1px solid var(--line);border-radius:6px"><select data-cbsid="BUS004-S11" onchange="netSetCollectBack(\'' +
          n.key +
          "'," +
          index +
          ',\'cadence\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
          cadOpts +
          '</select><span data-cbsid="BUS004-C31" onclick="netDelCollectBack(\'' +
          n.key +
          "'," +
          index +
          ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
        );
      })
      .join('') || '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">Nothing asked back.</div>';
  var order =
    '<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:9px"><div style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);letter-spacing:.05em">' +
    tx('📝 ORDER FORM — what the customer fills in') +
    '</div>' +
    '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:8px">' +
    tx('How they order (commercial method)') +
    '</label>' +
    '<select data-cbsid="BUS004-S12" onchange="netSetOrderMethod(\'' +
    n.key +
    '\',this.value)" style="margin-top:4px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2)">' +
    methOpts +
    '</select>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);font-style:italic;margin-top:3px">' +
    esc(mh) +
    '</div>' +
    _methodPreview(o.method) +
    '<label style="font-size:var(--fs-1);color:var(--grey);display:block;margin-top:10px">Max items per order <span style="color:var(--faint,var(--grey-3))">(optional)</span></label>' +
    '<input data-cbsid="BUS004-I30" value="' +
    (o.maxItems != null ? esc(String(o.maxItems)) : '') +
    '" oninput="netSetOrderMax(\'' +
    n.key +
    '\',this.value)" type="number" min="1" placeholder="no limit" style="margin-top:4px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2);width:130px">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);letter-spacing:.05em;margin-top:12px;border-top:1px solid var(--line);padding-top:9px">' +
    tx('📥 COLLECT FROM CUSTOMER') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px">Info you ask the buyer to provide with the order (e.g. delivery address, a monthly forecast).</div>' +
    cbRows +
    '<div data-cbsid="BUS004-C32" onclick="netAddCollectBack(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-2);font-weight:600;padding:5px 0">＋ collect field</div>' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);letter-spacing:.05em;margin-top:12px;border-top:1px solid var(--line);padding-top:9px">' +
    tx('🛬 HOW ORDERS ARRIVE') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--ok-2);margin-top:5px;padding:6px 9px;border:1px solid #cfe0d6;border-radius:6px;background:var(--card)">✓ <b>' +
    tx('On the rail') +
    '</b> — customers order at your storefront (they find you in ChitBridge).</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px">Off-rail inlets <span style="color:var(--faint,var(--grey-3))">(optional)</span> — a message to a channel <b>you own &amp; publish</b>, captured into a chit:</div>' +
    inletRows +
    '<div data-cbsid="BUS004-C33" onclick="netAddInlet(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-2);font-weight:600;padding:5px 0">＋ add off-rail inlet</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px;font-style:italic">De-duplicated automatically — the same scan or message won\'t create a second chit (matched by content).</div>' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);letter-spacing:.05em;margin-top:12px;border-top:1px solid var(--line);padding-top:9px">' +
    tx('🔄 LIFECYCLE — states the chit moves through') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px">Order the states (e.g. open <span class=arw>→</span> confirmed <span class=arw>→</span> fulfilled <span class=arw>→</span> closed). Each move is a sealed step; a dispute attaches to a state.</div>' +
    ((o.states || [])
      .map(function (item, index) {
        var last = index === o.states.length - 1;
        return (
          '<div style="display:flex;gap:5px;align-items:center;padding:2px 0"><span style="font-size:var(--fs-1);color:var(--faint,var(--grey-3));width:16px">' +
          (index + 1) +
          '</span><input data-cbsid="BUS004-I31" value="' +
          esc(item.name || '') +
          '" oninput="netSetState(\'' +
          n.key +
          "'," +
          index +
          ',this.value)" placeholder="state name" style="flex:1;min-width:0;font-size:var(--fs-1);padding:4px 7px;border:1px solid var(--line);border-radius:6px">' +
          (index > 0
            ? '<span data-cbsid="BUS004-C34" onclick="netMoveState(\'' + n.key + "'," + index + ',-1)" style="cursor:pointer;color:var(--grey);padding:0 3px">↑</span>'
            : '<span style="display:inline-block;width:14px"></span>') +
          (!last
            ? '<span data-cbsid="BUS004-C35" onclick="netMoveState(\'' + n.key + "'," + index + ',1)" style="cursor:pointer;color:var(--grey);padding:0 3px">↓</span>'
            : '<span style="display:inline-block;width:14px"></span>') +
          '<span data-cbsid="BUS004-C36" onclick="netDelState(\'' +
          n.key +
          "'," +
          index +
          ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
        );
      })
      .join('') || '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">No states — a one-shot chit (created, done).</div>') +
    '<div data-cbsid="BUS004-C37" onclick="netAddState(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-2);font-weight:600;padding:5px 0">＋ state</div>' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);letter-spacing:.05em;margin-top:12px;border-top:1px solid var(--line);padding-top:9px">📎 ATTACHMENTS &amp; NOTES</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px">Documents the chit carries, and any free-text note.</div>' +
    ((o.attachments || [])
      .map(function (item, index) {
        return (
          '<div style="display:flex;gap:6px;align-items:center;padding:3px 0"><input data-cbsid="BUS004-I32" value="' +
          esc(item.name || '') +
          '" oninput="netSetAttach(\'' +
          n.key +
          "'," +
          index +
          ',this.value)" placeholder="document name (e.g. assay_cert.pdf)" style="flex:1;min-width:0;font-size:var(--fs-1);padding:4px 7px;border:1px solid var(--line);border-radius:6px"><span data-cbsid="BUS004-C38" onclick="netDelAttach(\'' +
          n.key +
          "'," +
          index +
          ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
        );
      })
      .join('') || '<div style="font-size:var(--fs-1);color:var(--grey);padding:2px 0">No attachments.</div>') +
    '<div data-cbsid="BUS004-C39" onclick="netAddAttach(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-2);font-weight:600;padding:5px 0">＋ add attachment</div>' +
    '<textarea data-cbsid="BUS004-T02" oninput="netSetOrderNotes(\'' +
    n.key +
    '\',this.value)" placeholder="notes…" style="width:100%;margin-top:6px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2);box-sizing:border-box;min-height:2.4rem;resize:vertical">' +
    esc(o.notes || '') +
    '</textarea>' +
    '</div>';
  return (
    '<div style="margin-top:10px;padding:12px 13px;border:1px solid var(--line);border-inline-start:3px solid var(--ok-2);border-radius:9px;background:var(--ok-tint);color:var(--on-card)">' +
    view +
    order +
    _chitPreview(n) +
    '</div>'
  );
}
/* setters for the four remaining panels */
/* co-assist: normalized shape + per-kind setters (Human roles · IoT gateways→devices · ERP system+label · AI role+autonomy) */
function _defCoassist() {
  return { human: { count: 0, roles: [] }, iot: { connections: [] }, erp: { connectors: [] }, ai: { count: 0, role: '', autonomy: 'authorize' } };
}
function _normCoassist(ca) {
  var d = _defCoassist();
  ca = ca || {};
  if (typeof ca.human === 'number') d.human.count = ca.human;
  else if (ca.human) {
    d.human.count = ca.human.count || 0;
    d.human.roles = ca.human.roles || [];
  }
  if (typeof ca.iot === 'number') {
    if (ca.iot > 0) d.iot.connections = [{ type: 'Direct sensor', count: 1, devices: ca.iot }];
  } else if (ca.iot) {
    if (Array.isArray(ca.iot.connections))
      d.iot.connections = ca.iot.connections.map(function (x) {
        return { type: x.type || 'Raspberry Pi', count: x.count != null ? x.count : 1, devices: x.devices || 0 };
      });
    else if (ca.iot.gateways || ca.iot.devices) d.iot.connections = [{ type: 'Raspberry Pi', count: ca.iot.gateways || 1, devices: ca.iot.devices || 0 }];
  }
  if (typeof ca.erp === 'number') {
    for (var index = 0; index < ca.erp; index++) d.erp.connectors.push({ system: 'SAP', label: '' });
  } else if (ca.erp) {
    d.erp.connectors = ca.erp.connectors || [];
  }
  if (typeof ca.ai === 'number') d.ai.count = ca.ai;
  else if (ca.ai) {
    d.ai.count = ca.ai.count || 0;
    d.ai.role = ca.ai.role || '';
    d.ai.autonomy = ca.ai.autonomy || 'authorize';
  }
  return d;
}
function _ca(n) {
  n.coassist = _normCoassist(n.coassist);
  return n.coassist;
}
function netCaHuman(key, val) {
  var n = _netNode(key);
  if (!n) return;
  var x = parseInt(val, 10);
  _ca(n).human.count = val === '' || isNaN(x) || x < 0 ? 0 : x;
  _netMark();
}
function netCaHumanAddRole(key) {
  var n = _netNode(key);
  if (!n) return;
  _ca(n).human.roles.push('');
  _netMark();
  _netRerender();
}
function netCaHumanDelRole(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ca(n).human.roles.splice(i, 1);
  _netMark();
  _netRerender();
}
function netCaHumanSetRole(key, i, val) {
  var n = _netNode(key);
  if (!n) return;
  var r = _ca(n).human.roles;
  if (i >= 0 && i < r.length) {
    r[i] = val;
    _netMark();
  }
}
function netCaAddIot(key) {
  var n = _netNode(key);
  if (!n) return;
  _ca(n).iot.connections.push({ type: 'Raspberry Pi', count: 1, devices: 0 });
  _netMark();
  _netRerender();
}
function netCaDelIot(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ca(n).iot.connections.splice(i, 1);
  _netMark();
  _netRerender();
}
function netCaSetIot(key, i, prop, val) {
  var n = _netNode(key);
  if (!n) return;
  var cs = _ca(n).iot.connections;
  if (i < 0 || i >= cs.length) return;
  if (prop === 'devices' || prop === 'count') {
    var x = parseInt(val, 10);
    cs[i][prop] = val === '' || isNaN(x) || x < 0 ? 0 : x;
    _netMark();
  } else {
    cs[i][prop] = val;
    _netMark();
    _netRerender();
  }
}
function netCaAddErp(key) {
  var n = _netNode(key);
  if (!n) return;
  _ca(n).erp.connectors.push({ system: 'SAP', label: '' });
  _netMark();
  _netRerender();
}
function netCaDelErp(key, i) {
  var n = _netNode(key);
  if (!n) return;
  _ca(n).erp.connectors.splice(i, 1);
  _netMark();
  _netRerender();
}
function netCaSetErp(key, i, prop, val) {
  var n = _netNode(key);
  if (!n) return;
  var e = _ca(n).erp.connectors;
  if (i >= 0 && i < e.length) {
    e[i][prop] = val;
    _netMark();
    if (prop === 'system') _netRerender();
  }
}
function netCaAiCount(key, val) {
  var n = _netNode(key);
  if (!n) return;
  var x = parseInt(val, 10);
  _ca(n).ai.count = val === '' || isNaN(x) || x < 0 ? 0 : x;
  _netMark();
}
function netCaAiRole(key, val) {
  var n = _netNode(key);
  if (!n) return;
  _ca(n).ai.role = val;
  _netMark();
}
function netCaAiAutonomy(key, val) {
  var n = _netNode(key);
  if (!n) return;
  _ca(n).ai.autonomy = val;
  _netMark();
  _netRerender();
}
function netSetTransact(key, flow) {
  var n = _netNode(key);
  if (!n) return;
  n.transact = n.transact || {};
  n.transact.flow = flow;
  _netMark();
  _netRerender();
}
function netSetTransactCopy(key, v) {
  var n = _netNode(key);
  if (!n) return;
  n.transact = n.transact || {};
  n.transact.copyOperator = !!v;
  _netMark();
  _netRerender();
}
function netSetTradeMode(key, mode) {
  var n = _netNode(key);
  if (!n) return;
  n.tradeready = n.tradeready || { certs: [] };
  n.tradeready.mode = mode;
  _netMark();
  _netRerender();
}
function netAddCert(key) {
  var n = _netNode(key);
  if (!n) return;
  n.tradeready = n.tradeready || { mode: 'own', certs: [] };
  n.tradeready.certs = n.tradeready.certs || [];
  n.tradeready.certs.push('');
  _netMark();
  _netRerender();
}
function netDelCert(key, i) {
  var n = _netNode(key);
  if (!n || !n.tradeready) return;
  (n.tradeready.certs || []).splice(i, 1);
  _netMark();
  _netRerender();
}
function netSetCert(key, i, val) {
  var n = _netNode(key);
  if (!n || !n.tradeready || !n.tradeready.certs) return;
  if (i >= 0 && i < n.tradeready.certs.length) {
    n.tradeready.certs[i] = val;
    _netMark();
  }
} // no re-render while typing
function netSetDispute(key, informed) {
  var n = _netNode(key);
  if (!n) return;
  n.dispute = n.dispute || {};
  n.dispute.informed = !!informed;
  _netMark();
  _netRerender();
}

function _coassistConfig(n) {
  var c = _ca(n);
  var roleChips = c.human.roles
    .map(function (item, index) {
      return (
        '<span style="display:inline-flex;align-items:center;gap:3px;margin:0 5px 4px 0"><input data-cbsid="BUS004-I33" value="' +
        esc(item) +
        '" oninput="netCaHumanSetRole(\'' +
        n.key +
        "'," +
        index +
        ',this.value)" placeholder="role" style="width:96px;font-size:var(--fs-1);padding:3px 6px;border:1px solid var(--line);border-radius:6px"><span data-cbsid="BUS004-C40" onclick="netCaHumanDelRole(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700">×</span></span>'
      );
    })
    .join('');
  var human =
    '<div style="padding:9px 0;border-bottom:1px solid var(--line)">' +
    '<div style="display:flex;align-items:center;gap:8px"><span style="flex:1;font-size:var(--fs-2);font-weight:600;color:var(--ink-2)">' +
    tx('🧑 Human workforce') +
    '</span>' +
    '<span style="font-size:var(--fs-1);color:var(--grey)">count</span><input data-cbsid="BUS004-I34" type="number" min="0" value="' +
    (c.human.count || '') +
    '" oninput="netCaHuman(\'' +
    n.key +
    '\',this.value)" placeholder="0" style="width:64px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2)"></div>' +
    '<div style="margin-top:6px">' +
    roleChips +
    '<span data-cbsid="BUS004-C41" onclick="netCaHumanAddRole(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600">＋ role</span></div>' +
    '</div>';
  var iotRows = c.iot.connections
    .map(function (item, index) {
      var opts = IOT_TYPES.map(function (t) {
        return '<option value="' + t + '"' + (item.type === t ? ' selected' : '') + '>' + t + '</option>';
      }).join('');
      return (
        '<div style="display:flex;gap:5px;align-items:center;padding:3px 0;flex-wrap:wrap"><select data-cbsid="BUS004-S13" onchange="netCaSetIot(\'' +
        n.key +
        "'," +
        index +
        ',\'type\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
        opts +
        '</select><span style="font-size:var(--fs-1);color:var(--grey)">how many</span><input data-cbsid="BUS004-I35" type="number" min="0" value="' +
        (item.count || '') +
        '" oninput="netCaSetIot(\'' +
        n.key +
        "'," +
        index +
        ',\'count\',this.value)" placeholder="1" style="width:46px;font-size:var(--fs-1);padding:4px 6px;border:1px solid var(--line);border-radius:6px"><span style="font-size:var(--fs-1);color:var(--grey)">devices</span><input data-cbsid="BUS004-I36" type="number" min="0" value="' +
        (item.devices || '') +
        '" oninput="netCaSetIot(\'' +
        n.key +
        "'," +
        index +
        ',\'devices\',this.value)" placeholder="0" style="width:54px;font-size:var(--fs-1);padding:4px 6px;border:1px solid var(--line);border-radius:6px"><span data-cbsid="BUS004-C42" onclick="netCaDelIot(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
      );
    })
    .join('');
  var iot =
    '<div style="padding:9px 0;border-bottom:1px solid var(--line)"><span style="font-size:var(--fs-2);font-weight:600;color:var(--ink-2)">' +
    tx('📡 IoT connections') +
    '</span>' +
    '<div style="margin-top:5px">' +
    iotRows +
    '<span data-cbsid="BUS004-C43" onclick="netCaAddIot(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600">＋ connection</span></div></div>';
  var erpRows = c.erp.connectors
    .map(function (e, index) {
      var opts = ERP_SYSTEMS.map(function (item) {
        return '<option value="' + item + '"' + (e.system === item ? ' selected' : '') + '>' + item + '</option>';
      }).join('');
      return (
        '<div style="display:flex;gap:6px;align-items:center;padding:3px 0"><select data-cbsid="BUS004-S14" onchange="netCaSetErp(\'' +
        n.key +
        "'," +
        index +
        ',\'system\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
        opts +
        '</select><input data-cbsid="BUS004-I37" value="' +
        esc(e.label || '') +
        '" oninput="netCaSetErp(\'' +
        n.key +
        "'," +
        index +
        ',\'label\',this.value)" placeholder="label (e.g. SAP-Prod)" style="flex:1;min-width:0;font-size:var(--fs-1);padding:4px 7px;border:1px solid var(--line);border-radius:6px"><span data-cbsid="BUS004-C44" onclick="netCaDelErp(\'' +
        n.key +
        "'," +
        index +
        ')" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 3px">×</span></div>'
      );
    })
    .join('');
  var erp =
    '<div style="padding:9px 0;border-bottom:1px solid var(--line)"><span style="font-size:var(--fs-2);font-weight:600;color:var(--ink-2)">' +
    tx('🔗 ERP connectors') +
    '</span>' +
    '<div style="margin-top:5px">' +
    erpRows +
    '<span data-cbsid="BUS004-C45" onclick="netCaAddErp(\'' +
    n.key +
    '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-1);font-weight:600">＋ connector</span></div></div>';
  var auOpts = AI_AUTONOMY.map(function (item) {
    return '<option value="' + item + '"' + (c.ai.autonomy === item ? ' selected' : '') + '>' + item + '</option>';
  }).join('');
  var ai =
    '<div style="padding:9px 0 2px">' +
    '<div style="display:flex;align-items:center;gap:8px"><span style="flex:1;font-size:var(--fs-2);font-weight:600;color:var(--ink-2)">' +
    tx('🤖 AI agents') +
    '</span>' +
    '<span style="font-size:var(--fs-1);color:var(--grey)">count</span><input data-cbsid="BUS004-I38" type="number" min="0" value="' +
    (c.ai.count || '') +
    '" oninput="netCaAiCount(\'' +
    n.key +
    '\',this.value)" placeholder="0" style="width:64px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2)"></div>' +
    '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap"><input data-cbsid="BUS004-I39" value="' +
    esc(c.ai.role || '') +
    '" oninput="netCaAiRole(\'' +
    n.key +
    '\',this.value)" placeholder="what it does" style="flex:1 0 110px;min-width:0;font-size:var(--fs-1);padding:4px 7px;border:1px solid var(--line);border-radius:6px"><span style="font-size:var(--fs-1);color:var(--grey)">autonomy</span><select data-cbsid="BUS004-S15" onchange="netCaAiAutonomy(\'' +
    n.key +
    '\',this.value)" style="font-size:var(--fs-1);padding:4px;border:1px solid var(--line);border-radius:6px">' +
    auOpts +
    '</select></div>' +
    '</div>';
  return (
    '<div style="padding:12px 13px;border:1px solid var(--line);border-inline-start:3px solid #8a5cc4;border-radius:9px;background:var(--blue-tint-bg);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue);letter-spacing:.05em">' +
    tx('🧑‍🤝‍🧑 CO-ASSISTS — under THIS branch') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px">Each is created under this node (login <b>key@branch</b>), not the network.</div>' +
    '<div style="margin-top:4px">' +
    human +
    iot +
    erp +
    ai +
    '</div>' +
    '</div>'
  );
}
function _radioOpt(onclick, on, label, hint, color, bg) {
  return (
    '<div data-cbsid="BUS004-C46" onclick="' +
    onclick +
    '" style="cursor:pointer;padding:8px 10px;border:1px solid ' +
    (on ? color : 'var(--line)') +
    ';border-radius:9px;background:' +
    (on ? bg : 'var(--card)') +
    ';margin-top:6px">' +
    '<b style="font-size:var(--fs-2);color:' +
    (on ? color : 'var(--ink-2)') +
    '">' +
    (on ? '● ' : '○ ') +
    label +
    '</b>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
    hint +
    '</div></div>'
  );
}
function _transactConfig(n) {
  var f = (n.transact || {}).flow || 'both';
  var copy = (n.transact || {}).copyOperator !== false;
  return (
    '<div style="padding:12px 13px;border:1px solid var(--line);border-inline-start:3px solid #2b6f8f;border-radius:9px;background:var(--card);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--on-card);letter-spacing:.05em">🔄 TRANSACT — does it deal directly with others?</div>' +
    _radioOpt(
      "netSetTransact('" + n.key + "','both')",
      f === 'both',
      'Sends and receives',
      'Talks to counterparties on its own — both directions.',
      'var(--blue-2)',
      'var(--blue-tint-bg)'
    ) +
    _radioOpt(
      "netSetTransact('" + n.key + "','send')",
      f === 'send',
      'Sends only',
      'Hands records out (to customers / downstream).',
      'var(--blue-2)',
      'var(--blue-tint-bg)'
    ) +
    _radioOpt(
      "netSetTransact('" + n.key + "','receive')",
      f === 'receive',
      'Receives only',
      'Takes records in (from suppliers / upstream).',
      'var(--blue-2)',
      'var(--blue-tint-bg)'
    ) +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em;margin-top:12px;border-top:1px solid var(--line);padding-top:9px">COPY THE OPERATOR (HQ)?</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">If yes, HQ keeps a copy of this node\'s transactions — this is what powers <b>traceability</b> + <b>' +
    tx('MIS') +
    '</b> across the network.</div>' +
    _radioOpt(
      "netSetTransactCopy('" + n.key + "',true)",
      copy,
      'Yes — copy HQ',
      "The operator sees this node's transactions.",
      'var(--blue-2)',
      'var(--blue-tint-bg)'
    ) +
    _radioOpt(
      "netSetTransactCopy('" + n.key + "',false)",
      !copy,
      'No — node only',
      'Only the counterparties hold copies; HQ does not see them.',
      'var(--blue-2)',
      'var(--blue-tint-bg)'
    ) +
    '</div>'
  );
}
function _tradereadyConfig(n) {
  var tr = n.tradeready || {};
  var mode = tr.mode || 'inherit';
  var certs = tr.certs || [];
  var certList =
    mode === 'own'
      ? '<div style="margin-top:8px">' +
        (certs.length
          ? certs
              .map(function (item, index) {
                return (
                  '<div style="display:flex;gap:6px;align-items:center;padding:3px 0"><input data-cbsid="BUS004-I40" value="' +
                  esc(item) +
                  '" oninput="netSetCert(\'' +
                  n.key +
                  "'," +
                  index +
                  ',this.value)" placeholder="certification (e.g. FSC, ISO 9001)" style="flex:1;font-size:var(--fs-2);padding:5px 7px;border:1px solid var(--line);border-radius:6px"><span data-cbsid="BUS004-C47" onclick="netDelCert(\'' +
                  n.key +
                  "'," +
                  index +
                  ')" title="remove" style="cursor:pointer;color:var(--grey);font-weight:700;padding:0 4px">×</span></div>'
                );
              })
              .join('')
          : '<div style="font-size:var(--fs-1);color:var(--grey)">No certifications yet.</div>') +
        '<div data-cbsid="BUS004-C48" onclick="netAddCert(\'' +
        n.key +
        '\')" style="cursor:pointer;color:var(--blue);font-size:var(--fs-2);font-weight:600;padding:5px 0">＋ add certification</div></div>'
      : '';
  return (
    '<div style="padding:12px 13px;border:1px solid var(--line);border-inline-start:3px solid #22857a;border-radius:9px;background:var(--ok-tint);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);letter-spacing:.05em">' +
    tx('🛡️ TRADE-READY — certifications') +
    '</div>' +
    _radioOpt(
      "netSetTradeMode('" + n.key + "','own')",
      mode === 'own',
      'Holds its own certifications',
      'This node carries its own clearances.',
      'var(--blue-2)',
      'var(--ok-tint)'
    ) +
    _radioOpt(
      "netSetTradeMode('" + n.key + "','inherit')",
      mode === 'inherit',
      "Inherits the network's",
      "The network's certifications apply here (cascaded).",
      'var(--blue-2)',
      'var(--ok-tint)'
    ) +
    certList +
    '</div>'
  );
}
function _disputeConfig(n) {
  var inf = (n.dispute || {}).informed !== false;
  return (
    '<div style="padding:12px 13px;border:1px solid var(--line);border-inline-start:3px solid #8a5cc4;border-radius:9px;background:var(--blue-tint-bg);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue);letter-spacing:.05em">⚖️ DISPUTE — is this node in the loop?</div>' +
    _radioOpt(
      "netSetDispute('" + n.key + "',true)",
      inf,
      'Informed / involved',
      'When a dispute touches this node, it is notified and can respond.',
      'var(--purple-2)',
      'var(--purple-tint)'
    ) +
    _radioOpt(
      "netSetDispute('" + n.key + "',false)",
      !inf,
      'Not involved',
      "Disputes are handled above it; this node isn't notified.",
      'var(--purple-2)',
      'var(--purple-tint)'
    ) +
    '</div>'
  );
}
/* ── THE SUPPLY-CHAIN PANELS ──────────────────────────────────────────────────────────────────────────────────
   Real forms now, writing into the design draft. Only PLACE is carried onto the store at Build (b119) — the other
   five are captured and clearly say so, because "we wrote down what you told us" and "the platform enforces this"
   are different promises and mixing them is how a governance screen becomes decoration. */

function _netPlace(n) {
  n.place = n.place || {};
  return n.place;
}
function netSetPlace(key, f, v) {
  var n = _netNode(key);
  if (!n) return;
  _netPlace(n)[f] = v;
  _netSave();
}
function netSetPlaceNum(key, f, v) {
  var n = _netNode(key);
  if (!n) return;
  var s = String(v == null ? '' : v).trim();
  _netPlace(n)[f] = s === '' ? null : isNaN(Number(s)) ? null : Number(s);
  _netSave();
}
function _inp(val, oninput, ph, extra) {
  return (
    '<input data-cbsid="BUS004-I41" value="' +
    esc(val == null ? '' : val) +
    '" oninput="' +
    oninput +
    '" placeholder="' +
    esc(ph || '') +
    '" style="width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:6px;font-size:var(--fs-2);box-sizing:border-box;' +
    (extra || '') +
    '">'
  );
}
function _fieldLabel(t) {
  return '<label style="font-size:var(--fs-1);font-weight:700;color:var(--grey);letter-spacing:.04em;display:block;margin:9px 0 3px">' + esc(t) + '</label>';
}

/**
 * 🌍 GLOBAL — the three things that differ because a store is somewhere ELSE: what it trades in, where it is, and
 * what time it is there.
 *
 * Currency and country are INHERITED from the network at Build unless set here. Left blank they stay blank, and
 * the store takes the network's — which is why the fields say "the network's X" as their placeholder rather than
 * pre-filling the value. A pre-filled inherited value looks like a decision somebody made about this store.
 */
function _globalConfig(n) {
  var p = _netPlace(n);
  var netCur = (typeof SESSION !== 'undefined' && SESSION.currency) || '—';
  var netCty = (typeof SESSION !== 'undefined' && SESSION.country) || '—';
  var inheritNote = function (own, netVal) {
    return own
      ? '<span style="font-size:var(--fs-1);font-weight:800;background:var(--ok-tint);color:var(--ok-2);border-radius:5px;padding:1px 6px">' +
          tx('SET HERE') +
          '</span>'
      : '<span style="font-size:var(--fs-1);font-weight:800;background:var(--blue-tint-bg);color:var(--ok-2);border-radius:5px;padding:1px 6px">FROM NETWORK · AT BUILD — ' +
          esc(netVal) +
          '</span>';
  };
  return (
    '<div style="padding:12px 13px;border:1px solid var(--line);border-inline-start:3px solid var(--blue-2);border-radius:9px;background:var(--blue-tint-bg);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em">' +
    tx('🌍 GLOBAL — CURRENCY · PLACE · TIME') +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px;line-height:1.5">The three things that change ' +
    "because this store is somewhere else. Leave a field blank and it takes the network's.</div>" +
    '<div style="display:flex;gap:8px">' +
    '<div style="flex:1">' +
    _fieldLabel('CURRENCY') +
    _inp(p.currency, "netSetPlace('" + n.key + "','currency',this.value.toUpperCase())", "the network's " + netCur) +
    '</div>' +
    '<div style="flex:1">' +
    _fieldLabel('COUNTRY') +
    _inp(p.country, "netSetPlace('" + n.key + "','country',this.value.toUpperCase())", "the network's " + netCty) +
    '</div>' +
    '</div>' +
    '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:6px">' +
    inheritNote(p.currency, netCur) +
    inheritNote(p.country, netCty) +
    '</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:6px;line-height:1.5">A price is <b>stamped</b> in this ' +
    "store's currency and never converted, so setting it here is a real decision — not a display preference.</div>" +
    _fieldLabel('TIME ZONE') +
    _inp(p.tz, "netSetPlace('" + n.key + "','tz',this.value)", 'Asia/Colombo — captured, not enforced yet') +
    '<div style="border-top:1px dashed var(--line);margin-top:13px;padding-top:4px"></div>' +
    _fieldLabel('ADDRESS') +
    _inp(p.address, "netSetPlace('" + n.key + "','address',this.value)", 'street · area') +
    // COUNTRY is set above with currency — it is an inherited-or-overridden value, not part of the address. Having
    // it in both places would be two controls for one field, which is how you set it once and find it changed.
    _fieldLabel('CITY') +
    _inp(p.city, "netSetPlace('" + n.key + "','city',this.value)", 'Coimbatore') +
    '<div style="display:flex;gap:8px">' +
    '<div style="flex:1">' +
    _fieldLabel('LATITUDE') +
    _inp(p.lat, "netSetPlaceNum('" + n.key + "','lat',this.value)", '11.0168') +
    '</div>' +
    '<div style="flex:1">' +
    _fieldLabel('LONGITUDE') +
    _inp(p.lng, "netSetPlaceNum('" + n.key + "','lng',this.value)", '76.9558') +
    '</div>' +
    '<div style="flex:1">' +
    _fieldLabel('SERVES (KM)') +
    _inp(p.km, "netSetPlaceNum('" + n.key + "','km',this.value)", '50') +
    '</div>' +
    '</div>' +
    (p.lat == null || p.lng == null
      ? '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:8px;line-height:1.5">⚠ Without latitude and longitude this store cannot answer "who is nearest" — the address alone is text.</div>'
      : '<div style="font-size:var(--fs-1);color:var(--ok-2);margin-top:8px">✓ Locatable' + (p.km ? ' · serves ' + esc(p.km) + ' km' : '') + '</div>') +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px;border-top:1px dashed var(--line);padding-top:7px">' +
    'Carried onto the store at <b>' +
    tx('Apply changes') +
    '</b>, like its visibility and wording.</div>' +
    '</div>'
  );
}

/**
 * 🚚 HOW FAST — the three numbers that turn "who has it" into "when can I have it".
 *
 * Athi, 2026-08-08: *"do the fulfilment routes so we get the days."*
 *
 * ⚠️ DECLARED, NEVER DERIVED. Days could be computed from distance, and that would produce a confident date for
 * every store including the ones nobody has asked. A plausible wrong date is worse than none — it gets promised to
 * a customer. Left blank, a store simply says "not declared", and the network search says so too.
 *
 * Two transit numbers rather than a per-pair matrix: a matrix is O(stores²) to maintain, nobody keeps it current,
 * and it decays into confident nonsense. Two bands a store actually knows are worth more than a matrix it doesn't.
 */
function _fulfilConfig(n) {
  var p = _netPlace(n);
  var km = p.km;
  var declared = p.dispatch !== undefined && p.dispatch !== null && p.dispatch !== '';
  return (
    '<div style="padding:12px 13px;border:1px solid var(--line);border-inline-start:3px solid #2b6f8f;border-radius:9px;background:var(--card);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--on-card);letter-spacing:.05em">🚚 HOW FAST THIS STORE CAN SEND</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px;line-height:1.5">Three numbers this store knows. ' +
    'They are what lets the network answer <b>when</b>, not just who and how far.</div>' +
    _fieldLabel('DAYS TO DISPATCH — order in, goods out') +
    _inp(p.dispatch, "netSetPlaceNum('" + n.key + "','dispatch',this.value)", '0 for same day') +
    _fieldLabel('DAYS IN TRANSIT — inside its service area' + (km ? ' (' + esc(km) + ' km)' : ' (set the radius on Global)')) +
    _inp(p.within, "netSetPlaceNum('" + n.key + "','within',this.value)", '1') +
    _fieldLabel('DAYS IN TRANSIT — beyond it') +
    _inp(p.beyond, "netSetPlaceNum('" + n.key + "','beyond',this.value)", '6 — usually a different lane, not a longer drive') +
    (declared
      ? '<div style="font-size:var(--fs-1);color:var(--ok-2);margin-top:9px">✓ The network can now say when this store could deliver.</div>'
      : '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:9px">⚠ Nothing declared, so a search shows this store ' +
        'as <b>no dispatch time declared</b> rather than guessing. That is deliberate — a made-up date gets promised ' +
        'to a customer.</div>') +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px;border-top:1px dashed var(--line);padding-top:7px">' +
    'Carried onto the store at <b>' +
    tx('Apply changes') +
    '</b>, like everything else here.</div>' +
    '</div>'
  );
}

/** The five that are CAPTURED but not yet carried. Real inputs, honest label. */
function _netSoonVal(n, k) {
  n.soon = n.soon || {};
  n.soon[k] = n.soon[k] || {};
  return n.soon[k];
}
function netSetSoon(key, cap, f, v) {
  var n = _netNode(key);
  if (!n) return;
  _netSoonVal(n, cap)[f] = v;
  _netSave();
}
var NET_SOON_FORM = {
  territory: [
    ['tier', 'TIER', 'distributor · dealer · sub-dealer · installer'],
    ['markets', 'AUTHORISED MARKETS', 'IN-TN, IN-KL, LK'],
    ['lines', 'PRODUCT LINES IT MAY CARRY', 'circulator pumps, booster sets'],
    ['exclusive', 'EXCLUSIVE OR SHARED', 'shared'],
    ['valid', 'VALID UNTIL', '2027-03-31']
  ],
  stock: [
    ['policy', 'STOCKING POLICY', 'stocking · non-stocking'],
    ['minmax', 'MIN / MAX PER ITEM', '5 / 40'],
    ['source', 'WHERE THE NUMBER COMES FROM', 'ERP sync · IoT · manual'],
    ['lead', 'REPLENISHMENT LEAD TIME (DAYS)', '9']
  ],
  fulfil: [
    ['routes', 'ROUTES IT CAN USE', 'own stock, lateral, regional warehouse, drop-ship'],
    ['transit', 'TRANSIT DAYS PER ROUTE', 'own 0 · lateral 1 · regional 4 · drop-ship 9'],
    ['invoices', 'WHO INVOICES THE CUSTOMER', 'this store'],
    ['incoterm', 'INCOTERM', 'DAP']
  ],
  pricepolicy: [
    ['basis', 'PRICE BASIS', 'source list · territory list · its own'],
    ['band', 'FLOOR / CEILING OR MARGIN BAND', '12% – 22%'],
    ['discount', 'WHO MAY DISCOUNT, AND HOW MUCH', 'branch manager, up to 5%'],
    ['tax', 'TAX TREATMENT', 'GST 18% inclusive']
  ],
  localise: [
    ['markets', 'DESTINATION MARKETS SERVED', 'IN, LK'],
    ['certs', 'REQUIRED CERTIFICATIONS', 'BIS, CE'],
    ['variants', 'VARIANTS', '230V/50Hz, BSP fittings'],
    ['docs', 'IMPORT DOCUMENTS', 'BIS licence, invoice, packing list'],
    ['warranty', 'WARRANTY TERMS HERE', '24 months']
  ]
};
function _soonConfig(n, k) {
  var s = NET_SOON[k],
    c = _capMeta(k) || {},
    form = NET_SOON_FORM[k] || [],
    v = _netSoonVal(n, k);
  if (!s) return '';
  return (
    '<div style="padding:12px 13px;border:1px solid var(--line);border-inline-start:3px solid #8a94a3;border-radius:9px;background:var(--card);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--on-card);letter-spacing:.05em">' +
    c.icon +
    ' ' +
    esc((c.label || '').toUpperCase()) +
    ' <span style="background:var(--blue-tint-bg);border-radius:5px;padding:1px 6px;margin-inline-start:5px;color:var(--on-card)">' +
    tx('CAPTURED, NOT ENFORCED') +
    '</span></div>' +
    '<div style="font-size:var(--fs-2);color:var(--ink-2);margin-top:6px;line-height:1.5"><b>' +
    esc(s.q) +
    '</b></div>' +
    form
      .map(function (item) {
        return _fieldLabel(item[1]) + _inp(v[item[0]], "netSetSoon('" + n.key + "','" + k + "','" + item[0] + "',this.value)", item[2]);
      })
      .join('') +
    '<div style="margin-top:11px;font-size:var(--fs-1);line-height:1.55;border-top:1px dashed var(--line);padding-top:8px">' +
    '<div><span style="color:var(--ok-2);font-weight:700">' +
    tx('Have') +
    '</span> <span style="color:var(--grey)">' +
    esc(s.have) +
    '</span></div>' +
    '<div style="margin-top:3px"><span style="color:var(--disp-2);font-weight:700">' +
    tx('Need') +
    '</span> <span style="color:var(--grey)">' +
    esc(s.need) +
    '</span></div>' +
    '<div style="margin-top:6px;color:var(--warn-2)">⚠ Written down on the design. <b>The platform does not enforce any of it yet</b> — ' +
    'it is not carried to the store and nothing checks it.</div></div></div>'
  );
}

function _capDetail(n, k) {
  if (k === 'place') return _globalConfig(n);
  if (k === 'fulfil') return _fulfilConfig(n);
  if (NET_SOON[k]) return _soonConfig(n, k);
  if (k === 'catalogue') return _catConfig(n);
  if (k === 'storefront') return _storefrontConfig(n);
  if (k === 'coassist') return _coassistConfig(n);
  if (k === 'transact') return _transactConfig(n);
  if (k === 'tradeready') return _tradereadyConfig(n);
  if (k === 'dispute') return _disputeConfig(n);
  var c = _capMeta(k) || {};
  return (
    '<div style="padding:12px 14px;border:1px dashed var(--line-strong,#c8d0d9);border-radius:9px;background:var(--card);font-size:var(--fs-2);color:var(--grey)">' +
    c.icon +
    ' <b>' +
    esc(c.label) +
    '</b> — no settings.</div>'
  );
}
/* ── THE NAME EVERY STORE WILL CARRY ──────────────────────────────────────────────────────────────────────────
   Athi, 2026-08-07: *"the right-hand side has to show the name of the store is alpha timers.north, so it is clear
   that the network name is always prefixed in each store."*

   ⚠️ THIS IS A PREVIEW, NOT THE DECISION. The authoritative handle is composed by lib/handle.js on the server at
   Build, from the operator's real user_id. These rules are kept identical to it deliberately — but if they ever
   drift, the SERVER wins and the confirm screen (netMint) shows the real handles before anything is created.
   That is why the preview is allowed to exist at all: nothing is created from it.                             */
function _netSlug(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/['’]/g, '') // "Men's" → mens, not men-s
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}
/* The network's own name. Prefers what the server said (after a Build, or once /me has been read), and only then
   falls back to slugging the display name — which is exactly what the server would do if no user_id is set. */
function _netRootHandle() {
  if (UI.net && UI.net.root_handle) return UI.net.root_handle;
  if (UI._netRootHandle) return UI._netRootHandle;
  if (!UI._netRootAsked && _netLoggedIn()) {
    UI._netRootAsked = true; // once per session; a failed read simply keeps the fallback
    /* ⭐ meNow() — UI._netRootAsked was the third private ask-once latch for one endpoint. */
    try {
      meNow()
        .then(function (reply) {
          var e = (reply && (reply.entity || reply)) || {};
          var h = e.user_id || e.handle;
          // The NETWORK's own visibility, which caps every store under it (see netMaxExposure).
          UI._netOwnVis = String(e.catalogue_visibility || '').toLowerCase() || null;
          if (h) UI._netRootHandle = String(h).toLowerCase();
          _netRerender();
        })
        .catch(function () {});
    } catch (e) { /* best effort: failing here changes nothing the user sees */ }
  }
  return _netSlug((typeof SESSION !== 'undefined' && SESSION.entity) || '') || 'your-network';
}
/* Is the network name a real, saved User ID — or a guess we made from the display name?
   Athi, 2026-08-07: *"why alpha-timers when the user id is alpha timers?"* Because "alpha timers" is the DISPLAY
   NAME, a handle cannot contain a space, and nobody had ever been asked to choose. Deriving it silently is the
   problem; this makes the difference visible and the choice available. */
function _netRootIsSet() {
  return !!((UI.net && UI.net.root_handle) || UI._netRootHandle);
}

/* Choose the network name. Every store is prefixed with it, so it is the most consequential name on the page. */
function netSetNetworkName() {
  var cur = _netRootHandle();
  promptAsk(
    'The network name',
    {
      label: 'Network name',
      value: cur,
      okLabel: 'Save',
      maxlength: 60,
      hint:
        'Every store is prefixed with it — <b>' +
        esc(cur) +
        '.north</b>, <b>' +
        esc(cur) +
        '.south</b>.<br>' +
        'It is also your own <b>' +
        tx('User ID') +
        '</b>, so people can use it to add you as a supplier.<br>' +
        'Letters, numbers and dashes only — no spaces.'
    },
    function (want) {
      _netSaveNetworkName(want);
    }
  );
}
function _netSaveNetworkName(want) {
  var s = String(want).trim().toLowerCase();
  if (!s) return;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s) || /-$/.test(s)) {
    if (typeof toast === 'function') toast('Letters, numbers and dashes only — no spaces. Try "' + _netSlug(s) + '".', true);
    return;
  }
  api('saveProfile', { body: { user_id: s } })
    .then(function () {
      UI._netRootHandle = s;
      if (typeof toast === 'function') toast('Network name set to ' + s);
      _netRerender();
    })
    .catch(function (e) {
      // The server owns uniqueness and the platform's own User ID rules; it says which one was broken.
      if (typeof toast === 'function') toast((e && e.message) || 'Could not set that name', true);
    });
}

/* The full handle a node will be given: <network>.<store>, always exactly two levels however deep it sits. */
function _netHandleOf(n) {
  if (n && n.built && n.built.user_id) return n.built.user_id;
  if (!n || n.root || !n.owned) return '';
  var s = _netSlug(n.name);
  return s ? _netRootHandle() + '.' + s : '';
}

/* The visibility of ONE store, on the node itself — the only thing a network has to decide about a member.
   `private` is the default and the absence of a choice, never a value you have to pick to be safe. */
var NET_EXPOSURE = [
  { k: 'public', label: '🌐 Public', hint: 'Anyone with the link, and it appears on the network storefront.' },
  { k: 'protected', label: '🔒 Network only', hint: 'The other stores in this network — the warehouse case. Not the public.' },
  { k: 'private', label: '— Private', hint: 'Nobody but this store. Nothing is published.' }
];
/* The tree's one-word visibility badge. Private is deliberately the QUIETEST of the three — it is the default and
   the safe state, so it should not shout; Public is the one worth noticing. */
var NET_VIS_CHIP = {
  'public': { t: 'Public', fg: 'var(--ok-2)', bg: 'var(--ok-tint)' },
  'protected': { t: 'Network', fg: 'var(--warn-2)', bg: 'var(--warn-tint)' },
  'private': { t: 'Private', fg: 'var(--blue-2)', bg: 'var(--blue-tint-bg)' }
};
/** design word → the platform's word, so a receipt written by the server can be compared with a drawing. */
var NET_PLATFORM = { public: 'public', protected: 'network', private: 'private' };

/* ── WHAT IS PENDING COMES FROM THE SERVER, NOT FROM A GUESS ──────────────────────────────────────────────────
   Athi, 2026-08-08: *"I added another store called North-1 as public but I have not applied changes, and this is
   now visible in the map — people assume it got created. Any changes whatsoever being mentioned to be highlighted
   separately."*

   The map draws the DESIGN, so a node appears the moment it is drawn. Nothing distinguished "drawn" from "live",
   and the tree is the first thing anyone reads.

   The answer is the dry run: the same endpoint Build uses, with dry_run:true, returning exactly what WOULD happen.
   Using the server's own plan rather than inferring it client-side means the badges cannot disagree with what
   pressing the button will do — and it covers stores built before receipts carried their visibility, which no
   amount of local comparison could. It saves first, because the plan is computed from the SAVED design. */
function _netPlanSig() {
  return JSON.stringify(
    ((UI.net && UI.net.nodes) || []).map(function (item) {
      return [item.key, item.name, item.exposure || '', item.parent_key || '', item.owned !== false, item.partner_ref || '', !!item.built];
    })
  );
}
function _netRefreshPlan() {
  if (!_netLoggedIn() || !UI.net || UI._netPlanBusy) return;
  var sig = _netPlanSig();
  if (sig === UI._netPlanSig) return; // nothing moved — do not re-ask
  UI._netPlanBusy = true;
  UI._netPlanSig = sig;
  api('netDesignPut', { body: { draft: _netStripView(UI.net) } })
    .then(function () {
      _netSetDirty(false);
      return api('netBuild', { body: { dry_run: true } });
    })
    .then(function (reply) {
      UI._netPlanBusy = false;
      UI._netPlan = reply || null;
      // Repaint ONLY the left column. Rebuilding the whole shell for this is what made the page flash after every
      // edit; nothing outside this column depends on the plan.
      var el = typeof document !== 'undefined' ? document.getElementById('netLeftPane') : null;
      if (el) {
        var top = el.scrollTop;
        el.innerHTML = _netLeftPane();
        el.scrollTop = top;
      } else _netRerender(); // not on the design screen — fall back rather than silently skip
    })
    // Clear the signature on failure so the next render tries again. Latching it would leave the badges silently
    // stale after one hiccup — and a stale "nothing outstanding" is the exact lie this whole thing exists to stop.
    .catch(function () {
      UI._netPlanBusy = false;
      UI._netPlan = null;
      UI._netPlanSig = null;
    });
}
/** This node's row in the server's plan: to be created, or about to change. */
function _netPlanFor(n) {
  var p = UI._netPlan;
  if (!p || !n) return null;
  var c = (p.create || []).filter(function (x) {
    return x.key === n.key;
  })[0];
  if (c) return { kind: 'create', to: c.visibility, asked: c.asked };
  var u = (p.update || []).filter(function (x) {
    return x.key === n.key;
  })[0];
  if (u) return { kind: 'change', from: u.from, to: u.to };
  return null;
}
/** Has this store's drawing moved away from what the live shop is set to? Server plan first, receipt as fallback. */
function _netPending(n) {
  var pl = _netPlanFor(n);
  // A node can be outstanding for its VISIBILITY, its PURPOSE, or both. Only a visibility move renders as a
  // struck-through chip; a purpose-only change gets its own quieter marker (the chip would otherwise read
  // "undefined → undefined", which is how a display bug becomes a trust problem).
  if (pl && pl.kind === 'change' && pl.from) return { from: pl.from, to: pl.to };
  if (pl && pl.kind === 'change') return null;
  if (UI._netPlan) return null; // the server has spoken; do not second-guess it
  if (!n || !n.built || !n.built.visibility) return null;
  var want = NET_PLATFORM[n.exposure || 'private'] || 'private';
  return n.built.visibility === want ? null : { from: n.built.visibility, to: want };
}
var _netLab = function (k) {
  return (
    (
      NET_EXPOSURE.filter(function (item) {
        return item.k === k;
      })[0] || {}
    ).label || k
  ).replace(/^\S+\s/, '');
};
var _netPlatLab = { public: 'Public', network: 'Network', private: 'Private' };

/**
 * The chip beside a store in the tree — and the whole point of it is that a store which is NOT LIVE must never
 * look like one that is.
 *
 *     Public                       live, and set to public
 *     TO BE CREATED  Public        drawn, does not exist yet
 *     Public → Network             live, but the drawing has moved and Apply has not run
 */
function _netVisChip(n) {
  var pl = _netPlanFor(n);
  if (pl && pl.kind === 'create') {
    return (
      '<span style="font-size:var(--fs-1);font-weight:800;letter-spacing:.02em;color:var(--blue-2);background:var(--blue-tint-bg);' +
      'border:1px dashed var(--blue-2);border-radius:5px;padding:0 5px;margin-inline-start:6px;vertical-align:middle">' +
      tx('TO BE CREATED') +
      '</span>' +
      '<span style="font-size:var(--fs-1);font-weight:700;color:var(--grey-3);margin-inline-start:5px">' +
      esc(_netPlatLab[pl.to] || pl.to) +
      '</span>'
    );
  }
  var p = _netPending(n);
  if (p) {
    // The change, IN the map, exactly as it will be applied — struck through so it reads as a move, not a state.
    return (
      '<span style="font-size:var(--fs-1);font-weight:800;margin-inline-start:6px;vertical-align:middle">' +
      '<s style="color:var(--disp-2)">' +
      esc(_netPlatLab[p.from] || p.from) +
      '</s>' +
      ' <span style="color:var(--warn-2)"><span class=arw>→</span> ' +
      esc(_netPlatLab[p.to] || p.to) +
      '</span></span>'
    );
  }
  var c = NET_VIS_CHIP[n.exposure || 'private'] || NET_VIS_CHIP.private;
  return (
    '<span style="font-size:var(--fs-1);font-weight:800;letter-spacing:.02em;color:' +
    c.fg +
    ';background:' +
    c.bg +
    ';border-radius:5px;padding:1px 5px;margin-inline-start:6px;vertical-align:middle">' +
    c.t +
    '</span>' +
    // The purpose moved but the visibility did not — still outstanding, still has to say so.
    (pl && pl.kind === 'change'
      ? '<span title="the wording on the store has not been updated yet" style="font-size:var(--fs-1);font-weight:800;color:var(--warn-2);background:var(--warn-tint);border-radius:5px;padding:1px 5px;margin-inline-start:4px;vertical-align:middle">' +
        tx('TEXT EDITED') +
        '</span>'
      : '')
  );
}

/* The most open a store may be, given the NETWORK's own visibility. Athi: *"what if the network is private? Then
   each store can have only network or private options."* A private network cannot front a public shop.
   Mirrors the cascade the build enforces; the server remains the authority and refuses regardless. */
function netMaxExposure() {
  var v = UI._netOwnVis;
  return v === 'private' || v === 'network' ? 'protected' : 'public';
}
/* The ceiling for ONE node: the narrowest of the network's own setting and every ancestor's effective visibility.
   Athi, 2026-08-08: *"make the cascade for parent and child."* A store can be no more open than what it sits
   inside, at every level — not just under the root. Mirrors lib/network-build.js; the server stays the authority. */
var NET_RANK = { private: 0, protected: 1, public: 2 };
function _netCeilingFor(n) {
  var ceil = netMaxExposure();
  var seen = 0;
  var p = n && n.parent_key ? _netNode(n.parent_key) : null;
  while (p && !p.root && seen++ < 20) {
    // seen: a malformed draft must not spin
    var pv = p.exposure || 'private';
    if (NET_RANK[pv] < NET_RANK[ceil]) ceil = pv;
    p = p.parent_key ? _netNode(p.parent_key) : null;
  }
  return ceil;
}
/* ── THE FIRST QUESTION ───────────────────────────────────────────────────────────────────────────────────────
   Athi, 2026-08-07: *"when someone tries to set up the network, the first question needs to be: is it a private
   network or a public network where any of the stores should be visible outside and face the customer — so the
   initial hurdle can be crossed."*

   Right, and it was the missing step. The NETWORK's own visibility caps every store under it, and it defaults to
   private — so a person could mark a store Public, press Build, and get a network-only store with a note
   explaining why. Asked here, once, before any of that. */
function netSetNetworkVisibility(v) {
  // Athi: *"even if they select public initially and then change to protected, need to switch accordingly."*
  // Closing the network must bring the DESIGN down with it, or the drawing keeps claiming public stores that can
  // never be built and every future Build re-reports the same refusals.
  // The whole tree narrowed to the network's new ceiling — computed, not applied, so it can be SHOWN first.
  var changes = v === 'public' ? [] : _netPlanNarrow(null, 'protected');
  var go = function () {
    api('saveProfile', { body: { catalogue_visibility: v } })
      .then(function () {
        UI._netOwnVis = v;
        if (changes.length) {
          changes.forEach(function (item) {
            var t = _netNode(item.key);
            if (t) t.exposure = item.to;
          });
          _netSave();
        }
        if (typeof toast === 'function') toast(v === 'public' ? 'This network can face customers' : 'This network is closed to the public');
        _netRerender();
      })
      .catch(function (e) {
        if (typeof toast === 'function') toast((e && e.message) || 'Could not change that', true);
      });
  };
  if (!changes.length) return go();
  _netConfirmNarrow(
    'Close this network?',
    'A private network cannot put any store in front of customers, so these move to <b>' + tx('Network only') + '</b>.',
    changes,
    go
  );
}
function _netNetworkVisibilityBlock() {
  var v = UI._netOwnVis;
  var unanswered = !v; // /me not read yet, or genuinely never set
  var isPublic = v === 'public';
  var btn = function (val, label, hint) {
    var on = v === val;
    return (
      '<div data-cbsid="BUS004-C49" onclick="netSetNetworkVisibility(\'' +
      val +
      '\')" style="cursor:pointer;flex:1;min-width:190px;padding:10px 12px;border:1px solid ' +
      (on ? 'var(--blue-2)' : 'var(--line)') +
      ';border-radius:9px;background:' +
      (on ? 'var(--blue-tint-bg)' : 'var(--card)') +
      ';color:' +
      (on ? 'var(--on-card)' : 'var(--on-card)') +
      '">' +
      '<b style="font-size:var(--fs-2);color:' +
      (on ? 'var(--blue-2)' : 'var(--ink-2)') +
      '">' +
      (on ? '● ' : '○ ') +
      label +
      '</b>' +
      '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:3px;line-height:1.5">' +
      hint +
      '</div></div>'
    );
  };
  return (
    '<div style="margin-top:16px;padding:13px 15px;border:1px solid ' +
    (unanswered ? 'var(--warn-tint)' : 'var(--blue-tint-bg)') +
    ';border-radius:12px;background:' +
    (unanswered ? 'var(--warn-tint)' : 'var(--blue-tint-bg)') +
    ';color:' +
    (unanswered ? 'var(--on-card)' : 'var(--on-card)') +
    '">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:' +
    (unanswered ? 'var(--warn-2)' : 'var(--blue-2)') +
    ';letter-spacing:.05em">IS THIS NETWORK PUBLIC OR PRIVATE?</div>' +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px;line-height:1.55">Answer this first — it decides what every store below is allowed to be.</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">' +
    btn(
      'public',
      '🌐 Public network',
      'Stores under it <b>can face customers</b>. Each store still chooses its own visibility — public, network-only, or private.'
    ) +
    btn('private', '🔒 Private network', 'Nothing here faces the public. Stores can be seen by <b>the network</b> or by <b>nobody</b>.') +
    '</div>' +
    (isPublic
      ? ''
      : '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:8px;line-height:1.5">While this is private, Public is unavailable on every store below.</div>') +
    '</div>'
  );
}

function _netVisibilityBlock(n) {
  var cur = n.exposure || 'private';
  var maxOpen = _netCeilingFor(n); // the network AND every department above this one
  var byParent = maxOpen !== netMaxExposure();
  var allowed = maxOpen === 'public' ? ['public', 'protected', 'private'] : maxOpen === 'protected' ? ['protected', 'private'] : ['private'];
  // A choice already made but no longer permitted must still be VISIBLE, or the screen would quietly show
  // "Private" for a store the operator had set to public and never say why it moved.
  var stale = allowed.indexOf(cur) < 0;
  return (
    '<div style="margin-top:16px;padding:13px 15px;border:1px solid #b9cbe4;border-radius:12px;background:var(--blue-tint-bg);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);letter-spacing:.05em">WHO CAN SEE THIS STORE\'S CATALOGUE</div>' +
    '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px">' +
    NET_EXPOSURE.filter(function (item) {
      return allowed.indexOf(item.k) >= 0 || item.k === cur;
    })
      .map(function (item) {
        var on = cur === item.k;
        var off = allowed.indexOf(item.k) < 0;
        if (off)
          return (
            '<button data-cbsid="BUS004-B09" disabled title="Not available while the network is not public" style="padding:7px 13px;border-radius:9px;font-size:var(--fs-2);border:1px dashed var(--line);background:var(--card);color:var(--on-card);cursor:not-allowed">' +
            item.label +
            '</button>'
          );
        return (
          '<button data-cbsid="BUS004-B10" onclick="netSetExposure(\'' +
          n.key +
          "','" +
          item.k +
          '\')" style="padding:7px 13px;border-radius:9px;font-size:var(--fs-2);font-weight:' +
          (on ? '700' : '500') +
          ';border:1px solid ' +
          (on ? 'var(--blue-2)' : 'var(--line)') +
          ';background:' +
          (on ? 'var(--blue-2)' : 'var(--card)') +
          ';color:' +
          (on ? 'var(--on-accent)' : 'var(--ink-2)') +
          '">' +
          item.label +
          '</button>'
        );
      })
      .join('') +
    '</div>' +
    (maxOpen !== 'public'
      ? '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:8px;line-height:1.55">🔒 ' +
        (byParent
          ? '<b>' +
            esc((_netNode(n.parent_key) || {}).name || 'The department above') +
            '</b> is ' +
            esc(
              (
                NET_EXPOSURE.filter(function (item) {
                  return item.k === maxOpen;
                })[0] || {}
              ).label || maxOpen
            ).replace(/^[^ ]+ /, '') +
            ', so this store cannot be more open than that. Move it under the network itself if it should face customers.'
          : '<b>This network is ' +
            esc(UI._netOwnVis === 'network' ? 'network-only' : 'private') +
            '</b>, so a store under it can be seen by the network or by nobody — not by the public. Open the network itself first if you want public shops.') +
        (stale
          ? ' <b>“' +
            esc(
              (
                NET_EXPOSURE.filter(function (item) {
                  return item.k === cur;
                })[0] || {}
              ).label || cur
            ) +
            '” is no longer available</b> and will be built as Network only.'
          : '') +
        '</div>'
      : '') +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:8px;line-height:1.55">' +
    esc(
      (
        NET_EXPOSURE.filter(function (item) {
          return item.k === cur;
        })[0] || {}
      ).hint || ''
    ) +
    '</div>' +
    (n.built
      ? '<div style="font-size:var(--fs-1);color:var(--warn-2);margin-top:7px;line-height:1.5">⚠ Already built — changing this here updates the design, not the live store. Change it from the store\'s own Settings, within what you allowed it.</div>'
      : '') +
    '</div>'
  );
}

function _netNodeView(n) {
  var isRoot = !n.parent_key;
  var childCount = (UI.net.nodes || []).filter(function (x) {
    return x.parent_key === n.key;
  }).length;
  var badge = isRoot
    ? '<span style="font-size:var(--fs-1);font-weight:800;color:var(--blue-2);background:var(--blue-tint-bg);border-radius:6px;padding:2px 7px;margin-inline-start:9px;vertical-align:middle">' +
      tx('TOP · YOUR ENTITY') +
      '</span>'
    : n.owned
      ? '<span style="font-size:var(--fs-1);font-weight:800;color:var(--ok-2);background:var(--ok-tint);border-radius:6px;padding:2px 7px;margin-inline-start:9px;vertical-align:middle">' +
        tx('OWNED') +
        '</span>'
      : '<span style="font-size:var(--fs-1);font-weight:800;color:var(--warn-2);background:var(--warn-tint);border-radius:6px;padding:2px 7px;margin-inline-start:9px;vertical-align:middle">' +
        tx('🤝 PARTNER') +
        '</span>';
  var kindLine = isRoot
    ? 'The top of the network — your own entity.'
    : n.owned
      ? 'An owned node — at Build it becomes a real entity with a login key <b>you hold</b>.'
      : "An independent business — at Build it's a <b>handshake</b> (no key held). Its catalogue is visible here.";
  return (
    '<div style="padding:16px 20px;max-width:560px">' +
    '<div style="font-size:var(--fs-4);font-weight:800">' +
    (isRoot ? '◆ ' : '') +
    esc(n.name) +
    badge +
    '</div>' +
    // The handle, directly under the name: the network prefix is not a detail, it IS the store's identity on the
    // platform, and it is what gets typed into "add a supplier" or a login box.
    (_netHandleOf(n)
      ? '<div style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-2);color:var(--blue-2);margin-top:3px">' +
        esc(_netHandleOf(n)) +
        (n.built
          ? ''
          : '<span style="font-family:inherit;font-size:var(--fs-1);color:var(--grey);margin-inline-start:7px">— the name it will be given</span>') +
        '</div>'
      : '') +
    // The network name, said out loud and CHANGEABLE. It is the most consequential name on the page — every store
    // carries it — and it used to be derived from the display name without anyone being asked.
    (isRoot
      ? '<div style="margin-top:5px;display:flex;align-items:center;gap:9px;flex-wrap:wrap">' +
        '<span style="font-family:ui-monospace,Menlo,monospace;font-size:var(--fs-3);font-weight:700;color:var(--blue-2)">' +
        esc(_netRootHandle()) +
        '</span>' +
        '<button data-cbsid="BUS004-B11" onclick="netSetNetworkName()" style="padding:3px 10px;font-size:var(--fs-1)">' +
        tx('Change') +
        '</button>' +
        '</div>' +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px;line-height:1.55">' +
        (_netRootIsSet()
          ? 'Your User ID. Every store is prefixed with it.'
          : /* ⚠️ "Suggested … not saved yet" was TRUE and still misread — Athi took the value for his User ID.
               The sentence buried the important word in the middle of an explanation about spaces. It now leads
               with what the thing IS NOT, and names the distinction: a name may repeat, a User ID may not. */
            '⚠️ <b>This is a suggestion, not your User ID.</b> Nothing is saved yet — it is a slug of your ' +
            '<b>business name</b>, and a name is not an identifier: names may repeat, User IDs may not. ' +
            'A handle cannot contain a space, so "' +
            esc((typeof SESSION !== 'undefined' && SESSION.entity) || '') +
            '" becomes "' +
            esc(_netRootHandle()) +
            '". Change it now if you want something else; after Build the stores keep the name they were given.') +
        '</div>'
      : '') +
    '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:2px">' +
    kindLine +
    ' · ' +
    childCount +
    ' child' +
    (childCount === 1 ? '' : 'ren') +
    '</div>' +
    /**
     * ── THE WHOLE PAGE IS TABBED, SETTINGS-STYLE ────────────────────────────────────────────────────────────
     * Athi, 2026-08-08: *"the tab I wanted was like in the Settings page. The first tab can be named General
     * which shows up to purpose, then the next tab could be Catalogue, then Storefront etc, so I can click on
     * the top and switch."*
     *
     * Everything that identifies the store — its name, handle and what kind of node it is — stays ABOVE the tabs,
     * because it is the title of the page rather than one of its subjects. Below the strip, one subject at a time.
     */
    _netTabStrip(n) +
    (_netTab() === 'general' ? _netGeneralTab(n) : _netTab() === 'visibility' ? _netVisibilityTab(n) : _netOptionsTab(n)) +
    '<div style="margin-top:16px;font-size:var(--fs-1);color:var(--grey);line-height:1.55">When the design is done, <b>' +
    tx('Build') +
    '</b> turns each owned node into a real entity + login key, and invites each partner by handshake. Until then this is just a plan — saved, nothing created.</div>' +
    '</div>'
  );
}

var NET_TABS = [
  { k: 'general', icon: '🌿', label: 'Hierarchy' },
  { k: 'visibility', icon: '🔒', label: 'Visibility' },
  { k: 'options', icon: '⚙️', label: 'Options' }
];
/**
 * Which tab is showing. `general` is the landing page — the thing you almost always came here to change.
 * ⚠️ A capability key may still arrive here: netCapYes() sets `tab` to the capability it just switched on, and
 * an older saved draft can carry one. Anything that is not one of the three lands on Options, which is where a
 * capability now lives — rather than showing a blank pane for a tab that no longer exists.
 */
function _netTab() {
  var t = (UI.net && UI.net.tab) || 'general';
  for (var index = 0; index < NET_TABS.length; index++) if (NET_TABS[index].k === t) return t;
  return 'options';
}
function netPickTab(t) {
  if (UI.net) UI.net.tab = t;
  _netRerender();
}

function _netTabStrip(n) {
  var cur = _netTab();
  /**
   * ⭐⭐ THREE TABS, NOT THIRTEEN (Athi, 2026-08-17: *"possibly we can have three tabs, one is for deciding the
   * hierarchy, second one is to set the public or private, third one is to choose the other options"* — then:
   * *"as a checkbox so only the required option can be chosen"*).
   *
   * ⚠️ THE OLD STRIP WAS General + EVERY CAPABILITY — thirteen tabs for one node. It made the twelve
   * capabilities look like twelve places to go, when eleven of them are usually OFF and the whole question is
   * "which of these does this store have?". A tab per capability answers that only by making you visit all
   * twelve and remember what you saw. A checklist answers it in one look, which is what Athi asked for.
   *
   * The three now match the three decisions actually being made about a node, in the order they are made:
   *   Hierarchy   — where it sits, and what hangs under it
   *   Visibility  — who can see it. The ONE decision a network has to get right
   *   Options     — which capabilities it holds, as ticks
   */
  var tabs = NET_TABS;
  /**
   * ⚠️ ONE ROW THAT SCROLLS, NOT A BLOCK THAT WRAPS — the same decision already taken for the category strip in
   * cart-ui, and taken there for the same reason. General plus every capability is a lot of tabs; wrapping turns
   * the strip into two or three rows of buttons that push the actual content down the page and change height
   * whenever the pane is resized, so the content jumps as you drag the divider. That is the "clumsy".
   *
   * A horizontal scroll costs one gesture when there are many tabs and costs nothing when there are few.
   * scroll-snap keeps a part-scrolled strip from resting mid-tab.
   */
  return (
    '<div style="display:flex;flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;' +
    'scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;' +
    'gap:6px;margin-top:16px;padding-bottom:12px;border-bottom:1px solid var(--line)">' +
    tabs
      .map(function (item) {
        var on = item.k === cur;
        var yes = item.k !== 'general' && (n.holds || []).indexOf(item.k) >= 0;
        return (
          '<span data-cbsid="BUS004-C50" onclick="netPickTab(\'' +
          item.k +
          '\')" style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;' +
          'flex:0 0 auto;scroll-snap-align:start;padding:8px 12px;border-radius:9px;font-size:var(--fs-2);white-space:nowrap;' +
          'background:' +
          (on ? 'var(--blue)' : 'transparent') +
          ';' +
          'border:1px solid ' +
          (on ? 'var(--blue)' : 'var(--line)') +
          ';' +
          'color:' +
          (on ? 'var(--on-accent)' : yes || item.k === 'general' ? 'var(--blue-2)' : 'var(--blue-2)') +
          ';' +
          'font-weight:' +
          (on ? '700' : '500') +
          '">' +
          '<span style="width:16px;text-align:center;font-size:var(--fs-3)">' +
          item.icon +
          '</span>' +
          esc(item.label) +
          (yes
            ? '<span title="on for this store" style="width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:' +
              (on ? 'rgba(255,255,255,.8)' : 'var(--ok-2)') +
              '"></span>'
            : '') +
          (item.soon
            ? '<span style="font-size:var(--fs-1);font-weight:800;opacity:.75;border:1px solid ' +
              (on ? 'rgba(255,255,255,.5)' : 'var(--line)') +
              ';border-radius:4px;padding:0 3px">' +
              tx('N/E') +
              '</span>'
            : '') +
          '</span>'
        );
      })
      .join('') +
    '</div>'
  );
}

/** GENERAL — who this store is and the decisions every store has: what it is for, and who may see it. */
function _netGeneralTab(n) {
  var isRoot = !n.parent_key;
  return (
    '<div style="padding-top:14px">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    '<button data-cbsid="BUS004-B12" class="pri" onclick="netAddChild(\'' +
    n.key +
    '\')" style="padding:8px 13px">＋ Add owned node</button>' +
    '<button data-cbsid="BUS004-B13" onclick="netAddPartner(\'' +
    n.key +
    '\')" style="padding:8px 13px">' +
    tx('🤝 Add partner') +
    '</button>' +
    (isRoot
      ? ''
      : '<button data-cbsid="BUS004-B14" onclick="netRename(\'' +
        n.key +
        '\')" style="padding:8px 13px">' +
        tx('✏️ Rename') +
        '</button><button data-cbsid="BUS004-B15" onclick="netDelete(\'' +
        n.key +
        '\')" style="padding:8px 13px">' +
        tx('🗑️ Remove') +
        '</button>' +
        // The arrangement everyone sees. Applied to the stores at the next Build, like every other change.
        '<span style="margin-inline-start:4px;display:inline-flex;gap:4px">' +
        '<button data-cbsid="BUS004-B16" onclick="netMove(\'' +
        n.key +
        '\',-1)" title="Move up among its siblings" style="padding:8px 11px">↑</button>' +
        '<button data-cbsid="BUS004-B17" onclick="netMove(\'' +
        n.key +
        '\',1)" title="Move down among its siblings" style="padding:8px 11px">↓</button></span>') +
    '</div>' +
    // A partner is INVITED, never created — so Build needs to know WHO. Without a handle here the node is
    // reported as un-buildable rather than guessed at, and this is where that gets fixed.
    (n.owned || isRoot
      ? ''
      : '<div style="margin-top:16px"><label style="font-size:var(--fs-1);font-weight:800;color:var(--grey);letter-spacing:.05em">' +
        tx('THEIR USER ID') +
        '</label>' +
        '<input data-cbsid="BUS004-I42" value="' +
        esc(n.partner_ref || '') +
        '" oninput="netSetPartnerRef(\'' +
        n.key +
        '\', this.value)" placeholder="e.g. ravi.timbers — ask them for it" style="width:100%;margin-top:6px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;font-size:var(--fs-2);box-sizing:border-box">' +
        '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:5px;line-height:1.5">Build sends them an invitation. <b>' +
        tx('They have to accept it') +
        '</b> — you cannot add another business to your network on your own.</div>' +
        (n.invited ? '<div style="font-size:var(--fs-1);color:var(--ok-2);margin-top:6px">✓ invited · ' + esc(n.invited.status || 'pending') + '</div>' : '') +
        '</div>') +
    (n.built
      ? '<div style="margin-top:16px;padding:11px 13px;border:1px solid #cfe0cf;border-radius:9px;background:var(--card);font-size:var(--fs-2);color:var(--ok-2);line-height:1.6">✓ <b>Built.</b> Signs in as <b style="font-family:ui-monospace,Menlo,monospace">' +
        esc(n.built.user_id) +
        '</b> · ' +
        esc(n.built.bridge_id) +
        '<br><button data-cbsid="BUS004-B18" onclick="netReissueKey(\'' +
        esc(n.built.user_id) +
        '\')" style="margin-top:7px;padding:5px 11px;font-size:var(--fs-1)">' +
        tx('Issue a new sign-in code') +
        '</button></div>'
      : '') +
    (isRoot
      ? ''
      : '<div style="margin-top:16px"><label style="font-size:var(--fs-1);font-weight:800;color:var(--grey);letter-spacing:.05em">' +
        tx('PURPOSE') +
        '</label>' +
        // oninput saves without re-rendering (typing must not fight the cursor); onchange fires on blur and
        // redraws, so the line the person just wrote appears under the store in the tree.
        '<input data-cbsid="BUS004-I43" value="' +
        esc(n.purpose || '') +
        '" oninput="netSetPurpose(\'' +
        n.key +
        '\', this.value)" onchange="_netRerender()" placeholder="what is this store for? one line — it shows under the name in the map" style="width:100%;margin-top:6px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;font-size:var(--fs-2);box-sizing:border-box"></div>') +
    // ── THE ONE DECISION ────────────────────────────────────────────────────────────────────────────────────
    // Athi, 2026-08-07: *"we keep the catalogue setting simple — here we have to decide only the visibility part
    // and nothing else."* Exposure used to live INSIDE the storefront capability panel, three clicks down, which
    // made the one thing a network actually has to decide the hardest thing on the screen to find.
    // The network's OWN answer sits on the root node — it is the first question, and it caps every store below.
    /* ⚠️ MOVED, NOT COPIED — these now render in the Visibility tab. Leaving them here as well would give the
       same control two homes that can disagree about which one you last used. */
    '</div>'
  );
}

/**
 * TAB 2 · WHO CAN SEE IT.
 * The network's own answer sits on the ROOT and caps every store below it, so the root shows the network
 * question and a child shows its own — never both, because only one of them is this node's to answer.
 */
function _netVisibilityTab(n) {
  var isRoot = !n.parent_key;
  return (
    '<div style="padding-top:14px">' +
    (isRoot ? _netNetworkVisibilityBlock() : !n.owned ? _netPartnerVisNote() : _netVisibilityBlock(n)) +
    (isRoot || !n.owned ? '' : _netInheritBlock(n)) +
    '</div>'
  );
}
/* A partner is not ours to expose — it decides its own. Said plainly rather than showing a disabled control. */
function _netPartnerVisNote() {
  return (
    '<div style="padding:13px 15px;border:1px solid var(--line);border-radius:12px;background:var(--neutral-tint);' +
    'color:var(--on-card);font-size:var(--fs-2);line-height:1.55">🤝 This is an independent business. ' +
    'It sets its own visibility — you are agreeing to trade with it, not hosting it.</div>'
  );
}

/**
 * TAB 3 · WHICH CAPABILITIES IT HOLDS — as ticks (Athi: *"as a checkbox so only the required option can be
 * chosen"*).
 *
 * ⚠️ THE TICKED ONE OPENS UNDERNEATH IT. A checklist that only sets flags would have hidden every capability's
 * settings, which is a worse screen than the thirteen tabs it replaced. Ticked ⇒ its panel is right there;
 * unticked ⇒ one line and nothing else. The list is the map and the detail, in the order you decided them.
 */
/**
 * Why a capability cannot be ticked on THIS node, in words, or '' if it can.
 *
 * ⚠️ DELIBERATELY NARROW. Only capabilities whose whole purpose is to be SEEN are gated: a storefront is a shop
 * window, and a shop window on a node nobody may look at is a contradiction rather than a configuration. The
 * others stay available even on a private node, because a private store still holds a catalogue, still trades,
 * still disputes — gating those would be tidiness dressed up as logic, and would block real setups.
 *
 * ⚠️ AND IT IS ABOUT EXPOSURE, NOT OWNERSHIP. A partner node is independent, so we do not gate it at all; it
 * answers this question for itself.
 */
var NET_NEEDS_EXPOSURE = { storefront: 1 };
function _netCapBlockedReason(n, capKey) {
  if (!NET_NEEDS_EXPOSURE[capKey]) return '';
  if (!n.owned || !n.parent_key) return ''; // partner, or the network root itself
  var vis = n.exposure || 'private';
  if (vis !== 'private') return '';
  return 'Not applicable while this store is private — a storefront needs someone who can see it.';
}

function _netOptionsTab(n) {
  var holds = n.holds || [];
  return (
    '<div style="padding-top:14px">' +
    '<div style="font-size:var(--fs-1);color:var(--grey);line-height:1.55;margin-bottom:10px">' +
    'Tick what this store does. Only the ticked ones are set up at Build.</div>' +
    NET_CAPS.map(function (item) {
      var on = holds.indexOf(item.k) >= 0;
      /**
       * ⚠️ PRIVATE RULES OPTIONS OUT (Athi: *"if it is private many capabilities are not applicable"*).
       * A storefront on a node nobody may see is not a setting, it is a contradiction — and offering it as a
       * tick invites someone to switch it on, see nothing happen, and conclude the feature is broken. The
       * reason is named, and it points at the tab that would change it, because "not applicable" without
       * "here is what to change" is just a locked door.
       */
      var blocked = _netCapBlockedReason(n, item.k);
      var q = String.fromCharCode(39); // a single quote — this string is already two levels of quoting deep
      var call = function (fn) {
        return fn + '(' + q + esc(n.key) + q + ',' + q + esc(item.k) + q + ')';
      };
      return (
        '<div style="border:1px solid ' +
        (on ? 'var(--blue)' : 'var(--line)') +
        ';border-radius:12px;' +
        'background:var(--card);color:var(--on-card);margin-bottom:8px;overflow:hidden' +
        (blocked ? ';opacity:.72' : '') +
        '">' +
        '<label style="display:flex;align-items:center;gap:10px;padding:11px 13px;' +
        (blocked ? 'cursor:not-allowed' : 'cursor:pointer') +
        '">' +
        '<input data-cbsid="BUS004-I44" type="checkbox" ' +
        (on ? 'checked ' : '') +
        (blocked ? 'disabled ' : '') +
        'data-testid="net-cap-' +
        esc(item.k) +
        '"' +
        ' onchange="this.checked?' +
        call('netCapYes') +
        ':' +
        call('netCapNo') +
        '">' +
        '<span style="width:18px;text-align:center;font-size:var(--fs-3)">' +
        item.icon +
        '</span>' +
        '<span style="font-size:var(--fs-3);font-weight:' +
        (on ? '700' : '500') +
        '">' +
        esc(item.label) +
        '</span>' +
        (item.soon
          ? '<span style="margin-inline-start:auto;font-size:var(--fs-1);font-weight:800;color:var(--warn-2);' +
            'background:var(--warn-tint);border-radius:5px;padding:1px 6px">not enabled</span>'
          : '') +
        '</label>' +
        (blocked
          ? '<div style="padding:0 13px 11px;font-size:var(--fs-1);color:var(--warn-2);line-height:1.55">' +
            esc(blocked) +
            ' <span data-cbsid="BUS004-C51" onclick="netPickTab(' +
            q +
            'visibility' +
            q +
            ')"' +
            ' style="cursor:pointer;color:var(--blue);font-weight:700">Change visibility <span class=arw>→</span></span></div>'
          : '') +
        (on && !blocked ? '<div style="border-top:1px solid var(--line);padding:2px 13px 12px">' + _capPanel(n, item.k) + '</div>' : '') +
        '</div>'
      );
    }).join('') +
    '</div>'
  );
}

/**
 * WHAT THIS STORE TAKES FROM THE NETWORK.
 *
 * Athi, 2026-08-08: *"how the settings of the root are to be transferred to the child nodes — currency, location,
 * trade-ready and so on."* Three kinds, and the difference between them is the design:
 *
 *   FROM NETWORK · AT BUILD   the network's value is stamped onto the store when it is created
 *   SET HERE                  this store overrode it, for that one field, and says so
 *   CAPPED BY NETWORK         a ceiling, not a default — narrower allowed, wider refused
 *
 * ⚠️ "AT BUILD" is doing real work in that label. These values are COPIED at the mint, not inherited live —
 * changing the network's currency afterwards does NOT move a store that already exists. Athi chose to show the
 * language now and build true inheritance later, so the label has to say which one it is. "FROM NETWORK" on its
 * own would read as "follows the network", and a person would then wonder why changing the top changed nothing.
 */
function _netInheritBlock(n) {
  var cur = (typeof SESSION !== 'undefined' && SESSION.currency) || '—';
  var cty = (typeof SESSION !== 'undefined' && SESSION.country) || '—';
  var chip = function (t, bg, fg) {
    return (
      '<span style="font-size:var(--fs-1);font-weight:800;letter-spacing:.03em;background:' +
      bg +
      ';color:' +
      fg +
      ';border-radius:5px;padding:1px 6px">' +
      t +
      '</span>'
    );
  };
  var row = function (label, value, note) {
    return (
      '<div style="padding:9px 0;border-bottom:1px solid var(--line)">' +
      '<div style="font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;color:var(--grey)">' +
      label +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:9px;margin-top:3px;flex-wrap:wrap"><span style="font-size:var(--fs-3)">' +
      esc(value) +
      '</span>' +
      chip('FROM NETWORK · AT BUILD', 'var(--blue-tint-bg)', 'var(--blue-2)') +
      '</div>' +
      (note ? '<div style="font-size:var(--fs-1);color:var(--grey);margin-top:4px;line-height:1.5">' + note + '</div>' : '') +
      '</div>'
    );
  };
  return (
    '<div style="margin-top:16px;padding:4px 15px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--on-card)">' +
    '<div style="font-size:var(--fs-1);font-weight:800;color:var(--grey);letter-spacing:.05em;padding:11px 0 0">' +
    tx('WHAT IT TAKES FROM THE NETWORK') +
    '</div>' +
    row('CURRENCY', cur, 'Stamped when the store is created, and never converted afterwards.') +
    row('COUNTRY', cty) +
    '<div style="padding:9px 0;border-bottom:1px solid var(--line)">' +
    '<div style="font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;color:var(--grey)">' +
    tx('CERTIFICATIONS') +
    '</div>' +
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-top:3px">Set on the <b>' +
    tx('Trade-ready') +
    "</b> tab — own, or the network's.</div></div>" +
    '<div style="padding:9px 0">' +
    '<div style="font-size:var(--fs-1);font-weight:700;letter-spacing:.04em;color:var(--grey)">' +
    tx('PLACE') +
    '</div>' +
    // The one that must NOT inherit, and it is worth saying why on the screen rather than only in a spec.
    '<div style="font-size:var(--fs-2);color:var(--grey);margin-top:3px">Never inherited — two stores are never in the ' +
    'same spot. Only the <b>country</b> comes down. Set it on the <b>' +
    tx('Place') +
    '</b> tab.</div></div>' +
    '<div style="font-size:var(--fs-1);color:var(--warn-2);padding:0 0 11px;line-height:1.5">⚠ These are <b>copied when the store is ' +
    'built</b>, not followed live. Changing the network afterwards does not move a store that already exists.</div>' +
    '</div>'
  );
}

/**
 * ONE capability, as a page. Off is its own screen with a single deliberate way in — a subject you have to turn on
 * should not be a checkbox brushed past on the way somewhere else.
 */
function _capPanel(n, k) {
  var c = _capMeta(k);
  if (!c) return '';
  var yes = (n.holds || []).indexOf(k) >= 0;
  if (!yes) {
    return (
      '<div style="padding:22px 2px">' +
      '<div style="font-size:var(--fs-3);font-weight:700">' +
      c.icon +
      ' ' +
      esc(c.label) +
      '</div>' +
      '<div style="font-size:var(--fs-2);color:var(--grey);margin-top:6px;line-height:1.6;max-width:460px">Not on for <b>' +
      esc(n.name) +
      '</b>.' +
      (NET_SOON[k] ? ' ' + esc(NET_SOON[k].q) : '') +
      '</div>' +
      '<button data-cbsid="BUS004-B19" class="pri" onclick="netCapYes(\'' +
      n.key +
      "','" +
      k +
      '\')" style="margin-top:13px;padding:9px 15px">' +
      tx('Turn on for this store') +
      '</button>' +
      '</div>'
    );
  }
  return (
    '<div style="padding-top:14px">' +
    '<div style="display:flex;align-items:center;gap:9px;margin-bottom:10px">' +
    '<span style="font-size:var(--fs-1);color:var(--grey);flex:1">' +
    esc(_capSummary(n, k)) +
    '</span>' +
    '<span data-cbsid="BUS004-C52" onclick="netCapNo(\'' +
    n.key +
    "','" +
    k +
    '\')" style="cursor:pointer;font-size:var(--fs-1);color:var(--blue)">turn off</span>' +
    '</div>' +
    _capDetail(n, k) +
    '</div>'
  );
}
