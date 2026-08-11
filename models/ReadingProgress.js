const mongoose = require('mongoose');

const readingProgressSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },

  currentPage: { type: Number, default: 1 },
  totalPages:  { type: Number },

  lastReadAt: { type: Date, default: Date.now },
}, { timestamps: true });

readingProgressSchema.index({ user: 1, product: 1 }, { unique: true });

module.exports = mongoose.model('ReadingProgress', readingProgressSchema);
