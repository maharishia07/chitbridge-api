// routes/entities.js — Entity registration, login, search
const express = require('express');
const router = express.Router();
const { safeErr } = require('../lib/respond');
const { body } = require('express-validator');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const visibilityCap = require('../lib/visibility-cap');   // a choice, bounded by a cap
const { query, withEntity } = require('../db');
const { validate, sanitise } = require('../middleware/validate');
const auth = require('../middleware/auth');
const { verifyOtp } = require('../lib/otp');   // per-account OTP attempt cap
const { sendOtpEmail } = require('../lib/notify');   // shared OTP email sender (F2 — extracted from here)
const { resolveEntityGovernance } = require('../lib/govresolve');   // resolve the entity's governance from attributes

// ⚠️ ONE generator (lib/bridgeid.js). This was SIX copies and the CSPRNG hardening reached only one of them —
//    not this one, which is where every entity's bridge id is minted. Same call site, now a strong PRNG.
const generateBridgeId = require('../lib/bridgeid').generateBridgeId;

// DEV_OTP in Railway env = fixed OTP for testing e.g. 123456
// No DEV_OTP = random 6-digit OTP
// S4 (reviewer 2026-07-13) — OTP from a CSPRNG (crypto.randomInt), not Math.random() (whose V8 state is recoverable,
// letting an attacker predict a victim's OTP). DEV_OTP still overrides for team testing when explicitly set.
// ⚠️ ONE generator (lib/otp.js, next to the verification). This copy was the only one of THREE that ever received
//    the S4 CSPRNG fix; actors.js and connectors.js kept Math.random() for four weeks. Behaviour here is unchanged.
const generateOTP = require('../lib/otp').generateOTP;

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
        /**
         * ── HANDLE OR NAME ───────────────────────────────────────────────────────────────────────────────────
         *
         * `user_id` FIRST, because it is the only unique one. It carries a UNIQUE index on lower(user_id), and it
         * is what a network-minted store is given: `<network name>.<store>` — e.g. athi.clothing. Always exactly
         * two levels, however deep the store sits on the tree (lib/handle.js).
         * Athi, 2026-08-07: *"if you keep bridgeid.clothing, people cannot remember the id, so it has to be human
         * readable names"* and *"if the network store needs to participate in another network, it can be used for
         * adding it."* So the handle is the portable public reference, and the bridge id stays the identity.
         *
         * ⚠️ THEN display name — and it must be UNAMBIGUOUS. This used to take `found.rows[0]` with no ORDER BY,
         * so two active entities sharing a name meant login silently picked one, generated an OTP on THAT account
         * and mailed it to THAT owner. Not a takeover — the code still reaches the real inbox — but the wrong
         * person is disturbed, their pending OTP is overwritten, and the legitimate owner of the other account
         * simply cannot log in by name. Anyone could trigger it repeatedly by typing a name.
         *
         * It was latent only because names happened to be distinct. Minting a network of stores called Clothing,
         * Pharmacy and Grocery is precisely what makes it likely — Athi asked about exactly this collision before
         * a line of the network build was written.
         *
         * Ambiguity is now REFUSED and the person is told how to be specific. Guessing between two accounts is
         * never the helpful answer.
         */
        let found = await query(
          `SELECT identity_id, bridge_id, email, display_name FROM identities
           WHERE LOWER(user_id) = LOWER($1) AND identity_type = 'entity' AND status = 'active'`,
          [input]
        );
        if (!found.rows.length) {
          found = await query(
            `SELECT identity_id, bridge_id, email, display_name FROM identities
             WHERE LOWER(display_name) = LOWER($1)
             AND identity_type = 'entity'
             AND status = 'active'`,
            [input]
          );
          if (found.rows.length > 1) {
            return res.status(409).json({
              error: 'Ambiguous name',
              message: `More than one business is called "${input}". Sign in with your email address or your User ID instead.`,
              code: 'AMBIGUOUS_NAME',
            });
          }
        }
        if (found.rows.length === 0) {
          return res.status(400).json({
            error: 'Not found',
            message: 'Entity not found — check your name, User ID, or email address'
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

      /**
       * ⚠️ A NETWORK-MINTED STORE HAS NO INBOX. It is issued a handle (`<operator bridge>.<store>`) and a claim
       * code; there is no address to send anything to. Calling the mailer with a null address would either throw or
       * report "we couldn't send your code", which is a false failure — nothing was meant to be sent.
       *
       * Athi, 2026-08-07: *"it should be controlled by the network operator, so he can have the password similar to
       * an actor and should be able to circulate the same like an actor."* So the credential travels through the
       * OPERATOR, not through the store's mail — and when it expires the operator RE-ISSUES it, exactly as a
       * connector's code is re-issued. That is the whole answer to "how does a store log in again": it does not
       * self-serve, because it does not own itself yet.
       */
      if (!email) {
        return res.json({
          message: 'This store signs in with the code its network operator issued.',
          user_id: display_name ? undefined : undefined,
          handle: (await query('SELECT user_id FROM identities WHERE identity_id = $1', [identity_id])).rows[0]?.user_id || null,
          operator_issued: true,
        });
      }

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
    // EMAIL OR HANDLE. A network-minted store is issued a `user_id` and no email, so requiring a valid address
    // here would have made the handle unusable the moment it was issued — the login half of a credential that
    // cannot log in. Either is accepted; exactly one is required (checked in the body, where the message is useful).
    body('email').optional().trim(),
    body('user_id').optional().trim(),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  ],
  validate,
  async (req, res) => {
    try {
      const otp = req.body.otp.trim();
      const email  = (req.body.email  || '').toLowerCase().trim();
      const handle = (req.body.user_id || '').trim();
      if (!email && !handle) {
        return res.status(400).json({ error: 'Verification failed', message: 'Send your email address or your User ID.' });
      }

      // The handle is UNIQUE (a unique index on lower(user_id)), so this lookup can never be ambiguous the way a
      // display name can — which is the whole reason a minted store is given one.
      const result = email
        ? await query(
            `SELECT identity_id, bridge_id, display_name, email, otp_code, otp_expires_at, otp_attempts, owner_scope
             FROM identities WHERE email = $1`, [email])
        : await query(
            `SELECT identity_id, bridge_id, display_name, email, otp_code, otp_expires_at, otp_attempts, owner_scope
             FROM identities WHERE LOWER(user_id) = LOWER($1)`, [handle]);

      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Verification failed',
          message: email ? 'Email not found — please register first' : 'That User ID is not recognised.' });
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

      // AUTO-MINT the entity's governance stamp onto its CHOSEN vertical (else the default constitution). BEST-EFFORT —
      // wrapped so it can NEVER fail verification; an un-stamped entity safely defaults to base at resolve time.
      let mintedConstitution = null;
      try {
        const chosen = (req.body.constitution && String(req.body.constitution).trim()) || 'base';
        let c = (await query(`SELECT constitution_key, version FROM constitution WHERE constitution_key = $1 AND active = true ORDER BY (is_default IS TRUE) DESC, minted_at DESC LIMIT 1`, [chosen])).rows[0];
        if (!c) c = (await query(`SELECT constitution_key, version FROM constitution WHERE is_default = true AND active = true LIMIT 1`)).rows[0];
        if (c) {
          // place the entity on the INSTALLATION that serves its vertical (service-desk → the Mexico platform), else default
          let installKey = 'platform-0';
          try { const ir = await query(`SELECT installation_key FROM installation WHERE vertical_key = $1 AND active = true ORDER BY created_at LIMIT 1`, [c.constitution_key]); if (ir.rows[0]) installKey = ir.rows[0].installation_key; } catch (_) {}
          await withEntity(identity.identity_id, (cl) => cl.query(
            `INSERT INTO entity_governance (entity_id, constitution_key, constitution_version, installation_key) VALUES ($1,$2,$3,$4)
             ON CONFLICT (entity_id) DO UPDATE SET constitution_key = EXCLUDED.constitution_key, constitution_version = EXCLUDED.constitution_version, installation_key = EXCLUDED.installation_key, minted_at = now()`,
            [identity.identity_id, c.constitution_key, c.version, installKey]));
          mintedConstitution = c.constitution_key + '@' + c.version;
          console.log(`Entity minted: ${identity.display_name} → ${mintedConstitution} on ${installKey}`);
        }
      } catch (e) { console.warn('entity auto-mint skipped:', (e && e.message) || e); }

      // BOOTSTRAP the entity's default schema so its catalogue/compose works immediately (no 404 for entity #2).
      // Reusable + non-fatal; the governed mint path will call the same fn once unification lands (Q2).
      try { await require('../lib/schema-bootstrap').ensureDefaultSchema(identity.identity_id); } catch (_) {}

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
        },
        constitution: mintedConstitution
      });

    } catch (err) {
      console.error('Verify error:', err.message);
      res.status(500).json({ error: 'Verification failed', message: safeErr(err) });
    }
  }
);

