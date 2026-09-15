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
          return { rows: [{ installation_key: 'platform-ae', ctp_endpoint: 'https://ae.example/ctp', region: 'AE' }] };
        }
        /* ⚠️ through the SECURITY DEFINER function — a plain entity_governance read would answer nothing */
        if (/ops\.f_installation_of/.test(sql)) {
          return { rows: [{ installation_key: args[0] === 'far' ? 'platform-ae' : 'platform-0' }] };
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
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'mint.js'), 'utf8');
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
      assert.ok(/transport\.send/.test(guard), 'remote copies must be sent before the local write');
      assert.ok(/CTP_REFUSED/.test(guard), 'a refusal must carry a named code');
      assert.ok(/throw e;/.test(guard), 'it must throw, not warn — half a chit is worse than none');
      assert.ok(/Nothing was written/.test(guard), 'and the message must say the local side was not written');
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

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})();
