/* GENERATED — DO NOT EDIT. Written by chitbridge-api/scripts/vendor-till.cjs. Edit the master and re-run. */
// @stage tested
// @stage-note a byte-for-byte copy of the master, which is the thing the tests cover (scripts/vendor-till.cjs).
(function(){
'use strict';
// @stage tested
// @stage-note [TILL-185] Decoding a scale-printed barcode. The COUNTER calls it through window.CBScaleCode on
// @stage-note every scan; tests/scalecode.test.js runs every format with no browser. No server route reaches it
// @stage-note yet — the weight is decided at the counter, where the scale is, and travels on the line.
/**
 * lib/scalecode.js — A BARCODE A WEIGHING SCALE PRINTED. Which item, and how much of it.
 *
 * ── ⚠️⚠️⚠️ THE PROBLEM, AND WHY IT IS NOT A LOOKUP TABLE ────────────────────────────────────────────────────
 *
 * A vegetable shop weighs the tomatoes, the scale prints a label, and the barcode on that label is NOT a
 * product code. It carries the item AND the weight (or the price) inside the digits. GS1 reserves prefixes 02
 * and 20–29 for exactly this and then says nothing more: the meaning of the remaining digits is the shop's own.
 * Every scale vendor lays them out differently, and there is no registry to consult.
 *
 * ⭐ SO THE SHOP DECLARES ITS FORMAT AND WE DECODE IT. A branch per vendor is a file that grows for ever and is
 * wrong for the next shop; a MASK is one rule that fits all of them. The backlog said this was *"a question for
 * the day the scale is in front of us, not a guess now"* — and it is still not a guess, because nothing here
 * assumes any particular scale. [[feedback-the-data-decides-not-the-trade]]
 *
 * ── ⭐⭐ THE MASK ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * One character per digit of the barcode:
 *
 *     0-9   this digit must be exactly that — the prefix, which is what says "this is a scale label"
 *     I     an item-code digit          (what was weighed)
 *     W     a weight digit              (in the unit `weighs` names, default grams)
 *     P     a price digit               (in the smallest money unit — paise)
 *     C     the barcode's check digit   — verified, not ignored
 *     X     a digit nothing depends on  (a scale's own counter, a tare code)
 *
 * So `21IIIIIWWWWWC` reads: prefix 21, five item digits, five weight digits, the EAN check — thirteen in all.
 * ⚠️ COUNT THE CHARACTERS. A mask one digit longer than the barcode matches nothing, for ever, and the
 * feature then looks switched off rather than broken. Both presets below are counted, and example() proves it.
 *
 * ⚠️ A MASK CARRIES EITHER W OR P, NEVER BOTH. A label that stated a weight and a price could disagree with
 * itself, and then the shop has to decide which one the customer pays — at the counter, with a queue. The scale
 * already resolved it; we read whichever one it chose to print.
 */

/**
 * ⭐ TWO THAT ARE ACTUALLY COMMON, so a shopkeeper picks a name rather than typing a mask. Neither is a
 * standard — they are the layouts most Indian and European counter scales are shipped on — which is exactly
 * why `custom` exists beside them and why nothing here is hard-wired.
 */
const PRESETS = {
  weight_13: { label: 'Weight in the barcode',
               hint: '13 digits: prefix 21, item, weight in grams — the usual for produce',
               /* ⚠️ THIRTEEN DIGITS, COUNTED. The first draft wrote 21IIIIICWWWWWC — an inner check digit
                  made it FOURTEEN, and an EAN-13 is thirteen. Nothing would ever have matched it, and the
                  feature would have looked switched off rather than broken. The example builder caught it. */
               mask: '21IIIIIWWWWWC', weighs: 'gram' },
  price_13:  { label: 'Price in the barcode',
               hint: '13 digits: prefix 22, item, price in paise — the usual for deli and cut meat',
               mask: '22IIIIIPPPPPC', weighs: null },
};

const isDigits = (s) => /^[0-9]+$/.test(s);

/**
 * ── ⭐⭐ THE MASK A SETTING MEANS ────────────────────────────────────────────────────────────────────────────
 *
 * Three ways to say the same thing, in the order a shop is likely to have said it:
 *   · `mask`                     typed by somebody whose scale is unusual
 *   · `preset`                   picked from a list
 *   · `{ prefix, kind }`         what the counter has stored since the first version of this feature
 *
 * ⚠️⚠️ THE THIRD ONE IS NOT LEGACY CRUFT, IT IS A SHOP'S WORKING SETTING. till.html read `{on, prefix, kind}`
 * and built a thirteen-digit layout by hand; any counter already configured that way must keep working with no
 * intervention. So it is translated here rather than being replaced by a migration nobody will run.
 * [[feedback-stay-in-the-construct]]
 */
function maskOf(setting) {
  const cfg = setting || {};
  if (cfg.mask) return String(cfg.mask).toUpperCase().replace(/\s+/g, '');
  if (cfg.preset && PRESETS[cfg.preset]) return PRESETS[cfg.preset].mask;
  if (!cfg.prefix) return '';
  /* ⚠️ COUNTED FROM THIRTEEN, exactly as the page did: prefix + item + five-digit value + check = 13. A
     one-digit prefix leaves six item digits and a two-digit prefix leaves five; both are printed in the trade,
     so the item field is whatever is left rather than a hard-wired five. */
  const p = String(cfg.prefix);
  const value = cfg.kind === 'weight' ? 'W' : 'P';
  const items = 13 - p.length - 5 - 1;
  if (items < 1) return '';
  return p + 'I'.repeat(items) + value.repeat(5) + 'C';
}

/** the GS1 / EAN check digit for a payload that is missing its last digit */
function checkDigit(payload) {
  let sum = 0;
  const d = String(payload).split('').reverse();
  for (let i = 0; i < d.length; i++) sum += Number(d[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/**
 * ⚠️ A MASK NOBODY CHECKED IS A SHOP SILENTLY SELLING THE WRONG WEIGHT. This is called when the setting is
 * saved, so a mistake is caught by the person who made it rather than at a till three weeks later.
 */
function checkMask(mask) {
  const m = String(mask || '').toUpperCase().replace(/\s+/g, '');
  if (!m) return { ok: false, why: 'Type the pattern your scale prints.' };
  if (!/^[0-9IWPXC]+$/.test(m)) return { ok: false, why: 'Use only 0-9 and the letters I, W, P, X and C.' };
  if (m.length < 8 || m.length > 18) return { ok: false, why: 'A barcode is between 8 and 18 digits.' };
  const has = (c) => m.indexOf(c) >= 0;
  if (!has('I')) return { ok: false, why: 'The pattern needs at least one I — the item code.' };
  if (has('W') && has('P')) return { ok: false, why: 'A label carries a weight or a price, not both.' };
  if (!has('W') && !has('P')) return { ok: false, why: 'The pattern needs W digits (weight) or P digits (price).' };
  if (!/^[0-9]/.test(m)) return { ok: false, why: 'It must start with the digits your scale always prints, so an ordinary barcode is not mistaken for one.' };
  return { ok: true, mask: m };
}

/** pull out the digits one letter marks, as a string, in order */
function pick(code, mask, letter) {
  let out = '';
  for (let i = 0; i < mask.length; i++) if (mask[i] === letter) out += code[i];
  return out;
}

/**
 * ── ⭐⭐⭐ READ ONE ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Returns null when this is an ORDINARY barcode — which is the common case and must cost nothing. It is not a
 * failure and must never be reported as one: a shop scans a thousand normal products a day.
 *
 * ⚠️⚠️ AND A LABEL THAT MATCHES THE PREFIX BUT FAILS ITS CHECK DIGIT IS A FAILURE, loudly. That is a damaged
 * or misread label, and quietly treating it as an ordinary barcode would send the counter looking up an item
 * code that happens to exist. [[feedback-silence-is-the-bug]]
 */
function read(code, setting) {
  const s = String(code == null ? '' : code).trim();
  const cfg = setting || {};
  const preset = cfg.preset && PRESETS[cfg.preset];
  /* ⚠️ `on: false` MEANS OFF, whatever else is stored. A shop that switched the scale off and kept its
     settings must not have labels decoded behind its back. */
  if (cfg.on === false) return null;
  const raw = maskOf(cfg);
  if (!raw) return null;                               /* the shop has no scale — nothing to look for */
  const v = checkMask(raw);
  if (!v.ok) return null;                              /* a broken setting must not break scanning */
  const mask = v.mask;

  if (!isDigits(s) || s.length !== mask.length) return null;
  /* the literal digits are what says "this is one of ours" */
  for (let i = 0; i < mask.length; i++) {
    if (/[0-9]/.test(mask[i]) && mask[i] !== s[i]) return null;
  }

  /* ⚠️ THE LAST C IS THE BARCODE'S OWN CHECK, over everything before it. An inner C (some scales put one on
     the item code) is a digit we do not verify — only the scale knows what it covered. */
  const last = mask.lastIndexOf('C');
  if (last === mask.length - 1) {
    if (checkDigit(s.slice(0, -1)) !== Number(s[s.length - 1])) {
      return { ok: false, scale: true, why: 'That label did not scan cleanly. Weigh it again.' };
    }
  }

  const item = pick(s, mask, 'I').replace(/^0+(?=\d)/, '');
  if (!item) return { ok: false, scale: true, why: 'That label carries no item code.' };

  const out = { ok: true, scale: true, item: item, mask: mask };

  const wDigits = pick(s, mask, 'W');
  if (wDigits) {
    /**
     * ⭐ THE DIVISOR IS THE SHOP'S, and it is why `weighs` is a UNIT rather than a number of decimals. A scale
     * printing grams and one printing hundredths of a kilo emit the same five digits for different amounts.
     */
    const n = Number(wDigits);
    const unit = cfg.weighs || (preset && preset.weighs) || 'gram';
    const div = Number(cfg.divisor) > 0 ? Number(cfg.divisor) : 1;
    out.qty = n / div;
    out.unit = unit;
    if (!(out.qty > 0)) return { ok: false, scale: true, why: 'That label says a weight of nothing. Weigh it again.' };
    return out;
  }

  const pDigits = pick(s, mask, 'P');
  const paise = Number(pDigits);
  /**
   * ⚠️⚠️ A PRICE LABEL SETS THE LINE'S MONEY, NOT ITS QUANTITY, and the counter must know the difference: the
   * scale already multiplied, so multiplying again by a rate would charge the customer twice over.
   */
  out.amount = paise / (Number(cfg.money_divisor) > 0 ? Number(cfg.money_divisor) : 100);
  out.qty = 1;
  if (!(out.amount > 0)) return { ok: false, scale: true, why: 'That label says a price of nothing. Weigh it again.' };
  return out;
}

/**
 * ⭐ AND A WORKED EXAMPLE FOR THE SETTINGS SCREEN, built from the shop's own mask. Somebody setting this up
 * should see what their scale's label would read as, before a customer is standing there.
 */
function example(setting) {
  const cfg = setting || {};
  const preset = cfg.preset && PRESETS[cfg.preset];
  const v = checkMask(maskOf(cfg));
  if (!v.ok) return null;
  const mask = v.mask;
  /**
   * ⚠️ A PLAUSIBLE EXAMPLE, NOT AN ARBITRARY ONE. The first draft filled the value digits from their own
   * position and showed a shopkeeper "81230 gram" — eighty-one kilos of tomatoes. An example nobody believes
   * teaches nothing, and on a settings screen it reads as the software being wrong.
   * ⭐ So: item 1234, and 750 of whatever the value digits count — grams or paise, both are a real amount.
   */
  const nV = (mask.match(/[WP]/g) || []).length;
  const value = String(750).padStart(nV, '0').slice(-nV);
  const nI = (mask.match(/I/g) || []).length;
  const item = String(1234).padStart(nI, '0').slice(-nI);
  let body = '';
  let vi = 0, ii = 0;
  for (let i = 0; i < mask.length - 1; i++) {
    const c = mask[i];
    if (/[0-9]/.test(c)) body += c;
    else if (c === 'I') body += item[ii++];
    else if (c === 'W' || c === 'P') body += value[vi++];
    else body += '0';
  }
  const code = body + (mask[mask.length - 1] === 'C' ? String(checkDigit(body)) : '0');
  const r = read(code, setting);
  return r && r.ok ? { code: code, reads: r } : { code: code, reads: null };
}

var EXPORTS = { PRESETS, checkMask, checkDigit, read, example, maskOf };

window.CBScaleCode = EXPORTS;
})();
