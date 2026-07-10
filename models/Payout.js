const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  amount: { type: Number, required: true },   // ₦ requested

  bankName:      { type: String, required: true },
  accountNumber: { type: String, required: true },
  accountName:   { type: String, required: true },

  // Paystack Transfer API — unused while on manual payouts, kept so the
  // switch back to automated Transfers later needs zero schema changes.
  paystackRecipientCode: { type: String },
  paystackTransferCode:  { type: String },
  paystackReference:     { type: String },

  status: {
    type: String,
    enum: ['pending', 'processing', 'success', 'failed'],
    default: 'pending',
  },

  // Manual payout tracking
  paidBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // admin who marked it paid
  adminNote: { type: String }, // e.g. "Sent via Opay, ref #12345"

  processedAt: { type: Date },
  failureReason: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Payout', payoutSchema);
