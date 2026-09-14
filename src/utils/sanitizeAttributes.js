// src/utils/sanitizeAttributes.js
//
// The frontend category config decides WHICH attributes a product shows,
// but the backend never trusts that — this strips anything unsafe before
// it's stored, regardless of what the client sends.

function sanitizeAttributes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const clean = {};
  const keys = Object.keys(raw).slice(0, 30); // cap number of attributes per product

  for (const key of keys) {
    if (typeof key !== 'string' || key.length > 50) continue;
    const value = raw[key];
    if (value === null || value === undefined || value === '') continue;

    if (typeof value === 'string') {
      clean[key] = value.slice(0, 500);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    }
    // Nested objects/arrays are silently dropped — attributes must stay flat.
  }

  return clean;
}

module.exports = { sanitizeAttributes };