/**
 * The User ID rule, exercised through the REAL route handlers with a stubbed database.
 *
 * ⚠️ Not a unit test of checkRoot — that would pass while the routes ignored it, which is exactly the failure
 * the hat gate had (20/20 green while the gate read the wrong property). This drives express.
 */
const path = require('path');
const API = 'C:/dev/chitbridge-api';
const DB = { envelope: null, user_id: null, taken: new Set(['acmetraders']) };

require.cache[require.resolve(API + '/db')] = { exports: { query: async (sql, p) => {
  /* ⚠⚠ THE CONSTITUTION MUST ANSWER, OR THE ENVELOPE TESTS BELOW PASS VACUOUSLY. Without this branch the
     stub returns no rows, resolveEntityGovernance finds no allowed set, and EVERY currency is permitted — so
     'CNY is accepted' would have proved nothing about b179 and would have stayed green if b179 were reverted.
     Measuring the stub instead of the feature; it has cost me five bugs, so the envelope is stubbed in. */
  if (/FROM constitution/.test(sql)) {
    return { rows: [{ constitution_key: 'base', version: 1,
      governance: DB.envelope ? { allowed: { currencies: DB.envelope } } : { allowed: {} }, capabilities: [] }] };
  }
  if (/FROM identities WHERE LOWER\(user_id\)/.test(sql)) return { rows: DB.taken.has(p[0]) ? [{ '?column?': 1 }] : [] };
  if (/SELECT user_id FROM identities WHERE identity_id/.test(sql)) return { rows: [{ user_id: DB.user_id }] };
  if (/^\s*UPDATE identities SET display_name/.test(sql)) { DB.wrote = p[4]; return { rows: [] }; }
  if (/INSERT INTO identities/.test(sql)) { DB.inserted = p[4]; return { rows: [] }; }
  return { rows: [] };
} } };

const express = require('express');
const app = express();
app.use(express.json());
/* stub auth so PATCH /profile is reachable */
/* ⚠️ WHO IS CALLING IS NOW A VARIABLE, and it had to become one. The stub said identity_type:'entity'
   permanently, so every entity-only gate in this route was tested from the ONE side that passes. Both
   USER_ID_ENTITY_ONLY and CURRENCY_ENTITY_ONLY refuse ACTORS — the branch that matters was unreachable. */
let AS = 'entity';
require.cache[require.resolve(API + '/middleware/auth')] = { exports: (req,res,next)=>{ req.identity={identity_id:'11111111-1111-1111-1111-111111111111',identity_type:AS}; next(); } };
app.use('/api/entities', require(API + '/routes/entities'));

const post = (p, body) => new Promise((ok) => {
  const req = require('http').request({ host:'127.0.0.1', port: PORT, path:p, method:'POST', headers:{'Content-Type':'application/json'} }, (r)=>{
    let d=''; r.on('data',c=>d+=c); r.on('end',()=>ok({ status:r.statusCode, body:(()=>{try{return JSON.parse(d)}catch(_){return {}}})() }));
  }); req.end(JSON.stringify(body));
});
const patch = (p, body) => new Promise((ok) => {
  const req = require('http').request({ host:'127.0.0.1', port: PORT, path:p, method:'PATCH', headers:{'Content-Type':'application/json'} }, (r)=>{
    let d=''; r.on('data',c=>d+=c); r.on('end',()=>ok({ status:r.statusCode, body:(()=>{try{return JSON.parse(d)}catch(_){return {}}})() }));
  }); req.end(JSON.stringify(body));
});

let PORT, pass=0, fail=0;
const t = (label, got, want) => { const ok = got===want; ok?pass++:fail++;
  console.log('  ' + (ok?'✓':'✗') + ' ' + label.padEnd(56) + got + (ok?'':'   EXPECTED ' + want)); };

