/* signin-more-ways.js — OTHER WAYS TO SIGN IN: the provider doors (Google, Microsoft) of the one sign-in window.
 * OWNS      the words a provider sign-in or connect says (words.sso · words.connect), what the provider's redirect left in the address (take), the "More ways to sign in" row
 *           (soonRow), the address that sends the browser to the provider (start) and the api's list of ready providers (ask); arrive() hands a landed code or refusal to the window's machine
 * CALLED BY app/signin-ui.js (reads CBSignin.provider once, at load; absent → console.warn SIGNIN_PROVIDER_MODULE_MISSING and no provider door is drawn) · settings.html reads take() through CBSignin.takeLanded
 * FLOW      load (this file, AFTER /engine/signin.js and BEFORE /app/signin-ui.js) ──▶ CBSignin.provider = { words, take, soonRow, isKey, start, ask, arrive }
 * CARD      18-identity-sign-in-and-access/sign-in
 * Twin: a byte copy lives in the api kit (tools/tally-connector/signin-more-ways.js, scripts/vendor-till.cjs); the web file is the master.
 */
(function (root) {
  'use strict';
  var E = root.CBSignin;
  if (!E || typeof E.who !== 'function') throw new Error('CBSignin provider needs /engine/signin.js loaded first');

  var WORDS = {
    /* connect (the #c= word after a signed-in person linked a provider): what Settings says */
    connect: {
      linked: 'Connected. You can now sign in with it.',
      LINK_EXISTS: 'That account is already connected here.',
      SIGNIN_PROVIDER_NOT_ACCEPTED: 'This business does not accept that way to sign in.',
      SIGNIN_REFUSED: 'That could not be connected to your account.',
      SIGNIN_UNAVAILABLE: 'Connecting could not finish. Try again in a moment.',
      LINK_CONFIRM_FAILED: 'That connection could not be confirmed. Start again from Settings.',
      SSO_HANDOFF: 'That took too long. Start again.',
      fallback: 'That did not finish. Nothing was connected.'
    },
    /* SSO-1129 P1a: what a provider sign-in that did not finish says (the api's #e= codes and the hand-off's refusals); the fall-back is always the code */
    sso: {
      SSO_STATE: 'That sign-in took too long or was already used. Start again.',
      SSO_MIXUP: 'That sign-in came from a different provider than you started with. Start again.',
      SSO_TOKEN: 'The provider answer could not be trusted, so nobody was signed in. Use your code instead.',
      SSO_CANCELLED: 'You stopped the sign-in at the provider.',
      PROVIDER_OFF: 'That sign-in is not switched on here. Use your code instead.',
      NO_DEVICE: 'This browser could not be recognised. Reload the page and try again.',
      BAD_NEXT: 'That sign-in could not return to this page. Use your code instead.',
      SSO_HANDOFF: 'That sign-in already finished or took too long. Start again.',
      SSO_NOT_LINKED: 'No account here is connected to that sign-in. Sign in with your mobile number or e-mail and the code we send you, then connect it under Settings.',
      SSO_EMAIL_UNVERIFIED: 'The provider has not confirmed that e-mail address, so nobody was signed in. Use your code instead.',
      SSO_MANY: 'That sign-in is connected to more than one account. Use your mobile number or e-mail and the code we send you.',
      SIGNIN_PROVIDER_NOT_ACCEPTED: 'This business does not accept that way to sign in. Use your code instead.',
      SIGNIN_UNAVAILABLE: 'Sign-in could not finish. Start again from the sign-in page.',
      SIGNIN_REFUSED: 'Sign-in failed. Check your details or ask for a new code.',
      DEVICE_MISMATCH: 'This browser said two different things. Reload the page and try again.',
      fallback: 'That sign-in did not finish. Use your mobile number or e-mail and the code we send you.'
    }
  };

  /**
   * ⭐ P1a — WHAT THE PROVIDER'S REDIRECT LEFT IN THE ADDRESS, TAKEN OUT AT ONCE. The api sends the browser back to /app.html#h=<one-time code> (or #e=<CODE>).
   * A fragment never goes to a server, but it stays in the address bar and the history: it is read here, ONCE, at load, and the address is replaced (never a session in a
   * URL: the code is swapped for the session by a POST body, and a spent or expired code is refused). Only this page's own address is read.
   */
  var LANDED = (function () {
    try {
      var where = root.location;
      if (!where || !/(^\/$|\/app\.html$)/.test(where.pathname || '')) return null;
      var found = /^#(h|e|c|k)=([A-Za-z0-9_%.-]{1,200})$/.exec(where.hash || '');
      if (!found) return null;
      if (root.history && typeof root.history.replaceState === 'function') root.history.replaceState(null, '', where.pathname + where.search);
      return { kind: found[1], value: decodeURIComponent(found[2]) };
    } catch (_) {
      return null;
    }
  })();

  /**
   * H1 (critic 21 Nov): the ONE consumer of what the provider's redirect left. A page that has its own sign-in screen (app.html) calls this at boot, before it picks #/login:
   * it returns { kind: 'h'|'e'|'c'|'k', value } ONCE (then null) and the address is already cleared. 'h' = a one-time code to swap (machine.providerHandoff), 'e' = a refusal word, 'c' = the result of connecting, 'k' = a one-time confirm code the signed-in session spends (POST /provider/link/finish).
   */
  function take() {
    var landed = LANDED;
    LANDED = null;
    return landed;
  }

  /**
   * ⭐ SSO-1129 — THE "BEING SWITCHED ON" ROW (Athi 21 Nov: "SSO is integrated but not visible at registration / sign-in"). The api has the provider start and
   * callback (SEC-112 P0, GET /api/signin/provider/:key/start|callback) but NOT yet the door that turns the callback's one-time code into a session
   * (P1a route 4) nor register-through-provider (P1b), so a live "Continue with Google" would have ended in a dead page. P1a now ships route 4 and the api lists a provider with live:true only when it is configured AND the door is
   * built: such a provider is a real button at SIGN-IN (ask → setLive); every other one, and every provider at registration (P1b), is
   * SHOWN, greyed, with its sentence (grey-what-is-not-ready): Google and Microsoft only — Apple, SSO and passkey are not built and stay hidden.
   * A host that switches a slot on (methods.google + onMethod) gets the real button instead; this row skips that provider. Back office and the
   * customer app stay delinked: the row is drawn for a person's sign-in or registration, never for the till or a shop's customer.
   * soonRow(intent, skip, live, addCss) → html. intent 'signin' | 'register'. One component: the registration form calls the same function.
   * P1a: a provider the api's GET /api/signin/providers lists with live:true (config present AND the hand-off door built) is a real button at sign-in; every other one stays grey.
   */
  var SOON = {
    signin: { google: ['Continue with Google', 'Google sign-in is being switched on.'], microsoft: ['Continue with Microsoft', 'Microsoft sign-in is being switched on.'] },
    register: { google: ['Sign up with Google', 'Google sign-up is being switched on.'], microsoft: ['Sign up with Microsoft', 'Microsoft sign-up is being switched on.'] }
  };
  var SOON_ID = { signin: { google: 'SCR054-B11', microsoft: 'SCR054-B12' }, register: { google: 'SCR053-B03', microsoft: 'SCR053-B04' } };
  function soonRow(intent, skip, live, addCss) {
    var kind = SOON[intent] ? intent : 'signin';
    addCss(); /* the registration page draws this without ever mounting the window */
    var skipped = skip || [];
    var real = [], grey = [];
    Object.keys(SOON[kind])
      .filter(function (key) {
        return skipped.indexOf(key) < 0;
      })
      .forEach(function (key) {
        var words = SOON[kind][key];
        if (kind === 'signin' && (live || []).indexOf(key) >= 0)
          real.push('<button data-cbsid="' + SOON_ID[kind][key] + '" type="button" class="cbsi-m" data-cbsi="provider" data-provider="' + key + '" data-testid="signin-' + key + '">' + words[0] + '</button>');
        else
          grey.push(
            '<button data-cbsid="' + SOON_ID[kind][key] + '" type="button" class="cbsi-m cbsi-soon" disabled aria-disabled="true" data-testid="' + kind + '-' + key + '-soon" title="' + words[1] + '">' +
              words[0] + '</button><p class="cbsi-said" data-testid="' + kind + '-' + key + '-why">' + words[1] + '</p>'
          );
      });
    /* 1129 (390x844 scrolled 36 px): the greyed doors fold into ONE line, as the leaders do (More ways to sign in); a live provider stays a visible button */
    var more = grey.length ? '<details class="cbsi-more" data-testid="' + kind + '-more"><summary>More ways to ' + (kind === 'register' ? 'sign up' : 'sign in') + '</summary>' + grey.join('') + '</details>' : '';
    return real.length + grey.length ? '<div class="cbsi-soonrow" data-testid="' + kind + '-sso-soon">' + real.join('') + more + '</div>' : '';
  }
  /** is this a provider the sign-in window offers (google, microsoft)? */
  function isKey(key) {
    return !!SOON.signin[key];
  }

  /** the api address that sends this browser to the provider (a top-level visit; the device id rides in the address because a visit has no header) */
  function start(c, key, dev) {
    return dev && isKey(key) ? (c.apiBase || '') + '/api/signin/provider/' + encodeURIComponent(key) + '/start?device_id=' + encodeURIComponent(dev) : '';
  }
  /** the providers the api says are ready: person windows only (never the till or a shop's customer; a host with its own transport keeps its own rules) */
  function ask(m, c, unwrap) {
    if (c.need === 'customer' || c.surface === 'till' || c.surface === 'shop' || c.io || typeof root.fetch !== 'function') return;
    try {
      root
        .fetch((c.apiBase || '') + '/api/signin/providers', { cache: 'no-store' })
        .then(function (reply) { return reply.json(); })
        .then(function (j) { m.setLive(unwrap(j).providers); })
        .catch(function (err) { if (root.cbQuiet) root.cbQuiet('signin:providers', err); });
    } catch (_) {
      /* the list failing leaves every provider greyed, as before */
    }
  }
  /** mount found something the provider's redirect left: a one-time code is swapped, a refusal word is said, a connect result is kept for Settings */
  function arrive(m, c) {
    var landed = c.need !== 'customer' && c.surface !== 'till' && c.surface !== 'shop' && !c.io ? LANDED : null;
    if (!landed) return;
    LANDED = null;
    if (landed.kind === 'h') m.providerHandoff(landed.value);
    else if (landed.kind === 'e') m.refuse(m.words.sso[landed.value] || m.words.sso.fallback);
    else LANDED = landed; /* a connect result belongs to Settings, not to a sign-in window */
  }

  E.provider = { words: WORDS, take: take, soonRow: soonRow, isKey: isKey, start: start, ask: ask, arrive: arrive };
  if (typeof module !== 'undefined' && module.exports) module.exports = E.provider;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
