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
const { resolveEntityGovernance, currencyRefusal } = require('../lib/govresolve');   // resolve the entity's governance from attributes

// ⚠️ ONE generator (lib/bridgeid.js). This was SIX copies and the CSPRNG hardening reached only one of them —
//    not this one, which is where every entity's bridge id is minted. Same call site, now a strong PRNG.
const generateBridgeId = require('../lib/bridgeid').generateBridgeId;
const schema = require('../lib/schema');   // b176 — never name a column from an unrun migration
const handleLib = require('../lib/handle');   // slug + check — the same rules the network root uses

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
    body('user_id').optional().trim(),   // validated by handleLib.checkRoot — one rule, not a second regex
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
          /**
           * ⭐⭐ THE USER ID IS CHOSEN AT REGISTRATION, AND ONLY HERE. Athi, 2026-08-19:
           *
           *   *"through the registration page, only the entity registers. Employee or network or anyone else can
           *   never register through the registration screen."*  ·  *"the user id registered cannot be changed.
           *   Once registered, through IAM they can change the display name — anything, any format."*
           *
           * ⚠️ IT USED TO BE LEFT NULL. Registration wrote display_name and nothing else, so EVERY entity began
           * life without the one identifier its login, its network root and every supplier reference derive from.
           * Screens then filled the empty slot with a guess made from the business name — and a guess rendered
           * like an identifier gets read as one. That is the whole "platform-of-platform" confusion, at its source.
           *
           * ⚠️ SET ONCE. This INSERT is the only place an entity's user_id is ever written from a person's input;
           * PATCH /profile refuses to overwrite a value that exists (see below). The Gmail rule, at the write.
           */
          const wanted = String(req.body.user_id || '').trim() || handleLib.slug(display_name);
          const verdict = handleLib.checkRoot(wanted);
          if (!verdict.ok) {
            return res.status(400).json({
              error: 'Choose a User ID', code: 'USER_ID_INVALID', message: verdict.reason,
              suggestion: handleLib.checkRoot(handleLib.slug(display_name)).ok ? handleLib.slug(display_name) : null,
            });
          }
          /**
           * ⚠️ UNIQUE PLATFORM-WIDE, and it must be REFUSED here rather than left to the index. The unique index on
           * lower(user_id) would raise a 500 that says nothing a person can act on; this says who to be instead.
           */
          const taken = await query('SELECT 1 FROM identities WHERE LOWER(user_id) = $1', [verdict.value]);
          if (taken.rows.length) {
            return res.status(409).json({
              error: 'That User ID is taken', code: 'USER_ID_TAKEN',
              message: '"' + verdict.value + '" is already registered. Choose another — it cannot be changed later.',
            });
          }

          await query(
            `INSERT INTO identities (identity_id, bridge_id, display_name, email, identity_type, status, user_id)
             VALUES ($1, $2, $3, $4, 'entity', 'pending', $5)`,
            [identity_id, bridge_id, display_name, email, verdict.value]
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
      /**
       * ⚠️⚠️ THE SEARCH DID NOT MATCH user_id — the one thing it should have matched first.
       *
       * Athi, 2026-08-19: *"a supplier can add this entity by alpha-timers only, not with Alpha timers."* He is
       * right about the principle, and the code was worse than he thought: typing `alpha-timers` found NOTHING.
       * It matched display_name and bridge_id only, so the ONLY ways to find a business were its NAME — which
       * may repeat — or a ten-character generated code nobody remembers.
       *
       * ⭐ user_id is now matched too, and ORDERED FIRST, so an exact handle wins over a fuzzy name match. The
       * name stays searchable because finding is not the same act as identifying: you may look someone up by
       * name, but what gets stored is always their bridge_id.
       */
      `SELECT identity_id, bridge_id, display_name, user_id, created_at
       FROM identities
       WHERE (LOWER(user_id) LIKE LOWER($1) OR LOWER(display_name) LIKE LOWER($1) OR LOWER(bridge_id) LIKE LOWER($1))
       AND identity_type = 'entity' AND status = 'active'
       AND COALESCE(sealed, false) = false
       AND identity_id != $2
       /**
        * An exact handle beats a fuzzy name — someone who typed the identifier knew what they wanted.
        * ⚠️ $3, NOT $2. $2 is the CALLER'S identity_id (the "not me" filter); comparing a user_id against it
        * would never match, and the ordering would be silently inert — a ranking that looks implemented and
        * ranks nothing. Caught by reading the parameter list rather than the query.
        */
       ORDER BY (LOWER(user_id) = LOWER($3)) DESC, display_name LIMIT 10`,
      [`%${q}%`, req.identity.identity_id, q]
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
const policyEntity = (req) => auth.entityOf(req);

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
    /* ⚠️⚠️ THE PROBE BELONGS IN THIS FUNCTION. I first put it above the /search query — a different route —
       so _tzCol was a ReferenceError here and defined where nothing used it. Same borrowed-variable class as
        this afternoon, and node --check cannot see either. b176 may not be run; a missing column is
       42703 and throws the whole query. */
    const _tzCol = await schema.hasColumn('identities', 'timezone');
    const _supCol = await schema.hasColumn('identities', 'supplies');
    /**
     * ⭐⭐ THREE MORE COLUMNS OFF THE SAME ROW, PROBED — and they used to be TWO EXTRA ROUND TRIPS.
     *
     * Athi, 2026-08-21: *"in the code if we make multiple rounds of read, that has to be addressed."* Measured
     * by tools/round-trips.cjs: `/me` made EIGHT sequential round trips, and FOUR of them were SELECTs against
     * `identities` — the main one, then `capabilities`, then `storefront_access`, then `locale_prefs/ui_prefs`.
     * Three of the four read the SAME ROW as each other. This is the hottest endpoint on the platform: every
     * screen calls it on every boot.
     *
     * ⚠️ THEY WERE SEPARATE FOR A GOOD REASON THAT NO LONGER APPLIES, and the old comment says so plainly:
     * *"this code deploys BEFORE b165 runs — folding the column into the main query would 500 every boot in the
     * window between the two."* That was correct. It is also exactly what `lib/schema.js` was built to solve
     * this morning, after a `SELECT access_level` before b173 took co-assist sign-in down: probe what the
     * database HAS, then name only that. The two lines above already do it for `timezone` and `supplies`.
     *
     * ⚠️ PROBED INDIVIDUALLY, NOT AS A GROUP. b166 may not have run where b165 has — `locale_prefs` can exist
     * while `ui_prefs` does not, which is precisely the case the old nested fallback was written for. One probe
     * per column keeps that guarantee; a single "are the prefs there" flag would lose it.
     *
     * ⚠️ `capabilities` IS DELIBERATELY LEFT OUT. It is read for `auth.entityOf(req)` — the PARENT for an actor
     * — so for a co-assist it is a DIFFERENT ROW, and folding it in would silently hand an employee their own
     * empty capability list instead of their employer's. A round trip saved by answering the wrong question is
     * not a saving.
     */
    const _sfCol = await schema.hasColumn('identities', 'storefront_access');
    const _lpCol = await schema.hasColumn('identities', 'locale_prefs');
    const _upCol = await schema.hasColumn('identities', 'ui_prefs');
    /* ⚠️ AND THE VISIBILITY TRIO — a THIRD read of the same row, for `catalogue_visibility, plan,
       params_override`. Same identity_id, same request: three round trips to read one row. */
    const _cvCol = await schema.hasColumn('identities', 'catalogue_visibility');
    const _plCol = await schema.hasColumn('identities', 'plan');
    const _poCol = await schema.hasColumn('identities', 'params_override');
    const result = await query(
      `SELECT identity_id, bridge_id, display_name, email, user_id, self_copy_pref, dispute_handler_actor_id, country, currency_code, created_at, last_active_at,
              gstn, is_verified, logo_url, address, business_status,
              purpose, sort_order, address, city, lat, lng, service_km,   -- b117/b118/b119
              actor_key, phone${_tzCol ? ', timezone' : ''}${_supCol ? ', supplies' : ''}${_sfCol ? ', storefront_access' : ''}${_lpCol ? ', locale_prefs' : ''}${_upCol ? ', ui_prefs' : ''}${_cvCol ? ', catalogue_visibility' : ''}${_plCol ? ', plan' : ''}${_poCol ? ', params_override' : ''},
              /* ⚠️ b176 MAY NOT BE RUN. A missing column is 42703 and throws the WHOLE query — the mistake that
                 took co-assist sign-in down this morning. Selected through the probe, never named blindly. */
              /* ⭐ The parent's handle, so an employee can be shown the login they actually type: key@business.
                 A correlated subselect rather than a second round trip — this route is already on the slow
                 path Athi measured at 9.3s to open a chit, and an extra query for a label is not affordable. */
              (SELECT p.user_id FROM identities p WHERE p.identity_id = identities.parent_entity_id) AS parent_user_id
       FROM identities WHERE identity_id = $1`,
      [req.identity.identity_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Entity not found' });
    /* ⚠️ DECLARED HERE, BESIDE THE QUERY IT COMES FROM. It was declared 40 lines lower, next to the first
       thing that used it — and the moment a second reader appeared above that point, `const` (not hoisted)
       threw a TDZ error. A binding belongs with its source, not with its first consumer. */
    const _me = result.rows[0] || {};

    /**
     * ⭐⭐ AN EMPLOYEE MUST BE ABLE TO SEE THEIR OWN ACCESS. Athi, 2026-08-20: *"in the employee profile, there
     * is nothing mentioned about his access level… which one he belongs to."*
     *
     * ⚠️ The screen could not show it even if it wanted to: this response carried no hat and no access_level,
     * so the ONE fact an employee most needs about themselves — may I change things, may I answer the other
     * party — was the one fact the API withheld. A permission you cannot see is one you cannot ask to have
     * corrected, which is the whole point of "request your manager to modify if required".
     *
     * These come from req.identity, which middleware/auth.js has already read FROM THE DATABASE on this very
     * request — never from the token — so a demotion shows here immediately, and it costs no round trip.
     */
    /**
     * ⭐⭐ IS THIS ENTITY'S NETWORK STOREFRONT LIVE — DERIVED, NEVER STORED. Athi, 2026-08-20: *"if you change
     * the option to network, by default it is a PRIVATE network, so no storefront. But if you have any store
     * under you is public, then the storefront will be public. This way we are avoiding another status field…
     * otherwise I was wondering how to make a private network."*
     *
     * ⭐ A PRIVATE NETWORK NEEDS NO FLAG — it is simply a network where nobody has published. The question
     * "is this network public?" already has an answer in the data, and storing a second answer beside it
     * creates the one thing this codebase keeps paying for: two facts that can disagree.
     *
     * ⚠️ ONE READ, NOT N. Athi, 2026-08-19: *"again it should not be n reads, it has to be one read only."*
     * This is a single COUNT riding on a request that was already happening — not a walk of the tree.
     *
     * ⭐ MEMBERSHIP IS IN THE HANDLE, so there is nothing to join. lib/handle.js defines a network node as
     * `root.node`, so every store under `athi` has a user_id beginning `athi.` — which is exactly what a
     * prefix match asks for.
     *
     * ⚠️ THE PREFIX IS ESCAPED. A user_id may not contain % or _ today (checkRoot allows letters, numbers and
     * dashes), but a LIKE built from user input without an ESCAPE clause is a habit that outlives the
     * validator that made it safe.
     */
    if (req.identity.identity_type !== 'actor' && result.rows[0].user_id) {
      try {
        const prefix = String(result.rows[0].user_id).toLowerCase().replace(/([%_\\])/g, '\\$1') + '.';
        const nc = await query(
          `SELECT count(*)::int AS n FROM identities
            WHERE LOWER(user_id) LIKE $1 || '%' ESCAPE '\\'
              AND identity_type = 'entity' AND status = 'active'
              AND catalogue_visibility = 'public'`,
          [prefix]);
        result.rows[0].network_public_count = nc.rows[0] ? nc.rows[0].n : 0;
      } catch (_) {
        /* ⚠️ ABSENT, NOT ZERO. A failed count must not render as "nothing under you is public" — that is a
           definite statement, and this is the absence of one. The screen shows nothing rather than a lie. */
        result.rows[0].network_public_count = null;
      }
    }

    if (req.identity.identity_type === 'actor') {
      result.rows[0].identity_type = 'actor';
      result.rows[0].hat           = req.identity.hat || null;
      result.rows[0].access_level  = req.identity.access_level || null;
      result.rows[0].whole_entity  = req.identity.whole_entity === true;
      result.rows[0].parent_entity_id = req.identity.parent_entity_id || null;
    } else {
      result.rows[0].identity_type = 'entity';
    }

    await query('UPDATE identities SET last_active_at = NOW() WHERE identity_id = $1', [req.identity.identity_id]);
    // the ENTITY's capability selection (add-ons; core is implicit) — drives the itemised capability toggles. [b55/connector]
    // Defensive: defaults to [] if the b55 column isn't present in this environment.
    let capabilities = [];
    let capabilities_debug = 'ok';
    try {
      const eid = auth.entityOf(req);
      /**
       * ⭐⭐ FOR AN ENTITY THIS IS THE ROW WE ALREADY HAVE. `entityOf()` returns `parent_entity_id ||
       * identity_id` — so for an entity caller it IS `req.identity.identity_id`, and this was a second SELECT
       * against `identities` for the row the main query fetched a few lines above. Entities are the common
       * case; the extra trip was being paid on almost every request to the platform's hottest endpoint.
       *
       * ⚠️ AN ACTOR STILL QUERIES, AND THAT IS NOT AN OVERSIGHT. For a co-assist `entityOf()` is the PARENT —
       * a different row entirely. Reading `_me.capabilities` for them would hand an employee their own (empty)
       * capability list instead of their employer's, silently removing every capability-gated nav item. A round
       * trip saved by answering the wrong question is not a saving.
       */
      const c = (eid === req.identity.identity_id && _me)
        ? { rows: [_me] }
        : await query('SELECT capabilities FROM identities WHERE identity_id = $1', [eid]);
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
    try { governance = await resolveEntityGovernance(auth.entityOf(req)); } catch (_) {}
    /**
     * ⭐⭐ READ FROM THE ROW WE ALREADY HAVE — these were TWO EXTRA ROUND TRIPS against `identities` for the
     * SAME identity_id the main SELECT above just fetched. On the hottest endpoint on the platform.
     *
     * ⚠️ THE SELF-HEALING DEFAULTS ARE UNCHANGED AND THEY ARE NOT COSMETIC. Absent `storefront_access`,
     * 'browse' is what b77 established. Absent `locale_prefs`, `{}` means "never chosen", which CBLocale.hydrate
     * treats as "keep what this device has" — NOT as "chose the default". A column that is missing and a column
     * that is empty must keep answering differently, and folding the reads together must not blur them.
     *
     * ⚠️ THE PARTIAL-MIGRATION CASE STILL DEGRADES TO LESS, NEVER TO NOTHING. The old code nested a
     * try/catch so that b166 missing where b165 had run still returned the language. Per-column probes give the
     * same guarantee structurally: `locale_prefs` is selected when it exists whether or not `ui_prefs` does.
     */
    const storefront_access = _sfCol ? (_me.storefront_access || 'browse') : 'browse';
    const locale_prefs = (_lpCol && _me.locale_prefs) || {};
    const ui_prefs     = (_upCol && _me.ui_prefs) || {};
    // b114 (self-healing): is this entity's catalogue exposed at all? Pre-b114 there was no such setting and adoption
    // silently published, so absent the column we report 'public' — the behaviour that was actually in force.
    // The EFFECTIVE visibility, plus the cap that produced it. Reporting the stored flag alone would let a capped
    // entity's own profile read 'public' while the world correctly sees nothing — the owner would have no way to
    // understand why their link is dead.
    let catalogue_visibility = 'public';
    let visibility_cap = { max: 'public', by: null, enforced: false, reason: '' };
    try {
      /* ⭐ THE ROW IS ALREADY IN HAND — see the probe note above. This was the THIRD SELECT against `identities`
         for the same identity_id inside one request. */
      const row = _me;
      let planMenu = null;
      try { const c = await require('./governance').loadActiveConstitution(); planMenu = c && c.plan_menu; } catch (_) {}
      visibility_cap = visibilityCap.capOf({ plan: row.plan, planMenu, paramsOverride: row.params_override || {} });
      catalogue_visibility = visibilityCap.effective(row.catalogue_visibility, visibility_cap);
    } catch (_) { /* pre-b114 → the default above */ }
    const entityOut = Object.assign({}, result.rows[0], { capabilities, capabilities_debug, governance, storefront_access, catalogue_visibility, visibility_cap, locale_prefs, ui_prefs });
    /**
     * ⭐⭐ ?include= — ONE HTTP ROUND TRIP INSTEAD OF FOUR. Athi, 2026-08-21: *"why do we need a round trip,
     * can't the js send all the required information in one shot and get it from the background? We have built
     * most of the stuff as lazy load, and for each lazy load if we have to do a round trip, that will feel like
     * waiting forever."*
     *
     * ⚠️⚠️ HE IS POINTING AT THE BIGGER OF THE TWO COSTS, AND I HAD BEEN FIXING THE SMALLER ONE. A database
     * round trip is 1–5ms; an HTTP round trip from India to Railway is 200–400ms. Painting one profile made
     * FOUR of them — `/entities/me`, `/governance/readiness`, `/channels`, `/governance/profile` — so over a
     * second of pure network before the screen was complete. Collapsing eight DB queries into five saved ~15ms.
     * This saves about a second.
     *
     * ⭐ INCLUDES, NOT A SCREEN-SHAPED ENDPOINT. A `GET /screen/profile` would bake the UI's current layout into
     * the API, and twelve of those would make every re-layout a server change. The client names what it wants;
     * the server has no idea a "profile screen" exists.
     *
     * ⚠️ THE SAME LIBRARY FUNCTION THE STANDALONE ROUTE CALLS — `lib/readiness`, `lib/channels`, `lib/profile`.
     * Not a copy. A bundle that reimplements its parts is how the bundled answer and the direct answer start
     * disagreeing, and the direct routes stay because other callers use them.
     *
     * ⚠️ ONE INCLUDE FAILING MUST NOT COST THE OTHERS OR THE ENTITY. Each is caught alone and reports its own
     * error in place: the profile still paints without its channels, which is exactly how it behaves today when
     * one of the four separate fetches fails. Degrade to less, never to nothing.
     */
    const want = String(req.query.include || '').split(',').map((x) => x.trim()).filter(Boolean);
    const included = {};
    if (want.length) {
      const eid = auth.entityOf(req);
      const LOAD = {
        readiness: () => require('../lib/readiness').resolveReadiness(eid),
        channels:  () => require('../lib/channels').listChannels(eid),
        vault:     () => require('../lib/profile').getProfile(eid),
      };
      /* ⚠️ SEQUENTIAL, NOT Promise.all. The pool is max:10 and these each open their own transaction — three
         in parallel per request means two concurrent readers want six connections. The win here is removing
         three HTTP round trips, not three DB ones; parallelising the small cost to risk the pool is a bad
         trade. See the note at the top of tools/round-trips.cjs. */
      for (const k of want) {
        if (!Object.prototype.hasOwnProperty.call(LOAD, k)) { included[k] = { error: 'unknown include' }; continue; }
        try { included[k] = await LOAD[k](); }
        catch (e) { included[k] = { error: safeErr(e) }; }
      }
    }

    res.json({ entity: entityOut, capabilities, capabilities_debug, governance,
      ...(want.length ? { included } : {}) });
  } catch (err) {
    console.error('Profile error:', err.message);
    res.status(500).json({ error: 'Failed to get profile', message: safeErr(err) });
  }
});

/**
 * PATCH /entities/me/locale — store the PERSON's localisation choice (b165).
 *
 * ⚠️ SEPARATE FROM PATCH /profile, deliberately. /profile edits the BUSINESS — its GSTN, address, logo, shop
 * status. This edits how one human reads the screen. Folding a personal preference into the business profile
 * would mean a co-assist could not change their own language without write access to their employer's record,
 * and that an owner changing the firm's address would be touching the same object as their clerk's numerals.
 *
 * ⚠️ THE TARGET ROW IS NEVER TAKEN FROM THE BODY. identity_id comes from the verified token, so the only row a
 * caller can write is their own. There is no id parameter to get wrong.
 *
 * ⚠️ ICU VALIDATES THE VALUES, NOT A HAND-WRITTEN LIST. Every value here ends up inside an Intl constructor or a
 * BCP 47 -u- extension, and BCP 47 admits thousands of valid tags — a whitelist of the nine the screen currently
 * offers would reject the tenth the day someone needs it, and would drift out of step with CLDR every release.
 * So the shape is checked syntactically and the MEANING is checked by asking Intl to build the tag. If ICU can
 * format with it, it is a real subtag; if it throws, it is not. Adopting the standard's own validator beats
 * maintaining our opinion of what the standard contains.
 */
/**
 * PATCH /entities/me/prefs/:kind — store one of the PERSON's own preference sets (b165 locale · b166 ui).
 *
 * ⚠️ ONE HANDLER, TWO COLUMNS — generalised rather than copied. Two near-identical prefs endpoints would drift
 * the first time one of them gained validation, an audit line or a rate limit, and the one nobody remembered
 * would be the one carrying somebody's accessibility setting.
 *
 * ⚠️ SEPARATE FROM PATCH /profile, deliberately. /profile edits the BUSINESS — its GSTN, address, logo, shop
 * status. This edits how one human reads the screen. Folding a personal preference into the business profile
 * would mean a co-assist could not change their own language or contrast without write access to their
 * employer's record, and that an owner editing the firm's address would be touching the same object as their
 * clerk's numerals.
 *
 * ⚠️ THE TARGET ROW IS NEVER TAKEN FROM THE BODY. identity_id comes from the verified token, so the only row a
 * caller can write is their own. There is no id parameter to get wrong.
 *
 * ⚠️ AND THE COLUMN NAME IS NEVER TAKEN FROM THE URL. :kind selects an entry in PREF_SETS below; the column
 * string comes from that entry and never from req.params. An unknown kind is a 404, not a query. Interpolating
 * a caller-supplied identifier into SQL is exactly how a whitelist stops being a whitelist.
 */
const PREF_SETS = {
  /* The six keys the localisation layer reads. `lang` and `locale` are language tags; the rest are the UTS #35
     locale keywords, stored by their own subtag names so the column reads as the standard writes it. */
  locale: {
    column: 'locale_prefs',
    keys: ['lang', 'langs', 'region', 'locale', 'nu', 'hc', 'ca', 'fw'],
    /* ⚠️ `langs` IS A LIST, so it is the one key whose value may contain commas — RFC 4647 calls it a language
       priority list ("Tamil, then English, then Hindi"). Widening the generic pattern for every key to admit
       commas would have been the smaller edit and the wrong one: a comma has no business in a numbering system
       or an hour cycle, and a validator that accepts more than it needs to stops being a validator. */
    patterns: { langs: /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*(,[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*){0,2}$/ },
    /**
     * ⚠️ ICU VALIDATES THE VALUES, NOT A HAND-WRITTEN LIST. BCP 47 admits thousands of valid tags; a whitelist of
     * the nine the screen currently offers would reject the tenth the day someone needs it, and would drift out
     * of step with CLDR every release. Syntax is checked generically above; MEANING is checked by asking Intl to
     * build the tag. If it can format with it, it is a real subtag. Adopting the standard's own validator beats
     * maintaining our opinion of what the standard contains.
     */
    check(prefs) {
      try {
        const u = ['nu', 'hc', 'ca', 'fw'].filter((k) => prefs[k]).map((k) => `${k}-${prefs[k]}`);
        const tag = (prefs.locale || prefs.lang || 'en') + (u.length ? '-u-' + u.join('-') : '');
        new Intl.NumberFormat(tag);
        new Intl.DateTimeFormat(tag);
        return null;
      } catch (_) {
        return 'That combination is not a locale ICU recognises';
      }
    },
  },
  /**
   * Appearance. ⚠️ HERE A CLOSED LIST IS RIGHT, and the contrast with locale above is the point: these are OUR
   * enumerations, not a standard's. There is no external registry of themes that could add a sixteenth without
   * us knowing, so anything outside the list is a bug or a probe rather than a value we have not caught up with.
   * The theme itself stays open-ended in shape (a short slug) so shipping a new one needs no migration here.
   */
  ui: {
    column: 'ui_prefs',
    keys: ['theme', 'fs', 'motion'],
    check(prefs) {
      if (prefs.fs && !['s', 'm', 'l', 'xl'].includes(prefs.fs)) return 'Unknown text size';
      if (prefs.motion && !['auto', 'reduce', 'full'].includes(prefs.motion)) return 'Unknown motion setting';
      return null;
    },
  },
};

async function savePrefSet(req, res, kind) {
  /**
   * ⚠️ hasOwnProperty, NOT A TRUTHY LOOKUP — found by red-teaming this endpoint rather than by a failure.
   *
   * `PREF_SETS[kind]` walks the PROTOTYPE CHAIN, so `kind=__proto__`, `constructor`, `toString` and
   * `valueOf` all return something truthy and sail past the 404. None of them can write to a table — the
   * column comes from `set.column`, which is undefined for all of them — but the request then throws deep
   * inside the handler and surfaces as a 500 with a confusing log, when the honest answer is "no such set".
   *
   * The rule this is a case of: a whitelist consulted with bracket notation is not a whitelist unless the
   * lookup is own-property. That is the same class as interpolating a caller's string into SQL, one step back.
   */
  const set = Object.prototype.hasOwnProperty.call(PREF_SETS, kind) ? PREF_SETS[kind] : null;
  if (!set || !set.column) return res.status(404).json({ error: 'Unknown preference set' });
  try {
    const body = req.body || {};
    const prefs = {};

    for (const k of set.keys) {
      if (!(k in body)) continue;
      const v = String(body[k] == null ? '' : body[k]).trim();
      if (!v) continue;                                     // empty = "follow the default"; simply absent
      // Short alphanumeric-and-hyphen tokens. Anything else is not one of these values at all.
      const pat = (set.patterns && set.patterns[k]) || /^[A-Za-z0-9][A-Za-z0-9-]{0,34}$/;
      if (!pat.test(v)) {
        return res.status(400).json({ error: 'Bad preference', message: `${k} is not a valid value` });
      }
      prefs[k] = v;
    }

    const bad = set.check(prefs);
    if (bad) return res.status(400).json({ error: 'Bad preference', message: bad });

    await query(`UPDATE identities SET ${set.column} = $1 WHERE identity_id = $2`,
      [JSON.stringify(prefs), req.identity.identity_id]);
    res.json({ ok: true, kind, prefs, [set.column]: prefs });
  } catch (err) {
    /* ⚠️ Before the migration runs, the column does not exist. The person's preference still works from
       localStorage and visibly applied, so this must degrade to "not synced yet" rather than surfacing an error
       over a setting they can see took effect. Code ships before the migration, always. */
    if (new RegExp(set.column).test(String(err && err.message))) return res.json({ ok: false, pending: true });
    console.error('Prefs error (' + kind + '):', err.message);
    res.status(500).json({ error: 'Failed to save', message: safeErr(err) });
  }
}

router.patch('/me/prefs/:kind', auth, (req, res) => savePrefSet(req, res, String(req.params.kind || '')));

/* ⚠️ THE SHIPPED PATH, KEPT. Clients deployed before this refactor call /me/locale, and a browser holding a
   cached app.html will keep calling it after the API updates. Removing it would turn a tidy-up into an outage
   for exactly as long as those caches live. */
router.patch('/me/locale', auth, (req, res) => savePrefSet(req, res, 'locale'));

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
  /**
   * ⚠️ EVERY RULE SAYS WHAT IT WANTS. Athi, 2026-08-18: *"it says validation failed, not sure what it is. Need
   * to have explanation so people understand and update accordingly."*
   *
   * These had no messages, so express-validator answered "Invalid value" — which names neither the field nor
   * the rule and leaves someone re-typing at random. A validator that refuses without saying why has moved the
   * work from the code to the person, which is the wrong direction.
   */
  [ /**
     * ⚠️⚠️ THE NAME COULD NOT BE CHANGED AT ALL, and the screen had it exactly backwards. Athi, 2026-08-19:
     * *"if they are different, we should be providing an option to change the name here. Not the user id."*
     * *"and it looks reverse. That is the problem."*
     *
     * He is right twice. This app's own naming table says display_name is *"Change it any time — nothing cites
     * it, everything cites your ID"* — and yet PATCH /profile had no display_name validator and never wrote it,
     * while user_id, the handle every other name derives from, was a freely editable input.
     *
     * The MUTABLE fact was fixed and the LOAD-BEARING one was loose. Now the name is editable, as documented.
     */
    body('display_name').optional().trim().isLength({ min: 2, max: 255 })
      .withMessage('A business name is 2 characters or more.'),
    body('gstn').optional().trim().isLength({ max: 15 })
      .withMessage('A GSTIN is 15 characters — check for a missing or extra digit.'),
    body('logo_url').optional().trim(),
    body('address').optional().trim(),
    body('business_status').optional().isIn(['open','closed','away']),
    /* ⭐ b177-era: the entity may CHOOSE a currency. Bounded below against what the constitution permits —
       an enum here would freeze the set, and the whole point is that the layer decides it. */
    body('currency_code').optional().trim().isLength({ min: 3, max: 3 }),
    body('supplies').optional().isIn(['goods','services','both'])
      .withMessage('Shop status can be open, closed or away.'),
    body('storefront_access').optional().isIn(['browse','login'])
      .withMessage('Storefront access can be "browse" (open catalogue) or "login" (sign in first).'),
    body('self_copy_pref').optional().isIn(['both','sent','received'])
      .withMessage('Keep-a-copy can be both, sent or received.'),
    body('dispute_handler_actor_id').optional().isUUID()
      .withMessage('Pick a co-assist from the list — that is not a valid id.'),
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
    /**
     * ⚠️⚠️ THIS HAD ITS OWN PRIVATE REGEX, AND IT WAS THE LOOSE ONE. It allowed dots (`athi.clothing` — a name in
     * the NETWORK space), capitals (the uniqueness index is on lower(user_id)), emails, and CB-lookalikes that
     * impersonate a Bridge ID. Two rule sets for one identifier, disagreeing on five of nine cases, and the path a
     * PERSON types on was the permissive one. Now there is one: handleLib.checkRoot, applied in the handler so the
     * set-once check and the format check give the same answer.
     */
    body('user_id').optional().trim() ],
  validate,
  async (req, res) => {
    try {
      const id = req.identity.identity_id;
      /**
       * ⚠️⚠️ SET ONCE. Athi, 2026-08-19: *"the registered user id cannot be changed. Are you able to change your
       * Gmail id? The same way here."*
       *
       * The UPDATE below writes COALESCE(user_id, $5) — the existing value always wins — so a change is impossible
       * at the write even if this check were bypassed. But a write that SILENTLY ignores what you sent is its own
       * defect: the screen would report "saved" and the value would be unchanged. So say so, out loud, with 409.
       *
       * ⚠️ IT STILL ACCEPTS A VALUE WHEN THE COLUMN IS NULL. That is not a loophole, it is the REPAIR PATH —
       * entities registered before the User ID was collected have none, and must be able to set one once.
       */
      /**
       * ⚠️⚠️ ONLY AN ENTITY MAY CLAIM A USER ID. Athi's rule, 2026-08-19: *"through registration page, ONLY THE
       * ENTITY REGISTERS. Employee or network or anyone else can never register through the registration
       * screen."* An employee's login IS `key@entity` — they have no handle of their own and never should.
       *
       * ⚠️ THIS WAS OPEN AND I CONFIRMED IT LIVE: a co-assist PATCHed `{"user_id":"clerkstolen"}` here and got
       * 200. The route writes `req.identity.identity_id` — the CALLER'S row — so the value landed on the actor,
       * where it is read by nothing. That sounds harmless and is not: `user_id` carries a UNIQUE index across
       * ALL identities, it is the handle another business types to connect to you, and it is the root of every
       * network handle. An employee could therefore occupy a name globally — including one a real business
       * wants — and because the claim is SET-ONCE, nobody could ever take it back.
       *
       * ⭐ Refused here rather than in the validator, so the message can say WHY instead of "invalid".
       */
      if (req.identity.identity_type === 'actor'
          && req.body.user_id !== undefined && String(req.body.user_id).trim() !== '') {
        return res.status(403).json({
          error: 'Not permitted', code: 'USER_ID_ENTITY_ONLY',
          message: 'A User ID belongs to the business, not to a person. You sign in as '
                 + '"key@business" — that is your login, and it cannot be changed here.'
        });
      }

      let userId = null;
      if (req.body.user_id !== undefined && String(req.body.user_id).trim() !== '') {
        const cur = await query('SELECT user_id FROM identities WHERE identity_id = $1', [id]);
        const existing = cur.rows[0] && cur.rows[0].user_id;
        const verdict = handleLib.checkRoot(req.body.user_id);
        if (existing) {
          if (verdict.value !== String(existing).toLowerCase()) {
            return res.status(409).json({
              error: 'A User ID cannot be changed', code: 'USER_ID_IMMUTABLE',
              message: 'Your User ID is "' + existing + '". It is how people sign in and how everything else '
                     + 'is named, so it is fixed for the life of the business — like an email address. '
                     + 'The name above it can be changed to anything.',
              user_id: existing,
            });
          }
        } else {
          if (!verdict.ok) {
            return res.status(400).json({ error: 'Choose a User ID', code: 'USER_ID_INVALID', message: verdict.reason });
          }
          const taken = await query(
            'SELECT 1 FROM identities WHERE LOWER(user_id) = $1 AND identity_id <> $2', [verdict.value, id]);
          if (taken.rows.length) {
            return res.status(409).json({ error: 'That User ID is taken', code: 'USER_ID_TAKEN',
              message: '"' + verdict.value + '" is already registered. Choose another — it cannot be changed later.' });
          }
          userId = verdict.value;   // lowercase: the uniqueness index is on lower(user_id)
        }
      }
      // dispute_handler must be one of MY OWN actors — never an arbitrary identity.
      const handler = req.body.dispute_handler_actor_id || null;
      if (handler) {
        const ok = await query(
          `SELECT 1 FROM identities WHERE identity_id=$1 AND identity_type='actor' AND parent_entity_id=$2`,
          [handler, id]);
        if (!ok.rows.length) return res.status(400).json({ error: 'Bad handler', message: 'dispute_handler_actor_id must be an actor under your entity' });
      }
      /**
       * ⭐⭐ THE REGION BOUNDS THE SET; THE ENTITY PICKS ONE FROM IT. Athi, 2026-08-20: *"under region there can
       * be MULTIPLE currencies, one of the currency will be chosen."*
       *
       * ⚠️ SO IT IS VALIDATED HERE, NOT WITH AN ENUM. An isIn([...]) in the validator would freeze the list in
       * the route, and the whole point is that the CONSTITUTION decides it. A currency outside the envelope is
       * refused with the permitted set named, so the answer is actionable rather than "invalid".
       */
      /**
       * ⚠⚠ AND ONLY AN ENTITY MAY SET IT — the same hole as user_id, found the same way. This route writes
       * `req.identity.identity_id`, the CALLER'S row, so a co-assist submitting a currency wrote it onto their
       * own actor record where nothing reads it: the screen said saved and the business kept its old currency.
       * Silent and wrong is worse than refused.
       *
       * ⭐ Athi's rule, 2026-08-20: *"the access the employee cannot change — it should be done by entity."*
       * A trading currency is a fact about the business that every counterparty reads off a price.
       */
      if (req.identity.identity_type === 'actor' && req.body.currency_code !== undefined) {
        return res.status(403).json({
          error: 'Not permitted', code: 'CURRENCY_ENTITY_ONLY',
          message: 'The currency your prices are written in belongs to the business. Ask whoever runs the '
                 + 'account to change it in Settings.'
        });
      }

      let _cur = null;
      if (req.body.currency_code) {
        /* ⚠️ ONE ANSWERER — see lib/govresolve.currencyRefusal. The envelope check used to be written out here,
           and the SECOND place that sets this column (network-design/build) was added without it. */
        const refusal = await currencyRefusal(id, req.body.currency_code);
        if (refusal) return res.status(refusal.code === 'CURRENCY_MALFORMED' ? 400 : 422).json(
          Object.assign({ error: 'Currency not permitted' }, refusal));
        _cur = String(req.body.currency_code).toUpperCase();
      }
      await query(
        `UPDATE identities SET display_name=COALESCE($9,display_name), gstn=COALESCE($1,gstn), logo_url=COALESCE($2,logo_url), address=COALESCE($3,address),
                business_status=COALESCE($4,business_status),
                user_id=COALESCE(user_id,$5),
                self_copy_pref=COALESCE($6,self_copy_pref),
                dispute_handler_actor_id=COALESCE($7,dispute_handler_actor_id),
                currency_code=COALESCE($10,currency_code),
                supplies=COALESCE($11,supplies)
         WHERE identity_id=$8`,
        [req.body.gstn || null, req.body.logo_url || null, req.body.address || null,
         req.body.business_status || null, userId, req.body.self_copy_pref || null, handler, id,
         /* $10 — validated against the constitution above; null leaves it alone. */
         /* $9 — sanitised like every other free-text field. COALESCE means an absent name leaves it alone. */
         (req.body.display_name ? sanitise(req.body.display_name) : null),
         _cur, req.body.supplies || null]);
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

        /**
         * ⭐⭐ AND THE SAME ANSWER ON THE SCHEMA — without this, TURNING YOUR SHOP PUBLIC DID NOT MAKE IT PUBLIC.
         *
         * There are two visibility fields and the storefront reads the OTHER one:
         *   · `identities.catalogue_visibility` — what the owner chooses here, and the b114 gate
         *   · `entity_schemas.visibility`       — what `buildPublicView()` actually requires, and what the b49
         *                                          RLS policy on catalogue_items keys off
         *
         * ⚠️ THE SECOND ONE WAS A SNAPSHOT TAKEN AT REGISTRATION AND NEVER UPDATED AGAIN.
         * `schema-bootstrap.ensureDefaultSchema()` derives it from whatever the entity had declared at the moment
         * the schema was created — and it is called from inside REGISTRATION (this file, ~line 249), before the
         * owner has had any chance to choose. So `declared` is still the default and every entity onboarded
         * through the current flow got a PRIVATE schema, permanently.
         *
         * ⚠️ NOTHING IN THE FRONT END EVER CALLED `PATCH /api/schemas/visibility` — the route that would have
         * fixed it exists and had no caller anywhere in the app. Measured 2026-08-18: a fresh entity with
         * catalogue_visibility='public', a catalogue face and a product answered 404 on /api/catalogue/:bridge to
         * an anonymous visitor, to a buyer, AND to its own owner. `alpha` and `gamma` work only because their
         * schemas happened to be created public by an earlier path.
         *
         * ⚠️ THIS RELAXES VISIBILITY, WHICH IS WHY IT WAITED FOR ATHI'S EXPLICIT YES (2026-08-18) rather than
         * being slipped in with the diagnosis. It runs only AFTER `visibilityCap.check` has approved the value,
         * so a plan or operator cap still refuses first and this cannot widen anything the cap denied.
         *
         * ⚠️ THE MAPPING IS COPIED FROM schema-bootstrap DELIBERATELY, not re-invented: `network` counts as open
         * here because b114 decides WHO may read it, and a network-only warehouse its own siblings cannot see is
         * not protected, it is broken. Two places deciding this differently is the bug one layer down.
         */
        const schemaVisibility = (req.body.catalogue_visibility === 'public'
          || req.body.catalogue_visibility === 'network') ? 'public' : 'private';
        try {
          await query(
            `UPDATE entity_schemas SET visibility = $1
              WHERE entity_id = $2 AND status = 'active' AND is_default = true`,
            [schemaVisibility, id]);
        } catch (e) {
          /* An entity with no default schema yet is not an error — it gets one at first use, and
             ensureDefaultSchema will then read the value we just wrote above. Anything else is worth surfacing:
             silently swallowing it is exactly how the identities write hid its own failure for twenty minutes. */
          if (e && (e.code === '42703' || e.code === '42P01')) { /* pre-migration column/table — nothing to do */ }
          else return res.status(500).json({ error: 'Not stored', message: safeErr(e) });
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
