// routes/simulator.js — public showcase API for the /tour page (SimulatorPage).
//   GET  /api/simulator/content   → all narrative content (public, no auth)
//   POST /api/simulator/lead      → capture a lead, mint a lightweight JWT (gate)
//   POST /api/simulator/feedback  → capture page feedback
// Reads/writes the sim_* tables (migrations/sim01_simulator.sql) — SEPARATE from
// the legacy identities tables and the cb_* network tables.
const express = require('express');
const router = express.Router();
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
      html,
    });
  } catch (err) {
    console.error('[SIM] notify failed:', err.message);
  }
};

const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// GET /api/simulator/content — everything the page renders from.
router.get('/content', async (_req, res) => {
  try {
    const [layers, items, shapes, rules, compare, usps] = await Promise.all([
      query('SELECT * FROM sim_layers  ORDER BY ord'),
      query('SELECT * FROM sim_items   ORDER BY id'),
      query('SELECT * FROM sim_shapes  ORDER BY id'),
      query('SELECT * FROM sim_rules   ORDER BY ord'),
      query('SELECT * FROM sim_compare ORDER BY ord'),
      query('SELECT * FROM sim_usps    ORDER BY ord'),
    ]);
    res.json({
      layers: layers.rows,
      items: items.rows,
      shapes: shapes.rows,
      rules: rules.rows,
      compare: compare.rows,
      usps: usps.rows,
    });
  } catch (err) {
    console.error('[SIM] content error:', err.message);
    res.status(500).json({ error: 'Failed to load content', message: err.message });
  }
});

// POST /api/simulator/lead — the gate. { name, email, org? } → { token, leadId }.
router.post('/lead', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const org = String(req.body.org || '').trim() || null;
    if (name.length < 2 || !email.includes('@')) {
      return res.status(400).json({ error: 'A name and a valid email are required.' });
    }
    const ins = await query(
      'INSERT INTO sim_leads (name, email, org) VALUES ($1, $2, $3) RETURNING id',
      [name, email, org]
    );
    const leadId = ins.rows[0].id;
    const token = jwt.sign(
      { kind: 'sim_lead', leadId, email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_TTL || '7d' }
    );
    notify(
      `New tour lead: ${name}`,
      `<p><b>${esc(name)}</b> opened the tour.</p><p>Email: ${esc(email)}<br>Org: ${esc(org || '—')}</p>`
    );
    res.json({ token, leadId });
  } catch (err) {
    console.error('[SIM] lead error:', err.message);
    res.status(500).json({ error: 'Could not record that — please try again.' });
  }
});

// POST /api/simulator/feedback — { section, rating, message, leadId? }.
router.post('/feedback', async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'A message is required.' });
    const section = String(req.body.section || '').trim() || null;
    const rating = Number.isFinite(+req.body.rating) ? +req.body.rating : null;
    // leadId is a uuid from the gate; ignore anything that isn't one.
    const leadId = /^[0-9a-f-]{36}$/i.test(req.body.leadId || '') ? req.body.leadId : null;
    await query(
      'INSERT INTO sim_feedback (lead_id, section, rating, message) VALUES ($1, $2, $3, $4)',
      [leadId, section, rating, message]
    );
    notify(
      `Tour feedback (${section || 'page'}${rating ? `, ${rating}★` : ''})`,
      `<p>${esc(message)}</p><p>Section: ${esc(section || '—')} · Rating: ${rating || '—'} · Lead: ${esc(leadId || '—')}</p>`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[SIM] feedback error:', err.message);
    res.status(500).json({ error: 'Could not record that — please try again.' });
  }
});

module.exports = router;
