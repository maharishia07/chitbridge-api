// routes/actors.js — B3 Actor model API
// All endpoints for create login manage actors

const express = require('express');
const router  = express.Router();
const { body, param, query } = require('express-validator');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { query: db } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth    = require('../middleware/auth');

// ── Helpers ─────────────────────────────────────────────────

const generateBridgeId = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'CB';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

const generateOTP = () =>
  process.env.DEV_OTP || Math.floor(100000 + Math.random() * 900000).toString();

// Suggest actor_key from full name
// Ravi Kumar → ravik
const suggestKey = (name) => {
  const parts = name.trim().toLowerCase().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 8);
  return parts[0] + parts[1][0];
};

// Check if actor_key is available under entity
const isKeyAvailable = async (actor_key, parent_entity_id) => {
  const result = await db(
    `SELECT 1 FROM identities
     WHERE actor_key = $1
     AND parent_entity_id = $2
     AND break_status != 'removed'`,
    [actor_key, parent_entity_id]
  );
  return result.rows.length === 0;
};

// ── POST /api/actors/suggest-key ────────────────────────────
// Suggest actor_key from display_name
// Used live as admin types name
router.post('/suggest-key',
  auth,
  [body('display_name').trim().notEmpty()],
  validate,
  async (req, res) => {
    try {
      const entity_id = req.identity.identity_id;
      const name = req.body.display_name;
      let suggested = suggestKey(name);
      let suffix = 1;
      let available = await isKeyAvailable(suggested, entity_id);

      // If taken — suggest with suffix
      // ravik → ravik2 → ravik3
      while (!available && suffix < 10) {
        suggested = suggestKey(name) + (suffix + 1);
        available = await isKeyAvailable(suggested, entity_id);
        suffix++;
      }

      res.json({
        suggested_key: suggested,
        available,
        login_format: `${suggested}@${req.identity.display_name}`,
        alternatives: [
          suggestKey(name) + '2',
          suggestKey(name) + 'r',
          name.trim().toLowerCase().replace(/\s+/,'').slice(0,6),
        ]
      });
    } catch (err) {
      res.status(500).json({ error: 'Suggest failed', message: err.message });
    }
  }
);

// ── POST /api/actors/check-key ───────────────────────────────
// Check if specific key is available
// Called when admin overrides suggestion
router.post('/check-key',
  auth,
  [body('actor_key').trim().isLength({ min: 4 }).matches(/^[a-z0-9]+$/)
    .withMessage('Lowercase letters and numbers only — minimum 4 characters')],
  validate,
  async (req, res) => {
    try {
      const entity_id = req.identity.identity_id;
      const actor_key = req.body.actor_key.toLowerCase().trim();
      const available = await isKeyAvailable(actor_key, entity_id);
      res.json({
        actor_key,
        available,
        login_format: available
          ? `${actor_key}@${req.identity.display_name}`
          : null,
        message: available
          ? `${actor_key}@${req.identity.display_name} is available`
          : `${actor_key} is already taken under this entity`
      });
    } catch (err) {
      res.status(500).json({ error: 'Check failed', message: err.message });
    }
  }
);

// ── POST /api/actors ─────────────────────────────────────────
// Create a new actor under entity
router.post('/',
  auth,
  [
    body('display_name').trim().isLength({ min: 2 }).withMessage('Name required'),
    body('actor_key').trim().isLength({ min: 4 })
      .matches(/^[a-z0-9]+$/).withMessage('Lowercase and numbers only — minimum 4 chars'),
    body('actor_role').optional().trim().isLength({ max: 100 }),
    body('phone').optional().trim().isLength({ max: 20 }),
    body('max_tasks').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const entity_id    = req.identity.identity_id;
      const entity_name  = req.identity.display_name;
      const display_name = sanitise(req.body.display_name);
      const actor_key    = req.body.actor_key.toLowerCase().trim();
      const actor_role   = sanitise(req.body.actor_role || '');
      const phone        = req.body.phone || null;
      const max_tasks    = req.body.max_tasks || 10;

      // Check key available
      const available = await isKeyAvailable(actor_key, entity_id);
      if (!available) {
        return res.status(400).json({
          error: 'Key taken',
          message: `${actor_key}@${entity_name} is already taken`,
          login_format: `${actor_key}@${entity_name}`
        });
      }

      // Generate IDs
      const identity_id = uuidv4();
      const bridge_id   = generateBridgeId();
      const otp         = generateOTP();
      const otp_expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      // Create actor
      await db(
        `INSERT INTO identities (
          identity_id, bridge_id, display_name, actor_key,
          actor_type, parent_entity_id, actor_role, phone,
          max_tasks, identity_type, status, break_status,
          otp_code, otp_expires_at
        ) VALUES ($1,$2,$3,$4,'human',$5,$6,$7,$8,'actor','active','active',$9,$10)`,
        [identity_id, bridge_id, display_name, actor_key,
         entity_id, actor_role || null, phone, max_tasks,
         otp, otp_expires]
      );

      console.log(`Actor created: ${actor_key}@${entity_name} — OTP: ${otp}`);

      res.json({
        message: 'Actor created successfully',
        actor: {
          identity_id,
          bridge_id,
          display_name,
          actor_key,
          actor_role: actor_role || null,
          login_format: `${actor_key}@${entity_name}`,
          parent_entity: entity_name,
        },
        otp,
        // Always return dev_otp when DEV_OTP env is set
        ...(process.env.DEV_OTP && { dev_otp: otp }),
        login_instruction: `Ask ${display_name} to login with:\nUsername: ${actor_key}@${entity_name}\nOTP: ${otp}`
      });

    } catch (err) {
      console.error('Create actor error:', err.message);
      res.status(500).json({ error: 'Create failed', message: err.message });
    }
  }
);

