const mongoose = require('mongoose');

// Stores file metadata only — actual file lives in Backblaze B2 (private)
// Never expose b2Key or bucket directly to the client

const fileSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },

  originalName: { type: String },
  mimeType:     { type: String },   // application/pdf or application/zip
  sizeBytes:    { type: Number },

  // B2 storage info (server-side only)
  b2Key:    { type: String, required: true },   // object key in B2
  bucket:   { type: String, required: true },

  uploadedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('File', fileSchema);
