const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String, required: true, trim: true,
  },
  email: {
    // CHANGE: was `unique: true` here, meaning one email could only ever
    // belong to ONE account, period — reader OR author, never both. That's
    // why the same Gmail couldn't be used for a second role. Uniqueness is
    // now enforced on the (email, role) PAIR instead, via the compound
    // index below — so the same email can have a separate reader account
    // and a separate author account, but still can't have two reader
    // accounts.
    type: String, required: true, lowercase: true, trim: true,
  },
  password: {
    // Added select: false — password is now excluded from queries by
    // default (that's what the `.select('+password')` in routes/auth.js
    // login was assuming was already happening; without this it was a
    // no-op). toJSON() below still strips it as a second layer of defense,
    // but this way it never even reaches the app in the first place unless
    // explicitly requested.
    type: String, required: true, minlength: 6, select: false,
  },
  role: {
    type: String, enum: ['reader', 'author'], required: true,
  },

  // Author-only fields
  penName:  { type: String, trim: true },
  handle:   { type: String, trim: true, lowercase: true },
  bio:      { type: String, maxlength: 500 },
  // CHANGE: was `avatar: { type: String }` — just the Cloudinary URL, with
  // no publicId stored anywhere. That meant there was no way to delete the
  // OLD image from Cloudinary when a user uploaded a new avatar — every
  // replacement would silently orphan the previous file in storage
  // forever. Now matches the same { url, publicId } shape Product.coverImage
  // already uses, so the old asset can actually be found and deleted.
  avatar: {
    url:      { type: String },
    publicId: { type: String },
  },
  contentTypes: [{ type: String }],     // e.g. ['Manga', 'eBook']

  // Earnings (authors)
  balance:       { type: Number, default: 0 },  // available for payout (₦)
  totalEarned:   { type: Number, default: 0 },

  // Reader fields
  library: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],

  isActive:  { type: Boolean, default: true },

  // Minimal admin flag — there's no full admin system/UI yet, just enough
  // to gate the one action that genuinely needs trusted access: processing
  // refunds. Flip this manually for your own account via makeAdmin.js.
  isAdmin: { type: Boolean, default: false },

  // Email verification — accounts can't log in until this is true.
  // Token is hashed at rest (same pattern as resetPasswordToken below);
  // only the plaintext version ever leaves the server, inside the email link.
  isVerified:          { type: Boolean, default: false },
  verificationToken:   { type: String },
  verificationExpires: { type: Date },

  // NOTE: resetPasswordToken/resetPasswordExpires were duplicated in the
  // original schema object literal. JS silently let the second pair win —
  // harmless here since both copies were identical, but worth trimming.
  resetPasswordToken:   { type: String },
  resetPasswordExpires: { type: Date },
}, { timestamps: true });

// One account per (email, role) pair — same email CAN have both a reader
// and an author account, but not two of the same role.
userSchema.index({ email: 1, role: 1 }, { unique: true });

// Hash password before save
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Never return password in JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