// GET /entities/constitutions — PUBLIC (pre-auth): the verticals a registrant can choose from at sign-up. Reads the
// shared constitution catalogue. Empty (chooser hidden) if the catalogue isn't there yet.
router.get('/constitutions', async (req, res) => {
  try {
    const r = await query(`SELECT constitution_key AS key, version, label, vertical, capabilities, is_default
      FROM constitution WHERE active = true ORDER BY is_default DESC, label`);
    res.json({ constitutions: r.rows });
  } catch (_) { res.json({ constitutions: [] }); }
});

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
       AND COALESCE(sealed, false) = false
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
/**
 * ── POLICY FLAGS (b130) — Settings → Policy flags, persisted where it can be ENFORCED ──────────────────────────
 * They lived in localStorage: the card said "set ✓", nothing left the browser, and the server that enforces them
 * never heard. An actor acts FOR its entity, so the flags are always the ENTITY's, never the actor's.
 */
const policy = require('../lib/policy');
const policyEntity = (req) => req.identity.parent_entity_id || req.identity.identity_id;

router.get('/policy', auth, async (req, res) => {
  try { res.json({ flags: await policy.get(policyEntity(req)), schema: policy.FLAGS, bound: policy.BOUND }); }
  catch (err) { res.status(500).json({ error: 'Policy read failed', message: safeErr(err) }); }
});

