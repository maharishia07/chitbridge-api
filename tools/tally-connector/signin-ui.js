/* signin-ui.js — CBSignin.mount: THE ONE SIGN-IN WINDOW, for every app (M14, DECISIONS 2026-10-08).
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
 *     deviceId,                     // OPTIONAL. A string or () => string. Given → X-Device-Id rides every sign-in call and the server
 *                                   //   mints a LISTED, revocable session bound to this device (M05) — ONLY for a host whose every
 *                                   //   later call also sends X-Device-Id (the till does; auth answers 401 DEVICE_MISMATCH otherwise).
 *                                   //   Absent → today's token (7 d, unlisted), exactly what app.html's own login gets.
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
 *   out ──go()──► credential (need code | pin)  ──verify()──► in
 *     └─(409 CHOOSE_IDENTITY)──► choose ──choose(i)──► (re-asks with the STORED id, grammar and all) ──► credential
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
  setTitle: 'Choose a PIN',
  setWhy: 'Four digits. You will use it next time.',
  pin1: 'Your new PIN',
  pin2: 'Type it again',
  save: 'Save PIN',
  signedIn: function (name) { return name + ' is signed in.'; },
  sent: 'Code sent.',
  noAccount: 'No account found. Check the number or e-mail.',
  tooMany: 'Too many tries. Wait 15 minutes.',
  working: 'Working…',
  register: 'New shop? Register',
  pinName: 'Your PIN',
  kinds: { owner: 'owner', employee: 'employee', customer: 'customer' },
  at: 'at',
  /* the host's own credential (the till's counter PIN) — the same screens, named for what they are */
  localPin: 'Counter PIN',
  localWhy: 'Four digits, to sign in here without the internet.',
  line: 'Use a code instead',
  later: 'Not now',
};

/**
 * ⭐ THE METHOD SLOTS (DECISIONS 2026-10-08: every sign-in method lives only in CBSignin). A slot is CONFIG, hidden by default:
 * a button is drawn only when the host switches the slot on (contract.methods[name] === true) AND gives onMethod — so nothing on
 * screen ever promises a provider that is not wired. The names are b282's method CHECK (google · apple · microsoft · passkey) + sso.
 */
var METHODS = {
  google:    { label: 'Continue with Google' },
  apple:     { label: 'Continue with Apple' },
  microsoft: { label: 'Continue with Microsoft' },
  sso:       { label: 'Use company account' },
  passkey:   { label: 'Use your passkey' },
};
function methodsOn(c) {
  var on = (c && c.methods) || {};
  return typeof (c && c.onMethod) === 'function' ? Object.keys(METHODS).filter(function (k) { return on[k] === true; }) : [];
}

