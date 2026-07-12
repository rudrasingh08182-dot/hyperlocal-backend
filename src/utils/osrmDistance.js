// osrmDistance.js
// Computes real driving distance between two coordinates using the free,
// public OSRM (Open Source Routing Machine) routing service — no API key,
// no billing account needed. Returns null on ANY failure (network error,
// service down, bad response) so the caller can fall back to the existing
// straight-line Haversine calculation — order placement must never break
// because of this.

async function getDrivingDistanceKm(originLat, originLng, destLat, destLng) {
  try {
    // OSRM expects coordinates as lng,lat (NOT lat,lng)
    const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s safety timeout — public OSRM can be slow

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes?.[0]) {
      console.error('OSRM routing error:', data.code);
      return null;
    }

    return data.routes[0].distance / 1000; // meters -> km
  } catch (err) {
    console.error('OSRM request failed:', err.message);
    return null;
  }
}

module.exports = { getDrivingDistanceKm };