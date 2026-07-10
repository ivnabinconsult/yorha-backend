const axios = require('axios');

const PAYSTACK_BASE = 'https://api.paystack.co';
const headers = () => ({
  Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
});

// Initialise a transaction — returns authorization_url to redirect buyer
const initializeTransaction = async ({ email, amount, reference, metadata }) => {
  // Paystack amount is in kobo (multiply NGN by 100)
  const res = await axios.post(`${PAYSTACK_BASE}/transaction/initialize`, {
    email,
    amount: Math.round(amount * 100),
    reference,
    metadata,
    callback_url: `${process.env.CLIENT_URL}/payment/verify`,
  }, { headers: headers() });
  return res.data.data; // { authorization_url, access_code, reference }
};

// Verify a transaction by reference
const verifyTransaction = async (reference) => {
  const res = await axios.get(`${PAYSTACK_BASE}/transaction/verify/${reference}`, {
    headers: headers(),
  });
  return res.data.data; // { status, amount, customer, ... }
};

// Create a transfer recipient (bank account)
const createTransferRecipient = async ({ accountName, accountNumber, bankCode }) => {
  const res = await axios.post(`${PAYSTACK_BASE}/transferrecipient`, {
    type:           'nuban',
    name:           accountName,
    account_number: accountNumber,
    bank_code:      bankCode,
    currency:       'NGN',
  }, { headers: headers() });
  return res.data.data; // { recipient_code, ... }
};

// Initiate a transfer to a recipient
const initiateTransfer = async ({ amount, recipientCode, reason, reference }) => {
  const res = await axios.post(`${PAYSTACK_BASE}/transfer`, {
    source:    'balance',
    amount:    Math.round(amount * 100),
    recipient: recipientCode,
    reason,
    reference,
  }, { headers: headers() });
  return res.data.data; // { transfer_code, status, ... }
};

// Resolve a bank account number
const resolveAccountNumber = async ({ accountNumber, bankCode }) => {
  const res = await axios.get(
    `${PAYSTACK_BASE}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
    { headers: headers() }
  );
  return res.data.data; // { account_name, account_number }
};

// List banks
const listBanks = async () => {
  const res = await axios.get(`${PAYSTACK_BASE}/bank?currency=NGN`, {
    headers: headers(),
  });
  return res.data.data;
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  createTransferRecipient,
  initiateTransfer,
  resolveAccountNumber,
  listBanks,
};
