const rateLimit = require('express-rate-limit');

// Login: brute-force / credential-stuffing protection.
// 10 attempts per 15 min per IP — generous enough for a real user who
// mistypes a password a few times, tight enough to stop automated guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Forgot-password: prevents both abuse (spamming someone's inbox with
// reset emails) and using the endpoint to enumerate valid accounts by
// timing/volume. Tighter than login since there's no legitimate reason
// to need many of these back-to-back.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many password reset requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Resend-verification: same abuse shape as forgot-password (email spam).
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many verification emails requested. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, forgotPasswordLimiter, resendVerificationLimiter };
