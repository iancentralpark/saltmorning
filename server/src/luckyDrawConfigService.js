const {
  LUCKY_DRAW_TIERS_SHEET,
  LUCKY_DRAW_PRIZES_SHEET
} = require('./config');
const { getSheetRows, appendRows, updateRange, deleteRows, invalidateSheetRowsCache } = require('./sheets');

const TIER_HEADERS = ['TierID', 'TierName', 'Weight', 'SortOrder', 'Active'];
const PRIZE_HEADERS = ['TierID', 'PrizeText', 'SortOrder', 'Active'];

const DEFAULT_LUCKY_DRAW_TIERS = [
  {
    id: 'weird',
    name: 'Weird',
    weight: 28,
    items: ['Weird Sticker', '1 Tiny Haribo', '10-Second Dance', 'Funny Face Challenge', 'Mystery Marble']
  },
  {
    id: 'common',
    name: 'Common',
    weight: 25,
    items: ['1 Haribo', '2 Haribos', 'Bathroom/Water Priority', '1 Vocab Hint', 'Free Stationery Rental', '5% Vocab Magic Pass', '3 Haribos']
  },
  {
    id: 'rare',
    name: 'Rare',
    weight: 18,
    items: ['10% Vocab Magic Pass', '2 Vocab Hints', '1 Minute more vocab test', 'Handshake with Mr. Park', "Mr. Park's Silly Face", '5 Haribos']
  },
  {
    id: 'unique',
    name: 'Unique',
    weight: 12,
    items: ['15% Vocab Magic Pass', 'High-five with Mr. Park', '1 Minute Timestone', '1 Day Chambit Pass', 'Combo Shield', 'Wrong Answer Eraser']
  },
  {
    id: 'legendary',
    name: 'Legendary',
    weight: 8,
    items: ['20% Vocab Magic Pass', '2 Minutes Freedom Bell', '2 Minutes Timestone', "The King's Throne"]
  },
  {
    id: 'mythical',
    name: 'Mythical',
    weight: 4,
    items: ['Name The Teacher', '3 Minutes Freedom Bell', 'Be a Commander!', '3 Minutes Timestone']
  },
  {
    id: 'celestial',
    name: 'Celestial',
    weight: 2,
    items: ['Starlight Pass', '4 Minutes Freedom Bell', 'Celestial Timestone', 'Orbit Seat']
  },
  {
    id: 'godlike',
    name: 'Godlike',
    weight: 1,
    items: ['The Forbidden Word', '5 Minutes Freedom Bell', 'Double Dollars']
  }
];

