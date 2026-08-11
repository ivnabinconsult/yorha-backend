// Reuses same B2 account credentials as your existing upload flow.
// If you already have a b2 auth util elsewhere, swap authorizeB2() to import
// from there instead of duplicating the auth call.

const axios = require('axios');

const B2_KEY_ID = process.env.B2_KEY_ID;
const B2_APP_KEY = process.env.B2_APPLICATION_KEY;
const B2_BUCKET_ID = process.env.B2_BUCKET_ID; // bucket ID, not bucket name

let cachedAuth = null;
let authExpiry = 0;

async function authorizeB2() {
  if (cachedAuth && Date.now() < authExpiry) return cachedAuth;

  const res = await axios.get('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    auth: { username: B2_KEY_ID, password: B2_APP_KEY }
  });

  cachedAuth = {
    apiUrl: res.data.apiInfo.storageApi.apiUrl,
    authorizationToken: res.data.authorizationToken
  };
  authExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return cachedAuth;
}

/**
 * Signed, time-limited download URL for a single private B2 file.
 * @param {string} b2Key - File.b2Key
 * @param {string} bucketName - File.bucket (e.g. "Yorha-517")
 * @param {number} validSeconds - default 600 (10 min)
 */
async function getSignedFileUrl(b2Key, bucketName, validSeconds = 600) {
  const auth = await authorizeB2();

  const authRes = await axios.post(
    `${auth.apiUrl}/b2api/v3/b2_get_download_authorization`,
    {
      bucketId: B2_BUCKET_ID,
      fileNamePrefix: b2Key,
      validDurationInSeconds: validSeconds
    },
    { headers: { Authorization: auth.authorizationToken } }
  );

  return `${auth.apiUrl}/file/${bucketName}/${b2Key}?Authorization=${authRes.data.authorizationToken}`;
}

module.exports = { getSignedFileUrl, authorizeB2 };
