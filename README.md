# Chit and Bridge MVP

**The world's first guaranteed cross-organisation business execution platform**

Version 1.0 — June 2026

---

## What This Is

Chit and Bridge allows any two businesses to interact with each other — sending structured requests, receiving confirmed responses, and tracking execution — regardless of what internal systems they use.

This MVP proves the fundamental concept: three entities, a handshake, and a chit that flows between them with full state tracking.

---

## Quick Start

### Prerequisites

- Node.js v18 or above — [nodejs.org](https://nodejs.org)
- Git — [git-scm.com](https://git-scm.com)
- Supabase account — [supabase.com](https://supabase.com)
- Railway account — [railway.app](https://railway.app)
- Resend account — [resend.com](https://resend.com)

### 1. Clone and install

```bash
git clone https://github.com/YOUR-USERNAME/chitbridge-mvp.git
cd chitbridge-mvp
npm install
```

### 2. Set up database

- Go to your Supabase project
- Open SQL Editor
- Copy contents of `db/schema.sql`
- Paste and click Run
- You should see: `Schema created successfully | 6`

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```
DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
JWT_SECRET=your-minimum-32-character-secret
RESEND_API_KEY=re_your_resend_key
FROM_EMAIL=noreply@yourdomain.com
PORT=3000
NODE_ENV=development
```

### 4. Run locally

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000)

### 5. Run tests

```bash
npm test
```

---

## Deploy to Railway

```bash
# Push to GitHub first
git add .
git commit -m "Initial MVP build"
git push origin main

# Then in Railway:
# New Project → Deploy from GitHub → Select repo
# Add environment variables (same as .env)
# Generate domain → Share URL
```

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /health | None | Server health check |
| POST | /api/entities/register | None | Register entity — sends OTP |
| POST | /api/entities/verify | None | Verify OTP — returns JWT |
| GET | /api/entities/search | JWT | Search entities by name |
| GET | /api/entities/me | JWT | Get current entity profile |
| POST | /api/connections/request | JWT | Send connection request |
| GET | /api/connections/pending | JWT | Get pending requests |
| PUT | /api/connections/:id/respond | JWT | Accept or reject request |
| GET | /api/connections/list | JWT | Get accepted connections |
| POST | /api/chits/send | JWT | Send chit to one or more receivers |
| GET | /api/chits/inbox | JWT | Get inbox — lightweight |
| GET | /api/chits/:chit_id | JWT | Get full chit detail |
| PUT | /api/chits/:chit_id/status | JWT | Update chit status |

---

## Database Tables

| Table | Purpose |
|-------|---------|
| identities | All participants — entities only for MVP |
| connections | Handshake between two entities |
| chit_header | Header per entity per chit — immutable |
| chit_detail | Content per entity per chit — payload deleted after delivery |
| chit_status | Mutable state per entity per chit |
| state_log | Append-only audit trail |

---

## Pages

| Page | URL | Description |
|------|-----|-------------|
| Register | / | Register and verify entity |
| Inbox | /inbox.html | View all chits |
| Connections | /connections.html | Manage connections |
| Send | /send.html | Send a new chit |
| Chit Detail | /chit.html?id=CHIT_ID | Full chit view and actions |

---

## Test Scenarios

The test harness runs six scenarios automatically:

1. **Registration** — Three entities register and verify
2. **Handshake** — Entity A connects to B and C
3. **Send chit** — A sends chit to B and C simultaneously
4. **State updates** — B accepts, C rejects
5. **Invalid transition** — Platform rejects wrong state sequence
6. **Unconnected block** — Cannot send to unconnected entity

---

## Security Practices (MVP)

1. ✅ Parameterised queries — no SQL injection possible
2. ✅ Input validation on every endpoint
3. ✅ JWT authentication — all endpoints protected
4. ✅ Environment variables — no secrets in code
5. ✅ HTTPS on Railway — all traffic encrypted

---

## Architecture

Built on the functional specification:
- `CB_FunctionalSpec_v1.0.pdf` — Sections 1 and 2
- `CB_TechnicalArchitecture_v1.0.pdf`

**What is NOT in this MVP:**
- Actor model (iteration 2)
- Schema engine (Phase 1)
- Encryption (Phase 1)
- Metering and billing (Phase 1)
- Zoho connector (Phase 0.5)

---

## Document Set

| Document | Purpose |
|----------|---------|
| CB_FunctionalSpec_v1.0.pdf | Platform overview and identity model |
| CB_TechnicalArchitecture_v1.0.pdf | Technical layers and build plan |
| CB_DeveloperSetup_v1.0.pdf | Setup guide (this guide) |
| CB_MasterIndex_v1.0.pdf | Complete document registry |

---

## Contact

Athi Narayanan — Founder and Architect
Chit and Bridge — June 2026
