const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Use 'onboarding@resend.dev' until you verify your own domain on Resend —
// works immediately but only delivers to your own Resend account email
// until a domain is verified. Swap to noreply@yourdomain.com once verified.
const FROM = `Yorha <${process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'}>`;

// Resend's SDK returns { data, error } instead of throwing — if you don't
// check `error`, a failed send looks identical to a successful one and the
// caller (e.g. register()) happily returns 201 with no email ever sent.
// Wrap every send through this so failures are logged and bubble up.
async function sendMail(payload) {
  const { data, error } = await resend.emails.send(payload);
  if (error) {
    console.error('❌ Resend send failed:', JSON.stringify(error), 'to:', payload.to);
    throw new Error(`Email send failed: ${error.message || JSON.stringify(error)}`);
  }
  console.log('✅ Resend sent:', data.id, 'to:', payload.to);
  return data;
}

async function sendPasswordResetEmail(toEmail, resetToken, userName, role) {
  const resetUrl = `${process.env.CLIENT_URL}?token=${resetToken}`;
  const roleLabel = role === 'author' ? 'author' : 'reader';

  await sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Reset your Yorha password',
    text: `Hi ${userName},

We received a request to reset the password for your Yorha ${roleLabel} account.

Reset your password here (expires in 1 hour):
${resetUrl}

If you didn't request this, you can safely ignore this email — your password won't change.

— Yorha`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a0a;color:#fff;border-radius:12px;">
        <h1 style="font-size:28px;font-weight:900;letter-spacing:2px;margin-bottom:8px;">YORHA</h1>
        <p style="color:#aaa;margin-bottom:32px;">African Stories. Global Stage.</p>
        <h2 style="font-size:20px;margin-bottom:12px;">Reset your password</h2>
        <p style="color:#ccc;line-height:1.6;">Hi ${userName}, click the button below to reset the password for your <strong>${roleLabel}</strong> account. This link expires in <strong>1 hour</strong>.</p>
        <a href="${resetUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#7C3AED;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Reset Password</a>
        <p style="color:#666;font-size:13px;">If you didn't request this, ignore this email. Your password won't change.</p>
      </div>
    `,
  });
}

async function sendVerificationEmail(toEmail, verifyToken, userName, role) {
  const verifyUrl = `${process.env.CLIENT_URL}?verify=${verifyToken}`;
  const roleLabel = role === 'author' ? 'author' : 'reader';

  await sendMail({
    from: FROM,
    to: toEmail,
    subject: 'Verify your Yorha account',
    text: `Hi ${userName},

Welcome to Yorha! Please verify your ${roleLabel} account by clicking the link below (expires in 24 hours):
${verifyUrl}

If you didn't create this account, you can safely ignore this email.

— Yorha`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a0a;color:#fff;border-radius:12px;">
        <h1 style="font-size:28px;font-weight:900;letter-spacing:2px;margin-bottom:8px;">YORHA</h1>
        <p style="color:#aaa;margin-bottom:32px;">African Stories. Global Stage.</p>
        <h2 style="font-size:20px;margin-bottom:12px;">Verify your account</h2>
        <p style="color:#ccc;line-height:1.6;">Hi ${userName}, click the button below to activate your <strong>${roleLabel}</strong> account. This link expires in <strong>24 hours</strong>.</p>
        <a href="${verifyUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#22C55E;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Verify Account</a>
        <p style="color:#666;font-size:13px;">If you didn't create this account, ignore this email.</p>
      </div>
    `,
  });
}

