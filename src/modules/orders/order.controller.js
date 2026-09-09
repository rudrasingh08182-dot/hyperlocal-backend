const { calculateDeliveryCharge, calculateDistance } = require('../../utils/deliveryCharge');
const { getDrivingDistanceKm } = require('../../utils/osrmDistance');

const pool = require('../../config/db');

exports.placeOrder = async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user?.serviceable === false) {
      return res.status(403).json({ error: 'Zaplo is currently not available in your area. Order placement is disabled.' });
    }

    const {
      seller_id, items, payment_method,
      delivery_address, delivery_phone, delivery_landmark,
      buyer_lat, buyer_lng, ordering_for_self
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No items in order' });
    }

    // ── Resolve which lat/lng to use for distance calculation ──
    // "For self" → trust the buyer's own DB-saved live location (server-side
    // truth, harder to spoof). "For someone else" → trust the lat/lng sent
    // from the address search flow, since it's a one-off delivery location.
    let effectiveBuyerLat = buyer_lat;
    let effectiveBuyerLng = buyer_lng;

    if (ordering_for_self !== false) {
      const selfLoc = await pool.query(
        'SELECT delivery_latitude, delivery_longitude FROM users WHERE id = $1',
        [req.user.id]
      );
      if (selfLoc.rows[0]?.delivery_latitude && selfLoc.rows[0]?.delivery_longitude) {
        effectiveBuyerLat = selfLoc.rows[0].delivery_latitude;
        effectiveBuyerLng = selfLoc.rows[0].delivery_longitude;
      }
    }

    // ── Store availability check ──
    const sellerOnlineCheck = await pool.query('SELECT is_online FROM sellers WHERE id = $1::uuid', [seller_id]);
    if (!sellerOnlineCheck.rows[0]) return res.status(404).json({ error: 'Seller not found' });
    if (sellerOnlineCheck.rows[0].is_online === false) {
      return res.status(400).json({ error: 'This store is temporarily unavailable. Please try again later.' });
    }

    await client.query('BEGIN');

    // ── Calculate items total (variant-aware) — row-locked to prevent
    // two simultaneous orders from both reading stale stock ──
    let total = 0;
    const itemDetails = [];

    for (const item of items) {
      const product = await client.query(
        'SELECT id, price, stock, has_variants FROM products WHERE id=$1::uuid FOR UPDATE',
        [item.product_id]
      );
      if (!product.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Product not found' });
      }

            if (item.color_size_id) {
        const cs = await client.query(
          `SELECT pcs.id, pcs.size, pcs.stock, pcs.price, pc.color_name
           FROM product_color_sizes pcs
           JOIN product_colors pc ON pcs.color_id = pc.id
           WHERE pcs.id = $1::uuid AND pc.product_id = $2::uuid FOR UPDATE`,
          [item.color_size_id, item.product_id]
        );
        if (!cs.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Selected color/size not found' });
        }
        const price = cs.rows[0].price != null ? cs.rows[0].price : product.rows[0].price;
        if (cs.rows[0].stock < item.quantity) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `${cs.rows[0].color_name} / ${cs.rows[0].size} is out of stock` });
        }
        total += parseFloat(price) * item.quantity;
        itemDetails.push({ ...item, unit_price: price, colorSize: cs.rows[0] });
      } else if (item.variant_id) {
        const variant = await client.query(
          `SELECT id, variant_type, variant_value, price, stock
           FROM product_variants
           WHERE id = $1::uuid AND product_id = $2::uuid AND status = 'active' FOR UPDATE`,
          [item.variant_id, item.product_id]
        );
        if (!variant.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Product variant not found' });
        }
        if (variant.rows[0].stock < item.quantity) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Insufficient stock for ${variant.rows[0].variant_value}` });
        }
        total += parseFloat(variant.rows[0].price) * item.quantity;
        itemDetails.push({ ...item, unit_price: variant.rows[0].price, variant: variant.rows[0] });
      } else {
        if (product.rows[0].stock < item.quantity) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Insufficient stock' });
        }
        total += parseFloat(product.rows[0].price) * item.quantity;
        itemDetails.push({ ...item, unit_price: product.rows[0].price, variant: null });
      }
    }

    // Get seller's coordinates for distance calculation
    const sellerResult = await client.query(
      'SELECT latitude, longitude FROM sellers WHERE id = $1::uuid',
      [seller_id]
    );
    const seller = sellerResult.rows[0];

    // Calculate delivery charge
    let distanceKm = null;
    let deliveryCharge = 20;

    if (effectiveBuyerLat && effectiveBuyerLng && seller?.latitude && seller?.longitude) {
      distanceKm = await getDrivingDistanceKm(
        parseFloat(seller.latitude), parseFloat(seller.longitude),
        parseFloat(effectiveBuyerLat), parseFloat(effectiveBuyerLng)
      );
      if (distanceKm === null) {
        distanceKm = calculateDistance(
          parseFloat(effectiveBuyerLat), parseFloat(effectiveBuyerLng),
          parseFloat(seller.latitude), parseFloat(seller.longitude)
        );
      }

      const { isServiceableDistance } = require('../../utils/deliveryCharge');
      if (!isServiceableDistance(distanceKm)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Sorry, hum abhi wahan available nahi hain, lekin jaldi hi aa rahe hain! 🚀',
        });
      }

      deliveryCharge = calculateDeliveryCharge(distanceKm);
    }
    const grandTotal = parseFloat(total) + deliveryCharge;

    const initialStatus = payment_method === 'ONLINE_QR' ? 'pending_payment' : 'pending';

    // Create order
    const order = await client.query(
      `INSERT INTO orders 
        (buyer_id, seller_id, status, payment_method, total_amount, 
         delivery_charge, distance_km, grand_total,
         delivery_address, delivery_phone, delivery_landmark,
         delivery_lat, delivery_lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [req.user.id, seller_id, initialStatus, payment_method, total,
       deliveryCharge, distanceKm, grandTotal,
       delivery_address, delivery_phone, delivery_landmark,
       effectiveBuyerLat || null, effectiveBuyerLng || null]
    );

    // ── Create order items & reduce stock ATOMICALLY ──
    // The WHERE stock >= $qty clause makes this a single atomic check-and-decrement,
    // so two simultaneous orders can never both succeed against a stock of 1.
    for (const item of itemDetails) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, variant_id, variant_type, variant_value, color_size_id, color_name, size)
         VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6, $7, $8::uuid, $9, $10)`,
        [
          order.rows[0].id,
          item.product_id,
          item.quantity,
          item.unit_price,
          item.variant_id || null,
          item.variant?.variant_type || null,
          item.variant?.variant_value || null,
          item.color_size_id || null,
          item.colorSize?.color_name || null,
          item.colorSize?.size || null,
        ]
      );

      if (item.color_size_id) {
        const stockUpdate = await client.query(
          `UPDATE product_color_sizes SET stock = stock - $1, updated_at = NOW() WHERE id = $2::uuid AND stock >= $1 RETURNING id`,
          [item.quantity, item.color_size_id]
        );
        if (stockUpdate.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `${item.colorSize.color_name} / ${item.colorSize.size} just sold out — someone else bought it` });
        }
      } else if (item.variant_id) {
        const stockUpdate = await client.query(
          `UPDATE product_variants SET stock = stock - $1 WHERE id = $2::uuid AND stock >= $1 RETURNING id`,
          [item.quantity, item.variant_id]
        );
        if (stockUpdate.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Insufficient stock for ${item.variant.variant_value} — someone just bought it` });
        }
      } else {
        const stockUpdate = await client.query(
          `UPDATE products SET stock = stock - $1 WHERE id=$2::uuid AND stock >= $1 RETURNING id`,
          [item.quantity, item.product_id]
        );
        if (stockUpdate.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Insufficient stock — someone just bought this item' });
        }
      }
    }

    await client.query('COMMIT');

    // ── Notifications — sent AFTER commit so a notification failure never
    // rolls back an already-successful order ──
    try {
      const { sendWhatsApp } = require('../../config/whatsapp');
      const sellerInfo = await pool.query(
        `SELECT u.phone, s.shop_name FROM sellers s 
         JOIN users u ON s.user_id = u.id 
         WHERE s.id = $1::uuid`,
        [seller_id]
      );
      if (sellerInfo.rows[0]?.phone) {
        const actionLine = initialStatus === 'pending_payment'
          ? 'Buyer is paying via UPI QR — check your Orders tab once payment proof is submitted.'
          : 'Login to your dashboard to accept the order.';
        await sendWhatsApp(
          sellerInfo.rows[0].phone,
          `🛒 New Order on Zaplo!\n\nShop: ${sellerInfo.rows[0].shop_name}\nOrder Amount: ₹${total}\nOrder ID: #${order.rows[0].id.slice(-6).toUpperCase()}\nPayment: ${payment_method}\n\n${actionLine}`
        );
      }
    } catch (waErr) {
      console.error('WhatsApp notification error:', waErr.message);
    }

    // ── Seller ko "Naya Order Aaya" notification ─────────────
    try {
      const { notifyUser } = require('../notifications/notification.service');

      const sellerFcmResult = await pool.query(
        `SELECT s.fcm_token, s.user_id, u_buyer.name as buyer_name
         FROM sellers s
         JOIN users u_buyer ON u_buyer.id = $2
         WHERE s.id = $1::uuid`,
        [seller_id, req.user.id]
      );

      if (sellerFcmResult.rows[0]) {
        const buyerName   = sellerFcmResult.rows[0].buyer_name || 'Ek customer';
        const orderId     = order.rows[0].id.slice(-6).toUpperCase();
        const payLabel    = payment_method === 'COD'        ? 'Cash on Delivery'
                          : payment_method === 'ONLINE_QR'  ? 'UPI / QR Payment'
                          : 'Online Payment';

        await notifyUser(
          sellerFcmResult.rows[0].user_id,
          sellerFcmResult.rows[0].fcm_token,
          '🛒 Naya Order Aaya! | New Order Received!',
          `Order #${orderId} — ₹${total} | ${buyerName} ne order kiya hai. Payment: ${payLabel}. App mein jaakar jaldi confirm karein! ✅`,
          'new_order',
          {
            orderId:       order.rows[0].id,
            amount:        String(total),
            buyerName:     buyerName,
            paymentMethod: payment_method,
          }
        );
      }
    } catch (fcmSellerErr) {
      console.error('Seller new-order notification error:', fcmSellerErr.message);
    }

        // ── Buyer ko "Order Placed" notification ──────────────────
    try {
      const { notifyUser } = require('../notifications/notification.service');

      const buyerFcm = await pool.query(
        `SELECT fcm_token FROM users WHERE id = $1`,
        [req.user.id]
      );
      await notifyUser(
        req.user.id,
        buyerFcm.rows[0]?.fcm_token,
        '🎉 Order Place Ho Gaya!',
        `Aapka order #${order.rows[0].id.slice(-6).toUpperCase()} place ho gaya hai. Seller confirm karega toh aapko batayenge!`,
        'order_placed',
        { orderId: order.rows[0].id }
      );
    } catch (fcmBuyerErr) {
      console.error('Buyer notification error:', fcmBuyerErr.message);
    }

    res.status(201).json({
      message: 'Order placed successfully!',
      order: order.rows[0],
      delivery_charge: deliveryCharge,
      distance_km: distanceKm,
      grand_total: grandTotal,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Place order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, s.shop_name, s.address as shop_address, s.contact_phone as shop_phone,
              json_agg(json_build_object(
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'unit_price', oi.unit_price,
                'name', p.name,
                'variant_type', oi.variant_type,
                'variant_value', oi.variant_value
              )) as items
       FROM orders o
       JOIN sellers s ON o.seller_id = s.id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE o.buyer_id = $1
       GROUP BY o.id, s.shop_name, s.address, s.contact_phone
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get my orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

exports.getAvailableOrders = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    const selfCheck = await pool.query('SELECT is_online FROM delivery_boys WHERE user_id = $1', [req.user.id]);
    if (selfCheck.rows[0] && selfCheck.rows[0].is_online === false) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT o.id, o.total_amount, o.payment_method, o.delivery_address,
              o.delivery_phone, o.delivery_landmark, o.created_at,
              o.distance_km as seller_buyer_distance_km,
              s.shop_name, s.address as seller_address, s.contact_phone as seller_phone,
              s.locality as seller_locality, s.latitude as seller_lat, s.longitude as seller_lng,
              u.name as buyer_name
       FROM orders o
       JOIN sellers s ON o.seller_id = s.id
       JOIN users u ON o.buyer_id = u.id
       WHERE o.status = 'confirmed' AND o.delivery_boy_id IS NULL
       ORDER BY o.created_at DESC`
    );

    let orders = result.rows;

    if (lat && lng) {
      orders = orders
        .map(order => {
          let distance_km = null;
          if (order.seller_lat && order.seller_lng) {
            distance_km = getDistance(
              parseFloat(lat), parseFloat(lng),
              parseFloat(order.seller_lat), parseFloat(order.seller_lng)
            ).toFixed(1);
          }
          return { ...order, distance_km };
        })
        .sort((a, b) => {
          if (a.distance_km === null) return 1;
          if (b.distance_km === null) return -1;
          return a.distance_km - b.distance_km;
        });
    }

    res.json(orders);
  } catch (err) {
    console.error('Get available orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.acceptDelivery = async (req, res) => {
  try {
    const { id } = req.params;

    const selfCheck = await pool.query('SELECT is_online FROM delivery_boys WHERE user_id = $1', [req.user.id]);
    if (selfCheck.rows[0] && selfCheck.rows[0].is_online === false) {
      return res.status(400).json({ error: 'You are currently Offline. Go Online to accept new deliveries.' });
    }

    const result = await pool.query(
      `UPDATE orders SET 
        delivery_boy_id = $1,
        status = 'picked_up'
       WHERE id = $2::uuid 
       AND (status = 'confirmed' OR status = 'pending')
       AND (delivery_boy_id IS NULL OR delivery_boy_id = $1)
       RETURNING *`,
      [req.user.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Order already taken or not available' });
    }

    res.json({ message: 'Delivery accepted!', order: result.rows[0] });
  } catch (err) {
    console.error('Accept delivery error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getMyDeliveries = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.total_amount, o.payment_method, o.status,
              o.delivery_address, o.delivery_phone, o.delivery_landmark,
              o.delivery_lat, o.delivery_lng,
              o.created_at,
              o.distance_km as seller_buyer_distance_km,
              o.delivery_payment_confirmed, o.delivery_payment_method, o.delivery_payment_proof_url,
              s.shop_name, s.address as seller_address,
              s.contact_phone as seller_phone, s.locality as seller_locality,
              s.latitude as seller_lat, s.longitude as seller_lng,
              u.name as buyer_name
       FROM orders o
       JOIN sellers s ON o.seller_id = s.id
       JOIN users u ON o.buyer_id = u.id
       WHERE o.delivery_boy_id = $1
       AND o.status NOT IN ('delivered', 'cancelled')
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Get my deliveries error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.markDelivered = async (req, res) => {
  try {
    const { id } = req.params;

    const check = await pool.query(
      'SELECT * FROM orders WHERE id = $1::uuid', [id]
    );

    if (!check.rows[0]) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const result = await pool.query(
      `UPDATE orders SET status = 'delivered', delivered_at = NOW()
       WHERE id = $1::uuid
       AND (delivery_boy_id = $2 OR status = 'picked_up')
       RETURNING *`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const deliveredOrder = result.rows[0];

    // ── Buyer + Seller ko "Order Delivered" notification ─────────────
    try {
      const { notifyUser } = require('../notifications/notification.service');

      const buyerFcm = await pool.query(
        `SELECT fcm_token FROM users WHERE id = $1`, [deliveredOrder.buyer_id]
      );
      await notifyUser(
        deliveredOrder.buyer_id,
        buyerFcm.rows[0]?.fcm_token,
        '✅ Order Deliver Ho Gaya!',
        `Aapka order #${deliveredOrder.id.slice(-6).toUpperCase()} successfully deliver ho gaya. Apna experience share karein!`,
        'order_delivered',
        { orderId: deliveredOrder.id }
      );

      const sellerFcm = await pool.query(
        `SELECT fcm_token, user_id FROM sellers WHERE id = $1::uuid`, [deliveredOrder.seller_id]
      );
      if (sellerFcm.rows[0]) {
        await notifyUser(
          sellerFcm.rows[0].user_id,
          sellerFcm.rows[0].fcm_token,
          '🚀 Order Deliver Ho Gaya!',
          `Order #${deliveredOrder.id.slice(-6).toUpperCase()} buyer tak pahunch gaya. ₹${deliveredOrder.total_amount} aapke account mein credit ho gaya.`,
          'order_delivered_seller',
          { orderId: deliveredOrder.id }
        );
      }
    } catch (fcmErr) {
      console.error('Delivered notification error:', fcmErr.message);
    }

    res.json({ message: 'Order marked as delivered!', order: deliveredOrder });
  } catch (err) {
    console.error('Mark delivered error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    await pool.query(
      `UPDATE users SET latitude = $1, longitude = $2 WHERE id = $3`,
      [latitude, longitude, req.user.id]
    );

    res.json({ message: 'Location updated' });
  } catch (err) {
    console.error('Update location error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.toggleDeliveryAvailability = async (req, res) => {
  try {
    const { is_online } = req.body;
    if (typeof is_online !== 'boolean') {
      return res.status(400).json({ error: 'is_online must be true or false' });
    }

    const result = await pool.query(
      `UPDATE delivery_boys SET is_online = $1 WHERE user_id = $2 RETURNING is_online`,
      [is_online, req.user.id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Delivery profile not found' });
    res.json({ message: is_online ? 'You are now Online' : 'You are now Offline', is_online: result.rows[0].is_online });
  } catch (err) {
    console.error('Toggle availability error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getMyAvailability = async (req, res) => {
  try {
    const result = await pool.query('SELECT is_online FROM delivery_boys WHERE user_id = $1', [req.user.id]);
    res.json({ is_online: result.rows[0]?.is_online ?? true });
  } catch (err) {
    console.error('Get availability error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// GET /api/orders/delivery-estimate?seller_id=...&buyer_lat=...&buyer_lng=...
// Buyer cart screen calls this to show the REAL by-road delivery charge
// before placing the order — instead of a hardcoded flat ₹20.
exports.getDeliveryEstimate = async (req, res) => {
  try {
    const { seller_id, buyer_lat, buyer_lng } = req.query;
    if (!seller_id || !buyer_lat || !buyer_lng) {
      return res.status(400).json({ error: 'seller_id, buyer_lat, buyer_lng are required' });
    }

    const sellerResult = await pool.query(
      'SELECT latitude, longitude FROM sellers WHERE id = $1::uuid',
      [seller_id]
    );
    const seller = sellerResult.rows[0];

    if (!seller || !seller.latitude || !seller.longitude) {
      return res.json({ distance_km: null, delivery_charge: 20 });
    }

    let distanceKm = await getDrivingDistanceKm(
      parseFloat(seller.latitude), parseFloat(seller.longitude),
      parseFloat(buyer_lat), parseFloat(buyer_lng)
    );
    if (distanceKm === null) {
      distanceKm = calculateDistance(
        parseFloat(buyer_lat), parseFloat(buyer_lng),
        parseFloat(seller.latitude), parseFloat(seller.longitude)
      );
    }

    const { isServiceableDistance } = require('../../utils/deliveryCharge');
    if (!isServiceableDistance(distanceKm)) {
      return res.json({
        distance_km: distanceKm,
        delivery_charge: null,
        serviceable: false,
        message: 'Sorry, hum abhi wahan available nahi hain, lekin jaldi hi aa rahe hain! 🚀',
      });
    }

    const charge = calculateDeliveryCharge(distanceKm);
    res.json({ distance_km: distanceKm, delivery_charge: charge, serviceable: true });
  } catch (err) {
    console.error('Delivery estimate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};