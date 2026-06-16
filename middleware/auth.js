// middleware/auth.js — JWT validation middleware
const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach identity to request
    req.identity = {
      identity_id:      decoded.identity_id,
      bridge_id:        decoded.bridge_id,
      display_name:     decoded.display_name,
      email:            decoded.email,
      identity_type:    decoded.identity_type,
      parent_entity_id: decoded.parent_entity_id || null,
    };

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
