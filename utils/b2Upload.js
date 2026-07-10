const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const b2Client = require('../config/b2');
const { v4: uuidv4 } = require('uuid');

const BUCKET = process.env.B2_BUCKET_NAME;

// Upload a file buffer to B2
// Returns the B2 key (path) for storage in DB
const uploadToB2 = async (buffer, originalName, mimeType) => {
  const ext = originalName.split('.').pop();
  const key = `products/${uuidv4()}.${ext}`;

  await b2Client.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
    // Private — no ACL needed with B2 private bucket
  }));

  return key;
};

// Generate a signed URL valid for 30 minutes
// Only called after verifying the user has a paid order
const getSignedDownloadUrl = async (b2Key, expiresInSeconds = 1800) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key:    b2Key,
  });
  return getSignedUrl(b2Client, command, { expiresIn: expiresInSeconds });
};

module.exports = { uploadToB2, getSignedDownloadUrl };
