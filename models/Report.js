const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },

  reason: {
    type: String,
    enum: ['copyright', 'inappropriate', 'spam', 'other'],
    required: true,
  },
  details: { type: String, maxlength: 1000 },

  // 'pending' — awaiting admin review
  // 'dismissed' — admin reviewed, no action taken
  // 'actioned' — admin took the product down
  status: {
    type: String,
    enum: ['pending', 'dismissed', 'actioned'],
    default: 'pending',
  },

  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewNote: { type: String, maxlength: 500 },
  reviewedAt: { type: Date },
}, { timestamps: true });

// Prevent the same reader from spamming reports on the same product —
// one open report per (reporter, product) at a time. They can report again
// once the prior report is resolved (dismissed/actioned), since a partial
// unique index only enforces uniqueness among matching documents.
reportSchema.index(
  { reporter: 1, product: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.model('Report', reportSchema);
