/* fixture — a route file: a route calling a lib function (which writes a table), one with its own SQL, one nobody calls */
'use strict';
const router = { get() {}, post() {} };
const db = { query() {} };
const pay = require('../lib/pay');
const { round } = require('../lib/money');

router.post('/payments', async (req, res) => {
  const r = await pay.post(req.body, round);
  const s = await db.query('SELECT status FROM books_setting WHERE entity_id = $1', [1]);
  if (!r) return res.status(409).json({ code: 'PAY_REFUSED' });
  res.json({ ok: true, r, s });
});

router.get('/status', async (req, res) => {
  const s = await db.query('SELECT enabled FROM books_setting WHERE entity_id = $1', [1]);
  res.json({ ok: true, s });
});

router.get('/never', async (req, res) => {
  res.json({ ok: true, says: 'no screen calls me, no test fires me' });
});

router.get('/orphan', async (req, res) => {
  const s = await db.query('SELECT 1 FROM orphan_table');
  res.json({ ok: true, s });
});

module.exports = router;
