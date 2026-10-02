/* break each guard of "one invoice, everywhere" (2026-10-02) once; every break must turn tests/tax-truth.test.cjs red; every
   file is restored from a COPY (never git); each anchor is ONE line, matched once; CRLF-safe.
   Run: node scripts/tax-truth-breaks.cjs */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const R = process.argv[2] || path.join(__dirname, '..');
const BREAKS = [
  /* the counter carries its invoice (tools/tally-connector/till.html chitOf · invoiceOf · finish) */
  ['tax-truth', 'tools/tally-connector/till.html', "      invoice: bill.invoice || undefined,", "", 'chitOf drops the carried invoice'],
  ['tax-truth', 'tools/tally-connector/till.html', "      ['gross','taxable','tax','cgst','sgst','igst'].forEach(function(k){ if (l[k] != null) o[k] = l[k]; });", "      ['gross'].forEach(function(k){ if (l[k] != null) o[k] = l[k]; });", 'chitOf drops each line\'s taxable · tax · heads'],
  ['tax-truth', 'tools/tally-connector/till.html', "  return { issued:'counter', taxable:m.base, tax:m.tax, total:m.net, round_off:m.round || 0, supply:m.supply,", "  return { issued:'counter', taxable:m.base, tax:m.tax, total:r2(m.net - (m.round || 0)), round_off:0, supply:m.supply,", 'the carried total is the sum of line nets (the round-off lost)'],
  ['tax-truth', 'tools/tally-connector/till.js', "      invoice: bill.invoice || undefined,", "", 'the shop-PC program drops the carried invoice'],
  /* the server stores and posts what was issued (lib/tax-copy.js entryFor) */
  ['tax-truth', 'lib/tax-copy.js', "    inv = { invoice: issued, rated: lines.length, unrated: 0, provisional: false };", "    inv = T.invoiceFor({ lines, seller: p.seller, buyer: p.buyer, currency: hdr.currency_code, chit_id: hdr.chit_id, at, priceIncludesTax: p.priceIncludesTax });", 'the server recomputes over the carried figures'],
  ['tax-truth', 'lib/tax-copy.js', "  const carried = counterIssued(bj) ? I.issuedOf(bj) : null;", "  const carried = null;", 'the carried block is never read'],
  ['tax-truth', 'lib/issued-invoice.js', "  if (r2(iv.TotInvVal) !== r2(own + r2(iv.RndOffAmt))) say('total', r2(iv.TotInvVal), own);", "  return { ok: true, differences: [] };", 'a difference is silently swallowed'],
  /* place of supply — one rule */
  ['tax-truth', 'lib/tax-copy.js', "    if (counterIssued(bj)) b.Pos = I.placeOfSupply(bj, meParty.State);", "    if (false) b.Pos = I.placeOfSupply(bj, meParty.State);", 'the seller\'s copy takes the buyer\'s state as place of supply'],
  ['tax-truth', 'lib/tax-copy.js', "  if (!sent && counterIssued(hdr.business_json) && buyer && seller && seller.State) buyer.Pos = I.placeOfSupply(hdr.business_json, seller.State);", "", 'the buyer\'s copy takes the buyer\'s own state as place of supply'],
  ['tax-truth', 'tools/tally-connector/till.html', "  var pos = placeOfSupply({ delivery: BILL_DELIVERY }, sc);", "  var pos = (custKnown() && custKnown().gstin) ? String(custKnown().gstin).slice(0, 2) : sc;", 'the counter takes the buyer\'s GSTIN state as place of supply'],
  ['tax-truth', 'tools/tally-connector/till.html', "  var supply = (window.CBTax && CBTax.supplyType) ? CBTax.supplyType(sc, pos) : 'unknown';", "  var supply = (window.CBTax && CBTax.supplyType) ? CBTax.supplyType(sc, sc) : 'unknown';", 'the counter compares the shop with itself (a delivery stays intra)'],
  ['tax-truth', 'lib/issued-invoice.js', "  return /^\\d{2}$/.test(to) ? to : shop;", "  return shop;", 'the server ignores a recorded delivery (and the two rules part)'],
  /* the total and the paisa (routes/chits.js send) */
  ['tax-truth', 'routes/chits.js', "      if (issuedTotal != null) summary.total_value = issuedTotal;", "", 'the stored total is the sum of line nets'],
  ['tax-truth', 'lib/issued-invoice.js', "  return { total_value: r2(block.total),", "  return { total_value: net,", 'the header value is the sum of line nets'],
  /* the reprint prints the original (till.html reprintOld · slipOfRow · slipHTML; lib/issued-invoice billRow) */
  ['tax-truth', 'tools/tally-connector/till.html', "  b = slipOfRow(b);", "", 'the reprint ignores the carried invoice'],
  ['tax-truth', 'tools/tally-connector/till.html', "    + (bill.kind === 'tax' ? (bill.tax_lost ? t('Tax detail not kept for this bill', '') : taxSummaryHTML(bill, t, dash)) : '')", "    + (bill.kind === 'tax' ? taxSummaryHTML(bill, t, dash) : '')", 'a reprint with no carried block prints GST 0.00'],
  ['tax-truth', 'lib/issued-invoice.js', "           invoice: inv,", "           invoice: null,", 'the earlier-bills row leaves the invoice behind'],
];
let caught = 0; const missed = [];
for (const [test, file, from, to, what] of BREAKS) {
  const abs = path.join(R, file), copy = abs + '.breakcopy';
  const orig = fs.readFileSync(abs, 'utf8'); fs.writeFileSync(copy, orig);
  const crlf = orig.includes('\r\n'); let s = crlf ? orig.replace(/\r\n/g, '\n') : orig;
  if (s.split(from).length !== 2) { console.log('  ??   ' + test + ' — anchor not found once: ' + what); fs.unlinkSync(copy); missed.push(what + ' (no anchor)'); continue; }
  s = s.replace(from, () => to); fs.writeFileSync(abs, crlf ? s.replace(/\n/g, '\r\n') : s);
  const t = ['.test.cjs', '.test.js'].map((x) => path.join(R, 'tests', test + x)).find((p) => fs.existsSync(p));
  const r = spawnSync(process.execPath, [t], { encoding: 'utf8', timeout: 120000, env: process.env });
  fs.writeFileSync(abs, fs.readFileSync(copy, 'utf8')); fs.unlinkSync(copy);
  const red = r.status !== 0;
  if (red) caught++; else missed.push(test + ': ' + what);
  console.log('  ' + (red ? 'caught' : 'MISSED') + '  ' + test.padEnd(12) + what);
}
console.log('\n' + caught + '/' + BREAKS.length + ' caught' + (missed.length ? ' · MISSED: ' + missed.join(' | ') : ''));
process.exit(missed.length ? 1 : 0);
