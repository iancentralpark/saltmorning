const { LUCKY_DRAW_SHEET, TIMEZONE, STUDENT_LIST_SHEET, LUCKY_DRAW_PURCHASE_COST } = require('./config');
const { getSheetRows, appendRows, deleteRows, updateRange, invalidateSheetRowsCache } = require('./sheets');
const { formatDateTimeNow } = require('./dateUtils');
const { getStudentDollarBalance, applyDollarAdjustment } = require('./dollarService');
const { invalidateWorkCache } = require('./workCacheService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

/** Student ticket upgrade ladder (same-tier fuse). */
const FUSION_RECIPES = [
  { from: 'Weird', need: 3, to: 'Common' },
  { from: 'Common', need: 3, to: 'Rare' },
  { from: 'Rare', need: 3, to: 'Unique' },
  { from: 'Unique', need: 3, to: 'Legendary' },
  { from: 'Legendary', need: 3, to: 'Mythical' },
  { from: 'Mythical', need: 2, to: 'Celestial' },
  { from: 'Celestial', need: 2, to: 'Godlike' }
];

const FUSION_PRIZE_FALLBACKS = {
  Common: ['1 Haribo', '2 Haribos', 'Bathroom/Water Priority', '1 Vocab Hint', 'Free Stationery Rental', '5% Vocab Magic Pass', '3 Haribos'],
  Rare: ['10% Vocab Magic Pass', '2 Vocab Hints', '1 Minute more vocab test', 'Handshake with Mr. Park', "Mr. Park's Silly Face", '5 Haribos'],
  Unique: ['15% Vocab Magic Pass', 'High-five with Mr. Park', '1 Minute Timestone', '1 Day Chambit Pass', 'Combo Shield', 'Wrong Answer Eraser'],
  Legendary: ['20% Vocab Magic Pass', '2 Minutes Freedom Bell', '2 Minutes Timestone', "The King's Throne"],
  Mythical: ['Name The Teacher', '3 Minutes Freedom Bell', 'Be a Commander!', '3 Minutes Timestone'],
  Celestial: ['Starlight Pass', '4 Minutes Freedom Bell', 'Celestial Timestone', 'Orbit Seat'],
  Godlike: ['The Forbidden Word', '5 Minutes Freedom Bell', 'Double Dollars']
};

function afterLuckyDrawWrite(classId) {
  if (classId) invalidateWorkCache(classId);
  invalidateSheetRowsCache(LUCKY_DRAW_SHEET);
}

function normalizeTierName(tier) {
  return String(tier || '').trim();
}

/** Map display variants (e.g. "God Like") onto ladder names. */
function canonicalTierName(tier) {
  const key = normalizeTierName(tier).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const aliases = {
    weird: 'Weird',
    common: 'Common',
    rare: 'Rare',
    unique: 'Unique',
    legendary: 'Legendary',
    mythical: 'Mythical',
    celestial: 'Celestial',
    godlike: 'Godlike',
    'god like': 'Godlike'
  };
  return aliases[key] || normalizeTierName(tier);
}

function findFusionRecipe(fromTier) {
  const want = canonicalTierName(fromTier).toLowerCase();
  return FUSION_RECIPES.find(function(r) {
    return r.from.toLowerCase() === want;
  }) || null;
}

function listFusionRecipes() {
  return FUSION_RECIPES.map(function(r) {
    return { from: r.from, need: r.need, to: r.to };
  });
}

function groupLuckyTickets(tickets) {
  const map = new Map();
  const order = [];
  for (const t of tickets) {
    const key = String(t.tier || '').trim() + '\0' + String(t.prizeText || '').trim();
    if (!map.has(key)) {
      map.set(key, {
        tier: t.tier,
        prizeText: t.prizeText,
        count: 0,
        ticketIds: [],
        drawnAt: t.drawnAt || ''
      });
      order.push(key);
    }
    const g = map.get(key);
    g.count += 1;
    g.ticketIds.push(t.ticketId);
    if ((t.drawnAt || '') > (g.drawnAt || '')) g.drawnAt = t.drawnAt;
  }
  return order.map((k) => map.get(k));
}

async function ensureLuckyDrawSheet() {
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) return;
  let data;
  try {
    data = await getSheetRows(LUCKY_DRAW_SHEET);
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
        requests: [{ addSheet: { properties: { title: LUCKY_DRAW_SHEET } } }]
      }
    });
    await appendRows(LUCKY_DRAW_SHEET, [[
      'TicketID', 'ClassID', 'StudentID', 'Tier', 'PrizeText', 'DrawnAt'
    ]]);
    return;
  }
  if (!data.length || String(data[0][0]) !== 'TicketID') {
    if (!data.length) {
      await appendRows(LUCKY_DRAW_SHEET, [[
        'TicketID', 'ClassID', 'StudentID', 'Tier', 'PrizeText', 'DrawnAt'
      ]]);
    }
  }
}

