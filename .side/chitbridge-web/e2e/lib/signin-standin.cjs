/* signin-standin.cjs — THE PRACTICE CHITBRIDGE FOR THE SIGN-IN LAB: a real HTTP server answering /api/signin/{ask,verify,pin} as
 * routes/signin.js does, for practice people whose FIELDS drive the real rules (nothing here is a real account).
 *
 * T2-LABS (2026-10-14): this lived INSIDE public/signin-lab.html, which replaced window.fetch to answer the window's calls in the
 * page — a fake server shipped to every visitor. Athi: "our labs should not use a separate piece of code". The page now talks to
 * a real api (?api=, else the deploy's) through the window's own transport; this harness is what it talks to in the walk, or on
 * a laptop:   node e2e/lib/signin-standin.cjs   → prints the URL to open (public/ served beside it).
 * The answers are the page's old stand-in, moved as they were (same people, same sentences, same token claims).
 *
 *   start() → { url, port, close(), calls, live() }
 *     POST /api/signin/ask · /verify · /pin    the sign-in door (CORS open: the lab is served from another port)
 *     GET  /__practice?who=&stage=             practice only: resets that person to that stage, answers the people (labels)
 *                                              and the chosen person's practice fields (typed ids, code / PIN, level, costs, hat)
 */
'use strict';
const TD = require('./today.cjs');   /* QW1-TODAY: the one injected today (CB_TODAY) — never the runner's clock */
const http = require('http');

const SHOP = { id: 'ent-mayur', name: 'Mayur Bhavan', bridge: 'CB-MAYUR', userid: 'mayuri123' };
const PEOPLE = {
  owner:      { label: 'Owner', name: 'Mayur Bhavan', id: 'mayuri123', kind: 'entity', mobile: '9876543210', email: 'athi@mayur.test', userid: 'mayuri123',
                code: '123456', access_level: 'editor', can_see_costs: true, hat: 'own' },
  employee:   { label: 'Employee (.br)', name: 'Bala', id: 'bala@mayuri123.br', kind: 'actor', mobile: '9000000001', email: 'bala@mail.test', userid: 'bala@mayuri123.br',
                code: '123456', pin: '4826', access_level: 'editor', can_see_costs: false, hat: 'act' },
  customer:   { label: 'Customer (.cr)', name: 'Kavi', id: 'kavi=mail.test@mayuri123.cr', kind: 'customer', mobile: '9111111111', email: 'kavi@mail.test', userid: null,
                code: '123123' },
  brand:      { label: 'Network store', name: 'Athi · Chennai', id: 'athi.chennai', kind: 'entity', mobile: null, email: null, userid: 'athi.chennai',
                code: '123456', operator: true, access_level: 'editor', can_see_costs: true, hat: 'own' },
  auditor:    { label: 'Auditor', name: 'Meera', id: 'meera@mayuri123.br', kind: 'actor', mobile: '9222222222', email: 'meera@audit.test', userid: 'meera@mayuri123.br',
                code: '123456', pin: '1357', access_level: 'commenter', can_see_costs: true, hat: 'audit' },
  accountant: { label: 'Accountant', name: 'Suresh', id: 'suresh@mayuri123.br', kind: 'actor', mobile: '9333333333', email: 'suresh@ca.test', userid: 'suresh@mayuri123.br',
                code: '123456', pin: '2468', access_level: 'viewer', can_see_costs: true, hat: 'mis' },
  shared:     { label: 'Shared contact', name: 'Athi', id: 'athi@alpha-timers.br', kind: 'actor', mobile: '9876543210', email: 'athi@mayur.test', userid: 'athi@alpha-timers.br',
                code: '123456', pin: '2580', access_level: 'editor', can_see_costs: false, hat: 'act', shop: { id: 'ent-alpha', name: 'Alpha Timers', bridge: 'CB-ALPHA' } },
};

