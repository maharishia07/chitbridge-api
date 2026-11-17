/**
 * books-clients-door.js — ACC-176b: THE FIRM'S FRONT DOOR on Home.
 *
 * OWNS      one card on Home, "Your clients · N · Open ›", for a login that holds live received books grants; it links to My network (the client list). Nothing is drawn for a login without a grant.
 * CALLED BY public/app.html (script tag, after books-grant-api.js)
 * FLOW      every second: a token not yet read → CBBooksGrantApi.held(call) → count; the Home shell present without the card → insert it before the areas (a login after page load, or a Home repaint, still gets it)
 * CARD      04-network/ACC-176B-ADVISER-REQUIREMENT
 *
 * Decides nothing: the count is the server's list of live grants (CBBooksGrantApi.held).
 */
(function (root) {
  'use strict';
  function words(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function base() {
    try {
      var f = root.localStorage.getItem('cb_api_base');
      if (f) return f === 'stage' ? root.CB_API || '' : f;
    } catch (failure) {
      root.console.warn('books-clients-door', failure);
      return '';
    }
    return /^(localhost|127\.0\.0\.1)$/.test(root.location.hostname) ? 'http://localhost:3000' : root.CB_API || '';
  }
  function token() {
    try {
      return (JSON.parse(root.localStorage.getItem('cb_sess') || 'null') || {}).token || null;
    } catch (failure) {
      root.console.warn('books-clients-door', failure);
      return null;
    }
  }
  /** a read the api turned away as busy (503 SERVER_BUSY, over its in-flight cap while Home loads) is asked again after its own Retry-After, up to 3 times: the card never vanishes for one shed answer (l16 home-fix) */
  function call(method, path, body, headers, left) {
    left = left === undefined ? 3 : left;
    return root.fetch(base() + path, { method: method, headers: { Authorization: 'Bearer ' + token() } }).then(function (r) {
      if (r.status === 503 && left > 0) {
        return new Promise(function (go) { root.setTimeout(go, (Math.min(10, Number(r.headers.get('Retry-After')) || 2)) * 1000); }).then(function () { return call(method, path, body, headers, left - 1); });
      }
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.message || 'API ' + r.status);
        return j;
      });
    });
  }
  function draw(count) {
    var areas = root.document.querySelector('[data-testid="shell-areas"]');
    if (!areas || root.document.getElementById('bcd_card')) return !!areas;
    var card = root.document.createElement('a');
    card.id = 'bcd_card';
    card.href = '/network.html';
    card.setAttribute('data-testid', 'home-your-clients');
    card.setAttribute('style', 'display:block;margin:0 0 16px;padding:14px 16px;border:1px solid var(--line,#DDD6C6);border-radius:10px;background:var(--card,#fff);color:inherit;text-decoration:none;font-weight:600');
    card.textContent = words('Your clients') + ' · ' + count + ' · ' + words('Open') + ' ›';
    areas.parentNode.insertBefore(card, areas);
    return true;
  }
  var seen = { token: null, count: 0 };
  /** one beat: a new sign-in reads the grants once; while the Home shell exists without the card (Home repaints, a sign-in after load) the card is drawn again */
  function tick() {
    var tokenNow = token();
    if (!tokenNow || !root.CBBooksGrantApi) return;
    if (seen.token !== tokenNow) {
      seen.token = tokenNow;
      seen.count = 0;
      /* l16 firmhome: the practice read comes first; a firm's Home draws the practice section, not this card, so the grants list is not asked for it (one call less per Home load) */
      var practice = new root.Promise(function (go) { root.setTimeout(go, 0); }).then(function () { return root.CBPractice && root.CBPractice.settled ? root.CBPractice.settled() : true; });
      practice.then(function () {
        if (root.CBPractice && root.CBPractice.hasData()) return;
        return root.CBBooksGrantApi.held(call).then(function (held) { seen.count = Object.keys(held).length; tick(); });
      }).catch(function (failure) { root.console.warn('books-clients-door', failure); });
    } else if (seen.count && !(root.CBPractice && root.CBPractice.hasData())) draw(seen.count); /* the practice section is the firm's front door once it has answered */
  }
  function start() {
    tick();
    if (!seen.timer) seen.timer = root.setInterval(tick, 1000);
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
  else start();
  root.CBBooksClientsDoor = { start: start };
})(typeof window !== 'undefined' ? window : globalThis);
