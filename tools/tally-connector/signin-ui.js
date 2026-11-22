/* signin-ui.js — CBSignin.mount: THE ONE SIGN-IN WINDOW, for every app (M14, DECISIONS 2026-10-08).
 * OWNS      CBSignin.mount: the one sign-in window for every app, its state machine (id, choose, secret, set PIN, in) and its paint; the rules stay in /engine/signin.js
 * CALLED BY app/shell.js (the Home sign-in), public/accounts.html, crm.html, finance.html, signin-lab.html and till.html (CBSignin.mount); the script tag is on 13 pages (accounts, authority-forms, catalogue, crm, employees, finance, know-your-business, network, operations, settings, signin-lab, tasks, till); the api's kit carries a byte copy of this file
 * FLOW      mount(host, opts) ──▶ id ──▶ [choose account] ──▶ secret (PIN or code) ──▶ [set PIN] ──▶ in ──▶ onIn(session, answer)
 * CARD      18-identity-sign-in-and-access/sign-in
 *
 * Athi: *"the register, sign-in module should be a common module and the very first page anyone is going to see is the index
 * app"* · *"only the mobile number or email should be used for sign-in … .br / .cr can be combined behind the scene"* · *"the
 * first time pin setting should appear in any app across the board"* · *"in that module only, we need to have social sign-in,
 * sso and so on."*
 *
 * ⭐ WHAT THIS FILE IS. /engine/signin.js (chitbridge-engines `signin`, window.CBSignin) holds the RULES — what was typed
 * (who), what to send (ask), what a code is (code), what a refusal means (refusal), what a PIN is (pinPair). This file adds
 * ONE thing to that global: `mount` — the state machine and the paint. There is no second rule set here; a page mounts it
 * and paints nothing of its own. The till mounts the same file next (docs: "the till change", M14 report).
 *
 *   CBSignin.mount(host, {
 *     apiBase,                      // '' on the same origin, or the API origin (CFG.API_BASE / CBShell.apiBase())
 *     surface: 'index'|'accounts'|'crm'|'till'|'shop'|'lab',
 *     need: 'person' | 'customer',  // person → cb_sess (the apps' session); customer → sessionStorage cb_cust@<shop>, never cb_sess
 *     shop,                         // customer only: the shop's entity_id (the storefront)
 *     deviceId,                     // OPTIONAL. A string or () => string. X-Device-Id rides every sign-in call and the server
 *                                   //   mints a LISTED, revocable session bound to this device (M05). Every later call must send
 *                                   //   X-Device-Id too (auth answers 401 DEVICE_MISMATCH otherwise): the till does it itself, every
 *                                   //   other page through /app/device-id.js (CBDevice, K-SEC PR A). ABSENT → CBDevice.id() when the
 *                                   //   page loaded device-id.js; false, or no CBDevice, or no storage → today's token (7 d, unlisted).
 *     methods: { google:true, … },  // the method SLOTS switched on by the host — hidden until a method ships AND the host says so
 *     onMethod(name),               // what a switched-on slot does (the provider flow lives here, nowhere else)
 *     registerHref,                 // OPTIONAL: the register door ("New shop? Register") — the window itself never creates an account
 *     onIn(session, answer), onOut(), // the page's hooks; session = { token, role, name, entity, bridgeId, person, exp, device_id, surface };
 *                                   //   answer = the server's verify body as it came (identity, token) — the till reads identity.entity_id
 *     io: { post, store },          // OPTIONAL: a host's own transport and session store. io.store given → cb_sess is NEVER written here
 *                                   //   (the till keeps cb_till_person itself, through its one door becomeShop)
 *     local,                        // OPTIONAL (the till): a credential the HOST holds with the line down — the counter PIN book.
 *                                   //   { find(id) → entry|null, check(entry, pin) → Promise<{ ok, why, locked, person }>,
 *                                   //     has(person) → bool, save(person, pin) → Promise<{ ok, why }> }
 *                                   //   go() asks find() FIRST; a hit opens the PIN box and nothing is posted; check() judges it (the
 *                                   //   engine's pinAfter, in the host). A sign-in by local PIN carries NO token and keeps NO session.
 *                                   //   offerPin() (called by the host from onIn, once a person proved themselves online) opens the
 *                                   //   same setpin screen for the LOCAL book: save() keeps it, "Not now" skips it.
 *     online,                       // OPTIONAL: () => bool. false hides "Use a code instead" — a dead button is not offered
 *     words                         // optional overrides of WORDS
 *   }) → { destroy(), state(), machine }
 *
 * ⭐ THE STATE MACHINE (one, here — tests/signin-ui.test.cjs drives it with no browser; the lab and every page drive the same one):
 *   out ──go()──► credential (ONE box: a PIN or the code)  ──verify()──► in
 *                                  └─(409 CHOOSE_IDENTITY, only AFTER a correct secret)──► choose ──choose(i)──► verify again with the STORED id
 *   ⭐ SEC-143 (API-STANDARD S6): ask answers every person the same, so nothing before the secret says whether the person exists, has a PIN or
 *      gets a code. The box takes either; the SHAPE of what is typed (4 digits = PIN, else code) picks pin or otp for verify. `resolved`
 *      is what was typed. The one exception is the host's LOCAL book (the till): found on this device, it is a PIN box named for what it is.
 *   credential ──(200 + requires_pin_setup)──► setpin ──setPin(a,b)──► in
 *   ⚠️ A SPENT CODE IS NEVER RE-SENT: ask() is posted once per id; Continue again with the same id goes straight to the code box;
 *      a wrong code never re-asks; only "Send a new code" (again()) asks the server for another; once in, nothing asks.
 *   ⚠️ FAIL-CLOSED: this window never posts to a register door. NO_ACCOUNT is a refusal with a sentence; the register door is a link
 *      the host may give (registerHref) and nothing else.
 *
 * Reuse: CBSignin (engine) · CBOnePerson.claim / who (one browser, one shop) · CBAvatar (the sign-out side; signOut is there, not here).
 */
