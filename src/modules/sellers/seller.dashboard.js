const pool = require('../../config/db');

// GET /api/sellers/dashboard
exports.getDashboardStats = async (req, res) => {
  try {
    const sellerResult = await pool.query(
      'SELECT id FROM sellers WHERE user_id = $1', [req.user.id]
    );
    if (!sellerResult.rows[0]) return res.status(404).json({ error: 'Seller not found' });
    const sellerId = sellerResult.rows[0].id;

    // Run all queries in parallel
    const [salesStats, ledgerStats, recentOrders, topProducts, ordersByDay] = await Promise.all([

      // Total sales stats
      pool.query(`
  SELECT
    COUNT(*) as total_orders,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
    COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders,
    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
    COALESCE(SUM(CASE WHEN status NOT IN ('pending', 'cancelled') THEN total_amount ELSE 0 END), 0) as gross_sales,
    COALESCE(SUM(CASE WHEN status NOT IN ('pending', 'cancelled') AND DATE(created_at) = CURRENT_DATE THEN total_amount ELSE 0 END), 0) as today_sales,
    COALESCE(SUM(CASE WHEN status NOT IN ('pending', 'cancelled') AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW()) THEN total_amount ELSE 0 END), 0) as monthly_sales
  FROM orders WHERE seller_id = $1
`, [sellerId]),
      // Ledger balance
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount_paise ELSE 0 END), 0) as total_credits_paise,
          COALESCE(SUM(CASE WHEN type IN ('COD_DEBT', 'REFUND', 'COMMISSION') THEN amount_paise ELSE 0 END), 0) as total_debits_paise,
          (SELECT balance_after_paise FROM seller_ledger WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 1) as current_balance_paise
        FROM seller_ledger WHERE seller_id = $1
      `, [sellerId]),

      // Recent orders with buyer info and items
     pool.query(`
  SELECT o.id, o.total_amount, o.status, o.payment_method,
         o.created_at, u.name as buyer_name,
         o.delivery_phone, o.delivery_address, o.delivery_landmark,
         COUNT(oi.id) as item_count,
         json_agg(json_build_object(
           'name', p.name,
           'quantity', oi.quantity,
           'unit_price', oi.unit_price
         )) as items
  FROM orders o
  JOIN users u ON o.buyer_id = u.id
  JOIN order_items oi ON oi.order_id = o.id
  JOIN products p ON oi.product_id = p.id
  WHERE o.seller_id = $1
  GROUP BY o.id, u.name, o.delivery_phone, o.delivery_address, o.delivery_landmark
  ORDER BY o.created_at DESC LIMIT 10
`, [sellerId]),

      // Top selling products
      pool.query(`
        SELECT p.id, p.name, p.price, p.stock,
               COALESCE(SUM(oi.quantity), 0) as total_sold,
               COALESCE(SUM(oi.quantity * oi.unit_price), 0) as total_revenue
        FROM products p
        LEFT JOIN order_items oi ON oi.product_id = p.id
        LEFT JOIN orders o ON oi.order_id = o.id AND o.status NOT IN ('cancelled', 'pending')
        WHERE p.seller_id = $1
        GROUP BY p.id
        ORDER BY total_sold DESC LIMIT 5
      `, [sellerId]),

      // Sales by day (last 7 days)
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('day', created_at), 'Dy') as day,
          COALESCE(SUM(total_amount), 0) as sales,
          COUNT(*) as orders
        FROM orders
        WHERE seller_id = $1
        AND created_at >= NOW() - INTERVAL '7 days'
       AND status NOT IN ('cancelled', 'pending')
        GROUP BY DATE_TRUNC('day', created_at)
        ORDER BY DATE_TRUNC('day', created_at)
      `, [sellerId]),
    ]);

    const s = salesStats.rows[0];
    const l = ledgerStats.rows[0];

    const grossSales = parseFloat(s.gross_sales);
    const netEarnings = grossSales * 0.90;
    const currentBalancePaise = l.current_balance_paise || 0;

    res.json({
      sales: {
        total_orders: parseInt(s.total_orders),
        pending_orders: parseInt(s.pending_orders),
        delivered_orders: parseInt(s.delivered_orders),
        cancelled_orders: parseInt(s.cancelled_orders),
        today_sales: parseFloat(s.today_sales),
        monthly_sales: parseFloat(s.monthly_sales),
        gross_sales: grossSales,
      },
      financials: {
        gross_gmv: grossSales,
        net_earnings: netEarnings,
        platform_commission: grossSales * 0.10,
        current_balance: currentBalancePaise / 100,
        withdrawable: currentBalancePaise > 0 ? currentBalancePaise / 100 : 0,
        outstanding_debt: currentBalancePaise < 0 ? Math.abs(currentBalancePaise) / 100 : 0,
      },
      recent_orders: recentOrders.rows,
      top_products: topProducts.rows,
      sales_chart: ordersByDay.rows,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/products — Production ready product creation
exports.createProduct = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      name, description, sku, price,
      stock, category, image_urls,
      return_policy
    } = req.body;

    if (!name || !price || !stock || !return_policy) {
      return res.status(400).json({ error: 'name, price, stock, return_policy are required' });
    }

    const validPolicies = ['PERISHABLE_FOOD', 'PACKAGED_FOOD', 'STANDARD_ELECTRONICS', 'HIGH_VALUE_ELECTRONICS', 'STATIONERY', 'FASHION', 'GROCERY', 'FRESH'];
    if (!validPolicies.includes(return_policy)) {
      return res.status(400).json({ error: `Invalid return_policy. Must be one of: ${validPolicies.join(', ')}` });
    }

    if (!image_urls || image_urls.length === 0) {
      return res.status(400).json({ error: 'At least one product image is required' });
    }

    const seller = await client.query(
      'SELECT id, status FROM sellers WHERE user_id = $1', [req.user.id]
    );
    if (!seller.rows[0]) throw new Error('Seller profile not found');
    if (seller.rows[0].status !== 'approved') throw new Error('Seller not approved yet');

    if (sku) {
      const skuCheck = await client.query(
        'SELECT id FROM products WHERE sku = $1', [sku]
      );
      if (skuCheck.rows.length > 0) throw new Error('SKU already exists');
    }

    const pricePaise = Math.round(parseFloat(price) * 100);
    if (pricePaise <= 0) throw new Error('Price must be greater than 0');

    const result = await client.query(
      `INSERT INTO products
       (seller_id, name, description, sku, price, stock,
        category, image_urls, return_policy, is_available,
        unit_type, unit_weight, price_per_kg)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [seller.rows[0].id, name, description, sku,
       pricePaise / 100, parseInt(stock),
       category, image_urls, return_policy,
       parseInt(stock) > 0,
       req.body.unit_type || 'piece',
       req.body.unit_weight || null,
       req.body.price_per_kg || null]
    );

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Product created successfully',
      product: result.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
};