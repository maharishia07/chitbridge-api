# ChitBridge — web

The app people use: the home page, the main app, **CB Accounts** (the ledger as its own page), the Labs (Product,
Offer, Combo, Tax) and the **counter** (the till). Static pages + plain JavaScript capability files, served by
**Vercel from `main`**, talking to the ChitBridge API.

ChitBridge is three repositories:

| Repo | What it holds |
|---|---|
| **chitbridge-web** (this one) | every screen people see |
| **chitbridge-api** | the server, migrations, the counter's master code, the connector kit |
| **chitbridge-engines** | the pure engines every platform adopts as stamped, version-pinned copies |

**Read first:** [`CLAUDE.md`](CLAUDE.md) — reuse before you build; the design system is
[`docs/design/SYSTEM.md`](docs/design/SYSTEM.md) (the pass mark for every screen).
**What already exists:** [`docs/SEAMS.md`](docs/SEAMS.md).

## Run it

```bash
npm install
npm run dev          # vite — the pages under public/ and index.html
```

## Check it

| Command | What it proves |
|---|---|
| `npm run check` | every static guard: engines adoption, syntax, reads per screen, modals, tax, markup, a11y, endpoints, CMDB |
| `node e2e/<screen>.cjs` | that screen's harness — a real browser against a stand-in API (never the live site) |
| `node e2e/<screen>-breaks.cjs` | each guard of that screen broken once — every break must be caught |

Playwright (`@playwright/test@1.61.0`) is installed outside the repo; point `NODE_PATH` at it.

## Where things are

```
index.html           the home page — three boxes (Till · Catalogue · CB Accounts) and the Labs
public/
  app.html           the main app; its screens are lazy capability files in public/app/ (cap-*.js) — see MODULES.md
  app/               capability files, the chit sheet, one-person (the one-shop gate), accounts-shell, core
  accounts.html      CB Accounts — the ledger's own page
  till.html          the counter — VENDORED from chitbridge-api tools/tally-connector/till.html; change the master
  engine/            adopted engine copies (engines.lock.json pins them) — never edit
  *-lab.html         Product · Offer · Combo · Conversion Labs
  pics/ illustrations/ vendor/   images (with their CREDITS.md) and third-party scripts
e2e/                 harnesses (*.cjs), their breaks, and e2e/shots/ — the screenshots they write
png/                 the reference render of each screen (open it before changing that screen)
docs/
  design/            SYSTEM.md, and one folder per designed screen (requirement, design files)
  SEAMS.md           the reuse index
scripts/ tools/      syntax and adoption checks, the modules doc generator
RETIRED.md           what was retired, when, and the tag that restores it
engines.lock.json    which engine versions this app adopts
```

## Deploy

Push to `main` → Vercel deploys. A change to any `public/app/*.js` must bump `CB_BUILD` in `public/app.html`
(`node e2e/cb-build-guard.cjs` fails otherwise) or browsers keep the old copy.

---

**Proprietary.** © 2026 ChitBridge. All rights reserved — published for review only, not open source. See [LICENSE](LICENSE).