router.patch('/policy', auth, async (req, res) => {
  try { res.json({ flags: await policy.set(policyEntity(req), req.body || {}) }); }
  catch (err) { res.status(err.status || 500).json({ error: 'Policy update failed', message: err.status ? (err.message || safeErr(err)) : safeErr(err) }); }
});

router.get('/me', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT identity_id, bridge_id, display_name, email, user_id, self_copy_pref, dispute_handler_actor_id, country, currency_code, created_at, last_active_at,
              gstn, is_verified, logo_url, address, business_status,
              purpose, sort_order, address, city, lat, lng, service_km   -- b117/b118/b119
       FROM identities WHERE identity_id = $1`,
      [req.identity.identity_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entity not found' });
    await query('UPDATE identities SET last_active_at = NOW() WHERE identity_id = $1', [req.identity.identity_id]);
    // the ENTITY's capability selection (add-ons; core is implicit) — drives the itemised capability toggles. [b55/connector]
    // Defensive: defaults to [] if the b55 column isn't present in this environment.
    let capabilities = [];
    let capabilities_debug = 'ok';
    try {
      const eid = req.identity.parent_entity_id || req.identity.identity_id;
      const c = await query('SELECT capabilities FROM identities WHERE identity_id = $1', [eid]);
      capabilities = (c.rows[0] && c.rows[0].capabilities) || [];
      capabilities_debug = (c.rows[0] ? 'rows=1' : 'rows=0') + ' eid=' + String(eid).slice(0, 8)
        + ' raw=' + JSON.stringify(c.rows[0] ? c.rows[0].capabilities : null);
    } catch (e) { capabilities_debug = 'ERR: ' + String((e && e.message) || e).slice(0, 140); }
    // NOTE: the web client's api() runs every body through unwrap(), which returns j.entity for /me and
    // DROPS sibling keys. So the capability selection MUST ride INSIDE entity to reach SESSION.capabilities
    // (which gates the itemised capability nav). Top-level copies kept for direct/API callers + curl. [b55/connector]
    // Resolve the entity's GOVERNANCE from attributes (constitution · installation · basics · allowances · jurisdiction).
    // Best-effort; rides INSIDE entity (unwrap() drops siblings) so the client can read it. Null if not resolvable yet.
    let governance = null;
    try { governance = await resolveEntityGovernance(req.identity.parent_entity_id || req.identity.identity_id); } catch (_) {}
    // b77 (self-healing): storefront access mode; default 'browse' if the column isn't present yet.
    let storefront_access = 'browse';
    try { const sf = await query('SELECT storefront_access FROM identities WHERE identity_id = $1', [req.identity.identity_id]); if (sf.rows[0] && sf.rows[0].storefront_access) storefront_access = sf.rows[0].storefront_access; } catch (_) {}
    // b114 (self-healing): is this entity's catalogue exposed at all? Pre-b114 there was no such setting and adoption
    // silently published, so absent the column we report 'public' — the behaviour that was actually in force.
    // The EFFECTIVE visibility, plus the cap that produced it. Reporting the stored flag alone would let a capped
    // entity's own profile read 'public' while the world correctly sees nothing — the owner would have no way to
    // understand why their link is dead.
    let catalogue_visibility = 'public';
    let visibility_cap = { max: 'public', by: null, enforced: false, reason: '' };
    try {
      const cv = await query('SELECT catalogue_visibility, plan, params_override FROM identities WHERE identity_id = $1', [req.identity.identity_id]);
      const row = cv.rows[0] || {};
      let planMenu = null;
      try { const c = await require('./governance').loadActiveConstitution(); planMenu = c && c.plan_menu; } catch (_) {}
      visibility_cap = visibilityCap.capOf({ plan: row.plan, planMenu, paramsOverride: row.params_override || {} });
      catalogue_visibility = visibilityCap.effective(row.catalogue_visibility, visibility_cap);
    } catch (_) { /* pre-b114 → the default above */ }
    const entityOut = Object.assign({}, result.rows[0], { capabilities, capabilities_debug, governance, storefront_access, catalogue_visibility, visibility_cap });
    res.json({ entity: entityOut, capabilities, capabilities_debug, governance });
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

/**
 * The cap on THIS entity's catalogue visibility — the operator who provisioned it, then the plan.
 *
 * One query, whatever the caller. The plan_menu comes from the active constitution; if there is no constitution or
 * the plan is not declared in it, capOf() allows and reports  rather than denying — see
 * lib/visibility-cap.js for why an absent declaration must not close every shop on the platform.
 */
async function visibilityCapFor(entityId) {
  let plan = null, paramsOverride = {};
  try {
    const r = await query('SELECT plan, params_override FROM identities WHERE identity_id = $1', [entityId]);
    if (r.rows[0]) { plan = r.rows[0].plan; paramsOverride = r.rows[0].params_override || {}; }
  } catch (_) { /* pre-governance schema — capOf() then reports unenforced */ }
  let planMenu = null;
  try { const c = await require('./governance').loadActiveConstitution(); planMenu = c && c.plan_menu; } catch (_) {}
  return visibilityCap.capOf({ plan, planMenu, paramsOverride });
}

router.patch('/profile', auth,
  [ body('gstn').optional().trim().isLength({ max: 15 }),
    body('logo_url').optional().trim(),
    body('address').optional().trim(),
    body('business_status').optional().isIn(['open','closed','away']),
    body('storefront_access').optional().isIn(['browse','login']),
    body('self_copy_pref').optional().isIn(['both','sent','received']),
    body('dispute_handler_actor_id').optional().isUUID(),
    /**
     * user_id — the handle a person TYPES. Athi, 2026-08-07: *"we should not allow space in the user id."*
     *
     * Right, and the rule had never looked at the CONTENT: it checked length or email shape and nothing else, so
     * `alpha timers` saved happily and then could never be a network root — `lib/handle.js` refuses a space, and
     * a co-assist signs in as `ravi@alpha timers.west`, which nobody can type or read out. A value that is
     * accepted here and refused everywhere it is used is worse than a value refused up front.
     *
     * Letters, digits, dots and dashes. Dots because a network handle IS dotted (`alpha-timers.west`); dashes
     * because that is what a space becomes. Case is allowed — uniqueness is already case-insensitive
     * (idx_identities_user_id is on lower(user_id)) and handle.js lowercases before it checks.
     *
     * ⚠️ A TIGHTENING, and it only governs WRITES. Any user_id already stored with a space keeps working for
     * login; it simply cannot be re-saved unchanged, and cannot be a network root. Rejecting stored values
     * retroactively would lock those owners out of their own accounts.
     */
    body('user_id').optional().trim().custom(v => {
      if (v === '') return true;
      if (v.includes('@')) {
        if (!/^\S+@\S+\.\S+$/.test(v)) throw new Error('That is not a valid email address.');
        return true;
      }
      if (/\s/.test(v)) throw new Error('A User ID cannot contain spaces — try "' + v.trim().replace(/\s+/g, '-').toLowerCase() + '".');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(v)) throw new Error('A User ID can use letters, numbers, dots and dashes only.');
      if (v.length < 8) throw new Error('A User ID must be at least 8 characters, or an email address.');
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
      // b77 (self-healing): storefront access saved separately so a normal profile save works even before b77 is applied.
      if (req.body.storefront_access) { try { await query('UPDATE identities SET storefront_access=$1 WHERE identity_id=$2', [req.body.storefront_access, id]); } catch (_) {} }
      // b114 (self-healing): CATALOGUE VISIBILITY — publishing is an explicit act. Whitelisted, never free text, and
      // saved separately so a normal profile save still works before b114 is applied.
      // ── PUBLISHING IS A CHOICE, BOUNDED BY A CAP (2026-08-06) ────────────────────────────────────────────────
      // Athi: "even a private catalogue can be made public — how do we protect one, say it is done from the
      // networking side? The entity should be private, not public."
      //
      // Until now this was a whitelist and a write: no plan check, no operator check. `assertPublicAllowed()` had
      // sat in routes/governance.js since it was written, exported, with zero callers and a comment saying "not
      // wired yet". The cap is now resolved from the OPERATOR's provisioning (params_override.caps) and then the
      // plan, and a refusal names who refused — an unattributable refusal reads as a bug.
      if (['public', 'private', 'network'].includes(req.body.catalogue_visibility)) {
        const capInfo = await visibilityCapFor(id);
        const verdict = visibilityCap.check(req.body.catalogue_visibility, capInfo);
        if (!verdict.ok) {
          return res.status(verdict.status).json({ error: 'Not allowed', message: verdict.message, capped_by: capInfo.by });
        }
        /**
         * ⚠️ THIS `catch` USED TO SWALLOW EVERYTHING, and it cost twenty minutes and hid my own mistake.
         *
         * b114 added `CHECK (catalogue_visibility IN ('public','private'))`. When `network` was introduced, the
         * UPDATE started failing on that constraint — and the bare catch ate it, so the API answered
         * `200 {"message":"Profile updated"}` while nothing was written. The write path looked correct, the read
         * path looked correct, and the value never moved. Exactly the shape this codebase keeps producing:
         * something reports success and the outcome is absent.
         *
         * The catch exists for ONE legitimate reason — self-healing when b114 has not been applied and the column
         * does not exist (42703). That case, and only that case, stays silent.
         */
        try {
          await query('UPDATE identities SET catalogue_visibility=$1 WHERE identity_id=$2', [req.body.catalogue_visibility, id]);
        } catch (e) {
          if (e && e.code === '42703') { /* pre-b114: no column yet — genuinely nothing to do */ }
          else if (e && e.code === '23514') {
            return res.status(409).json({ error: 'Not stored',
              message: `This database does not accept "${req.body.catalogue_visibility}" yet — apply migration b115.`,
              code: 'VISIBILITY_NOT_MIGRATED' });
          } else {
            return res.status(500).json({ error: 'Not stored', message: safeErr(e) });
          }
        }
      }
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
    // sealed = protected (governance/root/Help) — delete flows MUST refuse it (b43). Enforce it here.
    const s = await query(`SELECT sealed FROM identities WHERE identity_id = $1`, [req.params.id]);
    if (s.rows[0] && s.rows[0].sealed) return res.status(403).json({ error: 'Forbidden', message: 'Protected (sealed) entity — cannot be erased.' });
    await query(`UPDATE identities SET is_erased=true, erased_at=NOW(), status='erased' WHERE identity_id=$1`, [req.params.id]);
    res.json({ message: 'Identity tombstoned', id: req.params.id });
  } catch (err) { res.status(500).json({ error: 'Erase failed', message: safeErr(err) }); }
});

module.exports = router;
