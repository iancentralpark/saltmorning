const { CLASS_LIST_SHEET, CACHE_SEC } = require('./config');
const { getSheetRows } = require('./sheets');
const { cacheGet, cacheSet } = require('./cache');

async function getInitialData() {
  const cached = cacheGet('initial_classes_v1');
  if (cached) return cached;

  const classData = await getSheetRows(CLASS_LIST_SHEET);
  const classes = [];
  for (let i = 1; i < classData.length; i++) {
    classes.push({
      id: classData[i][0],
      name: classData[i][1],
      scheduleType: classData[i][2],
      allowedDays: String(classData[i][3] || '').split(',').map(Number)
    });
  }
  const result = { classes };
  cacheSet('initial_classes_v1', result, CACHE_SEC.CLASSES);
  return result;
}

module.exports = { getInitialData };
