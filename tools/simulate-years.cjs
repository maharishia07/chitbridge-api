/**
 * tools/simulate-years.cjs — THREE YEARS OF A SHOP'S LIFE IN SECONDS (round Y1; Athi 2026-10-10: "3 year testing?").
 *
 * A fresh shop with the ledger on, then three financial years — daily cash / UPI / credit sales, supplier purchases, expenses, month
 * GST close + month lock, and the year close — every day driven by lib/shop-clock.js (set, never waited for). It runs on the in-memory
 * store (tests/support/books-harness.cjs) through the real routes/books.js, so it NEEDS NO DATABASE and cannot touch the live one.
 * The morning sweep runs it (`node tools/simulate-years.cjs`) beside the local stack; pointing it at the stack's Postgres is one loader.
 *
 * After EACH year it checks, one report line each — red names the ledger and the day:
 *   1 opening of the next year = closing of this one, to the paisa, every balance-sheet ledger
 *   2 the year's profit moved into capital (3900) and no income/expense ledger is carried
 *   3 every month summary (account_balance, period figures) = the sum of its days (what this script posted, day by day)
 *   4 voucher series: gap-free 1..n inside each financial year, a NEW series (restart at 1) on the first day of the next year
 *   5 the trial balance balances, at every month end and at the year end
 * Then the KNOWN FAULT: chit_header.created_at is timezone-naive — sales at 23:55 and 00:05 IST across a day boundary, and SAY which day each landed on.
 *
 * node tools/simulate-years.cjs [--years 3] [--seed 7] [--json]      exit 1 when any line is RED (a FINDING is reported, never silent, and does not fail)
 * The days themselves come from tools/sim-plan.cjs (Y1b) — tools/sim-load.cjs loads the SAME plan into a local Postgres.
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path'),
  http = require('http'),
  express = require('express');
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const YEARS = Number(arg('years', 3)),
  SEED = Number(arg('seed', 7)),
  AS_JSON = process.argv.includes('--json');

const H = require(path.join(__dirname, '..', 'tests', 'support', 'books-harness.cjs'));
const SHOP = '11111111-1111-4111-8111-111111111111',
  CUST = '22222222-2222-4222-8222-222222222222',
  SUPP = '33333333-3333-4333-8333-333333333333';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Simulated Stores' };
const authStub = Object.assign(
  (req, res, next) => {
    req.identity = OWNER;
    next();
  },
  { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() }
);

const REPORT = [];
const line = (status, name, detail) => {
  REPORT.push({ status, name, detail: detail || '' });
  if (!AS_JSON) console.log((status === 'ok' ? '   ok      ' : status === 'FINDING' ? '   FINDING ' : '   RED     ') + name + (detail ? ' — ' + detail : ''));
};
const check = (name, cond, detail) => line(cond ? 'ok' : 'RED', name, cond ? '' : detail);

/* ⭐ Y1b: the days come from tools/sim-plan.cjs — the SAME plan tools/sim-load.cjs loads into a database, so the two agree on every count */
const PLAN_LIB = require(path.join(__dirname, 'sim-plan.cjs'));
const PLAN = PLAN_LIB.planDays({ start: '2026-04-01', years: YEARS, seed: SEED });
const dayAdd = PLAN_LIB.dayAdd;
const IST = (d, hh, mm) => d + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00+05:30';
const fyOf = (d) => {
  const y = +d.slice(0, 4),
    m = +d.slice(5, 7),
    s = m >= 4 ? y : y - 1;
  return s + '-' + String((s + 1) % 100).padStart(2, '0');
};
const monthNo = (d) => ((+d.slice(5, 7) + 8) % 12) + 1; /* Apr = 1 … Mar = 12 */
const rup = (minor) => (minor / 100).toFixed(2);

