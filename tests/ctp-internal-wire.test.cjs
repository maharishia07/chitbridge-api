/* RAIL-98 · RAIL-99 · RAIL-100 · RAIL-101 — a chit between two of OUR installations, through the normal send path (offline: db, transport and the far end are stubs).
   Each block fails on main and passes on rail/ctp-internal-wire. */
const assert = require('assert');
const path = require('path');
const Module = require('module');

let pass = 0,
  fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + e.message);
  }
};
const root = (p) => path.join(__dirname, '..', p);

/** require `file` fresh with some modules replaced (matched on the exact request string) */
function load(file, stubs) {
  for (const f of ['db/index.js', 'lib/ctpaddress.js', 'lib/ctptransport.js']) delete require.cache[require.resolve(root(f))]; /* drop the mint test stubs */
  const real = Module._load;
  Module._load = function (req) {
    if (Object.prototype.hasOwnProperty.call(stubs, req)) return stubs[req];
    return real.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(root(file))];
    return require(root(file));
  } finally {
    Module._load = real;
  }
}

const RECIP = 'r-entity-1';
/* ⚠️ no bridge_id on the copy, exactly as a real send copy */
const copy = { entity_id: RECIP, direction: 'received', sender_entity_id: 's1' };
const remote = (place) => ({
  resolveAll: async (ids) =>
    new Map(ids.map((i) => [String(i), place || { local: false, installation_key: 'sit-au', endpoint: 'https://au.example/api/ctp/deliver' }]))
});