(function (root) {
  'use strict';
  var doc = root.document;
  var E = root.CBSignin;
  if (!E || typeof E.who !== 'function' || typeof E.ask !== 'function') {
    throw new Error('CBSignin.mount needs /engine/signin.js loaded first — window.CBSignin is the engine; /app/signin-ui.js only adds mount');
  }

  /* ── the words, one place (copy budget: a label, a verb, a sentence) ────────────────────────────────────────────── */
  var WORDS = {
    title: 'Sign in',
    id: 'Mobile, e-mail or user ID',
    go: 'Continue',
    code: 'The code we sent',
    pin: 'Your PIN',
    verify: 'Sign in',
    again: 'Send a new code',
    back: 'Not you? Start again',
    which: 'Which one are you?',
    secret: 'PIN or code',
    either: 'Enter your PIN or the code we sent.',
    setTitle: 'Choose a PIN',
    setWhy: 'Four digits, for next time.',
    pin1: 'Your new PIN',
    pin2: 'Type it again',
    save: 'Save PIN',
    customerOnly: 'This sign-in is for the staff of a shop. Customers sign in on the shop page itself.',
    signedIn: function (name) {
      return name + ' is signed in.';
    },
    sent: 'Code sent.',
    noAccount: 'No account found. Check the number or e-mail.',
    tooMany: 'Too many tries. Wait 15 minutes.',
    pinSet: 'You already have a PIN. Sign in with it, and change it in Settings with your current PIN.',
    expired: 'Your sign-in timed out. Sign in again.',
    working: 'Working…',
    register: 'New shop? Register',
    pinName: 'Your PIN',
    kinds: { owner: 'owner', employee: 'employee', customer: 'customer' },
    at: 'at',
    /* the host's own credential (the till's counter PIN) — the same screens, named for what they are */
    localPin: 'Counter PIN',
    localWhy: 'Four digits. Works without internet.',
    line: 'Use a code instead',
    later: 'Not now',
    /* SSO-1129 P1a: what a provider sign-in that did not finish says (the api's #e= codes and the hand-off's refusals); the fall-back is always the code */
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
  function takeLanded() {
    var landed = LANDED;
    LANDED = null;
    return landed;
  }

  /**
   * ⭐ THE METHOD SLOTS (DECISIONS 2026-10-08: every sign-in method lives only in CBSignin). A slot is CONFIG, hidden by default:
   * a button is drawn only when the host switches the slot on (contract.methods[name] === true) AND gives onMethod — so nothing on
   * screen ever promises a provider that is not wired. The names are b282's method CHECK (google · apple · microsoft · passkey) + sso.
   */
  var METHODS = {
    google: { label: 'Continue with Google' },
    apple: { label: 'Continue with Apple' },
    microsoft: { label: 'Continue with Microsoft' },
    sso: { label: 'Use company account' },
    passkey: { label: 'Use your passkey' }
  };
  /**
   * ⭐ SSO-1129 — THE "BEING SWITCHED ON" ROW (Athi 21 Nov: "SSO is integrated but not visible at registration / sign-in"). The api has the provider start and
   * callback (SEC-112 P0, GET /api/signin/provider/:key/start|callback) but NOT yet the door that turns the callback's one-time code into a session
   * (P1a route 4) nor register-through-provider (P1b), so a live "Continue with Google" would have ended in a dead page. P1a now ships route 4 and the api lists a provider with live:true only when it is configured AND the door is
   * built: such a provider is a real button at SIGN-IN (askProviders → setLive); every other one, and every provider at registration (P1b), is
   * SHOWN, greyed, with its sentence (grey-what-is-not-ready): Google and Microsoft only — Apple, SSO and passkey are not built and stay hidden.
   * A host that switches a slot on (methods.google + onMethod) gets the real button instead; this row skips that provider. Back office and the
   * customer app stay delinked: the row is drawn for a person's sign-in or registration, never for the till or a shop's customer.
   * soonRow(intent, skip, live) → html. intent 'signin' | 'register'. One component: the registration form calls the same function.
   * P1a: a provider the api's GET /api/signin/providers lists with live:true (config present AND the hand-off door built) is a real button at sign-in; every other one stays grey.
   */
  var SOON = {
    signin: { google: ['Continue with Google', 'Google sign-in is being switched on.'], microsoft: ['Continue with Microsoft', 'Microsoft sign-in is being switched on.'] },
    register: { google: ['Sign up with Google', 'Google sign-up is being switched on.'], microsoft: ['Sign up with Microsoft', 'Microsoft sign-up is being switched on.'] }
  };
  var SOON_ID = { signin: { google: 'SCR054-B11', microsoft: 'SCR054-B12' }, register: { google: 'SCR053-B03', microsoft: 'SCR053-B04' } };
  function soonRow(intent, skip, live) {
    var kind = SOON[intent] ? intent : 'signin';
    addCss(); /* the registration page draws this without ever mounting the window */
    var skipped = skip || [];
    var rows = Object.keys(SOON[kind])
      .filter(function (key) {
        return skipped.indexOf(key) < 0;
      })
      .map(function (key) {
        var words = SOON[kind][key];
        if (kind === 'signin' && (live || []).indexOf(key) >= 0)
          return '<button data-cbsid="' + SOON_ID[kind][key] + '" type="button" class="cbsi-m" data-cbsi="provider" data-provider="' + key + '" data-testid="signin-' + key + '">' + words[0] + '</button>';
        return (
          '<button data-cbsid="' + SOON_ID[kind][key] + '" type="button" class="cbsi-m cbsi-soon" disabled aria-disabled="true" data-testid="' + kind + '-' + key + '-soon" title="' + words[1] + '">' +
          words[0] + '</button><p class="cbsi-said" data-testid="' + kind + '-' + key + '-why">' + words[1] + '</p>'
        );
      });
    return rows.length ? '<div class="cbsi-soonrow" data-testid="' + kind + '-sso-soon">' + rows.join('') + '</div>' : '';
  }
  function methodsOn(c) {
    var on = (c && c.methods) || {};
    return typeof (c && c.onMethod) === 'function'
      ? Object.keys(METHODS).filter(function (item) {
          return on[item] === true;
        })
      : [];
  }

  /* ── small helpers ──────────────────────────────────────────────────────────────────────────────────────────────── */
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
  /** the {ok,data,error} envelope, when a host wraps it (core.js unwrap) — the sign-in routes answer bare JSON */
  function unwrap(j) {
    return j && typeof j === 'object' && 'ok' in j && ('data' in j || 'error' in j)
      ? j.ok
        ? j.data || {}
        : Object.assign({}, j, j.error && typeof j.error === 'object' ? j.error : {})
      : j || {};
  }
  function deviceOf(c) {
    var d = c && c.deviceId;
    /* K-SEC PR A: a host that names no device gets this browser's (public/app/device-id.js) — every web door is a session */
    if (d === undefined && root.CBDevice && typeof root.CBDevice.id === 'function') d = root.CBDevice.id;
    if (typeof d === 'function') {
      try {
        d = d();
      } catch (_) {
        d = null;
      }
    }
    return d ? String(d) : null;
  }
  /** the default transport: fetch. A host (the lab, a test) may hand its own io.post(path, body, token) → { status, body }. */
  function httpPost(c) {
    return function (path, body, token) {
      var h = { 'Content-Type': 'application/json' };
      if (token) h.Authorization = 'Bearer ' + token;
      var dev = deviceOf(c);
      if (dev) {
        h['X-Device-Id'] = dev;
        body = Object.assign({}, body, { device_id: dev, surface: c.surface || 'web' });
      }
      return root
        .fetch((c.apiBase || '') + path, { method: 'POST', headers: h, body: JSON.stringify(body), cache: 'no-store' })
        .then(function (reply) {
          return reply
            .json()
            .catch(function () {
              return {};
            })
            .then(function (j) {
              return { status: reply.status, body: unwrap(j) };
            });
        })
        .catch(function () {
          return { status: 0, body: {} };
        });
    };
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
  /** why a person is at the sign-in window: the page's own reason, else the one the frame kept when their access ended (BOOKS_GRANT_ENDED, ACCOUNT_SWITCHED_OFF: the server's sentence, read once) */
  function endedWhy(c) {
    return c.why ? String(c.why) : root.CBFrame && root.CBFrame.endedNote ? root.CBFrame.endedNote() : '';
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

  /** the sentence for a refused call: the page's words for the known codes, else the server's own sentence, else the shared refusal wording */
  function refusalWords(words, failed) {
    var said = failed.body || {}, code = said.code;
    if (code === 'NO_ACCOUNT') return words.noAccount;
    if (failed.status === 429) return words.tooMany;
    if (code === 'PIN_ALREADY_SET') return words.pinSet; /* 409: a first-PIN write on a person who has one — the change-PIN door (PUT /api/actors/change-pin, current PIN) is the way */
    if (code === 'SESSION_EXPIRED') return words.expired;
    /* a NAMED refusal (DEVICE_REVOKED, AMBIGUOUS_NAME, …) already carries the sentence the server chose — say that, not "wrong code" */
    if (code && said.message) return String(said.message);
    return E.refusal({ status: failed.status, message: said.message || said.error });
  }
  /* ── the state machine ──────────────────────────────────────────────────────────────────────────────────────────── */
  function machine(c, io) {
    c = c || {};
    io = io || {};
    var W = Object.assign({}, WORDS, c.words || {});
    var post = io.post || httpPost(c);
    var S = {
      at: 'out',
      typed: '',
      kind: '',
      need: '',
      resolved: '',
      sent: null,
      choices: [],
      why: endedWhy(c),
      said: '',
      busy: false,
      token: null,
      session: null,
      asks: 0,
      verifies: 0,
      /* the host's local credential (c.local): the entry found for the typed id; viaLine = the person chose the line instead;
               localPin = the setpin screen is for the LOCAL book, not the server */
      local: null,
      viaLine: false,
      localPin: false,
      live: [] /* providers the api says are ready (GET /api/signin/providers, live:true) */
    };
    var list = c.local && typeof c.local.find === 'function' && typeof c.local.check === 'function' ? c.local : null;
    function onLine() {
      if (typeof c.online !== 'function') return true;
      try {
        return !!c.online();
      } catch (_) {
        return true;
      }
    }
    /** a person proved by the host's own credential: no token, no session — an identity, exactly what a counter keeps */
    function localSession(p) {
      p = p || {};
      var kind = p.kind === 'entity' ? 'owner' : p.kind || 'employee';
      return {
        token: '',
        role: kind === 'owner' ? 'entity' : 'actor',
        name: p.name || '',
        entity: '',
        bridgeId: '',
        person: { id: p.id || null, identity_id: p.identity_id || p.id || null, kind: kind, shop: p.entity || null },
        exp: null,
        device_id: null,
        surface: c.surface || null,
        jti: null,
        local: true
      };
    }
    var subs = [];
    function emit() {
      subs.forEach(function (fn) {
        try {
          fn(S);
        } catch (_) { /* best effort: failing here changes nothing the user sees */ }
      });
    }
    function set(p) {
      Object.assign(S, p);
      emit();
      return S;
    }
    /* the secret typed before a choice of account, kept in this closure only until the person picks (never in S, never painted) */
    var held = null;

    /** ask about an id (typed, or repeated by "Send a new code", sent whole so a .br / .cr handle is never split). One answer for everyone (SEC-143). */
    function askFor(typedId, stored) {
      var a = stored ? { ok: true, body: { mode: 'login', id: String(typedId) }, say: W.either } : E.ask(typedId);
      if (!a.ok) {
        set({ why: a.why });
        return Promise.resolve(S);
      }
      set({ busy: true, why: '' });
      S.asks++;
      return post('/api/signin/ask', a.body).then(function (reply) {
        var b = reply.body || {};
        if (reply.status < 200 || reply.status >= 300) return set({ busy: false, why: refusalWords(W, reply) });
        var resolved = String(typedId);
        return set({
          busy: false,
          at: 'credential',
          need: 'either',
          kind: '',
          resolved: resolved,
          local: null,
          sent: { id: resolved, typed: resolved, kind: '', at: Date.now() },
          said: b.message || W.either
        });
      });
    }
    function go() {
      if (S.at === 'in') return Promise.resolve(S); /* signed in: nothing asks */
      var w = E.who(S.typed);
      if (!w.ok) {
        set({ why: w.why });
        return Promise.resolve(S);
      }
      /* ⚠️ a code already on its way for this very id: no second ask — back to the box that takes it */
      if (S.sent && S.at !== 'in' && (w.value === S.sent.typed || w.value === S.sent.id)) {
        return Promise.resolve(set({ at: 'credential', need: 'either', kind: '', resolved: S.sent.id, why: '', said: W.either }));
      }
      /* ⭐ THE HOST'S OWN CREDENTIAL FIRST (the till's counter PIN, SPEC-counter-identity §3): somebody who set one here signs in
       with it, line or no line — the shift change that happens forty times a day needs no code in a mailbox. Nothing is posted. */
      if (list && !S.viaLine) {
        var e = null;
        try {
          e = list.find(w.value);
        } catch (_) {
          e = null;
        }
        if (e) return Promise.resolve(set({ at: 'credential', need: 'pin', local: e, kind: e.kind || '', resolved: w.value, why: '', said: '' }));
      }
      return askFor(w.value);
    }
    /** the person picked an account from the list the server gave AFTER a correct secret: verify again with the STORED id and the same secret */
    function choose(i) {
      var ch = S.choices[i];
      if (S.busy || !ch || !held) return Promise.resolve(S); /* a second tap while the first verify is out must not repost the one-time code */
      return sendVerify(String(ch.id), held);
    }
    /* SEC1 · a TESTER code (the api's TESTER_CODE: 8+ characters, any kind) is sent as typed — the engine's code() knows only a
     4-digit PIN and a 6-digit code (chitbridge-engines signin.code; widening it is queued for the engines round). Only on the
     code step, never for a PIN or the host's local credential; the SERVER decides whether it is good. */
    function longCode(cred) {
      var text = String(cred == null ? '' : cred).trim();
      return S.need === 'either' && !S.local && text.length >= 8 && text.length <= 64 ? { ok: true, value: text, isPin: false } : null;
    }
    function verify(cred) {
      var code = longCode(cred) || E.code(cred);
      if (!code.ok) {
        set({ why: code.why });
        return Promise.resolve(S);
      }
      /* only the host's LOCAL book is a PIN box before the server speaks; the server's box takes either, so no shape is refused for its kind */
      if (S.local && !code.isPin) {
        set({ why: E.pinShape('', W.pinName).why });
        return Promise.resolve(S);
      }
      /* ⭐ the host judges its own credential (the engine's pinAfter, in the host's book) — no network, whatever the line is doing */
      if (S.local && list) {
        set({ busy: true, why: '' });
        S.verifies++;
        return Promise.resolve()
          .then(function () {
            return list.check(S.local, code.value);
          })
          .then(
            function (reply) {
              reply = reply || {};
              if (!reply.ok) {
                /* locked: back to the box — the line is the only way on from here */
                if (reply.locked) return set({ busy: false, at: 'out', local: null, need: '', resolved: '', why: reply.why || '' });
                return set({ busy: false, local: reply.entry || S.local, why: reply.why || '' });
              }
              return signedIn(localSession(reply.person), null);
            },
            function (x) {
              return set({ busy: false, why: (x && x.message) || 'The PIN could not be checked.' });
            }
          );
      }
      return sendVerify(S.resolved, code);
    }
    /** post the typed id + the secret. A 409 CHOOSE_IDENTITY here follows a CORRECT secret: the list is shown now, never before. */
    function sendVerify(id, code) {
      var body = { id: id };
      body[code.isPin ? 'pin' : 'otp'] = code.value;
      set({ busy: true, why: '' });
      S.verifies++;
      return post('/api/signin/verify', body).then(function (reply) {
        var answer = reply.body || {};
        if (reply.status === 409 && answer.code === 'CHOOSE_IDENTITY' && Array.isArray(answer.choices) && answer.choices.length) {
          held = code;
          return set({ busy: false, at: 'choose', choices: answer.choices, said: '' });
        }
        held = null;
        if (verifyRefused(reply, answer, c)) return set({ busy: false, why: isCustomerOnApps(answer, c) ? W.customerOnly : refusalWords(W, reply) });
        var s = sessionOf(answer);
        S.sent = null; /* ⚠️ the code is spent: nothing here asks for it again */
        S.answer = answer; /* the verify body as it came — handed to onIn beside the session */
        if (answer.requires_pin_setup === true) return set({ busy: false, at: 'setpin', localPin: false, token: answer.token, session: s, said: W.setWhy });
        return signedIn(s, answer);
      });
    }
    function setPin(a, b) {
      var p = E.pinPair(a, b, S.localPin ? W.localPin : W.pinName);
      if (!p.ok) {
        set({ why: p.why });
        return Promise.resolve(S);
      }
      set({ busy: true, why: '' });
      /* ⭐ the LOCAL book (offerPin): the host keeps it — a salt and a hash under the shop, never the PIN. Already signed in; no onIn again. */
      if (S.localPin && list && typeof list.save === 'function') {
        return Promise.resolve()
          .then(function () {
            return list.save(S.session, p.value);
          })
          .then(
            function (reply) {
              if (!reply || !reply.ok) return set({ busy: false, why: (reply && reply.why) || 'The PIN could not be kept.' });
              return set({ busy: false, at: 'in', localPin: false, said: W.signedIn(S.session.name || S.session.person.id || '') });
            },
            function (x) {
              return set({ busy: false, why: (x && x.message) || 'The PIN could not be kept.' });
            }
          );
      }
      return post('/api/signin/pin', { pin: p.value, confirm_pin: p.value }, S.token).then(function (reply) {
        var said = reply.body && reply.body.code;
        if (said === 'PIN_ALREADY_SET' || said === 'SESSION_EXPIRED') return set({ busy: false, at: 'credential', token: null, session: null, why: refusalWords(W, reply) }); /* the set-PIN step is over: back to the box, in words */
        if (reply.status < 200 || reply.status >= 300) return set({ busy: false, why: refusalWords(W, reply) });
        return signedIn(S.session, S.answer || null);
      });
    }
    function signedIn(s, answer) {
      keep(c, s, io.store);
      set({ busy: false, at: 'in', session: s, token: s.token, local: null, viaLine: false, said: W.signedIn(s.name || s.person.id || '') });
      if (typeof c.onIn === 'function') {
        try {
          c.onIn(s, answer || null);
        } catch (_) { /* best effort: failing here changes nothing the user sees */ }
      }
      return S;
    }
    /** the host asks for a LOCAL PIN to be chosen (the till, after an online sign-in, when the person has none here) — once in, only */
    function offerPin(given) {
      /* `given` (optional): a person the host already holds as signed in — the till after a reload, whose token went on the key */
      if (given && S.at !== 'in')
        set({ at: 'in', session: given, token: given.token || null, said: W.signedIn(given.name || (given.person && given.person.id) || '') });
      if (S.at !== 'in' || !S.session || !list || typeof list.save !== 'function') return Promise.resolve(S);
      var has = false;
      try {
        has = typeof list.has === 'function' ? !!list.has(S.session.person) : false;
      } catch (_) {
        has = false;
      }
      if (has) return Promise.resolve(S);
      return Promise.resolve(set({ at: 'setpin', localPin: true, why: '', said: W.localWhy }));
    }
    /** "Not now" — only the LOCAL offer may be skipped; the server's requires_pin_setup is not a choice */
    function later() {
      if (S.at === 'setpin' && S.localPin) set({ at: 'in', localPin: false, why: '' });
      return Promise.resolve(S);
    }
    /** "Use a code instead" — the same person, through the line (e.g. a forgotten counter PIN, reset by a real sign-in) */
    function line() {
      if (!S.local || !onLine()) return Promise.resolve(S);
      var id = S.resolved;
      set({ local: null, viaLine: true, need: '', why: '' });
      return askFor(id);
    }
    /** the api's list of ready providers → the keys whose button is live (a list that is not well formed switches nothing on) */
    function setLive(list) {
      var keys = (Array.isArray(list) ? list : []).filter(function (p) { return p && p.live === true && typeof p.key === 'string' && SOON.signin[p.key]; }).map(function (p) { return p.key; });
      return set({ live: keys });
    }
    /** the page came back from the provider with a one-time code: swap it for the session (the SAME answer as a code sign-in), or say in words why not */
    function providerHandoff(code) {
      if (S.at !== 'out' || !code) return Promise.resolve(S);
      set({ busy: true, why: '' });
      return post('/api/signin/provider/handoff', { code: String(code) }).then(function (reply) {
        var answer = reply.body || {};
        if (verifyRefused(reply, answer, c)) return set({ busy: false, why: W.sso[answer.code] || answer.detail || answer.message || W.sso.fallback });
        var s = sessionOf(answer);
        S.answer = answer;
        if (answer.requires_pin_setup === true) return set({ busy: false, at: 'setpin', localPin: false, token: answer.token, session: s, said: W.setWhy });
        return signedIn(s, answer);
      });
    }
    /** a sentence the host wants on the box (e.g. the picker: "no counter PIN for X yet") — words only, no state change */
    function refuse(why) {
      return set({ why: String(why || '') });
    }
    /** "Send a new code" — the ONE way a second code is asked for, and only while a code box is open */
    function again() {
      if (S.at !== 'credential' || S.local || !S.resolved) return Promise.resolve(S);
      return askFor(S.resolved, true);
    }
    /** back to the box. `sent` is KEPT: the code already on its way is remembered, so Continue with the same id does not ask twice */
    /* ⚠️ W1 (2026-10-12): `local` is dropped too — "Not you? Start again" from somebody's counter-PIN box used to carry THEIR entry
     into the next person's sign-in, so the next person's six-digit code was checked as the first person's PIN. */
    function back() {
      held = null;
      return set({ at: 'out', typed: '', kind: '', need: '', resolved: '', choices: [], why: '', said: '', token: null, local: null });
    }
    return {
      state: function () {
        return S;
      },
      onChange: function (fn) {
        subs.push(fn);
        return function () {
          subs = subs.filter(function (x) {
            return x !== fn;
          });
        };
      },
      typed: function (v) {
        S.typed = String(v == null ? '' : v);
        return S;
      },
      go: go,
      choose: choose,
      close: () => (held = null), // the window is torn down: the held secret goes with it
      verify: verify,
      setPin: setPin,
      again: again,
      back: back,
      offerPin: offerPin,
      later: later,
      line: line,
      refuse: refuse,
      setLive: setLive,
      providerHandoff: providerHandoff,
      online: onLine,
      methods: function () {
        return methodsOn(c);
      },
      words: W
    };
  }

  /* ── the paint ──────────────────────────────────────────────────────────────────────────────────────────────────── */
  var CSS =
    '.cbsi{max-width:420px;margin:0 auto;font:inherit;color:var(--ink,#1D1B16);background:var(--card,#fff);border:1px solid var(--line,#DDD6C6);border-radius:15px;padding:18px 19px;box-sizing:border-box}' +
    '.cbsi form{display:flex;flex-direction:column;gap:10px}' +
    '.cbsi h2{font-size:19px;font-weight:800;margin:0 0 2px;letter-spacing:-.01em}' +
    /* TOUR-FIX1: on a page without the list names (settings) a chosen theme left the label grey and the links Cream blue on a dark card (~2:1, ~1.8:1) — the
     theme library's own --grey / --blue-d come next, then the Cream values */
    '.cbsi label{display:flex;flex-direction:column;gap:5px;font-size:13.5px;font-weight:600;color:var(--muted,var(--grey,#5E594D))}' +
    '.cbsi input{height:46px;padding:0 13px;border:1px solid var(--line,#DDD6C6);border-radius:10px;background:var(--card,#fff);color:var(--ink,#1D1B16);font:inherit;font-size:16px;width:100%;box-sizing:border-box}' +
    '.cbsi input:focus{outline:2px solid var(--green,#16693F);outline-offset:1px}' +
    '.cbsi .cbsi-go,.cbsi .cbsi-m{height:46px;padding:0 16px;border-radius:10px;border:1px solid var(--green,#16693F);background:var(--green,#16693F);color:var(--on-green,var(--card,#fff));font:inherit;font-size:15px;font-weight:700;cursor:pointer;width:100%}' +
    '.cbsi .cbsi-go[disabled]{opacity:.6;cursor:default}' +
    '.cbsi .cbsi-m{background:var(--card,#fff);color:var(--ink,#1D1B16);border-color:var(--line,#DDD6C6)}' +
    '.cbsi .cbsi-m[disabled]{opacity:.55;cursor:not-allowed}.cbsi-soonrow{display:flex;flex-direction:column;gap:6px;margin-top:10px}.cbsi-soonrow .cbsi-m{height:46px;padding:0 16px;border-radius:10px;border:1px solid var(--line,#DDD6C6);background:var(--card,#fff);color:var(--ink,#1D1B16);font:inherit;font-size:15px;font-weight:600}.cbsi-soonrow .cbsi-said{margin:0 0 4px}' +
    '.cbsi .cbsi-ln{display:inline-block;background:none;border:0;padding:6px 0;color:var(--blue-i,var(--blue-d,#174A87));text-decoration:underline;text-underline-offset:3px;font:inherit;font-size:13.5px;cursor:pointer;text-align:start;min-height:40px}' +
    '.cbsi .cbsi-why{margin:0;padding:10px 13px;border-radius:10px;background:var(--red-t,#FBEAE3);border:1px solid var(--red-b,#E7B9A8);color:var(--red-i,#8E3517);font-size:13.5px}' +
    '.cbsi .cbsi-said{margin:0;font-size:13.5px;color:var(--muted,var(--grey,#5E594D))}' +
    '.cbsi .cbsi-in{margin:0;padding:12px 14px;border-radius:10px;background:var(--green-t,#E8F4ED);border:1px solid var(--green-b,#A9D3BC);color:var(--green-d,#0D4A2B);font-weight:600}' +
    '.cbsi .cbsi-ch{display:flex;align-items:center;gap:10px;min-height:52px;padding:8px 13px;border:1px solid var(--line,#DDD6C6);border-radius:10px;background:var(--card,#fff);color:inherit;font:inherit;cursor:pointer;text-align:start;width:100%}' +
    '.cbsi .cbsi-ch b{font-weight:700}.cbsi .cbsi-ch span{color:var(--muted,var(--grey,#5E594D));font-size:13px}' +
    '.cbsi .cbsi-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}';
  var cssDone = false;
  function addCss() {
    if (cssDone || !doc) return;
    cssDone = true;
    var node = doc.createElement('style');
    node.setAttribute('data-cbsi', '1');
    node.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(node);
  }

  function paint(host, m, c) {
    var S = m.state(),
      W = m.words,
      h = '';
    var why = S.why ? '<p class="cbsi-why" role="alert" data-testid="signin-why">' + esc(S.why) + '</p>' : '';
    var busy = S.busy ? ' disabled' : '';
    if (S.at === 'out') {
      var slots = m
        .methods()
        .map(function (item) {
          return (
            '<button data-cbsid="SCR054-B01" type="button" class="cbsi-m" data-cbsi="method" data-method="' +
            item +
            '" data-testid="signin-' +
            item +
            '">' +
            esc(METHODS[item].label) +
            '</button>'
          );
        })
        .join('');
      if (c.need !== 'customer' && c.surface !== 'till' && c.surface !== 'shop') slots += soonRow('signin', m.methods(), S.live);
      h =
        '<h2>' +
        esc(W.title) +
        '</h2>' +
        why +
        '<label>' +
        esc(W.id) +
        '<input data-cbsid="SCR054-I01" name="id" data-testid="signin-id" type="text" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" value="' +
        esc(S.typed) +
        '"></label>' +
        '<button data-cbsid="SCR054-B02" type="submit" class="cbsi-go" data-testid="signin-go"' +
        busy +
        '>' +
        esc(S.busy ? W.working : W.go) +
        '</button>' +
        slots +
        (c.registerHref
          ? '<a class="cbsi-ln" data-cbsi="register" data-testid="signin-register" href="' + esc(c.registerHref) + '">' + esc(W.register) + '</a>'
          : '');
    } else if (S.at === 'choose') {
      h =
        '<h2>' +
        esc(W.which) +
        '</h2>' +
        why +
        S.choices
          .map(function (item, index) {
            return (
              '<button data-cbsid="SCR054-B03" type="button" class="cbsi-ch" data-cbsi="choose" data-i="' +
              index +
              '" data-testid="signin-choice"><b>' +
              esc(item.name || item.id) +
              '</b><span>' +
              esc((W.kinds[item.kind] || item.kind || '') + (item.shop ? ' ' + W.at + ' ' + item.shop : '')) +
              '</span></button>'
            );
          })
          .join('') +
        '<button data-cbsid="SCR054-B04" type="button" class="cbsi-ln" data-cbsi="back" data-testid="signin-back">' +
        esc(W.back) +
        '</button>';
    } else if (S.at === 'credential') {
      var local = !!S.local,
        pin = local;
      /* a LOCAL credential is named for what it is (the counter PIN); its one other way on is the line, offered only when there is one */
      h =
        '<h2>' +
        esc(W.title) +
        '</h2>' +
        (S.said ? '<p class="cbsi-said" data-testid="signin-said">' + esc(S.said) + '</p>' : '') +
        why +
        '<label>' +
        esc(local ? W.localPin : W.secret) +
        /* UI element SGN-secret · path CBSignin.mount@<host page>›sign-in window›credential: the ONE masked box (testid kept: signin-code) */
        '<input data-cbsid="SCR054-I02" name="cred" data-el="CBSignin.secret@signin-ui.js›credential" data-testid="' +
        (pin ? 'signin-pin' : 'signin-code') +
        '" type="password" inputmode="numeric"' +
        (pin ? ' pattern="[0-9]*" maxlength="4"' : ' maxlength="64"') +
        ' autocomplete="one-time-code" enterkeyhint="go"></label>' +
        '<button data-cbsid="SCR054-B05" type="submit" class="cbsi-go" data-testid="signin-verify"' +
        busy +
        '>' +
        esc(S.busy ? W.working : W.verify) +
        '</button>' +
        '<div class="cbsi-row">' +
        (local ? '' : '<button data-cbsid="SCR054-B06" type="button" class="cbsi-ln" data-cbsi="again" data-testid="signin-again">' + esc(W.again) + '</button>') +
        (local && m.online() ? '<button data-cbsid="SCR054-B07" type="button" class="cbsi-ln" data-cbsi="line" data-testid="signin-line">' + esc(W.line) + '</button>' : '') +
        '<button data-cbsid="SCR054-B08" type="button" class="cbsi-ln" data-cbsi="back" data-testid="signin-back">' +
        esc(W.back) +
        '</button></div>';
    } else if (S.at === 'setpin') {
      var lp = !!S.localPin;
      h =
        '<h2>' +
        esc(lp ? W.localPin : W.setTitle) +
        '</h2><p class="cbsi-said">' +
        esc(lp ? W.localWhy : W.setWhy) +
        '</p>' +
        why +
        '<label>' +
        esc(W.pin1) +
        '<input data-cbsid="SCR054-I03" name="pin1" data-testid="signin-pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></label>' +
        '<label>' +
        esc(W.pin2) +
        '<input data-cbsid="SCR054-I04" name="pin2" data-testid="signin-pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" enterkeyhint="done"></label>' +
        '<button data-cbsid="SCR054-B09" type="submit" class="cbsi-go" data-testid="signin-pinsave"' +
        busy +
        '>' +
        esc(S.busy ? W.working : W.save) +
        '</button>' +
        (lp ? '<button data-cbsid="SCR054-B10" type="button" class="cbsi-ln" data-cbsi="later" data-testid="signin-later">' + esc(W.later) + '</button>' : '');
    } else if (S.at === 'in') {
      h = '<p class="cbsi-in" data-testid="signin-in">' + esc(S.said) + '</p>';
    }
    var nestedKeep = null;
    try {
      var ae = doc.activeElement;
      if (ae && host.contains(ae) && ae.name) nestedKeep = { name: ae.name, v: ae.value };
    } catch (_) { /* best effort: failing here changes nothing the user sees */ }
    host.innerHTML = '<div class="cbsi" data-testid="signin-window" data-at="' + esc(S.at) + '"><form novalidate autocomplete="on">' + h + '</form></div>';
    var first = host.querySelector('input');
    if (nestedKeep) {
      var same = host.querySelector('input[name="' + nestedKeep.name + '"]');
      if (same) {
        same.value = nestedKeep.v;
        try {
          same.focus({ preventScroll: true });
        } catch (_) { /* cosmetic (focus/scroll): nothing to recover */ }
      }
    } else if (first && S.at !== 'out') {
      try {
        first.focus({ preventScroll: true });
      } catch (_) { /* cosmetic (focus/scroll): nothing to recover */ }
    }
  }

  /* R45 (WALK-REG 2026-10-16): a register door on THIS page (settings.html#/new from settings.html) only moved the hash — the page had
   already chosen sign-in, so the form never came until a reload. Same page, other hash → load it afresh; another page → the plain link. */
  function goRegister(e, link) {
    try {
      var to = new URL(link.href, root.location.href),
        here = root.location;
      if (to.origin !== here.origin || to.pathname !== here.pathname) return;
      e.preventDefault();
      here.href = to.href;
      here.reload();
    } catch (err) {
      if (root.cbQuiet) root.cbQuiet('signin:register', err);
    }
  }
  /**
   * mount(host, contract) — the window, painted into `host`; the machine behind it is CBSignin.machine(contract).
   */
  /** the api address that sends this browser to the provider (a top-level visit; the device id rides in the address because a visit has no header) */
  function providerStart(c, key) {
    var dev = deviceOf(c);
    return dev && SOON.signin[key] ? (c.apiBase || '') + '/api/signin/provider/' + encodeURIComponent(key) + '/start?device_id=' + encodeURIComponent(dev) : '';
  }
  /** the providers the api says are ready: person windows only (never the till or a shop's customer; a host with its own transport keeps its own rules) */
  function askProviders(m, c) {
    if (c.need === 'customer' || c.surface === 'till' || c.surface === 'shop' || c.io || typeof root.fetch !== 'function') return;
    try {
      root
        .fetch((c.apiBase || '') + '/api/signin/providers', { cache: 'no-store' })
        .then(function (reply) { return reply.json(); })
        .then(function (j) { m.setLive(unwrap(j).providers); })
        .catch(function () {});
    } catch (_) {
      /* the list failing leaves every provider greyed, as before */
    }
  }
  function mount(host, c) {
    if (!host || !doc) return null;
    c = c || {};
    addCss();
    var m = machine(c, c.io);
    var off = m.onChange(function () {
      paint(host, m, c);
    });
    function onSubmit(e) {
      if (!host.contains(e.target)) return;
      e.preventDefault();
      var S = m.state(),
        f = e.target;
      if (S.busy) return;
      if (S.at === 'out') {
        m.typed(f.id ? f.id.value : '');
        m.go();
      } else if (S.at === 'credential') m.verify(f.cred ? f.cred.value : '');
      else if (S.at === 'setpin') m.setPin(f.pin1 ? f.pin1.value : '', f.pin2 ? f.pin2.value : '');
    }
    function onClick(e) {
      var node = e.target && e.target.closest ? e.target.closest('[data-cbsi]') : null;
      if (!node || !host.contains(node)) return;
      var k = node.getAttribute('data-cbsi');
      if (k === 'choose') m.choose(Number(node.getAttribute('data-i')));
      else if (k === 'again') m.again();
      else if (k === 'back') m.back();
      else if (k === 'line') m.line();
      else if (k === 'later') m.later();
      else if (k === 'method' && typeof c.onMethod === 'function') c.onMethod(node.getAttribute('data-method'));
      else if (k === 'provider') {
        var go = providerStart(c, node.getAttribute('data-provider'));
        if (go && root.location) root.location.assign(go);
      } else if (k === 'register') goRegister(e, node);
    }
    function onInput(e) {
      if (host.contains(e.target) && e.target.name === 'id') m.typed(e.target.value);
    }
    doc.addEventListener('submit', onSubmit);
    doc.addEventListener('click', onClick);
    doc.addEventListener('input', onInput);
    paint(host, m, c);
    askProviders(m, c);
    var landed = c.need !== 'customer' && c.surface !== 'till' && c.surface !== 'shop' && !c.io ? LANDED : null;
    if (landed) {
      LANDED = null;
      if (landed.kind === 'h') m.providerHandoff(landed.value);
      else if (landed.kind === 'e') m.refuse(m.words.sso[landed.value] || m.words.sso.fallback);
      else LANDED = landed; /* a connect result belongs to Settings, not to a sign-in window */
    }
    return {
      destroy: function () {
        m.close();
        off();
        doc.removeEventListener('submit', onSubmit);
        doc.removeEventListener('click', onClick);
        doc.removeEventListener('input', onInput);
        host.innerHTML = '';
      },
      state: function () {
        return m.state();
      },
      machine: m
    };
  }

  /* ⭐ ONE GLOBAL — the engine's, widened: mount and what mount is made of (for tests and the lab), never a second CBSignin */
  E.mount = mount;
  E.machine = machine;
  E.sessionOf = sessionOf;
  /* STD2: the ONE writer of the apps' session (cb_sess, with `duty`) — settings.html's New shop keeps it here too.
   ⚠️ NOT E.keep: E is the ENGINE (engine/signin.js), whose keep(surface, answer) the counter calls; assigning over it broke every till
   sign-in (14 Oct, till-pin and 10 more walks). [[feedback-namespace-after-assignment]] */
  E.keepSession = keep;
  E.takeLanded = takeLanded;
  E.jwtClaims = jwtClaims;
  E.transport = httpPost; /* the default transport, for a host that wraps it (the till: "offline" said in words first) */
  E.METHODS = METHODS;
  E.soonRow = soonRow;
  E.providerStart = providerStart;
  E.WORDS = WORDS;
  if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
