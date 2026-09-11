// modules/products/variant.service.js
//
// Universal product-variant engine — business logic layer.
// Does NOT touch legacy tables (product_variants, product_colors,
// product_color_sizes). Legacy products keep reading from those exactly
// as before; this file only adds a *normalization* reader for them so the
// buyer-facing API can return one consistent shape regardless of which
// system a product uses.

const pool = require('../../config/db');

// ── Error helper — every thrown error carries a `code` the controller maps
//    to an HTTP status + { success:false, error:{ code, message } } body ──
function apiError(code, message, status = 400) {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

// ============================================================================
// OWNERSHIP
// ============================================================================
async function ensureSellerOwnsProduct(client, userId, productId) {
  const result = await client.query(
    `SELECT p.id, p.name, p.price, p.stock, p.has_variants, p.has_color_variants,
            p.variant_system, s.id as seller_id
     FROM products p
     JOIN sellers s ON p.seller_id = s.id
     WHERE p.id = $1::uuid`,
    [productId]
  );
  const product = result.rows[0];
  if (!product) throw apiError('PRODUCT_NOT_FOUND', 'Product not found', 404);

  const seller = await client.query('SELECT id FROM sellers WHERE user_id = $1', [userId]);
  if (!seller.rows[0] || seller.rows[0].id !== product.seller_id) {
    throw apiError('UNAUTHORIZED_VARIANT_ACCESS', 'You do not own this product', 403);
  }
  return product;
}

// ============================================================================
// SIGNATURE HELPER — deterministic string for a {GroupName: value} selection
// ============================================================================
function buildSignature(selections) {
  return Object.entries(selections)
    .map(([g, v]) => [g.trim().toLowerCase(), String(v).trim().toLowerCase()])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, v]) => `${g}=${v}`)
    .join('|');
}

// ============================================================================
// VALIDATION
// ============================================================================
function validateGroupsPayload(groups) {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw apiError('VARIANT_GROUP_REQUIRED', 'At least one variant group is required');
  }
  const seenGroupNames = new Set();
  for (const g of groups) {
    if (!g.name || !g.name.trim()) {
      throw apiError('VARIANT_GROUP_REQUIRED', 'Every variant group needs a name');
    }
    const key = g.name.trim().toLowerCase();
    if (seenGroupNames.has(key)) {
      throw apiError('DUPLICATE_VARIANT_GROUP', `Duplicate variant group: "${g.name}"`);
    }
    seenGroupNames.add(key);

    if (!Array.isArray(g.options) || g.options.length === 0) {
      throw apiError('VARIANT_OPTION_REQUIRED', `Group "${g.name}" needs at least one option`);
    }
    const seenValues = new Set();
    for (const o of g.options) {
      if (!o.value || !o.value.trim()) {
        throw apiError('VARIANT_OPTION_REQUIRED', `Group "${g.name}" has an option with no value`);
      }
      const vKey = o.value.trim().toLowerCase();
      if (seenValues.has(vKey)) {
        throw apiError('DUPLICATE_VARIANT_OPTION', `Duplicate option "${o.value}" in group "${g.name}"`);
      }
      seenValues.add(vKey);
    }
  }
}

function validateCombinationsPayload(combinations, groupNames) {
  if (!Array.isArray(combinations) || combinations.length === 0) {
    throw apiError('INVALID_COMBINATION', 'At least one combination is required');
  }
  const requiredGroups = groupNames.map((n) => n.toLowerCase());
  const seenSignatures = new Set();

  for (const c of combinations) {
    const selectionKeys = Object.keys(c.selections || {}).map((k) => k.toLowerCase());
    const matchesAllGroups =
      selectionKeys.length === requiredGroups.length &&
      requiredGroups.every((g) => selectionKeys.includes(g));
    if (!matchesAllGroups) {
      throw apiError(
        'INVALID_COMBINATION',
        `Combination must contain exactly one option from each group (${groupNames.join(', ')})`
      );
    }

    const sig = buildSignature(c.selections);
    if (seenSignatures.has(sig)) {
      throw apiError('INVALID_COMBINATION', `Duplicate combination: ${JSON.stringify(c.selections)}`);
    }
    seenSignatures.add(sig);

    if (c.price !== undefined && c.price !== null && parseFloat(c.price) <= 0) {
      throw apiError('INVALID_PRICE', `Combination price must be greater than 0`);
    }
    if (c.stock === undefined || c.stock === null || parseInt(c.stock) < 0) {
      throw apiError('INVALID_STOCK', `Combination stock must be a valid non-negative number`);
    }
  }
}

