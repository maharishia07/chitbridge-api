/**
 * tools/sim-scale.cjs — PERF1 · `sim-load --scale 10k|50k|100k`: ONE shop grown to that many journal lines, then every hot read TIMED.
 *
 * Athi, 14 Oct: "assuming a ledger has 1000 entries … are you loading all at once? … check all the data retrieval logic". Y1b's shop
 * (tools/sim-load.cjs, docs/SIM-LOAD.md) proves the books are RIGHT over three years; this proves they stay FAST at a big shop's size.
 * Called by sim-load AFTER its own plan has loaded (or found) the shop, with the api already running in the same process — never alone.
 *
 * GROW (resumable — a second run tops up to the target, nothing twice):
 *   · parties    500 customers through POST /api/relationships/customers (the door the app uses)
 *   · catalogue  10,000 products through POST /api/products/bulk (BULK_MAX a call)
 *   · journal    credit bills (debtors · sales · CGST · SGST) to those customers and cash bills, through lib/books.postEntry — the ONE writer the
 *                hooks call — each with source_ref `scale:<n>` (postEntry answers a second post of it as a duplicate); payments through
 *                POST /api/books/payments (oldest first) settle the older bills until about 5,000 stay open. All dated in the open year after
 *                the plan (sim-load `--start 2023-04-01` ends the plan on 31 Mar 2026), the shop clock set to that year's last loaded day.
 * TIME (`--scale-reads` alone skips GROW): each read 20 times over HTTP, p50 / p95 ms, rows returned, and X-DB-Trips (lib/trips, CB_TRIPS=1).
 * Prints a markdown table — the one docs/SIM-LOAD.md "Scale" keeps (before / after b406 + the PERF1 reads).
 */
'use strict';
const TARGETS = { '10k': 10000, '50k': 50000, '100k': 100000 };
const PARTIES = 500,
  CATALOGUE = 10000,
  OPEN_MAX = 5000; /* open items: 5,000 — or a twentieth of the lines on a smaller shop (a credit bill is 4 lines) */

function pct(a, p) {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : null;
}

/**
 * run(ctx) — ctx: { base, sql, B, CLOCK, shopId, token, cur, scale, readsOnly, say, start (the open year's first day), end (its last loaded day) }
 */
