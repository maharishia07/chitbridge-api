// lib/bridgeid.js — THE bridge id. One generator, used everywhere one is minted.
//
// ── ⚠️ WHY THIS FILE EXISTS: A DUPLICATE ATE A SECURITY FIX ─────────────────────────────────────────────────────
// This generator had SIX independent copies — `generateBridgeId` in routes/actors.js, routes/connectors.js and
// routes/entities.js, and `genBridge` in routes/catalogue.js, routes/governance.js and lib/source.js. Same nine
// lines, two names, six files.
//
// Someone then hardened ONE of them, with a comment saying exactly why: *"S4 — CSPRNG (bridge ids are public, but
// no reason to use a weak PRNG)"*. The other five kept `Math.random()` — including routes/entities.js, which is
// where EVERY entity's bridge id is minted. The fix was real, correct, and reached one sixth of the code it was
// written for, and nothing anywhere reported that.
//
// That is the whole argument for this file, and it is not a style argument: a duplicate does not just cost effort,
// it silently absorbs the fixes aimed at it.
//
// ── ⚠️ CSPRNG, ALWAYS ───────────────────────────────────────────────────────────────────────────────────────────
// A bridge id is public — it goes on chits and in URLs — so this is not a secret. But it IS a namespace people
// look each other up by, and `Math.random()` is predictable enough to enumerate. There is no reason to use a weak
// PRNG here, which is precisely what the S4 comment said before it was left behind.
//
// The alphabet omits I, O, 0 and 1: these are read aloud and typed off a screen, and a bridge id nobody can
// dictate over a phone is a bridge id that gets entered wrong.
const { randomInt } = require('crypto');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A new bridge id: `CB` + 8 characters from the unambiguous alphabet. */
function generateBridgeId() {
  let id = 'CB';
  for (let i = 0; i < 8; i++) id += CHARS[randomInt(0, CHARS.length)];
  return id;
}

module.exports = { generateBridgeId, CHARS };
