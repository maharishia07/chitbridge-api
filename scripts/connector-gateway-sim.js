#!/usr/bin/env node
/* connector-gateway-sim.js — a stand-in IoT / ERP GATEWAY (the "edge box", e.g. a Raspberry Pi).
 *
 * It plays the role the Pi plays in real life: it HOLDS the credential + the counterparty bridge/entity,
 * READS a device signal, and EMITS it as a co-held CHIT over the governed rail (POST /api/chits/send).
 * The signal lands in the counterparty's Task inbox as a sealed, co-held record. This is the adapter seam
 * made concrete — swap readSignal() for a real MQTT/Modbus/GPIO read and the API call is unchanged.
 *
 * AUTH: PREFERRED = device-key ingest — the CB-issued ActorKey (BRIDGE_KEY) hits POST /api/connectors/ingest,
 * which heartbeats (health goes LIVE in the cockpit) AND emits the chit in one call, using the device's OWN
 * credential (no user session). FALLBACK (no key) = a session TOKEN + POST /api/chits/send (kept for demos).
 * Zero dependencies (Node's https) so it runs on a bare Raspberry Pi.
 *
 * Usage:
 *   # PREFERRED — device-key ingest (create the connector + a device in the app, copy the ActorKey + BridgeId)
 *   BRIDGE_KEY=<ActorKey>  BRIDGE_ID=<device BridgeId>  DEVICE_ID=pi4-lab-01 \
 *     node scripts/connector-gateway-sim.js
 *
 *   # FALLBACK — a real entity's bearer token (sign in on the web, copy the token)
 *   TOKEN=<bearer>  TO=<counterparty entity_id>  DEVICE_ID=edge-gw-01 SIGNAL=temperature VALUE=42 UNIT=C \
 *     node scripts/connector-gateway-sim.js
 *
 *   # FALLBACK (dev) — mint a token via dev OTP (Railway runs NODE_ENV=development, DEV_OTP=123456)
 *   GATEWAY_EMAIL=gw01@connector.iot  TO=<counterparty entity_id>  node scripts/connector-gateway-sim.js
 */
const https = require('https');
const fs = require('fs');
const { URL } = require('url');

const API_BASE = process.env.API_BASE || 'https://chitbridge-api-production.up.railway.app';
const cfg = {
  key:    process.env.BRIDGE_KEY || '',      // PREFERRED: the CB-issued ActorKey -> device-key ingest (no user token)
  bridge: process.env.BRIDGE_ID || '',       // the device BridgeId under the connector (for ingest routing/health)
  token:  process.env.TOKEN || '',
  email:  process.env.GATEWAY_EMAIL || '',   // dev-only: mint a token via OTP when no TOKEN / no BRIDGE_KEY
  to:     process.env.TO || '',              // counterparty entity_id — who receives the signal (from the connection if omitted)
  device: process.env.DEVICE_ID || 'edge-gw-01',
  signal: process.env.SIGNAL || 'temperature',
  sub:    process.env.SUB_TYPE || '',        // the class this exception is (e.g. 'tanker') — group / count by it
  proofFile: process.env.PROOF_FILE || '',   // path to a JPEG the edge captured — attached to the chit as proof
  value:  process.env.VALUE || '42',
  unit:   process.env.UNIT || 'C',
  devOtp: process.env.DEV_OTP || '123456',
};

function req(method, path, body, token, extraHeaders){
  return new Promise((resolve, reject)=>{
    const u = new URL(API_BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const opts = { method, hostname:u.hostname, port:u.port||443, path:u.pathname+u.search,
      headers:{ 'Content-Type':'application/json',
        ...(token?{Authorization:'Bearer '+token}:{}),
        ...(extraHeaders||{}),
        ...(data?{'Content-Length':Buffer.byteLength(data)}:{}) } };
    const r = https.request(opts, res=>{ let b=''; res.on('data',c=>b+=c); res.on('end',()=>{
      let j; try{ j=JSON.parse(b); }catch(_){ j=b; }
      if(res.statusCode>=400) reject(new Error('HTTP '+res.statusCode+' · '+((j&&(j.message||j.error))||b).toString().slice(0,200)));
      else resolve(j); }); });
    r.on('error', reject); if(data) r.write(data); r.end();
  });
}

// --- the DEVICE READ. On a real Pi this auto-reads the on-board CPU temperature (no extra hardware,
//     perfect first sensor). Swap this body for an MQTT subscribe / Modbus poll / GPIO / I2C read for a
//     real sensor — the API call below is unchanged. An explicit VALUE= env always wins (manual override). ---
function readSignal(){
  if(!process.env.VALUE){
    try{
      const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim();
      const c = (parseInt(raw, 10) / 1000);
      if(isFinite(c) && c > 0) return { device_id:cfg.device, signal:'cpu_temperature', value:c.toFixed(1), unit:'C' };
    }catch(_){ /* not a Pi (e.g. laptop) — fall back to the env / default value */ }
  }
  return { device_id:cfg.device, signal:cfg.signal, value:cfg.value, unit:cfg.unit };
}

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
    // PREFERRED PATH — device-key ingest: authenticate with the CB-issued ActorKey (no user token), heartbeat +
    // emit in ONE call. The counterparty comes from the connection (TO optional). This is what a real Pi should use.
    if(cfg.key){
      const s = readSignal();
      var proof, proofName;
      if(cfg.proofFile){ try{ proof = fs.readFileSync(cfg.proofFile).toString('base64'); proofName = cfg.proofFile.split(/[\\/]/).pop(); }catch(e){ console.error('[warn] could not read PROOF_FILE:', e.message); } }
      console.log('[read]', JSON.stringify(s), cfg.sub?('sub_type='+cfg.sub):'', proof?('+proof('+proofName+')'):'');
      const out = await req('POST','/api/connectors/ingest',
        { bridge_id:cfg.bridge||undefined, signal:s.signal, value:s.value, unit:s.unit, device_id:s.device_id,
          sub_type:cfg.sub||undefined, proof:proof||undefined, proof_name:proofName||undefined, to:cfg.to||undefined },
        null, { 'X-Bridge-Key':cfg.key });
      console.log('[ingest] OK — health is now LIVE in the co-assist cockpit; exception filed over the rail.');
      console.log('        chit_id:', out && (out.chit_id||'(none — heartbeat only)'));
      if(out && out.note) console.log('        note:', out.note);
      console.log('        raw:', JSON.stringify(out).slice(0,300));
      return;
    }
    // FALLBACK PATH — session-token + /chits/send (M2M device keys weren't available; kept for demos without a key).
    if(!cfg.to) throw new Error('Set BRIDGE_KEY=<ActorKey> (preferred), or TO=<counterparty entity_id> for the token path.');
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
