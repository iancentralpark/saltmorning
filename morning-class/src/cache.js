const store = new Map();

function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlSec) {
  store.set(key, { value, expires: Date.now() + ttlSec * 1000 });
}

module.exports = { cacheGet, cacheSet };
