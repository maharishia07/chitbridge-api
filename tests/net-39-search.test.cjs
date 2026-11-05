/**
 * tests/net-39-search.test.cjs — NET-39: FIND A BUSINESS (then a product) ON ANOTHER INSTALLATION. Here and There run the SAME function (lib/business-search.find).
 *
 *   A  the one search: Here a name finds every known shop (private too, NET-47; never a "~" party), There only LISTED shops (private, capped, closed are not answered); q < 2 characters is refused in words; limit 500 becomes 20;
 *      kind=product finds a product in a listed shop's PUBLIC view only; an exact handle or bridge id still resolves Here (A1: unchanged)
 *   B  the signed question `search` at the door: listed shops and public fields only (no contact, tax number, uuid); an asker without a certificate is refused; a short q is refused in words
 *   C  the asking side: where=here | one installation | all, one after another with a 5 s timeout; one installation silent → partial results and the why in words;
 *      suspended installations never offered; the same result shape Here and There; the address comes from ctpaddress.format
 *   D  add from a result: the result's address goes to lib/remote-party.adopt, which makes the party row placed on that installation (no new add path)
 *
 * Offline: the database, the address book and the transport are stubs. Run: node tests/net-39-search.test.cjs
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const G = require('./support/route-golden.cjs');
const API = G.API;

/* ── the world: shops on THIS installation (sit-in) ── */
const shop = (n, over) =>
  Object.assign(
    {
      identity_id: 'id-' + n, display_name: 'Shop ' + n, bridge_id: 'CBSHOP000' + n, user_id: 'shop-' + n, currency_code: 'INR', logo_url: null,
      business_status: 'open', population: 'live', catalogue_visibility: 'public', plan: 'free', params_override: {}, entity_visibility: 'public',
      gstn: '29SECRET', address: '1 Hidden Road', email: 'x@y.z', trade_mode: 'domestic'
    },
    over || {}
  );
const WORLD = {
  shops: [
    shop(1, { display_name: 'Timer House', trade_mode: 'export' }),
    shop(2, { display_name: 'Timer Hidden', user_id: 'timer-hidden', catalogue_visibility: 'private', bridge_id: 'CBPRIV0002' }),
    shop(3, { display_name: 'Timer Capped', params_override: { caps: { catalogue_visibility: 'private' } }, bridge_id: 'CBCAPD0003' }),
    shop(4, { display_name: 'Timer Closed', business_status: 'closed', bridge_id: 'CBCLOS0004' }),
    shop(5, { display_name: 'Timer Minted', user_id: '~acme.timer', bridge_id: 'CBMINT0005' }),
    shop(6, { display_name: 'Timer Works', bridge_id: 'CBWORK0006' })
  ]
};
function rows(s, p) {
  if (/FROM entity_profile WHERE entity_id = \$1/.test(s)) {
    const owner = WORLD.shops.find((x) => x.identity_id === p[0]);
    return owner ? [{ trade_mode: owner.trade_mode }] : [];
  }
  if (/FROM identities\s+WHERE \(bridge_id = \$1 OR LOWER\(user_id\)/.test(s)) return WORLD.shops.filter((x) => x.bridge_id === p[0]);
  if (/FROM identities WHERE \(LOWER\(user_id\) = LOWER\(\$1\) OR bridge_id = UPPER\(\$1\)\)/.test(s))
    return WORLD.shops.filter((x) => (x.user_id.toLowerCase() === p[0].toLowerCase() || x.bridge_id === String(p[0]).toUpperCase()) && !String(x.user_id).startsWith('~') && x.identity_id !== p[1]);
  if (/entity_schemas/.test(s)) return WORLD.shops.filter((x) => x.catalogue_visibility === 'public' && !String(x.user_id).startsWith('~'));
  if (/LOWER\(display_name\) LIKE \$1/.test(s)) {
    const text = p[0].replace(/%/g, '');
    const listedOnly = /catalogue_visibility = 'public'/.test(s);
    return WORLD.shops.filter((x) => (!listedOnly || x.catalogue_visibility === 'public') && !['internal', 'private'].includes(x.entity_visibility) && !String(x.user_id).startsWith('~') && (x.display_name.toLowerCase().includes(text) || x.user_id.toLowerCase().includes(text)));
  }
  if (/to_jsonb\(i\) ->> 'network_role'/.test(s)) return [{ network_role: 'standalone' }];
  if (/FROM installation WHERE installation_key = \$1/.test(s)) return [{ installation_key: 'sit-au', domain: 'au.example.com', hosted_locally: false, active: true }];
  return [];
}
const h = G.harness({ rows });
const bs = require(path.join(API, 'lib', 'business-search'));
const book = require(path.join(API, 'lib', 'ctpaddress'));
const ns = require(path.join(API, 'lib', 'network-search'));
const ctpquery = require(path.join(API, 'lib', 'ctpquery'));
const net = require(path.join(API, 'lib', 'netmember'));
const directory = require(path.join(API, 'lib', 'ctpdirectory'));
const keys = require(path.join(API, 'lib', 'ctpkeys'));
const remoteParty = require(path.join(API, 'lib', 'remote-party'));

let pass = 0,
  fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log('   ok   ' + name);
  } catch (e) {
    fail++;
    console.log('   FAIL ' + name + '\n          ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n          ') : e));
  }
};
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
};
const ok = (c, m) => {
  if (!c) throw new Error(m || 'not true');
};
const names = (r) => r.results.map((x) => x.display_name);
const FIELDS = ['address', 'bridge_id', 'display_name', 'domain', 'hits', 'installation_key', 'kind', 'user_id', 'where'];

