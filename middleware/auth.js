// middleware/auth.js — JWT validation middleware
const jwt = require('jsonwebtoken');
const { query } = require('../db');

const auth = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorised',
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    // Pin the algorithm: tokens are signed HS256, so only accept HS256 — closes any
    // algorithm-confusion ambiguity (e.g. a token claiming a different alg).
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // Attach identity to request
    req.identity = {
      identity_id:      decoded.identity_id,
      bridge_id:        decoded.bridge_id,
      display_name:     decoded.display_name,
      identity_type:    decoded.identity_type,
      email:            decoded.email,
      parent_entity_id: decoded.parent_entity_id || null,
      owner_scope:      decoded.owner_scope || null,
    };

    // Revalidate actor status — a removed/deactivated co-assist must lose access
    // immediately on their next request, not whenever the JWT happens to expire.
    // (Stateless JWTs can't be deleted server-side; this is the standard revocation.)
    if (decoded.identity_type === 'actor') {
      const r = await query(
        `SELECT break_status FROM identities
         WHERE identity_id = $1 AND identity_type = 'actor'`,
        [decoded.identity_id]
      );
      const status = r.rows[0]?.break_status;
      if (!r.rows.length || status === 'removed' || status === 'deactivated') {
        return res.status(401).json({
          error: 'Unauthorised',
          message: 'Your access has been revoked. Contact your admin.'
        });
      }
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Unauthorised',
        message: 'Token expired — please log in again'
      });
    }
    return res.status(401).json({
      error: 'Unauthorised',
      message: 'Invalid token'
    });
  }
};

module.exports = auth;