// ── POST /api/actors/login ───────────────────────────────────
// ── GET /api/actors/check-login ─────────────────────────────
// Check if actor has PIN set — frontend shows correct field
router.get('/check-login', async (req, res) => {
  try {
    const username = (req.query.username || '').trim().toLowerCase();
    if (!username.includes('@')) {
      return res.json({ has_pin: false, valid: false });
    }
    const [actor_key, entity_name] = username.split('@');
    const entity = await db(
      `SELECT identity_id FROM identities
       WHERE LOWER(display_name) = $1
       AND identity_type = 'entity' AND status = 'active'`,
      [entity_name]
    );
    if (entity.rows.length === 0) return res.json({ has_pin: false, valid: false });
    const actor = await db(
      `SELECT pin_hash, break_status FROM identities
       WHERE actor_key = $1 AND parent_entity_id = $2
       AND identity_type = 'actor'`,
      [actor_key, entity.rows[0].identity_id]
    );
    if (actor.rows.length === 0) return res.json({ has_pin: false, valid: false });
    const a = actor.rows[0];
    if (a.break_status === 'removed') return res.json({ has_pin: false, valid: false, removed: true });
    res.json({
      valid: true,
      has_pin: !!a.pin_hash,
    });
  } catch (err) {
    res.json({ has_pin: false, valid: false });
  }
});

// ── POST /api/actors/set-pin ────────────────────────────────
// Actor sets PIN after first OTP login
router.post('/set-pin',
  auth,
  [
    body('pin').isLength({ min: 4, max: 4 }).isNumeric()
      .withMessage('PIN must be exactly 4 digits'),
    body('confirm_pin').custom((val, { req }) => {
      if (val !== req.body.pin) throw new Error('PINs do not match');
      return true;
    }),
  ],
  validate,
  async (req, res) => {
    try {
      const identity_id = req.identity.identity_id;
      if (req.identity.identity_type !== 'actor') {
        return res.status(400).json({ error: 'Only actors can set PIN' });
      }
      const pin_hash = await bcrypt.hash(req.body.pin, 10);
      await db(
        `UPDATE identities
         SET pin_hash = $1, pin_set_at = NOW(),
             pin_attempts = 0, pin_locked_at = NULL
         WHERE identity_id = $2`,
        [pin_hash, identity_id]
      );
      res.json({ message: 'PIN set successfully — use PIN for future logins' });
    } catch (err) {
      res.status(500).json({ error: 'Set PIN failed', message: err.message });
    }
  }
);

