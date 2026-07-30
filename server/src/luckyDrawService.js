const {
  LUCKY_DRAW_SHEET,
  LUCKY_DRAW_TRANSFERS_SHEET,
  TIMEZONE,
  STUDENT_LIST_SHEET,
  LUCKY_DRAW_PURCHASE_COST,
  LUCKY_STUDENT_SPIN_DAILY_LIMIT,
  DOLLAR_SHEETS
} = require('./config');
const { getSheetRows, appendRows, deleteRows, updateRange, invalidateSheetRowsCache } = require('./sheets');
const { formatDateTimeNow, formatDateInTz } = require('./dateUtils');
const { cacheDeletePrefix } = require('./cache');
const { getStudentDollarBalance, applyDollarAdjustment } = require('./dollarService');
const { invalidateWorkCache } = require('./workCacheService');
const { isSupabaseEnabled, getSupabase } = require('./supabaseClient');

/** Ticket lifetime from birth (draw / grant / fuse). */
const LUCKY_TICKET_TTL_DAYS = 90;
const LUCKY_TICKET_TTL_MS = LUCKY_TICKET_TTL_DAYS * 24 * 60 * 60 * 1000;
const STUDENT_LUCKY_SPIN_REASON = 'Student Lucky Draw ($' + LUCKY_DRAW_PURCHASE_COST + ')';

/**
 * Unlucky Draw destroy weights — Legendary+ slightly more likely than Weird/Common.
 * Relative only among owned tickets.
 */
const UNLUCKY_DESTROY_WEIGHT = {
  Weird: 1,
  Common: 1,
  Rare: 1.15,
  Unique: 1.3,
  Legendary: 1.55,
  Mythical: 1.7,
  Celestial: 1.85,
  Godlike: 2
};

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
  if (classId) cacheDeletePrefix('sidebar_v1_' + String(classId));
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

/** Parse DrawnAt ("yyyy-MM-dd HH:mm:ss" or ISO) → epoch ms (Asia/Seoul wall clock). */
function parseLuckyDrawnAtMs(drawnAt) {
  const s = String(drawnAt || '').trim();
  if (!s) return NaN;
  // Already timezone-aware (Supabase TIMESTAMPTZ / ISO)
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s) || s.indexOf('T') >= 0 && /[zZ]|[+-]\d{2}/.test(s)) {
    const ms = Date.parse(s);
    if (!isNaN(ms)) return ms;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const hh = m[4] != null ? m[4] : '00';
    const mm = m[5] != null ? m[5] : '00';
    const ss = m[6] != null ? m[6] : '00';
    // DrawnAt from formatDateTimeNow is Seoul local without offset; pin +09:00.
    const ms = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + hh + ':' + mm + ':' + ss + '+09:00');
    if (!isNaN(ms)) return ms;
  }
  const d = new Date(s);
  return d.getTime();
}

function computeLuckyExpiresAtMs(drawnAt) {
  const born = parseLuckyDrawnAtMs(drawnAt);
  if (isNaN(born)) return NaN;
  return born + LUCKY_TICKET_TTL_MS;
}

function formatLuckyExpiresAt(drawnAt) {
  const expMs = computeLuckyExpiresAtMs(drawnAt);
  if (isNaN(expMs)) return '';
  return formatDateInTz(new Date(expMs), TIMEZONE);
}

function luckyExpiresInDays(drawnAt, nowMs) {
  const expMs = computeLuckyExpiresAtMs(drawnAt);
  if (isNaN(expMs)) return null;
  const now = nowMs != null ? nowMs : Date.now();
  return Math.ceil((expMs - now) / (24 * 60 * 60 * 1000));
}

function isLuckyTicketExpired(ticketOrDrawnAt, nowMs) {
  const drawnAt =
    ticketOrDrawnAt && typeof ticketOrDrawnAt === 'object'
      ? ticketOrDrawnAt.drawnAt
      : ticketOrDrawnAt;
  const born = parseLuckyDrawnAtMs(drawnAt);
  // Missing/unparseable birth date: keep ticket (legacy safety)
  if (isNaN(born)) return false;
  const now = nowMs != null ? nowMs : Date.now();
  return now >= born + LUCKY_TICKET_TTL_MS;
}

