/* break each guard of "one invoice, everywhere" (2026-10-02: one computation — CBTax.determine at the counter — and every
   other place only reads) once; every break must turn tests/tax-truth.test.cjs red; every
   file is restored from a COPY (never git); each anchor is ONE line, matched once; CRLF-safe.
   Run: node scripts/tax-truth-breaks.cjs */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const R = process.argv[2] || path.join(__dirname, '..');
const BREAKS = [
  /* (A) billing computes once — CBTax.determine() in the counter's billMoney(); the bill reads its answer */
  ['tax-truth', 'tools/tally-connector/till.html', "  return { gross:e.gross, save:e.savings, net:e.total, base:e.taxable, tax:e.tax, round:e.round_off, byRate:byRate,", "  return { gross:e.gross, save:e.savings, net:r2(CART.reduce(function(a, c){ return a + (c.net || 0); }, 0)), base:e.taxable, tax:e.tax, round:e.round_off, byRate:byRate,", 'the bill sums its own line nets as the total'],
  ['tax-truth', 'tools/tally-connector/till.html', "             Pos: CBTax.placeOfSupply({ delivery: BILL_DELIVERY }, sc) },", "             Pos: g ? g.slice(0, 2) : sc },", 'the counter takes the buyer\'s GSTIN state as place of supply'],
  ['tax-truth', 'tools/tally-connector/till.html', "    invoice: m.invoice,", "    invoice: undefined,", 'the bill leaves determine()\'s invoice behind'],
  /* (A2) no invoice, no sale — with the engine missing finish() refuses rather than saving a ₹0 bill */
  ['tax-truth', 'tools/tally-connector/till.html', "  if (!m.invoice) { say('Prices cannot be worked out on this counter right now.\\n\\nPress refresh while online.'); return; }", "", 'the counter sells at ₹0 with the tax engine missing'],
  /* (B) chitOf carries the result unchanged, on both hosts */
  ['tax-truth', 'tools/tally-connector/till.html', "      invoice: bill.invoice || undefined,", "", 'chitOf drops the invoice'],
  ['tax-truth', 'tools/tally-connector/till.js', "      invoice: bill.invoice || undefined,", "", 'the shop-PC program drops the invoice'],
  /* (C) the server only reads — stores, maps, posts; a recompute only checks */
  ['tax-truth', 'routes/chits.js', "        moneyBlock = moneyOfInvoice(carried, currency_code);", "", 'summary_json.money is not mapped off the stored invoice'],
  ['tax-truth', 'routes/chits.js', "  return { gross: m.gross, savings: m.savings, net: m.net, taxable: m.taxable, tax: m.tax, total: m.total,", "  return { gross: m.gross, savings: m.savings, net: m.net, taxable: m.taxable, tax: m.tax, total: m.net,", 'the header\'s total is taken from a field the engine did not name total'],
  ['tax-truth', 'routes/chits.js', "      if (issuedTotal != null) summary.total_value = issuedTotal;", "", 'the stored total is the sum of line nets'],
  ['tax-truth', 'lib/tax-copy.js', "  const inv = frozen ? { invoice: frozen, rated: null, unrated: null, provisional: false }", "  const inv = (frozen && !issued) ? { invoice: frozen, rated: null, unrated: null, provisional: false }", 'the server posts its recompute instead of the stored invoice'],
  ['tax-truth', 'lib/tax-copy.js', "      taxCheck = I.check(frozen, server);", "      taxCheck = I.check(frozen, server); Object.assign(frozen, server);", 'the check writes its recompute over the stored invoice'],
  ['tax-truth', 'lib/issued-invoice.js', "  return { ok: out.length === 0, differences: out, says: out.map((d) => d.what + ': issued ' + d.issued + ', server ' + d.server).join(' · ') };", "  return { ok: true, differences: [], says: '' };", 'a difference is silently swallowed'],
  /* place of supply — the engine's one rule (the server's check uses it) */
  ['tax-truth', 'lib/tax-copy.js', "    if (counterIssued(bj)) b.Pos = placeOfSupply(bj, meParty.State);", "    if (false) b.Pos = placeOfSupply(bj, meParty.State);", 'the seller\'s copy checks against the buyer\'s state as place of supply'],
  ['tax-truth', 'lib/tax-copy.js', "  if (!sent && counterIssued(hdr.business_json) && buyer && seller && seller.State) buyer.Pos = placeOfSupply(hdr.business_json, seller.State);", "", 'the buyer\'s copy checks against the buyer\'s own state as place of supply'],
  ['tax-truth', 'lib/tax-copy.js', "const { placeOfSupply } = require('./tax');   // ⭐ the ONE place-of-supply rule — the engine's, the counter's CBTax.placeOfSupply", "const placeOfSupply = (rec, shopState) => shopState;", 'the server keeps a rule of its own that ignores a recorded delivery'],
  /* the reprint reads the stored invoice (routes/till.js /bills · till.html reprintOld · slipOfRow · slipHTML) */
  ['tax-truth', 'routes/till.js', "               invoice: (b.invoice && typeof b.invoice === 'object' && b.invoice.ValDtls) ? b.invoice : null,", "               invoice: null,", 'the earlier-bills row leaves the stored invoice behind'],
  ['tax-truth', 'tools/tally-connector/till.html', "  b = slipOfRow(b);", "", 'the reprint ignores the stored invoice'],
  ['tax-truth', 'tools/tally-connector/till.html', "                                lines: (b.lines || []).map(function(l, n){ return Object.assign({}, l, m.lines[n] || {}); }) });", "                                lines: b.lines });", 'the reprint\'s lines do not read their ItemList (Gross ₹0.00)'],
  ['tax-truth', 'tools/tally-connector/till.html', "    + (bill.kind === 'tax' ? (bill.tax_lost ? t('Tax detail not kept for this bill', '') : taxSummaryHTML(bill, t, dash)) : '')", "    + (bill.kind === 'tax' ? taxSummaryHTML(bill, t, dash) : '')", 'a reprint with no stored invoice prints GST 0.00'],
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
