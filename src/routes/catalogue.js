// ── ARCHIVED 2026-08-06 · the network has no catalogue of its own ──────────────────────────────────────────────
//
// Athi: *"if something is not useful, that has to be removed or archived."* And then, describing the model:
// *"when the storefront is calling, it will call the NETWORK, not the individual stores under the network — so the
// catalogue of all the entities should be visible where the entity is public."*
//
// That settles what these routes were. They served `cb_catalogue_item` / `cb_catalogue_category` — a THIRD
// catalogue model, alongside `catalogue_items` (a shop's own products) and `catalogue_source` + `catalogue_adoption`
// (adopted blueprints). Nothing read them: the front end never referenced them, and the tables are empty.
//
// They were not merely unused, they were WRONG for the model. A network AGGREGATES its members' catalogues and
// holds none of its own, so a catalogue attached to the network node would be a fourth place a price could live,
// competing with the three that already exist. See SPEC-network-storefront.md §6.
//
// ── WHAT WAS REMOVED ───────────────────────────────────────────────────────────────────────────────────────────
//   GET    /api/network/entities/:id/catalogue
//   POST   /api/network/entities/:id/catalogue
//   GET    /api/network/entities/:id/catalogue/categories
//   POST   /api/network/entities/:id/catalogue/categories
//   PATCH  /api/network/catalogue/:itemId
//   DELETE /api/network/catalogue/:itemId
//
// The mutations were already 503 behind NETWORK_WRITE_ENABLED. The reads had been an authenticated ANY-ENTITY read
// of ANY entity's catalogue (ATH-86), gated hours before this archive — so this removes a door that had only just
// been locked, which is the right order: lock it, then decide it should not be there at all.
//
// ── WHAT IS KEPT, DELIBERATELY ─────────────────────────────────────────────────────────────────────────────────
//   · cb_entity / cb_edge — the network TREE, LIVE and in use (netLookup · netSubtree · netConnections). The whole
//     network-storefront model stands on it. Do not confuse "the cb_* catalogue was a mistake" with "cb_* is dead".
//   · src/services/catalogue.js — left in place, now unreferenced. It is the only written description of
//     `price_type` (Personal/Business/Employee), `available_stock`, `offer`, `discounted_price` — the tiered-price
//     and offer model the main catalogue LACKS. Archive the tables; keep the idea. It belongs on the price overlay
//     (BACKLOG-catalogue-definition.md §6), not on a second item table.
//
// ── THE TABLES ARE NOT DROPPED ─────────────────────────────────────────────────────────────────────────────────
// Routes first, tables later. A DROP is not reversible, and the risk is not the data (there is none) — it is being
// wrong about "nothing uses this". Leave `cb_catalogue_item` / `cb_catalogue_category` dormant for a cycle; if
// nothing has asked for them, drop them then, in a gated migration.
//
// This file exports an empty router so the mount can be removed without a second edit landing separately.
module.exports = require('express').Router();
