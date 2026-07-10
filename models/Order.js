const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  buyer:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  author:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },

  amount:      { type: Number, required: true },  // total paid (₦) incl. VAT
  amountBase:  { type: Number },                  // product price before VAT
  vat:         { type: Number },                  // VAT amount
  platformFee: { type: Number },                  // 10% of base
  authorEarns: { type: Number },                  // 90% of base

  currency: { type: String, default: 'NGN' },

  paymentProvider: {
    type: String,
    enum: ['paystack', 'stripe'],
    required: true,
  },
  paymentReference: { type: String, unique: true },  // provider's transaction ref
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending',
  },

  paidAt: { type: Date },
}, { timestamps: true });

// Compound index: one purchase per buyer per product
orderSchema.index({ buyer: 1, product: 1 }, { unique: true });

module.exports = mongoose.model('Order', orderSchema);
