# Yorha Backend API

Node.js / Express / MongoDB backend for the Yorha digital content marketplace.

## Stack
- **Runtime:** Node.js + Express
- **Database:** MongoDB Atlas
- **File storage:** Backblaze B2 (content files) + Cloudinary (cover images)
- **Payments:** Paystack (NGN) + Stripe (international)
- **Auth:** JWT (role-based: reader / author)
- **Deployment:** Railway

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Run in development
```bash
npm run dev
```

### 4. Run in production
```bash
npm start
```

---

## API Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /api/auth/register | Public | Register reader or author |
| POST | /api/auth/login | Public | Login (role enforced) |
| GET | /api/auth/me | Any | Get current user |
| GET | /api/products | Public | Browse listings |
| GET | /api/products/:id | Public | Single product |
| POST | /api/products | Author | Create listing |
| POST | /api/products/:id/cover | Author | Upload cover |
| PUT | /api/products/:id | Author | Update listing |
| DELETE | /api/products/:id | Author | Delete listing |
| GET | /api/products/author/me | Author | Own listings |
| POST | /api/orders/initiate | Reader | Start payment |
| POST | /api/orders/verify | Reader | Verify Paystack payment |
| GET | /api/orders/my | Reader | Purchase history |
| GET | /api/orders/sales | Author | Sales list |
| GET | /api/files/:productId | Reader | Get signed download URL |
| POST | /api/payments/paystack/webhook | Public | Paystack webhook |
| POST | /api/payments/stripe/webhook | Public | Stripe webhook |
| GET | /api/payouts/balance | Author | Check balance |
| GET | /api/payouts/banks | Author | List NGN banks |
| POST | /api/payouts/resolve | Author | Verify bank account |
| POST | /api/payouts/withdraw | Author | Request payout |
| GET | /api/payouts/history | Author | Payout history |
| GET | /api/reviews/:productId | Public | Get reviews |
| POST | /api/reviews/:productId | Reader | Submit review |
| DELETE | /api/reviews/:productId | Reader | Delete review |

---

## Changelog — bug fixes (this pass)

- **Payment initiation/verification de-duplicated.** There used to be two
  separate implementations: `/api/orders/initiate`+`/verify` (using
  `utils/paystack.js`) and `/api/payments/paystack/initiate`+`/verify`
  (calling Paystack directly via axios). They computed VAT/platform fees
  slightly differently and could drift out of sync. The `orders.js` version
  is now the single source of truth; `payments.js` only handles webhooks.
- **Fixed `Order.create()` crash on repeat checkout.** The unique
  `{buyer, product}` index meant a second `/initiate` call after a failed
  or abandoned payment threw an uncaught `E11000 duplicate key` error.
  Switched to `findOneAndUpdate(upsert: true)`.
- **Fixed payout status never updating on success.** `transfer.success`
  webhook handler destructured `Payout` as a named export
  (`const { Payout } = require(...)`), but `Payout.js` exports the model
  directly. This threw every time, so successful transfers stayed stuck at
  `status: 'processing'` in the DB forever even though the money moved.
- **Fixed review ratings never recalculating.** `Review.js`'s
  `post('save')`/`post('remove')` hooks never fired because
  `routes/reviews.js` uses `findOneAndUpdate`/`deleteOne`, which skip
  document middleware. `ratingAvg`/`ratingCount` were permanently frozen.
  Now recalculated explicitly after create/update/delete.
- **Fixed "Schedule for later" behaving identically to "Publish
  immediately."** Both previously set `status: 'live'` right away. Added a
  `scheduled` status (excluded from the public feed) — note an actual
  cron/scheduled job to flip `scheduled` → `live` at `publishedAt` still
  needs to be built.
- Removed duplicate `resetPasswordToken`/`resetPasswordExpires` field
  declarations in `User.js` schema.
- Added `select: false` to `User.password` so it's excluded from queries
  by default, matching what `.select('+password')` in login assumed was
  already happening.
- Corrected `mongoose` version in `package.json` (`^9.7.2` doesn't exist;
  pinned to `^8.9.5`), regenerated `package-lock.json`.

## Deploy to Railway

1. Push to GitHub
2. Create new Railway project → Deploy from GitHub repo
3. Add all `.env` variables in Railway dashboard under Variables
4. Railway auto-detects Node.js and runs `npm start`
5. Set your Railway URL as `CLIENT_URL` in frontend `.env`

---

## Webhook Setup

### Paystack
- Go to Paystack Dashboard → Settings → API Keys & Webhooks
- Set webhook URL: `https://your-railway-url.up.railway.app/api/payments/paystack/webhook`

### Stripe
- Go to Stripe Dashboard → Developers → Webhooks
- Set webhook URL: `https://your-railway-url.up.railway.app/api/payments/stripe/webhook`
- Listen for: `payment_intent.succeeded`
- Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`
