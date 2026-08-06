// server.js — Chit and Bridge MVP — Main Server
// Version 1.0 — June 2026
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const log     = require('./lib/logger');

const app  = express();
const PORT = process.env.PORT || 3000;

// Fail fast on a missing/weak JWT_SECRET — auth integrity depends entirely on it (see the P0 isolation
// invariant). In production a bad secret aborts boot; in dev it warns loudly.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  const msg = 'JWT_SECRET is missing or shorter than 32 chars';
  if (process.env.NODE_ENV === 'production') { log.critical('boot aborted', { reason: msg }); process.exit(1); }
  else log.warn('weak JWT_SECRET', { reason: msg + ' — set a strong JWT_SECRET before any real deploy' });
}

// Fixed test OTP guard. DEV_OTP pins every OTP to a constant (e.g. 123456) for testing — a critical auth hole if
// it ever reaches a real environment. KNOWN + DEFERRED decision: allowed in dev/test ONLY during exploration (the
// team uses 123456 to avoid needing a real inbox per test entity); the registration/login rework + real OTP delivery
// lands at the UAT cutover, so DEV_OTP is HARD-BLOCKED (fail-closed) in uat/staging/live — it cannot silently ship.
// The whole OTP posture is decided in ONE place now (lib/dev-otp.js) — the sealed-env list, the three fixed codes,
// and whether a code may ever be echoed in an HTTP response. This guard refuses to boot in a state that LOOKS sealed
// but leaks, so the cutover cannot be half-done: naming a sealed env without unsetting DEV_OTP *and* proving real
// delivery (OTP_EMAIL_ENABLED=true) is fatal, not a warning.
{
  const devOtp = require('./lib/dev-otp');
  const errs = devOtp.otpPostureErrors();
  if (errs.length) { errs.forEach((e) => log.critical('boot aborted', { reason: e })); process.exit(1); }
  if (devOtp.armed()) {
    log.warn('fixed test OTPs active', { reason: 'DEV_OTP is set — entity/customer/connector OTPs are FIXED and are '
      + 'echoed in API responses. Dev/test ONLY. To seal: see the checklist at the top of lib/dev-otp.js.' });
  }
}

// Trust Railway's proxy
app.set('trust proxy', 1);

// ── CORS — locked to known origins ───────────────────────────
// Extend/override the allowlist via ALLOWED_ORIGINS (comma-separated) on the host.
// Requests with no Origin header (server-to-server, curl, PowerShell smoke tests) are allowed.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://chitbridge-web.vercel.app,http://localhost:5173,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = {
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],  // Idempotency-Key: offline-outbox mutations (edit/delete/status/dispute/…) send it → CORS must allow it or the browser blocks the whole request
  credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ── Security middleware ───────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
}));

// Parse JSON
app.use(express.json({ limit: '8mb' }));   // raised for base64 attachment uploads
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

// Request id for traceability — propagate an incoming id or mint one; echo it back; expose as req.id.
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || require('crypto').randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
});

// Request logger (leveled — quiet with LOG_LEVEL=warn, verbose with LOG_LEVEL=debug)
app.use((req, res, next) => {
  log.info('request', { id: req.id, method: req.method, path: req.path, origin: req.headers.origin || null });
  next();
});

// Rate limiting — higher limit in dev/testing
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '500'),
  message: { error: 'Too many requests', message: 'Please try again in 15 minutes' }
});
app.use('/api/', limiter);

// Stricter limit on auth endpoints — blunts OTP / PIN brute force (override via AUTH_RATE_LIMIT_MAX).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '30'),
  message: { error: 'Too many attempts', message: 'Too many login/OTP attempts — please try again in 15 minutes' }
});
app.use(['/api/entities/register', '/api/entities/verify', '/api/actors/login', '/api/actors/set-pin'], authLimiter);

// Customer-facing catalogue / order / OTP — rate-limit to blunt OTP spam + brute force on the no-login surface
// (covers browse + order/start + order/confirm + login/verify; override via CATALOGUE_RATE_LIMIT_MAX).
const catalogueLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.CATALOGUE_RATE_LIMIT_MAX || '60'),
  message: { error: 'Too many requests', message: 'Too many attempts — please try again in a few minutes' }
});
app.use('/api/catalogue', catalogueLimiter);

