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

module.exports = {
  VALID_CATEGORIES,
  VALID_UNIT_TYPES,
  VALID_RETURN_POLICIES,
  isValidCategory,
  isValidUnitType,
  isValidReturnPolicy,
  stripExtensionLower,
};