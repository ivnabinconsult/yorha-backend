const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  description: { type: String, required: true },
  author:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName:  { type: String },   // denormalised for fast reads

  contentType: {
    type: String,
    enum: ['eBook', 'Manga', 'Manhwa', 'Novel', 'Short Story'],
    required: true,
  },
  genre:  { type: String, required: true },
  tags:   [{ type: String }],
  language: { type: String, default: 'English' },

  price: { type: Number, required: true, min: 0 },  // in Naira (kobo not used)

  // Cover image (Cloudinary)
  coverImage: {
    url:      { type: String },
    publicId: { type: String },
  },

  // File metadata (actual file is in B2 — never exposed directly)
  file: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File',
  },

  // Preview text or chapter count
  previewChapters: { type: Number, default: 1 },
  totalChapters:   { type: Number },
  totalPages:      { type: Number },
  volumes:         { type: Number },

  // Stats
  salesCount:  { type: Number, default: 0 },
  viewCount:   { type: Number, default: 0 },
  ratingAvg:   { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },

  // 'scheduled' added: a product queued to go live at a future publishedAt
  // date. It's excluded from the public feed (routes/products.js filters
  // on status: 'live') until something flips it to 'live'. That flip isn't
  // automated yet — needs a scheduled job checking publishedAt <= now.
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'review', 'live', 'suspended'],
    default: 'draft',
  },

  publishedAt: { type: Date },
}, { timestamps: true });

// Text index for search
productSchema.index({ title: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Product', productSchema);
