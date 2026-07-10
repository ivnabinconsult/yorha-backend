const { S3Client } = require('@aws-sdk/client-s3');

const b2Client = new S3Client({
  endpoint: process.env.B2_ENDPOINT,
  region:   process.env.B2_REGION,
  credentials: {
    accessKeyId:     process.env.B2_KEY_ID,
    secretAccessKey: process.env.B2_APP_KEY,
  },
});

module.exports = b2Client;