// ── PUT /api/actors/change-pin ──────────────────────────────
// Actor changes own PIN from profile page
router.put('/change-pin',
  auth,
  [
    body('current_pin').isLength({ min: 4, max: 4 }).isNumeric(),
    body('new_pin').isLength({ min: 4, max: 4 }).isNumeric(),
    body('confirm_pin').custom((val, { req }) => {
      if (val !== req.body.new_pin) throw new Error('New PINs do not match');
      return true;
    }),
  ],
  validate,
  async (req, res) => {
    try {
      const identity_id = req.identity.identity_id;
      if (req.identity.identity_type !== 'actor') {
        return res.status(400).json({ error: 'Only actors can change PIN' });
      }
      const actor = await db(
        `SELECT pin_hash, pin_locked_at FROM identities WHERE identity_id = $1`,
        [identity_id]
      );
      if (actor.rows.length === 0) {
        return res.status(404).json({ error: 'Actor not found' });
      }
      const a = actor.rows[0];
      if (!a.pin_hash) {
        return res.status(400).json({
          error: 'No PIN set',
          message: 'Set your PIN first via login'
        });
      }
      // Verify current PIN
      const match = await bcrypt.compare(req.body.current_pin, a.pin_hash);
      if (!match) {
        return res.status(400).json({
          error: 'Incorrect PIN',
          message: 'Current PIN is incorrect'
        });
      }
      const new_pin_hash = await bcrypt.hash(req.body.new_pin, 10);
      await db(
        `UPDATE identities
         SET pin_hash = $1, pin_set_at = NOW(), pin_attempts = 0
         WHERE identity_id = $2`,
        [new_pin_hash, identity_id]
      );
      res.json({ message: 'PIN changed successfully' });
    } catch (err) {
      res.status(500).json({ error: 'Change PIN failed', message: err.message });
    }
  }
);

// ── DELETE /api/actors/:id/pin ──────────────────────────────
// Admin clears actor PIN — forces new PIN setup on next OTP login
router.delete('/:id/pin',
  auth,
  async (req, res) => {
    try {
      const entity_id = req.identity.identity_id;
      const actor_id  = req.params.id;
      // Verify actor belongs to this entity
      const actor = await db(
        `SELECT identity_id, display_name FROM identities
         WHERE identity_id = $1 AND parent_entity_id = $2
         AND identity_type = 'actor'`,
        [actor_id, entity_id]
      );
      if (actor.rows.length === 0) {
        return res.status(404).json({ error: 'Actor not found' });
      }
      await db(
        `UPDATE identities
         SET pin_hash = NULL, pin_set_at = NULL,
             pin_attempts = 0, pin_locked_at = NULL
         WHERE identity_id = $1`,
        [actor_id]
      );
      res.json({
        message: 'PIN cleared — actor must set new PIN on next OTP login',
        actor_name: actor.rows[0].display_name
      });
    } catch (err) {
      res.status(500).json({ error: 'Clear PIN failed', message: err.message });
    }
  }
);