/* ── small helpers ──────────────────────────────────────────────────────────────────────────────────────────────── */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function jwtClaims(t) {
  try { var p = String(t || '').split('.')[1]; if (!p) return {}; p = p.replace(/-/g, '+').replace(/_/g, '/'); while (p.length % 4) p += '=';
    var s = typeof root.atob === 'function' ? root.atob(p) : Buffer.from(p, 'base64').toString('utf8');
    return JSON.parse(decodeURIComponent(Array.prototype.map.call(s, function (ch) { return '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2); }).join(''))) || {};
  } catch (_) { return {}; }
}
/** the {ok,data,error} envelope, when a host wraps it (core.js unwrap) — the sign-in routes answer bare JSON */
function unwrap(j) { return (j && typeof j === 'object' && 'ok' in j && ('data' in j || 'error' in j)) ? (j.ok ? (j.data || {}) : Object.assign({}, j, j.error && typeof j.error === 'object' ? j.error : {})) : (j || {}); }
function deviceOf(c) {
  var d = c && c.deviceId;
  if (typeof d === 'function') { try { d = d(); } catch (_) { d = null; } }
  return d ? String(d) : null;
}
/** the default transport: fetch. A host (the lab, a test) may hand its own io.post(path, body, token) → { status, body }. */
function httpPost(c) {
  return function (path, body, token) {
    var h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    var dev = deviceOf(c);
    if (dev) { h['X-Device-Id'] = dev; body = Object.assign({}, body, { device_id: dev, surface: c.surface || 'web' }); }
    return root.fetch((c.apiBase || '') + path, { method: 'POST', headers: h, body: JSON.stringify(body), cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: unwrap(j) }; }); })
      .catch(function () { return { status: 0, body: {} }; });
  };
}

/**
 * sessionOf(answer) — the ONE reading of a verify answer into the session the apps keep (app.html sessPersist's shape:
 * token · role · name · entity · bridgeId · duty) plus what the window learned (person, exp, device_id, surface, jti).
 */
function sessionOf(r) {
  var a = r || {}, claims = jwtClaims(a.token), id = a.identity || a.entity || a.actor || {};
  var role = claims.identity_type || id.identity_type || 'entity';
  var name = id.display_name || claims.display_name || '';
  var entity = role === 'entity' ? name : (claims.parent_entity_name || (a.actor && a.actor.parent_entity) || '');
  var bridgeId = role === 'entity' ? (id.bridge_id || claims.bridge_id || '') : (claims.parent_bridge_id || id.bridge_id || '');
  var s = { token: a.token || '', role: role, name: name, entity: entity, bridgeId: bridgeId,
    person: { id: id.user_id || claims.identity_id || null, identity_id: id.identity_id || claims.identity_id || null,
              kind: role === 'actor' ? 'employee' : role === 'customer' ? 'customer' : 'owner', shop: id.entity_id || claims.parent_entity_id || claims.identity_id || null },
    exp: claims.exp || null, device_id: claims.device_id || null, surface: claims.surface || null, jti: claims.jti || null };
  if (role === 'actor') s.duty = 'duty';
  return s;
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
    try { (own ? store : (root.sessionStorage || store)).setItem('cb_cust@' + shop, JSON.stringify({ token: s.token, name: s.name })); } catch (_) {}
    return;
  }
  var sess = { token: s.token, role: s.role, name: s.name, entity: s.entity, bridgeId: s.bridgeId };
  if (s.duty) sess.duty = s.duty;
  try { store.setItem('cb_sess', JSON.stringify(sess)); } catch (_) {}
  try { if (!own && root.CBOnePerson && root.CBOnePerson.claim) root.CBOnePerson.claim(root.CBOnePerson.who(sess)); } catch (_) {}
}