function mintWith(transport, place) {
  const db = {
    withEntity: async () => {
      throw new Error('a local write must not happen');
    },
    query: async (sql) => {
      if (/SELECT bridge_id, display_name FROM identities/.test(sql)) return { rows: [{ bridge_id: 'CBSQRH9ASH', display_name: 'QA Rish Pty' }] };
      if (/coalesce\(population/.test(sql)) return { rows: [{ population: 'live', bridge_id: 'CBEGY7LB2J', display_name: 'QA Athi' }] };
      return { rows: [] };
    }
  };
  /* deliver() requires its helpers lazily, so the stubs sit in the module cache for the whole test */
  for (const [file, exp] of [['db/index.js', db], ['lib/ctpaddress.js', remote(place)], ['lib/ctptransport.js', transport]]) {
    const id = require.resolve(root(file));
    require.cache[id] = { id, filename: id, loaded: true, exports: exp };
  }
  delete require.cache[require.resolve(root('lib/mint.js'))];
  return require(root('lib/mint.js'));
}

(async () => {
  console.log('\n== CTP between our own installations ==\n');

  await t('RAIL-98: a send copy with no bridge_id still builds the envelope (id from the recipient row)', async () => {
    let sentEnv = null;
    const mint = mintWith({
      send: async (ep, env) => {
        sentEnv = env;
        return { accepted: true, status: 200, why: 'accepted' };
      }
    });
    try {
      await mint.deliver('s1', 'chit-1', [copy], {});
    } catch (e) {
      assert.ok(/a local write must not happen/.test(e.message), 'unexpected: ' + e.message);
    }
    assert.ok(sentEnv, 'no envelope was built or sent');
    assert.strictEqual(sentEnv.to.bridge_id, 'CBSQRH9ASH');
  });

  await t('RAIL-99: the far end answers no -> 409 CTP_REFUSED naming WHO and WHY, nothing written', async () => {
    const mint = mintWith({ send: async () => ({ accepted: false, status: 404, why: 'no active business here called CBGHOST001' }) });
    let err;
    try {
      await mint.deliver('s1', 'chit-2', [copy], {});
    } catch (e) {
      err = e;
    }
    assert.ok(err, 'must refuse');
    const known = require(root('lib/knownerr')).known(err);
    assert.ok(known, 'the refusal is not recognised, so the route would say Send failed (500)');
    assert.strictEqual(known.status, 409);
    assert.strictEqual(known.body.code, 'CTP_REFUSED');
    /* sit/run6 (RAIL-99 x RAIL-129 + Q19): the refusal names WHO from our own row; the far end's own words go to the log, never into the sentence (a value from outside is never echoed) */
    assert.ok(/QA Rish Pty/.test(known.body.message), 'must name who: ' + known.body.message);
    assert.ok(!/CBGHOST001/.test(known.body.message), "the far end's words are logged, not said: " + known.body.message);
    assert.ok(/Nothing was written/.test(known.body.message) && err.refused === true);
  });

  await t('RAIL-99: nobody answers (timeout / unreachable) -> 502 CTP_UNREACHABLE, not 500', async () => {
    const mint = mintWith({ send: async () => ({ accepted: false, status: null, why: 'could not reach https://au.example/api/ctp/deliver: timed out' }) });
    let err;
    try {
      await mint.deliver('s1', 'chit-3', [copy], {});
    } catch (e) {
      err = e;
    }
    const known = require(root('lib/knownerr')).known(err);
    assert.ok(known && known.status === 502 && known.body.code === 'CTP_UNREACHABLE', JSON.stringify(known));
    assert.ok(/timed out/.test(known.body.message) && /again/.test(known.body.message));
  });

  /* SIT run 4 (RAIL-112): a business on a suspended or retired installation was "sent" into this database and never left */
  await t('RAIL-112: a recipient on an INACTIVE installation is refused 409 CTP_PEER_INACTIVE, nothing sent, nothing written', async () => {
    let sent = 0;
    const mint = mintWith({ send: async () => { sent++; return { accepted: true }; } }, { local: false, inactive: true, installation_key: 'sit-grund', endpoint: null, why: 'installation sit-grund is not active here' });
    let err;
    try {
      await mint.deliver('s1', 'chit-9', [copy], {});
    } catch (e) {
      err = e;
    }
    const known = require(root('lib/knownerr')).known(err);
    assert.ok(known && known.status === 409 && known.body.code === 'CTP_PEER_INACTIVE', JSON.stringify(known));
    assert.ok(/sit-grund/.test(known.body.message) && /Nothing was sent and nothing was saved here/.test(known.body.message));
    assert.strictEqual(sent, 0, 'nothing may go on the wire');
  });

  await t('RAIL-99: an ordinary error is still not dressed up as a far-end refusal', async () => {
    assert.strictEqual(require(root('lib/knownerr')).known(new Error('boom')), null);
  });

  await t('RAIL-100: the manifest carries the installation domain, so resolve answers bridge_id@domain', async () => {
    const db = {
      query: async (sql) => {
        if (/FROM installation/.test(sql))
          return {
            rows: [
              {
                installation_key: 'sit-au',
                label: 'sit-au',
                region: 'AU',
                domain: '129-225-90-80.sslip.io',
                ctp_endpoint: 'https://129-225-90-80.sslip.io/api/ctp/deliver'
              }
            ]
          };
        return { rows: [{ code: 'live' }] };
      }
    };
    const ctp = load('routes/ctp.js', { '../db': db });
    const m = await ctp.manifest();
    assert.strictEqual(m.domain, '129-225-90-80.sslip.io');
    assert.strictEqual(require(root('lib/ctpaddress')).format('CBSQRH9ASH', m.domain), 'CBSQRH9ASH@129-225-90-80.sslip.io');
  });

  /* ── RAIL-101 ── an in-memory identities table */
  function world() {
    const rows = [{ identity_id: 'owner-1', bridge_id: 'CBEGY7LB2J', display_name: 'QA Athi', inst: 'sit-in' }];
    const placed = [];
    const q = async (sql, args) => {
      if (/FROM identities WHERE bridge_id = \$1 AND identity_type/.test(sql)) {
        const r = rows.find((x) => x.bridge_id === args[0]);
        return { rows: r ? [{ identity_id: r.identity_id, display_name: r.display_name, installation_key: r.inst }] : [] };
      }
      if (/INSERT INTO identities/.test(sql)) {
        const r = { identity_id: 'new-' + (rows.length + 1), bridge_id: args[0], display_name: args[1], inst: 'sit-in' };
        rows.push(r);
        return { rows: [{ identity_id: r.identity_id, display_name: r.display_name }] };
      }
      if (/f_place_entity/.test(sql)) {
        placed.push(args);
        rows.find((x) => x.identity_id === args[0]).inst = args[1];
        return { rows: [{}] };
      }
      throw new Error('unexpected sql ' + sql);
    };
    return { rows, placed, q };
  }
  const known = { ok: true, local: false, installation_key: 'sit-au', endpoint: 'https://au/api/ctp/deliver', domain: 'au.example' };
  const RP = () => load('lib/remote-party.js', { '../db': { query: async () => { throw new Error('no db'); } } });
  const deps = (w, extra) =>
    Object.assign(
      {
        query: w.q,
        resolveAddress: async () => known,
        ask: async () => ({ ok: true, found: true, bridge_id: 'CBSQRH9ASH', display_name: 'QA Rish Pty', installation_key: 'sit-au', sells_outside: true })
      },
      extra || {}
    );

  await t('RAIL-101: bridge_id@domain makes ONE local row, placed on the remote installation, address computed (no domain copied)', async () => {
    const w = world();
    const got = await RP().adopt('owner-1', 'CBSQRH9ASH@au.example', deps(w));
    assert.ok(got.party && got.created === true, JSON.stringify(got));
    assert.strictEqual(got.party.address, 'CBSQRH9ASH@au.example');
    assert.deepStrictEqual(w.placed, [[got.party.identity_id, 'sit-au']]);
    assert.ok(!('domain' in w.rows[1]), 'the domain must not be stored on the party row');
  });

  await t('RAIL-101: adding the same address again reuses the row', async () => {
    const w = world();
    await RP().adopt('owner-1', 'CBSQRH9ASH@au.example', deps(w));
    const again = await RP().adopt('owner-1', 'CBSQRH9ASH@au.example', deps(w));
    assert.strictEqual(again.created, false);
    assert.strictEqual(w.rows.length, 2);
  });

  await t('RAIL-101: a pasted shared link (or a scanned QR) is accepted like a typed address', async () => {
    const w = world();
    let asked = null;
    const got = await RP().adopt(
      'owner-1',
      'https://au.example/shop.html?s=qa-rish-pty',
      deps(w, {
        ask: async (target, want) => {
          asked = { target, want };
          return { ok: true, found: true, bridge_id: 'CBSQRH9ASH', display_name: 'QA Rish Pty', installation_key: 'sit-au', sells_outside: true };
        }
      })
    );
    assert.ok(got.party, JSON.stringify(got));
    assert.deepStrictEqual(asked.target, { domain: 'au.example', bridge_id: 'qa-rish-pty' });
    assert.strictEqual(asked.want.want, 'resolve');
  });

  await t('RAIL-101: far end unreachable -> 502, nothing written', async () => {
    const w = world();
    const got = await RP().adopt('owner-1', 'CBSQRH9ASH@au.example', deps(w, { ask: async () => ({ ok: false, why: 'could not reach https://au/api/ctp/query: timed out' }) }));
    assert.strictEqual(got.error.status, 502);
    assert.ok(/timed out/.test(got.error.message) && /Nothing was added/.test(got.error.message));
    assert.strictEqual(w.rows.length, 1);
  });

  await t('RAIL-101: far end says no such business -> 404 in its words, nothing written', async () => {
    const w = world();
    const got = await RP().adopt('owner-1', 'CBGHOST001@au.example', deps(w, { ask: async () => ({ ok: true, found: false, why: 'no business here called CBGHOST001' }) }));
    assert.strictEqual(got.error.status, 404);
    assert.ok(/au\.example says: no business here called CBGHOST001/.test(got.error.message));
    assert.strictEqual(w.rows.length, 1);
  });

  await t('RAIL-101: a domain we do not deal with -> 404 for an id, nothing asked or written', async () => {
    const w = world();
    const got = await RP().adopt(
      'owner-1',
      'CBSQRH9ASH@stranger.example',
      deps(w, {
        resolveAddress: async () => ({ ok: false, why: 'no installation we deal with answers for stranger.example' }),
        ask: async () => {
          throw new Error('must not ask');
        }
      })
    );
    assert.strictEqual(got.error.status, 404);
    assert.strictEqual(w.rows.length, 1);
  });

  await t('RAIL-101: an e-mail is NOT an address (falls through to the e-mail lookup); a bare id is local', async () => {
    const w = world();
    const d = deps(w, { resolveAddress: async () => ({ ok: false, why: 'x' }) });
    const mail = await RP().adopt('owner-1', 'owner@shop.example.com', d);
    assert.deepStrictEqual(mail, { local: true, bridge: 'owner@shop.example.com' });
    const bare = await RP().adopt('owner-1', 'CBSQRH9ASH', d);
    assert.deepStrictEqual(bare, { local: true, bridge: 'CBSQRH9ASH' });
  });

  await t('RAIL-101: the same id held HERE by another business -> 409 CTP_ADDRESS_CLASH, never linked to a stranger', async () => {
    const w = world();
    w.rows.push({ identity_id: 'other', bridge_id: 'CBSQRH9ASH', display_name: 'Someone Else', inst: 'sit-in' });
    const got = await RP().adopt('owner-1', 'CBSQRH9ASH@au.example', deps(w));
    assert.strictEqual(got.error.status, 409);
    assert.strictEqual(got.error.code, 'CTP_ADDRESS_CLASH');
  });

  /* ── RAIL-104 ── the manifest cache: a failure is short, a rotated key is re-read once */
  const directory = (served) => {
    const dir = load('lib/ctpdirectory.js', { './safe-url': { assertPublicHttps: async () => ({ ok: true }) } });
    global.fetch = async () => {
      const next = served.shift();
      if (next === 'down') throw Object.assign(new Error('refused'), { name: 'TypeError' });
      /* RAIL-140 c (main): the manifest body is read through its stream, capped in bytes, so the stand-in serves a body reader */
      const bytes = Buffer.from(JSON.stringify({ ctp: '1', installation_key: 'sit-au', public_key: next }));
      let given = false;
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (given ? { done: true } : ((given = true), { done: false, value: bytes })), cancel: async () => {} }) } };
    };
    return dir;
  };
  const realNow = Date.now;
  const atTime = (ms) => {
    Date.now = () => ms;
  };

  await t('RAIL-104: a failed manifest read is retried after seconds, not kept for 15 minutes', async () => {
    const dir = directory(['down', 'KEY-A']);
    try {
      atTime(1000000);
      const first = await dir.publicKeyFor('au.example', 'sit-au');
      assert.strictEqual(first.ok, false);
      atTime(1000000 + 5000);
      assert.strictEqual((await dir.publicKeyFor('au.example', 'sit-au')).ok, false, 'within seconds the failure may be reused');
      atTime(1000000 + dir.FAILURE_TTL_MS + 1000);
      const later = await dir.publicKeyFor('au.example', 'sit-au');
      assert.ok(later.ok && later.public_key === 'KEY-A', 'the peer is back; the next delivery must find it');
    } finally {
      Date.now = realNow;
    }
  });

  await t('RAIL-104: a key that stopped verifying is re-read once (throttled), so a rotation heals itself', async () => {
    const dir = directory(['KEY-OLD', 'KEY-NEW']);
    try {
      atTime(2000000);
      assert.strictEqual((await dir.publicKeyFor('au.example', 'sit-au')).public_key, 'KEY-OLD');
      atTime(2000000 + 1000);
      assert.strictEqual((await dir.publicKeyFor('au.example', 'sit-au', { fresh: true })).public_key, 'KEY-OLD', 'a re-read a second after the last one is refused (no dial per bad envelope)');
      atTime(2000000 + dir.REREAD_MIN_MS + 1000);
      assert.strictEqual((await dir.publicKeyFor('au.example', 'sit-au', { fresh: true })).public_key, 'KEY-NEW');
    } finally {
      Date.now = realNow;
    }
  });

  await t('RAIL-104: the receiving door tries the published key once more before it refuses a signature', async () => {
    const src = require('fs').readFileSync(root('routes/ctp.js'), 'utf8');
    assert.ok(/signature did not verify[\s\S]{0,400}fresh: true/.test(src));
  });

  /* sit/run6: RAIL-105's alreadyHeld (a unique-key fault read after the write) is replaced on main by RAIL-138 c deliverOnce (our copy read BEFORE the write); the behaviour it protected is pinned on deliverOnce */
  await t('RAIL-105: the same chit sent twice is accepted as a repeat (nothing written), a chit id held by another sender is not', async () => {
    const S1 = 'a1000000-0000-4000-8000-000000000001', S2 = 'a2000000-0000-4000-8000-000000000002';
    let written = 0;
    const held = (rows) => ({ '../db': { query: async () => ({ rows: [] }), withEntity: async (id, fn) => fn({ query: async () => ({ rows }) }) }, '../lib/mint': { deliver: async () => { written++; } } });
    const opened = { chit_id: 'c1', header: { sender_entity_id: S1 } };
    const copyOf = { sender_entity_id: S1 };
    assert.deepStrictEqual(await load('routes/ctp.js', held([{ sender_entity_id: S1 }])).deliverOnce(opened, copyOf, 'sit-au', 'r1'), { repeat: true });
    assert.strictEqual(written, 0, 'a repeat writes nothing');
    const other = await load('routes/ctp.js', held([{ sender_entity_id: S2 }])).deliverOnce(opened, copyOf, 'sit-au', 'r1');
    assert.ok(other.refusal && other.refusal.code === 'CTP_CHIT_ID_TAKEN' && other.refusal.status === 409, JSON.stringify(other));
    assert.deepStrictEqual(await load('routes/ctp.js', held([])).deliverOnce(opened, copyOf, 'sit-au', 'r1'), { repeat: false });
    assert.strictEqual(written + 0, 1, 'a chit not held yet is written once');
  });

  await t('RAIL-101: the add-supplier route calls the existing seam (no parallel route)', async () => {
    const src = require('fs').readFileSync(root('routes/relationships.js'), 'utf8');
    assert.ok(/require\('\.\.\/lib\/remote-party'\)\.adopt/.test(src));
    assert.ok(!/router\.post\(\s*'\/suppliers\/remote/.test(src));
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