async function saveLuckyDrawTicket(classId, studentId, tier, prizeText) {
  await ensureLuckyDrawSheet();
  classId = String(classId);
  studentId = String(studentId);
  tier = String(tier || '').trim();
  prizeText = String(prizeText || '').trim();
  if (!classId || !studentId || !prizeText) {
    throw new Error('classId, studentId, and prize are required.');
  }
  const ticketId = 'LDT_' + classId + '_' + studentId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const drawnAt = formatDateTimeNow(TIMEZONE);
  await appendRows(LUCKY_DRAW_SHEET, [[ticketId, classId, studentId, tier, prizeText, drawnAt]]);
  afterLuckyDrawWrite(classId);
  const ticketCount = await countStudentTickets(classId, studentId);
  return { ticketId, tier, prizeText, drawnAt, ticketCount };
}

async function purchaseLuckyDrawTicket(classId, studentId, tier, prizeText, cost) {
  cost = Number(cost);
  if (!Number.isFinite(cost) || cost <= 0) {
    cost = LUCKY_DRAW_PURCHASE_COST;
  }
  classId = String(classId);
  studentId = String(studentId);
  await assertStudentInClass_(classId, studentId);
  const balance = await getStudentDollarBalance(studentId);
  if (balance < cost) {
    const err = new Error('Not enough dollars. Lucky Draw costs $' + cost + ' (balance: $' + balance + ').');
    err.code = 'INSUFFICIENT_DOLLARS';
    err.balance = balance;
    err.cost = cost;
    throw err;
  }
  const { newBalance } = await applyDollarAdjustment(
    classId,
    studentId,
    -cost,
    'Lucky Draw purchase ($' + cost + ')'
  );
  const ticket = await saveLuckyDrawTicket(classId, studentId, tier, prizeText);
  return {
    ticket,
    cost,
    previousBalance: balance,
    newBalance,
    ticketCount: ticket.ticketCount
  };
}

async function listStudentLuckyTickets(classId, studentId) {
  await ensureLuckyDrawSheet();
  classId = String(classId);
  studentId = String(studentId);
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  const tickets = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId || String(data[i][2]) !== studentId) continue;
    tickets.push({
      ticketId: String(data[i][0]),
      classId,
      studentId,
      tier: String(data[i][3] || ''),
      prizeText: String(data[i][4] || ''),
      drawnAt: String(data[i][5] || '')
    });
  }
  tickets.sort((a, b) => (a.drawnAt < b.drawnAt ? 1 : a.drawnAt > b.drawnAt ? -1 : 0));
  return tickets;
}

async function redeemLuckyTicket(ticketId) {
  await ensureLuckyDrawSheet();
  ticketId = String(ticketId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error: readErr } = await db.from('lucky_draw_tickets')
      .select('class_id, student_id')
      .eq('ticket_id', ticketId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!data) throw new Error('Ticket not found.');
    const classId = String(data.class_id);
    const studentId = String(data.student_id);
    const { error } = await db.from('lucky_draw_tickets').delete().eq('ticket_id', ticketId);
    if (error) throw new Error(error.message);
    afterLuckyDrawWrite(classId);
    return {
      message: 'Ticket removed.',
      ticketId,
      studentId,
      remainingCount: await countStudentTickets(classId, studentId)
    };
  }
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === ticketId) {
      const classId = String(data[i][1]);
      const studentId = String(data[i][2]);
      await deleteRows(LUCKY_DRAW_SHEET, [i + 1]);
      afterLuckyDrawWrite(classId);
      return {
        message: 'Ticket removed.',
        ticketId,
        studentId,
        remainingCount: await countStudentTickets(classId, studentId)
      };
    }
  }
  throw new Error('Ticket not found.');
}

async function countStudentTickets(classId, studentId) {
  const tickets = await listStudentLuckyTickets(classId, studentId);
  return tickets.length;
}

async function findTicketRow_(ticketId) {
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === ticketId) {
      return {
        row: i + 1,
        ticketId: String(data[i][0]),
        classId: String(data[i][1]),
        studentId: String(data[i][2]),
        tier: String(data[i][3] || ''),
        prizeText: String(data[i][4] || ''),
        drawnAt: String(data[i][5] || '')
      };
    }
  }
  return null;
}

async function assertStudentInClass_(classId, studentId) {
  classId = String(classId);
  studentId = String(studentId);
  const data = await getSheetRows(STUDENT_LIST_SHEET);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== studentId) continue;
    if (String(data[i][2]) !== classId) {
      throw new Error('Student is not in this class.');
    }
    if (String(data[i][3] || '').trim() !== 'Enrolled') {
      throw new Error('Student is not enrolled.');
    }
    return String(data[i][1] || studentId);
  }
  throw new Error('Student not found.');
}

