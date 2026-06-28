// lib/respond.js — keep internal/DB error text out of client responses.
// Logs the real error server-side (so nothing is lost) and returns a generic client message.
// Used as the `message` field in route 500 handlers: res.status(500).json({ error:'X', message: safeErr(err) }).
const safeErr = (err) => {
  if (err) console.error('API error:', err.stack || err.message || err);
  return 'Something went wrong — please try again.';
};

module.exports = { safeErr };