async function sendPurchaseReceiptEmail(toEmail, userName, product, order) {
  const amount = Number(order.amount).toLocaleString();

  await sendMail({
    from: FROM,
    to: toEmail,
    subject: `Your Yorha receipt — ${product.title}`,
    text: `Hi ${userName},

Thanks for your purchase on Yorha!

${product.title}
Amount paid: ₦${amount}
Reference: ${order.paymentReference}

Your purchase is now available in your library:
${process.env.CLIENT_URL}

— Yorha`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a0a;color:#fff;border-radius:12px;">
        <h1 style="font-size:28px;font-weight:900;letter-spacing:2px;margin-bottom:8px;">YORHA</h1>
        <p style="color:#aaa;margin-bottom:32px;">African Stories. Global Stage.</p>
        <h2 style="font-size:20px;margin-bottom:12px;">Purchase confirmed</h2>
        <p style="color:#ccc;line-height:1.6;">Hi ${userName}, thanks for your purchase! Here's your receipt:</p>
        <div style="background:#151515;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="color:#fff;margin:0 0 4px;font-weight:700;">${product.title}</p>
          <p style="color:#999;margin:0;font-size:13px;">Amount paid: ₦${amount}</p>
          <p style="color:#666;margin:4px 0 0;font-size:12px;">Ref: ${order.paymentReference}</p>
        </div>
        <a href="${process.env.CLIENT_URL}" style="display:inline-block;margin:8px 0 24px;padding:14px 28px;background:#7C3AED;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">View in Library</a>
        <p style="color:#666;font-size:13px;">All sales are final per our Terms of Service.</p>
      </div>
    `,
  });
}

async function sendSaleNotificationEmail(toEmail, authorName, product, order) {
  const earnings = Number(order.authorEarns).toLocaleString();

  await sendMail({
    from: FROM,
    to: toEmail,
    subject: `You made a sale! — ${product.title}`,
    text: `Hi ${authorName},

Great news — you just sold a copy of "${product.title}" on Yorha.

You earned: ₦${earnings}
This has been added to your available balance.

— Yorha`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a0a;color:#fff;border-radius:12px;">
        <h1 style="font-size:28px;font-weight:900;letter-spacing:2px;margin-bottom:8px;">YORHA</h1>
        <p style="color:#aaa;margin-bottom:32px;">African Stories. Global Stage.</p>
        <h2 style="font-size:20px;margin-bottom:12px;">🎉 You made a sale!</h2>
        <p style="color:#ccc;line-height:1.6;">Hi ${authorName}, someone just bought <strong>${product.title}</strong>.</p>
        <div style="background:#151515;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="color:#999;margin:0;font-size:13px;">You earned</p>
          <p style="color:#22C55E;margin:4px 0 0;font-size:22px;font-weight:900;">₦${earnings}</p>
        </div>
        <a href="${process.env.CLIENT_URL}" style="display:inline-block;margin:8px 0 24px;padding:14px 28px;background:#22C55E;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">View Dashboard</a>
        <p style="color:#666;font-size:13px;">This has been added to your available balance.</p>
      </div>
    `,
  });
}

async function sendPayoutConfirmationEmail(toEmail, authorName, payout) {
  const amount = Number(payout.amount).toLocaleString();

  await sendMail({
    from: FROM,
    to: toEmail,
    subject: `Your Yorha payout has been sent — ₦${amount}`,
    text: `Hi ${authorName},

We've sent your payout of ₦${amount} to your registered bank account (${payout.bankName}, ${payout.accountNumber}).

It should reflect within 1-3 business days depending on your bank.

— Yorha`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0a0a0a;color:#fff;border-radius:12px;">
        <h1 style="font-size:28px;font-weight:900;letter-spacing:2px;margin-bottom:8px;">YORHA</h1>
        <p style="color:#aaa;margin-bottom:32px;">African Stories. Global Stage.</p>
        <h2 style="font-size:20px;margin-bottom:12px;">Payout sent 💸</h2>
        <p style="color:#ccc;line-height:1.6;">Hi ${authorName}, we've sent your payout to your bank account.</p>
        <div style="background:#151515;border-radius:8px;padding:16px;margin:20px 0;">
          <p style="color:#999;margin:0;font-size:13px;">Amount sent</p>
          <p style="color:#22C55E;margin:4px 0 8px;font-size:22px;font-weight:900;">₦${amount}</p>
          <p style="color:#666;margin:0;font-size:12px;">${payout.bankName} — ${payout.accountNumber}</p>
        </div>
        <p style="color:#666;font-size:13px;">It should reflect within 1-3 business days depending on your bank.</p>
      </div>
    `,
  });
}

module.exports = {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendPurchaseReceiptEmail,
  sendSaleNotificationEmail,
  sendPayoutConfirmationEmail,
};
