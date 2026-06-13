// routes/entities.js — Entity registration, login, search
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');

// ─── Helper: Generate bridge_id ──────────────────────────────
const generateBridgeId = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'CB';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
};

// ─── Helper: Generate 6-digit OTP ────────────────────────────
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ─── Helper: Send OTP email ──────────────────────────────────
const sendOTPEmail = async (email, displayName, otp) => {
  try {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.FROM_EMAIL || 'noreply@chitandbridge.com',
      to: email,
      subject: 'Your Chit and Bridge verification code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <h2 style="color: #0D47A1;">Chit and Bridge</h2>
          <p>Hello ${displayName},</p>
          <p>Your verification code is:</p>
          <div style="background: #f5f5f5; padding: 20px; text-align: center; 
                      font-size: 32px; font-weight: bold; letter-spacing: 8px;
                      color: #0D47A1; border-radius: 8px; margin: 20px 0;">
            ${otp}
          </div>
          <p>This code expires in 10 minutes.</p>
          <p style="color: #888; font-size: 12px;">
            If you did not request this, please ignore this email.
          </p>
        </div>
      `
    });
    return true;
  } catch (err) {
    console.error('Email send error:', err.message);
    // In development — log OTP to console for testing
    console.log(`DEV OTP for ${email}: ${otp}`);
    return false;
  }
};

// ─── POST /entities/register ─────────────────────────────────
// Step 1: Register entity — sends OTP
router.post('/register',
  [
    body('display_name')
      .trim()
      .isLength({ min: 2, max: 255 })
      .withMessage('Display name must be 2 to 255 characters'),
    body('email')
      .trim()
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email required'),
  ],
  validate,
  async (req, res) => {
    try {
      const display_name = sanitise(req.body.display_name);
      const email = req.body.email.toLowerCase().trim();

      // Check if email already registered
      const existing = await query(
        'SELECT identity_id, email_verified FROM identities WHERE email = $1',
        [email]
      );

      let identity_id;
      let bridge_id;

      if (existing.rows.length > 0) {
        // Entity exists — resend OTP
        identity_id = existing.rows[0].identity_id;
        bridge_id = existing.rows[0].bridge_id;
      } else {
        // New entity — create record
        bridge_id = generateBridgeId();
        identity_id = uuidv4();

        await query(
          `INSERT INTO identities
           (identity_id, bridge_id, display_name, email, identity_type, status)
           VALUES ($1, $2, $3, $4, 'entity', 'pending')`,
          [identity_id, bridge_id, display_name, email]
        );
      }

      // Generate and store OTP
      const otp = generateOTP();
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await query(
        `UPDATE identities
         SET otp_code = $1, otp_expires_at = $2, display_name = $3
         WHERE identity_id = $4`,
        [otp, expires, display_name, identity_id]
      );

      // Send OTP email — controlled by OTP_EMAIL_ENABLED flag
      if (process.env.OTP_EMAIL_ENABLED === 'true') {
        await sendOTPEmail(email, display_name, otp);
      } else {
        console.log(`[OTP] ${email}: ${otp}`);
      }

      res.json({
        message: 'Verification code sent to your email',
        email: email,
        // In development show OTP directly for testing
        ...(process.env.NODE_ENV === 'development' && { dev_otp: otp })
      });

    } catch (err) {
      console.error('Register error:', err.message);
      res.status(500).json({ error: 'Registration failed', message: err.message });
    }
  }
);

// ─── POST /entities/verify ───────────────────────────────────
// Step 2: Verify OTP — returns JWT
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

      // Find entity with matching OTP
      const result = await query(
        `SELECT identity_id, bridge_id, display_name, email,
                otp_code, otp_expires_at, email_verified
         FROM identities
         WHERE email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({
          error: 'Verification failed',
          message: 'Email not found — please register first'
        });
      }

      const identity = result.rows[0];

      // Check OTP
      if (identity.otp_code !== otp) {
        return res.status(400).json({
          error: 'Verification failed',
          message: 'Incorrect verification code'
        });
      }

      // Check OTP expiry
      if (new Date() > new Date(identity.otp_expires_at)) {
        return res.status(400).json({
          error: 'Verification failed',
          message: 'Verification code expired — please register again'
        });
      }

      // Mark verified and active
      await query(
        `UPDATE identities
         SET email_verified = TRUE,
             status = 'active',
             otp_code = NULL,
             otp_expires_at = NULL,
             last_active_at = NOW()
         WHERE identity_id = $1`,
        [identity.identity_id]
      );

      // Issue JWT
      const token = jwt.sign(
        {
          identity_id: identity.identity_id,
          bridge_id: identity.bridge_id,
          display_name: identity.display_name,
          email: identity.email,
          identity_type: 'entity'
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

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
      res.status(500).json({ error: 'Verification failed', message: err.message });
    }
  }
);

// ─── GET /entities/search ─────────────────────────────────────
// Search entities by display name
// Rate limited — max 100 searches per entity per hour
router.get('/search', auth, async (req, res) => {
  try {
    const q = sanitise(req.query.q || '');

    if (q.length < 2) {
      return res.status(400).json({
        error: 'Search query too short',
        message: 'Enter at least 2 characters'
      });
    }

    const result = await query(
      `SELECT identity_id, bridge_id, display_name, created_at
       FROM identities
       WHERE LOWER(display_name) LIKE LOWER($1)
       AND identity_type = 'entity'
       AND status = 'active'
       AND identity_id != $2
       ORDER BY display_name
       LIMIT 10`,
      [`%${q}%`, req.identity.identity_id]
    );

    res.json({
      results: result.rows,
      count: result.rows.length
    });

  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed', message: err.message });
  }
});

// ─── GET /entities/me ─────────────────────────────────────────
// Get current entity profile
router.get('/me', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT identity_id, bridge_id, display_name, email,
              country, currency_code, created_at, last_active_at
       FROM identities
       WHERE identity_id = $1`,
      [req.identity.identity_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    // Update last_active
    await query(
      'UPDATE identities SET last_active_at = NOW() WHERE identity_id = $1',
      [req.identity.identity_id]
    );

    res.json({ entity: result.rows[0] });

  } catch (err) {
    console.error('Profile error:', err.message);
    res.status(500).json({ error: 'Failed to get profile', message: err.message });
  }
});

module.exports = router;
