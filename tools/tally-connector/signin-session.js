/* signin-session.js — THE SESSION A SIGN-IN LEAVES: reading a verify answer into the apps' session, and keeping it.
 * OWNS      jwtClaims (the claims inside a token) · sessionOf (a verify answer → { token, role, name, entity, bridgeId, person, exp, device_id, surface, jti, duty }) ·
 *           verifyRefused / isCustomerOnApps (the answer that carries no staff session; CUSTOMER-DELINK) · keep (the apps' cb_sess, or a customer's cb_cust@<shop>)
 * CALLED BY app/signin-ui.js (reads CBSignin.session once, at load; absent → it throws, a window that cannot read its own answer must not paint) · tests/signin-ui.test.cjs
 * FLOW      load (AFTER /engine/signin.js, BEFORE /app/signin-ui.js) ──▶ CBSignin.session = { claims, of, refused, customerOnApps, keep }
 * CARD      18-identity-sign-in-and-access/sign-in
 * ID        CMP070
 * OWNER     cb-security
 * RISK      security
 * Twin: a byte copy lives in the api kit (tools/tally-connector/signin-session.js, scripts/vendor-till.cjs); the web file is the master.
 */
(function (root) {
  'use strict';
  var engine = root.CBSignin;
  if (!engine || typeof engine.who !== 'function') throw new Error('CBSignin session needs /engine/signin.js loaded first');

  function jwtClaims(token) {
    try {
      var text = String(token || '').split('.')[1];
      if (!text) return {};
      text = text.replace(/-/g, '+').replace(/_/g, '/');
      while (text.length % 4) text += '=';
      var binary = typeof root.atob === 'function' ? root.atob(text) : root.Buffer.from(text, 'base64').toString('utf8');
      return (
        JSON.parse(
          decodeURIComponent(
            Array.prototype.map
              .call(binary, function (label) {
                return '%' + ('00' + label.charCodeAt(0).toString(16)).slice(-2);
              })
              .join('')
          )
        ) || {}
      );
    } catch (failure) {
      if (typeof root.cbQuiet === 'function') root.cbQuiet('signin: the token could not be read, no claims are used', failure);
      return {};
    }
  }
  /** the identity block of a verify answer: the identity, else the entity, else the actor */
  function identityOf(answer) {
    return answer.identity || answer.entity || answer.actor || {};
  }
  /** the shop (parent entity) name a session carries: the entity's own name for an owner, else the parent's */
  function entityNameOf(role, name, claims, answer) {
    return role === 'entity' ? name : claims.parent_entity_name || (answer.actor && answer.actor.parent_entity) || '';
  }
  /** the bridge id a session carries: the owner's own, else the parent's */
  function bridgeIdOf(role, identity, claims) {
    return role === 'entity' ? identity.bridge_id || claims.bridge_id || '' : claims.parent_bridge_id || identity.bridge_id || '';
  }
  /** who the window learned the person is: id, identity, kind (employee · customer · owner) and the shop */
  function personOf(role, identity, claims) {
    return {
      id: identity.user_id || claims.identity_id || null,
      identity_id: identity.identity_id || claims.identity_id || null,
      kind: role === 'actor' ? 'employee' : role === 'customer' ? 'customer' : 'owner',
      shop: identity.entity_id || claims.parent_entity_id || claims.identity_id || null
    };
  }
  /** what the token itself says about this sign-in: expiry, device, surface, jti */
  function tokenFacts(claims) {
    return { exp: claims.exp || null, device_id: claims.device_id || null, surface: claims.surface || null, jti: claims.jti || null };
  }
  /**
   * sessionOf(answer) — the ONE reading of a verify answer into the session the apps keep (app.html sessPersist's shape:
   * token · role · name · entity · bridgeId · duty) plus what the window learned (person, exp, device_id, surface, jti).
   */
  function sessionOf(reply) {
    var answer = reply || {},
      claims = jwtClaims(answer.token),
      identity = identityOf(answer);
    var role = claims.identity_type || identity.identity_type || 'entity';
    var name = identity.display_name || claims.display_name || '';
    var session = {
      token: answer.token || '',
      role: role,
      name: name,
      entity: entityNameOf(role, name, claims, answer),
      bridgeId: bridgeIdOf(role, identity, claims),
      person: personOf(role, identity, claims)
    };
    Object.assign(session, tokenFacts(claims));
    if (role === 'actor') session.duty = 'duty';
    return session;
  }
  /** the verify answer carries no staff session: a failed status, no token, or a customer's token on the apps */
  function verifyRefused(reply, answer, context) {
    return reply.status < 200 || reply.status >= 300 || !answer.token || isCustomerOnApps(answer, context);
  }
  /** CUSTOMER-DELINK: a customer's token is never kept as the apps' session — only the shop page's own sign-in (need 'customer') may hold it */
  function isCustomerOnApps(answer, context) {
    return !!answer.token && sessionOf(answer).role === 'customer' && context.need !== 'customer';
  }
  /** a customer's token, kept only for the shop page's own window: cb_cust@<shop> (a host's own store when it hands one, else this tab's sessionStorage) */
  function keepCustomer(context, session, store, hostStore) {
    var shop = context.shop || session.person.shop || '';
    try {
      (hostStore ? store : root.sessionStorage || store).setItem('cb_cust@' + shop, JSON.stringify({ token: session.token, name: session.name }));
    } catch (failure) { /* storage blocked or full: the page works without it */ if (typeof root.cbQuiet === 'function') root.cbQuiet('signin: the customer session could not be kept on this device', failure); }
  }
  /** the staff session, as cb_sess; then CBOnePerson says whose this browser's work is (not when a host handed its own store) */
  function keepStaff(session, store, hostStore) {
    var kept = { token: session.token, role: session.role, name: session.name, entity: session.entity, bridgeId: session.bridgeId };
    if (session.duty) kept.duty = session.duty;
    try {
      store.setItem('cb_sess', JSON.stringify(kept));
    } catch (failure) { /* best effort: failing here changes nothing the user sees */ if (typeof root.cbQuiet === 'function') root.cbQuiet('signin: the session could not be kept on this device', failure); }
    try {
      if (!hostStore && root.CBOnePerson && root.CBOnePerson.claim) root.CBOnePerson.claim(root.CBOnePerson.who(kept));
    } catch (failure) { /* best effort: failing here changes nothing the user sees */ if (typeof root.cbQuiet === 'function') root.cbQuiet('signin: the one-person claim failed, the sign-in still stands', failure); }
  }
  /** the apps' session, stored (cb_sess) — the same keys app.html writes; then CBOnePerson.claim says whose this browser's work is */
  function keep(context, session, store) {
    /* a sign-in by the host's LOCAL credential (the till's counter PIN) carries no token — there is no session to keep */
    if (!session || !session.token) return;
    /* a host may hand its own store (io.store: a test, the practice lab) — then NOTHING here touches this browser's real session */
    var hostStore = !!store;
    store = store || root.localStorage;
    if (context.need === 'customer') return keepCustomer(context, session, store, hostStore);
    keepStaff(session, store, hostStore);
  }

  engine.session = { claims: jwtClaims, of: sessionOf, refused: verifyRefused, customerOnApps: isCustomerOnApps, keep: keep };
  if (typeof module !== 'undefined' && module.exports) module.exports = engine.session;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
