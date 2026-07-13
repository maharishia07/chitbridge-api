const express = require('express');
const router = express.Router();
const { query, withEntity } = require('../db');
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const storage = require('../lib/storage');

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB per file

// POST /api/attachments — { chit_id, message_id?, line_index?, name, mime, data_base64 }
// PER-ENTITY copies (b66): replicate one row per participant so each owns its own. Audience = all chit participants
// (from the caller's all_recipients), EXCEPT an internal-message attachment which stays single (author entity only).
router.post('/', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const { chit_id, message_id, line_index, name, mime, data_base64 } = req.body || {};
    if (!chit_id || !data_base64 || !name) return res.status(400).json({ error: 'Bad request', message: 'chit_id, name and data_base64 are required' });

    // caller must be a participant — and its own copy carries the full roster (all_recipients)
    const rosterRow = await withEntity(entity_id, (db) => db.query(
      `SELECT all_recipients FROM chit_header WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id]));
    if (!rosterRow.rows.length) return res.status(403).json({ error: 'Forbidden', message: 'Not a participant on this chit' });
    let participants = [...new Set((rosterRow.rows[0].all_recipients || []).map(r => r.entity_id).filter(Boolean))];
    if (!participants.includes(entity_id)) participants.push(entity_id);
    if (message_id) {   // an INTERNAL-message attachment stays private to its entity (single copy)
      const mv = await withEntity(entity_id, (db) => db.query(
        `SELECT visibility_entity_id FROM chit_messages WHERE message_id = $1 AND chit_id = $2 LIMIT 1`, [message_id, chit_id]));
      const vis = mv.rows[0] && mv.rows[0].visibility_entity_id;
      if (vis) participants = [vis];
    }

    const buffer = Buffer.from(String(data_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buffer.length === 0) return res.status(400).json({ error: 'Empty file' });
    if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'Too large', message: 'Max 6 MB per file' });

    const id = await storage.putForParticipants({
      chit_id, message_id: message_id || null, line_index: (line_index == null ? null : parseInt(line_index)),
      name: String(name).slice(0, 200), mime: String(mime || 'application/octet-stream').slice(0, 120),
      size: buffer.length, buffer, uploaded_by: req.identity.identity_id, participants, forEntity: entity_id
    });
    res.json({ id, name, mime: mime || 'application/octet-stream', size: buffer.length });
  } catch (err) {
    console.error('Attachment upload error:', err.message);
    res.status(500).json({ error: 'Upload failed', message: safeErr(err) });
  }
});

// GET /api/attachments/:id — stream the bytes (on demand). Participant-checked.
router.get('/:id', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    // PER-ENTITY: getBlob is entity-scoped (RLS) — it returns ONLY the caller's own copy, else nothing. No shared read.
    const a = await storage.getBlob(req.params.id, entity_id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    // S2 (reviewer 2026-07-13) — stored-XSS defence. The MIME is uploader-supplied, so we do NOT let the browser render
    // arbitrary types on our origin. Only image/* and application/pdf may render INLINE; everything else is forced to
    // DOWNLOAD (attachment). nosniff stops the browser second-guessing the declared type. A text/html payload can no
    // longer execute a script on the API origin.
    const rawMime = String(a.mime || 'application/octet-stream').toLowerCase();
    // NOTE: SVG is deliberately EXCLUDED — image/svg+xml can carry inline <script>, so it is forced to download.
    const renderable = /^image\/(png|jpe?g|gif|webp|bmp)$/.test(rawMime) || rawMime === 'application/pdf';
    const safeMime = renderable ? rawMime : 'application/octet-stream';
    const safeName = (a.name || 'file').replace(/[\r\n"\\]/g, '');
    res.setHeader('Content-Type', safeMime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `${renderable ? 'inline' : 'attachment'}; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(a.data);
  } catch (err) {
    console.error('Attachment fetch error:', err.message);
    res.status(500).json({ error: 'Fetch failed', message: safeErr(err) });
  }
});

module.exports = router;