/* ── the state machine ──────────────────────────────────────────────────────────────────────────────────────────── */
function machine(c, io) {
  c = c || {}; io = io || {};
  var W = Object.assign({}, WORDS, c.words || {});
  var post = io.post || httpPost(c);
  var S = { at: 'out', typed: '', kind: '', need: '', resolved: '', sent: null, choices: [], why: '', said: '', busy: false,
            token: null, session: null, asks: 0, verifies: 0,
            /* the host's local credential (c.local): the entry found for the typed id; viaLine = the person chose the line instead;
               localPin = the setpin screen is for the LOCAL book, not the server */
            local: null, viaLine: false, localPin: false };
  var L = (c.local && typeof c.local.find === 'function' && typeof c.local.check === 'function') ? c.local : null;
  function onLine() { if (typeof c.online !== 'function') return true; try { return !!c.online(); } catch (_) { return true; } }
  /** a person proved by the host's own credential: no token, no session — an identity, exactly what a counter keeps */
  function localSession(p) {
    p = p || {};
    var kind = p.kind === 'entity' ? 'owner' : (p.kind || 'employee');
    return { token: '', role: kind === 'owner' ? 'entity' : 'actor', name: p.name || '', entity: '', bridgeId: '',
             person: { id: p.id || null, identity_id: p.identity_id || p.id || null, kind: kind, shop: p.entity || null },
             exp: null, device_id: null, surface: c.surface || null, jti: null, local: true };
  }
  var subs = [];
  function emit() { subs.forEach(function (fn) { try { fn(S); } catch (_) {} }); }
  function set(p) { Object.assign(S, p); emit(); return S; }
  function refusalOf(r) {
    var b = r.body || {}, code = b.code;
    if (code === 'NO_ACCOUNT') return W.noAccount;
    if (r.status === 429) return W.tooMany;
    /* a NAMED refusal (DEVICE_REVOKED, AMBIGUOUS_NAME, …) already carries the sentence the server chose — say that, not "wrong code" */
    if (code && b.message) return String(b.message);
    return E.refusal({ status: r.status, message: b.message || b.error });
  }
  function needOf(b) { return b.need === 'pin' || b.use_pin === true ? 'pin' : 'code'; }
  function kindOf(b) { return b.kind === 'actor' ? 'employee' : b.kind === 'customer' ? 'customer' : b.kind === 'entity' ? 'owner' : (b.kind || ''); }

  /** ask the server about an id. `typedId` is what the person typed, or (stored) the STORED id the chooser handed back — sent as
   *  `id` whole, so a .br / .cr handle is never split by the e-mail shape it happens to have. */
  function askFor(typedId, stored) {
    var a = stored ? { ok: true, body: { mode: 'login', id: String(typedId) }, say: W.sent } : E.ask(typedId);
    if (!a.ok) { set({ why: a.why }); return Promise.resolve(S); }
    set({ busy: true, why: '' });
    S.asks++;
    return post('/api/signin/ask', a.body).then(function (r) {
      var b = r.body || {};
      if (r.status === 409 && b.code === 'CHOOSE_IDENTITY' && Array.isArray(b.choices) && b.choices.length) {
        return set({ busy: false, at: 'choose', choices: b.choices, said: b.message || '' });
      }
      if (r.status < 200 || r.status >= 300) return set({ busy: false, why: refusalOf(r) });
      var resolved = String(b.id || b.user_id || b.handle || a.body.id || a.body.email || a.body.user_id || typedId);
      return set({ busy: false, at: 'credential', need: needOf(b), kind: kindOf(b), resolved: resolved,
                   sent: needOf(b) === 'code' ? { id: resolved, typed: String(typedId), kind: kindOf(b), at: Date.now() } : null,
                   said: needOf(b) === 'pin' ? '' : (b.message || a.say || W.sent) });
    });
  }
  function go() {
    if (S.at === 'in') return Promise.resolve(S);           /* signed in: nothing asks */
    var w = E.who(S.typed);
    if (!w.ok) { set({ why: w.why }); return Promise.resolve(S); }
    /* ⚠️ a code already on its way for this very id: no second ask — back to the box that takes it */
    if (S.sent && S.at !== 'in' && (w.value === S.sent.typed || w.value === S.sent.id)) {
      return Promise.resolve(set({ at: 'credential', need: 'code', kind: S.sent.kind, resolved: S.sent.id, why: '', said: W.sent }));
    }
    /* ⭐ THE HOST'S OWN CREDENTIAL FIRST (the till's counter PIN, SPEC-counter-identity §3): somebody who set one here signs in
       with it, line or no line — the shift change that happens forty times a day needs no code in a mailbox. Nothing is posted. */
    if (L && !S.viaLine) {
      var e = null; try { e = L.find(w.value); } catch (_) { e = null; }
      if (e) return Promise.resolve(set({ at: 'credential', need: 'pin', local: e, kind: e.kind || '', resolved: w.value, why: '', said: '' }));
    }
    return askFor(w.value);
  }
  function choose(i) {
    var ch = S.choices[i]; if (!ch) return Promise.resolve(S);
    return askFor(String(ch.id), true);
  }
  function verify(cred) {
    var code = E.code(cred);
    if (!code.ok) { set({ why: code.why }); return Promise.resolve(S); }
    if (S.need === 'pin' && !code.isPin) { set({ why: E.pinShape('', W.pinName).why }); return Promise.resolve(S); }
    if (S.need === 'code' && code.isPin) { set({ why: 'A code is six digits.' }); return Promise.resolve(S); }
    /* ⭐ the host judges its own credential (the engine's pinAfter, in the host's book) — no network, whatever the line is doing */
    if (S.local && L) {
      set({ busy: true, why: '' });
      S.verifies++;
      return Promise.resolve().then(function () { return L.check(S.local, code.value); }).then(function (a) {
        a = a || {};
        if (!a.ok) {
          /* locked: back to the box — the line is the only way on from here */
          if (a.locked) return set({ busy: false, at: 'out', local: null, need: '', resolved: '', why: a.why || '' });
          return set({ busy: false, local: a.entry || S.local, why: a.why || '' });
        }
        return signedIn(localSession(a.person), null);
      }, function (x) { return set({ busy: false, why: (x && x.message) || 'The PIN could not be checked.' }); });
    }
    var body = { id: S.resolved }; body[code.isPin ? 'pin' : 'otp'] = code.value;
    set({ busy: true, why: '' });
    S.verifies++;
    return post('/api/signin/verify', body).then(function (r) {
      var b = r.body || {};
      if (r.status === 409 && b.code === 'CHOOSE_IDENTITY' && Array.isArray(b.choices)) return set({ busy: false, at: 'choose', choices: b.choices });
      if (r.status < 200 || r.status >= 300 || !b.token) return set({ busy: false, why: refusalOf(r) });
      var s = sessionOf(b);
      S.sent = null;                                   /* ⚠️ the code is spent: nothing here asks for it again */
      S.answer = b;                                    /* the verify body as it came — handed to onIn beside the session */
      if (b.requires_pin_setup === true) return set({ busy: false, at: 'setpin', localPin: false, token: b.token, session: s, said: W.setWhy });
      return signedIn(s, b);
    });
  }
  function setPin(a, b) {
    var p = E.pinPair(a, b, S.localPin ? W.localPin : W.pinName);
    if (!p.ok) { set({ why: p.why }); return Promise.resolve(S); }
    set({ busy: true, why: '' });
    /* ⭐ the LOCAL book (offerPin): the host keeps it — a salt and a hash under the shop, never the PIN. Already signed in; no onIn again. */
    if (S.localPin && L && typeof L.save === 'function') {
      return Promise.resolve().then(function () { return L.save(S.session, p.value); }).then(function (r) {
        if (!r || !r.ok) return set({ busy: false, why: (r && r.why) || 'The PIN could not be kept.' });
        return set({ busy: false, at: 'in', localPin: false, said: W.signedIn(S.session.name || S.session.person.id || '') });
      }, function (x) { return set({ busy: false, why: (x && x.message) || 'The PIN could not be kept.' }); });
    }
    return post('/api/signin/pin', { pin: p.value, confirm_pin: p.value }, S.token).then(function (r) {
      if (r.status < 200 || r.status >= 300) return set({ busy: false, why: refusalOf(r) });
      return signedIn(S.session, S.answer || null);
    });
  }
  function signedIn(s, answer) {
    keep(c, s, io.store);
    set({ busy: false, at: 'in', session: s, token: s.token, local: null, viaLine: false, said: W.signedIn(s.name || s.person.id || '') });
    if (typeof c.onIn === 'function') { try { c.onIn(s, answer || null); } catch (_) {} }
    return S;
  }
  /** the host asks for a LOCAL PIN to be chosen (the till, after an online sign-in, when the person has none here) — once in, only */
  function offerPin(given) {
    /* `given` (optional): a person the host already holds as signed in — the till after a reload, whose token went on the key */
    if (given && S.at !== 'in') set({ at: 'in', session: given, token: given.token || null, said: W.signedIn(given.name || (given.person && given.person.id) || '') });
    if (S.at !== 'in' || !S.session || !L || typeof L.save !== 'function') return Promise.resolve(S);
    var has = false; try { has = typeof L.has === 'function' ? !!L.has(S.session.person) : false; } catch (_) { has = false; }
    if (has) return Promise.resolve(S);
    return Promise.resolve(set({ at: 'setpin', localPin: true, why: '', said: W.localWhy }));
  }
  /** "Not now" — only the LOCAL offer may be skipped; the server's requires_pin_setup is not a choice */
  function later() { if (S.at === 'setpin' && S.localPin) set({ at: 'in', localPin: false, why: '' }); return Promise.resolve(S); }
  /** "Use a code instead" — the same person, through the line (e.g. a forgotten counter PIN, reset by a real sign-in) */
  function line() {
    if (!S.local || !onLine()) return Promise.resolve(S);
    var id = S.resolved; set({ local: null, viaLine: true, need: '', why: '' });
    return askFor(id);
  }
  /** a sentence the host wants on the box (e.g. the picker: "no counter PIN for X yet") — words only, no state change */
  function refuse(why) { return set({ why: String(why || '') }); }
  /** "Send a new code" — the ONE way a second code is asked for, and only while a code box is open */
  function again() {
    if (S.at !== 'credential' || S.need !== 'code' || !S.resolved) return Promise.resolve(S);
    return askFor(S.resolved, true);
  }
  /** back to the box. `sent` is KEPT: the code already on its way is remembered, so Continue with the same id does not ask twice */
  function back() { return set({ at: 'out', typed: '', kind: '', need: '', resolved: '', choices: [], why: '', said: '', token: null }); }
  return {
    state: function () { return S; },
    onChange: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (x) { return x !== fn; }); }; },
    typed: function (v) { S.typed = String(v == null ? '' : v); return S; },
    go: go, choose: choose, verify: verify, setPin: setPin, again: again, back: back,
    offerPin: offerPin, later: later, line: line, refuse: refuse, online: onLine,
    methods: function () { return methodsOn(c); },
    words: W,
  };
}