// ── POST /api/actors/login ───────────────────────────────────
// Actor login — OTP first time — PIN returning
// Entity always generates OTP
// Actor always manages PIN
router.post('/login',
  [
    body('username').trim().notEmpty().withMessage('Username required'),
    body('otp').optional().trim(),
    body('pin').optional().trim().isLength({ min: 4, max: 4 }).isNumeric(),
  ],
  validate,
  async (req, res) => {
    try {
      const username = req.body.username.trim().toLowerCase();
      const otp      = req.body.otp.trim();

      // Parse actor_key@entity_name
      if (!username.includes('@')) {
        return res.status(400).json({
          error: 'Invalid format',
          message: 'Actor login format is: yourname@entityname'
        });
      }

      const [actor_key, entity_name] = username.split('@');

      // Find entity
      const entity = await db(
        `SELECT identity_id, display_name, bridge_id
         FROM identities
         WHERE LOWER(display_name) = $1
         AND identity_type = 'entity'
         AND status = 'active'`,
        [entity_name.toLowerCase()]
      );

      if (entity.rows.length === 0) {
        return res.status(400).json({
          error: 'Login failed',
          message: 'Entity not found — check spelling after @'
        });
      }

      const parent_entity = entity.rows[0];

      // Find actor under entity
      const actor = await db(
        `SELECT identity_id, bridge_id, display_name, actor_key,
                actor_role, actor_type, break_status,
                otp_code, otp_expires_at, max_tasks,
                pin_hash, pin_attempts, pin_locked_at
         FROM identities
         WHERE actor_key = $1
         AND parent_entity_id = $2
         AND identity_type = 'actor'`,
        [actor_key, parent_entity.identity_id]
      );

      if (actor.rows.length === 0) {
        return res.status(400).json({
          error: 'Login failed',
          message: `Actor ${actor_key} not found under ${entity_name}`
        });
      }

      const a = actor.rows[0];

      // Check not removed
      if (a.break_status === 'removed') {
        return res.status(400).json({
          error: 'Login failed',
          message: 'This account has been removed. Contact your admin.'
        });
      }

      // ── PIN or OTP logic ────────────────────────────────────
      // Entity always generates OTP
      // Actor always manages PIN
      // First login: OTP required (pin_hash is NULL)
      // Return login: PIN required (pin_hash is set)

      const { otp, pin } = req.body;

      if (a.pin_hash) {
        // ── RETURNING ACTOR — use PIN ──────────────────────────
        if (!pin) {
          return res.status(400).json({
            error: 'PIN required',
            message: 'Enter your 4 digit PIN to login',
            use_pin: true
          });
        }
        // Check PIN locked
        if (a.pin_locked_at) {
          return res.status(400).json({
            error: 'Account locked',
            message: 'Too many wrong attempts. Contact your admin to reset.'
          });
        }
        const pinMatch = await bcrypt.compare(pin, a.pin_hash);
        if (!pinMatch) {
          // Increment attempts — lock after 5
          const newAttempts = (a.pin_attempts || 0) + 1;
          const lockNow = newAttempts >= 5;
          await db(
            `UPDATE identities
             SET pin_attempts = $1
             ${lockNow ? ', pin_locked_at = NOW()' : ''}
             WHERE identity_id = $2`,
            [newAttempts, a.identity_id]
          );
          return res.status(400).json({
            error: 'Login failed',
            message: lockNow
              ? 'Account locked after 5 wrong attempts. Contact your admin.'
              : `Incorrect PIN. ${5 - newAttempts} attempts remaining.`
          });
        }
        // PIN correct — reset attempts
        await db(
          `UPDATE identities
           SET pin_attempts = 0, last_active_at = NOW()
           WHERE identity_id = $1`,
          [a.identity_id]
        );
      } else {
        // ── FIRST TIME ACTOR — use OTP ─────────────────────────
        if (!otp) {
          return res.status(400).json({
            error: 'OTP required',
            message: 'Enter the OTP your admin shared with you',
            use_otp: true
          });
        }
        // Check OTP
        if (a.otp_code !== otp) {
          return res.status(400).json({
            error: 'Login failed',
            message: 'Incorrect OTP. Ask your admin to reset.'
          });
        }
        // Check OTP not expired
        if (new Date() > new Date(a.otp_expires_at)) {
          return res.status(400).json({
            error: 'Login failed',
            message: 'OTP expired. Ask your admin to reset your access.'
          });
        }
        // Clear OTP — one time use
        await db(
          `UPDATE identities
           SET otp_code = NULL, otp_expires_at = NULL,
               status = 'active', last_active_at = NOW()
           WHERE identity_id = $1`,
          [a.identity_id]
        );
      }

      // Issue JWT with actor details
      const token = jwt.sign(
        {
          identity_id:      a.identity_id,
          bridge_id:        a.bridge_id,
          display_name:     a.display_name,
          actor_key:        a.actor_key,
          actor_role:       a.actor_role,
          actor_type:       a.actor_type,
          identity_type:    'actor',
          parent_entity_id: parent_entity.identity_id,
          parent_entity_name: parent_entity.display_name,
          parent_bridge_id: parent_entity.bridge_id,
        },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );

      console.log(`Actor login: ${actor_key}@${entity_name}`);

      res.json({
        message: 'Login successful',
        token,
        requires_pin_setup: !a.pin_hash,
        actor: {
          identity_id:    a.identity_id,
          bridge_id:      a.bridge_id,
          display_name:   a.display_name,
          actor_key:      a.actor_key,
          actor_role:     a.actor_role,
          login_format:   `${actor_key}@${entity_name}`,
          parent_entity:  parent_entity.display_name,
          break_status:   a.break_status,
        }
      });

    } catch (err) {
      console.error('Actor login error:', err.message);
      res.status(500).json({ error: 'Login failed', message: err.message });
    }
  }
);

