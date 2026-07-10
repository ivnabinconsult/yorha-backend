const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const axios   = require('axios');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order   = require('../models/Order');
const User    = require('../models/User');
const Product = require('../models/Product');
const Payout  = require('../models/Payout');
const { protect, restrictTo } = require('../middleware/auth');
const { sendPurchaseReceiptEmail, sendSaleNotificationEmail } = require('../utils/email');

// CORRECTION: an earlier pass removed /paystack/initiate and
// /paystack/verify/:reference from this file, assuming routes/orders.js's
// /initiate + /verify were the ones actually in use. That was wrong —
// the deployed frontend (auth.js) calls THESE exact paths
// (POST /payments/paystack/initiate, GET /payments/paystack/verify/:ref),
// expecting `authorization_url` (snake_case) in the response. Removing them
// broke checkout entirely. They're restored below, with three real bugs
// fixed in the process (see inline notes): a duplicate-key crash on repeat
// checkout, a missing ownership check on verify, and — the serious one —
// verify() unconditionally re-crediting the author's balance on every call,
// which double-pays authors if the webhook already processed the same
// payment before the client's verify request lands.
//
// routes/orders.js's /initiate and /verify have been removed to avoid this
// exact drift happening again.

// ── POST /api/payments/paystack/initiate
router.post('/paystack/initiate', protect, restrictTo('reader'), async (req, res) => {
  try {
    const { productId } = req.body;
    const buyer = req.user;

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.status !== 'live') return res.status(400).json({ error: 'Product is not available' });

    // Check if already purchased
    const existing = await Order.findOne({ buyer: buyer._id, product: productId });
    if (existing && existing.paymentStatus === 'completed') {
      return res.status(409).json({ error: 'You already own this product' });
    }

    // Calculate amounts
    const base        = product.price;
    const vat         = Math.round(base * 0.075 * 100) / 100;
    const total       = base + vat;
    const platformFee = Math.round(base * 0.10 * 100) / 100;
    const authorEarns = base - platformFee;

    // Generate unique reference
    const reference = `yorha_${Date.now()}_${buyer._id}`;

    // BUG FIX: this used to be Order.create(), which throws a duplicate-key
    // error (E11000) if the buyer already had a pending/failed order for
    // this product from an earlier abandoned or declined checkout attempt —
    // the unique {buyer, product} index rejects the second insert. Using
    // findOneAndUpdate(upsert: true) reuses that row instead.
    const order = await Order.findOneAndUpdate(
      { buyer: buyer._id, product: productId },
      {
        buyer: buyer._id,
        product: productId,
        author: product.author,
        amount: total,
        amountBase: base,
        vat,
        platformFee,
        authorEarns,
        paymentProvider: 'paystack',
        paymentReference: reference,
        paymentStatus: 'pending',
      },
      { upsert: true, new: true }
    );

    // Initialize Paystack transaction
    const paystackRes = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: buyer.email,
        amount: total * 100, // Paystack uses kobo
        reference,
        currency: 'NGN',
        metadata: {
          orderId: order._id.toString(),
          productId: productId,
          productTitle: product.title,
          buyerId: buyer._id.toString(),
        },
        callback_url: `${process.env.CLIENT_URL}?payment=success&reference=${reference}`,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    res.json({
      authorization_url: paystackRes.data.data.authorization_url,
      reference,
      amount: total,
      order: order._id,
    });

  } catch (err) {
    console.error('Paystack initiate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/payments/paystack/verify/:reference
router.get('/paystack/verify/:reference', protect, restrictTo('reader'), async (req, res) => {
  try {
    const { reference } = req.params;

    const existing = await Order.findOne({ paymentReference: reference });
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    // BUG FIX: original had no ownership check at all — any logged-in
    // reader who knew (or guessed) a reference string could hit this route
    // and see someone else's order details (amounts, product, etc).
    if (existing.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not your order' });
    }

    // BUG FIX (the important one): if the webhook already marked this
    // order 'completed' — which can easily happen before the client's
    // verify call lands, since webhooks aren't blocked on page redirects —
    // return early here. Without this check, the code below would run
    // again and credit the author's balance and salesCount a second time
    // for the same payment every time this endpoint was hit (e.g. the
    // buyer refreshing the success page).
    if (existing.paymentStatus === 'completed') {
      return res.json({ status: 'success', order: existing });
    }

    const paystackRes = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    const data = paystackRes.data.data;

    if (data.status === 'success') {
      // Extra safety net: filter on paymentStatus != 'completed' so that
      // even if the webhook completes the order in the split-second between
      // our check above and this update, we don't double-credit. If the
      // webhook won the race, this update matches 0 documents and `order`
      // comes back null — we just re-fetch and return the already-credited
      // order instead of crediting again.
      const order = await Order.findOneAndUpdate(
        { paymentReference: reference, paymentStatus: { $ne: 'completed' } },
        { paymentStatus: 'completed', paidAt: new Date() },
        { new: true }
      );

      if (order) {
        await User.findByIdAndUpdate(order.author, {
          $inc: { balance: order.authorEarns, totalEarned: order.authorEarns },
        });
        await Product.findByIdAndUpdate(order.product, { $inc: { salesCount: 1 } });

        // Fire-and-forget-ish: don't let an email failure break checkout.
        // Runs only on the branch that actually credits the author, so a
        // page refresh hitting the already-completed early-return above
        // never re-sends these.
        try {
          const [product, author] = await Promise.all([
            Product.findById(order.product),
            User.findById(order.author),
          ]);
          await sendPurchaseReceiptEmail(req.user.email, req.user.name, product, order);
          if (author) await sendSaleNotificationEmail(author.email, author.name, product, order);
        } catch (emailErr) {
          console.error('Purchase/sale email failed:', emailErr.message);
        }

        return res.json({ status: 'success', order });
      } else {
        const current = await Order.findOne({ paymentReference: reference });
        return res.json({ status: 'success', order: current });
      }
    } else {
      await Order.findOneAndUpdate({ paymentReference: reference }, { paymentStatus: 'failed' });
      return res.json({ status: 'failed' });
    }
  } catch (err) {
    console.error('Paystack verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payments/paystack/webhook
// Paystack sends events here — verify signature then process
router.post('/paystack/webhook', express.json(), async (req, res) => {
  try {
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const { event, data } = req.body;

    if (event === 'charge.success') {
      const reference = data.reference;

      const order = await Order.findOne({ paymentReference: reference });
      if (!order || order.paymentStatus === 'completed') {
        return res.sendStatus(200); // idempotent
      }

      order.paymentStatus = 'completed';
      order.paidAt        = new Date();
      await order.save();

      await User.findByIdAndUpdate(order.author, {
        $inc: { balance: order.authorEarns, totalEarned: order.authorEarns },
      });

      await Product.findByIdAndUpdate(order.product, { $inc: { salesCount: 1 } });

      // Same emails as the verify() path — this exists because the
      // webhook can beat the client's verify() call to the crediting
      // guard, meaning verify()'s branch never runs and never sends these.
      try {
        const [product, author, buyer] = await Promise.all([
          Product.findById(order.product),
          User.findById(order.author),
          User.findById(order.buyer),
        ]);
        if (buyer) await sendPurchaseReceiptEmail(buyer.email, buyer.name, product, order);
        if (author) await sendSaleNotificationEmail(author.email, author.name, product, order);
      } catch (emailErr) {
        console.error('Purchase/sale email failed:', emailErr.message);
      }

      console.log(`✅ Paystack payment confirmed: ${reference}`);
    }

    if (event === 'transfer.success') {
      // BUG FIX: this was `const { Payout } = require('../models/Payout')`,
      // but Payout.js does `module.exports = mongoose.model(...)` — a direct
      // export, not a named one. Destructuring gave `undefined`, so this
      // whole block threw every time a payout actually succeeded, meaning
      // payouts stayed stuck on 'processing' forever even after the money
      // had moved. Fixed by using the top-level import instead.
      await Payout.findOneAndUpdate(
        { paystackTransferCode: data.transfer_code },
        { status: 'success', processedAt: new Date() }
      );
      console.log(`✅ Payout confirmed: ${data.transfer_code}`);
    }

    if (event === 'transfer.failed') {
      const payout = await Payout.findOneAndUpdate(
        { paystackTransferCode: data.transfer_code },
        { status: 'failed', failureReason: data.reason || 'Transfer failed' },
        { new: true }
      );
      if (payout) {
        // Refund author balance
        await User.findByIdAndUpdate(payout.author, {
          $inc: { balance: payout.amount },
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Paystack webhook error:', err.message);
    res.sendStatus(500);
  }
});

// ── POST /api/payments/stripe/webhook
// Raw body required — set in server.js before express.json()
router.post('/stripe/webhook', async (req, res) => {
  try {
    const sig   = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === 'payment_intent.succeeded') {
      const intent    = event.data.object;
      const reference = intent.metadata?.reference;

      if (reference) {
        const order = await Order.findOne({ paymentReference: reference });
        if (order && order.paymentStatus !== 'completed') {
          order.paymentStatus = 'completed';
          order.paidAt        = new Date();
          await order.save();

          await User.findByIdAndUpdate(order.author, {
            $inc: { balance: order.authorEarns, totalEarned: order.authorEarns },
          });

          await Product.findByIdAndUpdate(order.product, { $inc: { salesCount: 1 } });

          console.log(`✅ Stripe payment confirmed: ${reference}`);
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