/* ── the paint ──────────────────────────────────────────────────────────────────────────────────────────────────── */
var CSS = '.cbsi{max-width:420px;margin:0 auto;font:inherit;color:var(--ink,#1D1B16);background:var(--card,#fff);border:1px solid var(--line,#DDD6C6);border-radius:15px;padding:18px 19px;box-sizing:border-box}' +
  '.cbsi form{display:flex;flex-direction:column;gap:10px}' +
  '.cbsi h2{font-size:19px;font-weight:800;margin:0 0 2px;letter-spacing:-.01em}' +
  '.cbsi label{display:flex;flex-direction:column;gap:5px;font-size:13.5px;font-weight:600;color:var(--muted,#5E594D)}' +
  '.cbsi input{height:46px;padding:0 13px;border:1px solid var(--line,#DDD6C6);border-radius:10px;background:var(--card,#fff);color:var(--ink,#1D1B16);font:inherit;font-size:16px;width:100%;box-sizing:border-box}' +
  '.cbsi input:focus{outline:2px solid var(--green,#16693F);outline-offset:1px}' +
  '.cbsi .cbsi-go,.cbsi .cbsi-m{height:46px;padding:0 16px;border-radius:10px;border:1px solid var(--green,#16693F);background:var(--green,#16693F);color:var(--on-green,#fff);font:inherit;font-size:15px;font-weight:700;cursor:pointer;width:100%}' +
  '.cbsi .cbsi-go[disabled]{opacity:.6;cursor:default}' +
  '.cbsi .cbsi-m{background:var(--card,#fff);color:var(--ink,#1D1B16);border-color:var(--line,#DDD6C6)}' +
  '.cbsi .cbsi-ln{display:inline-block;background:none;border:0;padding:6px 0;color:var(--blue-i,#174A87);text-decoration:underline;text-underline-offset:3px;font:inherit;font-size:13.5px;cursor:pointer;text-align:start;min-height:40px}' +
  '.cbsi .cbsi-why{margin:0;padding:10px 13px;border-radius:10px;background:var(--red-t,#FBEAE3);border:1px solid var(--red-b,#E7B9A8);color:var(--red-i,#8E3517);font-size:13.5px}' +
  '.cbsi .cbsi-said{margin:0;font-size:13.5px;color:var(--muted,#5E594D)}' +
  '.cbsi .cbsi-in{margin:0;padding:12px 14px;border-radius:10px;background:var(--green-t,#E8F4ED);border:1px solid var(--green-b,#A9D3BC);color:var(--green-d,#0D4A2B);font-weight:600}' +
  '.cbsi .cbsi-ch{display:flex;align-items:center;gap:10px;min-height:52px;padding:8px 13px;border:1px solid var(--line,#DDD6C6);border-radius:10px;background:var(--card,#fff);color:inherit;font:inherit;cursor:pointer;text-align:start;width:100%}' +
  '.cbsi .cbsi-ch b{font-weight:700}.cbsi .cbsi-ch span{color:var(--muted,#5E594D);font-size:13px}' +
  '.cbsi .cbsi-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}';