// Assistant LLM proxy — rate-limit the tier-1 seam (blunts cost/abuse on a model-backed endpoint).
// If this is hit too hard, the client simply falls through to its own library floor (no hard failure).
const assistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.ASSIST_RATE_LIMIT_MAX || '40'),
  message: { error: 'Too many requests', message: 'Too many assistant requests — please try again shortly.' }
});
app.use('/api/assist', assistLimiter);

// ── Idempotency (offline outbox, Phase 2) ─────────────────────
// Opt-in per request (Idempotency-Key header) + self-healing (no-op until b109 is run). Placed before the routers so a
// replayed mutation short-circuits to the recorded response and never re-executes the handler. Non-mutating verbs pass through.
app.use('/api', require('./middleware/idempotency'));

// ── Routes ───────────────────────────────────────────────────
const entitiesRouter    = require('./routes/entities');
const connectionsRouter = require('./routes/connections');
const chitsRouter       = require('./routes/chits');
const schemasRouter     = require('./routes/schemas');
const actorsRouter      = require('./routes/actors');
const connectorsRouter  = require('./routes/connectors');   // L3.1 connector actors + connections
const foldersRouter     = require('./routes/folders');      // b63 folders — per-entity chit-organising tree
const relationshipsRouter = require('./routes/relationships');
const catalogueRouter   = require('./routes/catalogue');
const productsRouter    = require('./routes/products');
const governanceRouter  = require('./routes/governance');
const attachmentsRouter = require('./routes/attachments');

app.use('/api/entities',    entitiesRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/chits',       chitsRouter);
app.use('/api/schemas',     schemasRouter);
app.use('/api/actors',      actorsRouter);
app.use('/api/connectors',  connectorsRouter);
app.use('/api/folders',     foldersRouter);
app.use('/api/relationships', relationshipsRouter);
app.use('/api/catalogue',   catalogueRouter);
app.use('/api/products',    productsRouter);
app.use('/api/governance',  governanceRouter);
app.use('/api/attachments', attachmentsRouter);
app.use('/api/network-design', require('./routes/network-design'));   // b111 — per-entity design persistence (RLS)
app.use('/api/catalogue-face', require('./routes/catalogue-face'));    // b112 — per-entity catalogue face persistence (RLS)

// ── NET (feat/net-full): network + catalogue on /api/network ──
// cb_chit chit-loop RETIRED in consolidation: all chit writes live on /api/chits (chit_header).
// The cb_chit TABLE is kept dormant; src/services/chit still backs network.js's
// disconnect settle-guard (edgeHasOpenChit), so the service stays — only the route is gone.
// (jest uses src/app.js; this exposes the same routers on the live server.js entry)
app.use('/api/network', require('./src/routes/network'));
// ARCHIVED 2026-08-06 — the cb_* catalogue routes. A network aggregates its members' catalogues and holds
// none of its own; these served a third, unread catalogue model. See src/routes/catalogue.js and
// SPEC-network-storefront.md §6. cb_entity/cb_edge (the network TREE) stays mounted on the line above.
// app.use('/api/network', require('./src/routes/catalogue'));

// ── Public showcase API for the /tour page (SimulatorPage) ───
app.use('/api/simulator', require('./routes/simulator'));

// ── Derived notification feed (from state_log; no notifications table) ───
app.use('/api/notifications', require('./routes/notifications'));

// ── Assistant tier-1 LLM proxy (STUB — model key stays server-side; client falls through to its library floor) ───
app.use('/api/assist', require('./routes/assist'));

// ── Capture connector — inbound channels (WhatsApp/email/web) → capture → AI structure → confirm → chit (b104) ───
app.use('/api/capture', require('./routes/capture'));

// ── "Know your business" value panel — Yourself/Position/Risk (free, computed from owned data) + Field (metered, b107) ───
app.use('/api/kyb', require('./routes/kyb'));

// ── Authority-forms engine — define → resolve (field×source-precedence + provenance) → issue (freeze) → sign (b108) ───
app.use('/api/forms', require('./routes/forms'));

// ── Static HTML pages (legacy — React replaces these) ────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    platform: 'Chit and Bridge',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', message: `${req.method} ${req.path} does not exist` });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  // Full detail stays in server logs (with the request id for traceability); client gets a generic message.
  log.error('unhandled', { id: req.id, path: req.path, err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Server error', message: 'Something went wrong' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Chit and Bridge API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

module.exports = app;