/** Tiers required for the upgrade ladder — appended if missing without rewriting existing weights. */
const LADDER_ENSURE_TIERS = [
  {
    id: 'weird',
    name: 'Weird',
    weight: 28,
    sortOrder: 0,
    items: ['Weird Sticker', '1 Tiny Haribo', '10-Second Dance', 'Funny Face Challenge', 'Mystery Marble']
  },
  {
    id: 'celestial',
    name: 'Celestial',
    weight: 2,
    sortOrder: 65,
    items: ['Starlight Pass', '4 Minutes Freedom Bell', 'Celestial Timestone', 'Orbit Seat']
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
  const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    if (sheetName === LUCKY_DRAW_TIERS_SHEET) {
      const { count } = await db.from('lucky_draw_tiers').select('*', { count: 'exact', head: true });
      return (count || 0) > 0;
    }
    if (sheetName === LUCKY_DRAW_PRIZES_SHEET) {
      const { count } = await db.from('lucky_draw_prizes').select('*', { count: 'exact', head: true });
      return (count || 0) > 0;
    }
    return true;
  }
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

async function appendMissingLadderTiers_(existingTiers) {
  const byId = new Set((existingTiers || []).map(function(t) { return String(t.id || '').toLowerCase(); }));
  const byName = new Set((existingTiers || []).map(function(t) { return String(t.name || '').trim().toLowerCase(); }));
  const missing = LADDER_ENSURE_TIERS.filter(function(tier) {
    return !byId.has(tier.id.toLowerCase()) && !byName.has(tier.name.toLowerCase());
  });
  if (!missing.length) return false;

  const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const tierPayload = missing.map(function(tier) {
      return {
        tier_id: tier.id,
        tier_name: tier.name,
        weight: tier.weight,
        sort_order: tier.sortOrder,
        active: true
      };
    });
    const { error: tierErr } = await db.from('lucky_draw_tiers').upsert(tierPayload, { onConflict: 'tier_id' });
    if (tierErr) throw new Error(tierErr.message);
    const prizePayload = [];
    missing.forEach(function(tier) {
      tier.items.forEach(function(prizeText, prizeIndex) {
        prizePayload.push({
          tier_id: tier.id,
          prize_text: prizeText,
          sort_order: prizeIndex + 1,
          active: true
        });
      });
    });
    if (prizePayload.length) {
      const { error: prizeErr } = await db.from('lucky_draw_prizes').upsert(prizePayload, {
        onConflict: 'tier_id,sort_order'
      });
      if (prizeErr) {
        // Fallback: insert ignoring conflicts on older schemas
        const { error: insErr } = await db.from('lucky_draw_prizes').insert(prizePayload);
        if (insErr && !/duplicate|unique/i.test(insErr.message || '')) throw new Error(insErr.message);
      }
    }
  } else {
    const tierRows = missing.map(function(tier) {
      return [tier.id, tier.name, tier.weight, tier.sortOrder, 'Y'];
    });
    const prizeRows = [];
    missing.forEach(function(tier) {
      tier.items.forEach(function(prizeText, prizeIndex) {
        prizeRows.push([tier.id, prizeText, prizeIndex + 1, 'Y']);
      });
    });
    if (tierRows.length) await appendRows(LUCKY_DRAW_TIERS_SHEET, tierRows);
    if (prizeRows.length) await appendRows(LUCKY_DRAW_PRIZES_SHEET, prizeRows);
  }
  invalidateSheetRowsCache(LUCKY_DRAW_TIERS_SHEET);
  invalidateSheetRowsCache(LUCKY_DRAW_PRIZES_SHEET);
  return true;
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
  if (await appendMissingLadderTiers_(tiers)) {
    return getLuckyDrawConfig();
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

async function saveLuckyDrawConfigSupabase(tiers) {
  const { getSupabase } = require('./supabaseClient');
  const db = getSupabase();
  if (!db) throw new Error('Supabase is not configured.');

  const tierIds = tiers.map(function(tier) { return tier.id; });
  const seenIds = new Set();
  for (const id of tierIds) {
    if (seenIds.has(id)) throw new Error('Duplicate tier id: ' + id);
    seenIds.add(id);
  }

  const { data: oldTiers, error: loadErr } = await db.from('lucky_draw_tiers').select('tier_id');
  if (loadErr) throw new Error(loadErr.message);

  const removeIds = (oldTiers || [])
    .map(function(row) { return String(row.tier_id || ''); })
    .filter(function(id) { return id && !seenIds.has(id); });

  if (removeIds.length) {
    const { error } = await db.from('lucky_draw_tiers').delete().in('tier_id', removeIds);
    if (error) throw new Error(error.message);
  }

  const tierPayload = tiers.map(function(tier, index) {
    return {
      tier_id: tier.id,
      tier_name: tier.name,
      weight: tier.weight,
      sort_order: tier.sortOrder || index + 1,
      active: tier.active
    };
  });
  const { error: tierErr } = await db.from('lucky_draw_tiers').upsert(tierPayload, { onConflict: 'tier_id' });
  if (tierErr) throw new Error(tierErr.message);

  const { error: prizeDelErr } = await db.from('lucky_draw_prizes').delete().in('tier_id', tierIds);
  if (prizeDelErr) throw new Error(prizeDelErr.message);

  const prizePayload = [];
  tiers.forEach(function(tier) {
    tier.items.forEach(function(prizeText, prizeIndex) {
      prizePayload.push({
        tier_id: tier.id,
        prize_text: prizeText,
        sort_order: prizeIndex + 1,
        active: true
      });
    });
  });
  if (prizePayload.length) {
    const { error: prizeErr } = await db.from('lucky_draw_prizes').insert(prizePayload);
    if (prizeErr) throw new Error(prizeErr.message);
  }

  invalidateSheetRowsCache(LUCKY_DRAW_TIERS_SHEET);
  invalidateSheetRowsCache(LUCKY_DRAW_PRIZES_SHEET);
}

async function saveLuckyDrawConfig(tiersInput) {
  if (!Array.isArray(tiersInput) || !tiersInput.length) {
    throw new Error('At least one tier is required.');
  }
  await ensureLuckyDrawConfigSheets();
  const tiers = tiersInput.map(normalizeTierInput);

  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    await saveLuckyDrawConfigSupabase(tiers);
  } else {
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
  }

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