// ============================================================================
// CREATE  (POST /api/products/:id/variants)
// ============================================================================
async function createVariantConfiguration(userId, productId, body) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const product = await ensureSellerOwnsProduct(client, userId, productId);
    if (product.variant_system === 'v2') {
      throw apiError(
        'INVALID_COMBINATION',
        'This product already has V2 variants — use PUT to update instead'
      );
    }

    const { variantGroups } = body;
    validateGroupsPayload(variantGroups);
    const groupNames = variantGroups.map((g) => g.name.trim());
    validateCombinationsPayload(body.combinations, groupNames);

    // ── Insert groups + options + images, building lookup maps ──
    const optionIdByKey = new Map(); // "groupNameLower|valueLower" -> option_id

    for (let gi = 0; gi < variantGroups.length; gi++) {
      const g = variantGroups[gi];
      const groupResult = await client.query(
        `INSERT INTO product_variant_groups_v2 (product_id, name, display_order)
         VALUES ($1::uuid, $2, $3) RETURNING id`,
        [productId, g.name.trim(), g.displayOrder ?? gi]
      );
      const groupId = groupResult.rows[0].id;

      for (let oi = 0; oi < g.options.length; oi++) {
        const o = g.options[oi];
        const optionResult = await client.query(
          `INSERT INTO product_variant_options_v2 (variant_group_id, value, display_order)
           VALUES ($1::uuid, $2, $3) RETURNING id`,
          [groupId, o.value.trim(), o.displayOrder ?? oi]
        );
        const optionId = optionResult.rows[0].id;
        optionIdByKey.set(`${g.name.trim().toLowerCase()}|${o.value.trim().toLowerCase()}`, optionId);

        if (Array.isArray(o.images)) {
          for (let ii = 0; ii < o.images.length; ii++) {
            await client.query(
              `INSERT INTO product_variant_option_images_v2 (option_id, image_url, display_order)
               VALUES ($1::uuid, $2, $3)`,
              [optionId, o.images[ii], ii]
            );
          }
        }
      }
    }

    // ── Insert combinations + combination_items ──
    for (let ci = 0; ci < body.combinations.length; ci++) {
      const c = body.combinations[ci];
      if (c.sku) {
        const skuCheck = await client.query(
          `SELECT id FROM product_variant_combinations_v2 WHERE lower(sku) = lower($1)`,
          [c.sku]
        );
        if (skuCheck.rows[0]) throw apiError('INVALID_COMBINATION', `SKU already exists: ${c.sku}`);
      }

      const comboResult = await client.query(
        `INSERT INTO product_variant_combinations_v2
           (product_id, price, stock, sku, display_order, is_active)
         VALUES ($1::uuid, $2, $3, $4, $5, true) RETURNING id`,
        [
          productId,
          c.price ? parseFloat(c.price) : null,
          parseInt(c.stock),
          c.sku || null,
          c.displayOrder ?? ci,
        ]
      );
      const combinationId = comboResult.rows[0].id;

      for (const [groupName, value] of Object.entries(c.selections)) {
        const key = `${groupName.trim().toLowerCase()}|${String(value).trim().toLowerCase()}`;
        const optionId = optionIdByKey.get(key);
        if (!optionId) throw apiError('INVALID_COMBINATION', `Unknown option: ${groupName}=${value}`);
        await client.query(
          `INSERT INTO product_variant_combination_items_v2 (combination_id, option_id)
           VALUES ($1::uuid, $2::uuid)`,
          [combinationId, optionId]
        );
      }
    }

    await client.query(
      `UPDATE products SET has_variants = true, variant_system = 'v2', updated_at = now()
       WHERE id = $1::uuid`,
      [productId]
    );

    await client.query('COMMIT');
    return getProductVariants(productId); // re-read outside the transaction, post stock-sync trigger
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// READ — normalized shape for BOTH legacy and V2 products
//   { id, name, price, stock, hasVariants, variantSystem, variantGroups, combinations }
// ============================================================================
async function getProductVariants(productId) {
  const productResult = await pool.query(
    `SELECT id, name, price, stock, has_variants, has_color_variants, variant_system
     FROM products WHERE id = $1::uuid`,
    [productId]
  );
  const product = productResult.rows[0];
  if (!product) throw apiError('PRODUCT_NOT_FOUND', 'Product not found', 404);

  const base = {
    id: product.id,
    name: product.name,
    price: parseFloat(product.price),
    stock: product.stock,
    hasVariants: false,
    variantSystem: null,
    variantGroups: [],
    combinations: [],
  };

  // ── V2 ──
  if (product.variant_system === 'v2') {
    const groupsResult = await pool.query(
      `SELECT g.id as group_id, g.name as group_name, g.display_order as group_order,
              o.id as option_id, o.value as option_value, o.display_order as option_order,
              COALESCE(
                (SELECT json_agg(json_build_object('id', oi.id, 'url', oi.image_url) ORDER BY oi.display_order)
                 FROM product_variant_option_images_v2 oi WHERE oi.option_id = o.id),
                '[]'
              ) as images
       FROM product_variant_groups_v2 g
       LEFT JOIN product_variant_options_v2 o ON o.variant_group_id = g.id
       WHERE g.product_id = $1::uuid
       ORDER BY g.display_order, o.display_order`,
      [productId]
    );

    const groupMap = new Map();
    for (const row of groupsResult.rows) {
      if (!groupMap.has(row.group_id)) {
        groupMap.set(row.group_id, { id: row.group_id, name: row.group_name, options: [] });
      }
      if (row.option_id) {
        groupMap.get(row.group_id).options.push({
          id: row.option_id,
          value: row.option_value,
          images: row.images,
        });
      }
    }

    const combosResult = await pool.query(
      `SELECT c.id, c.price, c.stock, c.sku, c.display_order, c.is_active,
              json_object_agg(g.name, o.value) as selections
       FROM product_variant_combinations_v2 c
       JOIN product_variant_combination_items_v2 ci ON ci.combination_id = c.id
       JOIN product_variant_options_v2 o ON o.id = ci.option_id
       JOIN product_variant_groups_v2 g ON g.id = o.variant_group_id
       WHERE c.product_id = $1::uuid
       GROUP BY c.id
       ORDER BY c.display_order`,
      [productId]
    );

    return {
      ...base,
      hasVariants: true,
      variantSystem: 'v2',
      variantGroups: [...groupMap.values()],
      combinations: combosResult.rows.map((c) => ({
        id: c.id,
        selections: c.selections,
        price: c.price !== null ? parseFloat(c.price) : base.price, // fallback to base price
        stock: c.stock,
        sku: c.sku,
        is_active: c.is_active,
      })),
    };
  }

  // ── Legacy: Color + Size (Fashion) ──
  if (product.has_color_variants) {
    const colors = await pool.query(
      `SELECT id, color_name, images FROM product_colors WHERE product_id = $1::uuid ORDER BY display_order`,
      [productId]
    );
    const colorGroup = {
      id: 'legacy-color',
      name: 'Color',
      options: colors.rows.map((c) => ({ id: c.id, value: c.color_name, images: c.images || [] })),
    };
    const sizesFlat = [];
    let sizeGroup = null;
    for (const c of colors.rows) {
      const sizes = await pool.query(
        `SELECT id, size, stock, price FROM product_color_sizes WHERE color_id = $1::uuid ORDER BY size`,
        [c.id]
      );
      for (const s of sizes.rows) {
        if (!sizeGroup) sizeGroup = { id: 'legacy-size', name: 'Size', options: [] };
        if (!sizeGroup.options.find((o) => o.value === s.size)) {
          sizeGroup.options.push({ id: `legacy-size-${s.size}`, value: s.size, images: [] });
        }
        sizesFlat.push({
          id: s.id,
          selections: { Color: c.color_name, Size: s.size },
          price: s.price !== null ? parseFloat(s.price) : base.price,
          stock: s.stock,
          sku: null,
          is_active: true,
        });
      }
    }
    return {
      ...base,
      hasVariants: true,
      variantSystem: 'legacy',
      variantGroups: sizeGroup ? [colorGroup, sizeGroup] : [colorGroup],
      combinations: sizesFlat,
    };
  }

  // ── Legacy: flat product_variants (single-dimension, e.g. Size only) ──
  if (product.has_variants) {
    const variants = await pool.query(
      `SELECT id, variant_type, variant_value, price, stock, display_order
       FROM product_variants WHERE product_id = $1::uuid AND status = 'active'
       ORDER BY display_order`,
      [productId]
    );
    const groupsByType = new Map();
    const combos = [];
    for (const v of variants.rows) {
      if (!groupsByType.has(v.variant_type)) {
        groupsByType.set(v.variant_type, { id: `legacy-${v.variant_type}`, name: v.variant_type, options: [] });
      }
      groupsByType.get(v.variant_type).options.push({ id: v.id, value: v.variant_value, images: [] });
      combos.push({
        id: v.id,
        selections: { [v.variant_type]: v.variant_value },
        price: parseFloat(v.price),
        stock: v.stock,
        sku: null,
        is_active: true,
      });
    }
    return {
      ...base,
      hasVariants: true,
      variantSystem: 'legacy',
      variantGroups: [...groupsByType.values()],
      combinations: combos,
    };
  }

  // ── Simple product, no variants at all ──
  return base;
}