// ── GET /api/actors ──────────────────────────────────────────
// List all actors under entity — with filters
router.get('/',
  auth,
  async (req, res) => {
    try {
      const entity_id  = req.identity.identity_id;
      const status     = req.query.status || 'active';
      const actor_type = req.query.type   || null;

      let where = `parent_entity_id = $1 AND identity_type = 'actor'`;
      const params = [entity_id];
      let p = 1;

      // Filter by status
      if (status === 'active') {
        where += ` AND break_status = 'active'`;
      } else if (status === 'leave') {
        where += ` AND break_status IN ('short_break','leave')`;
      } else if (status === 'inactive') {
        where += ` AND break_status = 'deactivated'`;
      } else if (status === 'removed') {
        where += ` AND break_status = 'removed'`;
      } else if (status === 'all') {
        // No filter
      }

      // Filter by type
      if (actor_type) {
        p++;
        where += ` AND actor_type = $${p}`;
        params.push(actor_type);
      }

      const result = await db(
        `SELECT
           identity_id, bridge_id, display_name,
           actor_key, actor_role, actor_type,
           break_status, break_type, break_started_at,
           return_date, max_tasks, current_task_count,
           phone, created_at, last_active_at
         FROM identities
         WHERE ${where}
         ORDER BY
           CASE break_status
             WHEN 'active' THEN 1
             WHEN 'short_break' THEN 2
             WHEN 'leave' THEN 3
             WHEN 'deactivated' THEN 4
             WHEN 'removed' THEN 5
           END,
           display_name ASC`,
        params
      );

      // Summary counts
      const counts = await db(
        `SELECT
           break_status,
           COUNT(*) as count
         FROM identities
         WHERE parent_entity_id = $1
         AND identity_type = 'actor'
         GROUP BY break_status`,
        [entity_id]
      );

      const summary = {};
      counts.rows.forEach(r => { summary[r.break_status] = parseInt(r.count); });

      res.json({
        actors: result.rows,
        summary: {
          active:      summary.active      || 0,
          on_break:    (summary.short_break || 0) + (summary.leave || 0),
          deactivated: summary.deactivated || 0,
          removed:     summary.removed     || 0,
          total:       result.rows.length
        }
      });

    } catch (err) {
      console.error('List actors error:', err.message);
      res.status(500).json({ error: 'Failed to list actors', message: err.message });
    }
  }
);

// ── POST /api/actors/:id/otp ─────────────────────────────────
// Regenerate OTP for actor — admin only
router.post('/:id/otp',
  auth,
  async (req, res) => {
    try {
      const entity_id = req.identity.identity_id;
      const actor_id  = req.params.id;

      // Verify actor belongs to this entity
      const actor = await db(
        `SELECT identity_id, display_name, actor_key
         FROM identities
         WHERE identity_id = $1
         AND parent_entity_id = $2
         AND identity_type = 'actor'`,
        [actor_id, entity_id]
      );

      if (actor.rows.length === 0) {
        return res.status(404).json({ error: 'Not found', message: 'Actor not found' });
      }

      const otp     = generateOTP();
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db(
        `UPDATE identities
         SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0
         WHERE identity_id = $3`,
        [otp, expires, actor_id]
      );

      res.json({
        message: 'OTP reset successfully',
        actor_name: actor.rows[0].display_name,
        otp,
        ...(process.env.DEV_OTP && { dev_otp: otp }),
        login_format: `${actor.rows[0].actor_key}@${req.identity.display_name}`,
        expires_in: '7 days'
      });

    } catch (err) {
      res.status(500).json({ error: 'OTP reset failed', message: err.message });
    }
  }
);

