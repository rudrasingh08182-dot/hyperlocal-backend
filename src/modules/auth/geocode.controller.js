// Proxies OSM Nominatim search — used for the "search address for someone
// else" autocomplete flow. Never call Nominatim directly from the browser;
// it requires a proper User-Agent and has strict rate limits.

exports.searchAddress = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 3) {
      return res.json([]);
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=in&limit=6&addressdetails=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ZaploApp/1.0 (contact: support@zaplo.in)' },
    });
    clearTimeout(timeout);

    const data = await response.json();

    const results = (data || []).map(item => ({
      display_name: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }));

    res.json(results);
  } catch (err) {
    console.error('Geocode search error:', err.message);
    res.json([]); // fail soft — empty suggestions, never crash the UI
  }
};