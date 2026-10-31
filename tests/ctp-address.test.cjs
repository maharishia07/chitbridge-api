/* ⚠️ CRLF-tolerant (2026-09-28): a Windows checkout (autocrlf) hands back \r\n, and patterns anchored on \n went red on line endings alone */
/**
 * ── ⭐⭐ THE ADDRESS SEAM — CTP step 2 ───────────────────────────────────────────────────────────────────────────
 *
 * docs/CTP-DESIGN.md §11 step 2: `deliver()` gains an address resolver, every address local, NO behaviour change.
 * "No behaviour change" is a claim, so it is asserted rather than hoped for.
 *
 * ⚠️ OFFLINE. It stubs the database rather than reaching one, because the three things worth holding are shapes,
 * not data: the fast path issues no per-entity query, a remote copy is REFUSED BEFORE ANY WRITE, and an
 * unreadable topology behaves exactly as it did before the seam existed.
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); }
};
const okAsync = async (name, fn) => {
  try { await fn(); pass++; console.log('   ok   ' + name); }
  catch (e) { fail++; console.log('   FAIL ' + name + '\n          ' + e.message); }
};

/** load lib/ctpaddress with a stubbed ../db, so the test never needs a database */
function loadAddress(dbStub) {
  const dbPath = path.join(__dirname, '..', 'db.js');
  const addrPath = path.join(__dirname, '..', 'lib', 'ctpaddress.js');
  delete require.cache[require.resolve(addrPath)];
  const realLoad = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req === '../db' || req === path.join(__dirname, '..', 'db')) return dbStub;
    return realLoad.apply(this, arguments);
  };
  try { return require(addrPath); } finally { Module._load = realLoad; }
}

