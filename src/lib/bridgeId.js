/*
 * OWNS      minting and checking a Bridge ID, CB-XXXX-XXXX-XXXX in Crockford base32 with a mod-32 check character
 * CALLED BY src/services/network.js
 * FLOW      mint() draws 11 characters and appends the check; the verify helper recomputes it
 * CARD      04-network/connections-and-invitations
 */
// Bridge ID: CB-XXXX-XXXX-XXXX, Crockford base32 (no I L O U) + mod-32 check char.
// CALLED BY src/services/network.js   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
const ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/* P2WAVE-SEC GF-platform-08#L227: an id that names a business and is shown on its card is drawn from the system's CSPRNG, never Math.random (guessable from a few outputs) */
const rc = () => ALPH[require('crypto').randomInt(ALPH.length)];
function mint() {
  let data = '';
  for (let index = 0; index < 11; index++) data += rc();
  let sum = 0;
  for (const ch of data) sum += ALPH.indexOf(ch);
  const raw = data + ALPH[sum % 32]; // 12 chars
  return 'CB-' + raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
}
function isValid(id) {
  if (typeof id !== 'string') return false;
  if (/^[0-9a-fA-F]{32}$/.test(id)) return true; // recon delta: legacy 32-hex MD5 ids stay valid in transition
  const raw = id.toUpperCase().replace(/^CB-/, '').replace(/-/g, '');
  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(raw)) return false;
  let sum = 0;
  for (const ch of raw.slice(0, 11)) sum += ALPH.indexOf(ch);
  return ALPH[sum % 32] === raw[11];
}
// ltree root label from a bridge id (dashes -> underscores; all chars are ltree-legal)
const toLabel = (bridgeId) => bridgeId.toUpperCase().replace(/-/g, '_');
module.exports = { mint, isValid, toLabel };
