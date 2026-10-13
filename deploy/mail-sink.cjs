#!/usr/bin/env node
/**
 * deploy/mail-sink.cjs — a STAND-IN FOR RESEND, for the compose proof only (HX0; compose profile `proof`, never the default stack).
 * A sealed api (NODE_ENV=production) sends every sign-in code by e-mail (lib/dev-otp.js otpPostureErrors) — so a production stack can
 * only be walked if the walk can read the mail. The api's Resend SDK posts to RESEND_BASE_URL (+ /emails); this answers like Resend
 * and keeps the last message per address in memory. Plain Node, no dependency.
 *   POST /emails            { from, to, subject, html }  → { id }      (what the SDK sends)
 *   GET  /last?to=<email>   → { to, subject, code }                    (the code = the first 4–8 digit run in the mail; 404 if none)
 */
'use strict';
const http = require('http');
const last = new Map();
let n = 0;
http.createServer((q, r) => {
  const u = new URL(q.url, 'http://sink');
  const send = (s, b) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(b)); };
  if (q.method === 'POST' && u.pathname === '/emails') {
    let body = '';
    q.on('data', (c) => { body += c; if (body.length > 1e6) q.destroy(); });
    q.on('end', () => {
      let m; try { m = JSON.parse(body); } catch (_) { return send(400, { message: 'not json' }); }
      const text = String(m.html || m.text || '').replace(/<[^>]+>/g, ' ');
      const code = (/\b(\d{4,8})\b/.exec(text) || [])[1] || null;
      [].concat(m.to || []).forEach((to) => last.set(String(to).toLowerCase(), { to, subject: m.subject || '', code }));
      console.log('mail-sink: ' + [].concat(m.to || []).join(',') + ' · ' + (m.subject || ''));
      send(200, { id: 'sink-' + (++n) });
    });
    return;
  }
  if (q.method === 'GET' && u.pathname === '/last') {
    const m = last.get(String(u.searchParams.get('to') || '').toLowerCase());
    return m ? send(200, m) : send(404, { message: 'no mail for that address' });
  }
  send(404, { message: 'not found' });
}).listen(Number(process.env.PORT || 8025), '0.0.0.0', () => console.log('mail-sink listening on ' + (process.env.PORT || 8025)));
