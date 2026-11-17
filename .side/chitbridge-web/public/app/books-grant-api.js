/**
 * books-grant-api.js — ACC-176: THE ONE WAY THE WEB TALKS TO A BOOKS GRANT (the member's doors and the auditor's reads).
 *
 * OWNS      the endpoint registry of the grant screens (the member's /api/books-grants doors, the adviser's /api/books-actions doors, the six reads an auditor opens, the X-Books-For and X-Books-Role headers) and the one function that makes a call from it; what a grant's state means in words; what each refusal CODE says in a plain sentence
 * CALLED BY books-grant-member.js · books-grant-view.js · books-actions-view.js · books-acting.js · network-app.js (the "Open books" column)
 * FLOW      run(call, key, { params, query, body, headers }) → the page's own call() (network-app.js: token, base, 401 → sign-in) → the server's answer, or an Error whose message is the refusal in plain words; held(call) → { member entity id: live grant } for the auditor's and the adviser's list
 * CARD      04-network/ACC-176-AUDITOR-GRANT · 04-network/ACC-176B-ADVISER-REQUIREMENT
 *
 * Decides nothing: who may grant, who may look, who may prepare, review or accept, and why not, are the server's answers (api PRs #1302, #1313). The web reads a grant's `state` code and a refusal's `code` and says them in words.
 *   CBBooksGrantApi.run · .held · .withHeld · .stateWords · .refusalWords · .HEADER · .ROLE_HEADER
 */
