'use strict';
/**
 * tests/set86-country-setup-merge.realstack.cjs — SET-86 on a REAL Postgres, as the role the api runs as (cb_app, NOBYPASSRLS).
 *
 * A stub db cannot show a row lock or RLS. One India shop, seeded as cb_app (an identities row, then country-setup.save through withEntity, RLS on):
 *   R1  the tax block omitted: the stored answer, the GSTIN and the flag are byte-for-byte what they were (the P1: on main they were wiped)
 *   R2  registered false on a registered shop without the confirm → 409 TAX_DEREGISTER_UNCONFIRMED, nothing moved; with confirm_deregister → cleared, flag 'unregistered'
 *   R3  RACE: save A (a new number and a source key) holds its transaction open while save B (another source key, no tax) starts; B waits on the
 *       governance row (FOR UPDATE) and then merges over A's committed answer — both source keys and A's number survive (a stale read would lose A's)
 * Every row it makes is deleted at the end. Allow list: it runs only as cb_app on localhost, the compose db or a SIT host.
 * Run: DATABASE_URL=postgres://cb_app:cbapp@localhost:5432/cb_s41 node tests/set86-country-setup-merge.realstack.cjs   (CI: the integration S41 job; SIT: inside the api container;
 *      the local stack: DATABASE_URL=postgres://cb_app:<its cb_app password, toolset/local-stack.sh API_DB_URL>@127.0.0.1:55432/cb_local)
 * CARD      20-settings-governance-and-plan/README
 */
const url = process.env.DATABASE_URL || '';
const ALLOWED_HOSTS = /^(localhost|127\.0\.0\.1|db|sit-[a-z]+(\.[a-z0-9.-]+)?)$/;
const parts = /^postgres(?:ql)?:\/\/([^:@/]+):[^@]*@([^:/]+)/.exec(url);
if (!parts || parts[1] !== 'cb_app' || !ALLOWED_HOSTS.test(parts[2])) { console.error('REFUSED: needs DATABASE_URL as cb_app on localhost, the compose db or a SIT host'); process.exit(3); }
const { withEntity, query } = require('../db');
const CS = require('../lib/country-setup');
let pass = 0, fail = 0;
const ok = (what, cond, info) => { if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what + (info ? '\n         ' + String(info).slice(0, 300) : '')); } };
const RUN = 'sx' + (Date.now() % 1e10).toString(36);
const made = [];
const GSTIN = '33AAAAA0000A1Z9', NEW_GSTIN = '27AAPFU0939F1ZV';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = (extra) => Object.assign({ country: 'IN', currency: 'INR', fy_start_month: 4 }, extra);
const save = (id, b) => withEntity(id, (h) => CS.save(h, id, b, id));
async function shop() {
  const row = await query(`INSERT INTO identities (bridge_id, display_name, identity_type, country, currency_code) VALUES ($1, $2, 'entity', 'IN', 'INR') RETURNING identity_id`, ['CB' + RUN, 'Merge ' + RUN]);
  made.push(row.rows[0].identity_id);
  return row.rows[0].identity_id;
}
/** what the shop holds now, read as the shop */
const held = (id) => withEntity(id, async (h) => {
  const i = (await h.query('SELECT gstn, policy_flags FROM identities WHERE identity_id = $1', [id])).rows[0];
  const g = (await h.query('SELECT tax_registration, setup_source, fy_start_month FROM entity_governance WHERE entity_id = $1', [id])).rows[0];
  return { gstn: i.gstn, flag: (i.policy_flags || {}).gst_registration || null, tax: g.tax_registration, source: g.setup_source, fy: g.fy_start_month };
});
(async () => {
  console.log('\n── SET-86 country-setup merge-patch under RLS · run ' + RUN + ' ──');
  try {
    const id = await shop();
    await save(id, body({ tax: { registered: true, number: GSTIN, scheme: 'regular' }, source: { tax: 'typed' } }));
    const first = await held(id);
    ok('seed: registered with the number, flag regular, source tax typed', first.gstn === GSTIN && first.tax && first.tax.registered === true && first.flag === 'regular' && first.source.tax === 'typed', JSON.stringify(first));

    await save(id, body());
    const r1 = await held(id);
    ok('R1 the tax block omitted: gstn, tax_registration, flag and source are exactly as they were', JSON.stringify(r1) === JSON.stringify(first), JSON.stringify([first, r1]));
    await save(id, body({ tax: { registered: null, number: null, scheme: null } }));
    ok('R1b registered null with null number/scheme over a known answer changes nothing', JSON.stringify(await held(id)) === JSON.stringify(first));

    let err = null;
    try { await save(id, body({ tax: { registered: false, number: null, scheme: null } })); } catch (e) { err = e; }
    ok('R2a registered false without the confirm: 409 TAX_DEREGISTER_UNCONFIRMED', !!err && err.status === 409 && err.code === 'TAX_DEREGISTER_UNCONFIRMED', err && err.message);
    ok('R2b …and nothing moved', JSON.stringify(await held(id)) === JSON.stringify(first));
    await save(id, body({ tax: { registered: false, number: null, scheme: null }, confirm_deregister: true }));
    const gone = await held(id);
    ok('R2c with the confirm: answer false, number and scheme cleared, gstn NULL, flag unregistered', gone.tax && gone.tax.registered === false && gone.tax.number === null && gone.gstn === null && gone.flag === 'unregistered', JSON.stringify(gone));
    await save(id, body({ tax: { registered: true, number: GSTIN, scheme: 'regular' } }));

    /* R3 the race: A holds its transaction open 800 ms after its save; B starts at 200 ms */
    const t0 = Date.now();
    let bDone = 0;
    const A = withEntity(id, async (h) => {
      await CS.save(h, id, body({ tax: { number: NEW_GSTIN }, source: { tax: 'typed by A' } }), id);
      await sleep(800);
    });
    await sleep(200);
    const B = save(id, body({ source: { timezone: 'picked by B' } })).then(() => { bDone = Date.now() - t0; });
    await Promise.all([A, B]);
    const raced = await held(id);
    ok('R3a B waited for A (the row lock): B finished only after A\'s transaction ended', bDone >= 750, 'B took ' + bDone + ' ms');
    ok('R3b B merged over A\'s committed answer: A\'s number and BOTH source keys survive', raced.gstn === NEW_GSTIN && raced.tax.number === NEW_GSTIN && raced.source.tax === 'typed by A' && raced.source.timezone === 'picked by B', JSON.stringify(raced));
  } catch (e) {
    ok('the run reached its end', false, e && e.stack);
  } finally {
    for (const id of made) { try { await withEntity(id, (h) => h.query('DELETE FROM entity_governance WHERE entity_id = $1', [id])); } catch (e) { /* cb_app may not delete it: the identity delete cascades */ } try { await query('DELETE FROM identities WHERE identity_id = $1', [id]); } catch (e) { console.log('  cleanup identity: ' + e.message); } }
  }
  console.log('\n' + (fail ? 'FAIL ' + fail + ' · ' : 'ok ') + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})();