// ── PUT /api/actors/:id/status ───────────────────────────────
// Deactivate or remove actor — admin only
router.put('/:id/status',
  auth,
  [
    body('action').isIn(['deactivate','remove','reactivate'])
      .withMessage('Action must be deactivate remove or reactivate'),
    body('task_action').optional().isIn(['pool','actor'])
      .withMessage('task_action must be pool or actor'),
    body('target_actor_id').optional().isUUID(),
    body('return_date').optional().isDate(),
    body('confirm').optional().equals('REMOVE'),
  ],
  validate,
  async (req, res) => {
    try {
      const entity_id = req.identity.identity_id;
      const actor_id  = req.params.id;
      const { action, task_action, target_actor_id, return_date, confirm } = req.body;

      // Verify actor belongs to entity
      const actor = await db(
        `SELECT identity_id, display_name, actor_key,
                break_status, current_task_count
         FROM identities
         WHERE identity_id = $1
         AND parent_entity_id = $2
         AND identity_type = 'actor'`,
        [actor_id, entity_id]
      );

      if (actor.rows.length === 0) {
        return res.status(404).json({ error: 'Not found' });
      }

      const a = actor.rows[0];

      // Remove requires REMOVE confirmation
      if (action === 'remove' && confirm !== 'REMOVE') {
        return res.status(400).json({
          error: 'Confirmation required',
          message: 'Send confirm: REMOVE to permanently remove this actor',
          tasks_warning: a.current_task_count > 0
            ? `Actor has ${a.current_task_count} active tasks — route them first`
            : null
        });
      }

      // If tasks exist — require routing decision
      if (a.current_task_count > 0 && !task_action) {
        return res.status(400).json({
          error: 'Tasks must be routed',
          message: `Actor has ${a.current_task_count} active tasks`,
          required: 'Send task_action: pool (return to entity) or actor (pass to colleague)',
          actor_tasks: a.current_task_count
        });
      }

      // Route tasks if needed
      let tasks_routed = 0;
      if (a.current_task_count > 0 && task_action) {
        if (task_action === 'pool') {
          // Clear assignment — return to entity pool
          const result = await db(
            `UPDATE chit_status
             SET assigned_to_actor_id = NULL,
                 assigned_to_actor_display_name = NULL,
                 assigned_at = NULL, assignment_type = NULL
             WHERE assigned_to_actor_id = $1`,
            [actor_id]
          );
          tasks_routed = result.rowCount;
        } else if (task_action === 'actor' && target_actor_id) {
          // Pass to specific actor
          const target = await db(
            `SELECT identity_id, display_name FROM identities
             WHERE identity_id = $1 AND parent_entity_id = $2
             AND break_status = 'active'`,
            [target_actor_id, entity_id]
          );
          if (target.rows.length === 0) {
            return res.status(400).json({ error: 'Target actor not found or not active' });
          }
          const result = await db(
            `UPDATE chit_status
             SET assigned_to_actor_id = $1,
                 assigned_to_actor_display_name = $2,
                 assigned_at = NOW(), assignment_type = 'push'
             WHERE assigned_to_actor_id = $3`,
            [target.rows[0].identity_id, target.rows[0].display_name, actor_id]
          );
          tasks_routed = result.rowCount;
          // Update task counts
          await db(`UPDATE identities SET current_task_count = current_task_count + $1 WHERE identity_id = $2`,
            [tasks_routed, target_actor_id]);
        }
        // Reset actor task count
        await db(`UPDATE identities SET current_task_count = 0 WHERE identity_id = $1`, [actor_id]);
      }

      // Apply status change
      if (action === 'deactivate') {
        await db(
          `UPDATE identities
           SET break_status = 'deactivated',
               deactivated_at = NOW(),
               deactivated_by = $1,
               return_date = $2,
               otp_code = NULL
           WHERE identity_id = $3`,
          [req.identity.identity_id, return_date || null, actor_id]
        );
      } else if (action === 'remove') {
        await db(
          `UPDATE identities
           SET break_status = 'removed',
               removed_at = NOW(),
               removed_by = $1,
               otp_code = NULL,
               otp_expires_at = NULL
           WHERE identity_id = $2`,
          [req.identity.identity_id, actor_id]
        );
      } else if (action === 'reactivate') {
        const otp     = generateOTP();
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db(
          `UPDATE identities
           SET break_status = 'active',
               deactivated_at = NULL,
               return_date = NULL,
               otp_code = $1,
               otp_expires_at = $2
           WHERE identity_id = $3`,
          [otp, expires, actor_id]
        );
        return res.json({
          message: 'Actor reactivated',
          otp,
          ...(process.env.DEV_OTP && { dev_otp: otp }),
          login_format: `${a.actor_key}@${req.identity.display_name}`
        });
      }

      res.json({
        message: `Actor ${action}d successfully`,
        actor_name: a.display_name,
        action,
        tasks_routed,
        task_action: task_action || null,
        return_date: return_date || null
      });

    } catch (err) {
      console.error('Actor status error:', err.message);
      res.status(500).json({ error: 'Status change failed', message: err.message });
    }
  }
);

