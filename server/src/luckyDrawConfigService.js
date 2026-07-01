const {
  LUCKY_DRAW_TIERS_SHEET,
  LUCKY_DRAW_PRIZES_SHEET
} = require('./config');
const { getSheetRows, appendRows, updateRange, deleteRows, invalidateSheetRowsCache } = require('./sheets');

const TIER_HEADERS = ['TierID', 'TierName', 'Weight', 'SortOrder', 'Active'];
const PRIZE_HEADERS = ['TierID', 'PrizeText', 'SortOrder', 'Active'];

const DEFAULT_LUCKY_DRAW_TIERS = [
  {
    id: 'common',
    name: 'Common',
    weight: 35,
    items: ['1 Haribo', '2 Haribos', 'Bathroom/Water Priority', '1 Vocab Hint', 'Free Stationery Rental', '5% Vocab Magic Pass', '3 Haribos']
  },
  {
    id: 'rare',
    name: 'Rare',
    weight: 25,
    items: ['10% Vocab Magic Pass', '2 Vocab Hints', '1 Minute more vocab test', 'Handshake with Mr. Park', "Mr. Park's Silly Face", '5 Haribos']
  },
  {
    id: 'unique',
    name: 'Unique',
    weight: 20,
    items: ['15% Vocab Magic Pass', 'High-five with Mr. Park', '1 Minute Timestone', '1 Day Chambit Pass', 'Combo Shield', 'Wrong Answer Eraser']
  },
  {
    id: 'legendary',
    name: 'Legendary',
    weight: 13,
    items: ['20% Vocab Magic Pass', '2 Minutes Freedom Bell', '2 Minutes Timestone', "The King's Throne"]
  },
  {
    id: 'mythical',
    name: 'Mythical',
    weight: 5,
    items: ['Name The Teacher', '3 Minutes Freedom Bell', 'Be a Commander!', '3 Minutes Timestone']
  },
  {
    id: 'godlike',
    name: 'Godlike',
    weight: 2,
    items: ['The Forbidden Word', '5 Minutes Freedom Bell', 'Double Dollars']
  }
];

function isActiveFlag(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  return v === '' || v === 'y' || v === 'yes' || v === 'true' || v === '1';
}

function slugifyTierId(name, fallback) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback || 'tier';
}

function normalizeTierInput(tier, index) {
  const name = String(tier.name || tier.tierName || '').trim();
  const id = String(tier.id || tier.tierId || slugifyTierId(name, 'tier_' + (index + 1))).trim();
  const weight = Math.max(0, Number(tier.weight) || 0);
  const sortOrder = Number(tier.sortOrder) || (index + 1);
  const active = tier.active == null ? true : !!tier.active;
  let items = [];
  if (Array.isArray(tier.items)) {
    items = tier.items.map(function(item) {
      if (typeof item === 'string') return String(item).trim();
      return String(item && item.text != null ? item.text : item.prizeText || '').trim();
    }).filter(Boolean);
  }
  if (!name) throw new Error('Each tier needs a name.');
  if (!id) throw new Error('Each tier needs an id.');
  if (!items.length) throw new Error('Tier "' + name + '" needs at least one prize.');
  return { id, name, weight, sortOrder, active, items };
}

async function ensureSheetWithHeaders(sheetName, headers) {
  let data;
  try {
    data = await getSheetRows(sheetName, { skipCache: true });
  } catch (e) {
    const { google } = require('googleapis');
    const { SPREADSHEET_ID } = require('./config');
    const { getServiceAccountAuthOptions } = require('./googleCredentials');
    const authOpts = getServiceAccountAuthOptions(['https://www.googleapis.com/auth/spreadsheets']);
    const auth = new google.auth.GoogleAuth(authOpts);
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }]
      }
    });
    await appendRows(sheetName, [headers]);
    invalidateSheetRowsCache(sheetName);
    return false;
  }
  if (!data.length) {
    await appendRows(sheetName, [headers]);
    invalidateSheetRowsCache(sheetName);
    return false;
  }
  if (String(data[0][0]) !== headers[0]) {
    await updateRange(sheetName, 'A1', [headers]);
    invalidateSheetRowsCache(sheetName);
  }
  return data.length > 1;
}

async function seedDefaultLuckyDrawConfig() {
  const tierRows = [];
  const prizeRows = [];
  DEFAULT_LUCKY_DRAW_TIERS.forEach(function(tier, tierIndex) {
    tierRows.push([tier.id, tier.name, tier.weight, tierIndex + 1, 'Y']);
    tier.items.forEach(function(prizeText, prizeIndex) {
      prizeRows.push([tier.id, prizeText, prizeIndex + 1, 'Y']);
    });
  });
  await updateRange(LUCKY_DRAW_TIERS_SHEET, 'A2', tierRows);
  await updateRange(LUCKY_DRAW_PRIZES_SHEET, 'A2', prizeRows);
  invalidateSheetRowsCache(LUCKY_DRAW_TIERS_SHEET);
  invalidateSheetRowsCache(LUCKY_DRAW_PRIZES_SHEET);
}

