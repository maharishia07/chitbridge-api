// cb-offline.js — Chit & Bridge offline-resilience primitive (dependency-free, drop-in).
// The product is online-first; this makes "the internet drops while half the work is happening" non-fatal WITHOUT
// weakening the governance model. It does NOT transact offline — nothing is committed on a disconnected device (the
// server still enforces RLS / freeze / verified rungs / definer guards at the real commit). It does two safe things:
//   1) DRAFTS — autosave/restore work-in-progress locally, so a drop/reload never loses a half-filled form.
//   2) OUTBOX — a mutation that can't reach the server is QUEUED and REPLAYS your real authenticated request on
//      reconnect (queue-and-replay), carrying an Idempotency-Key so a replay can never double-apply (needs the
//      server-side idempotency check — Phase 2; until then use submit() only for genuinely-offline captures).
// Storage is localStorage (small, synchronous, survives reload/crash). Swap to IndexedDB later for large payloads.
// OWNS the drafts, the outbox and the saved steps of a bulk job (enqueueJob · sendStep · jobs, each entry stamped with its entity: SEC-140) · CALLED BY every page that saves work (app.html, till.html, the small apps) through CBOffline.
// FLOW  submit(req) → online? send → classify (done · reject · retry) → retry/offline: enqueue → 'online' event → flush() replays      CARD 28-platform-and-operations/offline
(function (root) {
  var LSK = 'cb.outbox.v1',
    DKP = 'cb.draft.';
  var ls = (function () {
    try {
      var t = '__cb';
      root.localStorage.setItem(t, '1');
      root.localStorage.removeItem(t);
      return root.localStorage;
    } catch (e) {
      return null;
    }
  })();
  var mem = {}; // fallback when localStorage is unavailable (private mode)
  var readFailed = false;
  var lostToMemory = false; // a write fell back to memory: closing the tab loses it
  // the device would not answer: read as empty, and the job then says it cannot keep itself
  function deviceSilent() {
    readFailed = true;
    return null;
  }
  // memory first: a value that could not be written to the device lives only there, and it is newer than anything the device still holds under that key
  function get(k) {
    if (k in mem) return mem[k];
    try {
      return ls ? ls.getItem(k) : null;
    } catch (e) {
      return deviceSilent();
    }
  }
  function set(k, v) {
    try {
      if (ls) {
        ls.setItem(k, v);
        delete mem[k];
      } else mem[k] = v;
    } catch (e) {
      mem[k] = v;
      lostToMemory = true;
    }
  }
  function del(k) {
    try {
      if (ls) ls.removeItem(k);
      else delete mem[k];
    } catch (e) {
      delete mem[k];
    }
  }
  function uuid() {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  var cfg = {
    apiBase: '',
    token: function () {
      return null;
    },
    entity: null, // () => the signed-in entity's id ('' until the session exists); unset on a page that does not stamp
    sleep: function (ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    },
    onChange: function () {}
  };
  function online() {
    return !root.navigator || root.navigator.onLine !== false;
  }

  // ── drafts ──
  function saveDraft(key, data) {
    set(DKP + key, JSON.stringify({ at: Date.now(), data: data }));
  }
  function loadDraft(key) {
    var r = get(DKP + key);
    if (!r) return null;
    try {
      return JSON.parse(r).data;
    } catch (e) {
      return null;
    }
  }
  function draftAge(key) {
    var r = get(DKP + key);
    if (!r) return null;
    try {
      return Date.now() - JSON.parse(r).at;
    } catch (e) {
      return null;
    }
  }
  function clearDraft(key) {
    del(DKP + key);
  }

  // ── outbox ──
  function readQ() {
    var r = get(LSK);
    if (!r) return [];
    try {
      return JSON.parse(r);
    } catch (e) {
      return [];
    }
  }
  function writeQ(q) {
    set(LSK, JSON.stringify(q));
    paint();
  }
  // what THIS person has waiting (another entity's entries are not shown as ours)
  function pending() {
    return readQ().filter(mine).length;
  }
  // who is signed in: null = this page does not stamp (the counter), '' = not known yet, else the id
  function signedInId() {
    return typeof cfg.entity === 'function' ? String(cfg.entity() || '') : null;
  }
  // an entry is replayable only by the entity that queued it (SEC-140: a different person signing in must never replay someone else's queue)
  function mine(entry) {
    var signedIn = signedInId();
    if (signedIn === null) return !entry.entity; /* a page that does not stamp replays only what carries no entity (legacy) */
    return signedIn !== '' && entry.entity === signedIn;
  }
  function enqueue(req) {
    var list = readQ();
    req.id = req.id || req.idem || uuid();
    if (!req.entity && signedInId()) req.entity = signedInId();
    if (
      list.some(function (x) {
        return x.id === req.id;
      })
    )
      return req.id; // idempotent enqueue
    req.queued_at = Date.now();
    req.tries = 0;
    list.push(req);
    writeQ(list);
    return req.id;
  }
  function rawSend(req) {
    var h = { 'Content-Type': 'application/json', 'Idempotency-Key': req.id };
    var tok = cfg.token && cfg.token();
    if (tok) h.Authorization = 'Bearer ' + tok;
    return root.fetch(cfg.apiBase + req.path, { method: req.method || 'POST', headers: h, body: req.body ? JSON.stringify(req.body) : undefined });
  }
  // classify a response: done (drop), reject (drop + surface — a 4xx won't fix itself on retry), retry (keep)
  // PAY-FIX L3: a replayed key answers with the FIRST answer (2xx), so a 409 is never "done". IDEMPOTENCY_IN_PROGRESS means the
  // first try is still running (or died) — keep it and try again; any other 409 is the shop's own conflict — surface it.
  function classify(status, code) {
    if (status >= 200 && status < 300) return 'done';
    if (status === 409 && code === 'IDEMPOTENCY_IN_PROGRESS') return 'retry';
    if (status >= 400 && status < 500) return 'reject';
    return 'retry';
  }
  // the machine code of a 409 body (null when the body is not JSON) — read from a clone so the caller can still read the response
  function codeOf(response) {
    if (response.status !== 409 || !response.clone) return Promise.resolve(null);
    return response
      .clone()
      .json()
      .then(
        function (body) {
          return (body && body.code) || null;
        },
        function () {
          return null;
        }
      );
  }
  // send one request and classify its answer: → { response, kind } (kind: done · reject · retry); a network failure rejects
  function sendAndClassify(req) {
    return rawSend(req).then(function (response) {
      return codeOf(response).then(function (code) {
        return { response: response, kind: classify(response.status, code) };
      });
    });
  }
  var flushing = false;
  function patchEntry(id, change) {
    var list = readQ();
    list.forEach(function (entry) {
      if (entry.id === id) change(entry);
    });
    writeQ(list);
  }
  function removeEntry(id) {
    writeQ(
      readQ().filter(function (entry) {
        return entry.id !== id;
      })
    );
  }
  function bumpTries(id) {
    patchEntry(id, function (entry) {
      entry.tries = (entry.tries || 0) + 1;
    });
  }
  // entries past the key window (48 h) are unsafe to replay: a plain entry (own or not) and another entity's job step are removed; this person's own old job stays so the tray can ask. Newer entries of another entity wait for that person; nothing goes at sign-out
  function sweepOld() {
    var limit = Date.now() - JOB_MAX_AGE_MS;
    var list = readQ();
    var ownSwept = [],
      others = 0;
    var keep = list.filter(function (entry) {
      var old = (entry.queued_at || Date.now()) < limit;
      var swept = old && (!entry.job || !mine(entry));
      if (swept && mine(entry)) ownSwept.push(entry);
      else if (swept) others++;
      return !swept;
    });
    if (keep.length === list.length) return;
    writeQ(keep);
    if (cfg.onSwept) cfg.onSwept({ own: ownSwept, others: others }); // silence is the bug: the page says what was removed (ownSwept: the entries; others: a count only)
  }
  // nothing is replayed while a flush runs, before the session is known or offline; the sweep of old entries runs whenever the session is known
  function readyToFlush() {
    if (flushing || signedInId() === '') return false;
    sweepOld();
    return online();
  }
  // replay this entity's plain entries (a bulk-job step is driven by its job, never here); each answer is written at once, so a crash never resends a settled one and another entity's entries stay as they are
  function flush() {
    if (!readyToFlush()) return Promise.resolve({ sent: 0, pending: pending() });
    flushing = true;
    var list = readQ().filter(function (entry) {
        return mine(entry) && !entry.job;
      }),
      rejected = [],
      sent = 0;
    return list
      .reduce(function (total, req) {
        return total.then(function () {
          return sendAndClassify(req)
            .then(function (result) {
              if (result.kind === 'done') {
                sent++;
                removeEntry(req.id);
              } else if (result.kind === 'reject') {
                req.error = 'rejected ' + result.response.status;
                rejected.push(req);
                removeEntry(req.id);
              } else {
                bumpTries(req.id);
              }
            })
            .catch(function () {
              bumpTries(req.id);
            }); // network error → keep for next reconnect
        });
      }, Promise.resolve())
      .then(function () {
        flushing = false;
        if (rejected.length && cfg.onReject) cfg.onReject(rejected);
        return { sent: sent, pending: pending(), rejected: rejected.length };
      });
  }

  // ── bulk jobs: the outbox as the one durable store of a group action ──
  var JOB_MAX_AGE_MS = 48 * 3600 * 1000; // the server forgets a key after 48 h (middleware/idempotency.js), so an older job asks before it resumes
  var JOB_BACKOFF_MS = [2000, 5000, 15000, 30000]; // then stop and name what is left
  var onlineWaiters = [];
  // false when this browser keeps nothing (private window): closing the tab loses the job
  function durable() {
    return !!ls && !lostToMemory && !readFailed;
  }
  // store every step before step 1: steps = [{ ep, params, body, method, path, items, okIf404 }], meta = { id, kind, label, unit, mount, speed, verb, total } → whether the device keeps them
  function enqueueJob(meta, steps) {
    var list = readQ(),
      at = Date.now(),
      signedIn = signedInId();
    steps.forEach(function (step, index) {
      var id = 'job:' + meta.id + ':' + index;
      var known = list.some(function (x) {
        return x.id === id;
      });
      if (known) return;
      list.push({
        id: id,
        method: step.method || 'POST',
        path: step.path,
        body: step.body,
        ep: step.ep,
        params: step.params,
        items: step.items,
        names: step.names,
        okIf404: !!step.okIf404,
        entity: signedIn || undefined,
        job: { id: meta.id, kind: meta.kind, step: index, of: steps.length, total: meta.total, label: meta.label, unit: meta.unit, mount: meta.mount, speed: meta.speed, verb: meta.verb, at: at },
        queued_at: at,
        tries: 0,
        attempts: 0
      });
    });
    writeQ(list);
    return durable();
  }
  // this entity's unfinished jobs: { id, meta, at, steps (not yet answered, in order), rejected (answered no) }
  function jobs() {
    var byId = {},
      order = [];
    readQ().forEach(function (entry) {
      if (!entry.job || !mine(entry)) return;
      var unfinished = byId[entry.job.id];
      if (!unfinished) {
        unfinished = byId[entry.job.id] = { id: entry.job.id, meta: entry.job, at: entry.job.at, steps: [], rejected: [] };
        order.push(unfinished);
      }
      (entry.rejected ? unfinished.rejected : unfinished.steps).push(entry);
    });
    order.forEach(function (unfinished) {
      unfinished.steps.sort(function (x, y) {
        return x.job.step - y.job.step;
      });
    });
    return order;
  }
  // the end of a run (finished, stopped or cancelled): nothing of the job stays in the outbox
  function closeJob(jobId) {
    writeQ(
      readQ().filter(function (entry) {
        return !(entry.job && entry.job.id === jobId);
      })
    );
  }
  // a stopped job (back-offs used up, session ended) keeps its steps for the next visit, flagged so the tray asks first; pausedFlag false clears it
  function pauseJob(jobId, pausedFlag) {
    var list = readQ();
    list.forEach(function (entry) {
      if (entry.job && entry.job.id === jobId) entry.job.paused = pausedFlag !== false;
    });
    writeQ(list);
  }
  function whenOnline() {
    if (online()) return Promise.resolve();
    return new Promise(function (resolve) {
      onlineWaiters.push(resolve);
    });
  }
  // a 5xx, a 429, a first try still running (409) or no answer at all is worth another go; any other answer is final
  function worthRetry(error) {
    var status = error && error.status;
    if (!status) return true;
    return status >= 500 || status === 429 || (status === 409 && !!error.data && error.data.code === 'IDEMPOTENCY_IN_PROGRESS');
  }
  // one step of a job: send(entry) resolves its answer or throws an Error with .status/.data (core.js api()).
  // → { kind: done · reject · offline · stopped · gone, reply, already, status, reason }. opts.onWait(seconds, error) is told before each back-off wait.
  // A replayed archive/restore/delete (okIf404) that answers 404 counts as done once an earlier attempt was made: the first may have applied and its answer been lost.
  function sendStep(id, send, opts, round) {
    opts = opts || {};
    round = round || 0;
    var entry = readQ().filter(function (x) {
      return x.id === id;
    })[0];
    if (!entry) return Promise.resolve({ kind: 'gone' });
    if (!online()) return Promise.resolve({ kind: 'offline' });
    var priorAttempts = entry.attempts || 0;
    patchEntry(id, function (x) {
      x.attempts = priorAttempts + 1;
    });
    return Promise.resolve()
      .then(function () {
        return send(entry);
      })
      .then(
        function (reply) {
          if (reply && reply.queued) return { kind: 'offline' };
          removeEntry(id);
          return { kind: 'done', reply: reply, step: entry };
        },
        function (error) {
          return stepFailed(entry, error, priorAttempts, send, opts, round);
        }
      );
  }
  // an answer that ends the step now: done (a replayed 404), stopped (the session ended) or rejected (a refusal that will not change); null = worth another go
  function settleFailure(entry, error, priorAttempts) {
    var status = error && error.status;
    var reason = (error && error.message) || 'failed';
    if (status === 404 && entry.okIf404 && priorAttempts > 0) {
      removeEntry(entry.id);
      return { kind: 'done', already: true, step: entry };
    }
    if (status === 401) return { kind: 'stopped', status: status, reason: reason };
    if (worthRetry(error)) return null;
    patchEntry(entry.id, function (x) {
      x.rejected = { status: status, reason: reason };
    });
    return { kind: 'reject', status: status, reason: reason, data: error && error.data };
  }
  // the server did not apply the step (401, 429, no connection): the attempt does not count, so a later first real send that answers 404 is a failure, not a "done"
  function notApplied(id, priorAttempts) {
    patchEntry(id, function (x) {
      x.attempts = priorAttempts;
    });
  }
  // a 401, a 429 or no connection means the server did not apply the step
  function notAppliedAnswer(error) {
    var status = error && error.status;
    return status === 401 || status === 429 || !online();
  }
  function stepFailed(entry, error, priorAttempts, send, opts, round) {
    if (notAppliedAnswer(error)) notApplied(entry.id, priorAttempts);
    var settled = settleFailure(entry, error, priorAttempts);
    if (settled) return settled;
    if (!online()) return { kind: 'offline' };
    if (round >= JOB_BACKOFF_MS.length) return { kind: 'stopped', status: error && error.status, reason: (error && error.message) || 'failed' };
    if (opts.onWait) opts.onWait(JOB_BACKOFF_MS[round] / 1000, error);
    return cfg.sleep(JOB_BACKOFF_MS[round]).then(function () {
      return sendStep(entry.id, send, opts, round + 1);
    });
  }
  // submit now if online (and return the live response so callers can use the server id); else capture to the outbox.
  function submit(req) {
    req.id = req.id || req.idem || uuid();
    if (online()) {
      return sendAndClassify(req)
        .then(function (result) {
          if (result.kind === 'retry') {
            enqueue(req);
            return { ok: true, queued: true, online: false, id: req.id };
          }
          return { ok: result.kind === 'done', online: true, status: result.response.status, res: result.response, id: req.id };
        })
        .catch(function () {
          enqueue(req);
          return { ok: true, queued: true, online: false, id: req.id };
        });
    }
    enqueue(req);
    return Promise.resolve({ ok: true, queued: true, online: false, id: req.id });
  }

  function paint() {
    try {
      cfg.onChange({ online: online(), pending: pending() });
    } catch (e) {}
  }
  function configure(c) {
    for (var k in c) if (c.hasOwnProperty(k)) cfg[k] = c[k];
    paint();
    return API;
  }

  if (root.addEventListener) {
    root.addEventListener('online', function () {
      paint();
      onlineWaiters.splice(0).forEach(function (wake) {
        wake();
      });
      flush();
    });
    root.addEventListener('offline', paint);
  }

  // ── autodraft (Phase 4.1) — autosave EVERY field under a container to ONE draft key; restore on (re)render.
  // Call after the container is in the DOM; call clearDraft(key) when the form submits. Never persists secrets
  // (password/file/hidden/checkbox/radio, or ids that look like pin/otp/password/cvv/secret). Returns true if it
  // restored anything. opts.overwrite=true restores OVER prefilled values (for server-loaded forms like the vault).
  function autodraft(container, key, opts) {
    if (!container || !container.querySelectorAll) return false;
    opts = opts || {};
    var skip = /pin|otp|password|pwd|cvv|secret/i;
    var eligible = function (f) {
      var identifier = f.id || f.name;
      if (!identifier || skip.test(identifier)) return null;
      var t = (f.type || '').toLowerCase();
      if (t === 'password' || t === 'file' || t === 'hidden' || t === 'checkbox' || t === 'radio') return null;
      return identifier;
    };
    var collect = function () {
      var o = {},
        nestedFs = container.querySelectorAll('input,textarea,select');
      for (var position = 0; position < nestedFs.length; position++) {
        var identifier = eligible(nestedFs[position]);
        if (identifier && nestedFs[position].value != null && nestedFs[position].value !== '') o[identifier] = nestedFs[position].value;
      }
      return o;
    };
    var saved = loadDraft(key) || {},
      restored = false,
      fs = container.querySelectorAll('input,textarea,select');
    for (var index = 0; index < fs.length; index++) {
      var id = eligible(fs[index]);
      if (!id) continue;
      if (saved[id] != null && (opts.overwrite || fs[index].value === '' || fs[index].value == null)) {
        fs[index].value = saved[id];
        restored = true;
      }
      var h = function () {
        saveDraft(key, collect());
      };
      fs[index].addEventListener('input', h);
      fs[index].addEventListener('change', h);
    }
    return restored;
  }

  // ── service worker (Phase 3) — app opens offline + read-cache. Safe no-op where SW is unavailable. ──
  function registerSW(path) {
    try {
      if (root.navigator && 'serviceWorker' in root.navigator) root.navigator.serviceWorker.register(path || '/cb-sw.js').catch(function () {});
    } catch (e) {}
  }

  var API = {
    configure: configure,
    online: online,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    draftAge: draftAge,
    clearDraft: clearDraft,
    autodraft: autodraft,
    submit: submit,
    enqueue: enqueue,
    flush: flush,
    enqueueJob: enqueueJob,
    jobs: jobs,
    sendStep: sendStep,
    closeJob: closeJob,
    pauseJob: pauseJob,
    whenOnline: whenOnline,
    durable: durable,
    jobMaxAgeMs: JOB_MAX_AGE_MS,
    backoffMs: JOB_BACKOFF_MS,
    pending: pending,
    registerSW: registerSW,
    _classify: classify,
    _uuid: uuid
  };
  root.CBOffline = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : this);
