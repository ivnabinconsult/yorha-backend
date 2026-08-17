const jwt = require('jsonwebtoken');

// Same secret and payload shape as the regular generateToken() (so it
// validates against the existing `protect` middleware with zero changes
// there), just a much longer expiry. Meant to be minted ONCE by an
// already-authenticated admin and pasted into admin-dashboard.html /
// users-overview.html on whichever devices need standing access, instead
// of re-logging-in or manually copying a 7-day session token around.
const generateAdminToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || '365d',
  });
};

module.exports = generateAdminToken;
