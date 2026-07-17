const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Verifies a Google ID token (sent from the frontend after "Continue with
// Google") and returns the trusted payload straight from Google — never
// trust an idToken's contents without this check, since anyone can send
// an arbitrary JWT-shaped string otherwise.
async function verifyGoogleToken(idToken) {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  if (!payload.email_verified) {
    throw new Error('Google account email is not verified.');
  }

  return {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email.split('@')[0],
  };
}

module.exports = { verifyGoogleToken };