function enrichLuckyTicket(ticket, nowMs) {
  const drawnAt = String((ticket && ticket.drawnAt) || '');
  const expiresAt = formatLuckyExpiresAt(drawnAt);
  const expiresInDays = luckyExpiresInDays(drawnAt, nowMs);
  return Object.assign({}, ticket, {
    expiresAt: expiresAt,
    expiresInDays: expiresInDays,
    ttlDays: LUCKY_TICKET_TTL_DAYS
  });
}

function groupLuckyTickets(tickets) {
  const map = new Map();
  const order = [];
  const nowMs = Date.now();
  for (const raw of tickets) {
    const t = enrichLuckyTicket(raw, nowMs);
    const key = String(t.tier || '').trim() + '\0' + String(t.prizeText || '').trim();
    if (!map.has(key)) {
      map.set(key, {
        tier: t.tier,
        prizeText: t.prizeText,
        count: 0,
        ticketIds: [],
        drawnAt: t.drawnAt || '',
        expiresAt: t.expiresAt || '',
        expiresInDays: t.expiresInDays,
        ttlDays: LUCKY_TICKET_TTL_DAYS
      });
      order.push(key);
    }
    const g = map.get(key);
    g.count += 1;
    g.ticketIds.push(t.ticketId);
    if ((t.drawnAt || '') > (g.drawnAt || '')) g.drawnAt = t.drawnAt;
    // Show soonest expiry in the stack so teachers/students use oldest first
    if (t.expiresAt && (!g.expiresAt || t.expiresAt < g.expiresAt)) {
      g.expiresAt = t.expiresAt;
      g.expiresInDays = t.expiresInDays;
    }
  }
  return order.map((k) => map.get(k));
}

// NOTE: Expiry must never delete rows. Expired tickets are hidden from listings
// and rejected on use, but the row stays so a bad expiry calculation can only
// hide tickets temporarily instead of destroying them permanently.

/**
 * Copy tickets into the append-only archive before they are deleted, so any
 * loss stays traceable and restorable. Must run before the DELETE, and must
 * never let a logging failure silently drop the record.
 * @param {Array<{ticketId:string,classId:string,studentId:string,tier:string,prizeText:string,drawnAt:*}>} tickets
 */
async function archiveLuckyTickets_(tickets, reason, opts) {
  opts = opts || {};
  const rows = (Array.isArray(tickets) ? tickets : []).filter(Boolean);
  if (!rows.length) return;
  if (!isSupabaseEnabled()) return;
  const db = getSupabase();
  const payload = rows.map(function(t) {
    const bornMs = parseLuckyDrawnAtMs(t.drawnAt);
    return {
      ticket_id: String(t.ticketId || ''),
      class_id: String(t.classId || ''),
      student_id: String(t.studentId || ''),
      tier: String(t.tier || ''),
      prize_text: String(t.prizeText || ''),
      drawn_at: isNaN(bornMs) ? null : new Date(bornMs).toISOString(),
      reason: String(reason || 'unknown'),
      actor_type: String(opts.actorType || ''),
      actor_student_id: opts.actorStudentId ? String(opts.actorStudentId) : null
    };
  });
  const { error } = await db.from('lucky_draw_ticket_archive').insert(payload);
  if (error) throw new Error('Could not record ticket deletion: ' + error.message);
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
  const expiresAt = formatLuckyExpiresAt(drawnAt);
  await appendRows(LUCKY_DRAW_SHEET, [[ticketId, classId, studentId, tier, prizeText, drawnAt]]);
  afterLuckyDrawWrite(classId);
  const ticketCount = await countStudentTickets(classId, studentId);
  return {
    ticketId,
    tier,
    prizeText,
    drawnAt,
    expiresAt: expiresAt,
    expiresInDays: luckyExpiresInDays(drawnAt),
    ttlDays: LUCKY_TICKET_TTL_DAYS,
    ticketCount
  };
}

async function purchaseLuckyDrawTicket(classId, studentId, tier, prizeText, cost, opts) {
  opts = opts || {};
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
  const reason = String(opts.reason || ('Lucky Draw purchase ($' + cost + ')')).trim();
  const { newBalance } = await applyDollarAdjustment(classId, studentId, -cost, reason);
  const ticket = await saveLuckyDrawTicket(classId, studentId, tier, prizeText);
  return {
    ticket,
    cost,
    previousBalance: balance,
    newBalance,
    ticketCount: ticket.ticketCount
  };
}

