const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: ['purchase', 'payout', 'chapter', 'follow', 'review', 'system'],
    required: true,
  },
  title: { type: String, required: true },
  body:  { type: String, required: true },
  link:  { type: String }, // optional frontend route/page name to open on click
  read:  { type: Boolean, default: false },
}, { timestamps: true });

notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
