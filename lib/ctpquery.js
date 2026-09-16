'use strict';
// @stage poc
// @stage-note CTP's READ verb — a signed question to a peer installation, answered with a public fact. Built
//             2026-09-16 on Athi's decision ("catalogue pull"). Reachable only when an installation is
//             hosted_locally = false, so on every deployment today this file is loaded and never called.
// @stage-why  The deliver verb moves a chit; this asks a question. They are different messages with the same
//             trust model, and putting the question inside a chit envelope would have meant faking a chit.
/**
 * ── ⭐⭐⭐ CTP QUERY — ask a peer installation a question, and prove who is asking ──────────────────────────────
 *
 * Athi, 2026-09-16: *"catalogue pull I guess. currently, within the platform, we are just pulling the catalogue
 * based on the store id, the store is not pushing the catalogue; the same resolves in cross platform also."*
 *
 * So the cross-installation shape is the local shape: **you pull, by store id**. Locally that is
 * `GET /api/catalogue/:bridge_id`, answered with `buildPublicView(asOwner: false)` — what any anonymous visitor
 * sees. Across a boundary it is the same view, over a signed question, so the answering installation knows
 * WHICH peer is asking and can refuse a stranger. Nothing is pushed, nothing is cached here.
 *
 * ── TWO QUESTIONS, and why only two ────────────────────────────────────────────────────────────────────────────
 *
 *     resolve    "who is alpha-timers?"        → bridge_id, display_name, address     closes NS-3
 *     catalogue  "what does CBZQK5DAH9 sell?"  → the PUBLIC storefront view           the pull itself
 *
 * `resolve` exists because a person types a HANDLE and the wire wants a BRIDGE ID, and the handle is a name in
 * the other installation's database — we cannot translate it ourselves. Asked once, at add-supplier time; the
 * bridge id is stored and never asked for again (docs/NAMESPACE.md §5).
 *
 * ── ⚠️⚠️ TRUST: THE SAME AS deliver, NOT LESS ──────────────────────────────────────────────────────────────────
 *
 * A question is signed by the asking installation's key and verified by the answerer against the key on the
 * asker's OWN domain (lib/ctpdirectory) — never one it sent along. The answerer refuses a question from an
 * installation it has not paired with (b257 row), exactly as it refuses a chit. Discovery is open; being
 * answered is not. ⚠️ The population boundary is NOT applied to a read: a public catalogue is public to the whole
 * web already, and b247 bounds who may TRANSACT, not who may look.
 *
 * ⚠️ REPLAY. A signed question is a bearer of "this installation asked this" — so it carries a nonce and a time,
 * and the answerer refuses one older than five minutes. A captured question cannot be re-asked next week.
 *
 * ⚠️ THE ANSWER IS NOT SIGNED. The asker reached the endpoint it resolved for that domain over TLS with
 * `redirect: 'error'`; a signed reply would add a second key ceremony for a public fact. Recorded as open in
 * CTP-DESIGN §9.11 rather than done quietly.
 */

const canon = require('./canon');

const SEALED = ['ctp', 'kind', 'from', 'to', 'ask', 'nonce', 'at'];
const WANTS = ['resolve', 'catalogue'];
const MAX_AGE_MS = 5 * 60 * 1000;

/**
 * build(from, to, ask) → an unsigned question.
 * @param from { installation_key, population, bridge_id? }   who is asking
 * @param to   { installation_key?, domain }                  whom
 * @param ask  { want: 'resolve', handle } | { want: 'catalogue', bridge_id }
 */
function build(from, to, ask) {
  if (!from || !from.installation_key) throw new Error('a question must say which installation is asking');
  if (!to || !(to.domain || to.installation_key)) throw new Error('a question must say whom it is for');
  if (!ask || WANTS.indexOf(ask.want) < 0) throw new Error('a question must want one of: ' + WANTS.join(', '));
  if (ask.want === 'resolve' && !ask.handle) throw new Error('resolve needs a handle to look up');
  if (ask.want === 'catalogue' && !ask.bridge_id) throw new Error('catalogue needs a bridge id to read');
  return {
    ctp: '1', kind: 'query',
    from: { installation_key: from.installation_key, population: from.population || null, bridge_id: from.bridge_id || null },
    to: { installation_key: to.installation_key || null, domain: to.domain ? String(to.domain).toLowerCase() : null },
    ask: ask.want === 'resolve' ? { want: 'resolve', handle: String(ask.handle).trim() }
                                : { want: 'catalogue', bridge_id: String(ask.bridge_id).trim() },
    nonce: require('crypto').randomBytes(12).toString('hex'),
    at: new Date().toISOString(),
  };
}

