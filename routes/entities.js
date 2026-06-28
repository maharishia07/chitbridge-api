// routes/entities.js — Entity registration, login, search
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');
const { verifyOtp } = require('../lib/otp');   // per-account OTP attempt cap
const { sendOtpEmail } = require('../lib/notify');   // shared OTP email sender (F2 — extracted from here)

const generateBridgeId = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'CB';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

// DEV_OTP in Railway env = fixed OTP for testing e.g. 123456
// No DEV_OTP = random 6-digit OTP
const generateOTP = () => (process.env.DEV_OTP || '').trim() || Math.floor(100000 + Math.random() * 900000).toString();

// (F2) The OTP email sender now lives in lib/notify.js (`sendOtpEmail`), shared with the customer order flow.

// POST /entities/register
// Accepts email (athi@test.com) OR display name (Athi) for entity login
router.post('/register',
  [
    body('display_name').optional().trim().isLength({ min: 2, max: 255 }),
    body('email').trim().isLength({ min: 2 }).withMessage('Username required'),
  ],
  validate,
  async (req, res) => {
    try {
      const input = req.body.email.trim();
      const isEmail = input.includes('@');

      let email, display_name, identity_id, bridge_id;

      if (isEmail) {
        // Email login — existing flow
        email = input.toLowerCase();
        display_name = sanitise(req.body.display_name || input);

        const existing = await query(
          'SELECT identity_id, bridge_id FROM identities WHERE email = $1',
          [email]
        );

        if (existing.rows.length > 0) {
          identity_id = existing.rows[0].identity_id;
          bridge_id = existing.rows[0].bridge_id;
          console.log(`Existing entity login: ${email}`);
        } else if (req.body.mode === 'login') {
          return res.status(400).json({
            error: 'Not registered',
            message: 'No account found — please register first'
          });
        } else {
          bridge_id = generateBridgeId();
          identity_id = uuidv4();
          await query(
            `INSERT INTO identities (identity_id, bridge_id, display_name, email, identity_type, status)
             VALUES ($1, $2, $3, $4, 'entity', 'pending')`,
            [identity_id, bridge_id, display_name, email]
          );
          console.log(`New entity registered: ${display_name} / ${bridge_id}`);
        }
      } else {
        // Display name login — look up entity by name
        const found = await query(
          `SELECT identity_id, bridge_id, email, display_name FROM identities
           WHERE LOWER(display_name) = LOWER($1)
           AND identity_type = 'entity'
           AND status = 'active'`,
          [input]
        );
        if (found.rows.length === 0) {
          return res.status(400).json({
            error: 'Not found',
            message: 'Entity not found — check your name or use your email address'
          });
        }
        identity_id   = found.rows[0].identity_id;
        bridge_id     = found.rows[0].bridge_id;
        email         = found.rows[0].email;
        display_name  = found.rows[0].display_name;
        console.log(`Display name login: ${display_name} → ${email}`);
      }

      const otp = generateOTP();
      const expires = new Date(Date.now() + 60 * 60 * 1000);

      await query(
        `UPDATE identities SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0 WHERE identity_id = $3`,
        [otp, expires, identity_id]
      );

      // F2-entity: gate dev_otp on the sender's `dev` flag (false in production) so the OTP is NEVER returned in
      // a prod response. Soft message on a real send failure so we don't report success on failure.
      const sent = await sendOtpEmail(email, display_name, otp);
      res.json({
        message: sent.delivered ? 'Verification code sent to your email'
               : sent.dev       ? 'Dev mode — verification code issued'
               :                  "We couldn't send your code — please try again.",
        email,
        ...(sent.dev && { dev_otp: otp })   // dev/dormant only — NEVER in production
      });

    } catch (err) {
      console.error('Register error:', err.message);
      res.status(500).json({ error: 'Registration failed', message: safeErr(err) });
    }
  }
);

