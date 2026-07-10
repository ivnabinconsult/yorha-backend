const express = require('express');
const router  = express.Router();
const Report  = require('../models/Report');
const Product = require('../models/Product');
const { protect, restrictTo, restrictToAdmin } = require('../middleware/auth');

// ── POST /api/reports  — file a report against a product
// Open to any logged-in user (reader or author) — protect handles auth,
// no restrictTo since either role should be able to report content.
router.post('/', protect, async (req, res) => {
  try {
    const { productId, reason, details } = req.body;

    if (!productId || !reason) {
      return res.status(400).json({ error: 'Product and reason are required.' });
    }
    const validReasons = ['copyright', 'inappropriate', 'spam', 'other'];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ error: 'Invalid reason.' });
    }

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found.' });

    try {
      const report = await Report.create({
        reporter: req.user._id,
        product:  productId,
        reason,
        details:  details || '',
      });
      res.status(201).json({ message: 'Report submitted. Our team will review it.', report });
    } catch (err) {
      // Duplicate-key from the partial unique index — they already have an
      // open report on this product.
      if (err.code === 11000) {
        return res.status(409).json({ error: 'You already have a pending report on this item.' });
      }
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
// ADMIN ROUTES — moderation queue
// Same pattern as the payouts admin routes: requires role 'admin'.
// ════════════════════════════════════════════════════════════════

// ── GET /api/reports/admin/all  — list reports (default: pending only)
router.get('/admin/all', protect, restrictToAdmin, async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : { status: 'pending' };
    const reports = await Report.find(filter)
      .populate('reporter', 'name email')
      .populate('product', 'title author status')
      .sort({ createdAt: 1 }); // oldest first
    res.json({ reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/reports/admin/:id/dismiss  — reviewed, no action needed
router.post('/admin/:id/dismiss', protect, restrictToAdmin, async (req, res) => {
  try {
    const { note } = req.body;

    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.status !== 'pending') {
      return res.status(400).json({ error: `Report is already ${report.status}` });
    }

    report.status     = 'dismissed';
    report.reviewedBy  = req.user._id;
    report.reviewNote  = note || '';
    report.reviewedAt  = new Date();
    await report.save();

    res.json({ message: 'Report dismissed', report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/reports/admin/:id/takedown  — remove the product from sale
// Sets the product to 'suspended' (already in Product.status enum) rather
// than deleting it — preserves order/review history tied to it, same
// reasoning as the soft-delete pattern used for user accounts.
router.post('/admin/:id/takedown', protect, restrictToAdmin, async (req, res) => {
  try {
    const { note } = req.body;

    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.status !== 'pending') {
      return res.status(400).json({ error: `Report is already ${report.status}` });
    }

    await Product.findByIdAndUpdate(report.product, { status: 'suspended' });

    // Also resolve any other pending reports against this same product —
    // no need to leave duplicate reports open once the product is down.
    await Report.updateMany(
      { product: report.product, status: 'pending' },
      { status: 'actioned', reviewedBy: req.user._id, reviewNote: note || 'Product suspended', reviewedAt: new Date() }
    );

    res.json({ message: 'Product suspended and report(s) resolved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
