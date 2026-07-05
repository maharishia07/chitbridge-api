#!/usr/bin/env node
/* connector-gateway-sim.js — a stand-in IoT / ERP GATEWAY (the "edge box", e.g. a Raspberry Pi).
 *
 * It plays the role the Pi plays in real life: it HOLDS the credential + the counterparty bridge/entity,
 * READS a device signal, and EMITS it as a co-held CHIT over the governed rail (POST /api/chits/send).
 * The signal lands in the counterparty's Task inbox as a sealed, co-held record. This is the adapter seam
 * made concrete — swap readSignal() for a real MQTT/Modbus/GPIO read and the API call is unchanged.
 *
 * AUTH (honest): machine-to-machine API keys are still a backlog item, so this authenticates with a session
 * TOKEN. Preferred: paste an existing entity's TOKEN. Dev fallback: mint one via the dev-OTP flow.
 * Zero dependencies (Node's https) so it runs on a bare Raspberry Pi.
 *
 * Usage:
 *   # preferred — use a real entity's bearer token (sign in on the web, copy the token)
 *   TOKEN=<bearer>  TO=<counterparty entity_id>  DEVICE_ID=edge-gw-01 SIGNAL=temperature VALUE=42 UNIT=C \
 *     node scripts/connector-gateway-sim.js
 *
 *   # dev fallback — mint a token via dev OTP (Railway runs NODE_ENV=development, DEV_OTP=123456)
 *   GATEWAY_EMAIL=gw01@connector.iot  TO=<counterparty entity_id>  node scripts/connector-gateway-sim.js
 */
const https = require('https');
const { URL } = require('url');

const API_BASE = process.env.API_BASE || 'https://chitbridge-api-production.up.railway.app';
const cfg = {
  token:  process.env.TOKEN || '',
  email:  process.env.GATEWAY_EMAIL || '',   // dev-only: mint a token via OTP when no TOKEN
  to:     process.env.TO || '',              // counterparty entity_id (REQUIRED) — who receives the signal
  device: process.env.DEVICE_ID || 'edge-gw-01',
  signal: process.env.SIGNAL || 'temperature',
  value:  process.env.VALUE || '42',
  unit:   process.env.UNIT || 'C',
  devOtp: process.env.DEV_OTP || '123456',
};

function req(method, path, body, token){
  return new Promise((resolve, reject)=>{
    const u = new URL(API_BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const opts = { method, hostname:u.hostname, port:u.port||443, path:u.pathname+u.search,
      headers:{ 'Content-Type':'application/json',
        ...(token?{Authorization:'Bearer '+token}:{}),
        ...(data?{'Content-Length':Buffer.byteLength(data)}:{}) } };
    const r = https.request(opts, res=>{ let b=''; res.on('data',c=>b+=c); res.on('end',()=>{
      let j; try{ j=JSON.parse(b); }catch(_){ j=b; }
      if(res.statusCode>=400) reject(new Error('HTTP '+res.statusCode+' · '+((j&&(j.message||j.error))||b).toString().slice(0,200)));
      else resolve(j); }); });
    r.on('error', reject); if(data) r.write(data); r.end();
  });
}

// --- the DEVICE READ. On a real Pi, replace with an MQTT subscribe / Modbus poll / GPIO read. ---
function readSignal(){ return { device_id:cfg.device, signal:cfg.signal, value:cfg.value, unit:cfg.unit }; }

async function ensureToken(){
  if(cfg.token) return cfg.token;
  if(!cfg.email) throw new Error('Give TOKEN=<bearer>  OR (dev) GATEWAY_EMAIL=<email> to mint one via dev OTP.');
  console.log('[auth] dev-minting a token for', cfg.email);
  await req('POST','/api/entities/register', { email:cfg.email, display_name:'Gateway '+cfg.device }); // issues dev OTP
  const v = await req('POST','/api/entities/verify', { email:cfg.email, otp:cfg.devOtp });
  const tok = v && (v.token || (v.data && v.data.token));
  if(!tok) throw new Error('No token returned by verify — dev mode off, or wrong DEV_OTP.');
  return tok;
}

(async ()=>{
  try{
    if(!cfg.to) throw new Error('Set TO=<counterparty entity_id> — the entity that should receive the signal chit.');
    const token = await ensureToken();
    const s = readSignal();
    console.log('[read]', JSON.stringify(s));
    const body = {
      recipients: [{ entity_id: cfg.to, role:'to' }],
      purpose: 'general',
      manual_subject: 'Signal: ' + s.signal + (s.value ? (' = ' + s.value + s.unit) : ''),
      business_json: { kind:'device_signal', device_id:s.device_id, signal:s.signal, value:s.value, unit:s.unit, at:new Date().toISOString() },
    };
    const out = await req('POST','/api/chits/send', body, token);
    const chitId = out && (out.chit_id || (out.chit && out.chit.chit_id) || (out.data && out.data.chit_id));
    console.log('[emit] OK — a Device Signal chit was delivered to the counterparty Task inbox.');
    console.log('       chit_id:', chitId || '(see raw)');
    console.log('       raw:', JSON.stringify(out).slice(0,300));
  }catch(e){ console.error('[FAIL]', e.message); process.exit(1); }
})();