const srv = app.listen(0, async () => {
  PORT = srv.address().port;
  console.log('\n── REGISTRATION — the entity chooses it, once ──\n');
  t('a dot is refused (that space belongs to the network)',
    (await post('/api/entities/register',{email:'a@b.com',display_name:'Acme Traders',user_id:'acme.clothing'})).status, 400);
  t('an @ is refused (that space belongs to employees)',
    (await post('/api/entities/register',{email:'a@b.com',display_name:'Acme Traders',user_id:'ravi@acme'})).status, 400);
  t('under 8 characters is refused',
    (await post('/api/entities/register',{email:'a@b.com',display_name:'Acme Traders',user_id:'mytest'})).status, 400);
  t('a taken User ID is refused with 409, not a 500 from the index',
    (await post('/api/entities/register',{email:'a@b.com',display_name:'Acme Traders',user_id:'acmetraders'})).status, 409);
  const good = await post('/api/entities/register',{email:'new@b.com',display_name:'My Pharmacy Ltd',user_id:'MyPharmaLtd'});
  t('a good one registers', good.status, 200);
  t('  …stored lowercase (the unique index is on lower())', DB.inserted, 'mypharmaltd');

  console.log('\n── AFTERWARDS — it cannot be changed ──\n');
  DB.user_id = 'mypharma';
  const chg = await patch('/api/entities/profile',{ user_id:'somethingelse' });
  t('changing an existing User ID is refused', chg.status, 409);
  t('  …and says so by code', chg.body.code, 'USER_ID_IMMUTABLE');
  t('re-sending the SAME value is not an error (an unchanged save)',
    (await patch('/api/entities/profile',{ user_id:'mypharma' })).status, 200);
  DB.wrote = undefined;
  t('the display name is free to change', (await patch('/api/entities/profile',{ display_name:'Anything At All ™' })).status, 200);

  console.log('\n── THE REPAIR PATH — an entity registered before the rule ──\n');
  DB.user_id = null; DB.wrote = undefined;
  t('a NULL User ID can still be set once', (await patch('/api/entities/profile',{ user_id:'mypharmacy' })).status, 200);
  t('  …and it is what got written', DB.wrote, 'mypharmacy');
  DB.user_id = null;
  t('but still only a legal one', (await patch('/api/entities/profile',{ user_id:'ab.cd' })).status, 400);

  /* ── the CUSTOMER handle — IAM-SPEC §23 ───────────────────────────────────────────────────────────────── */
  console.log('\n── THE CUSTOMER HANDLE — readable, with a fallback that is load-bearing ──\n');
  const fs = require('fs');
  const csrc = fs.readFileSync(API + '/routes/catalogue.js', 'utf8');
  const ca = csrc.indexOf('function crHandle');
  const crHandle = new Function(csrc.slice(ca, csrc.indexOf('\n}', ca) + 2) + '; return crHandle;')();

  t('phone + user_id  -> readable',
    crHandle('phone', '9876512345', { user_id: 'alpha-timers', bridge_id: 'CBZQK5DAH9' }),
    '9876512345@alpha-timers.cr');
  t('email: @ becomes = so two providers stay two people',
    crHandle('email', 'r.kumar@gmail.com', { user_id: 'alpha-timers', bridge_id: 'CBZQK5DAH9' }),
    'r.kumar=gmail.com@alpha-timers.cr');

  /**
   * ⚠️⚠️ THE CASE THAT WOULD HAVE BROKEN A LIVE SHOP. Alpha Paints has NO user_id — it predates b170 and it
   * serves customers today. Without the fallback its storefront would build "…@null.cr", and every returning
   * customer would fail to match and be recreated as a NEW identity with no order history. Silently.
   */
  t('no user_id (a pre-b170 shop) STAYS on the bridge form',
    crHandle('phone', '9876512345', { user_id: null, bridge_id: 'CB6C7UQHUB' }),
    '9876512345@CB6C7UQHUB.cr');
  /* ⚠️ `t` here compares with ===, unlike the one in iam-access.test.cjs which stringifies. Passing the STRING
     'false' against a boolean false failed while printing "false EXPECTED false", which is the most confusing
     possible way for a test to be wrong. Two helpers with one name and different semantics. */
  t('  …and never renders the string "null"',
    /null/.test(crHandle('phone', '9', { user_id: null, bridge_id: 'CB6C7UQHUB' })), false);


  /* ══ WHAT AN EMPLOYEE MAY NOT SET ══════════════════════════════════════════════════════════
   * ⚠⚠ BOTH OF THESE WRITE THE CALLER'S OWN ROW, WHICH IS WHY THEY ARE DANGEROUS RATHER THAN MERELY WRONG.
   * PATCH /profile updates req.identity.identity_id. For an actor that is the ACTOR's record — so the value
   * lands somewhere nothing reads, the screen says saved, and the business is unchanged. Silent success is a
   * worse outcome than an error, and neither gate had a test until now.
   *
   * ⭐ Athi's rule, 2026-08-20: *"the access the employee cannot change — it should be done by entity."* */
  AS = 'actor';
  t('an employee cannot claim a User ID',
    (await patch('/api/entities/profile',{ user_id:'clerkstolen' })).status, 403);
  t('an employee cannot set the business currency',
    (await patch('/api/entities/profile',{ currency_code:'SGD' })).status, 403);
  t('  …and the refusal names the rule, not "invalid"',
    (await patch('/api/entities/profile',{ currency_code:'SGD' })).body.code, 'CURRENCY_ENTITY_ONLY');
  /* ⚠️ AN EMPLOYEE IS NOT LOCKED OUT OF THE WHOLE ROUTE — the gate is per FIELD. If this ever returns 403
     the refusal has widened past what Athi asked for: phone and email are his to change. */
  t('  …but the route itself is still open to them',
    (await patch('/api/entities/profile',{ display_name:'Ravi K' })).status, 200);
  AS = 'entity';
  /* ══ THE ENVELOPE, BOTH WAYS ═══════════════════════════════════════════════════════════════
   * ⚠️ THE MECHANISM STAYS — b179 lifts the cap off 'base', it does not delete the ability to restrict. A
   * vertical or jurisdiction that genuinely trades in one currency must still be able to say so, and the
   * refusal must still name the permitted set rather than answering 'invalid'. */
  DB.envelope = ['INR','USD','MXN','EUR'];              // the world before b179
  t('a restricting constitution still refuses what it excludes',
    (await patch('/api/entities/profile',{ currency_code:'CNY' })).status, 422);
  t('  …and names the permitted set so the answer is actionable',
    (await patch('/api/entities/profile',{ currency_code:'CNY' })).body.allowed.join(','), 'INR,USD,MXN,EUR');
  t('  …while a permitted one goes through',
    (await patch('/api/entities/profile',{ currency_code:'USD' })).status, 200);

  DB.envelope = null;                                    // the world after b179: base restricts nothing
  t('with the cap lifted, Singapore dollars are accepted',
    (await patch('/api/entities/profile',{ currency_code:'SGD' })).status, 200);
  t('  …and so is the yuan',
    (await patch('/api/entities/profile',{ currency_code:'CNY' })).status, 200);

  console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
