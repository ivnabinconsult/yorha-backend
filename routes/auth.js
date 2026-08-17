const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Product = require('../models/Product');
const generateToken = require('../utils/generateToken');
const generateAdminToken = require('../utils/generateAdminToken');
const { protect, restrictToAdmin } = require('../middleware/auth');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../utils/email');
const { uploadImageSafe } = require('../middleware/upload');
const { uploadAvatarToCloudinary, deleteCoverFromCloudinary } = require('../utils/cloudinaryUpload');
const { loginLimiter, forgotPasswordLimiter, resendVerificationLimiter } = require('../middleware/rateLimiters');
const { verifyGoogleToken } = require('../utils/googleAuth');

// ── POST /api/auth/register
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['reader', 'author']).withMessage('Role must be reader or author'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { name, email, password, role, penName, bio, contentTypes } = req.body;

    const exists = await User.findOne({ email, role });
    if (exists) {
      return res.status(409).json({
        error: `An ${role} account with this email already exists. Try logging in instead.`,
      });
    }

    const user = await User.create({
      name, email, password, role,
      ...(role === 'author' && { penName, bio, contentTypes }),
      // TEMPORARY: auto-verified at signup. Resend needs a domain we
      // control the DNS for to send real verification emails — until
      // that's sorted (see note below), we can't email real users at all,
      // so forcing verification would just lock everyone out. Flip this
      // back to `false` (and re-enable the email send below) once a
      // verified domain is in place.
      isVerified: true,
    });

    // Verification email intentionally not sent right now — see isVerified
    // note above. Once a real domain is verified on Resend, restore this:
    //
    // const rawToken = crypto.randomBytes(32).toString('hex');
    // user.verificationToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    // user.verificationExpires = Date.now() + 24 * 60 * 60 * 1000;
    // await user.save();
    // await sendVerificationEmail(user.email, rawToken, user.name, user.role);

    res.status(201).json({
      message: 'Account created successfully.',
      token: generateToken(user._id),
      user,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login
router.post('/login', loginLimiter, [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  body('role').isIn(['reader', 'author']).withMessage('Role must be reader or author'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { email, password, role } = req.body;

    // Scoped by role so this only ever matches the account for the portal
    // being logged into — the same email can have a separate account
    // under the other role, and this must not touch that one.
    const user = await User.findOne({ email, role }).select('+password');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Block unverified accounts — frontend shows a "Resend verification
    // email" link when it sees this flag.
    if (!user.isVerified) {
      return res.status(403).json({
        error: 'Please verify your email before logging in.',
        unverified: true,
      });
    }

    res.json({
      message: 'Login successful',
      token: generateToken(user._id),
      user,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/google  (sign in or sign up with Google — no email
// verification step needed, since Google already verified the address)
router.post('/google', [
  body('idToken').notEmpty().withMessage('Google token required'),
  body('role').isIn(['reader', 'author']).withMessage('Role must be reader or author'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { idToken, role, intent } = req.body; // intent: 'login' | 'signup'
    const { googleId, email, name } = await verifyGoogleToken(idToken);

    // Scoped by role: the same Gmail can hold a separate reader account
    // and author account, so this must only ever find/create the one
    // matching the portal being used, never fall back to the other.
    let user = await User.findOne({ email, role });

    if (!user) {
      // Signing in (not signing up) with a Google account that has no
      // matching Yorha account — don't silently create one. Tell the
      // frontend so it can point the person to the signup form instead.
      if (intent !== 'signup') {
        return res.status(404).json({
          error: 'No account found for this Google email. Please sign up first.',
          noAccount: true,
        });
      }

      // First time this (email, role) pair has signed in — create the
      // account. Password is a random, never-shown value (same pattern
      // used for deactivated accounts below) so the schema's required
      // password field is satisfied even though this account only ever
      // logs in via Google.
      user = await User.create({
        name,
        email,
        password: crypto.randomBytes(32).toString('hex'),
        role,
        googleId,
        isVerified: true,
      });
    } else if (!user.googleId) {
      // Existing email/password account signing in with Google for the
      // first time — link it and mark verified (Google already confirmed
      // the email, so there's no reason to keep blocking on the old
      // email-link verification for this account).
      user.googleId = googleId;
      user.isVerified = true;
      await user.save();
    }

    if (!user.isActive) {
      return res.status(403).json({ error: 'This account has been deactivated.' });
    }

    res.json({
      message: 'Login successful',
      token: generateToken(user._id),
      user,
    });
  } catch (err) {
    res.status(401).json({ error: err.message || 'Google sign-in failed.' });
  }
});

// ── GET /api/auth/me  (get logged-in user)
router.get('/me', protect, async (req, res) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/admin-token
// Mints a long-lived (default 1yr) token for admin-dashboard.html /
// users-overview.html, so those don't need re-logging-in every 24h like
// a normal session. Requires calling this while ALREADY logged in with a
// valid, current admin session — can't be used to escalate access, only
// to extend how long an already-verified admin stays logged in on a
// device. Mint it once (e.g. from the main app's admin panel while on
// desktop), then paste the result into the token box on any other device.
router.post('/admin-token', protect, restrictToAdmin, (req, res) => {
  res.json({ token: generateAdminToken(req.user._id) });
});

// ── POST /api/auth/verify-email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      verificationToken: hashedToken,
      verificationExpires: { $gt: Date.now() },
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification link.' });

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await user.save();

    // Log the user straight in once verified — matches the frontend's
    // runEmailVerification flow, which expects a token + user back.
    res.json({
      message: 'Email verified.',
      token: generateToken(user._id),
      user,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/resend-verification
router.post('/resend-verification', resendVerificationLimiter, async (req, res) => {
  try {
    const { email, role } = req.body;
    // Scoped by role — the frontend triggers this from a specific
    // role's login box, so it should only ever touch that account.
    const user = await User.findOne({ email, role });

    // Same non-enumerating pattern as forgot-password — don't reveal
    // whether an account exists.
    if (!user) {
      return res.json({ message: 'If that account exists, a verification email has been sent.' });
    }
    if (user.isVerified) {
      return res.status(400).json({ error: 'This account is already verified.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.verificationExpires = Date.now() + 24 * 60 * 60 * 1000;
    await user.save();

    await sendVerificationEmail(user.email, rawToken, user.name, user.role);

    res.json({ message: 'Verification email sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/forgot-password
//
// BUG FIX: this used to be User.findOne({ email }) — a single lookup with
// no role. Since the same Gmail can now have both a reader AND an author
// account (see the register/login change above), that only ever found and
// reset ONE of them — whichever Mongo returned first — while the other
// account silently kept its old password with no indication anything was
// wrong. Now finds every account under this email and issues a separate
// token for each, so both get a working reset link.
//
// SECURITY FIX: resetPasswordToken used to store the exact same token
// value that gets emailed to the user — plaintext, at rest, in the DB.
// Anyone who ever reads that field directly (backup leak, injection, etc.)
// could reset the account with zero access to the actual inbox. Now we
// hash the token before storing it (same idea as password hashing) and
// only the plaintext version ever leaves the server, inside the email
// link. Lookup in reset-password hashes the incoming token the same way
// before querying.
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const users = await User.find({ email });

    // Always return the same generic message whether or not the email
    // exists — don't let this endpoint be used to enumerate valid accounts.
    if (!users.length) {
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    for (const user of users) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = Date.now() + 3600000;
      await user.save();

      try {
        await sendPasswordResetEmail(user.email, rawToken, user.name, user.role);
      } catch (mailErr) {
        // TEMPORARY: Resend can't deliver to real users until a verified
        // domain is set up (see routes/auth.js register route note).
        // Surface a clear, non-technical message instead of letting the
        // raw Resend API error reach the user, and instead of silently
        // returning the generic "sent" message below as if it worked.
        console.error('❌ Password reset email failed:', mailErr.message, 'to:', user.email);
        return res.status(503).json({
          error: "We're unable to send password reset emails right now. Please contact support to reset your password manually.",
        });
      }
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link.' });

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/auth/me  — delete (deactivate) own account
//
// This is a soft delete, not a hard delete, and that's deliberate:
// hard-deleting the User document would leave dangling references all
// over the place — an author's past Orders/Reviews from a deleted reader,
// a deleted author's Products/Payouts — breaking .populate() calls and
// destroying financial/accounting records that may need to exist for
// dispute resolution or tax purposes. Instead this:
//   - blocks login (isActive: false, which `protect` already checks)
//   - wipes personally-identifying fields
//   - frees the original email for reuse (including re-registering the
//     SAME role again, or the other role)
// Every Order/Review/Payout this account was ever part of stays intact —
// it now just points to an anonymized "Deleted User" record instead of a
// real one, same pattern as Reddit/most platforms handle this.
router.delete('/me', protect, async (req, res) => {
  try {
    const { password, idToken } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    if (password) {
      const match = await user.comparePassword(password);
      if (!match) return res.status(401).json({ error: 'Incorrect password.' });
    } else if (idToken && user.googleId) {
      // Google-linked account confirming via a fresh Google sign-in
      // instead of a password (they never set/know one).
      const { googleId } = await verifyGoogleToken(idToken);
      if (googleId !== user.googleId) {
        return res.status(401).json({ error: 'Google confirmation did not match this account.' });
      }
    } else {
      return res.status(400).json({ error: 'Please confirm your identity to delete your account.' });
    }

    // Safety net: don't let an author's unpaid earnings just vanish into
    // a deleted account. Require them to withdraw first.
    if (user.role === 'author' && user.balance > 0) {
      return res.status(400).json({
        error: `You have an unpaid balance of ₦${user.balance.toLocaleString()}. Please withdraw your earnings before deleting your account.`,
      });
    }

    // BUG FIX: this used to just do `user.avatar = undefined`, which drops
    // the DB reference but leaves the actual image sitting in Cloudinary
    // storage forever with nothing pointing to it. Delete the real asset
    // first, same as product cover cleanup on delete.
    if (user.avatar?.publicId) {
      await deleteCoverFromCloudinary(user.avatar.publicId);
    }

    // Pull the author's works off the store. Not a hard delete — same
    // reasoning as the account itself: existing buyers' library access and
    // Orders/Reviews still point to these Products, so we just hide them
    // from browsing/direct links via the same 'suspended' status the
    // moderation system already uses, rather than deleting them outright.
    if (user.role === 'author') {
      await Product.updateMany({ author: user._id }, { status: 'suspended' });
    }

    user.isActive = false;
    user.email    = `deleted_${user._id}@deleted.yorha.local`; // frees the real email
    user.name     = 'Deleted User';
    user.penName  = undefined;
    user.bio      = undefined;
    user.avatar   = undefined;
    user.password = crypto.randomBytes(32).toString('hex'); // re-hashed by the pre-save hook, unusable/unguessable
    user.resetPasswordToken   = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Account deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/avatar  — upload/replace profile avatar
router.post('/avatar', protect, uploadImageSafe('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Avatar image required' });

    const user = await User.findById(req.user._id);

    // Delete the old avatar from Cloudinary before uploading the new one,
    // same cleanup pattern as product cover replacement — otherwise every
    // re-upload just orphans the previous file in storage.
    if (user.avatar?.publicId) {
      await deleteCoverFromCloudinary(user.avatar.publicId);
    }

    const { url, publicId } = await uploadAvatarToCloudinary(req.file.buffer);
    user.avatar = { url, publicId };
    await user.save();

    res.json({ message: 'Avatar updated', avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/auth/profile  — update own profile info
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, penName, handle, bio } = req.body;
    const user = await User.findById(req.user._id);

    // Email is intentionally NOT editable here — changing it would need its
    // own re-verification flow, so that's out of scope for a basic profile save.
    if (name !== undefined) user.name = name;
    if (penName !== undefined) user.penName = penName;
    if (handle !== undefined) user.handle = handle;
    if (bio !== undefined) user.bio = bio;

    await user.save();
    res.json({ message: 'Profile updated', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/auth/password  — change password while logged in
router.put('/password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Please provide your current and new password.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    const match = await user.comparePassword(currentPassword);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    user.password = newPassword; // re-hashed by the pre-save hook
    await user.save();

    res.json({ message: 'Password updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
