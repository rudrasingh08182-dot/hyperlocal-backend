// bulkUpload.util.js
// Validation helpers for bulk product upload.

const VALID_CATEGORIES = ['grocery', 'fresh', 'electronics', 'fashion', 'food', 'stationery', 'medical', 'sweets', 'beauty'];

const VALID_UNIT_TYPES = [
  'piece', 'kg', 'gram', 'quintal', 'litre', 'ml', 'dozen', 'packet', 'box', 'bundle',
  'plate', 'bowl', 'cup', 'tray', 'pair', 'set', 'roll', 'sheet',
  'bottle', 'jar', 'can', 'sachet', 'strip', 'meter',
];

const VALID_RETURN_POLICIES = [
  'PERISHABLE_FOOD', 'PACKAGED_FOOD', 'STANDARD_ELECTRONICS', 'HIGH_VALUE_ELECTRONICS',
  'STATIONERY', 'FASHION', 'GROCERY', 'FRESH', 'BEAUTY_ACCESSORIES',
];

const MAX_IMAGES_PER_PRODUCT = 5;
const MAX_COLOR_IMAGES = 6;

function isValidCategory(cat) {
  return VALID_CATEGORIES.includes((cat || '').toLowerCase().trim());
}

function isValidUnitType(unit) {
  return VALID_UNIT_TYPES.includes((unit || '').toLowerCase().trim());
}

function isValidReturnPolicy(policy) {
  return VALID_RETURN_POLICIES.includes((policy || '').toUpperCase().trim());
}

function stripExtensionLower(filename) {
  return (filename || '').trim().toLowerCase().replace(/\.[^/.]+$/, '');
}

function parseImageFileNames(raw) {
  return (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IMAGES_PER_PRODUCT);
}

function parseColorImageFileNames(raw) {
  return (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COLOR_IMAGES);
}

// Validates one product's group of variant rows (Variants.xlsx — weight/size/RAM etc, single-level)
function validateVariantGroup(rows) {
  const errors = [];
  const seenValues = new Set();
  const seenOrders = new Set();
  const cleanRows = [];

  rows.forEach((r, i) => {
    const variantType = String(r['Variant Type'] || '').trim();
    const variantValue = String(r['Variant Value'] || '').trim();
    const priceRaw = r['Price'];
    const stockRaw = r['Stock'];
    const displayOrder = parseInt(r['Display Order']) || (i + 1);

    if (!variantType) errors.push(`Row missing Variant Type for "${variantValue || '(no value)'}"`);
    if (!variantValue) errors.push(`Row missing Variant Value`);

    const price = parseFloat(priceRaw);
    if (!priceRaw || isNaN(price) || price <= 0) errors.push(`Invalid price "${priceRaw}" for variant "${variantValue}"`);

    const stock = parseInt(stockRaw);
    if (stockRaw === '' || stockRaw === undefined || isNaN(stock) || stock < 0) errors.push(`Invalid stock "${stockRaw}" for variant "${variantValue}"`);

    const valueKey = variantValue.toLowerCase();
    if (valueKey && seenValues.has(valueKey)) errors.push(`Duplicate variant value: "${variantValue}"`);
    seenValues.add(valueKey);

    if (seenOrders.has(displayOrder)) errors.push(`Duplicate display_order: ${displayOrder}`);
    seenOrders.add(displayOrder);

    cleanRows.push({ variant_type: variantType, variant_value: variantValue, price, stock, display_order: displayOrder });
  });

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, variants: cleanRows };
}

// Validates one product's group of Color+Size rows (Colors.xlsx — fashion products).
// Each row = one Product + Color + Size combination. Rows sharing the same
// Color Name are grouped into a single color entry with multiple sizes.
// imageMap is the ZIP filename->buffer map, used to resolve "Color Images".
function validateColorVariantGroup(rows, imageMap) {
  const errors = [];
  const colorsMap = new Map(); // colorNameLower -> { color_name, imageKeys, sizes: [] }
  let displayOrderCounter = 1;

  rows.forEach((r, i) => {
    const colorName = String(r['Color Name'] || '').trim();
    const size = String(r['Size'] || '').trim();
    const stockRaw = r['Stock'];
    const priceRaw = r['Price'];
    const imagesRaw = String(r['Color Images'] || '').trim();

    if (!colorName) { errors.push(`Row ${i + 1}: missing Color Name`); return; }
    if (!size) { errors.push(`Row ${i + 1}: missing Size for color "${colorName}"`); return; }

    const stock = parseInt(stockRaw);
    if (stockRaw === '' || stockRaw === undefined || isNaN(stock) || stock < 0) {
      errors.push(`Row ${i + 1}: invalid stock "${stockRaw}" for ${colorName}/${size}`);
      return;
    }

    const price = parseFloat(priceRaw);
    if (priceRaw === '' || priceRaw === undefined || isNaN(price) || price <= 0) {
      errors.push(`Row ${i + 1}: invalid price "${priceRaw}" for ${colorName}/${size}`);
      return;
    }

    const key = colorName.toLowerCase();
    if (!colorsMap.has(key)) {
      const imageFileNames = parseColorImageFileNames(imagesRaw);
      const imageKeys = [];
      imageFileNames.forEach(fn => {
        const k = stripExtensionLower(fn);
        if (imageMap.has(k)) imageKeys.push(k);
      });
      colorsMap.set(key, { color_name: colorName, imageKeys, display_order: displayOrderCounter++, sizes: [] });
    } else if (imagesRaw && colorsMap.get(key).imageKeys.length === 0) {
      const existing = colorsMap.get(key);
      const imageFileNames = parseColorImageFileNames(imagesRaw);
      imageFileNames.forEach(fn => {
        const k = stripExtensionLower(fn);
        if (imageMap.has(k)) existing.imageKeys.push(k);
      });
    }

    const colorEntry = colorsMap.get(key);
    const sizeKey = size.toLowerCase();
    if (colorEntry.sizes.some(s => s.size.toLowerCase() === sizeKey)) {
      errors.push(`Duplicate size "${size}" for color "${colorName}"`);
      return;
    }
    colorEntry.sizes.push({ size, stock, price });
  });

  if (errors.length > 0) return { valid: false, errors };

  const colors = Array.from(colorsMap.values());
  const missingImages = colors.filter(c => c.imageKeys.length === 0);
  if (missingImages.length > 0) {
    return { valid: false, errors: missingImages.map(c => `Color "${c.color_name}" has no matching images in ZIP`) };
  }

  return { valid: true, colors };
}

module.exports = {
  VALID_CATEGORIES,
  VALID_UNIT_TYPES,
  VALID_RETURN_POLICIES,
  MAX_IMAGES_PER_PRODUCT,
  MAX_COLOR_IMAGES,
  isValidCategory,
  isValidUnitType,
  isValidReturnPolicy,
  stripExtensionLower,
  parseImageFileNames,
  parseColorImageFileNames,
  validateVariantGroup,
  validateColorVariantGroup,
};