async function ensureLuckyTransferSheet_() {
  if (isSupabaseEnabled()) return;
  const data = await getSheetRows(LUCKY_DRAW_TRANSFERS_SHEET);
  if (!data.length || String(data[0][0]) !== 'TransferID') {
    if (!data.length) {
      await appendRows(LUCKY_DRAW_TRANSFERS_SHEET, [[
        'TransferID', 'TransferredAt', 'ClassID', 'TicketID', 'FromStudentID', 'ToStudentID',
        'Tier', 'PrizeText', 'ActorType', 'ActorStudentID'
      ]]);
    }
  }
}

async function logLuckyTransfer_(entry) {
  const transferId = String(entry.transferId || ('LDX_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)));
  const at = entry.transferredAt || formatDateTimeNow(TIMEZONE);
  const row = {
    transferId: transferId,
    transferredAt: at,
    classId: String(entry.classId || ''),
    ticketId: String(entry.ticketId || ''),
    fromStudentId: String(entry.fromStudentId || ''),
    toStudentId: String(entry.toStudentId || ''),
    tier: String(entry.tier || ''),
    prizeText: String(entry.prizeText || ''),
    actorType: String(entry.actorType || 'teacher'),
    actorStudentId: entry.actorStudentId != null ? String(entry.actorStudentId) : ''
  };
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('lucky_draw_transfers').insert({
      transfer_id: row.transferId,
      transferred_at: new Date().toISOString(),
      class_id: row.classId,
      ticket_id: row.ticketId,
      from_student_id: row.fromStudentId,
      to_student_id: row.toStudentId,
      tier: row.tier,
      prize_text: row.prizeText,
      actor_type: row.actorType,
      actor_student_id: row.actorStudentId || null
    });
    if (error) throw new Error(error.message);
    return row;
  }
  await ensureLuckyTransferSheet_();
  await appendRows(LUCKY_DRAW_TRANSFERS_SHEET, [[
    row.transferId, row.transferredAt, row.classId, row.ticketId,
    row.fromStudentId, row.toStudentId, row.tier, row.prizeText,
    row.actorType, row.actorStudentId
  ]]);
  invalidateSheetRowsCache(LUCKY_DRAW_TRANSFERS_SHEET);
  return row;
}

async function listLuckyTransfersForClass(classId, opts) {
  opts = opts || {};
  classId = String(classId || '');
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 40));
  const studentId = opts.studentId != null ? String(opts.studentId) : '';
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    let q = db.from('lucky_draw_transfers')
      .select('transfer_id, transferred_at, class_id, ticket_id, from_student_id, to_student_id, tier, prize_text, actor_type, actor_student_id')
      .eq('class_id', classId)
      .order('transferred_at', { ascending: false })
      .limit(limit * 2);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    let rows = (data || []).map(function(r) {
      return {
        transferId: String(r.transfer_id),
        transferredAt: r.transferred_at ? String(r.transferred_at) : '',
        classId: String(r.class_id || ''),
        ticketId: String(r.ticket_id || ''),
        fromStudentId: String(r.from_student_id || ''),
        toStudentId: String(r.to_student_id || ''),
        tier: String(r.tier || ''),
        prizeText: String(r.prize_text || ''),
        actorType: String(r.actor_type || ''),
        actorStudentId: r.actor_student_id ? String(r.actor_student_id) : ''
      };
    });
    if (studentId) {
      rows = rows.filter(function(r) {
        return r.fromStudentId === studentId || r.toStudentId === studentId;
      });
    }
    return rows.slice(0, limit);
  }
  await ensureLuckyTransferSheet_();
  const data = await getSheetRows(LUCKY_DRAW_TRANSFERS_SHEET);
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== classId) continue;
    const fromId = String(data[i][4] || '');
    const toId = String(data[i][5] || '');
    if (studentId && fromId !== studentId && toId !== studentId) continue;
    out.push({
      transferId: String(data[i][0] || ''),
      transferredAt: String(data[i][1] || ''),
      classId: String(data[i][2] || ''),
      ticketId: String(data[i][3] || ''),
      fromStudentId: fromId,
      toStudentId: toId,
      tier: String(data[i][6] || ''),
      prizeText: String(data[i][7] || ''),
      actorType: String(data[i][8] || ''),
      actorStudentId: String(data[i][9] || '')
    });
  }
  out.sort(function(a, b) {
    return a.transferredAt < b.transferredAt ? 1 : a.transferredAt > b.transferredAt ? -1 : 0;
  });
  return out.slice(0, limit);
}

