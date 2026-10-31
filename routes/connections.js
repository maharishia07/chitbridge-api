// routes/connections.js — Connection handshake
// OWNS      /api/connections: one business asks another to connect, the other answers, and each lists the connections it has (request · pending · respond · list).
// CALLED BY server.js (app.use('/api/connections', ...))
// FLOW      auth → trim the words the old validator chains trimmed → schema check (lib/network-contract.js) → connections · state_log → res.json | problem(req, res, { status, ...words.x() })
//           (API-STANDARD S1: every refusal is a Problem that keeps the keys it always had, frozen in docs/contracts/api-legacy.json)
// CARD      04-network/connections-and-invitations
const express = require('express');
const PL = require('../lib/page-limit'); /* LIM2: the ONE pager — asked = a page (server max), not asked = every row, as before */
const PAGE_DEFAULT = 50,
  PAGE_MAX = 200; /* one page of this file's lists */
const log = require('../lib/logger');
const router = express.Router();
const { problem } = require('../lib/problem'); // API-STANDARD S1: the one error writer; each answer's old body is frozen in docs/contracts/api-legacy.json
const contract = require('../lib/network-contract'); // the contract (each route's operation) and the words of a refusal
const { v4: uuidv4 } = require('uuid');
const { query, withEntity } = require('../db');
const { schemaValidate, sanitise } = require('../middleware/validate'); // S9: the request is checked against the route's own schema
const auth = require('../middleware/auth');
const { UUID_RE } = require('../lib/trace'); // NET-48: an id that is not a uuid names no one

/** the checks of one route, in front of its handler: the words the old validator chain trim()med, then the schema of lib/network-contract.js (answering in the chain's own 400 body) */
const checked = (route) => [contract.trimmedFor(route), schemaValidate(contract.connections.operationFor(route), contract.schemaOptions.connections(route))];

// ─── POST /connections/request ───────────────────────────────
// Entity A sends connection request to Entity B
router.post('/request', auth, checked('POST /request'), async (req, res) => {
  try {
    const from_id = req.identity.identity_id;
    const to_id = sanitise(req.body.to_entity_id);
    const note = sanitise(req.body.note || '');

    // Cannot connect to yourself
    if (from_id === to_id) {
      return problem(req, res, { status: 400, ...contract.words.toYourself() });
    }

    // Check receiver exists (an id that is not a uuid cannot: answered before the database is asked)
    if (typeof to_id !== 'string' || !UUID_RE.test(to_id)) return problem(req, res, { status: 404, ...contract.words.receiverUnknown() });
    const receiver = await query(
      `SELECT identity_id, bridge_id, display_name
       FROM identities
       WHERE identity_id = $1 AND status = 'active'`,
      [to_id]
    );

    if (receiver.rows.length === 0) {
      return problem(req, res, { status: 404, ...contract.words.receiverUnknown() });
    }

    // Check if connection already exists
    const existing = await query(
      `SELECT connection_id, status
       FROM connections
       WHERE (from_entity_id = $1 AND to_entity_id = $2)
          OR (from_entity_id = $2 AND to_entity_id = $1)`,
      [from_id, to_id]
    );

    if (existing.rows.length > 0) {
      return problem(req, res, { status: 400, ...contract.words.connectionExists(existing.rows[0].status) });
    }

    // Get sender snapshot
    const sender = await query('SELECT bridge_id, display_name FROM identities WHERE identity_id = $1', [from_id]);

    // Create connection request
    const connection_id = uuidv4();
    await query(
      `INSERT INTO connections
       (connection_id, from_entity_id, from_display_name, from_bridge_id,
        to_entity_id, to_display_name, to_bridge_id, status, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
      [connection_id, from_id, sender.rows[0].display_name, sender.rows[0].bridge_id, to_id, receiver.rows[0].display_name, receiver.rows[0].bridge_id, note]
    );

    // Log to state_log (the requester's OWN copy). B1 RLS: withEntity(me).
    await withEntity(from_id, (c) =>
      c.query(
        `INSERT INTO state_log
       (chit_id, entity_id, action, action_by_identity_id,
        action_by_display_name, detail)
       VALUES ($1, $2, 'connection_requested', $3, $4, $5)`,
        [connection_id, from_id, from_id, sender.rows[0].display_name, `Connection request sent to ${receiver.rows[0].display_name}`]
      )
    );

    res.json({
      message: 'Connection request sent',
      connection_id,
      to: {
        display_name: receiver.rows[0].display_name,
        bridge_id: receiver.rows[0].bridge_id
      }
    });
  } catch (err) {
    problem(req, res, contract.failed(err, req, 'Request failed'));
  }
});

// ─── GET /connections/pending ─────────────────────────────────
// Get pending connection requests for current entity
router.get('/pending', auth, checked('GET /pending'), async (req, res) => {
  try {
    const result = await query(
      `SELECT connection_id, from_entity_id, from_display_name,
              from_bridge_id, note, created_at
       FROM connections
       WHERE to_entity_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [req.identity.identity_id]
    );

    res.json(Object.assign({ count: result.rows.length }, PL.pageOut('requests', result.rows, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX))));
  } catch (err) {
    problem(req, res, contract.failed(err, req, 'Failed to get requests'));
  }
});

