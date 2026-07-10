const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  buyer:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  rating:  { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, maxlength: 1000 },
}, { timestamps: true });

// One review per buyer per product
reviewSchema.index({ product: 1, buyer: 1 }, { unique: true });

// Recalculate product rating — called explicitly from routes/reviews.js
// after every create/update/delete, since findOneAndUpdate(upsert) and
// deleteOne() do NOT fire document 'save'/'remove' middleware.
reviewSchema.statics.calcAverageRating = async function (productId) {
  const Product = require('./Product');
  const stats = await this.aggregate([
    { $match: { product: productId } },
    { $group: { _id: '$product', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  if (stats.length > 0) {
    await Product.findByIdAndUpdate(productId, {
      ratingAvg:   Math.round(stats[0].avg * 10) / 10,
      ratingCount: stats[0].count,
    });
  } else {
    await Product.findByIdAndUpdate(productId, { ratingAvg: 0, ratingCount: 0 });
  }
};

module.exports = mongoose.model('Review', reviewSchema);