function seoulDayBoundsIso_() {
  const day = formatDateInTz(new Date(), TIMEZONE);
  return {
    day: day,
    startIso: day + 'T00:00:00+09:00',
    endIso: formatDateInTz(new Date(Date.parse(day + 'T00:00:00+09:00') + 24 * 60 * 60 * 1000), TIMEZONE) + 'T00:00:00+09:00'
  };
}

async function countStudentLuckySpinsToday(studentId) {
  studentId = String(studentId);
  const bounds = seoulDayBoundsIso_();
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error } = await db.from('dollar_transactions')
      .select('created_at')
      .eq('student_id', studentId)
      .eq('reason', STUDENT_LUCKY_SPIN_REASON)
      .gte('created_at', bounds.startIso)
      .lt('created_at', bounds.endIso);
    if (error) throw new Error(error.message);
    return (data || []).length;
  }
  const data = await getSheetRows(DOLLAR_SHEETS.TRANSACTIONS);
  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== studentId) continue;
    if (String(data[i][5] || '') !== STUDENT_LUCKY_SPIN_REASON) continue;
    const at = String(data[i][0] || '');
    const day = formatDateInTz(at, TIMEZONE);
    if (day === bounds.day) count += 1;
  }
  return count;
}

async function rollLuckyPrize_() {
  const { getLuckyDrawConfig, getActiveClientTiers } = require('./luckyDrawConfigService');
  const config = await getLuckyDrawConfig();
  const tiers = getActiveClientTiers(config);
  if (!tiers.length) throw new Error('No Lucky Draw prizes are configured.');
  let total = 0;
  for (let i = 0; i < tiers.length; i++) {
    total += Math.max(0, Number(tiers[i].weight) || 0);
  }
  if (total <= 0) throw new Error('Lucky Draw weights are invalid.');
  let r = Math.random() * total;
  let picked = tiers[tiers.length - 1];
  for (let i = 0; i < tiers.length; i++) {
    r -= Math.max(0, Number(tiers[i].weight) || 0);
    if (r <= 0) {
      picked = tiers[i];
      break;
    }
  }
  const items = Array.isArray(picked.items) ? picked.items.filter(Boolean) : [];
  if (!items.length) throw new Error('No prizes in tier: ' + (picked.name || 'unknown'));
  const raw = items[Math.floor(Math.random() * items.length)];
  const prizeText = typeof raw === 'string' ? raw : String(raw.text || raw.prizeText || '').trim();
  if (!prizeText) throw new Error('Empty prize text.');
  return { tier: String(picked.name || 'Prize'), prizeText: prizeText };
}

async function studentPurchaseLuckyDraw(classId, studentId) {
  classId = String(classId);
  studentId = String(studentId);
  const used = await countStudentLuckySpinsToday(studentId);
  const limit = LUCKY_STUDENT_SPIN_DAILY_LIMIT || 2;
  if (used >= limit) {
    const err = new Error('You can spin Lucky Draw only ' + limit + ' times per day. Come back tomorrow!');
    err.code = 'DAILY_LIMIT';
    err.used = used;
    err.limit = limit;
    throw err;
  }
  const rolled = await rollLuckyPrize_();
  const result = await purchaseLuckyDrawTicket(
    classId,
    studentId,
    rolled.tier,
    rolled.prizeText,
    LUCKY_DRAW_PURCHASE_COST,
    { reason: STUDENT_LUCKY_SPIN_REASON }
  );
  const remaining = await listStudentLuckyTickets(classId, studentId);
  return {
    message: 'You won a ' + rolled.tier + ' ticket!',
    ticket: result.ticket,
    cost: result.cost,
    previousBalance: result.previousBalance,
    newBalance: result.newBalance,
    spinsUsedToday: used + 1,
    spinsRemainingToday: Math.max(0, limit - used - 1),
    spinLimit: limit,
    luckyDraw: {
      totalCount: remaining.length,
      tickets: groupLuckyTickets(remaining),
      recipes: listFusionRecipes()
    }
  };
}