// ─── PUT /connections/:id/respond ────────────────────────────
// Entity B accepts or rejects connection request
router.put('/:id/respond', auth, checked('PUT /:id/respond'), async (req, res) => {
  try {
    const connection_id = req.params.id;
    const action = req.body.action;
    const entity_id = req.identity.identity_id;

    // Find connection
    const conn = await query(
      `SELECT * FROM connections
       WHERE connection_id = $1 AND to_entity_id = $2 AND status = 'pending'`,
      [connection_id, entity_id]
    );

    if (conn.rows.length === 0) {
      return problem(req, res, { status: 404, ...contract.words.requestUnknown() });
    }

    const newStatus = action === 'accept' ? 'accepted' : 'rejected';

    // Update connection status
    await query(
      `UPDATE connections
       SET status = $1, responded_at = NOW()
       WHERE connection_id = $2`,
      [newStatus, connection_id]
    );

    // Log to state_log — for both entities
    const logAction = action === 'accept' ? 'connection_accepted' : 'connection_rejected';

    const detail =
      action === 'accept'
        ? `${req.identity.display_name} accepted connection from ${conn.rows[0].from_display_name}`
        : `${req.identity.display_name} rejected connection from ${conn.rows[0].from_display_name}`;

    // Log for receiver (the responder's OWN copy). B1 RLS: withEntity(me).
    await withEntity(entity_id, (c) =>
      c.query(
        `INSERT INTO state_log
       (chit_id, entity_id, action, action_by_identity_id,
        action_by_display_name, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
        [connection_id, entity_id, logAction, entity_id, req.identity.display_name, detail]
      )
    );

    // (Removed under B1 RLS, 2026-07-04) There used to be a second state_log INSERT here with
    // entity_id = the SENDER (conn.from_entity_id) — the responder writing into the OTHER entity's copy.
    // That violates "nobody writes another entity's data" (and RLS forbids it), AND it was dead data:
    // connection state_log rows are never surfaced (the notifications feed joins chit_status by chit_id, and
    // a connection has no chit_status row). The sender already learns of the response from the `connections`
    // table (status / responded_at) via GET /connections/list. If a sender-side timeline entry is ever wanted,
    // model it as a proper cross-notification (a chit, or a connection-scoped definer) — never a direct write.

    /* ⭐ b99 names `network.connect`. Metered only on ACCEPT — a refused request is not a connection, and
       billing for one would charge for being asked. */
    if (newStatus === 'accepted') {
      try {
        require('../lib/meter')
          .meter(entity_id, 'network.connect', {
            detail: connection_id,
            rid: req.id
          })
          .catch(log.orElse('connections PUT /:id/respond: failed — carried on without it'));
      } catch (e) {
        log.fellBack('connections PUT /:id/respond: the helper failed — carried on without it', e);
      }
    }

    res.json({
      message: `Connection ${newStatus}`,
      connection_id,
      status: newStatus
    });
  } catch (err) {
    problem(req, res, contract.failed(err, req, 'Response failed'));
  }
});

// ─── GET /connections/list ────────────────────────────────────
// Get all accepted connections for current entity
router.get('/list', auth, checked('GET /list'), async (req, res) => {
  try {
    const entity_id = req.identity.identity_id;

    const result = await query(
      `SELECT connection_id,
              CASE WHEN from_entity_id = $1
                   THEN to_entity_id ELSE from_entity_id END AS partner_entity_id,
              CASE WHEN from_entity_id = $1
                   THEN to_display_name ELSE from_display_name END AS partner_display_name,
              CASE WHEN from_entity_id = $1
                   THEN to_bridge_id ELSE from_bridge_id END AS partner_bridge_id,
              status, created_at, responded_at
       FROM connections
       WHERE (from_entity_id = $1 OR to_entity_id = $1)
       AND status = 'accepted'
       ORDER BY created_at DESC`,
      [entity_id]
    );

    res.json(Object.assign({ count: result.rows.length }, PL.pageOut('connections', result.rows, PL.pageArgs(req.query, PAGE_DEFAULT, PAGE_MAX))));
  } catch (err) {
    problem(req, res, contract.failed(err, req, 'Failed to get connections'));
  }
});

router.openapi = { paths: contract.connections.pathsOf(), schemas: {} };

module.exports = router;
