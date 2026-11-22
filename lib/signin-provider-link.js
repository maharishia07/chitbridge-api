// OWNER     cb-security
// RISK      security
// OWNS      the link between a signed-in account and a provider identity (public.signin_provider_link, b878): list · add · remove, each under withEntity(shop) so row security scopes it
// FLOW      routes/signin-provider-connect.js (re-proof done) ──▶ add(shop, identity, claims) / remove(shop, identity, linkId) / listOf(shop, identity) ──▶ signin_provider_link ──▶ a result word, never an exception for a clash
// CALLED BY routes/signin-provider-connect.js · routes/signin-provider.js (the callback, intent link) · tests/signin-provider.test.cjs
// CARD      18-identity-sign-in-and-access/sign-in
'use strict';
/**
 * lib/signin-provider-link.js — SEC-112 P1a connect step (critic 21 Nov, design routes 6, 7, 10-12).
 * ⭐ THE KEY IS (provider, issuer, tenant, subject) TAKEN FROM THE CHECKED TOKEN, never from the browser; the e-mail is kept for display only (email_verified beside it).
 * ⭐ ONE WRITER of the link table. An insert clash (one provider per account, or the same subject twice) answers LINK_EXISTS and never an exception.
 * ⭐ NO NEW KIND OF ACCESS CONTROL: who may link is the signed-in person with a fresh proof (the route); the shop's own switch is the existing GOV flag signin_providers (policy-signin.js).
 */
const { withEntity } = require('../db');
const store = require('./signin-provider-store');

const SHOWN = 'link_id, provider, email, email_verified, display_name, linked_at, last_used_at';

/** listOf(shop, identityId) → this person's links (never the subject or issuer) */
async function listOf(shop, identityId) {
  return withEntity(shop, async (db) => (await db.query('SELECT ' + SHOWN + ' FROM public.signin_provider_link WHERE entity_id = $1 AND identity_id = $2 ORDER BY linked_at', [shop, identityId])).rows);
}

/**
 * addLink(shop, identityId, claims) (exported as add) → { added: true, link_id } or { added: false, code: 'LINK_EXISTS' }. The same subject already linked to ANOTHER account of this shop is refused too (SSO_MANY would follow);
 * the same subject on another shop is allowed and is never said (the unique key holds identity_id, and the check below keeps only this shop's rows).
 */
async function addLink(shop, identityId, claims) {
  const elsewhere = (await store.linksFor(claims)).filter((link) => String(link.entity_id) === String(shop));
  if (elsewhere.length) return { added: false, code: 'LINK_EXISTS' };
  return withEntity(shop, async (db) => {
    const done = await db.query(
      `INSERT INTO public.signin_provider_link (entity_id, identity_id, provider, issuer, tenant, subject, subject_alt, org, email, email_verified, display_name, linked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $2)
       ON CONFLICT DO NOTHING RETURNING link_id`,
      [shop, identityId, claims.provider, claims.issuer, claims.tenant || '', claims.subject, claims.subject_alt || null, claims.org || null, claims.email ? String(claims.email).slice(0, 320) : null, claims.email_verified === true, claims.name ? String(claims.name).slice(0, 200) : null]
    );
    return done.rows[0] ? { added: true, link_id: done.rows[0].link_id } : { added: false, code: 'LINK_EXISTS' };
  });
}

/** remove(shop, identityId, linkId) → { removed: true, link } or { removed: false } (a foreign or unknown id is the same answer); the deleted row's key comes back so the audit row can carry the keyed subject hash */
async function remove(shop, identityId, linkId) {
  return withEntity(shop, async (db) => {
    const done = await db.query('DELETE FROM public.signin_provider_link WHERE link_id = $1 AND entity_id = $2 AND identity_id = $3 RETURNING link_id, provider, issuer, tenant, subject', [linkId, shop, identityId]);
    return done.rows[0] ? { removed: true, link: done.rows[0] } : { removed: false };
  });
}

module.exports = { listOf, add: addLink, remove };
