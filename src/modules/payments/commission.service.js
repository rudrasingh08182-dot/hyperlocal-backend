const pool = require('../../config/db');

const COMMISSION_RATE = 0.10; // 10%

// Safe integer math - all amounts in paise
function calculateCommission(totalPaise) {
  const commission = Math.round(totalPaise * COMMISSION_RATE);
  const sellerShare = totalPaise - commission;
  return { commission, sellerShare };
}

// Called when ONLINE order is placed
async function processOnlinePayment(orderId, client) {
  const order = await client.query(
    'SELECT * FROM orders WHERE id = $1::uuid', [orderId]
  );
  const o = order.rows[0];
  const totalPaise = Math.round(parseFloat(o.total_amount) * 100);
  const { commission, sellerShare } = calculateCommission(totalPaise);

  // Update order with financial breakdown
  await client.query(
    `UPDATE orders SET
      total_amount_paise = $1,
      platform_commission_paise = $2,
      seller_share_paise = $3,
      payment_status = 'paid'
     WHERE id = $4::uuid`,
    [totalPaise, commission, sellerShare, orderId]
  );

  // Get current seller balance
  const seller = await client.query(
    'SELECT id FROM sellers WHERE id = $1::uuid',
    [o.seller_id]
  );

  const lastEntry = await client.query(
    `SELECT balance_after_paise FROM seller_ledger
     WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [o.seller_id]
  );

  const currentBalance = lastEntry.rows[0]?.balance_after_paise || 0;
  const newBalance = currentBalance + sellerShare;

  // Credit seller's share to ledger
  await client.query(
    `INSERT INTO seller_ledger
     (seller_id, order_id, type, amount_paise, description, balance_after_paise)
     VALUES ($1, $2, 'CREDIT', $3, $4, $5)`,
    [o.seller_id, orderId, sellerShare,
     `Online payment received. Commission: ₹${(commission/100).toFixed(2)}`,
     newBalance]
  );

  return { totalPaise, commission, sellerShare };
}

// Called when COD order is marked DELIVERED
async function processCODDelivery(orderId, client) {
  const order = await client.query(
    'SELECT * FROM orders WHERE id = $1::uuid', [orderId]
  );
  const o = order.rows[0];
  const totalPaise = Math.round(parseFloat(o.total_amount) * 100);
  const { commission, sellerShare } = calculateCommission(totalPaise);

  // Update order financial breakdown
  await client.query(
    `UPDATE orders SET
      total_amount_paise = $1,
      platform_commission_paise = $2,
      seller_share_paise = $3,
      payment_status = 'paid',
      delivered_at = NOW()
     WHERE id = $4::uuid`,
    [totalPaise, commission, sellerShare, orderId]
  );

  // Get current seller balance
  const lastEntry = await client.query(
    `SELECT balance_after_paise FROM seller_ledger
     WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [o.seller_id]
  );

  const currentBalance = lastEntry.rows[0]?.balance_after_paise || 0;
  // COD: seller got 100% cash but owes 10% commission = negative entry
  const newBalance = currentBalance - commission;

  await client.query(
    `INSERT INTO seller_ledger
     (seller_id, order_id, type, amount_paise, description, balance_after_paise)
     VALUES ($1, $2, 'COD_DEBT', $3, $4, $5)`,
    [o.seller_id, orderId, commission,
     `COD debt: 10% commission owed on ₹${(totalPaise/100).toFixed(2)} cash collected`,
     newBalance]
  );

  return { totalPaise, commission, sellerShare };
}

// Reverse commission on cancellation/refund
async function reverseCommission(orderId, client) {
  const order = await client.query(
    'SELECT * FROM orders WHERE id = $1::uuid', [orderId]
  );
  const o = order.rows[0];

  if (!o.seller_share_paise) return; // Not yet processed

  const lastEntry = await client.query(
    `SELECT balance_after_paise FROM seller_ledger
     WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [o.seller_id]
  );

  const currentBalance = lastEntry.rows[0]?.balance_after_paise || 0;
  const newBalance = currentBalance - o.seller_share_paise;

  await client.query(
    `INSERT INTO seller_ledger
     (seller_id, order_id, type, amount_paise, description, balance_after_paise)
     VALUES ($1, $2, 'REFUND', $3, $4, $5)`,
    [o.seller_id, orderId, o.seller_share_paise,
     `Commission reversed due to order cancellation/refund`,
     newBalance]
  );

  await client.query(
    `UPDATE orders SET payment_status = 'refunded' WHERE id = $1::uuid`,
    [orderId]
  );
}

module.exports = { calculateCommission, processOnlinePayment, processCODDelivery, reverseCommission };