function start(port) {
  const calls = [];
  let LIVE = null, scenario = { who: 'owner', stage: 'first' };
  function reset(who, stage) {
    scenario = { who: PEOPLE[who] ? who : 'owner', stage: stage || 'first' };
    LIVE = JSON.parse(JSON.stringify(PEOPLE));
    if (scenario.who !== 'shared') delete LIVE.shared;      /* the second person on the owner's contacts exists only in that scenario */
    const p = LIVE[scenario.who];
    if (scenario.stage === 'first') { if (p.kind === 'actor') p.pin = null; }
    if (p.kind === 'actor' && scenario.stage !== 'first' && !p.pin) p.pin = '4826';
    p.locked = scenario.stage === 'locked'; p.removed = scenario.stage === 'removed';
    LIVE.alphaOwner = { name: 'Alpha Timers', id: 'alpha-timers', kind: 'entity', code: '123456' };
  }
  reset('owner', 'first');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  function tokenOf(p, device, surface) {
    const now = Math.floor(TD.nowMs() / 1000), life = device ? (surface === 'till' ? 30 : 7) * 86400 : 7 * 86400;
    const c = { identity_id: 'id-' + p.id, identity_type: p.kind, display_name: p.name, bridge_id: p.kind === 'entity' ? (p.shop || SHOP).bridge : 'CB-' + p.name.toUpperCase(), iat: now, exp: now + life };
    if (p.kind !== 'entity') { c.parent_entity_id = (p.shop || SHOP).id; c.parent_entity_name = (p.shop || SHOP).name; c.parent_bridge_id = (p.shop || SHOP).bridge; }
    if (device) { c.kind = 'person'; c.jti = 'j-' + Math.random().toString(36).slice(2, 8); c.device_id = device; c.surface = surface; }
    return b64({ alg: 'none', typ: 'JWT' }) + '.' + b64(c) + '.practice';
  }
  function whoIs(id) {
    id = String(id || '').trim().toLowerCase();
    const all = Object.keys(LIVE).map((k) => LIVE[k]);
    const exact = all.filter((p) => String(p.id).toLowerCase() === id);
    if (exact.length) return exact;
    return all.filter((p) => [p.mobile, p.email, p.userid].filter(Boolean).some((c) => String(c).toLowerCase() === id));
  }
  const choicesOf = (ps) => ps.map((p) => ({ id: p.id, kind: p.kind === 'actor' ? 'employee' : p.kind === 'customer' ? 'customer' : 'owner', name: p.name, shop: p.kind === 'entity' ? p.name : (p.shop || SHOP).name }));
  function answer(path, body, headers) {
    const id = body.id || body.email || body.user_id, ps = whoIs(id), p = ps[0];
    const J = (status, b) => ({ status, body: b });
    /* the ONE refusal the real api gives for an unknown account, a wrong PIN, a bad code and a locked account (lib/otp.js SIGNIN_REFUSED_SENTENCE, routes/signin.js SIGNIN_REFUSED, SEC-81) */
    const SIGNIN_REFUSED_SENTENCE = "That sign-in didn't work. Check the details and try again.";
    const refused = () => J(400, { error: 'Sign-in failed', code: 'SIGNIN_REFUSED', message: SIGNIN_REFUSED_SENTENCE });
    if (path === '/api/signin/ask') {
      /* an unknown id gets the same 200 as a known one, and no code (routes/signin.js ASK_ANSWER) */
      /* SEC-143 (api routes/signin.js ASK_ANSWER): ONE answer for everyone; the account choice (409) comes only after a correct secret, on verify */
      if (ps.length === 1 && !(p.kind === 'actor' && p.pin)) { p.issued = p.code; p.sent = (p.sent || 0) + 1; }
      if (ps.length > 1) ps.forEach((x) => { if (!(x.kind === 'actor' && x.pin)) x.issued = x.code; });
      return J(200, { message: 'If that sign-in exists, enter your PIN or the code we sent.', need: 'pin_or_code' });
    }
    if (path === '/api/signin/verify') {
      if (ps.length > 1 && ps.some((x) => (x.kind === 'actor' && x.pin ? body.pin === x.pin : !!x.issued && body.otp === x.issued))) return J(409, { error: 'Which account?', code: 'CHOOSE_IDENTITY', message: 'That contact is on more than one account. Choose one.', choices: choicesOf(ps) });
      if (!p || p.locked) return refused();
      if (p.kind === 'actor' && p.pin) { if (body.pin !== p.pin) return refused(); p.method = 'pin'; }
      else { if (!p.issued || body.otp !== p.issued) return refused(); p.issued = null; p.method = 'code'; }
      if (p.removed) return J(403, { error: 'Forbidden', code: 'DEVICE_REVOKED', message: 'The shop removed this device. Ask the owner.' });
      const device = headers['x-device-id'] || null;
      const tok = tokenOf(p, device, body.surface); p.token = tok; p.device = device;
      return J(200, Object.assign({ message: 'Verified successfully', token: tok,
        identity: { identity_id: 'id-' + p.id, bridge_id: 'CB', display_name: p.name, user_id: p.kind === 'customer' ? null : p.id, email: p.kind === 'customer' ? p.id : p.email, identity_type: p.kind, entity_id: (p.shop || SHOP).id } },
        p.kind === 'actor' && !p.pin ? { requires_pin_setup: true } : {}));
    }
    if (path === '/api/signin/pin') {
      const owner = Object.keys(LIVE).map((k) => LIVE[k]).filter((x) => x.token && ('Bearer ' + x.token) === headers.authorization)[0];
      if (!owner) return J(401, { error: 'Unauthorized' });
      owner.pin = body.pin; return J(200, { message: 'PIN set successfully — use PIN for future logins' });
    }
    return null;
  }
  /** the practice person as the lab shows them — what to type, the code or PIN, and what the shop's records say (level · costs · hat) */
  function practice() {
    const p = LIVE[scenario.who];
    return { who: scenario.who, stage: scenario.stage, people: Object.keys(PEOPLE).map((k) => ({ key: k, label: PEOPLE[k].label })),
      person: { label: p.label, name: p.name, id: p.id, kind: p.kind, mobile: p.mobile, email: p.email, userid: p.userid, operator: !!p.operator,
        cred: (p.kind === 'actor' && p.pin) ? { pin: p.pin } : { code: p.code }, access_level: p.access_level || null, can_see_costs: !!p.can_see_costs, hat: p.hat || null } };
  }
  const srv = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const j = (s, o) => { r.writeHead(s, Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const u = new URL(q.url, 'http://x');
    if (q.method === 'GET' && u.pathname === '/__practice') { reset(u.searchParams.get('who'), u.searchParams.get('stage')); return j(200, practice()); }
    let b = {}; try { b = raw ? JSON.parse(raw) : {}; } catch (e) { return j(400, { error: 'Bad request', message: 'That was not JSON.' }); }
    const a = q.method === 'POST' ? answer(u.pathname, b, q.headers) : null;
    if (!a) return j(404, { error: 'Not found', message: 'The practice server answers the sign-in door only.' });
    calls.push({ path: u.pathname, body: b, status: a.status });
    return j(a.status, a.body);
  });
  return new Promise((res) => srv.listen(port || 0, '127.0.0.1', () => res({ srv, port: srv.address().port, url: 'http://127.0.0.1:' + srv.address().port,
    calls, live: () => LIVE, close: () => new Promise((d) => srv.close(d)) })));
}
module.exports = { start, PEOPLE };

if (require.main === module) {
  (async () => {
    const api = await start(Number(process.env.PORT) || 0);
    const web = await require('./serve.cjs').serve();
    console.log('practice ChitBridge: ' + api.url + '\nopen: ' + web.url('/signin-lab.html?api=' + encodeURIComponent(api.url)));
  })();
}
