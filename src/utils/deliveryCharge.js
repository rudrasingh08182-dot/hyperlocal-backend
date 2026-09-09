// utils/deliveryCharge.js
// ─────────────────────────────────────────────────────────────
// Delivery charge formula (slab-wise):
// 0–3km      → ₹20 flat
// 3–5km      → ₹30 flat
// 5–7km      → ₹30 + (extra_km × ₹6)   [6km=₹36, 7km=₹42]
// 8–10km     → ₹45 flat
// 10–15km    → ₹59 flat
// >15km      → NOT SERVICEABLE (handled by caller, not this function)
// ─────────────────────────────────────────────────────────────

const TIER1_CHARGE   = 20;
const TIER1_KM       = 3;
const TIER2_CHARGE   = 30;
const BASE_KM        = 5;
const PER_EXTRA_KM   = 6;
const TIER3_KM       = 7;    // 5–7km uses per-km formula
const TIER4_CHARGE   = 45;   // 8–10km flat
const TIER4_KM       = 10;
const TIER5_CHARGE   = 59;   // 10–15km flat
const MAX_SERVICEABLE_KM = 15;

function calculateDeliveryCharge(distanceKm) {
  if (!distanceKm || distanceKm <= 0) return TIER1_CHARGE;

  if (distanceKm <= TIER1_KM) return TIER1_CHARGE;              // 0–3km
  if (distanceKm <= BASE_KM) return TIER2_CHARGE;                // 3–5km
  if (distanceKm <= TIER3_KM) {                                  // 5–7km
    const extraKm = distanceKm - BASE_KM;
    return TIER2_CHARGE + Math.ceil(extraKm) * PER_EXTRA_KM;
  }
  if (distanceKm <= TIER4_KM) return TIER4_CHARGE;                // 8–10km
  if (distanceKm <= MAX_SERVICEABLE_KM) return TIER5_CHARGE;      // 10–15km

  return null; // >15km — not serviceable, caller must handle
}

function isServiceableDistance(distanceKm) {
  return distanceKm !== null && distanceKm !== undefined && distanceKm <= MAX_SERVICEABLE_KM;
}

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

module.exports = {
  calculateDeliveryCharge, calculateDistance, isServiceableDistance,
  MAX_SERVICEABLE_KM,
  TIER1_CHARGE, TIER1_KM, TIER2_CHARGE, BASE_KM, PER_EXTRA_KM,
};