// POST /entities/verify
router.post('/verify',
  [
    body('email').trim().isEmail().normalizeEmail(),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate,
  async (req, res) => {
    try {
      const email = req.body.email.toLowerCase().trim();
      const otp = req.body.otp.trim();

      const result = await query(
        `SELECT identity_id, bridge_id, display_name, email, otp_code, otp_expires_at, otp_attempts, owner_scope
         FROM identities WHERE email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Verification failed', message: 'Email not found — please register first' });
      }

      const identity = result.rows[0];

      const otpCheck = await verifyOtp(query, identity, otp);
      if (!otpCheck.ok) {
        return res.status(otpCheck.status).json({ error: 'Verification failed', message: otpCheck.message });
      }

      await query(
        `UPDATE identities SET email_verified = TRUE, status = 'active',
         otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0, last_active_at = NOW()
         WHERE identity_id = $1`,
        [identity.identity_id]
      );

      // 7 days JWT — longer session for testing
      const token = jwt.sign(
        { identity_id: identity.identity_id, bridge_id: identity.bridge_id,
          display_name: identity.display_name, email: identity.email, identity_type: 'entity',
          owner_scope: identity.owner_scope || 'entity' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      console.log(`Entity verified: ${identity.display_name}`);

      res.json({
        message: 'Verified successfully',
        token,
        entity: {
          identity_id: identity.identity_id,
          bridge_id: identity.bridge_id,
          display_name: identity.display_name,
          email: identity.email
        }
      });

    } catch (err) {
      console.error('Verify error:', err.message);
      res.status(500).json({ error: 'Verification failed', message: safeErr(err) });
    }
  }
);

// GET /entities/search
router.get('/search', auth, async (req, res) => {
  try {
    const q = sanitise(req.query.q || '');
    if (q.length < 2) {
      return res.status(400).json({ error: 'Search query too short', message: 'Enter at least 2 characters' });
    }
    const result = await query(
      `SELECT identity_id, bridge_id, display_name, created_at
       FROM identities
       WHERE (LOWER(display_name) LIKE LOWER($1) OR LOWER(bridge_id) LIKE LOWER($1))
       AND identity_type = 'entity' AND status = 'active'
       AND identity_id != $2
       ORDER BY display_name LIMIT 10`,
      [`%${q}%`, req.identity.identity_id]
    );
    res.json({ results: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed', message: safeErr(err) });
  }
});

// GET /entities/me
router.get('/me', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT identity_id, bridge_id, display_name, email, user_id, self_copy_pref, dispute_handler_actor_id, country, currency_code, created_at, last_active_at,
              gstn, is_verified, logo_url, address, business_status
       FROM identities WHERE identity_id = $1`,
      [req.identity.identity_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entity not found' });
    await query('UPDATE identities SET last_active_at = NOW() WHERE identity_id = $1', [req.identity.identity_id]);
    res.json({ entity: result.rows[0] });
  } catch (err) {
    console.error('Profile error:', err.message);
    res.status(500).json({ error: 'Failed to get profile', message: safeErr(err) });
  }
});

// GET /entities/lookup?user_id=<x> — resolve an entity by its external user_id (ATH-114).
// The resolution primitive for adding suppliers / connecting by user_id instead of bridge_id.
router.get('/lookup', auth, async (req, res) => {
  try {
    const uid = String(req.query.user_id || '').trim();
    if (!uid) return res.status(400).json({ error: 'Missing user_id', message: 'Provide ?user_id=' });
    const result = await query(
      `SELECT identity_id, bridge_id, display_name, user_id
         FROM identities
        WHERE LOWER(user_id) = LOWER($1) AND status = 'active' AND identity_type = 'entity'`,
      [uid]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found', message: 'No entity with that user_id' });
    res.json({ entity: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed', message: safeErr(err) });
  }
});

// PATCH /entities/profile — set shop GSTN / logo / address (B3.9) + external user_id (ATH-114)
router.patch('/profile', auth,
  [ body('gstn').optional().trim().isLength({ max: 15 }),
    body('logo_url').optional().trim(),
    body('address').optional().trim(),
    body('business_status').optional().isIn(['open','closed','away']),
    body('self_copy_pref').optional().isIn(['both','sent','received']),
    body('dispute_handler_actor_id').optional().isUUID(),
    body('user_id').optional().trim().custom(v => {
      if (v === '') return true;
      const ok = v.includes('@') ? /\S+@\S+\.\S+/.test(v) : v.length >= 8;
      if (!ok) throw new Error('user_id must be 8+ characters or a valid email');
      return true;
    }) ],
  validate,
  async (req, res) => {
    try {
      const id = req.identity.identity_id;
      // user_id is unique (idx_identities_user_id is case-insensitive); store as given, dedupe by LOWER().
      const userId = (req.body.user_id !== undefined && String(req.body.user_id).trim() !== '')
        ? String(req.body.user_id).trim() : null;
      // dispute_handler must be one of MY OWN actors — never an arbitrary identity.
      const handler = req.body.dispute_handler_actor_id || null;
      if (handler) {
        const ok = await query(
          `SELECT 1 FROM identities WHERE identity_id=$1 AND identity_type='actor' AND parent_entity_id=$2`,
          [handler, id]);
        if (!ok.rows.length) return res.status(400).json({ error: 'Bad handler', message: 'dispute_handler_actor_id must be an actor under your entity' });
      }
      await query(
        `UPDATE identities SET gstn=COALESCE($1,gstn), logo_url=COALESCE($2,logo_url), address=COALESCE($3,address),
                business_status=COALESCE($4,business_status), user_id=COALESCE($5,user_id),
                self_copy_pref=COALESCE($6,self_copy_pref),
                dispute_handler_actor_id=COALESCE($7,dispute_handler_actor_id)
         WHERE identity_id=$8`,
        [req.body.gstn || null, req.body.logo_url || null, req.body.address || null,
         req.body.business_status || null, userId, req.body.self_copy_pref || null, handler, id]);
      res.json({ message: 'Profile updated' });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Taken', message: 'That user_id is already in use' });
      res.status(500).json({ error: 'Profile update failed', message: safeErr(err) });
    }
  });

// PATCH /entities/:id/erase — mark an identity erased (tombstone). Platform-scope only.
// Full PII-redaction sweep is a separate ops routine; this just flips the markers.
router.patch('/:id/erase', auth, async (req, res) => {
  if (req.identity.owner_scope !== 'platform') return res.status(403).json({ error: 'Forbidden' });
  try {
    await query(`UPDATE identities SET is_erased=true, erased_at=NOW(), status='erased' WHERE identity_id=$1`, [req.params.id]);
    res.json({ message: 'Identity tombstoned', id: req.params.id });
  } catch (err) { res.status(500).json({ error: 'Erase failed', message: safeErr(err) }); }
});

module.exports = router;