async function transferLuckyTicket(ticketId, toStudentId) {
  await ensureLuckyDrawSheet();
  ticketId = String(ticketId);
  toStudentId = String(toStudentId);
  const row = await findTicketRow_(ticketId);
  if (!row) throw new Error('Ticket not found.');
  if (row.studentId === toStudentId) {
    throw new Error('This student already owns the ticket.');
  }
  await assertStudentInClass_(row.classId, toStudentId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('lucky_draw_tickets').update({ student_id: toStudentId }).eq('ticket_id', ticketId);
    if (error) throw new Error(error.message);
  } else {
    await updateRange(LUCKY_DRAW_SHEET, 'C' + row.row, [[toStudentId]]);
  }
  afterLuckyDrawWrite(row.classId);
  return {
    message: 'Ticket transferred.',
    ticketId,
    classId: row.classId,
    fromStudentId: row.studentId,
    toStudentId,
    tier: row.tier,
    prizeText: row.prizeText,
    fromRemainingCount: await countStudentTickets(row.classId, row.studentId),
    toRemainingCount: await countStudentTickets(row.classId, toStudentId)
  };
}

async function getLuckyDrawCountsByClass(classId) {
  await ensureLuckyDrawSheet();
  classId = String(classId);
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  const counts = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId) continue;
    const sid = String(data[i][2]);
    counts[sid] = (counts[sid] || 0) + 1;
  }
  return counts;
}

async function deleteLuckyTicketsOwned_(classId, studentId, ticketIds) {
  classId = String(classId);
  studentId = String(studentId);
  const idSet = new Set(ticketIds.map(String));
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error: readErr } = await db.from('lucky_draw_tickets')
      .select('ticket_id, class_id, student_id, tier')
      .in('ticket_id', Array.from(idSet));
    if (readErr) throw new Error(readErr.message);
    const rows = data || [];
    if (rows.length !== idSet.size) throw new Error('One or more tickets were not found.');
    for (const row of rows) {
      if (String(row.class_id) !== classId || String(row.student_id) !== studentId) {
        throw new Error('You can only upgrade your own tickets.');
      }
    }
    const { error } = await db.from('lucky_draw_tickets').delete().in('ticket_id', Array.from(idSet));
    if (error) throw new Error(error.message);
    afterLuckyDrawWrite(classId);
    return rows.map(function(row) {
      return { ticketId: String(row.ticket_id), tier: String(row.tier || '') };
    });
  }

  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  const matched = [];
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const tid = String(data[i][0]);
    if (!idSet.has(tid)) continue;
    if (String(data[i][1]) !== classId || String(data[i][2]) !== studentId) {
      throw new Error('You can only upgrade your own tickets.');
    }
    matched.push({ ticketId: tid, tier: String(data[i][3] || '') });
    rowsToDelete.push(i + 1);
  }
  if (matched.length !== idSet.size) throw new Error('One or more tickets were not found.');
  rowsToDelete.sort(function(a, b) { return b - a; });
  await deleteRows(LUCKY_DRAW_SHEET, rowsToDelete);
  afterLuckyDrawWrite(classId);
  return matched;
}

async function pickPrizeForTier_(tierName) {
  const want = canonicalTierName(tierName).toLowerCase();
  try {
    const { getLuckyDrawConfig } = require('./luckyDrawConfigService');
    const config = await getLuckyDrawConfig();
    const tier = (config.tiers || []).find(function(t) {
      return canonicalTierName(t.name).toLowerCase() === want
        && t.active !== false
        && Array.isArray(t.items)
        && t.items.length;
    });
    if (tier) {
      return {
        tierName: String(tier.name || canonicalTierName(tierName)),
        prizeText: tier.items[Math.floor(Math.random() * tier.items.length)]
      };
    }
  } catch (e) { /* fall through */ }
  const canon = canonicalTierName(tierName);
  const fallback = FUSION_PRIZE_FALLBACKS[canon] || ['Mystery Prize'];
  return {
    tierName: canon,
    prizeText: fallback[Math.floor(Math.random() * fallback.length)]
  };
}

/**
 * Fuse N same-tier tickets into one higher-tier ticket (student self-service).
 * @param {string[]} ticketIds
 */
