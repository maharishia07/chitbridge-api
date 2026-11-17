/* app/page.js — CBPage: WHICH DETAIL PAGE OPENS A CHIT (N03, 2026-10-07 · decisions M-D6 / M-D7).
 *
 * Every chit names the page it was made with, on its header: business_json.page = `<kind>.<vertical>.<face>@<major.minor>`,
 * stamped once by the API at send (chitbridge-api lib/mint.js page()) and never changed. The registry of pages this install
 * has is /app/pages.json — one row per name@version, rows KEPT when a new version ships (minor = a compatible body change,
 * major = a header or action change). That file is the MASTER; the API keeps a byte copy (data/pages.json) to refuse an
 * unknown name at mint (PAGE_UNKNOWN).
 *
 *   CBPage.resolve(page)   page: 'name@v', or a chit's business_json, or nothing →
 *                          { page, script, installed, fallback, asked, note }
 *       · nothing          → the base page, no note (a chit made before N03 was made on the base page)
 *       · a registered row → that page
 *       · anything else    → the BASE page, fallback: true, note "made with X@v — page not installed". ⚠️ NEVER a refusal:
 *                            a chit always opens (M-D7); the note says what it was made with.
 *   CBPage.noteHTML(page)  the visible note, or '' when the page is installed
 *   CBPage.load()          reads /app/pages.json once (a cached promise). Until it arrives — or if it cannot be read — only
 *                          the base page is known, so anything else still opens on the base page with the note.
 *
 * A classic script with no imports: app.html and crm.html (the chit page, CRM2) load it eagerly; e2e/detail-page.cjs drives it in the real page.
 
 * CALLED BY public/app.html, public/app/attach-ui.js, public/app/cap-chit2.js, public/app/cap-crm.js, public/app/cap-testing.js (+2 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
 */
/*
 * OWNS      CBPage: which detail page opens a chit (business_json.page, the registry /app/pages.json)
 * CALLED BY <script src="/app/page.js"> at public/app.html:1581 and public/crm.html:379; used by public/app/cap-chit2.js:2177 and chit-sheet.js
 * CARD      01-rail-core-the-chit/send-mint-a-chit
 */
(function (root) {
  'use strict';
  var BUILTIN = {
    base: 'chit.base.detail@1.0',
    pages: [{ name: 'chit.base.detail', version: '1.0', script: 'crm.html' }]
  }; /* mirrors pages.json's base row: the chit page in CB CRM (CRM2) */
  var REG = null,
    LOADING = null;

  function reg() {
    return REG || BUILTIN;
  }
  function idOf(r) {
    return r.name + '@' + r.version;
  }
  function row(id) {
    var p = reg().pages;
    for (var index = 0; index < p.length; index++) if (idOf(p[index]) === id) return p[index];
    return null;
  }

  function load(url) {
    if (REG) return Promise.resolve(REG);
    if (LOADING) return LOADING;
    if (typeof fetch !== 'function') return Promise.resolve(null);
    LOADING = fetch(url || '/app/pages.json', { cache: 'no-cache' })
      .then(function (reply) {
        return reply.ok ? reply.json() : null;
      })
      .then(function (reply) {
        if (reply && Array.isArray(reply.pages) && reply.base) REG = reply;
        LOADING = null;
        return REG;
      })
      .catch(function () {
        LOADING = null;
        return null;
      });
    return LOADING;
  }

  function resolve(page) {
    var asked = page && typeof page === 'object' ? page.page : page;
    var base = reg().base,
      b = row(base) || { script: 'crm.html' };
    if (asked === undefined || asked === null || asked === '')
      return { page: base, script: b.script, installed: true, fallback: false, asked: null, note: null };
    asked = String(asked);
    var hit = row(asked);
    if (hit) return { page: asked, script: hit.script, installed: true, fallback: false, asked: asked, note: null };
    var t =
      typeof root.txf === 'function' ? root.txf('made with {page} — page not installed', { page: asked }) : 'made with ' + asked + ' — page not installed';
    return { page: base, script: b.script, installed: false, fallback: true, asked: asked, note: t };
  }

  function noteHTML(page) {
    var r = resolve(page);
    if (!r.fallback) return '';
    return (
      '<div class="pgnote" data-testid="page-note" role="note" data-page="' +
      esc(r.asked) +
      '"' +
      ' style="margin:6px 12px;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--neutral-tint,transparent);' +
      'color:var(--grey-2,inherit);font-size:var(--fs-1);overflow-wrap:anywhere">ℹ️ ' +
      esc(r.note) +
      '</div>'
    );
  }

  var api = {
    resolve: resolve,
    noteHTML: noteHTML,
    load: load,
    base: function () {
      return reg().base;
    }
  };
  root.CBPage = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') load(); /* fetch the registry early; openChit waits for it before it paints */
})(typeof window !== 'undefined' ? window : globalThis);
