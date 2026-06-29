// utils/deliveryCharge.js
// ─────────────────────────────────────────────────────────────
// Delivery charge formula:
// First 5km  → ₹20 flat
// After 5km  → ₹20 + (distance - 5) × ₹6
// ─────────────────────────────────────────────────────────────

const BASE_CHARGE    = 20;   // ₹20 for first 5km
const BASE_KM        = 5;    // base km limit
const PER_EXTRA_KM   = 6;    // ₹6 per km after 5km

/**
 * Calculate delivery charge based on distance
 * @param {number} distanceKm - distance in kilometers
 * @returns {number} delivery charge in rupees
 */
function calculateDeliveryCharge(distanceKm) {
  if (!distanceKm || distanceKm <= 0) return BASE_CHARGE;

  if (distanceKm <= BASE_KM) {
    return BASE_CHARGE; // flat ₹20 for first 5km
  }

  const extraKm     = distanceKm - BASE_KM;
  const extraCharge = Math.ceil(extraKm) * PER_EXTRA_KM;
  return BASE_CHARGE + extraCharge;
}

/**
 * Haversine formula to calculate distance between two coordinates
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

module.exports = { calculateDeliveryCharge, calculateDistance, BASE_CHARGE, BASE_KM, PER_EXTRA_KM };