const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');

// GET /api/wishlist — populated list of saved products
router.get('/', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('wishlist');
    res.json({ wishlist: user.wishlist || [] });
  } catch (err) {
    console.error('Get wishlist error:', err);
    res.status(500).json({ error: 'Failed to load wishlist' });
  }
});

// POST /api/wishlist/:productId — toggle add/remove
router.post('/:productId', protect, async (req, res) => {
  try {
    const { productId } = req.params;
    const user = await User.findById(req.user._id);

    const idx = user.wishlist.findIndex(id => id.toString() === productId);
    let wishlisted;

    if (idx === -1) {
      user.wishlist.push(productId);
      wishlisted = true;
    } else {
      user.wishlist.splice(idx, 1);
      wishlisted = false;
    }

    await user.save();
    res.json({ wishlisted });
  } catch (err) {
    console.error('Toggle wishlist error:', err);
    res.status(500).json({ error: 'Failed to update wishlist' });
  }
});

module.exports = router;