(function (root) {
  'use strict';
  /* ⭐ the endpoint registry — the ONE declaration shape (accounts-shell.js) the round-trip scanner reads */
  var ENDPOINTS = {
    grantsList: { m: 'GET', p: '/api/books-grants' } /* { given, received }: each row with its state (live · revoked · expired · edge_off) */,
    grantsConsent: { m: 'GET', p: '/api/books-grants/consent' } /* the plain words a member reads before it says yes */,
    grantsGive: { m: 'POST', p: '/api/books-grants' },
    grantsChange: { m: 'PATCH', p: '/api/books-grants/:id' },
    grantsRevoke: { m: 'POST', p: '/api/books-grants/:id/revoke' },
    grantsLog: { m: 'GET', p: '/api/books-grants/log' } /* who looked at what, when — never the figures */,
    practiceBaseline: { m: 'POST', p: '/api/books-grants/practice/baseline' } /* rank 10: { client, seen_to } the person's own Mark as checked; the firm's call, never sent under X-Books-For */,
    actionsList: { m: 'GET', p: '/api/books-actions' } /* { actions, total, page, limit }: state · mine · delegated · since · page · limit narrow it */,
    actionsGet: { m: 'GET', p: '/api/books-actions/:id' } /* one action with its steps[] */,
    actionsReview: { m: 'POST', p: '/api/books-actions/:id/review' } /* { store_id, body_hash }: a colleague of the preparer */,
    actionsReturn: { m: 'POST', p: '/api/books-actions/:id/return' } /* { store_id, body_hash, reason } */,
    actionsAccept: { m: 'POST', p: '/api/books-actions/:id/accept', idem: 'attempt' } /* the owner only: { store_id, body_hash, total_minor, currency } */
  };
  /* the six books reads an auditor opens. Plain paths on purpose: the endpoint registry already names each one (cap-books.js booksTB · booksPL · booksBS · booksDaybook · booksPeriods, accounts-shell.js booksDues) and
     ep-aliases.cjs fails an endpoint with two names; this page reads them with a header the books page never sends. */
  var READS = { readTB: '/api/books/trial-balance', readPL: '/api/books/pl', readBS: '/api/books/bs', readDaybook: '/api/books/daybook', readLedger: '/api/books/ledger/:account', readDues: '/api/books/dues', readPeriods: '/api/books/periods' };
  var HEADER = 'X-Books-For'; /* names the member whose books are read; the server checks it against a live grant */
  var ROLE_HEADER = 'X-Books-Role'; /* `adviser` picks the member's adviser grant; absent is the auditor's (read only) */
  var STATE = { live: 'Open', revoked: 'Ended', expired: 'Ran out', edge_off: 'Paused: not connected now' };

  /** a refusal's code → the plain sentence (what happened · what it means · what to do); a code not listed keeps the server's own words */
  var REFUSALS = {
    ACTION_SELF_REVIEW: 'You prepared this, so a colleague has to review it. Nothing changed.',
    ACTION_NOT_REVIEWED: 'A colleague has to review this before you accept it. Nothing was posted.',
    ACTION_BODY_CHANGED: 'This is not the entry you were shown. Open it again. Nothing was saved.',
    ACTION_ACCESS_ENDED: 'The access this was prepared under has ended. You can send it back.',
    ACTION_REF_OPEN: 'An action with this reference is already waiting. Open it from the queue.',
    ACTION_REF_POSTED: 'This reference is already posted. It is not prepared again.',
    ACTION_DUPLICATE: 'This was already posted. Nothing was posted again.',
    ACTION_CLOSED: 'This action has already moved on. Open the queue again.',
    ACTION_REASON_NEEDED: 'Say why in 3 to 300 characters. Nothing was sent back.',
    ACTION_FIRM_ONLY: 'Only the accountant\'s firm prepares and reviews. The owner accepts.',
    ACTION_NOT_FOR_YOU: 'Only the owner and the accountant\'s firm work on these actions.',
    OWNER_ONLY: 'Only the owner accepts an action. You can send it back.',
    STORE_MISMATCH: 'This page is open on another store than the one you are working in. Nothing was saved. Open the store again.',
    PREVIEW_TOTAL_DIFFERS: 'The total changed since it was prepared. Nothing was posted. Open it again.',
    BOOKS_ACTION_NOT_SWITCHED_ON: 'Accountant actions are not switched on yet. Nothing was changed.'
  };
  function words(s) {
    return typeof root.tx === 'function' ? root.tx(s) : s;
  }
  function pathOf(key, params) {
    var path = ENDPOINTS[key] ? ENDPOINTS[key].p : READS[key];
    Object.keys(params || {}).forEach(function (name) {
      path = path.replace(':' + name, encodeURIComponent(params[name]));
    });
    return path;
  }
  function queryOf(query) {
    var parts = Object.keys(query || {})
      .filter(function (name) {
        return query[name] !== '' && query[name] != null;
      })
      .map(function (name) {
        return encodeURIComponent(name) + '=' + encodeURIComponent(query[name]);
      });
    return parts.length ? '?' + parts.join('&') : '';
  }
  /** a failure with a known refusal code says its plain sentence (the status stays, so a 4xx is still shown as the server's reason); any other failure is passed on untouched */
  function refusalWords(failure) {
    var sentence = failure && REFUSALS[failure.code];
    return sentence ? words(sentence) : (failure && failure.message) || '';
  }
  function phrased(failure) {
    if (failure && REFUSALS[failure.code]) failure.message = refusalWords(failure);
    throw failure;
  }
  /** run(call, key, { params, query, body, headers }) → the server's answer; `call` is the page's own (token, base, 401) */
  function callEndpoint(call, key, o) {
    o = o || {};
    return call(ENDPOINTS[key] ? ENDPOINTS[key].m : 'GET', pathOf(key, o.params) + queryOf(o.query), o.body, o.headers).catch(phrased);
  }
  /** held(call) → { <member entity id>: the live grant this business holds on its books }: a login that may not list grants gets {} and the list shows nothing extra */
  function heldSplit(call) {
    return callEndpoint(call, 'grantsList').then(
      function (answer) { return splitOfGrants(answer); },
      function (failure) {
        return failure && (failure.status === 401 || failure.status === 403) ? {} : { unread: true }; /* a login that may not list grants has none; a list that could not be read is said as that (l16 fable3), never as "no grant" */
      }
    );
  }
  /** the grants list as the books door wants it: live, ended, the seats each client gives and the seats this login holds */
  function splitOfGrants(answer) {
    var out = { live: {}, ended: {}, seats: {}, mine: Array.isArray(answer && answer.seats) ? answer.seats : null }; /* mine: the seats THIS login holds, as the server says (null from an older api) */
    ((answer && answer.received) || []).forEach(function (grant) { sortGrant(out, grant); });
    Object.keys(out.live).forEach(function (id) { delete out.ended[id]; });
    return out;
  }
  /** one grant of the list is sorted: a live one by the seat it gives and as the client's live grant (the adviser one wins), an ended one into the quiet list */
  function sortGrant(out, grant) {
    var id = String(grant.grantor_entity);
    var isLive = grant.state === 'live' && !grant.revoked_at && !grant.ended_at;
    if (isLive) keepLiveGrant(out, id, grant);
    if (isLive && !adviserHolds(out, id)) out.live[id] = grant; /* both an auditor and an adviser grant live: the adviser one acts */
    else if (!isLive && grant.state !== 'edge_off') out.ended[id] = grant; /* ended or ran out: listed, quiet, no actions */
  }
  /** a live grant, by the seat it gives (every one) */
  function keepLiveGrant(out, id, grant) {
    out.seats[id] = out.seats[id] || {};
    out.seats[id][grant.preset === 'adviser' ? 'adviser' : 'auditor'] = grant;
  }
  /** is the client's live grant already an adviser's (it acts, an auditor grant does not replace it) */
  function adviserHolds(out, id) {
    return !!out.live[id] && out.live[id].preset === 'adviser';
  }
  /** ⭐ THE ONE SEAT RULE (firm frame P0): which door of this client this login opens, from what the SERVER says (received[].may_use = mayUseGrant, seats = holdsSeat), never a guess.
   *  doors = the client's live grants whose row says may_use (a row without the key, from an older api, counts as usable: behave as before).
   *  0 doors → { refused: true }. 1 door → open it. 2 doors and the login holds ONE seat → open that seat's door. 2 doors and the login holds both (or the api does not say) → the stored seat if it is still a door, else ask.
   *  stale: the stored seat is not a door any more (drop it). The seat is stored by the caller only after the first books read answers 200. */
  function doorsFor(split, id, saved) {
    var rows = ((split && split.seats) || {})[String(id)] || {};
    var doors = ['auditor', 'adviser'].filter(function (role) { return rows[role] && rows[role].may_use !== false; });
    var stale = !!saved && doors.indexOf(saved) < 0;
    return Object.assign({ doors: doors, stale: stale }, doorChoice(doors, split && split.mine, saved, stale));
  }
  /** what to do with the doors: refuse (none), open the only one, open the one seat this login holds, open the saved one, or ask */
  function doorChoice(doors, mine, saved, stale) {
    if (!doors.length) return { refused: true };
    if (doors.length === 1) return { open: doors[0] };
    if (mine && mine.length === 1 && doors.indexOf(mine[0]) >= 0) return { open: mine[0] };
    if (saved && !stale) return { open: saved };
    return { ask: true };
  }
  function held(call) {
    return heldSplit(call).then(function (split) { return split.live || {}; });
  }
  var ROLE_NAME = { adviser: 'Accountant', auditor: 'Auditor' };
  function dayOf(value) {
    return root.shopDay(value);
  }
  /** a client's grant row (live or ended) for a firm's list: Role · Since · Until */
  function grantOf(lists, store) {
    var id = String(store.entity_id);
    return lists.held[id] || (lists.ended || {})[id] || null;
  }
  /** the columns of a firm's client list: the shop-network columns (city, distance, purpose) give way to the grant's Role · Since · Until; a login that holds no grant keeps its columns */
  function clientColumns(cols, lists, tell) {
    if (!Object.keys(lists.held).length && !Object.keys(lists.ended || {}).length) return cols;
    var make = function (key, label, text) { return { key: key, label: tell(label), prio: 2, w: 130, cell: function (s) { var g = grantOf(lists, s); return g ? text(g) : '—'; }, value: function (s) { var g = grantOf(lists, s); return g ? text(g) : ''; } }; };
    var keep = cols.filter(function (c) { return ['city', 'km', 'purpose'].indexOf(c.key) < 0; });
    keep[0] = Object.assign({}, keep[0], { label: tell('Client') });
    var books = keep.pop();
    return keep.concat([
      make('role', 'Role', function (g) { return tell(ROLE_NAME[g.preset] || ROLE_NAME.auditor); }),
      make('since', 'Since', function (g) { return dayOf(g.granted_at || g.created_at); }),
      make('until', 'Until', function (g) { return dayOf(g.expires_at); }),
      books
    ]);
  }
  /** what a client whose access ended shows in the Books column: the state in words, no action */
  function endedWords(grant) {
    return grant ? stateWords(grant.state === 'expired' ? 'expired' : 'revoked') : '';
  }
/**
   * the client list of a firm comes from the GRANTS it holds (received, live), never from a store's catalogue visibility: a shop that keeps its catalogue private is still its client.
   * `stores` is the network-design list (kept as it is); every live grant whose shop it does not show is added as a row { entity_id, name } (the name the server keeps with the grant; the short id when it has none).
   */
  function withHeld(stores, heldBy, say) {
    var seen = {};
    stores.forEach(function (s) { seen[String(s.entity_id)] = true; });
    var more = Object.keys(heldBy || {}).filter(function (id) { return !seen[id]; }).map(function (id) {
      return { entity_id: id, name: (heldBy[id] && heldBy[id].grantor_name) || say('Client') + ' ' + id.slice(0, 8), purpose: '' };
    });
    return stores.concat(more);
  }
  /** the clients to list: an ended or ran-out grant is hidden until the firm asks for it (the "Ended" button); nothing is named here */
  function visible(stores, ended, showEnded) {
    return showEnded ? stores : stores.filter(function (s) { return !(ended || {})[String(s.entity_id)]; });
  }
  /** the "Ended" button above the client list, drawn only when the firm holds an ended grant */
  function endedToggle(ended, on, tell) {
    var n = Object.keys(ended || {}).length;
    return n ? '<div class="nw-acts"><button data-cbsid="NET001-B06" type="button" class="act' + (on ? '' : ' quiet') + '" data-ended-toggle="1" aria-pressed="' + !!on + '" data-testid="nw-ended-toggle">' + tell('Ended') + ' · ' + n + '</button></div>' : '';
  }
  /** wire the Ended button just drawn in host: it flips the choice and repaints the page */
  function wireEnded(host, state, repaint) {
    var button = host.querySelector('[data-ended-toggle]');
    if (button) button.onclick = function () { state.showEnded = !state.showEnded; repaint(); };
  }
  function stateWords(state) {
    return words(STATE[state] || state || '');
  }
  root.CBBooksGrantApi = { run: callEndpoint, held: held, heldSplit: heldSplit, doorsFor: doorsFor, clientColumns: clientColumns, endedWords: endedWords, visible: visible, endedToggle: endedToggle, wireEnded: wireEnded, withHeld: withHeld, stateWords: stateWords, refusalWords: refusalWords, HEADER: HEADER, ROLE_HEADER: ROLE_HEADER };
})(typeof window !== 'undefined' ? window : globalThis);
