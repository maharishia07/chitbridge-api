/** · CARD 29-qa-test-tooling-ux-locale-and-design-system/editions
 * edition.js — CBEdition: WHICH DOORS THIS SHOWING OPENS (round AX1, 2026-10-13). The one helper Home, the shell's switcher and the small apps ask.
 *
 * OWNS      CBEdition: which entries an edition shows (key, use, load, list, info, shows, view, hidesHref); an edition hides, never grants
 * FLOW      page load -> use(manifest) or load() -> key() from ?edition, saved pref, full -> shows(id) filters the entries a page draws
 *
 * An EDITION is data, not a second Home: public/app/manifest.json › `editions` = { <key>: { name, chip, line, entries: '*' | [ids] } }.
 * 'full' is every entry. The auditor edition lists only what an auditor looks at. An id with no entry yet (the parallel-run compare before PR1) draws nothing.
 * ⭐ AN EDITION HIDES, IT NEVER GRANTS: no route reads it; the server still answers may/why on every page an edition leaves visible.
 *
 * WHICH EDITION: ?edition=<key> on the address (a showing link — held for THIS TAB only, sessionStorage, so it never overwrites the person's own choice)
 *   → the person's saved choice (CBAvatar's `edition` pref: cb_edition, synced with theme and text size in ui_prefs) → 'full'.
 *
 *   CBEdition.key()                 the active edition's key
 *   CBEdition.use(manifest)         hand over the manifest a page already fetched (the shell does) — never a second fetch
 *   CBEdition.load()                → Promise(manifest): the cached one, or one GET of /app/manifest.json
 *   CBEdition.list(m)               [{ key, name }] — the editions the avatar menu offers
 *   CBEdition.info(m)               the active edition's row ({ key, name, chip, line }), or null for 'full'
 *   CBEdition.shows(id, m)          is entry `id` in the active edition
 *   CBEdition.view(m)               a copy of the manifest with only the edition's entries (Home, the roadmap)
 *   CBEdition.hidesHref(href, m)    is this link a door into an off-edition entry (its page belongs ONLY to hidden entries)
 *   CBEdition.prune(el, m)          hide every such link under `el` (a page's nav, Home's alert rows); returns how many
 
 * CALLED BY public/app/avatar.js, public/app/rail-bell.js, public/app/shell.js, public/standards.html   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 * CARD      29-qa-test-tooling-ux-locale-and-design-system/editions
 */
(function (root) {
  'use strict';
  if (root.CBEdition) return;
  var TAB = 'cb_edition_tab',
    SAVED = 'cb_edition',
    SLUG = /^[a-z][a-z0-9-]{0,23}$/;
  var M = null,
    P = null;

  function ss(k, v) {
    try {
      if (v === undefined) return root.sessionStorage.getItem(k);
      if (v === null) root.sessionStorage.removeItem(k);
      else root.sessionStorage.setItem(k, v);
    } catch (_) { /* storage blocked or full: the page works without it */ }
    return null;
  }
  function ls(k) {
    try {
      return root.localStorage.getItem(k);
    } catch (_) {
      return null;
    }
  }

  /* a showing link: ?edition=auditor is held for this tab (every page it opens next keeps it) */
  (function fromUrl() {
    try {
      var q = new URLSearchParams(root.location.search).get('edition');
      if (q && SLUG.test(q)) ss(TAB, q);
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  })();

  function key() {
    var t = ss(TAB);
    if (t && SLUG.test(t)) return t;
    var s = (root.CBAvatar && root.CBAvatar.get && root.CBAvatar.get().edition) || ls(SAVED);
    return s && SLUG.test(s) ? s : 'full';
  }
  /** the person chose in the menu: the tab's showing link gives way to it */
  function clearTab() {
    ss(TAB, null);
  }

  function use(m) {
    if (m && m.entries) {
      M = m;
      P = Promise.resolve(m);
    }
    return M;
  }
  function load() {
    if (P) return P;
    P = root
      .fetch('/app/manifest.json')
      .then(function (reply) {
        if (!reply.ok) throw new Error('HTTP ' + reply.status);
        return reply.json();
      })
      .then(
        function (reply) {
          M = reply && reply.entries ? reply : null;
          return M;
        },
        function () {
          P = null;
          return null;
        }
      );
    return P;
  }
  function row(m, k) {
    var e = m && m.editions;
    return e && Object.prototype.hasOwnProperty.call(e, k) ? e[k] : null;
  }
  /** the active edition's id list, or null = every entry ('full', '*', or an edition the manifest does not know — never a blank Home) */
  function ids(m) {
    m = m || M;
    var r = row(m, key());
    return r && Array.isArray(r.entries) ? r.entries : null;
  }
  function list(m) {
    m = m || M;
    var e = (m && m.editions) || {};
    return Object.keys(e).map(function (item) {
      return { key: item, name: e[item].name || item };
    });
  }
  function info(m) {
    m = m || M;
    var k = key(),
      r = row(m, k);
    return r && Array.isArray(r.entries) ? { key: k, name: r.name || k, chip: r.chip || r.name || k, line: r.line || '' } : null;
  }
  function shows(id, m) {
    var l = ids(m);
    return !l || l.indexOf(id) >= 0;
  }
  function view(m) {
    m = m || M;
    if (!m) return m;
    var l = ids(m);
    if (!l) return m;
    var out = {};
    Object.keys(m).forEach(function (item) {
      out[item] = m[item];
    });
    out.entries = (m.entries || []).filter(function (e) {
      return e && l.indexOf(e.id) >= 0;
    });
    return out;
  }
  /* a page an entry opens: its route (or `via`), without the query and the shop placeholder */
  function pageOf(u) {
    return String(u || '')
      .split('#')[0]
      .split('?')[0];
  }
  function hidesHref(href, m) {
    m = m || M;
    var l = ids(m);
    if (!l || !href) return false;
    var p = pageOf(href);
    if (!p || p === '/') return false;
    var off = false,
      on = false;
    (m.entries || []).forEach(function (e) {
      [e.route, e.via].forEach(function (item) {
        if (item && pageOf(item) === p) {
          if (l.indexOf(e.id) >= 0) on = true;
          else off = true;
        }
      });
    });
    return off && !on;
  }
  function prune(el, m) {
    if (!el || !el.querySelectorAll) return 0;
    var index = 0;
    [].forEach.call(el.querySelectorAll('a[href],[data-href]'), function (node) {
      if (hidesHref(node.getAttribute('href') || node.getAttribute('data-href'), m)) {
        node.hidden = true;
        node.style.display = 'none';
        node.setAttribute('data-edition-hidden', '1');
        index++;
      }
    });
    return index;
  }

  root.CBEdition = { key: key, clearTab: clearTab, use: use, load: load, list: list, info: info, shows: shows, view: view, hidesHref: hidesHref, prune: prune };
})(typeof window !== 'undefined' ? window : this);