/* the book: sit-au and sit-za are active, sit-nz is suspended */
book.remoteInstallations = async () =>
  new Map([
    ['sit-au', { endpoint: 'https://au.example.com/api/ctp/deliver', active: true, domain: 'au.example.com', label: 'Sit AU' }],
    ['sit-nz', { endpoint: 'https://nz.example.com/api/ctp/deliver', active: false, domain: 'nz.example.com', label: 'Sit NZ' }],
    ['sit-za', { endpoint: 'https://za.example.com/api/ctp/deliver', active: true, domain: 'za.example.com', label: 'Sit ZA' }]
  ]);

const ME = { identity_id: 'id-me', bridge_id: 'CBMYSELF01' };
const SEARCHES = [];
const FAR_VIEW = async () => ({ available: true, items: [{ item_data: { name: 'Timer relay', unit: 'pc', price: 450 } }], shop: { currency_code: 'AUD' } });
/* the far side = the SAME find over its own world; sit-za never answers */
const askStub = async (target, want, deps) => {
  SEARCHES.push({ domain: target.domain, want, timeout: deps && deps.timeout });
  if (target.domain === 'za.example.com') return { ok: false, why: 'could not reach https://za.example.com/api/ctp/query: timed out' };
  const found = await bs.find({ q: want.q, kind: want.kind, limit: want.limit }, { viewFor: FAR_VIEW, abroad: true });
  return Object.assign({ ok: true, found: found.results.length > 0 }, found);
};

