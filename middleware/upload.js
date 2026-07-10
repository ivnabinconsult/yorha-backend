const multer = require('multer');
const path = require('path');

// Store in memory — we stream directly to B2 or Cloudinary
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = ['.pdf', '.zip'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF and ZIP files are allowed'), false);
  }
};

const imageFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPG, PNG, or WEBP images are allowed'), false);
  }
};

// For content files (PDF / ZIP)
const uploadFile = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// For cover images
const uploadImage = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Wraps a multer .single(fieldName) middleware so its errors (wrong file
// type from fileFilter, or MulterError like LIMIT_FILE_SIZE) come back as
// clean JSON — { error: "..." } — instead of falling through to Express's
// default HTML/stack-trace error page. Multer's own middleware calls
// `cb(err)` on failure, and since it's used directly as route middleware
// (no wrapping try/catch, and no async/await for multer to be caught by),
// that error would otherwise skip straight past every route handler.
const handleUpload = (multerMiddleware, fieldName) => (req, res, next) => {
  multerMiddleware.single(fieldName)(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      const limitMB = multerMiddleware.options.limits.fileSize / (1024 * 1024);
      return res.status(400).json({ error: `File is too large. Max size is ${limitMB}MB.` });
    }

    // Covers both fileFilter rejections (e.g. "Only PDF and ZIP files are
    // allowed") and any other Multer/stream error.
    return res.status(400).json({ error: err.message || 'File upload failed.' });
  });
};

module.exports = {
  uploadFile,
  uploadImage,
  // Drop-in replacements for `uploadFile.single('file')` /
  // `uploadImage.single('cover')` in routes/products.js — same behavior,
  // clean error responses.
  uploadFileSafe:  (fieldName) => handleUpload(uploadFile,  fieldName),
  uploadImageSafe: (fieldName) => handleUpload(uploadImage, fieldName),
};
