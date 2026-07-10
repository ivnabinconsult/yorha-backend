const express  = require('express');
const router   = express.Router();
const Product  = require('../models/Product');
const File     = require('../models/File');
const { protect, restrictTo } = require('../middleware/auth');
const { uploadFile, uploadImage } = require('../middleware/upload');
const { uploadToB2 }              = require('../utils/b2Upload');
const { uploadCoverToCloudinary, deleteCoverFromCloudinary } = require('../utils/cloudinaryUpload');

// ── GET /api/products  — browse all live products (public)
router.get('/', async (req, res) => {
  try {
    const { type, genre, search, sort = 'createdAt', page = 1, limit = 20 } = req.query;
    // Only show products that are actually purchasable: live AND with a real
    // uploaded file. Prevents demo/placeholder products (e.g. seed data with
    // no file attached) from appearing on a site meant to look real.
    const filter = { status: 'live', file: { $ne: null } };
    if (type)   filter.contentType = type;
    if (genre)  filter.genre = genre;
    if (search) filter.$text = { $search: search };

    const sortMap = {
      newest:    { createdAt: -1 },
      trending:  { salesCount: -1 },
      rating:    { ratingAvg: -1 },
      priceLow:  { price: 1 },
      priceHigh: { price: -1 },
    };

    const products = await Product.find(filter)
      .populate('author', 'name penName avatar')
      .sort(sortMap[sort] || { createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await Product.countDocuments(filter);

    res.json({ products, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/:id  — single product (public)
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('author', 'name penName avatar bio');
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Same rule as the browse listing: a 'live' product with no uploaded
    // file isn't a real, purchasable product — treat direct links to it
    // the same as if it didn't exist, rather than letting someone reach a
    // product page they can't actually buy.
    if (product.status === 'live' && !product.file) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // A product taken down via a moderation report shouldn't be reachable
    // by direct link either — treat it as gone from the buyer's perspective.
    if (product.status === 'suspended') {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Increment view count
    product.viewCount += 1;
    await product.save({ validateBeforeSave: false });

    res.json({ product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products  — create listing (author only)
router.post('/',
  protect,
  restrictTo('author'),
  uploadFile.single('file'),
  async (req, res) => {
    try {
      const {
        title, description, contentType, genre, tags, price,
        language, totalChapters, totalPages, volumes, previewChapters,
        publishStatus, publishedAt,
      } = req.body;

      if (!req.file) return res.status(400).json({ error: 'Content file is required' });

      // Upload file to B2
      const b2Key = await uploadToB2(req.file.buffer, req.file.originalname, req.file.mimetype);

      // BUG FIX: this used to create the File document FIRST with
      // `product: 'placeholder'` (a literal string), meant to be replaced
      // with the real product ID once the Product existed. But File.js's
      // schema requires `product` to be a valid ObjectId — Mongoose can't
      // cast the string "placeholder" to one, so File.create() threw
      // immediately: "Cast to ObjectId failed for value 'placeholder'".
      // This bug existed from the start but was never hit before because
      // seed.js bypasses this route entirely (it inserts Products directly
      // via Product.insertMany, with no File involved at all) — this route
      // had never actually been exercised by a real upload until now.
      //
      // Fix: create the Product first (it doesn't strictly need a file
      // reference to exist), then create the File with the real product
      // ID, then attach that File back onto the Product. No placeholder
      // value ever needed.

      const status = publishStatus === 'Publish immediately' ? 'live'
        : publishStatus === 'Schedule for later' ? 'scheduled'
        : 'draft';

      let product;
      try {
        product = await Product.create({
          title, description, contentType, genre,
          tags:            tags ? tags.split(',').map(t => t.trim()) : [],
          price:           Number(price),
          language:        language || 'English',
          author:          req.user._id,
          authorName:      req.user.penName || req.user.name,
          totalChapters:   totalChapters ? Number(totalChapters) : undefined,
          totalPages:      totalPages    ? Number(totalPages)    : undefined,
          volumes:         volumes       ? Number(volumes)       : undefined,
          previewChapters: previewChapters ? Number(previewChapters) : 1,
          status,
          publishedAt:     status === 'live' ? new Date()
            : status === 'scheduled' ? publishedAt
            : undefined,
        });

        const fileDoc = await File.create({
          product:      product._id,
          uploader:     req.user._id,
          originalName: req.file.originalname,
          mimeType:     req.file.mimetype,
          sizeBytes:    req.file.size,
          b2Key,
          bucket:       process.env.B2_BUCKET_NAME,
        });

        product.file = fileDoc._id;
        await product.save();
      } catch (innerErr) {
        // Cleanup: if the File step fails after the Product was already
        // created, don't leave an orphaned file-less draft sitting in the
        // DB. (It would've been hidden from public listings by an earlier
        // fix either way, but no reason to let dead rows pile up.)
        if (product && product._id) {
          await Product.findByIdAndDelete(product._id).catch(() => {});
        }
        throw innerErr;
      }

      res.status(201).json({ message: 'Product created', product });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }


  }
);

// ── POST /api/products/:id/cover  — upload cover image
router.post('/:id/cover',
  protect,
  restrictTo('author'),
  uploadImage.single('cover'),
  async (req, res) => {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ error: 'Product not found' });
      if (product.author.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Not your product' });
      }
      if (!req.file) return res.status(400).json({ error: 'Cover image required' });

      // Delete old cover if exists
      if (product.coverImage?.publicId) {
        await deleteCoverFromCloudinary(product.coverImage.publicId);
      }

      const { url, publicId } = await uploadCoverToCloudinary(req.file.buffer);
      product.coverImage = { url, publicId };
      await product.save();

      res.json({ message: 'Cover uploaded', coverImage: product.coverImage });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── PUT /api/products/:id  — update product (author only, own product)
router.put('/:id', protect, restrictTo('author'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not your product' });
    }

    const allowedUpdates = ['title', 'description', 'genre', 'tags', 'price', 'status',
                            'totalChapters', 'totalPages', 'volumes', 'previewChapters', 'language'];
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) product[field] = req.body[field];
    });

    await product.save();
    res.json({ message: 'Product updated', product });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/products/:id
router.delete('/:id', protect, restrictTo('author'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not your product' });
    }

    if (product.coverImage?.publicId) {
      await deleteCoverFromCloudinary(product.coverImage.publicId);
    }

    await product.deleteOne();
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/author/me  — author's own listings
router.get('/author/me', protect, restrictTo('author'), async (req, res) => {
  try {
    const products = await Product.find({ author: req.user._id })
      .sort({ createdAt: -1 });
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
