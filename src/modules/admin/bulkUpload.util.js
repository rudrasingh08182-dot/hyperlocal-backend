// bulkUpload.util.js
// Validation helpers for bulk product upload.
// All product fields now come directly from the Excel file (no auto-detection) —
// this file just validates values against the same allowed lists used elsewhere in Zaplo.

const VALID_CATEGORIES = ['grocery', 'fresh', 'electronics', 'fashion', 'food', 'stationery', 'medical'];

const VALID_UNIT_TYPES = ['piece', 'kg', 'gram', 'litre', 'ml', 'dozen', 'packet', 'box', 'bundle'];

const VALID_RETURN_POLICIES = [
  'PERISHABLE_FOOD', 'PACKAGED_FOOD', 'STANDARD_ELECTRONICS', 'HIGH_VALUE_ELECTRONICS',
  'STATIONERY', 'FASHION', 'GROCERY', 'FRESH', 'MEDICAL',
];

// Max images allowed per product row (1 mandatory + up to 4 optional)
const MAX_IMAGES_PER_PRODUCT = 5;

function isValidCategory(cat) {
  return VALID_CATEGORIES.includes((cat || '').toLowerCase().trim());
}

function isValidUnitType(unit) {
  return VALID_UNIT_TYPES.includes((unit || '').toLowerCase().trim());
}

function isValidReturnPolicy(policy) {
  return VALID_RETURN_POLICIES.includes((policy || '').toUpperCase().trim());
}

// Strips the file extension for matching against ZIP contents
// e.g. "milk.jpg" -> "milk", "MILK.PNG" -> "milk"
function stripExtensionLower(filename) {
  return (filename || '').trim().toLowerCase().replace(/\.[^/.]+$/, '');
}

// Parses the "Image File Name" cell into a list of individual filenames.
// Supports a single filename ("milk.jpg") or multiple, comma-separated
// ("milk.jpg, milk_side.jpg, milk_back.jpg"). Caps at MAX_IMAGES_PER_PRODUCT —
// the first filename is treated as mandatory by the caller, the rest as optional.
function parseImageFileNames(raw) {
  return (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IMAGES_PER_PRODUCT);
}

// Validates one product's group of variant rows (from Variants.xlsx).
// Returns { valid: true, variants: [...] } or { valid: false, errors: [...] }
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

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, variants: cleanRows };
}

module.exports = {
  VALID_CATEGORIES,
  VALID_UNIT_TYPES,
  VALID_RETURN_POLICIES,
  MAX_IMAGES_PER_PRODUCT,
  isValidCategory,
  isValidUnitType,
  isValidReturnPolicy,
  stripExtensionLower,
  parseImageFileNames,
  validateVariantGroup,
};