async function ensureLuckyDrawConfigSheets() {
  const tiersHasData = await ensureSheetWithHeaders(LUCKY_DRAW_TIERS_SHEET, TIER_HEADERS);
  const prizesHasData = await ensureSheetWithHeaders(LUCKY_DRAW_PRIZES_SHEET, PRIZE_HEADERS);
  if (!tiersHasData || !prizesHasData) {
    await seedDefaultLuckyDrawConfig();
  }
}

async function getLuckyDrawConfig() {
  await ensureLuckyDrawConfigSheets();
  const tierData = await getSheetRows(LUCKY_DRAW_TIERS_SHEET, { skipCache: true });
  const prizeData = await getSheetRows(LUCKY_DRAW_PRIZES_SHEET, { skipCache: true });
  const prizesByTier = new Map();
  for (let i = 1; i < prizeData.length; i++) {
    const tierId = String(prizeData[i][0] || '').trim();
    const prizeText = String(prizeData[i][1] || '').trim();
    if (!tierId || !prizeText) continue;
    if (!isActiveFlag(prizeData[i][3])) continue;
    if (!prizesByTier.has(tierId)) prizesByTier.set(tierId, []);
    prizesByTier.get(tierId).push({
      text: prizeText,
      sortOrder: Number(prizeData[i][2]) || prizesByTier.get(tierId).length + 1
    });
  }
  const tiers = [];
  for (let i = 1; i < tierData.length; i++) {
    const id = String(tierData[i][0] || '').trim();
    if (!id) continue;
    const name = String(tierData[i][1] || '').trim();
    const weight = Math.max(0, Number(tierData[i][2]) || 0);
    const sortOrder = Number(tierData[i][3]) || tiers.length + 1;
    const active = isActiveFlag(tierData[i][4]);
    const prizeList = (prizesByTier.get(id) || []).sort(function(a, b) {
      return a.sortOrder - b.sortOrder;
    });
    tiers.push({
      id,
      name,
      weight,
      sortOrder,
      active,
      items: prizeList.map(function(p) { return p.text; })
    });
  }
  tiers.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
  return { tiers };
}

function getActiveClientTiers(config) {
  return (config.tiers || [])
    .filter(function(tier) {
      return tier.active !== false && tier.weight > 0 && tier.items && tier.items.length;
    })
    .map(function(tier) {
      return {
        id: tier.id,
        name: tier.name,
        weight: tier.weight,
        items: tier.items.slice()
      };
    });
}

async function replaceSheetDataRows(sheetName, bodyRows) {
  const existing = await getSheetRows(sheetName, { skipCache: true });
  if (bodyRows.length) {
    const lastCol = String.fromCharCode(64 + bodyRows[0].length);
    await updateRange(sheetName, 'A2:' + lastCol + (bodyRows.length + 1), bodyRows);
  }
  const targetLength = bodyRows.length + 1;
  if (existing.length > targetLength) {
    const toDelete = [];
    for (let row = targetLength + 1; row <= existing.length; row++) {
      toDelete.push(row);
    }
    await deleteRows(sheetName, toDelete);
  }
  invalidateSheetRowsCache(sheetName);
}

async function saveLuckyDrawConfig(tiersInput) {
  if (!Array.isArray(tiersInput) || !tiersInput.length) {
    throw new Error('At least one tier is required.');
  }
  await ensureLuckyDrawConfigSheets();
  const tiers = tiersInput.map(normalizeTierInput);
  const tierRows = tiers.map(function(tier, index) {
    return [tier.id, tier.name, tier.weight, tier.sortOrder || index + 1, tier.active ? 'Y' : 'N'];
  });
  const prizeRows = [];
  tiers.forEach(function(tier) {
    tier.items.forEach(function(prizeText, prizeIndex) {
      prizeRows.push([tier.id, prizeText, prizeIndex + 1, 'Y']);
    });
  });
  await replaceSheetDataRows(LUCKY_DRAW_TIERS_SHEET, tierRows);
  await replaceSheetDataRows(LUCKY_DRAW_PRIZES_SHEET, prizeRows);
  const config = await getLuckyDrawConfig();
  return {
    message: 'Lucky Draw prizes saved.',
    tiers: config.tiers,
    activeTiers: getActiveClientTiers(config)
  };
}

module.exports = {
  DEFAULT_LUCKY_DRAW_TIERS,
  ensureLuckyDrawConfigSheets,
  getLuckyDrawConfig,
  getActiveClientTiers,
  saveLuckyDrawConfig
};
