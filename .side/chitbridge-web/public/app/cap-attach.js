/**
 * OWNS attaching a capability to a page without the app's globals · CALLED BY any page: <script src="/app/cap-attach.js" data-cap data-area data-token>
 * FLOW  tag → define what the host lacks (api tx esc ensureCap) → load the capability → open it
 * CARD 29-qa-test-tooling-ux-locale-and-design-system/test-board
 * CAP-5 · SEC-29 · SEC-30: the token is the only session input; the path addresses; a write carries client_ref.
 * The doors copy app.html's EP rows (e2e/capability-bare-page.cjs checks drift and weight).
 */
(function () {
  var win = window;
  var tag = (document.currentScript && document.currentScript.dataset) || {};
  var capability = tag.cap || 'testing';
  var doors = {};
  ('testCases GET cases,testResults GET results,testRecord POST results,testStale GET stale,testCoverage GET coverage,testCaseAdd POST cases/import,' +
    'testCaseWrite POST cases/import,testSeed POST cases/seed,testCaseClose POST cases/close,testReqList GET requirements,testReqRaise POST requirements,' +
    'testReqSet PATCH requirements/:id,testIncList GET incidents,testIncNew POST incidents,testIncSet PATCH incidents/:id,testTraceGet GET trace,' +
    'testTraceSet POST trace,testShot POST evidence')
    .split(',')
    .forEach(function (row) {
      var part = row.split(' ');
      doors[part[0]] = { m: part[1], p: '/api/testing/' + part[2], ok: 'y' };
    });
  var openers = {
    testing: function () {
      if (tag.area) win.CBTEST.area = tag.area;
      win.testLabOpen();
    }
  };

  function loadScript(address) {
    return new Promise(function (resolve, reject) {
      var node = document.createElement('script');
      node.src = address;
      node.onload = resolve;
      node.onerror = function () {
        reject(new Error(address));
      };
      document.head.appendChild(node);
    });
  }

  /* core.js's rule (attemptOf/settleAttempt) in miniature: core.js is the whole app and cannot load on a bare page.
     One attempt id per door+body, kept while a send runs or after a network error, deleted on a settled reply (status under 500), so pass, fail, pass is three rows; a 5xx keeps it (the write may have landed) */
  var attempts = {};
  function refOf(text) {
    return attempts[text] || (attempts[text] = crypto.randomUUID());
  }

  function callDoor(name, opts) {
    var door = doors[name];
    if (!door) return Promise.reject(new Error(name));
    if (!tag.token) return Promise.reject(new Error('Sign in again to record results'));
    opts = opts || {};
    var path = door.p.replace(/:(\w+)/g, function (_, key) {
      return encodeURIComponent((opts.params || {})[key]);
    });
    var query = Object.keys(opts.query || {})
      .map(function (key) {
        return key + '=' + encodeURIComponent(opts.query[key]);
      })
      .join('&');
    var headers = { Authorization: 'Bearer ' + tag.token };
    var body;
    var attempt;
    if (door.m !== 'GET') {
      var payload = Object.assign({}, opts.body);
      if (door.m === 'POST' && !payload.client_ref) { attempt = name + JSON.stringify(payload); payload.client_ref = refOf(attempt); }
      body = JSON.stringify(payload);
      headers['Content-Type'] = 'application/json';
    }
    return fetch((win.CB_API || '') + path + (query ? '?' + query : ''), { method: door.m, headers: headers, body: body, credentials: 'omit' }).then(
      function (reply) {
        if (reply.status === 401) {
          delete attempts[attempt];
          throw new Error('Sign in again to record results');
        }
        return reply.json().then(function (json) {
          if (reply.status < 500 && !(reply.status === 409 && json && json.code === 'IDEMPOTENCY_IN_PROGRESS')) delete attempts[attempt];
          if (!reply.ok) throw new Error(answerWords(json) || 'Failed');
          return json && 'data' in json ? json.data : json;
        });
      }
    );
  }

  if (typeof win.api !== 'function') win.api = callDoor;
  /* a small app (crm.html) has its own api and EP but no test doors: lend them, keep its api and session */
  else if (typeof EP === 'object') for (var door in doors) EP[door] = EP[door] || doors[door];
  if (typeof win.tx !== 'function') win.tx = function (words) { return words; };
  if (typeof win.esc !== 'function') {
    win.esc = function (value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return '&#' + char.charCodeAt(0) + ';'; });
    };
  }
  /* app.html's lsGet/lsSet */
  if (typeof win.lsGet !== 'function') win.lsGet = function (k, d) { try { var v = win.localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
  if (typeof win.lsSet !== 'function') win.lsSet = function (k, v) { try { win.localStorage.setItem(k, v); } catch (e) { win.console.warn('lsSet ' + k + ': ' + e.message); } };
  if (typeof win.ensureCap !== 'function') win.ensureCap = function (name) { return loadScript('/app/cap-' + name + '.js'); };

  (win.CBList ? Promise.resolve() : Promise.all(['css', 'click', 'wire'].map(function (part) { return loadScript('/app/list-ctl-' + part + '.js'); })).then(function () { return loadScript('/app/list-ctl.js'); }))
    .then(function () { return win.ensureCap(capability); })
    .then(function () { if (openers[capability]) openers[capability](); })
    .catch(function () {
      var note = document.createElement('p');
      note.textContent = 'This panel could not open. Reload the page and try again.';
      document.body.appendChild(note);
    });
})();
