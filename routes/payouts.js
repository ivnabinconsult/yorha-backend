const express = require('express');
const router  = express.Router();
const Payout  = require('../models/Payout');
const User    = require('../models/User');
const { protect, restrictTo, restrictToAdmin } = require('../middleware/auth');
const { listBanks, resolveAccountNumber } = require('../utils/paystack');
const { sendPayoutConfirmationEmail } = require('../utils/email');
const { createNotification } = require('./notifications');

// Below this, a manual transfer isn't worth the admin overhead either.
// ₦5,000 is a reasonable floor — easy to change if you want a different number.
const MIN_PAYOUT_AMOUNT = 5000;

// Extracts Paystack's actual error message from an axios error, instead of
// axios's own generic "Request failed with status code 400" wrapper text.
const paystackErrorMessage = (err) =>
  (err.response && err.response.data && err.response.data.message) || err.message;

// ── GET /api/payouts/balance
router.get('/balance', protect, restrictTo('author'), async (req, res) => {
  res.json({
    balance:     req.user.balance,
    totalEarned: req.user.totalEarned,
    minPayoutAmount: MIN_PAYOUT_AMOUNT,
  });
});

// ── GET /api/payouts/banks  — list Nigerian banks (still useful for the
// author's dropdown even though we're not calling Transfers)
router.get('/banks', protect, async (req, res) => {
  try {
    const banks = await listBanks();
    res.json({ banks });
  } catch (err) {
    res.status(500).json({ error: paystackErrorMessage(err) });
  }
});

// ── POST /api/payouts/resolve  — verify bank account name.
// NOTE: this Paystack endpoint may itself be gated behind Registered
// Business status on some setups. If it starts failing, just remove the
// call on the frontend and let the author type their account name manually
// — this route becomes optional, not load-bearing, under manual payouts.
router.post('/resolve', protect, restrictTo('author'), async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;
    const data = await resolveAccountNumber({ accountNumber, bankCode });
    res.json({ accountName: data.account_name });
  } catch (err) {
    res.status(400).json({ error: paystackErrorMessage(err) });
  }
});

// ── POST /api/payouts/withdraw  — request a payout (manual fulfillment)
// No Paystack Transfer call. Balance is reserved immediately on request
// (refunded if an admin later rejects it) so an author can't request more
// than their balance across multiple pending requests.
router.post('/withdraw', protect, restrictTo('author'), async (req, res) => {
  try {
    const { amount, accountNumber, accountName, bankCode, bankName } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (amount < MIN_PAYOUT_AMOUNT) {
      return res.status(400).json({
        error: `Minimum payout amount is ₦${MIN_PAYOUT_AMOUNT.toLocaleString()}.`,
      });
    }
    if (!accountNumber || !accountName || !bankName) {
      return res.status(400).json({ error: 'Bank details are required' });
    }

    const author = await User.findById(req.user._id);
    if (amount > author.balance) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    author.balance -= amount;
    await author.save();

    const payout = await Payout.create({
      author: req.user._id,
      amount,
      bankName,
      accountNumber,
      accountName,
      status: 'pending', // awaiting manual transfer + admin confirmation
    });

    res.json({
      message: 'Payout requested. This will be sent manually within 3-5 business days.',
      payout,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/payouts/history  — author's payout history
router.get('/history', protect, restrictTo('author'), async (req, res) => {
  try {
    const payouts = await Payout.find({ author: req.user._id }).sort({ createdAt: -1 });
    res.json({ payouts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN ROUTES — mark manual payouts as sent/failed
// Requires a User with role 'admin'. If your User model's role enum
// doesn't include 'admin' yet, add it before using these routes.
// ════════════════════════════════════════════════════════════════

// ── GET /api/payouts/admin/all  — list payouts (default: pending only)
router.get('/admin/all', protect, restrictToAdmin, async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : { status: 'pending' };
    const payouts = await Payout.find(filter)
      .populate('author', 'name email')
      .sort({ createdAt: 1 }); // oldest first — process in order
    res.json({ payouts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payouts/admin/:id/mark-paid
// Call this after you've manually sent the money via bank transfer.
router.post('/admin/:id/mark-paid', protect, restrictToAdmin, async (req, res) => {
  try {
    const { note } = req.body; // e.g. "Sent via GTBank, ref #12345"

    const payout = await Payout.findById(req.params.id);
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    if (payout.status !== 'pending') {
      return res.status(400).json({ error: `Payout is already ${payout.status}` });
    }

    payout.status      = 'success';
    payout.paidBy       = req.user._id;
    payout.adminNote    = note || '';
    payout.processedAt  = new Date();
    await payout.save();

    try {
      const author = await User.findById(payout.author);
      if (author) await sendPayoutConfirmationEmail(author.email, author.name, payout);
      await createNotification(
        payout.author, 'payout', 'Payout sent',
        `₦${payout.amount.toLocaleString()} sent to your bank account`, 'author-dashboard'
      );
    } catch (emailErr) {
      console.error('Payout confirmation email failed:', emailErr.message);
    }

    res.json({ message: 'Payout marked as paid', payout });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payouts/admin/:id/mark-failed
// Refunds the reserved balance back to the author.
router.post('/admin/:id/mark-failed', protect, restrictToAdmin, async (req, res) => {
  try {
    const { reason } = req.body;

    const payout = await Payout.findById(req.params.id);
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    if (payout.status !== 'pending') {
      return res.status(400).json({ error: `Payout is already ${payout.status}` });
    }

    const author = await User.findById(payout.author);
    if (author) {
      author.balance += payout.amount;
      await author.save();
    }

    payout.status        = 'failed';
    payout.paidBy         = req.user._id;
    payout.failureReason  = reason || 'Rejected by admin';
    payout.processedAt    = new Date();
    await payout.save();

    await createNotification(
      payout.author, 'payout', 'Payout failed',
      `₦${payout.amount.toLocaleString()} was refunded to your balance`, 'author-dashboard'
    );

    res.json({ message: 'Payout marked as failed, balance refunded', payout });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
