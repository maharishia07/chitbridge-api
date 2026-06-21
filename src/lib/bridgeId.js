// Bridge ID: CB-XXXX-XXXX-XXXX, Crockford base32 (no I L O U) + mod-32 check char.
const ALPH = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const rc = () => ALPH[Math.floor(Math.random() * ALPH.length)];
function mint() {
  let data = "";
  for (let i = 0; i < 11; i++) data += rc();
  let sum = 0; for (const ch of data) sum += ALPH.indexOf(ch);
  const raw = data + ALPH[sum % 32];            // 12 chars
  return "CB-" + raw.slice(0,4) + "-" + raw.slice(4,8) + "-" + raw.slice(8,12);
}
function isValid(id) {
  if (typeof id !== "string") return false;
  const raw = id.toUpperCase().replace(/^CB-/, "").replace(/-/g, "");
  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(raw)) return false;
  let sum = 0; for (const ch of raw.slice(0,11)) sum += ALPH.indexOf(ch);
  return ALPH[sum % 32] === raw[11];
}
// ltree root label from a bridge id (dashes -> underscores; all chars are ltree-legal)
const toLabel = (bridgeId) => bridgeId.toUpperCase().replace(/-/g, "_");
module.exports = { mint, isValid, toLabel };
