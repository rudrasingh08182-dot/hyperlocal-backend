const { calculateDeliveryCharge, calculateDistance } = require('../../utils/deliveryCharge');
 
const pool = require('../../config/db');
exports.placeOrder = async (req, res) => {
  try {
    const {
      seller_id, items, payment_method,
      delivery_address, delivery_phone, delivery_landmark,
      buyer_lat, buyer_lng  // buyer's coordinates from frontend
    } = req.body;
 
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No items in order' });
    }
 
    // Calculate items total
    let total = 0;
    for (const item of items) {
      const product = await pool.query('SELECT price, stock FROM products WHERE id=$1::uuid', [item.product_id]);
      if (!product.rows[0]) return res.status(404).json({ error: 'Product not found' });
      if (product.rows[0].stock < item.quantity) return res.status(400).json({ error: 'Insufficient stock' });
      total += product.rows[0].price * item.quantity;
    }
 
    // Get seller's coordinates for distance calculation
    const sellerResult = await pool.query(
      'SELECT latitude, longitude FROM sellers WHERE id = $1::uuid',
      [seller_id]
    );
    const seller = sellerResult.rows[0];
 
    // Calculate delivery charge
    let distanceKm    = null;
    let deliveryCharge = 20; // default ₹20 if no coordinates
 
    if (buyer_lat && buyer_lng && seller?.latitude && seller?.longitude) {
      distanceKm     = calculateDistance(
        parseFloat(buyer_lat), parseFloat(buyer_lng),
        parseFloat(seller.latitude), parseFloat(seller.longitude)
      );
      deliveryCharge = calculateDeliveryCharge(distanceKm);
    }
 
    const grandTotal = parseFloat(total) + deliveryCharge;
 
    // Create order
    const order = await pool.query(
      `INSERT INTO orders 
        (buyer_id, seller_id, status, payment_method, total_amount, 
         delivery_charge, distance_km, grand_total,
         delivery_address, delivery_phone, delivery_landmark)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.user.id, seller_id, payment_method, total,
       deliveryCharge, distanceKm, grandTotal,
       delivery_address, delivery_phone, delivery_landmark]
    );
    
     const { sendNotification } = require('../config/firebase');

// Get seller's FCM token
const { rows: sellerRows } = await pool.query(
  `SELECT fcm_token FROM sellers WHERE id = $1`,
  [seller_id]
);
if (sellerRows[0]?.fcm_token) {
  await sendNotification(
    sellerRows[0].fcm_token,
    '🛒 New Order!',
    `You have a new order of ₹${total_amount}`
  );
}

    // Create order items & reduce stock
    for (const item of items) {
      const product = await pool.query('SELECT price FROM products WHERE id=$1::uuid', [item.product_id]);
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES ($1, $2::uuid, $3, $4)`,
        [order.rows[0].id, item.product_id, item.quantity, product.rows[0].price]
      );
      await pool.query(
        `UPDATE products SET stock = stock - $1 WHERE id=$2::uuid`,
        [item.quantity, item.product_id]
      );
    }
 
    res.status(201).json({
      message: 'Order placed successfully!',
      order: order.rows[0],
      delivery_charge: deliveryCharge,
      distance_km: distanceKm,
      grand_total: grandTotal,
    });
 
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
 
exports.getMyOrders = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, s.shop_name,
              json_agg(json_build_object(
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'unit_price', oi.unit_price,
                'name', p.name
              )) as items
       FROM orders o
       JOIN sellers s ON o.seller_id = s.id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON oi.product_id = p.id
       WHERE o.buyer_id = $1
       GROUP BY o.id, s.shop_name
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Calculate distance between two coordinates (km)
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

// Get available orders near delivery boy
// Replace your existing getAvailableOrders in order.controller.js

exports.getAvailableOrders = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    const result = await pool.query(
      `SELECT o.id, o.total_amount, o.payment_method, o.delivery_address,
              o.delivery_phone, o.delivery_landmark, o.created_at,
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

    // If GPS coordinates provided, calculate REAL distance using Haversine
    if (lat && lng) {
      orders = orders
        .map(order => {
          let distance_km = null;

          if (order.seller_lat && order.seller_lng) {
            // Real distance using Haversine formula
            distance_km = getDistance(
              parseFloat(lat), parseFloat(lng),
              parseFloat(order.seller_lat), parseFloat(order.seller_lng)
            ).toFixed(1);
          }

          return { ...order, distance_km };
        })
        .sort((a, b) => {
          // Sort by distance (nulls go to end)
          if (a.distance_km === null) return 1;
          if (b.distance_km === null) return -1;
          return a.distance_km - b.distance_km;
        });
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// Accept a delivery
exports.acceptDelivery = async (req, res) => {
  try {
    const { id } = req.params;

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
    res.status(500).json({ error: err.message });
  }
};
// Get my active deliveries
exports.getMyDeliveries = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.total_amount, o.payment_method, o.status,
              o.delivery_address, o.delivery_phone, o.delivery_landmark,
              o.created_at,
              s.shop_name, s.address as seller_address,
              s.contact_phone as seller_phone, s.locality as seller_locality,
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
    res.status(500).json({ error: err.message });
  }
};

// Mark as delivered
exports.markDelivered = async (req, res) => {
  try {
    const { id } = req.params;

    // First check if order exists
    const check = await pool.query(
      'SELECT * FROM orders WHERE id = $1::uuid', [id]
    );

    if (!check.rows[0]) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Update - allow if delivery_boy_id matches OR if status is picked_up
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

    res.json({ message: 'Order marked as delivered!', order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// Update delivery boy location
exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    await pool.query(
      `UPDATE users SET latitude = $1, longitude = $2 WHERE id = $3`,
      [latitude, longitude, req.user.id]
    );

    res.json({ message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};