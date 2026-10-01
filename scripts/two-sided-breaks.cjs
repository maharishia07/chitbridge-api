/* break each guard of the two-sided counter bill once; every break must turn its test red; every file is restored from a
   COPY (never git). The counter's own guards (till.html) are broken by chitbridge-web e2e/till-two-sided-breaks.cjs.
   Run: node scripts/two-sided-breaks.cjs */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const R = process.argv[2] || path.join(__dirname, '..');
const BREAKS = [
  /* who sells, on each copy (lib/tax-copy.js) */
  ['tax-copy', 'lib/tax-copy.js', "  const iSell = theirCounterBill ? false : (orderLike ? !sent : sent);", "  const iSell = orderLike ? !sent : sent;", 'a received counter bill is the receiver\'s sale again'],
  ['tax-copy', 'lib/tax-copy.js', "(orderLike || toSelf) && !theirCounterBill) {", "(orderLike || toSelf)) {", 'the counter rule claims a bill I did not issue'],
  ['tax-copy', 'lib/tax-copy.js', "function counterIssued(bj) { return !!(bj && typeof bj === 'object' && bj.bill_no && bj.till && bj.till.id); }", "function counterIssued(bj) { return false; }", 'no bill is recognised as a counter\'s'],
  ['two-sided-books', 'lib/tax-copy.js', "  const theirCounterBill = orderLike && !sent && counterIssued(hdr.business_json);", "  const theirCounterBill = false;", 'the customer\'s ledger: their copy prices as their own sale'],
  /* the till gate (routes/chits.js tillMaySend) */
  ['two-sided-bill', 'routes/chits.js', "    if (!bj.customer || String(bj.customer.entity_id || '') !== eid) return false;", "", 'a till sends to someone the bill does not name'],
  ['two-sided-bill', 'routes/chits.js', "    return ok.rows.length === 1;\n  } catch (_) { return false; }", "    return true;\n  } catch (_) { return false; }", 'a till sends to a business off its customer list'],
  ['two-sided-bill', 'routes/chits.js', "    if (outward.length !== 1) return false;", "", 'a till sends to two outside parties'],
  ['two-sided-bill', 'routes/chits.js', "    if (String(r.role || 'to').toLowerCase() !== 'to') return false;", "", 'a till sends a cc'],
  ['two-sided-bill', 'routes/chits.js', "    if (String(b.purpose || 'order') !== 'order' || !taxCopy.counterIssued(bj)) return false;", "", 'a till sends something that is not a counter bill'],
  ['two-sided-bill', 'routes/chits.js', "        if (outward.length && !(await tillMaySend(sender_id, outward, req.body))) {", "        if (false) {", 'the till gate is gone'],
  /* the copies (routes/chits.js send) */
  ['two-sided-bill', 'routes/chits.js', "      } else if (client_ref && hasSelf && !is_draft && !promote_draft_id) {", "      } else if (false) {", 'the shop gets two rows for one numbered bill (b263 refuses the send)'],
  ['two-sided-bill', 'routes/chits.js', "const o = Object.assign({}, business_json); delete o.client_ref; return o;", "const o = Object.assign({}, business_json); return o;", 'the customer\'s copy carries the shop\'s client_ref'],
  ['two-sided-bill', 'routes/chits.js', "      const sellerId = (orderLike && !counterBill && toIds.length === 1) ? toIds[0] : sender_id;", "      const sellerId = (orderLike && toIds.length === 1) ? toIds[0] : sender_id;", 'the customer becomes the seller of a counter bill'],
  /* goods-in (routes/chits.js deliver-lines · lib/tax-copy billReceived · routes/till.js tasks) */
  ['goods-in-accepts', 'lib/tax-copy.js', "  if (!h.sender_entity_id || String(h.sender_entity_id) === String(me)) return false;", "", 'the seller\'s own despatch accepts its own bill'],
  ['goods-in-accepts', 'routes/chits.js', "taxCopy.billReceived(mine, entity_id) && /^(pending|delivered|read)$/.test(String(mine.current_status || ''))", "taxCopy.billReceived(mine, entity_id)", 'a rejected bill is accepted by a later goods-in'],
  ['goods-in-accepts', 'routes/chits.js', "      if (s && s.lines > 0 && s.complete === s.lines) {", "      if (s && s.lines > 0) {", 'a part delivery accepts the bill'],
  ['goods-in-accepts', 'routes/chits.js', "          if (mv.moved) out.accepted = true;", "", 'goods-in never says it accepted'],
  ['goods-in-accepts', 'routes/chits.js', "          const mv = await moveStatus(entity_id, chit_id, 'accepted',", "          const mv = { moved: true }; void (entity_id, chit_id, 'accepted',", 'goods-in claims acceptance without the transition'],
  ['goods-in-accepts', 'routes/till.js', "        if (bj.bill_no && !theirBill) continue;", "        if (bj.bill_no) continue;", 'a supplier\'s counter bill is not offered at goods-in'],
  ['goods-in-accepts', 'routes/till.js', "        WHERE h.entity_id = $1 AND h.sender_entity_id = $1 AND h.purpose IN ('order','offer','credit_note')", "        WHERE h.entity_id = $1 AND h.purpose IN ('order','offer','credit_note')", '"earlier bills" lists a supplier\'s bill as mine'],
  /* the snapshot (routes/till.js · lib/local-identity onRailSql) */
  ['books-counter-snapshot', 'routes/till.js', "        if (x.rail_entity_id) out.entity_id = x.rail_entity_id;", "        out.entity_id = x.identity_id;", 'every customer is called "on the rail"'],
  ['books-counter-snapshot', 'lib/local-identity.js', " AND COALESCE(${a}.user_id, '') NOT LIKE '~%'`", "`", 'a minted local record counts as on the rail'],
  ['books-counter-snapshot', 'lib/local-identity.js', "       + ` AND COALESCE(to_jsonb(${a})->>'entity_kind', '') <> 'shopper')`;", "       + `)`;", 'a storefront shopper counts as on the rail'],
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
  console.log('  ' + (red ? 'caught' : 'MISSED') + '  ' + test.padEnd(24) + what);
}
console.log('\n' + caught + '/' + BREAKS.length + ' caught' + (missed.length ? ' · MISSED: ' + missed.join(' | ') : ''));
process.exit(missed.length ? 1 : 0);