async function run(ctx) {
  const { base, sql, B, CLOCK, shopId, token, say } = ctx;
  const target = TARGETS[ctx.scale];
  if (!target) throw new Error('--scale is 10k, 50k or 100k');
  const OPEN_ITEMS = Math.min(OPEN_MAX, Math.round(target / 20));
  const call = async (p, o) => {
    const opt = o || {},
      t0 = process.hrtime.bigint();
    const reply = await fetch(base + p, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    const text = await reply.text(),
      ms = Number(process.hrtime.bigint() - t0) / 1e6;
    let b = null;
    try {
      b = JSON.parse(text);
    } catch (_) {
      b = null;
    }
    return { status: reply.status, b: b || {}, ms, trips: Number(reply.headers.get('x-db-trips')) || null, bytes: text.length };
  };
  const lines = async () => Number((await sql('SELECT count(*)::int AS n FROM journal_line WHERE entity_id = $1', [shopId])).rows[0].n);
  CLOCK.set(ctx.end + 'T20:00:00+05:30');

  if (!ctx.readsOnly) {
    /* parties */
    const have = Number((await sql(`SELECT count(*)::int AS n FROM customer_list WHERE owner_entity_id = $1`, [shopId])).rows[0].n);
    for (let i = have; i < PARTIES; i++) {
      const r = await call('/api/relationships/customers', {
        method: 'POST',
        body: { name: 'Scale Customer ' + String(i + 1).padStart(4, '0'), phone: '9' + String(800000000 + i) }
      });
      if (r.status >= 300 && r.status !== 409) throw new Error('customer ' + i + ': HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    }
    const custs = (
      await sql(`SELECT customer_identity_id AS id FROM customer_list WHERE owner_entity_id = $1 ORDER BY created_at, customer_identity_id`, [shopId])
    ).rows.map((x) => String(x.id));
    say('scale · parties ' + custs.length);
    /* catalogue */
    const items = Number((await sql(`SELECT count(*)::int AS n FROM catalogue_items WHERE entity_id = $1`, [shopId])).rows[0].n);
    for (let i = items; i < CATALOGUE;) {
      const batch = [];
      for (let index = 0; index < 200 && i < CATALOGUE; index++, i++) {
        const nm = 'Scale item ' + String(i + 1).padStart(5, '0');
        batch.push({ product: nm, name: nm, unit: 'piece', price: 10 + (i % 490), category: 'Scale', hsn: '3401', gst_rate: 18 });
      }
      const r = await call('/api/products/bulk', { method: 'POST', body: { items: batch } });
      if (r.status >= 300) throw new Error('products bulk: HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 200));
    }
    say('scale · catalogue ' + Number((await sql(`SELECT count(*)::int AS n FROM catalogue_items WHERE entity_id = $1`, [shopId])).rows[0].n));
    /* the journal: credit bills (4 lines) and cash bills (4 lines) spread over the open year's days, then payments (2 lines) settling the oldest */
    const days = [];
    for (let date = new Date(ctx.start + 'T00:00:00Z'); date.toISOString().slice(0, 10) <= ctx.end; date.setUTCDate(date.getUTCDate() + 1))
      days.push(date.toISOString().slice(0, 10));
    let n = Number((await sql(`SELECT count(*)::int AS n FROM journal_entry WHERE entity_id = $1 AND source_ref LIKE 'scale:%'`, [shopId])).rows[0].n);
    let have0 = await lines();
    const t0 = Date.now();
    /* each payment adds 2 lines and closes one bill: bills B, payments B − OPEN, lines ≈ 4B + 2(B − OPEN) → B ≈ (need + 2·OPEN) / 6 of credit, the same again cash */
    const need = Math.max(0, target - have0),
      credit = Math.max(OPEN_ITEMS, Math.round((need + 2 * OPEN_ITEMS) / 10)),
      cash = Math.max(0, Math.round((need - 4 * credit - 2 * (credit - OPEN_ITEMS)) / 4));
    const total = credit + cash;
    while (n < total && have0 < target) {
      const i = n,
        day = days[Math.floor((i * days.length) / total)],
        isCredit = i % (total / Math.max(1, credit)) < 1;
      const taxable = 100 + ((i * 37) % 4900),
        rate = [5, 12, 18][i % 3],
        half = Math.round((taxable * rate) / 2) / 100; /* each head to the paisa: the bill's total is exact */
      const ev = {
        type: 'sale_bill',
        date: day,
        currency: ctx.cur,
        source_ref: 'scale:' + i,
        ref: 'SC/' + i,
        by_rate: [{ rate, taxable, cgst: half, sgst: half, igst: 0 }],
        round_off: 0
      };
      if (isCredit) Object.assign(ev, { party: custs[i % custs.length], paid: {} });
      else ev.paid = { cash: Math.round((taxable + 2 * half) * 100) / 100 };
      const r = await B.postEntry(null, shopId, ev).catch((e) => ({ ok: false, why: String(e && e.message) }));
      if (!r || !r.ok) throw new Error('scale bill ' + i + ' refused: ' + JSON.stringify(r).slice(0, 300));
      n++;
      if (n % 2000 === 0) {
        have0 = await lines();
        say('scale · ' + n + ' bills · ' + have0 + ' lines · ' + Math.round((Date.now() - t0) / 1000) + 's');
      }
    }
    /* settle the oldest bills until OPEN_ITEMS stay open (one payment per bill, its exact amount, oldest first) */
    const open = (
      await sql(
        `SELECT party_id, against_ref, SUM(amount_minor)::bigint AS open, to_char(MIN(doc_date) + 15, 'YYYY-MM-DD') AS paid_on FROM party_item WHERE entity_id = $1 AND ref_kind IN ('bill', 'allocation') AND against_ref LIKE 'scale:%' GROUP BY party_id, against_ref
                              HAVING SUM(amount_minor) > 0 ORDER BY MIN(created_at)`,
        [shopId]
      )
    ).rows;
    const toPay = open.slice(0, Math.max(0, open.length - OPEN_ITEMS));
    let paid = 0;
    for (const o of toPay) {
      const body = {
        party_id: o.party_id,
        direction: 'in',
        amount_minor: Number(o.open),
        currency: ctx.cur,
        mode: 'cash',
        received_at: o.paid_on && o.paid_on < ctx.end ? o.paid_on : ctx.end,
        allocations: [{ against_ref: o.against_ref, amount_minor: Number(o.open) }],
        client_ref: 'scale-pay:' + o.against_ref
      };
      let r = await call('/api/books/payments', { method: 'POST', body });
      if (r.status === 409 && r.b.warnings)
        r = await call('/api/books/payments', { method: 'POST', body: Object.assign(body, { acknowledge: r.b.warnings.map((item) => item.code) }) });
      if (r.status >= 300) throw new Error('scale payment refused: HTTP ' + r.status + ' ' + JSON.stringify(r.b).slice(0, 300));
      paid++;
      if (paid % 1000 === 0) say('scale · ' + paid + ' payments · ' + Math.round((Date.now() - t0) / 1000) + 's');
    }
    say('scale · grown: ' + (await lines()) + ' journal lines · ' + n + ' scale bills · ' + paid + ' payments · ' + Math.round((Date.now() - t0) / 1000) + 's');
  }

  /* ── TIME ── the planner's statistics first: rows bulk-loaded a minute ago are invisible to it until autovacuum's ANALYZE runs (a shop grown in
     a minute read a ledger page in 15 s on row estimates of 1, 14 Oct). A live database is analysed as it grows; this local one is told now. */
  await sql(
    'ANALYZE journal_entry; ANALYZE journal_line; ANALYZE account_balance; ANALYZE party_item; ANALYZE catalogue_items; ANALYZE customer_list; ANALYZE chit_header; ANALYZE chit_status'
  );
  const facts = (
    await sql(
      `SELECT (SELECT count(*) FROM journal_line WHERE entity_id = $1)::int AS lines, (SELECT count(*) FROM journal_entry WHERE entity_id = $1)::int AS entries,
                                   (SELECT count(*) FROM party_item WHERE entity_id = $1)::int AS items, (SELECT count(*) FROM customer_list WHERE owner_entity_id = $1)::int AS parties,
                                   (SELECT count(*) FROM catalogue_items WHERE entity_id = $1)::int AS catalogue,
                                   (SELECT count(*) FROM (SELECT 1 FROM party_item WHERE entity_id = $1 GROUP BY party_id, against_ref HAVING SUM(amount_minor) <> 0) x)::int AS open_items`,
      [shopId]
    )
  ).rows[0];
  const cash = (await sql(`SELECT code FROM ledger_account WHERE entity_id = $1 AND role = 'cash'`, [shopId])).rows[0].code;
  const busy = (
    await sql(`SELECT party_id FROM journal_line WHERE entity_id = $1 AND party_id IS NOT NULL GROUP BY party_id ORDER BY count(*) DESC LIMIT 1`, [shopId])
  ).rows[0].party_id;
  const snap = await call('/api/till/snapshot');
  const since = new Date(Date.now() - 60 * 1000).toISOString();
  const fy = ctx.start,
    today = ctx.end;
  const rowsOf = (b) => {
    for (const k of ['entries', 'lines', 'rows', 'parties', 'chits', 'customers', 'items', 'list', 'cheques']) if (Array.isArray(b[k])) return b[k].length;
    return Array.isArray(b) ? b.length : null;
  };
  /* the clock back to the real one: the items' created_at are real moments, and /dues counts those on or before its day */
  CLOCK.reset();
  const p49 = await call('/api/chits/inbox?page=49&limit=20'),
    after49 = p49.b && p49.b.next;
  const READS = [
    /* [name, path, the array the rows are counted in] */
    ['Day book · one day (' + today + ')', '/api/books/daybook?from=' + today + '&to=' + today, 'entries'],
    ['Day book · FY (whole)', '/api/books/daybook?from=' + fy + '&to=' + today, 'entries'],
    ['Day book · FY, page 1 (limit 100)', '/api/books/daybook?from=' + fy + '&to=' + today + '&limit=100', 'entries'],
    ['Ledger · cash FY (whole)', '/api/books/ledger/' + cash + '?from=' + fy + '&to=' + today, 'lines'],
    ['Ledger · cash FY, page 1 (limit 100)', '/api/books/ledger/' + cash + '?from=' + fy + '&to=' + today + '&limit=100', 'lines'],
    ['Party statement · busiest', '/api/books/party/' + busy + '/statement', 'lines'],
    ['Trial balance', '/api/books/trial-balance', 'rows'],
    ['P&L', '/api/books/pl', null],
    ['Balance sheet', '/api/books/bs', null],
    ['Dues', '/api/books/dues', 'parties'],
    ['Cheques', '/api/books/cheques', 'cheques'],
    ['CRM list', '/api/crm/parties', 'parties'],
    ['Customers list', '/api/relationships/customers', 'customers'],
    ['Inbox p1', '/api/chits/inbox?page=1&limit=20', 'chits'],
    ['Inbox p50 (OFFSET)', '/api/chits/inbox?page=50&limit=20', 'chits'],
    ['Inbox p50 (keyset ?after)', '/api/chits/inbox?page=50&limit=20' + (after49 ? '&after=' + encodeURIComponent(after49) : ''), 'chits'],
    ['Till snapshot · full', '/api/till/snapshot', 'items'],
    ['Till snapshot · since', '/api/till/snapshot?since=' + encodeURIComponent(since), 'items']
  ];
  const out = [];
  for (const [name, p, key] of READS.filter((item) => !ctx.only || item[0].toLowerCase().indexOf(String(ctx.only).toLowerCase()) >= 0)) {
    const ms = [];
    let last = null;
    for (let index = 0; index < 20; index++) {
      last = await call(p);
      ms.push(last.ms);
      if (last.ms > 3000 || last.status >= 500) break;
    } /* a read past 3 s (or failing) is said once — 20 timeouts add nothing */
    out.push({
      name,
      status: last.status,
      n: ms.length,
      p50: pct(ms, 50),
      p95: pct(ms, 95),
      rows: key ? (Array.isArray(last.b[key]) ? last.b[key].length : null) : rowsOf(last.b),
      trips: last.trips,
      kb: Math.round(last.bytes / 1024)
    });
  }
  /* the proof on the real database: the cash ledger walked in pages of 500 = the whole ledger, line for line and balance for balance */
  if (!ctx.only) {
    const whole = await call('/api/books/ledger/' + cash + '?from=' + fy + '&to=' + today),
      list = [];
    let after = null,
      pages = 0;
    do {
      const r = await call('/api/books/ledger/' + cash + '?from=' + fy + '&to=' + today + '&limit=500' + (after ? '&after=' + encodeURIComponent(after) : ''));
      (r.b.lines || []).forEach((item) => list.push(item));
      after = r.b.next;
      pages++;
    } while (after && pages < 1000);
    const same =
      list.length === (whole.b.lines || []).length &&
      list.every((item, index) => item.running_minor === whole.b.lines[index].running_minor && item.ref === whole.b.lines[index].ref);
    console.log(
      '\n  ' +
        (same ? 'ok  ' : 'RED ') +
        ' cash ledger in ' +
        pages +
        ' pages of 500 = the whole ledger (' +
        list.length +
        ' lines, every running balance equal)'
    );
    if (!same) process.exitCode = 1;
  }
  const f = (x) => (x == null ? '—' : x < 10 ? x.toFixed(1) : String(Math.round(x)));
  console.log(
    '\n  scale ' +
      ctx.scale +
      ' · ' +
      facts.lines +
      ' journal lines · ' +
      facts.entries +
      ' entries · ' +
      facts.items +
      ' party items (' +
      facts.open_items +
      ' open) · ' +
      facts.parties +
      ' customers · ' +
      facts.catalogue +
      ' catalogue rows · snapshot ' +
      snap.status +
      '\n'
  );
  console.log('| read | HTTP | calls | p50 ms | p95 ms | rows | trips | KB |');
  console.log('|---|---|---|---|---|---|---|---|');
  out.forEach((item) =>
    console.log(
      '| ' +
        [item.name, item.status, item.n, f(item.p50), f(item.p95), item.rows == null ? '—' : item.rows, item.trips == null ? '—' : item.trips, item.kb].join(
          ' | '
        ) +
        ' |'
    )
  );
  return { facts, reads: out };
}

module.exports = { run, TARGETS };
