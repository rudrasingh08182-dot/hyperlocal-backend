const pool = require('../../config/db');

// ── helpers ──────────────────────────────────────────────────────────────────

async function notifyFcm(userId, title, body) {
  try {
    const { sendNotification } = require('../../config/firebase');
    const res = await pool.query(
      `SELECT fcm_token FROM users WHERE id = $1`, [userId]
    );
    if (res.rows[0]?.fcm_token) {
      await sendNotification(res.rows[0].fcm_token, title, body);
    }
  } catch (err) {
    console.error('Return FCM error:', err.message);
  }
}

async function notifyWhatsApp(userId, message) {
  try {
    const { sendWhatsApp } = require('../../config/whatsapp');
    const res = await pool.query(`SELECT phone FROM users WHERE id = $1`, [userId]);
    if (res.rows[0]?.phone) {
      await sendWhatsApp(res.rows[0].phone, message);
    }
  } catch (err) {
    console.error('Return WhatsApp error:', err.message);
  }
}

// ── POST /returns ─────────────────────────────────────────────────────────────
// Buyer creates a return request on a delivered order.
// Return window: 7 days from delivered_at. After return_completed, no more returns.
exports.createReturn = async (req, res) => {
  try {
    const { order_id, reason, photo_url } = req.body;
    const buyer_id = req.user.id;

    if (!order_id || !reason) {
      return res.status(400).json({ error: 'order_id and reason are required' });
    }

    // Validate order
    const orderRes = await pool.query(
      `SELECT o.*, s.user_id as seller_user_id
       FROM orders o
       JOIN sellers s ON o.seller_id = s.id
       WHERE o.id = $1::uuid AND o.buyer_id = $2`,
      [order_id, buyer_id]
    );
    const order = orderRes.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'delivered') {
      return res.status(400).json({ error: 'Only delivered orders can be returned' });
    }

    // 7-day return window
    const deliveredAt = new Date(order.delivered_at);
    const daysDiff = Math.floor((Date.now() - deliveredAt) / (1000 * 60 * 60 * 24));
    if (daysDiff > 7) {
      return res.status(400).json({ error: `Return window expired. ${daysDiff} days have passed (max 7).` });
    }

    // Check no existing active return for this order
    const existing = await pool.query(
      `SELECT id, status FROM returns WHERE order_id = $1::uuid AND status NOT IN ('return_rejected', 'return_completed')`,
      [order_id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A return request already exists for this order' });
    }

    // Create return
    const returnRes = await pool.query(
      `INSERT INTO returns
         (order_id, buyer_id, seller_id, reason, photo_url, status)
       VALUES ($1::uuid, $2, $3, $4, $5, 'return_requested')
       RETURNING *`,
      [order_id, buyer_id, order.seller_id, reason, photo_url || null]
    );
    const ret = returnRes.rows[0];

    // Notify seller
    await notifyFcm(
      order.seller_user_id,
      '↩ Return Request',
      `A buyer wants to return order #${order_id.slice(-6).toUpperCase()}. Reason: ${reason}`
    );
    await notifyWhatsApp(
      order.seller_user_id,
      `↩ Return Request on Zaplo!\n\nOrder: #${order_id.slice(-6).toUpperCase()}\nReason: ${reason}\n\nPlease review it in your seller dashboard.`
    );

    res.status(201).json({ message: 'Return request submitted', return: ret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /returns/:id/accept ─────────────────────────────────────────────────
// Seller accepts the return. Status → return_accepted, then auto-assign to available pool.
exports.acceptReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, refund_or_replacement } = req.body;

    // Verify this seller owns the return
    const sellerRes = await pool.query(`SELECT id FROM sellers WHERE user_id = $1`, [req.user.id]);
    const sellerId = sellerRes.rows[0]?.id;
    if (!sellerId) return res.status(403).json({ error: 'Seller profile not found' });

    const ret = await pool.query(
      `UPDATE returns SET
         status = 'return_accepted',
         accepted_at = NOW(),
         notes = COALESCE($1, notes),
         refund_or_replacement = COALESCE($2::refund_or_replacement, refund_or_replacement)
       WHERE id = $3::uuid AND seller_id = $4 AND status = 'return_requested'
       RETURNING *`,
      [notes || null, refund_or_replacement || null, id, sellerId]
    );

    if (ret.rows.length === 0) {
      return res.status(400).json({ error: 'Return not found or already actioned' });
    }

    // Notify buyer
    await notifyFcm(
      ret.rows[0].buyer_id,
      '✅ Return Accepted',
      `Your return request has been accepted. A delivery partner will pick up the item soon.`
    );
    await notifyWhatsApp(
      ret.rows[0].buyer_id,
      `✅ Return Accepted!\n\nYour return for order #${ret.rows[0].order_id.slice(-6).toUpperCase()} has been accepted.\nA delivery partner will come to pick up the item.`
    );

    res.json({ message: 'Return accepted. Visible in delivery partner pickup pool.', return: ret.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /returns/:id/reject ─────────────────────────────────────────────────
exports.rejectReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const sellerRes = await pool.query(`SELECT id FROM sellers WHERE user_id = $1`, [req.user.id]);
    const sellerId = sellerRes.rows[0]?.id;
    if (!sellerId) return res.status(403).json({ error: 'Seller profile not found' });

    const ret = await pool.query(
      `UPDATE returns SET
         status = 'return_rejected',
         notes = COALESCE($1, notes)
       WHERE id = $2::uuid AND seller_id = $3 AND status = 'return_requested'
       RETURNING *`,
      [notes || null, id, sellerId]
    );

    if (ret.rows.length === 0) {
      return res.status(400).json({ error: 'Return not found or already actioned' });
    }

    // Notify buyer
    await notifyFcm(
      ret.rows[0].buyer_id,
      '❌ Return Rejected',
      `Unfortunately your return request was rejected. Reason: ${notes || 'No reason provided'}`
    );
    await notifyWhatsApp(
      ret.rows[0].buyer_id,
      `❌ Return Rejected\n\nOrder #${ret.rows[0].order_id.slice(-6).toUpperCase()}\nReason: ${notes || 'No reason provided by seller'}`
    );

    res.json({ message: 'Return rejected', return: ret.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── GET /returns/available-pickups ────────────────────────────────────────────
// Delivery partner fetches returns awaiting pickup (status = return_pickup_assigned,
// no delivery_partner_id assigned yet). Mirrors getAvailableOrders logic.
exports.getAvailableReturnPickups = async (req, res) => {
  try {
    // Check if delivery partner is online
    const selfCheck = await pool.query(
      `SELECT is_online FROM delivery_boys WHERE user_id = $1`, [req.user.id]
    );
    if (selfCheck.rows[0]?.is_online === false) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT r.*,
              u_buyer.name    AS buyer_name,
              u_buyer.phone   AS buyer_phone,
              o.delivery_address, o.delivery_phone, o.delivery_landmark,
              o.delivery_lat,  o.delivery_lng,
              s.shop_name,
              s.address       AS seller_address,
              s.contact_phone AS seller_phone,
              s.locality      AS seller_locality,
              s.latitude      AS seller_lat,
              s.longitude     AS seller_lng
       FROM returns r
       JOIN orders  o      ON r.order_id  = o.id
       JOIN users   u_buyer ON r.buyer_id = u_buyer.id
       JOIN sellers s      ON r.seller_id = s.id
       WHERE r.status = 'return_accepted'
         AND r.delivery_partner_id IS NULL
       ORDER BY r.accepted_at DESC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /returns/:id/accept-pickup ─────────────────────────────────────────
// Delivery partner self-assigns a return pickup. Mirrors acceptDelivery.
// Once accepted → removes from all other partners' available list automatically
// (same mechanism as regular orders: delivery_partner_id IS NULL filter).
exports.acceptReturnPickup = async (req, res) => {
  try {
    const { id } = req.params;

    const selfCheck = await pool.query(
      `SELECT is_online FROM delivery_boys WHERE user_id = $1`, [req.user.id]
    );
    if (selfCheck.rows[0]?.is_online === false) {
      return res.status(400).json({ error: 'You are Offline. Go Online to accept pickups.' });
    }

    const ret = await pool.query(
      `UPDATE returns SET
         delivery_partner_id = $1,
         status = 'return_pickup_assigned'
       WHERE id = $2::uuid
         AND status = 'return_accepted'
         AND delivery_partner_id IS NULL
       RETURNING *`,
      [req.user.id, id]
    );

    if (ret.rows.length === 0) {
      return res.status(400).json({ error: 'Return pickup already taken or not available' });
    }

    // Notify buyer
    await notifyFcm(
      ret.rows[0].buyer_id,
      '🛵 Pickup Assigned',
      `A delivery partner has been assigned to pick up your return item.`
    );

    res.json({ message: 'Return pickup accepted!', return: ret.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── GET /returns/my-return-pickups ────────────────────────────────────────────
// Delivery partner fetches their active return pickups.
exports.getMyReturnPickups = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*,
              u_buyer.name    AS buyer_name,
              o.delivery_address, o.delivery_phone, o.delivery_landmark,
              o.delivery_lat, o.delivery_lng,
              s.shop_name,
              s.address       AS seller_address,
              s.contact_phone AS seller_phone,
              s.locality      AS seller_locality,
              s.latitude      AS seller_lat,
              s.longitude     AS seller_lng
       FROM returns r
       JOIN orders  o       ON r.order_id  = o.id
       JOIN users   u_buyer ON r.buyer_id  = u_buyer.id
       JOIN sellers s       ON r.seller_id = s.id
       WHERE r.delivery_partner_id = $1
         AND r.status NOT IN ('return_completed', 'return_rejected')
       ORDER BY r.accepted_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /returns/:id/picked-up ─────────────────────────────────────────────
// Delivery partner marks item collected from buyer.
exports.markPickedUp = async (req, res) => {
  try {
    const { id } = req.params;
    const ret = await pool.query(
      `UPDATE returns SET status = 'return_picked_up', picked_up_at = NOW()
       WHERE id = $1::uuid AND delivery_partner_id = $2
         AND status = 'return_pickup_assigned'
       RETURNING *`,
      [id, req.user.id]
    );
    if (ret.rows.length === 0) return res.status(400).json({ error: 'Not found or wrong status' });

    // Notify buyer + seller
    const r = ret.rows[0];
    await notifyFcm(r.buyer_id,   '📦 Item Picked Up', 'Delivery partner has collected your return item.');
    await notifyFcm(r.seller_id,  '📦 Return Picked Up', `Return for order #${r.order_id.slice(-6).toUpperCase()} has been picked up.`);

    res.json({ message: 'Marked as picked up', return: r });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /returns/:id/in-transit ────────────────────────────────────────────
exports.markInTransit = async (req, res) => {
  try {
    const { id } = req.params;
    const ret = await pool.query(
      `UPDATE returns SET status = 'return_in_transit', in_transit_at = NOW()
       WHERE id = $1::uuid AND delivery_partner_id = $2
         AND status = 'return_picked_up'
       RETURNING *`,
      [id, req.user.id]
    );
    if (ret.rows.length === 0) return res.status(400).json({ error: 'Not found or wrong status' });

    const r = ret.rows[0];

    // Notify buyer and seller
    await notifyFcm(
      r.buyer_id,
      '🚀 Return In Transit',
      `Your return item is on its way back to the seller.`
    );
    const sellerUserRes = await pool.query(
      `SELECT user_id FROM sellers WHERE id = $1`, [r.seller_id]
    );
    const sellerUserId = sellerUserRes.rows[0]?.user_id;
    if (sellerUserId) {
      await notifyFcm(
        sellerUserId,
        '🚀 Return In Transit',
        `Return for order #${r.order_id.slice(-6).toUpperCase()} is on its way to you.`
      );
    }

    res.json({ message: 'Marked as in transit', return: r });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /returns/:id/complete ───────────────────────────────────────────────
// Delivery partner taps "Return Complete" after handing item to seller.
exports.markReturnDeliveredToSeller = async (req, res) => {
  try {
    const { id } = req.params;
    const ret = await pool.query(
      `UPDATE returns SET status = 'return_delivered_to_seller', delivered_to_seller_at = NOW()
       WHERE id = $1::uuid AND delivery_partner_id = $2
         AND status IN ('return_in_transit', 'return_picked_up')
       RETURNING *`,
      [id, req.user.id]
    );
    if (ret.rows.length === 0) return res.status(400).json({ error: 'Not found or wrong status' });

    const r = ret.rows[0];

    // Notify seller to confirm receipt
    const sellerUserRes = await pool.query(
      `SELECT user_id FROM sellers WHERE id = $1`, [r.seller_id]
    );
    const sellerUserId = sellerUserRes.rows[0]?.user_id;
    if (sellerUserId) {
      await notifyFcm(
        sellerUserId,
        '↩ Return Arrived',
        `Return for order #${r.order_id.slice(-6).toUpperCase()} has been delivered to you. Please confirm receipt.`
      );
      await notifyWhatsApp(
        sellerUserId,
        `↩ Return Arrived!\n\nOrder #${r.order_id.slice(-6).toUpperCase()}\nThe item has been handed to you by the delivery partner.\nPlease confirm receipt in your seller dashboard to process the refund/replacement.`
      );
    }

    res.json({ message: 'Return delivered to seller', return: r });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── PATCH /returns/:id/confirm ────────────────────────────────────────────────
// Seller confirms receipt → closes return → disables future returns for this order.
exports.confirmReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const { refund_or_replacement } = req.body;

    const sellerRes = await pool.query(`SELECT id FROM sellers WHERE user_id = $1`, [req.user.id]);
    const sellerId = sellerRes.rows[0]?.id;
    if (!sellerId) return res.status(403).json({ error: 'Seller profile not found' });

    const ret = await pool.query(
      `UPDATE returns SET
         status = 'return_completed',
         completed_at = NOW(),
         refund_or_replacement = COALESCE($1::refund_or_replacement, refund_or_replacement)
       WHERE id = $2::uuid AND seller_id = $3
         AND status = 'return_delivered_to_seller'
       RETURNING *`,
      [refund_or_replacement || null, id, sellerId]
    );

    if (ret.rows.length === 0) {
      return res.status(400).json({ error: 'Return not found or not ready to confirm' });
    }

    const r = ret.rows[0];

    // Notify buyer
    await notifyFcm(
      r.buyer_id,
      '🎉 Return Completed',
      `Your return has been completed! ${r.refund_or_replacement === 'refund' ? 'Refund will be processed.' : 'Replacement will be sent.'}`
    );
    await notifyWhatsApp(
      r.buyer_id,
      `✅ Return Completed!\n\nOrder #${r.order_id.slice(-6).toUpperCase()}\n${r.refund_or_replacement === 'refund' ? 'Your refund is being processed.' : 'A replacement will be sent to you.'}`
    );

    res.json({ message: 'Return completed successfully', return: r });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// ── GET /returns/:id ──────────────────────────────────────────────────────────
exports.getReturn = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT r.*,
              u_buyer.name  AS buyer_name,
              s.shop_name,
              o.delivery_address
       FROM returns r
       JOIN orders  o       ON r.order_id = o.id
       JOIN users   u_buyer ON r.buyer_id = u_buyer.id
       JOIN sellers s       ON r.seller_id = s.id
       WHERE r.id = $1::uuid`,
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Return not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── GET /returns ──────────────────────────────────────────────────────────────
// Query by buyer_id, seller_id, or delivery_partner_id
exports.listReturns = async (req, res) => {
  try {
    const { buyer_id, seller_id, delivery_partner_id } = req.query;

    let whereClause = '';
    const params = [];

    if (buyer_id) {
      params.push(buyer_id);
      whereClause = `WHERE r.buyer_id = $${params.length}`;
    } else if (seller_id) {
      params.push(seller_id);
      whereClause = `WHERE r.seller_id = $${params.length}`;
    } else if (delivery_partner_id) {
      params.push(delivery_partner_id);
      whereClause = `WHERE r.delivery_partner_id = $${params.length}`;
    } else {
      // Default: return caller's own returns based on role
      params.push(req.user.id);
      whereClause = `WHERE r.buyer_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT r.*,
              u_buyer.name  AS buyer_name,
              s.shop_name,
              o.delivery_address,
              o.delivery_phone
       FROM returns r
       JOIN orders  o       ON r.order_id = o.id
       JOIN users   u_buyer ON r.buyer_id = u_buyer.id
       JOIN sellers s       ON r.seller_id = s.id
       ${whereClause}
       ORDER BY r.requested_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
