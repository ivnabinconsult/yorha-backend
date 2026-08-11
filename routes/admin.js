const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const Payout = require('../models/Payout');
const { protect, restrictToAdmin } = require('../middleware/auth');

// Hard-locked to your account only — even if isAdmin ever gets set on
// another account by accident, this still blocks everyone but you.
const OWNER_EMAIL = 'leonardlouis034@gmail.com';
const restrictToOwner = (req, res, next) => {
  if (req.user.email !== OWNER_EMAIL) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  next();
};

// ── GET /api/admin/dashboard
router.get('/dashboard', protect, restrictToAdmin, restrictToOwner, async (req, res) => {
  try {
    const [authorCount, readerCount] = await Promise.all([
      User.countDocuments({ role: 'author' }),
      User.countDocuments({ role: 'reader' }),
    ]);

    const revenueAgg = await Order.aggregate([
      { $match: { paymentStatus: 'completed' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          totalPlatformFee: { $sum: '$platformFee' },
          totalAuthorEarnings: { $sum: '$authorEarns' },
          transactionVolume: { $sum: 1 },
        },
      },
    ]);
    const revenue = revenueAgg[0] || {
      totalRevenue: 0, totalPlatformFee: 0, totalAuthorEarnings: 0, transactionVolume: 0,
    };

    const payoutAgg = await Payout.aggregate([
      { $group: { _id: '$status', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    const payouts = {
      pending: { total: 0, count: 0 },
      success: { total: 0, count: 0 },
      failed:  { total: 0, count: 0 },
    };
    payoutAgg.forEach((p) => { if (payouts[p._id]) payouts[p._id] = { total: p.total, count: p.count }; });

    const balanceAgg = await User.aggregate([
      { $match: { role: 'author' } },
      { $group: { _id: null, pendingBalance: { $sum: '$balance' } } },
    ]);
    const pendingAuthorBalance = (balanceAgg[0] && balanceAgg[0].pendingBalance) || 0;

    res.json({
      authors: authorCount,
      readers: readerCount,
      revenue: {
        total: revenue.totalRevenue,
        platformFee: revenue.totalPlatformFee,
        authorEarnings: revenue.totalAuthorEarnings,
        transactionVolume: revenue.transactionVolume,
      },
      payouts: {
        paidOut: payouts.success.total,
        paidOutCount: payouts.success.count,
        pending: payouts.pending.total,
        pendingCount: payouts.pending.count,
        failedCount: payouts.failed.count,
      },
      pendingAuthorBalance,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/users-overview
router.get('/users-overview', protect, restrictToAdmin, restrictToOwner, async (req, res) => {
  try {
    const users = await User.find({}, 'name email createdAt').sort({ createdAt: -1 });
    res.json({
      total: users.length,
      users: users.map(u => ({
        name: u.name,
        email: u.email,
        joined: u.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
