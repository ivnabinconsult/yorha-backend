const cron = require('node-cron');
const publishScheduledProducts = require('./publishScheduled');

// Runs every minute. That's frequent enough that a product scheduled for
// "9:00 AM" actually goes live within 60 seconds of 9:00 AM, without being
// so frequent it puts any real load on Mongo — updateMany with an indexed-
// ish filter on a handful of scheduled docs is cheap.
const startCronJobs = () => {
  cron.schedule('* * * * *', publishScheduledProducts, {
    name: 'publish-scheduled-products',
    noOverlap: true, // skip a tick rather than stack runs if Mongo is slow
  });
  console.log('⏰ Cron jobs started (scheduled-publish: every minute)');
};

module.exports = startCronJobs;