async function getStudentLuckySpinStatus(classId, studentId) {
  const used = await countStudentLuckySpinsToday(studentId);
  const limit = LUCKY_STUDENT_SPIN_DAILY_LIMIT || 2;
  const balance = await getStudentDollarBalance(studentId);
  return {
    cost: LUCKY_DRAW_PURCHASE_COST,
    spinsUsedToday: used,
    spinsRemainingToday: Math.max(0, limit - used),
    spinLimit: limit,
    balance: balance
  };
}

function pickUnluckyTicketWeighted_(tickets) {
  if (!tickets || !tickets.length) return null;
  if (tickets.length === 1) return tickets[0];
  let total = 0;
  const weights = tickets.map(function(t) {
    const key = canonicalTierName(t.tier);
    const w = UNLUCKY_DESTROY_WEIGHT[key] != null ? UNLUCKY_DESTROY_WEIGHT[key] : 1.2;
    total += w;
    return w;
  });
  let r = Math.random() * total;
  for (let i = 0; i < tickets.length; i++) {
    r -= weights[i];
    if (r <= 0) return tickets[i];
  }
  return tickets[tickets.length - 1];
}

/** Match prize text for the special Unlucky Draw Shield ticket. */
function isUnluckyDrawShieldTicket(ticket) {
  const prize = String((ticket && ticket.prizeText) || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!prize) return false;
  return (
    prize === 'unlucky draw shield' ||
    /unlucky\s*draw\s*shield/.test(prize) ||
    /^unlucky\s*shield$/.test(prize)
  );
}

function findUnluckyDrawShield_(tickets) {
  const list = Array.isArray(tickets) ? tickets : [];
  for (let i = 0; i < list.length; i++) {
    if (isUnluckyDrawShieldTicket(list[i])) return list[i];
  }
  return null;
}

async function listStudentLuckyTickets(classId, studentId) {
  await ensureLuckyDrawSheet();
  classId = String(classId);
  studentId = String(studentId);
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  const nowMs = Date.now();
  const active = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId || String(data[i][2]) !== studentId) continue;
    const ticket = {
      ticketId: String(data[i][0]),
      classId,
      studentId,
      tier: String(data[i][3] || ''),
      prizeText: String(data[i][4] || ''),
      drawnAt: String(data[i][5] || '')
    };
    // Soft-expire only: never auto-delete on read (hard deletes caused irreversible loss).
    if (isLuckyTicketExpired(ticket, nowMs)) continue;
    active.push(enrichLuckyTicket(ticket, nowMs));
  }
  active.sort((a, b) => (a.drawnAt < b.drawnAt ? 1 : a.drawnAt > b.drawnAt ? -1 : 0));
  return active;
}

async function redeemLuckyTicket(ticketId, opts) {
  opts = opts || {};
  await ensureLuckyDrawSheet();
  ticketId = String(ticketId);
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error: readErr } = await db.from('lucky_draw_tickets')
      .select('class_id, student_id, tier, prize_text, drawn_at')
      .eq('ticket_id', ticketId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!data) throw new Error('Ticket not found.');
    const classId = String(data.class_id);
    const studentId = String(data.student_id);
    if (isLuckyTicketExpired(String(data.drawn_at || ''))) {
      throw new Error('This ticket expired (90-day limit).');
    }
    await archiveLuckyTickets_([{
      ticketId: ticketId,
      classId: classId,
      studentId: studentId,
      tier: String(data.tier || ''),
      prizeText: String(data.prize_text || ''),
      drawnAt: String(data.drawn_at || '')
    }], opts.reason || 'redeem', opts);
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
      if (isLuckyTicketExpired(String(data[i][5] || ''))) {
        throw new Error('This ticket expired (90-day limit).');
      }
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