var cssDone = false;
function addCss() { if (cssDone || !doc) return; cssDone = true; var s = doc.createElement('style'); s.setAttribute('data-cbsi', '1'); s.textContent = CSS; (doc.head || doc.documentElement).appendChild(s); }

function paint(host, m, c) {
  var S = m.state(), W = m.words, h = '';
  var why = S.why ? '<p class="cbsi-why" role="alert" data-testid="signin-why">' + esc(S.why) + '</p>' : '';
  var busy = S.busy ? ' disabled' : '';
  if (S.at === 'out') {
    var slots = m.methods().map(function (k) { return '<button type="button" class="cbsi-m" data-cbsi="method" data-method="' + k + '" data-testid="signin-' + k + '">' + esc(METHODS[k].label) + '</button>'; }).join('');
    h = '<h2>' + esc(W.title) + '</h2>' + why +
      '<label>' + esc(W.id) + '<input name="id" data-testid="signin-id" type="text" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" value="' + esc(S.typed) + '"></label>' +
      '<button type="submit" class="cbsi-go" data-testid="signin-go"' + busy + '>' + esc(S.busy ? W.working : W.go) + '</button>' + slots +
      (c.registerHref ? '<a class="cbsi-ln" data-testid="signin-register" href="' + esc(c.registerHref) + '">' + esc(W.register) + '</a>' : '');
  } else if (S.at === 'choose') {
    h = '<h2>' + esc(W.which) + '</h2>' + why +
      S.choices.map(function (ch, i) {
        return '<button type="button" class="cbsi-ch" data-cbsi="choose" data-i="' + i + '" data-testid="signin-choice"><b>' + esc(ch.name || ch.id) + '</b><span>' + esc((W.kinds[ch.kind] || ch.kind || '') + (ch.shop ? ' ' + W.at + ' ' + ch.shop : '')) + '</span></button>';
      }).join('') +
      '<button type="button" class="cbsi-ln" data-cbsi="back" data-testid="signin-back">' + esc(W.back) + '</button>';
  } else if (S.at === 'credential') {
    var pin = S.need === 'pin', local = !!S.local;
    /* a LOCAL credential is named for what it is (the counter PIN); its one other way on is the line, offered only when there is one */
    h = '<h2>' + esc(W.title) + '</h2>' + (S.said ? '<p class="cbsi-said" data-testid="signin-said">' + esc(S.said) + '</p>' : '') + why +
      '<label>' + esc(local ? W.localPin : pin ? W.pin : W.code) + '<input name="cred" data-testid="' + (pin ? 'signin-pin' : 'signin-code') + '" type="' + (pin ? 'password' : 'text') + '" inputmode="numeric" pattern="[0-9]*" maxlength="' + (pin ? 4 : 6) + '" autocomplete="one-time-code" enterkeyhint="go"></label>' +
      '<button type="submit" class="cbsi-go" data-testid="signin-verify"' + busy + '>' + esc(S.busy ? W.working : W.verify) + '</button>' +
      '<div class="cbsi-row">' + (pin ? '' : '<button type="button" class="cbsi-ln" data-cbsi="again" data-testid="signin-again">' + esc(W.again) + '</button>') +
      (local && m.online() ? '<button type="button" class="cbsi-ln" data-cbsi="line" data-testid="signin-line">' + esc(W.line) + '</button>' : '') +
      '<button type="button" class="cbsi-ln" data-cbsi="back" data-testid="signin-back">' + esc(W.back) + '</button></div>';
  } else if (S.at === 'setpin') {
    var lp = !!S.localPin;
    h = '<h2>' + esc(lp ? W.localPin : W.setTitle) + '</h2><p class="cbsi-said">' + esc(lp ? W.localWhy : W.setWhy) + '</p>' + why +
      '<label>' + esc(W.pin1) + '<input name="pin1" data-testid="signin-pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></label>' +
      '<label>' + esc(W.pin2) + '<input name="pin2" data-testid="signin-pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" enterkeyhint="done"></label>' +
      '<button type="submit" class="cbsi-go" data-testid="signin-pinsave"' + busy + '>' + esc(S.busy ? W.working : W.save) + '</button>' +
      (lp ? '<button type="button" class="cbsi-ln" data-cbsi="later" data-testid="signin-later">' + esc(W.later) + '</button>' : '');
  } else if (S.at === 'in') {
    h = '<p class="cbsi-in" data-testid="signin-in">' + esc(S.said) + '</p>';
  }
  var keep = null;
  try { var ae = doc.activeElement; if (ae && host.contains(ae) && ae.name) keep = { name: ae.name, v: ae.value }; } catch (_) {}
  host.innerHTML = '<div class="cbsi" data-testid="signin-window" data-at="' + esc(S.at) + '"><form novalidate autocomplete="on">' + h + '</form></div>';
  var first = host.querySelector('input');
  if (keep) { var same = host.querySelector('input[name="' + keep.name + '"]'); if (same) { same.value = keep.v; try { same.focus({ preventScroll: true }); } catch (_) {} } }
  else if (first && S.at !== 'out') { try { first.focus({ preventScroll: true }); } catch (_) {} }
}

