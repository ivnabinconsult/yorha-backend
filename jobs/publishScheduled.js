const Product = require('../models/Product');

// Flips any 'scheduled' product whose publishedAt has arrived over to 'live'.
// Uses updateMany with a condition (not findOne + save in a loop) so it's
// safe to run concurrently — if Railway ever scales to multiple instances,
// two overlapping runs just both issue the same idempotent update; neither
// double-publishes anything.
//
// publishedAt is left untouched (it stays as the date the author picked),
// so "newest" sorting and any "published X ago" UI on the frontend still
// reflects the intended publish time, not the moment the cron happened to
// tick.
const publishScheduledProducts = async () => {
  try {
    const result = await Product.updateMany(
      { status: 'scheduled', publishedAt: { $lte: new Date() } },
      { $set: { status: 'live' } }
    );

    if (result.modifiedCount > 0) {
      console.log(`📅 Published ${result.modifiedCount} scheduled product(s)`);
    }
  } catch (err) {
    console.error('❌ Scheduled publish job error:', err.message);
  }
};

module.exports = publishScheduledProducts;
