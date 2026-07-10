// One-off script: marks all EXISTING accounts as verified, so accounts
// created before this feature shipped aren't locked out of login.
// Run once: node backfillVerified.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User'); // adjust path if this script lives elsewhere

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const result = await User.updateMany(
    { isVerified: { $ne: true } },
    { $set: { isVerified: true } }
  );
  console.log(`Verified ${result.modifiedCount} existing account(s).`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
