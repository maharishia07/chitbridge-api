/**
 * /config.js — WHERE THIS SITE'S API IS. The ONE place (HX1, api docs/HOSTING-COUPLING.md › Web front-end).
 *
 * Every page loads this first and reads `window.CB_API` — CBShell.apiBase(), app.html's stage ladder, the stand-alone pages, the
 * counter (till.html) and the shop screen (promo.html). The value below is the production api, because Vercel serves this file as
 * it is. Any other deploy WRITES this file when it starts, from CB_API_BASE (the web image: deploy/40-cb-api-base.sh). On a shop PC
 * the counter program (till.js) serves its own /config.js from connector.json instead.
 * e2e/guard-static.cjs fails on a *.railway.app / *.vercel.app address anywhere else in the site.
 */
/*
 * OWNS      window.CB_API: the one place a site says where its api is
 * CALLED BY <script src="/config.js"> on 38 pages (grep -l config.js public/*.html), first script of each; the web image writes it at start (deploy/40-cb-api-base.sh)
 * FLOW      page loads it first -> window.CB_API set -> CBShell.apiBase() and the stage ladder read it
 * CARD      28-platform-and-operations/hosting-and-deploy
 */
window.CB_API = window.CB_API || 'https://chitbridge-api-production.up.railway.app';
