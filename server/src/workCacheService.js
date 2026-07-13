const WORK_CACHE_SEC = 300;
const workCache = new Map();

function getWorkCache(classId, dateStr) {
  const entry = workCache.get(String(classId) + '|' + String(dateStr));
  if (!entry || Date.now() >= entry.expires) return null;
  return entry.data;
}

function setWorkCache(classId, dateStr, data) {
  workCache.set(String(classId) + '|' + String(dateStr), {
    data,
    expires: Date.now() + WORK_CACHE_SEC * 1000
  });
}

function invalidateWorkCache(classId, dateStr) {
  if (classId != null && classId !== '' && dateStr) {
    workCache.delete(String(classId) + '|' + String(dateStr));
    return;
  }
  if (classId != null && classId !== '') {
    const prefix = String(classId) + '|';
    for (const key of workCache.keys()) {
      if (key.startsWith(prefix)) workCache.delete(key);
    }
    return;
  }
  workCache.clear();
}

module.exports = {
  WORK_CACHE_SEC,
  getWorkCache,
  setWorkCache,
  invalidateWorkCache
};
