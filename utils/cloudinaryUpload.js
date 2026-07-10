const cloudinary = require('../config/cloudinary');
const streamifier = require('streamifier');

// Upload image buffer to Cloudinary
const uploadCoverToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder:         'yorha/covers',
        transformation: [
          {
            width:   800,
            height:  1200,
            crop:    'fill',   // force every cover to this exact size, no matter the source
            gravity: 'auto',   // content-aware crop — won't blindly chop off faces/titles
          },
          {
            fetch_format: 'auto', // serves WebP/AVIF to browsers that support it
            quality:      'auto', // Cloudinary picks the smallest file that looks good
          },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// Upload a user avatar image buffer to Cloudinary. Square crop (1:1),
// gravity:auto so it doesn't blindly center-crop a portrait photo if the
// source isn't already square.
const uploadAvatarToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder:         'yorha/avatars',
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'auto' },
          { fetch_format: 'auto', quality: 'auto' },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// Delete a cover image from Cloudinary by public ID
const deleteCoverFromCloudinary = async (publicId) => {
  if (!publicId) return;
  await cloudinary.uploader.destroy(publicId);
};

module.exports = { uploadCoverToCloudinary, deleteCoverFromCloudinary, uploadAvatarToCloudinary };
