// middleware/validate.js — Input validation helpers
// CALLED BY routes/actors.js, routes/catalogue.js, routes/chits.js, routes/connections.js, routes/connectors.js (+4 more)   [from the knowledge graph, 2026-10-18 - regenerate: node tools/graph/trace.cjs]
const { validationResult } = require('express-validator');

// Check validation results and return errors if any
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map((e) => ({
        field: e.path,
        message: e.msg
      }))
    });
  }
  next();
};

// Sanitise string — remove dangerous characters
const sanitise = (str) => {
  if (!str) return str;
  return String(str)
    .trim()
    .replace(/[<>]/g, '') // remove HTML tags
    .substring(0, 1000); // max length
};

module.exports = { validate, sanitise };