(async () => {
  const X = H.load({ auth: authStub });
  if (!X.src.dir) {
    console.log('SKIP: ' + X.src.why);
    process.exit(0);
  }
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock'));
  const app = express();
  app.use(express.json());
  app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0),
    port = srv.address().port;
  const q = (m, p, body) =>
    new Promise((done) => {
      const b = JSON.stringify(body || {});
      const r = http.request(
        { host: '127.0.0.1', port, path: '/api/books' + p, method: m, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            let j = {};
            try {
              j = JSON.parse(raw || '{}');
            } catch (_) {}
            done({ status: res.statusCode, body: j });
          });
        }
      );
      r.end(b);
    });
  const T = X.T;
  const codeOfRole = (role) => (T.accounts.find((item) => item.entity_id === SHOP && item.role === role) || {}).code;
  const nameOfCode = (c) => {
    const a = T.accounts.find((x) => x.entity_id === SHOP && String(x.code) === String(c));
    return a ? c + ' ' + a.name : String(c);
  };
  const codeOfId = (id) => (T.accounts.find((item) => item.account_id === id) || {}).code;
  const entryOf = new Map(); /* entry_id → entry, built lazily for the line scans */
  const entryById = (id) => {
    if (!entryOf.has(id)) {
      const e = T.entries.find((x) => x.entry_id === id);
      if (e) entryOf.set(id, e);
    }
    return entryOf.get(id);
  };

  const START = PLAN.start,
    LAST = PLAN.last;
  CLOCK.set(IST(START, 9, 0));
  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  check('the ledger switches on', (await q('POST', '/enable', {})).body.ok === true);
  T.parties.push(
    { owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 },
    { owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 }
  );
  const op = await q('POST', '/opening', {
    date: START,
    rows: [
      { code: codeOfRole('cash'), dr_minor: 50000000 },
      { code: codeOfRole('capital') || '3000', cr_minor: 50000000 }
    ]
  });
  check('opening balances (cash 5,00,000 against capital) post', op.status === 200 && op.body.suspense_minor === 0, JSON.stringify(op.body));

  /* what this script posted, day by day — the "sum of its days" the summaries are checked against */
  const DAYS = new Map(); /* day → { taxable_minor, total_minor, n } of the SALES posted that day */
  const dayRow = (d) => {
    if (!DAYS.has(d)) DAYS.set(d, { taxable_minor: 0, total_minor: 0, n: 0 });
    return DAYS.get(d);
  };
  const sale = (s) => {
    const half = (s.taxable * s.rate) / 100 / 2;
    return { taxable: s.taxable, half, total: s.taxable + half * 2, rate: s.rate };
  }; /* a planned sale's tax halves (one rule, sim-plan) */
  let posted = 0,
    refused = 0;
  const post = async (d, ev, asSale) => {
    try {
      const r = await X.B.postEntry(X.db, SHOP, Object.assign({ date: d, currency: 'INR' }, ev));
      if (r && r.ok) {
        posted++;
        if (asSale) {
          const row = dayRow(d);
          row.taxable_minor += Math.round(asSale.taxable * 100);
          row.total_minor += Math.round(asSale.total * 100);
          row.n++;
        }
        return r;
      }
      refused++;
      line('RED', 'a posting was refused on ' + d, JSON.stringify(r));
      return r;
    } catch (e) {
      refused++;
      line('RED', 'a posting threw on ' + d, String(e && e.message));
      return null;
    }
  };

  const tbNet = async (asOf) => {
    /* code → net (Dr positive) from the trial balance route */
    const r = await q('GET', '/trial-balance?asOf=' + asOf),
      lookup = new Map();
    (r.body.rows || []).forEach((x) => lookup.set(String(x.code), x.dr_minor - x.cr_minor));
    return { m: lookup, balanced: r.body.balanced, dr: r.body.total_dr_minor, cr: r.body.total_cr_minor };
  };
  const salesCode = () => String(codeOfRole('sales') || '4000');

  const reportYear = async (fy, lastDay) => {
    const nextFirst = dayAdd(lastDay, 1),
      nextFy = fyOf(nextFirst);
    /* 1 + 2 · opening = closing; profit → capital */
    const close = await tbNet(lastDay),
      open = await tbNet(nextFirst);
    check(
      fy + ' · trial balance balances at year end (' + rup(close.dr) + ' Dr = ' + rup(close.cr) + ' Cr)',
      close.balanced === true,
      'Dr ' + close.dr + ' vs Cr ' + close.cr
    );
    check(nextFy + ' · opening trial balance balances', open.balanced === true, 'Dr ' + open.dr + ' vs Cr ' + open.cr);
    let profit = 0;
    close.m.forEach((item, index) => {
      if (/^[4-9]/.test(index)) profit -= item;
    }); /* income is Cr (negative net) → profit positive */
    const wrong = [];
    close.m.forEach((item, index) => {
      if (/^[4-9]/.test(index)) return;
      const want = index === '3900' ? item - profit : item,
        got = open.m.get(index) || 0;
      if (got !== want) wrong.push(nameOfCode(index) + ' closed ' + rup(want) + ' but opened ' + rup(got));
    });
    open.m.forEach((item, index) => {
      if (!close.m.has(index) && item !== 0 && index !== '3900') wrong.push(nameOfCode(index) + ' appeared at opening with ' + rup(item));
    });
    check(fy + ' → ' + nextFy + ' · opening = last closing, to the paisa (' + close.m.size + ' ledgers)', !wrong.length, wrong.slice(0, 5).join(' · '));
    const capWant = (close.m.get('3900') || 0) - profit;
    check(
      fy + ' · profit ' + rup(profit) + ' moved into capital (3900)',
      (open.m.get('3900') || 0) === capWant,
      '3900 opened ' + rup(open.m.get('3900') || 0) + ', expected ' + rup(capWant)
    );
    const carried = [...open.m.keys()].filter((item) => /^[4-9]/.test(item) && open.m.get(item) !== 0);
    check(fy + ' · no income/expense ledger is carried into ' + nextFy, !carried.length, carried.map(nameOfCode).join(', '));
  };

  const verifySummaries = async (fy) => {
    /* 3 · every summary = the sum of its days */
    const sums = new Map(),
      perMonthSales = new Map();
    T.lines.forEach((item) => {
      const en = entryById(item.entry_id);
      if (!en || en.fiscal_year !== fy) return;
      const c = codeOfId(item.account_id),
        k = c + '|' + en.period,
        s = sums.get(k) || { dr: 0, cr: 0 };
      s.dr += item.dr_minor || 0;
      s.cr += item.cr_minor || 0;
      sums.set(k, s);
      if (c === salesCode()) perMonthSales.set(Number(en.period), (perMonthSales.get(Number(en.period)) || 0) + (item.cr_minor || 0) - (item.dr_minor || 0));
    });
    const list = [];
    T.balances.forEach((item) => {
      if (item.fiscal_year !== fy || item.party_key !== X.store.ZERO) return;
      const c = codeOfId(item.account_id),
        s = sums.get(c + '|' + item.period) || { dr: 0, cr: 0 };
      if (s.dr !== item.dr_minor || s.cr !== item.cr_minor)
        list.push(
          nameOfCode(c) + ' month ' + item.period + ': summary ' + rup(item.dr_minor) + '/' + rup(item.cr_minor) + ' ≠ its lines ' + rup(s.dr) + '/' + rup(s.cr)
        );
    });
    check(fy + ' · every month summary (account_balance) = the sum of its entries’ lines', !list.length, list.slice(0, 4).join(' · '));
    /* the days this script posted, summed by month, against the Sales ledger and the period figures */
    const days = new Map(),
      lookup = new Map();
    DAYS.forEach((item, index) => {
      if (fyOf(index) !== fy) return;
      const m = monthNo(index);
      days.set(m, (days.get(m) || 0) + item.taxable_minor);
      lookup.set(m, (lookup.get(m) || 0) + item.total_minor);
    });
    const sbad = [];
    days.forEach((item, index) => {
      if ((perMonthSales.get(index) || 0) !== item)
        sbad.push('Sales month ' + index + ': ledger ' + rup(perMonthSales.get(index) || 0) + ' vs the days ' + rup(item));
    });
    check(fy + ' · Sales (' + salesCode() + ') each month = the sum of the days posted into it', !sbad.length, sbad.join(' · '));
    const fig = await X.store.periodFigures(X.db, SHOP, fy),
      fbad = [];
    fig.forEach((item) => {
      if (item.period > 0 && (lookup.get(item.period) || 0) !== item.sales_minor)
        fbad.push('month ' + item.period + ': figure ' + rup(item.sales_minor) + ' vs the days ' + rup(lookup.get(item.period) || 0));
    });
    check(fy + ' · month figures (sales) = the sum of their days', !fbad.length, fbad.join(' · '));
  };

  const verifyVouchers = (fy) => {
    /* 4 · gap-free per series inside the year, every number carrying the year */
    const by = new Map();
    T.entries
      .filter((e) => e.fiscal_year === fy)
      .forEach((e) => {
        const list = by.get(e.series) || [];
        list.push(e);
        by.set(e.series, list);
      });
    const list = [];
    by.forEach((arr, series) => {
      const n = (e) => Number(String(e.entry_no).split('/').pop()),
        sorted = arr.slice().sort((first, second) => n(first) - n(second));
      if (!arr.every((e) => String(e.entry_no).indexOf('/' + fy + '/') > 0)) list.push(series + ' has a number outside /' + fy + '/');
      for (let index = 0; index < sorted.length; index++)
        if (n(sorted[index]) !== index + 1) {
          list.push(series + ' gap: expected ' + (index + 1) + ' got ' + n(sorted[index]) + ' (' + sorted[index].doc_date + ')');
          break;
        }
    });
    check(fy + ' · voucher series gap-free from 1, every number carries ' + fy + ' (' + [...by.keys()].join(' ') + ')', !list.length, list.join(' · '));
  };

  const closeMonth = async (pd) => {
    const pfy = fyOf(pd),
      pm = monthNo(pd);
    const g = await q('POST', '/gst/close', { fy: pfy, period: pm });
    if (g.status !== 200) line('RED', 'GST close of ' + pfy + ' month ' + pm + ' refused', JSON.stringify(g.body).slice(0, 200));
    const tb = await tbNet(pd);
    if (!tb.balanced) line('RED', 'trial balance out of balance at the end of ' + pd, 'Dr ' + tb.dr + ' Cr ' + tb.cr);
    const lk = await q('POST', '/periods/' + pfy + '/' + pm + '/lock', { reason: 'month done' });
    if (lk.status !== 200) line('RED', 'lock of ' + pfy + ' month ' + pm + ' refused', JSON.stringify(lk.body).slice(0, 200));
    if (pm === 12) {
      /* the year has ended: close it, then the year-end checks */
      const yc = await q('POST', '/year/' + pfy + '/close', {});
      check(pfy + ' · year close accepted', yc.status === 200 && yc.body.ok === true, JSON.stringify(yc.body).slice(0, 240));
      await reportYear(pfy, pd);
      await verifySummaries(pfy);
      verifyVouchers(pfy);
    }
  };

  /* ── the days ── */
  let daysRun = 0,
    sales = 0;
  for (const row of PLAN.days) {
    const day = row.day;
    CLOCK.set(IST(day, 12, 0));
    const d = CLOCK.bizDay(undefined, 'IN'); /* the shop's day, from the clock */
    if (d !== day) line('RED', 'the clock and the loop disagree on ' + day, 'clock says ' + d);
    if (d.slice(8) === '01' && d !== START) await closeMonth(dayAdd(d, -1)); /* the month just ended: GST set-off, lock, and at March the year close */

    for (let index = 0; index < row.sales.length; index++) {
      const s = sale(row.sales[index]),
        how = row.sales[index].how;
      const ev = {
        type: 'sale_bill',
        source_ref: 'sim:' + d + ':s:' + index,
        by_rate: [{ rate: s.rate, taxable: s.taxable, cgst: s.half, sgst: s.half, igst: 0 }],
        round_off: 0
      };
      if (how === 'credit') {
        ev.party = CUST;
        ev.paid = {};
      } else ev.paid = { [how]: s.total };
      await post(d, ev, s);
      sales++;
    }
    if (row.purchase) {
      const p = sale({ rate: 18, taxable: row.purchase.taxable });
      await post(d, {
        type: 'purchase_bill',
        party: SUPP,
        source_ref: 'sim:' + d + ':p',
        by_rate: [{ rate: 18, taxable: p.taxable, cgst: p.half, sgst: p.half, igst: 0 }],
        paid: row.purchase.paid_bank ? { bank: p.total } : {},
        round_off: 0
      });
    }
    if (row.expense) await post(d, { type: 'expense', class: row.expense.class, amount: row.expense.amount, paid_from: 'cash', source_ref: 'sim:' + d + ':e' });
    if (row.rent) await post(d, { type: 'expense', class: 'rent', amount: 20000, paid_from: 'bank', source_ref: 'sim:' + d + ':rent' });
    daysRun++;
  }
  /* the last month and the last year: the clock passes the end, then the same close */
  CLOCK.set(IST(dayAdd(LAST, 1), 9, 0));
  await closeMonth(LAST);
  {
    const first = dayAdd(LAST, 1),
      nfy = fyOf(first); /* the new year starts its own series at 1 */
    const r = await post(first, { type: 'expense', class: 'fuel', amount: 10, paid_from: 'cash', source_ref: 'sim:newyear' });
    check(
      'the first entry of ' + nfy + ' is PY/' + nfy + '/000001 — a new series on the first day',
      !!r && r.entry_no === 'PY/' + nfy + '/000001',
      'got ' + (r && r.entry_no)
    );
  }
  check('all ' + posted + ' postings over ' + daysRun + ' days were accepted (' + YEARS + ' years)', refused === 0, refused + ' refused');

  /* ── THE KNOWN FAULT: chit_header.created_at is TIMESTAMP (no zone) ──
     The ledger's own day comes from the clock: a sale at 23:55 and one at 00:05 IST land on the right two days (shown first). The chit's
     created_at is a naive wall-clock string: node-pg reads it in the PROCESS zone (pg-types 1114 → new Date(y,m,d,h,mi,s)), then dayOf() cuts the IST day.
     Modelled for each (database zone, server zone): which day each sale's chit lands on, against the day it should. */
  {
    const D = '2027-08-10',
      moments = [
        ['23:55 IST', IST(D, 23, 55), D],
        ['00:05 IST', IST(dayAdd(D, 1), 0, 5), dayAdd(D, 1)]
      ];
    for (const [lbl, iso, want] of moments) {
      CLOCK.set(iso);
      const got = CLOCK.bizDay(undefined, 'IN');
      check('the shop clock puts a ' + lbl + ' sale on ' + want + ' (the ledger path)', got === want, 'landed on ' + got);
    }
    const OFF = { UTC: 0, IST: 330 };
    const wall = (iso, dbZone) => new Date(Date.parse(iso) + OFF[dbZone] * 60000).toISOString().slice(0, 19); /* what NOW() stores in a TIMESTAMP */
    const readBack = (w, nodeZone) => new Date(Date.parse(w + 'Z') - OFF[nodeZone] * 60000); /* how node-pg parses it (local zone) */
    const scen = [
      ['live: database UTC, server UTC', 'UTC', 'UTC'],
      ['dev PC: database UTC (docker), server IST (Windows)', 'UTC', 'IST'],
      ['database IST, server UTC', 'IST', 'UTC']
    ];
    const KH = require(path.join(H.API, 'lib', 'books-hooks'));
    for (const [name, dbz, nodez] of scen)
      for (const [lbl, iso, want] of moments) {
        const landed = KH.dayOf(readBack(wall(iso, dbz), nodez), 'IN');
        line(
          landed === want ? 'ok' : 'FINDING',
          'chit_header.created_at · ' + name + ' · sale at ' + lbl + ' → lands on ' + landed + ' (should be ' + want + ')',
          landed === want
            ? ''
            : 'the chit is counted in the wrong day’s close — DECISIONS "day-close breaks past midnight"; fix: created_at as timestamptz (a b-migration, owner to run)'
        );
      }
  }
  CLOCK.reset();
  srv.close();
  const red = REPORT.filter((item) => item.status === 'RED').length,
    finds = REPORT.filter((item) => item.status === 'FINDING').length;
  if (AS_JSON)
    console.log(JSON.stringify({ years: YEARS, seed: SEED, posted, sales, plan: PLAN_LIB.countOf(PLAN), red, findings: finds, report: REPORT }, null, 1));
  else
    console.log(
      '\n  ' +
        (red ? '✗ ' + red + ' RED' : '✓ all green') +
        ' · ' +
        REPORT.length +
        ' lines · ' +
        finds +
        ' finding(s) · ' +
        posted +
        ' postings (' +
        sales +
        ' bills) · ' +
        YEARS +
        ' years\n'
    );
  process.exit(red ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
