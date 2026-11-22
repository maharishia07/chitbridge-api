/* signin-session.js — THE SESSION A SIGN-IN LEAVES: reading a verify answer into the apps' session, and keeping it.
 * OWNS      jwtClaims (the claims inside a token) · sessionOf (a verify answer → { token, role, name, entity, bridgeId, person, exp, device_id, surface, jti, duty }) ·
 *           verifyRefused / isCustomerOnApps (the answer that carries no staff session; CUSTOMER-DELINK) · keep (the apps' cb_sess, or a customer's cb_cust@<shop>)
 * CALLED BY app/signin-ui.js (reads CBSignin.session once, at load; absent → it throws, a window that cannot read its own answer must not paint) · tests/signin-ui.test.cjs
 * FLOW      load (AFTER /engine/signin.js, BEFORE /app/signin-ui.js) ──▶ CBSignin.session = { claims, of, refused, customerOnApps, keep }
 * CARD      18-identity-sign-in-and-access/sign-in
 * Twin: a byte copy lives in the api kit (tools/tally-connector/signin-session.js, scripts/vendor-till.cjs); the web file is the master.
 */
(function (root) {
  'use strict';
  var E = root.CBSignin;
  if (!E || typeof E.who !== 'function') throw new Error('CBSignin session needs /engine/signin.js loaded first');

  function jwtClaims(t) {
    try {
      var text = String(t || '').split('.')[1];
      if (!text) return {};
      text = text.replace(/-/g, '+').replace(/_/g, '/');
      while (text.length % 4) text += '=';
      var s = typeof root.atob === 'function' ? root.atob(text) : root.Buffer.from(text, 'base64').toString('utf8');
      return (
        JSON.parse(
          decodeURIComponent(
            Array.prototype.map
              .call(s, function (label) {
                return '%' + ('00' + label.charCodeAt(0).toString(16)).slice(-2);
              })
              .join('')
          )
        ) || {}
      );
    } catch (_) {
      return {};
    }
  }
  /**
   * sessionOf(answer) — the ONE reading of a verify answer into the session the apps keep (app.html sessPersist's shape:
   * token · role · name · entity · bridgeId · duty) plus what the window learned (person, exp, device_id, surface, jti).
   */
  function sessionOf(r) {
    var a = r || {},
      claims = jwtClaims(a.token),
      id = a.identity || a.entity || a.actor || {};
    var role = claims.identity_type || id.identity_type || 'entity';
    var name = id.display_name || claims.display_name || '';
    var entity = role === 'entity' ? name : claims.parent_entity_name || (a.actor && a.actor.parent_entity) || '';
    var bridgeId = role === 'entity' ? id.bridge_id || claims.bridge_id || '' : claims.parent_bridge_id || id.bridge_id || '';
    var s = {
      token: a.token || '',
      role: role,
      name: name,
      entity: entity,
      bridgeId: bridgeId,
      person: {
        id: id.user_id || claims.identity_id || null,
        identity_id: id.identity_id || claims.identity_id || null,
        kind: role === 'actor' ? 'employee' : role === 'customer' ? 'customer' : 'owner',
        shop: id.entity_id || claims.parent_entity_id || claims.identity_id || null
      },
      exp: claims.exp || null,
      device_id: claims.device_id || null,
      surface: claims.surface || null,
      jti: claims.jti || null
    };
    if (role === 'actor') s.duty = 'duty';
    return s;
  }
  /** the verify answer carries no staff session: a failed status, no token, or a customer's token on the apps */
  function verifyRefused(reply, answer, c) {
    return reply.status < 200 || reply.status >= 300 || !answer.token || isCustomerOnApps(answer, c);
  }
  /** CUSTOMER-DELINK: a customer's token is never kept as the apps' session — only the shop page's own sign-in (need 'customer') may hold it */
  function isCustomerOnApps(answer, c) {
    return !!answer.token && sessionOf(answer).role === 'customer' && c.need !== 'customer';
  }
  /** the apps' session, stored (cb_sess) — the same keys app.html writes; then CBOnePerson.claim says whose this browser's work is */
  function keep(c, s, store) {
    /* a sign-in by the host's LOCAL credential (the till's counter PIN) carries no token — there is no session to keep */
    if (!s || !s.token) return;
    /* a host may hand its own store (io.store: a test, the practice lab) — then NOTHING here touches this browser's real session */
    var own = !!store;
    store = store || root.localStorage;
    if (c.need === 'customer') {
      var shop = c.shop || s.person.shop || '';
      try {
        (own ? store : root.sessionStorage || store).setItem('cb_cust@' + shop, JSON.stringify({ token: s.token, name: s.name }));
      } catch (_) { /* storage blocked or full: the page works without it */ }
      return;
    }
    var sess = { token: s.token, role: s.role, name: s.name, entity: s.entity, bridgeId: s.bridgeId };
    if (s.duty) sess.duty = s.duty;
    try {
      store.setItem('cb_sess', JSON.stringify(sess));
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    try {
      if (!own && root.CBOnePerson && root.CBOnePerson.claim) root.CBOnePerson.claim(root.CBOnePerson.who(sess));
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
  }

  E.session = { claims: jwtClaims, of: sessionOf, refused: verifyRefused, customerOnApps: isCustomerOnApps, keep: keep };
  if (typeof module !== 'undefined' && module.exports) module.exports = E.session;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