// ── PUT /api/actors/break ────────────────────────────────────
// Actor goes on break — short or leave
router.put('/break',
  auth,
  [
    body('break_type').isIn(['short_break','leave','end_break'])
      .withMessage('break_type must be short_break leave or end_break'),
    body('task_action').optional().isIn(['hold','pool','actor']),
    body('target_actor_id').optional().isUUID(),
  ],
  validate,
  async (req, res) => {
    try {
      const actor_id = req.identity.identity_id;
      const { break_type, task_action, target_actor_id } = req.body;

      if (req.identity.identity_type !== 'actor') {
        return res.status(400).json({ error: 'Only actors can use break endpoint' });
      }

      if (break_type === 'end_break') {
        // Return from any break
        await db(
          `UPDATE identities
           SET break_status = 'active',
               break_type = NULL,
               break_started_at = NULL
           WHERE identity_id = $1`,
          [actor_id]
        );
        return res.json({ message: 'Break ended — you are now active' });
      }

      if (break_type === 'short_break') {
        // Tasks HELD — no routing needed
        await db(
          `UPDATE identities
           SET break_status = 'short_break',
               break_type = 'short_break',
               break_started_at = NOW()
           WHERE identity_id = $1`,
          [actor_id]
        );
        return res.json({
          message: 'Short break started — your tasks are held',
          break_type: 'short_break',
          tasks: 'held — nobody else can pull them'
        });
      }

      if (break_type === 'leave') {
        // Tasks must be routed before leave confirmed
        const taskCount = await db(
          `SELECT COUNT(*) as count FROM chit_status
           WHERE assigned_to_actor_id = $1`,
          [actor_id]
        );
        const count = parseInt(taskCount.rows[0].count);

        if (count > 0 && !task_action) {
          return res.status(400).json({
            error: 'Route tasks first',
            message: `You have ${count} active tasks`,
            required: 'Send task_action: pool (return to entity) or actor (pass to colleague)',
            task_count: count
          });
        }

        // Route tasks
        if (count > 0) {
          if (task_action === 'pool') {
            await db(
              `UPDATE chit_status
               SET assigned_to_actor_id = NULL,
                   assigned_to_actor_display_name = NULL,
                   assigned_at = NULL, assignment_type = NULL
               WHERE assigned_to_actor_id = $1`,
              [actor_id]
            );
          } else if (task_action === 'actor' && target_actor_id) {
            const target = await db(
              `SELECT identity_id, display_name FROM identities
               WHERE identity_id = $1 AND break_status = 'active'`,
              [target_actor_id]
            );
            if (target.rows.length === 0) {
              return res.status(400).json({ error: 'Target actor not found or not active' });
            }
            await db(
              `UPDATE chit_status
               SET assigned_to_actor_id = $1,
                   assigned_to_actor_display_name = $2,
                   assigned_at = NOW(), assignment_type = 'push'
               WHERE assigned_to_actor_id = $3`,
              [target.rows[0].identity_id, target.rows[0].display_name, actor_id]
            );
          }
          await db(`UPDATE identities SET current_task_count = 0 WHERE identity_id = $1`, [actor_id]);
        }

        await db(
          `UPDATE identities
           SET break_status = 'leave',
               break_type = 'leave',
               break_started_at = NOW()
           WHERE identity_id = $1`,
          [actor_id]
        );

        return res.json({
          message: 'Leave started — tasks routed',
          break_type: 'leave',
          task_action: task_action || null,
          tasks_routed: count
        });
      }

    } catch (err) {
      console.error('Break error:', err.message);
      res.status(500).json({ error: 'Break failed', message: err.message });
    }
  }
);

// ── PUT /api/actors/assign/:chit_id ─────────────────────────
// Pull push or return a chit assignment
router.put('/assign/:chit_id',
  auth,
  [
    body('action').isIn(['pull','push','return'])
      .withMessage('Action must be pull push or return'),
    body('target_actor_id').optional().isUUID(),
  ],
  validate,
  async (req, res) => {
    try {
      const chit_id  = req.params.chit_id;
      const actor_id = req.identity.identity_id;
      const entity_id = req.identity.identity_type === 'actor'
        ? req.identity.parent_entity_id
        : req.identity.identity_id;
      const { action, target_actor_id } = req.body;

      // Verify chit belongs to this entity
      const chit = await db(
        `SELECT cs.*, i.display_name as actor_name
         FROM chit_status cs
         LEFT JOIN identities i ON i.identity_id = cs.assigned_to_actor_id
         WHERE cs.chit_id = $1 AND cs.entity_id = $2`,
        [chit_id, entity_id]
      );

      if (chit.rows.length === 0) {
        return res.status(404).json({ error: 'Chit not found' });
      }

      const cs = chit.rows[0];

      if (action === 'pull') {
        // Can only pull if unassigned
        if (cs.assigned_to_actor_id) {
          return res.status(400).json({
            error: 'Already assigned',
            message: `Already assigned to ${cs.actor_name}`
          });
        }
        await db(
          `UPDATE chit_status
           SET assigned_to_actor_id = $1,
               assigned_to_actor_display_name = $2,
               assigned_at = NOW(),
               assignment_type = 'pull'
           WHERE chit_id = $3 AND entity_id = $4`,
          [actor_id, req.identity.display_name, chit_id, entity_id]
        );
        await db(
          `UPDATE identities SET current_task_count = current_task_count + 1
           WHERE identity_id = $1`,
          [actor_id]
        );
        // Log assignment in state_log
        await db(
          `INSERT INTO state_log
           (chit_id, entity_id, action, action_by_identity_id,
            action_by_display_name, detail)
           SELECT $1, entity_id, 'assigned', $2, $3, $4
           FROM chit_status WHERE chit_id = $1 AND entity_id = $5`,
          [chit_id, actor_id, req.identity.display_name,
           `Pulled by co-assist ${req.identity.display_name}`, entity_id]
        );
        return res.json({
          message: 'Chit pulled to your My Task',
          action: 'pull',
          assigned_to: req.identity.display_name
        });
      }

      if (action === 'push') {
        if (!target_actor_id) {
          return res.status(400).json({ error: 'target_actor_id required for push' });
        }
        const target = await db(
          `SELECT identity_id, display_name, current_task_count, max_tasks
           FROM identities
           WHERE identity_id = $1
           AND parent_entity_id = $2
           AND break_status = 'active'`,
          [target_actor_id, entity_id]
        );
        if (target.rows.length === 0) {
          return res.status(400).json({ error: 'Target actor not found or not active' });
        }
        const t = target.rows[0];
        // Warning if overloaded
        const overloaded = t.current_task_count >= t.max_tasks;

        // Reduce previous assignee count
        if (cs.assigned_to_actor_id) {
          await db(
            `UPDATE identities SET current_task_count = GREATEST(0, current_task_count - 1)
             WHERE identity_id = $1`,
            [cs.assigned_to_actor_id]
          );
        }

        await db(
          `UPDATE chit_status
           SET assigned_to_actor_id = $1,
               assigned_to_actor_display_name = $2,
               assigned_at = NOW(), assignment_type = 'push'
           WHERE chit_id = $3 AND entity_id = $4`,
          [t.identity_id, t.display_name, chit_id, entity_id]
        );
        await db(
          `UPDATE identities SET current_task_count = current_task_count + 1
           WHERE identity_id = $1`,
          [t.identity_id]
        );
        return res.json({
          message: `Chit pushed to ${t.display_name}`,
          action: 'push',
          assigned_to: t.display_name,
          warning: overloaded ? `${t.display_name} is at maximum load` : null
        });
      }

      if (action === 'return') {
        if (cs.assigned_to_actor_id) {
          await db(
            `UPDATE identities SET current_task_count = GREATEST(0, current_task_count - 1)
             WHERE identity_id = $1`,
            [cs.assigned_to_actor_id]
          );
        }
        await db(
          `UPDATE chit_status
           SET assigned_to_actor_id = NULL,
               assigned_to_actor_display_name = NULL,
               assigned_at = NULL, assignment_type = NULL
           WHERE chit_id = $1 AND entity_id = $2`,
          [chit_id, entity_id]
        );
        return res.json({
          message: 'Chit returned to entity pool',
          action: 'return'
        });
      }

    } catch (err) {
      console.error('Assign error:', err.message);
      res.status(500).json({ error: 'Assignment failed', message: err.message });
    }
  }
);

