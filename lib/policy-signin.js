'use strict';
/**
 * CARD 18-identity-sign-in-and-access/provider-sign-in
 * policy-signin.js — the three SIGN-IN rules of the entity's policy (SEC-112, 17 Nov 2026), split out of lib/policy.js so that file does not grow (rule: split, don't raise).
 *
 * OWNS      the FLAGS rows signin_providers · signin_required · signin_required_org, their CARD rows, and coerceText (a short text flag)
 * CALLED BY lib/policy.js (spread into FLAGS and CARD; coerce() calls coerceText)
 * FLOW      data/signin-providers.json (the one registry) ──▶ the flags' options ──▶ lib/policy.js FLAGS/CARD ──▶ the one PATCH /api/entities/policy
 */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const SIGNIN_PROVIDER_KEYS = require('../data/signin-providers.json').providers.map((item) => item.key);
/** FW-41: each provider's own word from the registry (key -> label), so a row never prints "google,microsoft" */
const PROVIDER_WORDS = Object.fromEntries(require('../data/signin-providers.json').providers.map((item) => [item.key, item.label || item.key]));
/** who may change a sign-in rule is the OWNER (data on the flag, read by refusalFor) */
const SIGNIN_OWNER = { may: 'owner', may_why: 'Only the owner may change how people sign in.' };

/** PROVIDER SIGN-IN, the entity's three keys (P0-DESIGN §3). The options are DERIVED from data/signin-providers.json (a new provider is one registry row, not a code change here).
 *  signin_providers — which providers this business accepts for its people (tighten-only: the installation's SIGNIN_PROVIDERS list is the outer bound). signin_required — staff MUST use this one (P2; 'none' = codes and PINs as today).
 *  signin_required_org — the Microsoft tenant id or Google Workspace domain, ONLY ever written from the owner's own provider token (never typed), validated WITH signin_required (P2). Owner's alone, after re-proof (routes/signin-provider.js).
 *  Stored in policy_flags: NO MIGRATION. Written by the one PATCH /api/entities/policy. */
const FLAGS = {
  signin_providers: { type: 'set', options: SIGNIN_PROVIDER_KEYS, max: 8, def: SIGNIN_PROVIDER_KEYS, ...SIGNIN_OWNER },
  signin_required: { type: 'enum', options: ['none'].concat(SIGNIN_PROVIDER_KEYS), def: 'none', ...SIGNIN_OWNER },
  signin_required_org: { type: 'text', max: 255, def: '', ...SIGNIN_OWNER }
};

const CARD = {
  signin_providers: {
    label: 'Sign in with',
    level: 'entity',
    gov: 'chosen',
    labels: PROVIDER_WORDS,
    help: 'Which outside accounts your people may use to sign in, besides their code or PIN. Taking one off stops it for everyone here.'
  },
  signin_required: {
    label: 'Everyone must sign in with',
    level: 'entity',
    gov: 'chosen',
    labels: { none: 'Code or PIN (as now)', ...PROVIDER_WORDS },
    help: 'Make your staff sign in with one outside account. You keep a way in of your own. The owner sets it, after proving it is them.'
  },
  signin_required_org: {
    label: 'Your organisation',
    level: 'entity',
    gov: 'chosen',
    help: 'The company the required sign-in must belong to. It is read from your own sign-in, never typed.'
  }
};

/** a short text (signin_required_org): a string only (never a list or an object), control characters out, trimmed, within its max; empty is a legitimate value (the default) */
function coerceText(flag, list) {
  return typeof list === 'string' ? list.replace(CONTROL_CHARS, '').trim().slice(0, flag.max || 255) : undefined;
}

module.exports = { FLAGS, CARD, coerceText };