// ============================================================================
// SYNC / UPDATE  (PUT /api/products/:id/variants)
// Additive-safe: adds new groups/options/combinations, updates existing
// combinations matched by signature. Does NOT delete groups/options/combos
// here — use the dedicated DELETE endpoints for that (with confirmation).
// ============================================================================
async function syncVariantConfiguration(userId, productId, body) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const product = await ensureSellerOwnsProduct(client, userId, productId);
    if (product.variant_system !== 'v2') {
      throw apiError(
        'INVALID_COMBINATION',
        'This product has no V2 variant configuration yet — use POST to create one first'
      );
    }

    const { variantGroups } = body;
    validateGroupsPayload(variantGroups);
    const groupNames = variantGroups.map((g) => g.name.trim());
    validateCombinationsPayload(body.combinations, groupNames);

    // ── Load existing groups/options ──
    const existingGroups = await client.query(
      `SELECT id, name FROM product_variant_groups_v2 WHERE product_id = $1::uuid`,
      [productId]
    );
    const groupIdByName = new Map(existingGroups.rows.map((g) => [g.name.toLowerCase(), g.id]));

    const existingOptions = await client.query(
      `SELECT o.id, o.value, g.name as group_name
       FROM product_variant_options_v2 o
       JOIN product_variant_groups_v2 g ON g.id = o.variant_group_id
       WHERE g.product_id = $1::uuid`,
      [productId]
    );
    const optionIdByKey = new Map(
      existingOptions.rows.map((o) => [`${o.group_name.toLowerCase()}|${o.value.toLowerCase()}`, o.id])
    );

    // ── Upsert groups + options (insert-only; never deletes here) ──
    for (let gi = 0; gi < variantGroups.length; gi++) {
      const g = variantGroups[gi];
      const gKey = g.name.trim().toLowerCase();
      let groupId = groupIdByName.get(gKey);
      if (!groupId) {
        const inserted = await client.query(
          `INSERT INTO product_variant_groups_v2 (product_id, name, display_order)
           VALUES ($1::uuid, $2, $3) RETURNING id`,
          [productId, g.name.trim(), g.displayOrder ?? gi]
        );
        groupId = inserted.rows[0].id;
        groupIdByName.set(gKey, groupId);
      }

      for (let oi = 0; oi < g.options.length; oi++) {
        const o = g.options[oi];
        const oKey = `${gKey}|${o.value.trim().toLowerCase()}`;
        if (!optionIdByKey.has(oKey)) {
          const inserted = await client.query(
            `INSERT INTO product_variant_options_v2 (variant_group_id, value, display_order)
             VALUES ($1::uuid, $2, $3) RETURNING id`,
            [groupId, o.value.trim(), o.displayOrder ?? oi]
          );
          optionIdByKey.set(oKey, inserted.rows[0].id);

          if (Array.isArray(o.images)) {
            for (let ii = 0; ii < o.images.length; ii++) {
              await client.query(
                `INSERT INTO product_variant_option_images_v2 (option_id, image_url, display_order)
                 VALUES ($1::uuid, $2, $3)`,
                [optionIdByKey.get(oKey), o.images[ii], ii]
              );
            }
          }
        }
      }
    }

    // ── Load existing combinations (with signatures) ──
    const existingCombosResult = await client.query(
      `SELECT c.id, c.stock,
              json_object_agg(g.name, o.value) as selections
       FROM product_variant_combinations_v2 c
       JOIN product_variant_combination_items_v2 ci ON ci.combination_id = c.id
       JOIN product_variant_options_v2 o ON o.id = ci.option_id
       JOIN product_variant_groups_v2 g ON g.id = o.variant_group_id
       WHERE c.product_id = $1::uuid
       GROUP BY c.id`,
      [productId]
    );
    const existingComboBySignature = new Map(
      existingCombosResult.rows.map((c) => [buildSignature(c.selections), c])
    );

    const incomingSignatures = new Set();

    for (let ci = 0; ci < body.combinations.length; ci++) {
      const c = body.combinations[ci];
      const sig = buildSignature(c.selections);
      incomingSignatures.add(sig);
      const existing = existingComboBySignature.get(sig);

      if (existing) {
        // Update in place — preserves the combination's id and order history
        await client.query(
          `UPDATE product_variant_combinations_v2
           SET price = $1, stock = $2, sku = COALESCE($3, sku), display_order = $4,
               is_active = true, updated_at = now()
           WHERE id = $5::uuid`,
          [c.price ? parseFloat(c.price) : null, parseInt(c.stock), c.sku || null, c.displayOrder ?? ci, existing.id]
        );
      } else {
        // New combination
        const comboResult = await client.query(
          `INSERT INTO product_variant_combinations_v2
             (product_id, price, stock, sku, display_order, is_active)
           VALUES ($1::uuid, $2, $3, $4, $5, true) RETURNING id`,
          [productId, c.price ? parseFloat(c.price) : null, parseInt(c.stock), c.sku || null, c.displayOrder ?? ci]
        );
        const combinationId = comboResult.rows[0].id;
        for (const [groupName, value] of Object.entries(c.selections)) {
          const key = `${groupName.trim().toLowerCase()}|${String(value).trim().toLowerCase()}`;
          const optionId = optionIdByKey.get(key);
          if (!optionId) throw apiError('INVALID_COMBINATION', `Unknown option: ${groupName}=${value}`);
          await client.query(
            `INSERT INTO product_variant_combination_items_v2 (combination_id, option_id)
             VALUES ($1::uuid, $2::uuid)`,
            [combinationId, optionId]
          );
        }
      }
    }

    // ── Combos that used to exist but are no longer in the payload ──
    const missing = existingCombosResult.rows.filter((c) => !incomingSignatures.has(buildSignature(c.selections)));
    if (missing.length > 0) {
      if (!body.confirmDeletions) {
        throw apiError(
          'CONFIRMATION_REQUIRED',
          `${missing.length} existing combination(s) are missing from this update and would be deactivated. Resend with confirmDeletions: true to proceed.`
        );
      }
      for (const m of missing) {
        // Soft-deactivate rather than hard-delete — preserves any order history.
        await client.query(
          `UPDATE product_variant_combinations_v2 SET is_active = false, updated_at = now() WHERE id = $1::uuid`,
          [m.id]
        );
      }
    }

    await client.query('COMMIT');
    return getProductVariants(productId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// SINGLE-COMBINATION HELPERS
// ============================================================================
async function updateCombinationStock(userId, combinationId, stock) {
  if (stock === undefined || stock === null || parseInt(stock) < 0) {
    throw apiError('INVALID_STOCK', 'Stock must be a valid non-negative number');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const combo = await client.query(
      `SELECT c.id, c.product_id FROM product_variant_combinations_v2 c WHERE c.id = $1::uuid`,
      [combinationId]
    );
    if (!combo.rows[0]) throw apiError('COMBINATION_NOT_FOUND', 'Combination not found', 404);
    await ensureSellerOwnsProduct(client, userId, combo.rows[0].product_id);

    await client.query(
      `UPDATE product_variant_combinations_v2 SET stock = $1, updated_at = now() WHERE id = $2::uuid`,
      [parseInt(stock), combinationId]
    );
    await client.query('COMMIT');
    return { id: combinationId, stock: parseInt(stock) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateCombination(userId, combinationId, fields) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const combo = await client.query(
      `SELECT id, product_id FROM product_variant_combinations_v2 WHERE id = $1::uuid`,
      [combinationId]
    );
    if (!combo.rows[0]) throw apiError('COMBINATION_NOT_FOUND', 'Combination not found', 404);
    await ensureSellerOwnsProduct(client, userId, combo.rows[0].product_id);

    if (fields.price !== undefined && fields.price !== null && parseFloat(fields.price) <= 0) {
      throw apiError('INVALID_PRICE', 'Price must be greater than 0');
    }
    if (fields.stock !== undefined && parseInt(fields.stock) < 0) {
      throw apiError('INVALID_STOCK', 'Stock must be non-negative');
    }

    const result = await client.query(
      `UPDATE product_variant_combinations_v2 SET
         price = COALESCE($1, price),
         stock = COALESCE($2, stock),
         sku = COALESCE($3, sku),
         is_active = COALESCE($4, is_active),
         updated_at = now()
       WHERE id = $5::uuid RETURNING *`,
      [
        fields.price !== undefined ? parseFloat(fields.price) : null,
        fields.stock !== undefined ? parseInt(fields.stock) : null,
        fields.sku !== undefined ? fields.sku : null,
        fields.is_active !== undefined ? fields.is_active : null,
        combinationId,
      ]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Deactivate if the combination has order history, hard-delete otherwise
async function deleteCombination(userId, combinationId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const combo = await client.query(
      `SELECT id, product_id FROM product_variant_combinations_v2 WHERE id = $1::uuid`,
      [combinationId]
    );
    if (!combo.rows[0]) throw apiError('COMBINATION_NOT_FOUND', 'Combination not found', 404);
    await ensureSellerOwnsProduct(client, userId, combo.rows[0].product_id);

    const hasHistory = await client.query(
      `SELECT 1 FROM order_items WHERE variant_combination_id = $1::uuid LIMIT 1`,
      [combinationId]
    );

    if (hasHistory.rows[0]) {
      await client.query(
        `UPDATE product_variant_combinations_v2 SET is_active = false, updated_at = now() WHERE id = $1::uuid`,
        [combinationId]
      );
      await client.query('COMMIT');
      return { deactivated: true };
    } else {
      await client.query(`DELETE FROM product_variant_combinations_v2 WHERE id = $1::uuid`, [combinationId]);
      await client.query('COMMIT');
      return { deleted: true };
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// GROUP / OPTION DELETION  (explicit, confirm-required, cascades safely)
// ============================================================================
async function deleteGroup(userId, groupId, confirm) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const group = await client.query(
      `SELECT id, product_id FROM product_variant_groups_v2 WHERE id = $1::uuid`,
      [groupId]
    );
    if (!group.rows[0]) throw apiError('COMBINATION_NOT_FOUND', 'Variant group not found', 404);
    await ensureSellerOwnsProduct(client, userId, group.rows[0].product_id);

    // Every combination touches every group, so removing a group removes
    // ALL combinations for this product.
    const affectedCombos = await client.query(
      `SELECT DISTINCT c.id FROM product_variant_combinations_v2 c
       JOIN product_variant_combination_items_v2 ci ON ci.combination_id = c.id
       JOIN product_variant_options_v2 o ON o.id = ci.option_id
       WHERE o.variant_group_id = $1::uuid`,
      [groupId]
    );

    if (affectedCombos.rows.length > 0 && !confirm) {
      throw apiError(
        'CONFIRMATION_REQUIRED',
        `Deleting this group will remove ${affectedCombos.rows.length} combination(s). Pass confirm=true to proceed.`
      );
    }

    for (const c of affectedCombos.rows) {
      const hasHistory = await client.query(
        `SELECT 1 FROM order_items WHERE variant_combination_id = $1::uuid LIMIT 1`,
        [c.id]
      );
      if (hasHistory.rows[0]) {
        await client.query(
          `UPDATE product_variant_combinations_v2 SET is_active = false WHERE id = $1::uuid`,
          [c.id]
        );
        // Detach items so the option's RESTRICT constraint doesn't block the group delete
        await client.query(
          `DELETE FROM product_variant_combination_items_v2 WHERE combination_id = $1::uuid`,
          [c.id]
        );
      } else {
        await client.query(`DELETE FROM product_variant_combinations_v2 WHERE id = $1::uuid`, [c.id]);
      }
    }

    await client.query(`DELETE FROM product_variant_groups_v2 WHERE id = $1::uuid`, [groupId]); // cascades options + images
    await client.query('COMMIT');
    return { deleted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteOption(userId, optionId, confirm) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const option = await client.query(
      `SELECT o.id, g.product_id FROM product_variant_options_v2 o
       JOIN product_variant_groups_v2 g ON g.id = o.variant_group_id
       WHERE o.id = $1::uuid`,
      [optionId]
    );
    if (!option.rows[0]) throw apiError('COMBINATION_NOT_FOUND', 'Variant option not found', 404);
    await ensureSellerOwnsProduct(client, userId, option.rows[0].product_id);

    const affectedCombos = await client.query(
      `SELECT DISTINCT combination_id as id FROM product_variant_combination_items_v2 WHERE option_id = $1::uuid`,
      [optionId]
    );

    if (affectedCombos.rows.length > 0 && !confirm) {
      throw apiError(
        'CONFIRMATION_REQUIRED',
        `Deleting this option will remove ${affectedCombos.rows.length} combination(s). Pass confirm=true to proceed.`
      );
    }

    for (const c of affectedCombos.rows) {
      const hasHistory = await client.query(
        `SELECT 1 FROM order_items WHERE variant_combination_id = $1::uuid LIMIT 1`,
        [c.id]
      );
      if (hasHistory.rows[0]) {
        await client.query(`UPDATE product_variant_combinations_v2 SET is_active = false WHERE id = $1::uuid`, [c.id]);
        await client.query(`DELETE FROM product_variant_combination_items_v2 WHERE combination_id = $1::uuid`, [c.id]);
      } else {
        await client.query(`DELETE FROM product_variant_combinations_v2 WHERE id = $1::uuid`, [c.id]);
      }
    }

    await client.query(`DELETE FROM product_variant_options_v2 WHERE id = $1::uuid`, [optionId]); // cascades images
    await client.query('COMMIT');
    return { deleted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// OPTION IMAGES
// ============================================================================
async function addOptionImage(userId, optionId, imageUrl) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const option = await client.query(
      `SELECT o.id, g.product_id FROM product_variant_options_v2 o
       JOIN product_variant_groups_v2 g ON g.id = o.variant_group_id
       WHERE o.id = $1::uuid`,
      [optionId]
    );
    if (!option.rows[0]) throw apiError('COMBINATION_NOT_FOUND', 'Variant option not found', 404);
    await ensureSellerOwnsProduct(client, userId, option.rows[0].product_id);

    const maxOrder = await client.query(
      `SELECT COALESCE(MAX(display_order), -1) + 1 as next FROM product_variant_option_images_v2 WHERE option_id = $1::uuid`,
      [optionId]
    );
    const result = await client.query(
      `INSERT INTO product_variant_option_images_v2 (option_id, image_url, display_order)
       VALUES ($1::uuid, $2, $3) RETURNING *`,
      [optionId, imageUrl, maxOrder.rows[0].next]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteOptionImage(userId, imageId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const image = await client.query(
      `SELECT oi.id, g.product_id FROM product_variant_option_images_v2 oi
       JOIN product_variant_options_v2 o ON o.id = oi.option_id
       JOIN product_variant_groups_v2 g ON g.id = o.variant_group_id
       WHERE oi.id = $1::uuid`,
      [imageId]
    );
    if (!image.rows[0]) throw apiError('COMBINATION_NOT_FOUND', 'Image not found', 404);
    await ensureSellerOwnsProduct(client, userId, image.rows[0].product_id);

    await client.query(`DELETE FROM product_variant_option_images_v2 WHERE id = $1::uuid`, [imageId]);
    await client.query('COMMIT');
    return { deleted: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================================
// STOCK — atomic decrement/restore, for use inside checkout/cancellation
// transactions elsewhere in the codebase. Pass in YOUR OWN `client`
// (already inside a BEGIN) so this participates in that transaction.
// ============================================================================
async function decrementStock(client, combinationId, quantity, orderId) {
  try {
    const result = await client.query(
      `SELECT * FROM decrement_variant_stock_v2($1::uuid, $2::int, $3::uuid)`,
      [combinationId, quantity, orderId]
    );
    return result.rows[0];
  } catch (err) {
    if (err.message.includes('INSUFFICIENT_STOCK')) throw apiError('INSUFFICIENT_STOCK', 'Selected variant is out of stock');
    if (err.message.includes('INVALID_QUANTITY')) throw apiError('INVALID_QUANTITY', 'Invalid quantity');
    throw err;
  }
}

async function restoreStock(client, combinationId, quantity, orderId) {
  const result = await client.query(`SELECT restore_variant_stock_v2($1::uuid, $2::int, $3::uuid) as restored`, [
    combinationId,
    quantity,
    orderId,
  ]);
  return result.rows[0].restored;
}

// Resolves a combination for checkout — used to validate cart/order items
// server-side instead of trusting frontend-supplied price.
async function resolveCombinationForCheckout(combinationId) {
  const result = await pool.query(
    `SELECT c.id, c.product_id, c.price, c.stock, c.is_active, p.price as product_price
     FROM product_variant_combinations_v2 c
     JOIN products p ON p.id = c.product_id
     WHERE c.id = $1::uuid`,
    [combinationId]
  );
  const combo = result.rows[0];
  if (!combo) throw apiError('COMBINATION_NOT_FOUND', 'Variant combination not found', 404);
  if (!combo.is_active) throw apiError('COMBINATION_NOT_FOUND', 'This variant is no longer available', 404);
  return {
    ...combo,
    effectivePrice: combo.price !== null ? parseFloat(combo.price) : parseFloat(combo.product_price),
  };
}

module.exports = {
  apiError,
  getProductVariants,
  createVariantConfiguration,
  syncVariantConfiguration,
  updateCombinationStock,
  updateCombination,
  deleteCombination,
  deleteGroup,
  deleteOption,
  addOptionImage,
  deleteOptionImage,
  decrementStock,
  restoreStock,
  resolveCombinationForCheckout,
};