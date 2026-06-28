const pool = require('../../config/db');

const RETURN_WINDOWS = {
  PERISHABLE_FOOD: 0,
  PACKAGED_FOOD: 2,
  STANDARD_ELECTRONICS: 7,
  HIGH_VALUE_ELECTRONICS: 7,
};

const VALID_REASONS = {
  PERISHABLE_FOOD: [],
  PACKAGED_FOOD: ['DAMAGED', 'EXPIRED'],
  STANDARD_ELECTRONICS: ['REPLACEMENT'],
  HIGH_VALUE_ELECTRONICS: ['DAMAGED', 'DEFECTIVE', 'WRONG_ITEM'],
};

async function checkReturnEligibility(orderItemId, reason, currentTimestamp) {
  const result = await pool.query(
    `SELECT oi.*, p.return_policy, p.name as product_name,
            o.delivered_at, o.status as order_status
     FROM order_items oi
     JOIN products p ON oi.product_id = p.id
     JOIN orders o ON oi.order_id = o.id
     WHERE oi.id = $1::uuid`,
    [orderItemId]
  );

  if (!result.rows[0]) throw new Error('Order item not found');

  const item = result.rows[0];
  const policy = item.return_policy;

  // Must be delivered first
  if (item.order_status !== 'delivered') {
    throw new Error('Order must be delivered before return can be requested');
  }

  if (!item.delivered_at) {
    throw new Error('Delivery timestamp not recorded');
  }

  // PERISHABLE — blocked immediately after delivery
  if (policy === 'PERISHABLE_FOOD') {
    throw new Error('Perishable food items cannot be returned after delivery. Rejection must happen at doorstep only.');
  }

  // Check time window
  const deliveredAt = new Date(item.delivered_at);
  const now = new Date(currentTimestamp);
  const daysDiff = Math.floor((now - deliveredAt) / (1000 * 60 * 60 * 24));
  const windowDays = RETURN_WINDOWS[policy];

  if (daysDiff > windowDays) {
    throw new Error(`Return window expired. ${policy} allows ${windowDays} day(s). ${daysDiff} day(s) have passed.`);
  }

  // Check valid reasons
  const validReasons = VALID_REASONS[policy];
  if (!validReasons.includes(reason)) {
    throw new Error(`Invalid return reason for ${policy}. Allowed: ${validReasons.join(', ')}`);
  }

  // STANDARD_ELECTRONICS — no refunds, only replacement
  if (policy === 'STANDARD_ELECTRONICS' && reason !== 'REPLACEMENT') {
    throw new Error('Standard electronics only qualify for replacement, not refund.');
  }

  return { eligible: true, policy, daysDiff, windowDays };
}

async function processReturnRequest(orderItemId, reason, evidenceImageUrl) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check eligibility first
    const eligibility = await checkReturnEligibility(orderItemId, reason, new Date());

    const itemResult = await client.query(
      `SELECT oi.*, p.return_policy, p.name as product_name,
              o.id as order_id, o.seller_id, o.buyer_id,
              oi.unit_price * oi.quantity as refund_amount
       FROM order_items oi
       JOIN products p ON oi.product_id = p.id
       JOIN orders o ON oi.order_id = o.id
       WHERE oi.id = $1::uuid`,
      [orderItemId]
    );

    const item = itemResult.rows[0];
    const policy = item.return_policy;

    // HIGH_VALUE_ELECTRONICS — requires image evidence
    if (policy === 'HIGH_VALUE_ELECTRONICS' && !evidenceImageUrl) {
      throw new Error('Evidence image is mandatory for high value electronics returns.');
    }

    // Determine initial status
    let initialStatus = 'PENDING_APPROVAL';
    if (policy === 'PACKAGED_FOOD') initialStatus = 'APPROVED';
    if (policy === 'STANDARD_ELECTRONICS') initialStatus = 'REPLACEMENT_ISSUED';

    const refundAmountPaise = Math.round(parseFloat(item.refund_amount) * 100);

    // Create return request
    const returnReq = await client.query(
      `INSERT INTO return_requests
       (order_id, order_item_id, buyer_id, seller_id, reason,
        return_policy, status, evidence_image_url, refund_amount_paise)
       VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [item.order_id, orderItemId, item.buyer_id, item.seller_id,
       reason, policy, initialStatus, evidenceImageUrl, refundAmountPaise]
    );

    // Update order status
    await client.query(
      `UPDATE orders SET status = 'return_requested' WHERE id = $1`,
      [item.order_id]
    );

    // If auto-approved (packaged food) — process refund immediately
    if (initialStatus === 'APPROVED') {
      await processRefundToLedger(item.seller_id, item.order_id, refundAmountPaise, client);
    }

    await client.query('COMMIT');
    return returnReq.rows[0];

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function processRefundToLedger(sellerId, orderId, refundAmountPaise, client) {
  const lastEntry = await client.query(
    `SELECT balance_after_paise FROM seller_ledger
     WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [sellerId]
  );

  const currentBalance = lastEntry.rows[0]?.balance_after_paise || 0;
  const newBalance = currentBalance - refundAmountPaise;

  await client.query(
    `INSERT INTO seller_ledger
     (seller_id, order_id, type, amount_paise, description, balance_after_paise)
     VALUES ($1, $2, 'REFUND', $3, $4, $5)`,
    [sellerId, orderId, refundAmountPaise,
     `Refund processed for return request`,
     newBalance]
  );
}

module.exports = { checkReturnEligibility, processReturnRequest };