(async () => {
  console.log('\n══ CTP ADDRESSING — the seam, with everything local ══\n');

  /* ── ① the fast path costs nothing ──────────────────────────────────────────────────────────────────────── */
  {
    const calls = [];
    const stub = { query: async (sql) => { calls.push(sql); return { rows: [] }; }, withEntity: async () => {} };
    const A = loadAddress(stub);
    const got = await A.resolveAll(['e1', 'e2', 'e3', 'e4', 'e5']);

    await okAsync('nothing is remote → every address is local', async () => {
      for (const [, a] of got) assert.strictEqual(a.local, true, 'expected local');
      assert.strictEqual(got.size, 5);
    });

    ok('…and it issues ONE query for five copies, not five', () => {
      /* Athi: "does it look for each transfer?" — one memoised topology question, no per-entity lookup. */
      assert.strictEqual(calls.length, 1, 'expected 1 query, got ' + calls.length + ': ' + calls.join(' | '));
      assert.ok(/FROM installation/i.test(calls[0]), 'the one query should be the topology read');
    });
  }

  /* ── ② a remote installation is recognised, and asked about per entity ───────────────────────────────────── */
  {
    const calls = [];
    const stub = {
      query: async (sql, args) => {
        calls.push(sql);
        if (/FROM installation/i.test(sql)) {
          return { rows: [{ installation_key: 'platform-ae', ctp_endpoint: 'https://ae.example/ctp', region: 'AE', active: true }, { installation_key: 'platform-gone', ctp_endpoint: 'https://gone.example/ctp', region: null, active: false }] };
        }
        /* ⚠️ through the SECURITY DEFINER function — a plain entity_governance read would answer nothing */
        if (/ops\.f_installation_of/.test(sql)) {
          return { rows: [{ installation_key: args[0] === 'far' ? 'platform-ae' : args[0] === 'gone' ? 'platform-gone' : 'platform-0' }] };
        }
        return { rows: [] };
      },
    };
    const A = loadAddress(stub);

    await okAsync('an entity on a remote installation resolves REMOTE, with its endpoint', async () => {
      const a = await A.resolve('far');
      assert.strictEqual(a.local, false, 'expected remote');
      assert.strictEqual(a.endpoint, 'https://ae.example/ctp');
    });

    /* SIT run 4 (RAIL-112): a suspended or retired installation dropped out of the map, so its businesses looked LOCAL and their chits never left */
    await okAsync('an entity on an INACTIVE remote installation stays REMOTE and is marked inactive, never local', async () => {
      const a = await A.resolve('gone');
      assert.strictEqual(a.local, false, 'a business on a retired installation is still somebody else');
      assert.strictEqual(a.inactive, true);
      assert.strictEqual(a.endpoint, null, 'nothing is sent to it');
    });

    await okAsync('an entity on a local installation still resolves LOCAL', async () => {
      const a = await A.resolve('near');
      assert.strictEqual(a.local, true, 'expected local');
    });

    ok('the stamp is read through ops.f_installation_of, never a bare entity_governance read', () => {
      const bare = calls.filter((s) => /FROM\s+entity_governance/i.test(s));
      assert.strictEqual(bare.length, 0,
        'entity_governance is FORCE RLS — a plain read answers nothing and routes a remote copy locally');
      assert.ok(calls.some((s) => /ops\.f_installation_of/.test(s)), 'expected the definer function');
    });
  }

  /* ── ③ an unreadable topology behaves exactly as before the seam existed ─────────────────────────────────── */
  {
    const stub = { query: async () => { const e = new Error('boom'); e.code = '08006'; throw e; } };
    const A = loadAddress(stub);
    await okAsync('a database blip answers LOCAL and says why', async () => {
      const a = await A.resolve('x');
      assert.strictEqual(a.local, true, 'a failure must never turn a working delivery into a lost one');
      assert.ok(a.why && a.why.length > 3, 'it must say on what grounds');
    });
  }

  /* ── ④ deliver() refuses a remote copy BEFORE writing anything ───────────────────────────────────────────── */
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'mint.js'), 'utf8').replace(/\r\n/g, '\n');
    /* ⚠️ offsets RELATIVE to deliver(). The first version searched the whole file for 'chit_deliver' and found
       it in a comment far above the function, so the "before the write" test measured backwards and the throw
       test sliced an empty string. A test that reads the wrong region reports on nothing. */
    const d = src.slice(src.indexOf('async function deliver('));
    const body = d.slice(0, d.indexOf('\n}\n') + 1);

    ok('deliver() resolves every copy before the write', () => {
      const resolveAt = body.indexOf('resolveAll');
      const writeAt = body.indexOf("'SELECT chit_deliver");
      assert.ok(resolveAt > 0, 'deliver() does not address its copies');
      assert.ok(writeAt > 0, 'the chit_deliver call moved — this test is reading the wrong place');
      assert.ok(resolveAt < writeAt, 'addressing must happen BEFORE chit_deliver, or a partial chit is written');
    });
    /* ⚠️ MOVED, not loosened. It asserted `CTP_NOT_BUILT` — the placeholder from step 2, when a remote address
       was simply refused. Step 5 gave it a transport, so the CODE changed and the RULE did not: every remote
       copy is settled before a single local row is written, and a failure throws. An assertion pinned to the
       old spelling would have been deleted here; this one is re-aimed at the rule.
       [[feedback-improvise-update-cases]] */
    ok('…and settles every remote copy BEFORE any local write, or throws', () => {
      const guard = body.slice(0, body.indexOf("'SELECT chit_deliver"));
      assert.ok(/await sendAway\(/.test(guard) && /transport\.send/.test(src), 'remote copies must be sent before the local write');
      /* RAIL-99: the refusal is built by farEndFailure (named codes CTP_REFUSED / CTP_UNREACHABLE, in words that say nothing was saved) */
      const whole = src;
      /* sit/run6: the crossing moved into sendAway (RAIL-98/99), which builds the failure, logs it (refusedCrossing) and throws it */
      const away = src.slice(src.indexOf('async function sendAway('));
      assert.ok(/const failure = farEndFailure\(/.test(away) && /throw failure;/.test(away.slice(0, away.indexOf('\n}\n'))), 'it must throw, not warn — half a chit is worse than none');
      assert.ok(/CTP_REFUSED/.test(whole) && /CTP_UNREACHABLE/.test(whole), 'a refusal must carry a named code');
      assert.ok(/nothing was saved here/.test(whole), 'and the message must say the local side was not written');
    });

    ok('a DRAFT never crosses an installation boundary', () => {
      const guard = body.slice(0, body.indexOf("'SELECT chit_deliver"));
      assert.ok(/CTP_DRAFT/.test(guard),
        'a draft is somebody’s unfinished thought — sending it publishes a thing that has not been sent');
    });

    ok('only the LOCAL copies reach chit_deliver', () => {
      assert.ok(/JSON\.stringify\(local\)/.test(body),
        'passing every copy would write a remote party’s row into this database');
    });
  }

  /* ── RAIL-142 (c): THE LIFT (CTP-DESIGN §10) — one row flips, invalidate(), and the same party is now remote ── */
  {
    let lifted = false;
    let reads = 0;
    const stub = {
      query: async (sql, args) => {
        if (/FROM installation/i.test(sql)) {
          reads++;
          return { rows: [
            { installation_key: 'platform-0', ctp_endpoint: null, region: 'IN', active: true, hosted_locally: true },
            { installation_key: 'platform-ae', ctp_endpoint: lifted ? 'https://ae.example/ctp' : null, region: 'AE', active: true, hosted_locally: !lifted },
          ] };
        }
        if (/ops\.f_installation_of/.test(sql)) return { rows: [{ installation_key: args[0] === 'dubai-shop' ? 'platform-ae' : 'platform-0' }] };
        return { rows: [] };
      },
    };
    const A = loadAddress(stub);
    await okAsync('before the lift: a party stamped on platform-ae is here (it is hosted here)', async () => {
      const a = await A.resolve('dubai-shop');
      assert.strictEqual(a.local, true, JSON.stringify(a));
    });
    lifted = true; /* the one row changes: hosted_locally false, an endpoint */
    await okAsync('within the memo, the flip is not seen yet (why invalidate exists)', async () => {
      assert.strictEqual((await A.resolve('dubai-shop')).local, true);
    });
    A.invalidate();
    await okAsync('after invalidate(): the SAME party resolves remote, at the new endpoint', async () => {
      const a = await A.resolve('dubai-shop');
      assert.strictEqual(a.local, false, JSON.stringify(a));
      assert.strictEqual(a.endpoint, 'https://ae.example/ctp');
    });
    await okAsync('…and nothing else changed: a party on platform-0 is still here, and no extra read per party', async () => {
      const before = reads;
      assert.strictEqual((await A.resolve('india-shop')).local, true);
      assert.strictEqual(reads, before, 'the topology is one memoised read, not one per party');
    });
  }

  /* ── RAIL-142 (b): a switched-off installation, or a stamp naming none, is not "here" ─────────────────────── */
  {
    const stub = {
      query: async (sql, args) => {
        if (/FROM installation/i.test(sql)) {
          return { rows: [
            { installation_key: 'platform-0', ctp_endpoint: null, region: 'IN', active: true, hosted_locally: true },
            { installation_key: 'platform-ae', ctp_endpoint: 'https://ae.example/ctp', region: 'AE', active: true, hosted_locally: false },
            { installation_key: 'platform-mx', ctp_endpoint: 'https://mx.example/ctp', region: 'MX', active: false, hosted_locally: false },
          ] };
        }
        if (/ops\.f_installation_of/.test(sql)) {
          const stamps = { far: 'platform-ae', off: 'platform-mx', typo: 'platfrom-ae', near: 'platform-0', home: 'platform-9' };
          return { rows: [{ installation_key: stamps[args[0]] }] };
        }
        return { rows: [] };
      },
    };
    const A = loadAddress(stub);
    await okAsync('a party on a switched-off remote installation is unresolved, not "hosted here" (RAIL-142 b)', async () => {
      /* sit/run6 merge: the rule is unchanged (never "hosted here", nothing written); the SHAPE is SIT run 4's — the party stays REMOTE
         (local:false) and inactive:true, so lib/mint sendAway refuses it in words (CTP_PEER_INACTIVE, playbook C5) before any write. */
      const a = await A.resolve('off');
      assert.strictEqual(a.local, false, JSON.stringify(a));
      assert.strictEqual(a.inactive, true, JSON.stringify(a));
      assert.ok(/not active/.test(a.why), a.why);
    });
    await okAsync('a stamp naming no installation is unresolved, not "hosted here" (RAIL-142 b)', async () => {
      const a = await A.resolve('typo');
      assert.strictEqual(a.resolved, false, JSON.stringify(a));
    });
    await okAsync('…while a local stamp and a remote one resolve as before', async () => {
      assert.strictEqual((await A.resolve('near')).local, true);
      assert.notStrictEqual((await A.resolve('near')).resolved, false);
      assert.strictEqual((await A.resolve('far')).local, false);
    });
    await okAsync('…and our own key is here even with no row for it', async () => {
      const saved = process.env.INSTALLATION_KEY;
      process.env.INSTALLATION_KEY = 'platform-9';
      try {
        const a = await A.resolve('home');
        assert.strictEqual(a.local, true);
        assert.notStrictEqual(a.resolved, false, JSON.stringify(a));
      } finally {
        if (saved === undefined) delete process.env.INSTALLATION_KEY; else process.env.INSTALLATION_KEY = saved;
      }
    });
  }

  /* ── ⑤ RAIL-142 (a): once something IS remote, a failure is not "local" ───────────────────────────────────── */
  {
    let topologyFails = false, stampFails = false;
    const stub = {
      query: async (sql, args) => {
        if (/FROM installation/i.test(sql)) {
          if (topologyFails) { const e = new Error('boom'); e.code = '08006'; throw e; }
          return { rows: [{ installation_key: 'platform-ae', ctp_endpoint: 'https://ae.example/ctp', region: 'AE' }] };
        }
        if (/ops\.f_installation_of/.test(sql)) {
          if (stampFails) { const e = new Error('rls'); e.code = '42501'; throw e; }
          return { rows: [{ installation_key: args[0] === 'far' ? 'platform-ae' : 'platform-0' }] };
        }
        return { rows: [] };
      },
    };
    const A = loadAddress(stub);
    await A.resolve('far'); /* a good read: platform-ae is remote */
    const realNow = Date.now;
    Date.now = () => realNow() + 5 * 60 * 1000; /* past the one-minute memo */
    topologyFails = true;
    try {
      await okAsync('once something has been remote, a failed topology read places nobody (resolved:false)', async () => {
        const far = await A.resolve('far');
        const near = await A.resolve('near');
        assert.strictEqual(far.resolved, false, 'a blip guessed where a remote party lives: ' + JSON.stringify(far));
        assert.strictEqual(near.resolved, false, 'a blip guessed where a local party lives (a lift back home would send it away)');
      });
      A.invalidate();
      await okAsync('…and invalidate() does not reopen "nothing is remote"', async () => {
        assert.strictEqual((await A.resolve('far')).resolved, false);
      });
    } finally { Date.now = realNow; topologyFails = false; }

    stampFails = true;
    await okAsync('a failed stamp read, with something remote, is resolved:false — not a guess of "here"', async () => {
      const a = await A.resolve('far');
      assert.strictEqual(a.resolved, false, 'expected resolved:false, got ' + JSON.stringify(a));
      assert.ok(!/42501|rls/.test(a.why), 'the database code is for the log, not the answer');
    });
    stampFails = false;
  }

  /* ── ⑥ RAIL-142 (a): deliver() refuses an unresolved copy BEFORE writing anything ───────────────────────────── */
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'mint.js'), 'utf8').replace(/\r\n/g, '\n');
    const d = src.slice(src.indexOf('async function deliver('));
    const body = d.slice(0, d.indexOf('\n}\n') + 1);
    ok('deliver() refuses an unresolved copy before the remote branch and before chit_deliver', () => {
      const refuseAt = body.indexOf('awayCopies(copies, addressed)');
      assert.ok(refuseAt > 0, 'deliver() does not check for unresolved copies');
      /* sit/run6: the send is sendAway's (RAIL-98/99), called from deliver() */
      assert.ok(body.indexOf('sendAway(') > 0 && refuseAt < body.indexOf('sendAway(') && refuseAt < body.indexOf("'SELECT chit_deliver"), 'the refusal must come before any send or write');
    });
    const fn = src.slice(src.indexOf('function refuseUnresolved('));
    const helper = fn.slice(0, fn.indexOf('\n}\n') + 1);
    ok('…with a named code, a 503 and words that say nothing was written', () => {
      assert.ok(/CTP_UNRESOLVABLE/.test(helper) && /status = 503/.test(helper) && /Nothing was written/.test(helper), helper.slice(0, 200));
    });
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
