// bulkUpload.controller.js
const pool = require('../../config/db');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');
const cloudinary = require('cloudinary').v2; // adjust path if your Cloudinary config differs
const streamifier = require('streamifier');

const {
  isValidCategory,
  isValidUnitType,
  isValidReturnPolicy,
  stripExtensionLower,
  validateVariantGroup,
} = require('./bulkUpload.util');

// In-memory store for validated uploads awaiting import.
const pendingUploads = new Map();
const UPLOAD_TTL_MS = 30 * 60 * 1000;

function cleanupExpired() {
  const now = Date.now();
  for (const [id, data] of pendingUploads.entries()) {
    if (now - data.createdAt > UPLOAD_TTL_MS) pendingUploads.delete(id);
  }
}

function uploadBufferToCloudinary(buffer, folder = 'zaplo_bulk_products') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ─────────────────────────────────────────────
// STEP: Validate + Preview
// POST /admin/bulk-upload/validate
// multipart fields: excel (required), zip (required), variants (OPTIONAL), sellerId
// ─────────────────────────────────────────────
exports.validateBulkUpload = async (req, res) => {
  try {
    cleanupExpired();

    const { sellerId } = req.body;
    if (!sellerId) return res.status(400).json({ error: 'sellerId is required' });

    const excelFile = req.files?.excel?.[0];
    const zipFile = req.files?.zip?.[0];
    const variantsFile = req.files?.variants?.[0]; // OPTIONAL
    if (!excelFile) return res.status(400).json({ error: 'Excel file is required' });
    if (!zipFile) return res.status(400).json({ error: 'ZIP file of images is required' });

    const sellerCheck = await pool.query('SELECT id FROM sellers WHERE id = $1', [sellerId]);
    if (!sellerCheck.rows[0]) return res.status(404).json({ error: 'Seller not found' });

    // Parse Products.xlsx
    const workbook = XLSX.read(excelFile.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    // Extract ZIP into a filename -> buffer map
    const zip = new AdmZip(zipFile.buffer);
    const imageMap = new Map();
    zip.getEntries().forEach(entry => {
      if (entry.isDirectory) return;
      const fullName = entry.entryName.split('/').pop();
      imageMap.set(stripExtensionLower(fullName), entry.getData());
    });

    // ── Parse Variants.xlsx (optional) — group rows by Product Name ──
    const variantGroups = new Map(); // productNameLower -> array of raw rows
    if (variantsFile) {
      const vWorkbook = XLSX.read(variantsFile.buffer, { type: 'buffer' });
      const vSheet = vWorkbook.Sheets[vWorkbook.SheetNames[0]];
      const vRows = XLSX.utils.sheet_to_json(vSheet, { defval: '' });
      vRows.forEach(r => {
        const productName = String(r['Product Name'] || '').trim().toLowerCase();
        if (!productName) return;
        if (!variantGroups.has(productName)) variantGroups.set(productName, []);
        variantGroups.get(productName).push(r);
      });
    }

    const valid = [];
    const invalid = [];
    const seenNames = new Set();
    const matchedVariantProducts = new Set(); // tracks which variant groups got used

    rows.forEach((row, idx) => {
      const rowNum = idx + 2;
      const name = String(row['Product Name'] || '').trim();
      const priceRaw = row['Price'];
      const category = String(row['Category'] || '').toLowerCase().trim();
      const stockRaw = row['Stock Quantity'];
      const unitType = String(row['Sold By'] || '').toLowerCase().trim();
      const imageFileName = String(row['Image File Name'] || '').trim();
      const description = String(row['Description'] || '').trim();
      const returnPolicy = String(row['Return Policy'] || '').toUpperCase().trim();

      const errors = [];

      if (!name) errors.push('Product Name is missing');
      if (seenNames.has(name.toLowerCase())) errors.push('Duplicate product name in this file');
      seenNames.add(name.toLowerCase());

      const priceMatch = String(priceRaw || '').match(/[\d.]+/);
      const price = priceMatch ? parseFloat(priceMatch[0]) : NaN;
      if (!priceRaw || isNaN(price) || price <= 0) errors.push(`Invalid price "${priceRaw}"`);

      if (!isValidCategory(category)) errors.push(`Invalid category "${row['Category']}"`);

      const stock = parseInt(stockRaw);
      if (stockRaw === '' || isNaN(stock) || stock < 0) errors.push(`Invalid stock quantity "${stockRaw}"`);

      if (!isValidUnitType(unitType)) errors.push(`Invalid "Sold By" value "${row['Sold By']}"`);

      if (!imageFileName) errors.push('Image File Name is missing');
      const imageKey = stripExtensionLower(imageFileName);
      const imageBuffer = imageFileName ? imageMap.get(imageKey) : null;
      if (imageFileName && !imageBuffer) errors.push(`No matching image found in ZIP for "${imageFileName}"`);

      if (!description) errors.push('Description is missing');

      if (!isValidReturnPolicy(returnPolicy)) errors.push(`Invalid Return Policy "${row['Return Policy']}"`);

      if (errors.length > 0) {
        invalid.push({ row: rowNum, name: name || '(no name)', errors });
        return; // skip variant check — product itself is already invalid
      }

      // ── Check for variants belonging to this product ──
      let variants = null;
      const nameKey = name.toLowerCase();
      if (variantGroups.has(nameKey)) {
        matchedVariantProducts.add(nameKey);
        const group = validateVariantGroup(variantGroups.get(nameKey));
        if (!group.valid) {
          // Per spec: reject ONLY this product, not the whole file
          invalid.push({ row: rowNum, name, errors: [`Variant errors: ${group.errors.join('; ')}`] });
          return;
        }
        variants = group.variants;
      }

      valid.push({
        row: rowNum,
        name,
        price,
        category,
        stock,
        unit_type: unitType,
        description,
        return_policy: returnPolicy,
        imageKey,
        variants, // null for simple products, array for variant products
      });
    });

    // Variant rows whose Product Name didn't match anything in Products.xlsx
    const orphanVariantErrors = [];
    for (const [productNameLower] of variantGroups.entries()) {
      if (!matchedVariantProducts.has(productNameLower)) {
        orphanVariantErrors.push(`Variants found for "${productNameLower}" but no matching product in Products.xlsx`);
      }
    }

    const simpleCount = valid.filter(p => !p.variants).length;
    const variantProductCount = valid.filter(p => p.variants).length;
    const totalVariants = valid.reduce((sum, p) => sum + (p.variants?.length || 0), 0);

    const uploadId = `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pendingUploads.set(uploadId, {
      createdAt: Date.now(),
      sellerId,
      validProducts: valid,
      imageMap,
    });

    res.json({
      uploadId,
      summary: {
        totalRows: rows.length,
        validCount: valid.length,
        invalidCount: invalid.length,
        simpleCount,
        variantProductCount,
        totalVariants,
      },
      preview: valid.slice(0, 50),
      invalid,
      orphanVariantErrors,
    });
  } catch (err) {
    console.error('Bulk validate error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// STEP: Import
// POST /admin/bulk-upload/:uploadId/import
// ─────────────────────────────────────────────
exports.importBulkUpload = async (req, res) => {
  const { uploadId } = req.params;
  const upload = pendingUploads.get(uploadId);

  if (!upload) {
    return res.status(404).json({ error: 'Upload session expired or not found. Please re-upload your files.' });
  }

  const startTime = Date.now();
  const { sellerId, validProducts, imageMap } = upload;
  const client = await pool.connect();
  const results = { success: 0, failed: [] };

  try {
    for (const p of validProducts) {
      try {
        await client.query('BEGIN');

        const imageBuffer = imageMap.get(p.imageKey);
        const imageUrl = imageBuffer
          ? await uploadBufferToCloudinary(imageBuffer)
          : 'https://via.placeholder.com/300';

        const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;

        const productResult = await client.query(
          `INSERT INTO products
           (seller_id, name, description, price, stock, category, image_urls, return_policy, is_available, unit_type, has_variants)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id`,
          [sellerId, p.name, p.description, p.price, p.stock, p.category, [imageUrl], p.return_policy, p.stock > 0, p.unit_type, hasVariants]
        );

        const productId = productResult.rows[0].id;

        if (hasVariants) {
          for (const v of p.variants) {
            await client.query(
              `INSERT INTO product_variants (product_id, variant_type, variant_value, price, stock, display_order)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [productId, v.variant_type, v.variant_value, v.price, v.stock, v.display_order]
            );
          }
        }

        await client.query('COMMIT');
        results.success++;
      } catch (rowErr) {
        await client.query('ROLLBACK');
        // Per spec: this product's failure does NOT stop the rest of the import
        results.failed.push({ row: p.row, name: p.name, error: rowErr.message });
      }
    }

    pendingUploads.delete(uploadId);

    res.json({
      success: results.success,
      failed: results.failed.length,
      errors: results.failed,
      totalTimeMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error('Bulk import error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────
// Download error report as CSV
// GET /admin/bulk-upload/error-report?rows=<JSON-encoded array>
// ─────────────────────────────────────────────
exports.downloadErrorReport = async (req, res) => {
  try {
    const rows = JSON.parse(req.query.rows || '[]');
    let csv = 'Row Number,Product,Reason\n';
    rows.forEach(r => {
      const reason = Array.isArray(r.errors) ? r.errors.join('; ') : (r.error || '');
      csv += `${r.row},"${(r.name || '').replace(/"/g, '""')}","${reason.replace(/"/g, '""')}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=bulk_upload_errors.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};