async function transferLuckyTicket(ticketId, toStudentId, opts) {
  opts = opts || {};
  await ensureLuckyDrawSheet();
  ticketId = String(ticketId);
  toStudentId = String(toStudentId);
  const row = await findTicketRow_(ticketId);
  if (!row) throw new Error('Ticket not found.');
  if (isLuckyTicketExpired(row.drawnAt)) {
    throw new Error('This ticket expired (90-day limit).');
  }
  if (row.studentId === toStudentId) {
    throw new Error('This student already owns the ticket.');
  }
  if (opts.fromStudentId && String(opts.fromStudentId) !== row.studentId) {
    throw new Error('You can only transfer your own tickets.');
  }
  await assertStudentInClass_(row.classId, toStudentId);
  const previousOwner = row.studentId;
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { error } = await db.from('lucky_draw_tickets').update({ student_id: toStudentId }).eq('ticket_id', ticketId);
    if (error) throw new Error(error.message);
  } else {
    await updateRange(LUCKY_DRAW_SHEET, 'C' + row.row, [[toStudentId]]);
  }
  afterLuckyDrawWrite(row.classId);
  let log = null;
  try {
    log = await logLuckyTransfer_({
      classId: row.classId,
      ticketId: ticketId,
      fromStudentId: previousOwner,
      toStudentId: toStudentId,
      tier: row.tier,
      prizeText: row.prizeText,
      actorType: opts.actorType || 'teacher',
      actorStudentId: opts.actorStudentId || (opts.actorType === 'student' ? previousOwner : '')
    });
  } catch (err) {
    // Roll ownership back if audit log fails — otherwise tickets "vanish" with no trail.
    console.error('logLuckyTransfer_', err.message || err);
    try {
      if (isSupabaseEnabled()) {
        const db = getSupabase();
        await db.from('lucky_draw_tickets').update({ student_id: previousOwner }).eq('ticket_id', ticketId);
      } else {
        await updateRange(LUCKY_DRAW_SHEET, 'C' + row.row, [[previousOwner]]);
      }
      afterLuckyDrawWrite(row.classId);
    } catch (rollbackErr) {
      console.error('transferLuckyTicket rollback failed', rollbackErr.message || rollbackErr);
    }
    throw new Error('Transfer could not be recorded. Ticket was not moved.');
  }
  return {
    message: 'Ticket transferred.',
    ticketId,
    classId: row.classId,
    fromStudentId: previousOwner,
    toStudentId,
    tier: row.tier,
    prizeText: row.prizeText,
    fromRemainingCount: await countStudentTickets(row.classId, previousOwner),
    toRemainingCount: await countStudentTickets(row.classId, toStudentId),
    transfer: log
  };
}

async function studentTransferLuckyTicket(classId, fromStudentId, ticketId, toStudentId) {
  classId = String(classId);
  fromStudentId = String(fromStudentId);
  toStudentId = String(toStudentId);
  if (fromStudentId === toStudentId) {
    throw new Error('You already own this ticket.');
  }
  await assertStudentInClass_(classId, toStudentId);
  const row = await findTicketRow_(String(ticketId));
  if (!row) throw new Error('Ticket not found.');
  if (String(row.classId) !== classId) {
    throw new Error('Ticket is not in your class.');
  }
  const remaining = await listStudentLuckyTickets(classId, fromStudentId);
  const result = await transferLuckyTicket(ticketId, toStudentId, {
    fromStudentId: fromStudentId,
    actorType: 'student',
    actorStudentId: fromStudentId
  });
  const after = await listStudentLuckyTickets(classId, fromStudentId);
  return Object.assign({}, result, {
    luckyDraw: {
      totalCount: after.length,
      tickets: groupLuckyTickets(after),
      recipes: listFusionRecipes()
    },
    previousCount: remaining.length
  });
}

async function getLuckyDrawCountsByClass(classId) {
  await ensureLuckyDrawSheet();
  classId = String(classId);
  const data = await getSheetRows(LUCKY_DRAW_SHEET);
  const counts = {};
  const nowMs = Date.now();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) !== classId) continue;
    const drawnAt = String(data[i][5] || '');
    if (isLuckyTicketExpired(drawnAt, nowMs)) continue;
    const sid = String(data[i][2]);
    counts[sid] = (counts[sid] || 0) + 1;
  }
  return counts;
}

