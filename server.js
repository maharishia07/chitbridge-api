// server.js — Chit and Bridge MVP — Main Server
// Version 1.0 — June 2026
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

// Fail fast on a missing/weak JWT_SECRET — auth integrity depends entirely on it (see the P0 isolation
// invariant). In production a bad secret aborts boot; in dev it warns loudly.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  const msg = 'JWT_SECRET is missing or shorter than 32 chars';
  if (process.env.NODE_ENV === 'production') { console.error('FATAL:', msg); process.exit(1); }
  else console.warn('WARNING:', msg, '— set a strong JWT_SECRET before any real deploy.');
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
  allowedHeaders: ['Content-Type', 'Authorization'],
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logger
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} — origin: ${req.headers.origin || 'none'}`);
  next();
});

// Rate limiting — higher limit in dev/testing
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '500'),
  message: { error: 'Too many requests', message: 'Please try again in 15 minutes' }
});
app.use('/api/', limiter);

// ── Routes ───────────────────────────────────────────────────
const entitiesRouter    = require('./routes/entities');
const connectionsRouter = require('./routes/connections');
const chitsRouter       = require('./routes/chits');
const schemasRouter     = require('./routes/schemas');
const actorsRouter      = require('./routes/actors');
const relationshipsRouter = require('./routes/relationships');
const catalogueRouter   = require('./routes/catalogue');
const productsRouter    = require('./routes/products');
const governanceRouter  = require('./routes/governance');

app.use('/api/entities',    entitiesRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/chits',       chitsRouter);
app.use('/api/schemas',     schemasRouter);
app.use('/api/actors',      actorsRouter);
app.use('/api/relationships', relationshipsRouter);
app.use('/api/catalogue',   catalogueRouter);
app.use('/api/products',    productsRouter);
app.use('/api/governance',  governanceRouter);

// ── NET (feat/net-full): network + catalogue on /api/network ──
// cb_chit chit-loop RETIRED in consolidation: all chit writes live on /api/chits (chit_header).
// The cb_chit TABLE is kept dormant; src/services/chit still backs network.js's
// disconnect settle-guard (edgeHasOpenChit), so the service stays — only the route is gone.
// (jest uses src/app.js; this exposes the same routers on the live server.js entry)
app.use('/api/network', require('./src/routes/network'));
app.use('/api/network', require('./src/routes/catalogue'));

// ── Public showcase API for the /tour page (SimulatorPage) ───
app.use('/api/simulator', require('./routes/simulator'));

// ── Derived notification feed (from state_log; no notifications table) ───
app.use('/api/notifications', require('./routes/notifications'));

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
  console.error('Unhandled error:', err);   // full detail stays in server logs only
  // Never leak internal error text to the client — prevents info disclosure on any env.
  res.status(500).json({ error: 'Server error', message: 'Something went wrong' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Chit and Bridge API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

module.exports = app;