(async () => {
  console.log('\n== NET-39 · A · the one search ==\n');
  await t('Here: a name finds every known shop (private, capped, closed too), never a minted party; There keeps listed shops only (B)', async () => {
    const r = await bs.find({ q: 'timer' });
    eq(names(r).sort(), ['Timer Capped', 'Timer Closed', 'Timer Hidden', 'Timer House', 'Timer Works']);
  });
  await t('no contact, tax number, address or uuid is in a row', async () => {
    const r = await bs.find({ q: 'timer house' });
    eq(Object.keys(r.results[0]).sort(), ['bridge_id', 'display_name', 'hits', 'kind', 'user_id']);
  });
  await t('one character is refused in words, nothing is read', async () => {
    const r = await bs.find({ q: 't' });
    ok(!r.ok && r.code === 'SEARCH_TOO_SHORT' && /at least 2 characters/.test(r.why));
  });
  await t('wildcards are not a search: "%%" is too short, "t%" too', async () => {
    ok(!(await bs.find({ q: '%%' })).ok);
    ok(!(await bs.find({ q: 't%' })).ok);
  });
  await t('limit 500 becomes 20; junk becomes the default', async () => {
    eq(bs.MAX_LIMIT, 20);
    const many = Array.from({ length: 30 }, (_, i) => shop(100 + i, { display_name: 'Bulk ' + i, bridge_id: 'CBBULK0' + (100 + i), user_id: 'bulk-' + i }));
    const was = WORLD.shops;
    WORLD.shops = many;
    try {
      eq((await bs.find({ q: 'bulk', limit: 500 })).results.length, 20);
      eq((await bs.find({ q: 'bulk', limit: 'x' })).results.length, 10);
    } finally {
      WORLD.shops = was;
    }
  });
  await t('kind=product: the product is found in a listed shop only, with the public price', async () => {
    const r = await bs.find({ q: 'relay', kind: 'product' }, { viewFor: async () => ({ available: true, items: [{ item_data: { name: 'Timer relay', unit: 'pc', price: 450 } }, { item_data: { name: 'Cable' } }], shop: { currency_code: 'INR' } }) });
    eq(names(r).sort(), ['Timer House', 'Timer Works']);
    eq(r.results[0].hits, [{ name: 'Timer relay', unit: 'pc', price: 450, currency: 'INR' }]);
  });
  await t('kind=product: a shop whose catalogue is not showing is left out, not reported as "no"', async () => {
    const r = await bs.find({ q: 'relay', kind: 'product' }, { viewFor: async () => ({ available: false }) });
    eq(r.results, []);
  });
  await t('A1 Here: an exact handle or bridge id resolves, and so does a name, even for a private (unlisted) shop', async () => {
    eq(names(await ns.searchHere({ q: 'timer-hidden', kind: 'business', limit: 10 }, ME)), ['Timer Hidden']);
    eq(names(await ns.searchHere({ q: 'cbpriv0002', kind: 'business', limit: 10 }, ME)), ['Timer Hidden']);
    eq(names(await ns.searchHere({ q: 'hidden', kind: 'business', limit: 10 }, ME)), ['Timer Hidden']);
  });
  await t('NET-47 a private connected shop is found on Here by name, and not on There', async () => {
    eq(names(await bs.find({ q: 'hidden' })), ['Timer Hidden']);
    eq(names(await bs.find({ q: 'hidden' }, { abroad: true, openAbroad: async () => true })), []);
  });
  await t('Here never returns the asker itself', async () => {
    const r = await ns.searchHere({ q: 'timer', kind: 'business', limit: 10 }, { identity_id: 'id-1', bridge_id: 'CBSHOP0001' });
    eq(names(r).sort(), ['Timer Capped', 'Timer Closed', 'Timer Hidden', 'Timer Works']);
  });

  console.log('\n== B · the signed question at the door ==\n');
  const kp = crypto.generateKeyPairSync('ed25519');
  const pem = kp.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signer = { alg: 'ed25519', sign: (hash) => crypto.sign(null, Buffer.from(hash, 'utf8'), kp.privateKey).toString('base64') };
  directory.publicKeyFor = async () => ({ ok: true, public_key: pem, manifest: { ctp: '1', installation_key: 'sit-au', public_key: pem } });
  process.env.INSTALLATION_KEY = 'sit-in';
  keys._reset();
  let HAS_CERT = true;
  net.doorVerdict = async (ik) => (HAS_CERT ? { ok: true } : { ok: false, status: 403, code: 'CTP_NO_MEMBERSHIP', why: ik + ' holds no membership certificate from the network master' });
  const app = h.app('/api/ctp', require(path.join(API, 'routes', 'ctp')));
  const build = (a) => ctpquery.build({ installation_key: 'sit-au', population: 'live' }, { domain: 'in.example.com' }, a);
  const door = (body) => h.run(app, { url: '/api/ctp/query', body, identity: {}, ctx: {} });
  const asked = (a, mutate) => {
    const q = build(a);
    if (mutate) mutate(q);
    return ctpquery.sign(q, signer);
  };
  require(path.join(API, 'routes', 'catalogue')).publicViewFor = FAR_VIEW;

  await t('a listed shop that did not opt in to sell outside (Timer Works) is not answered to another installation, but Here still finds it', async () => {
    const abroad = await bs.find({ q: 'timer works' }, { abroad: true });
    eq(abroad.results, []);
    eq(names(await bs.find({ q: 'timer works' })), ['Timer Works']);
    eq(names(await ns.searchHere({ q: 'timer works', kind: 'business', limit: 10 }, ME)), ['Timer Works']);
  });
  await t('a failed read of the switch fails closed: not shown abroad', async () => {
    const abroad = await bs.find({ q: 'timer house' }, { abroad: true, openAbroad: async () => false });
    eq(abroad.results, []);
  });
  await t('the catalogue question: an opted-in shop is answered; a domestic one is "not found", the same words as an unknown id', async () => {
    const yes = await door(asked({ want: 'catalogue', bridge_id: 'CBSHOP0001' }));
    ok(yes.body.found === true, JSON.stringify(yes.body));
    const no = await door(asked({ want: 'catalogue', bridge_id: 'CBWORK0006' }));
    const unknown = await door(asked({ want: 'catalogue', bridge_id: 'CBNONE0000' }));
    ok(no.body.found === false && !no.body.items);
    eq(no.body.why.replace('CBWORK0006', 'X'), unknown.body.why.replace('CBNONE0000', 'X'));
  });
  await t('the answer gives listed shops only and public fields only', async () => {
    const r = await door(asked({ want: 'search', q: 'timer' }));
    eq(r.status, 200);
    eq(r.body.results.map((x) => x.display_name).sort(), ['Timer House']);
    ok(!/29SECRET|Hidden Road|x@y\.z|id-1/.test(JSON.stringify(r.body)), 'a private field left the installation');
    ok(r.body.ok === true && r.body.found === true);
  });
  await t('an asker with no certificate is refused in words and nothing is searched', async () => {
    HAS_CERT = false;
    const r = await door(asked({ want: 'search', q: 'timer' }));
    HAS_CERT = true;
    eq(r.status, 403);
    ok(/CTP_NO_MEMBERSHIP/.test(JSON.stringify(r.body)) && !r.body.results);
    ok(net.needsMembership('search') === true, 'search must need the certificate');
  });
  await t('limit 500 asked over the wire is clamped to 20 by the answerer', async () => {
    const was = WORLD.shops;
    WORLD.shops = Array.from({ length: 30 }, (_, i) => shop(200 + i, { display_name: 'Wire ' + i, bridge_id: 'CBWIRE0' + (200 + i), user_id: 'wire-' + i, trade_mode: 'export' }));
    const r = await door(asked({ want: 'search', q: 'wire' }, (q) => (q.ask.limit = 500)));
    WORLD.shops = was;
    eq(r.body.results.length, 20);
  });
  await t('a one-character question is refused in words (400, CTP_SEARCH_TOO_SHORT)', async () => {
    const r = await door(asked({ want: 'search', q: 'tt' }, (q) => (q.ask.q = 't')));
    eq(r.status, 400);
    ok(/CTP_SEARCH_TOO_SHORT/.test(JSON.stringify(r.body)) && /at least 2 characters/.test(JSON.stringify(r.body)));
  });
  await t('the asker cannot even build a one-character question', async () => {
    let said = '';
    try {
      ctpquery.build({ installation_key: 'x' }, { domain: 'a.b' }, { want: 'search', q: 'a' });
    } catch (e) {
      said = e.message;
    }
    ok(/at least 2 characters/.test(said));
  });

  console.log('\n== C · the asking side ==\n');
  await t('the picker offers active installations only, by name and domain', async () => {
    eq(await ns.places(), [
      { installation_key: 'sit-au', domain: 'au.example.com', label: 'Sit AU' },
      { installation_key: 'sit-za', domain: 'za.example.com', label: 'Sit ZA' }
    ]);
  });
  await t('where=sit-au: the far listed shops, address from ctpaddress.format, installation and domain, 5 s timeout', async () => {
    SEARCHES.length = 0;
    const r = await ns.search({ q: 'timer', kind: 'business', limit: 10 }, ME, 'sit-au', { ask: askStub });
    ok(r.ok);
    eq(r.answers, [{ installation_key: 'sit-au', ok: true, why: null }]);
    eq(names(r).sort(), ['Timer House']);
    eq(r.results[0].address, book.format(r.results[0].bridge_id, 'au.example.com'));
    eq([r.results[0].installation_key, r.results[0].domain], ['sit-au', 'au.example.com']);
    eq(SEARCHES[0].timeout, 5000);
  });
  await t('a suspended installation is never asked, even by name', async () => {
    const r = await ns.search({ q: 'timer', kind: 'business', limit: 10 }, ME, 'sit-nz', { ask: askStub });
    ok(!r.ok && r.code === 'SEARCH_PLACE_UNKNOWN');
  });
  await t('where=all: Here + each installation one after another; sit-za timing out gives partial results and the why in words', async () => {
    SEARCHES.length = 0;
    const r = await ns.search({ q: 'timer', kind: 'business', limit: 10 }, ME, 'all', { ask: askStub });
    ok(r.ok);
    eq(
      SEARCHES.map((s) => s.domain),
      ['au.example.com', 'za.example.com']
    );
    eq(r.answers[1], { installation_key: 'sit-za', ok: false, why: 'Sit ZA did not answer in 5 seconds.' });
    ok(r.results.some((x) => x.installation_key === 'sit-au') && r.results.some((x) => x.where === 'Here'));
  });
  await t('the same result shape Here and There', async () => {
    const r = await ns.search({ q: 'timer', kind: 'business', limit: 10 }, ME, 'all', { ask: askStub });
    for (const row of r.results) eq(Object.keys(row).sort(), FIELDS);
  });
  await t('a far peer that sends more than public fields is trimmed on arrival', async () => {
    const greedy = async () => ({ ok: true, found: true, results: [{ bridge_id: 'CBGREED001', display_name: 'Greedy', gstn: '29SECRET', email: 'e@x', hits: [] }] });
    const r = await ns.search({ q: 'greedy', kind: 'business', limit: 10 }, ME, 'sit-au', { ask: greedy });
    eq(Object.keys(r.results[0]).sort(), FIELDS);
    ok(!/29SECRET|e@x/.test(JSON.stringify(r)));
  });
  await t('an installation that throws is an answer row, not a failure of the search', async () => {
    const r = await ns.search(
      { q: 'timer', kind: 'business', limit: 10 },
      ME,
      'sit-au',
      {
        ask: async () => {
          throw new Error('boom');
        }
      }
    );
    ok(r.ok && r.answers[0].ok === false && /Sit AU could not be searched/.test(r.answers[0].why));
  });
  await t('kind=product There: hits come back with the price and the far currency', async () => {
    const r = await ns.search({ q: 'relay', kind: 'product', limit: 10 }, ME, 'sit-au', { ask: askStub });
    ok(r.results.length > 0 && r.results[0].hits[0].name === 'Timer relay' && r.results[0].hits[0].currency === 'AUD');
  });

  console.log('\n== D · add from a result ==\n');
  await t('the result’s address goes to remote-party.adopt: a party row placed on sit-au, no new add path', async () => {
    const r = await ns.search({ q: 'timer house', kind: 'business', limit: 10 }, ME, 'sit-au', { ask: askStub });
    const row = r.results[0];
    const sql = [];
    const adopted = await remoteParty.adopt('owner-1', row.address, {
      resolveAddress: async (a) => ({ ok: true, local: false, installation_key: 'sit-au', domain: 'au.example.com', endpoint: 'x', why: a }),
      ask: async () => ({ ok: true, found: true, bridge_id: row.bridge_id, display_name: row.display_name, installation_key: 'sit-au', sells_outside: true }),
      query: async (s, p) => {
        sql.push([s.replace(/\s+/g, ' '), p]);
        return { rows: /INSERT INTO identities/.test(s) ? [{ identity_id: 'new-1', display_name: row.display_name }] : [] };
      }
    });
    ok(adopted.party && adopted.created, JSON.stringify(adopted));
    eq(adopted.party.installation_key, 'sit-au');
    eq(adopted.party.address, row.address);
    ok(sql.some(([s, p]) => /f_place_entity/.test(s) && p[1] === 'sit-au'), 'the party was not placed on sit-au');
  });
  await t('DECISIONS 14:50 · a shop that does NOT sell outside cannot be added as a supplier from another installation: by address, 409 in words, nothing written', async () => {
    const sql = [];
    const refused = await remoteParty.adopt('owner-1', 'CBMZ5MN34G@au.example.com', {
      resolveAddress: async () => ({ ok: true, local: false, installation_key: 'sit-au', domain: 'au.example.com', endpoint: 'x' }),
      ask: async () => ({ ok: true, found: true, bridge_id: 'CBMZ5MN34G', display_name: 'Sydney Spice', installation_key: 'sit-au', sells_outside: false }),
      query: async (s) => {
        sql.push(s);
        return { rows: [] };
      }
    });
    eq(refused.error.status, 409);
    eq(refused.error.code, 'SUPPLIER_SELLS_ONLY_HERE');
    eq(refused.error.message, 'Sydney Spice sells only on their own ChitBridge, so they cannot be your supplier from here.');
    ok(!sql.some((s) => /INSERT INTO identities|f_place_entity/.test(s)), 'nothing was added');
    /* a far side that does not say is treated as not selling outside: fails closed */
    const silent = await remoteParty.adopt('owner-1', 'CBMZ5MN34G@au.example.com', {
      resolveAddress: async () => ({ ok: true, local: false, installation_key: 'sit-au', domain: 'au.example.com', endpoint: 'x' }),
      ask: async () => ({ ok: true, found: true, bridge_id: 'CBMZ5MN34G', display_name: 'Sydney Spice', installation_key: 'sit-au' }),
      query: async () => ({ rows: [] })
    });
    eq(silent.error.code, 'SUPPLIER_SELLS_ONLY_HERE');
  });
  await t('…the same from a SEARCH result: the result’s address goes to the same adopt, and a shop that has since stopped selling outside is refused the same way', async () => {
    const r = await ns.search({ q: 'timer house', kind: 'business', limit: 10 }, ME, 'sit-au', { ask: askStub });
    const row = r.results[0];
    const refused = await remoteParty.adopt('owner-1', row.address, {
      resolveAddress: async () => ({ ok: true, local: false, installation_key: 'sit-au', domain: 'au.example.com', endpoint: 'x' }),
      ask: async () => ({ ok: true, found: true, bridge_id: row.bridge_id, display_name: row.display_name, installation_key: 'sit-au', sells_outside: false }),
      query: async () => ({ rows: [] })
    });
    eq(refused.error.code, 'SUPPLIER_SELLS_ONLY_HERE');
    ok(refused.error.message.indexOf(row.display_name) === 0, refused.error.message);
  });
  await t('…a supplier on the SAME installation is unchanged: nothing is asked of any far side, the ordinary path continues', async () => {
    let asked = 0;
    const out = await remoteParty.adopt('owner-1', 'CBLOCAL001@au.example.com', {
      resolveAddress: async () => ({ ok: true, local: true, bridge_id: 'CBLOCAL001' }),
      ask: async () => {
        asked++;
        return {};
      },
      query: async () => ({ rows: [] })
    });
    ok(out.local === true && asked === 0, JSON.stringify(out));
  });
  await t('the far side’s resolve answer carries sells_outside from the one rule (lib/profile isExporter), not a second check', async () => {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'ctp.js'), 'utf8');
    ok(/sells_outside: await require\('\.\.\/lib\/profile'\)\.isExporter\(ent\.identity_id\)/.test(src));
  });
  await t('the add route is still the old one: POST /suppliers { supplier_bridge_id: address } goes through remoteAddress → adopt', async () => {
    const src = require('fs').readFileSync(path.join(API, 'routes', 'relationships.js'), 'utf8');
    ok(/require\('\.\.\/lib\/remote-party'\)\.adopt\(ctx\(req\), typed\)/.test(src));
    /* API-4 (25 Oct): the express-validator array became the door's schema check; the address gate still stands right after it */
    /* sit/run6: main's chain is the express-validator array, auth, validateAsProblem, then the door's schema check (checked); the address gate still stands right after it */
    ok(/'\/suppliers',[\s\S]{0,900}?\.\.\.checked\('POST \/suppliers'\),\s*remoteAddress,/.test(src));
  });

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
