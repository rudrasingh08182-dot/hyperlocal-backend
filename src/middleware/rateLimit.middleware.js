// Lightweight in-process limiter. Use an edge/WAF limiter too when running more
// than one backend instance, because process memory is not shared between nodes.
function createRateLimiter({ windowMs, max, keyGenerator = (req) => req.ip }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator(req) || req.ip;
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}

module.exports = { createRateLimiter };
