// routes/simulator.js — public showcase API for the /tour page (SimulatorPage).
//   GET  /api/simulator/content   → all narrative content (public, no auth)
//   POST /api/simulator/lead      → capture a lead, mint a lightweight JWT (gate)
//   POST /api/simulator/feedback  → capture page feedback
// Reads/writes the sim_* tables (migrations/sim01_simulator.sql) — SEPARATE from
// the legacy identities tables and the cb_* network tables.
// OWNS       the three PUBLIC routes of the /tour page (no sign-in): the content it renders, the lead gate, the page feedback.
// CALLED BY  server.js (mounted at /api/simulator, behind publicLimiter: 240 a minute per address) · the /tour page (SimulatorPage).
// FLOW       every route: its schema check (lib/simulator-contract.js) → the handler. A refusal or a fault → problem(req, res, ...), the old { error } kept beside the Problem fields
//            (docs/contracts/api-legacy.json); a 500 says only a fixed sentence. The e-mail to the leads inbox (notify) is best effort and never answers the visitor.
// CARD       qa/offline-guards
const express = require('express');
const router = express.Router();
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer
const { contract, words, faultOf, writeFaultOf } = require('../lib/simulator-contract'); // the contract (each route's operation), the words of a refusal and of a fault
const jwt = require('jsonwebtoken');
const { query } = require('../db');

// Reuse the existing Resend sender, fully guarded: never throws, no-ops without config.
// (Same pattern as routes/entities.js — notifications are best-effort, never block the request.)
const notify = async (subject, html) => {
  const to = process.env.LEADS_EMAIL || process.env.FROM_EMAIL;
  if (!process.env.RESEND_API_KEY || !to) {
    console.log(`[SIM] notify skipped (no RESEND/LEADS_EMAIL): ${subject}`);
    return;
  }
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'noreply@chitandbridge.com',
      to,
      subject,
      html
    });
  } catch (err) {
    console.error('[SIM] notify failed:', err.message);
  }
};

const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);

// GET /api/simulator/content — everything the page renders from.
router.get('/content', ...contract.checked('GET /content'), async (req, res) => {
  try {
    const [layers, items, shapes, rules, compare, usps] = await Promise.all([
      query('SELECT * FROM sim_layers  ORDER BY ord'),
      query('SELECT * FROM sim_items   ORDER BY id'),
      query('SELECT * FROM sim_shapes  ORDER BY id'),
      query('SELECT * FROM sim_rules   ORDER BY ord'),
      query('SELECT * FROM sim_compare ORDER BY ord'),
      query('SELECT * FROM sim_usps    ORDER BY ord')
    ]);
    res.json({
      layers: layers.rows,
      items: items.rows,
      shapes: shapes.rows,
      rules: rules.rows,
      compare: compare.rows,
      usps: usps.rows
    });
  } catch (err) {
    console.error('[SIM] content error:', err.message);
    problem(req, res, faultOf(err, req, 'Failed to load content'));
  }
});

// POST /api/simulator/lead — the gate. { name, email, org? } → { token, leadId }.
router.post('/lead', ...contract.checked('POST /lead'), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    const org = String(req.body.org || '').trim() || null;
    if (name.length < 2 || !email.includes('@')) {
      return problem(req, res, { status: 400, ...words.leadFieldsMissing() });
    }
    const ins = await query('INSERT INTO sim_leads (name, email, org) VALUES ($1, $2, $3) RETURNING id', [name, email, org]);
    const leadId = ins.rows[0].id;
    // S1 (reviewer 2026-07-13) — a marketing tour lead is NOT a platform credential. NEVER sign it with the identity
    // secret (JWT_SECRET) or it becomes a valid platform token. Use a SEPARATE secret so auth.js can never verify it.
    const SIM_SECRET = process.env.SIM_JWT_SECRET || (process.env.JWT_SECRET ? process.env.JWT_SECRET + '::sim-lead-v1' : 'sim-lead-dev-only');
    const token = jwt.sign({ kind: 'sim_lead', leadId, email }, SIM_SECRET, { expiresIn: process.env.JWT_TTL || '7d' });
    notify(`New tour lead: ${name}`, `<p><b>${esc(name)}</b> opened the tour.</p><p>Email: ${esc(email)}<br>Org: ${esc(org || '—')}</p>`);
    res.json({ token, leadId });
  } catch (err) {
    console.error('[SIM] lead error:', err.message);
    problem(req, res, writeFaultOf(err, req));
  }
});

// POST /api/simulator/feedback — { section, rating, message, leadId? }.
router.post('/feedback', ...contract.checked('POST /feedback'), async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return problem(req, res, { status: 400, ...words.messageMissing() });
    const section = String(req.body.section || '').trim() || null;
    const rating = Number.isFinite(+req.body.rating) ? +req.body.rating : null;
    // leadId is a uuid from the gate; ignore anything that isn't one.
    const leadId = /^[0-9a-f-]{36}$/i.test(req.body.leadId || '') ? req.body.leadId : null;
    await query('INSERT INTO sim_feedback (lead_id, section, rating, message) VALUES ($1, $2, $3, $4)', [leadId, section, rating, message]);
    notify(
      `Tour feedback (${section || 'page'}${rating ? `, ${rating}★` : ''})`,
      `<p>${esc(message)}</p><p>Section: ${esc(section || '—')} · Rating: ${rating || '—'} · Lead: ${esc(leadId || '—')}</p>`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[SIM] feedback error:', err.message);
    problem(req, res, writeFaultOf(err, req));
  }
});

router.openapi = { paths: contract.pathsOf(), schemas: {} };

module.exports = router;