function digest(q) {
  const subject = {};
  for (const k of SEALED) subject[k] = q[k];
  return canon.hash(JSON.parse(JSON.stringify(subject)));
}

/** the same sealing as a chit envelope — one signer, one canonical form */
function sign(q, signer) {
  const hash = digest(q);
  return Object.assign({}, q, {
    sealed: { alg: (signer && signer.alg) || 'none', hash,
              sig: signer && typeof signer.sign === 'function' ? signer.sign(hash) : null,
              at: new Date().toISOString() },
  });
}

/**
 * open(q, ctx) → { ok, why, ask, from } — the ANSWERER's side.
 * @param ctx { verify(hash, sig, installation_key) -> boolean, now?: () => Date }
 */
function open(q, ctx) {
  const no = (why) => ({ ok: false, why });
  if (!q || q.ctp !== '1' || q.kind !== 'query') return no('not a CTP/1 query');
  if (!q.from || !q.from.installation_key) return no('the question does not say who is asking');
  if (!q.ask || WANTS.indexOf(q.ask.want) < 0) return no('not a question this installation answers');
  if (!q.nonce || !q.at) return no('a question must carry a nonce and a time');
  const now = (ctx && typeof ctx.now === 'function') ? ctx.now() : new Date();
  const age = now.getTime() - Date.parse(q.at);
  if (!Number.isFinite(age)) return no('the question carries an unreadable time');
  if (age > MAX_AGE_MS) return no('the question is ' + Math.round(age / 60000) + ' minutes old — a captured question is not re-asked');
  if (age < -MAX_AGE_MS) return no('the question is dated in the future');
  if (!ctx || typeof ctx.verify !== 'function') return no('this installation cannot verify a signature — refusing');
  const hash = digest(q);
  if (!q.sealed || q.sealed.hash !== hash) return no('the seal does not match the question');
  if (!ctx.verify(hash, q.sealed.sig, q.from.installation_key)) return no('signature did not verify');
  return { ok: true, why: 'accepted', ask: q.ask, from: q.from };
}

/**
 * ── THE ASKER'S SIDE: ask(addressOrDomain, ask) → the answer, or { ok:false, why } ────────────────────────────
 *
 * Resolves the peer through lib/ctpaddress (so an unpaired installation is refused before anything is sent),
 * signs with this installation's key, POSTs to the peer's `/api/ctp/query`, returns the JSON answer.
 * ⚠️ Injected `deps` so it is testable without a network: { resolvePeer, signer, from, fetch }.
 */
async function ask(target, want, deps) {
  const d = deps || {};
  const resolvePeer = d.resolvePeer || (async (t) => {
    const A = require('./ctpaddress');
    /* ⚠️ the address is BUILT by ctpaddress.format, never joined here — a placeholder bridge id is enough to
       resolve the DOMAIN, which is all a question needs; tests/namespace fails any second "@" join */
    const r = await A.resolveAddress(A.format(t.bridge_id || 'CB00000000', t.domain));
    return r.ok && !r.local ? { installation_key: r.installation_key, endpoint: r.endpoint, domain: t.domain } : null;
  });
  const peer = await resolvePeer(target);
  if (!peer || !peer.endpoint) return { ok: false, why: 'no installation we deal with at ' + (target.domain || '?') };
  const from = d.from || await (async () => {
    const keys = require('./ctpkeys');
    return { installation_key: process.env.INSTALLATION_KEY || 'platform-0', population: 'live', can_sign: keys.status().can_sign };
  })();
  const signer = d.signer || require('./ctpkeys').signer();
  const q = sign(build(from, { installation_key: peer.installation_key, domain: peer.domain }, want), signer);
  if (!q.sealed.sig) return { ok: false, why: 'this installation cannot sign — nothing was asked' };
  /* the query door sits beside the deliver door on the same endpoint base */
  const url = String(peer.endpoint).replace(/\/deliver\/?$/, '') + '/query';
  const f = d.fetch || fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                               body: JSON.stringify(q), signal: ctl.signal, redirect: 'error' });
    let body = null; try { body = await res.json(); } catch (_) { body = null; }
    if (!res.ok || !body) return { ok: false, why: (body && body.why) || ('the far installation answered ' + res.status) };
    return Object.assign({ ok: true }, body);
  } catch (e) {
    return { ok: false, why: 'could not reach ' + url + ': ' + (e.name === 'AbortError' ? 'timed out' : e.message) };
  } finally { clearTimeout(t); }
}

module.exports = { build, sign, open, digest, ask, SEALED, WANTS, MAX_AGE_MS };