async function deleteLuckyTicketsOwned_(classId, studentId, ticketIds, opts) {
  opts = opts || {};
  classId = String(classId);
  studentId = String(studentId);
  const idSet = new Set(ticketIds.map(String));
  if (isSupabaseEnabled()) {
    const db = getSupabase();
    const { data, error: readErr } = await db.from('lucky_draw_tickets')
      .select('ticket_id, class_id, student_id, tier, prize_text, drawn_at')
      .in('ticket_id', Array.from(idSet));
    if (readErr) throw new Error(readErr.message);
    const rows = data || [];
    if (rows.length !== idSet.size) throw new Error('One or more tickets were not found.');
    for (const row of rows) {
      if (String(row.class_id) !== classId || String(row.student_id) !== studentId) {
        throw new Error('You can only upgrade your own tickets.');
      }
    }
    await archiveLuckyTickets_(rows.map(function(row) {
      return {
        ticketId: String(row.ticket_id),
        classId: String(row.class_id),
        studentId: String(row.student_id),
        tier: String(row.tier || ''),
        prizeText: String(row.prize_text || ''),
        drawnAt: String(row.drawn_at || '')
      };
    }), opts.reason || 'fuse', opts);
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

  // Create the upgraded ticket first, then consume inputs.
  // Never delete-before-insert: a failed save after delete permanently loses tickets.
  const picked = await pickPrizeForTier_(recipe.to);
  const ticket = await saveLuckyDrawTicket(classId, studentId, picked.tierName, picked.prizeText);
  try {
    await deleteLuckyTicketsOwned_(classId, studentId, uniqueIds, {
      reason: 'fuse',
      actorType: 'student',
      actorStudentId: studentId
    });
  } catch (err) {
    try {
      await redeemLuckyTicket(ticket.ticketId, { reason: 'fuse_rollback' });
    } catch (rollbackErr) {
      console.error('fuseLuckyTickets rollback failed', rollbackErr.message || rollbackErr);
    }
    throw err;
  }
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
      drawnAt: ticket.drawnAt,
      expiresAt: ticket.expiresAt,
      expiresInDays: ticket.expiresInDays,
      ttlDays: LUCKY_TICKET_TTL_DAYS
    },
    ticketCount: remaining.length,
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
    // Shield fires first: consume itself, keep every other ticket safe.
    const shield = findUnluckyDrawShield_(tickets);
    if (shield) {
      const redeemed = await redeemLuckyTicket(shield.ticketId, {
        reason: 'unlucky_shield',
        actorType: 'student',
        actorStudentId: studentId
      });
      const protectedCount = Math.max(0, tickets.length - 1);
      return {
        mode: 'shield',
        shield: {
          ticketId: shield.ticketId,
          tier: shield.tier,
          prizeText: shield.prizeText,
          drawnAt: shield.drawnAt
        },
        protectedCount: protectedCount,
        remainingCount: redeemed.remainingCount,
        dollars: balance,
        message: protectedCount > 0
          ? 'Unlucky Draw Shield activated! ' + protectedCount + ' ticket' +
            (protectedCount === 1 ? '' : 's') + ' protected.'
          : 'Unlucky Draw Shield activated and burned out.'
      };
    }

    const pick = pickUnluckyTicketWeighted_(tickets);
    const redeemed = await redeemLuckyTicket(pick.ticketId, {
      reason: 'unlucky_destroy',
      actorType: 'student',
      actorStudentId: studentId
    });
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
  LUCKY_TICKET_TTL_DAYS,
  LUCKY_DRAW_PURCHASE_COST,
  STUDENT_LUCKY_SPIN_REASON,
  groupLuckyTickets,
  saveLuckyDrawTicket,
  purchaseLuckyDrawTicket,
  studentPurchaseLuckyDraw,
  getStudentLuckySpinStatus,
  listStudentLuckyTickets,
  redeemLuckyTicket,
  transferLuckyTicket,
  studentTransferLuckyTicket,
  listLuckyTransfersForClass,
  getLuckyDrawCountsByClass,
  countStudentTickets,
  findFusionRecipe,
  listFusionRecipes,
  fuseLuckyTickets,
  executeUnluckyDraw,
  isLuckyTicketExpired,
  enrichLuckyTicket,
  formatLuckyExpiresAt,
  pickPrizeForTier: pickPrizeForTier_,
  rollLuckyPrize: rollLuckyPrize_
};