// ── GET /api/actors/settings ─────────────────────────────────
router.get('/settings', auth, async (req, res) => {
  try {
    const entity_id = req.identity.identity_type === 'actor'
      ? req.identity.parent_entity_id
      : req.identity.identity_id;

    let result = await db(
      `SELECT * FROM entity_actor_settings WHERE entity_id = $1`,
      [entity_id]
    );

    // Create default settings if not exist
    if (result.rows.length === 0) {
      result = await db(
        `INSERT INTO entity_actor_settings (entity_id)
         VALUES ($1) RETURNING *`,
        [entity_id]
      );
    }

    res.json({ settings: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get settings', message: err.message });
  }
});

// ── PUT /api/actors/settings ─────────────────────────────────
router.put('/settings',
  auth,
  [
    body('assignment_model').optional().isIn(['pull','push','both']),
    body('default_max_tasks').optional().isInt({ min: 1, max: 100 }),
    body('all_task_visible').optional().isBoolean(),
    body('auto_return_on_short_break').optional().isBoolean(),
  ],
  validate,
  async (req, res) => {
    try {
      const entity_id = req.identity.identity_id;
      const { assignment_model, default_max_tasks, all_task_visible, auto_return_on_short_break } = req.body;

      await db(
        `INSERT INTO entity_actor_settings
           (entity_id, assignment_model, default_max_tasks, all_task_visible, auto_return_on_short_break)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (entity_id) DO UPDATE SET
           assignment_model = COALESCE($2, entity_actor_settings.assignment_model),
           default_max_tasks = COALESCE($3, entity_actor_settings.default_max_tasks),
           all_task_visible = COALESCE($4, entity_actor_settings.all_task_visible),
           auto_return_on_short_break = COALESCE($5, entity_actor_settings.auto_return_on_short_break),
           updated_at = NOW()`,
        [entity_id, assignment_model, default_max_tasks, all_task_visible, auto_return_on_short_break]
      );

      const updated = await db(`SELECT * FROM entity_actor_settings WHERE entity_id = $1`, [entity_id]);
      res.json({ message: 'Settings updated', settings: updated.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Settings update failed', message: err.message });
    }
  }
);

module.exports = router;
