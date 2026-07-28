// utils/deliveryCharge.js
// ─────────────────────────────────────────────────────────────
// Delivery charge formula (slab-wise):
// 0–3km      → ₹20 flat
// 3–5km      → ₹30 flat
// After 5km  → ₹30 + (distance - 5) × ₹6
// ─────────────────────────────────────────────────────────────

const TIER1_CHARGE   = 20;   // ₹20 for 0–3km
const TIER1_KM       = 3;    // first slab limit
const TIER2_CHARGE   = 30;   // ₹30 for 3–5km
const BASE_KM        = 5;    // second slab limit
const PER_EXTRA_KM   = 6;    // ₹6 per km after 5km

/**
 * Calculate delivery charge based on distance
 * @param {number} distanceKm - distance in kilometers
 * @returns {number} delivery charge in rupees
 */
function calculateDeliveryCharge(distanceKm) {
  if (!distanceKm || distanceKm <= 0) return TIER1_CHARGE;

  if (distanceKm <= TIER1_KM) {
    return TIER1_CHARGE; // flat ₹20 for 0–3km
  }

  if (distanceKm <= BASE_KM) {
    return TIER2_CHARGE; // flat ₹30 for 3–5km
  }

  const extraKm     = distanceKm - BASE_KM;
  const extraCharge = Math.ceil(extraKm) * PER_EXTRA_KM;
  return TIER2_CHARGE + extraCharge;
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

module.exports = { calculateDeliveryCharge, calculateDistance, TIER1_CHARGE, TIER1_KM, TIER2_CHARGE, BASE_KM, PER_EXTRA_KM };