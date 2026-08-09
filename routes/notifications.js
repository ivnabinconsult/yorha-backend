const express = require('express');
const router  = express.Router();
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

// ── GET /api/notifications  — most recent 50 for the logged-in user
router.get('/', protect, async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/notifications/:id/read
router.put('/:id/read', protect, async (req, res) => {
  try {
    const notif = await Notification.findOne({ _id: req.params.id, user: req.user._id });
    if (!notif) return res.status(404).json({ error: 'Notification not found' });
    notif.read = true;
    await notif.save();
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/notifications/read-all
router.put('/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
    res.json({ message: 'All marked as read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ── Helper for other routes to call directly, e.g.:
//   const { createNotification } = require('../routes/notifications');
//   await createNotification(userId, 'purchase', 'Purchase confirmed', 'Bleach Vol. 12 added to your library');
module.exports.createNotification = async (userId, type, title, body, link) => {
  try {
    await Notification.create({ user: userId, type, title, body, link });
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
};
