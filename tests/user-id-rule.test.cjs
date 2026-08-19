/**
 * The User ID rule, exercised through the REAL route handlers with a stubbed database.
 *
 * ⚠️ Not a unit test of checkRoot — that would pass while the routes ignored it, which is exactly the failure
 * the hat gate had (20/20 green while the gate read the wrong property). This drives express.
 */
const path = require('path');
const API = 'C:/dev/chitbridge-api';
const DB = { user_id: null, taken: new Set(['acmetraders']) };

require.cache[require.resolve(API + '/db')] = { exports: { query: async (sql, p) => {
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
require.cache[require.resolve(API + '/middleware/auth')] = { exports: (req,res,next)=>{ req.identity={identity_id:'11111111-1111-1111-1111-111111111111',identity_type:'entity'}; next(); } };
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

  console.log('\n  ' + pass + ' passed · ' + fail + ' failed\n');
  srv.close(); process.exit(fail ? 1 : 0);
});