async function fuseLuckyTickets(classId, studentId, ticketIds) {
  classId = String(classId);
  studentId = String(studentId);
  if (!Array.isArray(ticketIds) || !ticketIds.length) {
    throw new Error('Select tickets to upgrade.');
  }
  const uniqueIds = Array.from(new Set(ticketIds.map(String).filter(Boolean)));
  if (uniqueIds.length !== ticketIds.length) {
    throw new Error('Duplicate ticket selected.');
  }

  const owned = await listStudentLuckyTickets(classId, studentId);
  const byId = new Map(owned.map(function(t) { return [String(t.ticketId), t]; }));
  const selected = uniqueIds.map(function(id) {
    const t = byId.get(id);
    if (!t) throw new Error('Ticket not found: ' + id);
    return t;
  });

  const fromTier = selected.map(function(t) { return canonicalTierName(t.tier); });
  const baseTier = fromTier[0];
  if (!baseTier) throw new Error('Ticket tier is missing.');
  for (let i = 1; i < fromTier.length; i++) {
    if (fromTier[i].toLowerCase() !== baseTier.toLowerCase()) {
      throw new Error('All selected tickets must be the same tier.');
    }
  }

  const recipe = findFusionRecipe(baseTier);
  if (!recipe) {
    throw new Error(baseTier + ' tickets cannot be upgraded further.');
  }
  if (uniqueIds.length !== recipe.need) {
    throw new Error('Select exactly ' + recipe.need + ' ' + recipe.from + ' ticket' + (recipe.need === 1 ? '' : 's') + ' to make 1 ' + recipe.to + '.');
  }

  await deleteLuckyTicketsOwned_(classId, studentId, uniqueIds);
  const picked = await pickPrizeForTier_(recipe.to);
  const ticket = await saveLuckyDrawTicket(classId, studentId, picked.tierName, picked.prizeText);
  const remaining = await listStudentLuckyTickets(classId, studentId);

  return {
    message: recipe.need + ' ' + recipe.from + ' → 1 ' + recipe.to + '!',
    consumed: uniqueIds,
    fromTier: recipe.from,
    toTier: recipe.to,
    need: recipe.need,
    ticket: {
      ticketId: ticket.ticketId,
      tier: ticket.tier,
      prizeText: ticket.prizeText,
      drawnAt: ticket.drawnAt
    },
    ticketCount: ticket.ticketCount,
    luckyDraw: {
      totalCount: remaining.length,
      tickets: groupLuckyTickets(remaining)
    },
    recipes: listFusionRecipes()
  };
}

async function executeUnluckyDraw(classId, studentId, opts) {
  opts = opts || {};
  classId = String(classId || '');
  studentId = String(studentId || '');
  if (!classId || !studentId) {
    throw new Error('classId and studentId are required.');
  }
  await assertStudentInClass_(classId, studentId);

  const tickets = await listStudentLuckyTickets(classId, studentId);
  const balance = await getStudentDollarBalance(studentId);

  if (tickets.length > 0) {
    const pick = tickets[Math.floor(Math.random() * tickets.length)];
    const redeemed = await redeemLuckyTicket(pick.ticketId);
    return {
      mode: 'ticket',
      ticket: {
        ticketId: pick.ticketId,
        tier: pick.tier,
        prizeText: pick.prizeText,
        drawnAt: pick.drawnAt
      },
      remainingCount: redeemed.remainingCount,
      dollars: balance,
      message: 'Ticket destroyed.'
    };
  }

  const minSteal = Number.isFinite(Number(opts.minSteal)) ? Math.max(1, Number(opts.minSteal)) : 2;
  const maxSteal = Number.isFinite(Number(opts.maxSteal)) ? Math.max(minSteal, Number(opts.maxSteal)) : 5;
  const rolled = minSteal + Math.floor(Math.random() * (maxSteal - minSteal + 1));
  const allowNegative = !!opts.allowNegative;
  const amount = allowNegative ? rolled : Math.min(rolled, Math.max(0, balance));
  if (amount <= 0) {
    return {
      mode: 'dollars',
      amount: 0,
      rolled,
      previousBalance: balance,
      newBalance: balance,
      remainingCount: 0,
      message: 'No tickets and no dollars to steal.'
    };
  }

  const { newBalance } = await applyDollarAdjustment(
    classId,
    studentId,
    -amount,
    'Unlucky Draw penalty (−$' + amount + ')'
  );
  return {
    mode: 'dollars',
    amount,
    rolled,
    previousBalance: balance,
    newBalance,
    remainingCount: 0,
    message: 'Dollars stolen by the shadows.'
  };
}

module.exports = {
  FUSION_RECIPES,
  groupLuckyTickets,
  saveLuckyDrawTicket,
  purchaseLuckyDrawTicket,
  listStudentLuckyTickets,
  redeemLuckyTicket,
  transferLuckyTicket,
  getLuckyDrawCountsByClass,
  countStudentTickets,
  findFusionRecipe,
  listFusionRecipes,
  fuseLuckyTickets,
  executeUnluckyDraw
};