/**
 * mount(host, contract) — the window, painted into `host`; the machine behind it is CBSignin.machine(contract).
 */
function mount(host, c) {
  if (!host || !doc) return null;
  c = c || {};
  addCss();
  var m = machine(c, c.io);
  var off = m.onChange(function () { paint(host, m, c); });
  function onSubmit(e) {
    if (!host.contains(e.target)) return;
    e.preventDefault();
    var S = m.state(), f = e.target;
    if (S.busy) return;
    if (S.at === 'out') { m.typed(f.id ? f.id.value : ''); m.go(); }
    else if (S.at === 'credential') m.verify(f.cred ? f.cred.value : '');
    else if (S.at === 'setpin') m.setPin(f.pin1 ? f.pin1.value : '', f.pin2 ? f.pin2.value : '');
  }
  function onClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-cbsi]') : null;
    if (!t || !host.contains(t)) return;
    var k = t.getAttribute('data-cbsi');
    if (k === 'choose') m.choose(Number(t.getAttribute('data-i')));
    else if (k === 'again') m.again();
    else if (k === 'back') m.back();
    else if (k === 'line') m.line();
    else if (k === 'later') m.later();
    else if (k === 'method' && typeof c.onMethod === 'function') c.onMethod(t.getAttribute('data-method'));
  }
  function onInput(e) { if (host.contains(e.target) && e.target.name === 'id') m.typed(e.target.value); }
  doc.addEventListener('submit', onSubmit);
  doc.addEventListener('click', onClick);
  doc.addEventListener('input', onInput);
  paint(host, m, c);
  return {
    destroy: function () { off(); doc.removeEventListener('submit', onSubmit); doc.removeEventListener('click', onClick); doc.removeEventListener('input', onInput); host.innerHTML = ''; },
    state: function () { return m.state(); },
    machine: m,
  };
}

/* ⭐ ONE GLOBAL — the engine's, widened: mount and what mount is made of (for tests and the lab), never a second CBSignin */
E.mount = mount;
E.machine = machine;
E.sessionOf = sessionOf;
E.jwtClaims = jwtClaims;
E.transport = httpPost;          /* the default transport, for a host that wraps it (the till: "offline" said in words first) */
E.METHODS = METHODS;
E.WORDS = WORDS;
if (typeof module !== 'undefined' && module.exports) module.exports = E;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
