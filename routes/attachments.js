const express = require('express');
const router = express.Router();
const { query } = require('../db');
const auth = require('../middleware/auth');
const { safeErr } = require('../lib/respond');
const storage = require('../lib/storage');

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB per file

// is the caller a participant on this chit (any copy)?
async function isParticipant(chit_id, entity_id) {
  if (!chit_id) return false;
  const r = await query(`SELECT 1 FROM chit_status WHERE chit_id = $1 AND entity_id = $2 LIMIT 1`, [chit_id, entity_id]);
  return r.rows.length > 0;
}

// POST /api/attachments — { chit_id, message_id?, line_index?, name, mime, data_base64 }
// Upload AFTER the chit/message exists; links by chit_id (+ message_id/line_index). On-demand fetch via GET below.
router.post('/', auth, async (req, res) => {
  try {
    const entity_id = req.identity.parent_entity_id || req.identity.identity_id;
    const { chit_id, message_id, line_index, name, mime, data_base64 } = req.body || {};
    if (!chit_id || !data_base64 || !name) return res.status(400).json({ error: 'Bad request', message: 'chit_id, name and data_base64 are required' });
    if (!(await isParticipant(chit_id, entity_id))) return res.status(403).json({ error: 'Forbidden', message: 'Not a participant on this chit' });

    const buffer = Buffer.from(String(data_base64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buffer.length === 0) return res.status(400).json({ error: 'Empty file' });
    if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'Too large', message: 'Max 6 MB per file' });

    const id = await storage.put({
      chit_id, message_id: message_id || null, line_index: (line_index == null ? null : parseInt(line_index)),
      name: String(name).slice(0, 200), mime: String(mime || 'application/octet-stream').slice(0, 120),
      size: buffer.length, buffer, uploaded_by: req.identity.identity_id
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
    const a = await storage.getBlob(req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!(await isParticipant(a.chit_id, entity_id))) return res.status(403).json({ error: 'Forbidden' });
    res.setHeader('Content-Type', a.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(a.name || 'file').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(a.data);
  } catch (err) {
    console.error('Attachment fetch error:', err.message);
    res.status(500).json({ error: 'Fetch failed', message: safeErr(err) });
  }
});

module.exports = router;
