#!/usr/bin/env node
'use strict';

/**
 * Optional one-shot backfill: Google Sheets Vocab_Student_State → Supabase
 * vocab_student_state for VOCAB_TENANT_ID.
 *
 * Dry-run by default. Pass --apply to write.
 * Sheets Vocab is retired; use only if legacy rows still need importing.
 *
 * Usage:
 *   node scripts/backfill-vocab-sheets-to-supabase.js
 *   node scripts/backfill-vocab-sheets-to-supabase.js --apply
 */

const path = require('path');

async function main() {
  const apply = process.argv.includes('--apply');
  const tenantId = String(process.env.VOCAB_TENANT_ID || 'salt-morning').trim();
  const { getSheetRows } = require('../src/sheets');
  const vendor = path.resolve(__dirname, '../src/vendor/mrpark-vocab');
  const { getSupabase, isSupabaseEnabled } = require(path.join(vendor, 'supabaseClient.js'));

  if (!isSupabaseEnabled()) {
    throw new Error('Supabase is not enabled.');
  }

  const rows = await getSheetRows('Vocab_Student_State');
  if (!rows || rows.length <= 1) {
    console.log('No Vocab_Student_State rows found.');
    return;
  }

  const header = (rows[0] || []).map((h) => String(h || '').trim());
  const idx = (name) => header.indexOf(name);
  const iStudent = idx('StudentID');
  const iClass = idx('ClassID');
  const iGrade = idx('GradeLevel');
  const iTier = idx('Tier');
  const iDone = idx('PlacementDone');
  const iAt = idx('PlacementAt');
  const iPromo = idx('PromotionScore');
  const iShield = idx('ShieldCount');

  if (iStudent < 0) throw new Error('Vocab_Student_State missing StudentID column');

  const db = getSupabase();
  let planned = 0;
  let written = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const studentId = String(row[iStudent] || '').trim();
    if (!studentId) continue;
    const placementDone = String(row[iDone] || '').toLowerCase();
    const placed = placementDone === 'true' || placementDone === '1' || placementDone === 'yes';
    const payload = {
      tenant_id: tenantId,
      student_id: studentId,
      class_id: iClass >= 0 ? String(row[iClass] || '').trim() || null : null,
      grade_level: iGrade >= 0 ? Number(row[iGrade]) || null : null,
      tier_name: iTier >= 0 ? String(row[iTier] || '').trim() || null : null,
      placement_at: placed && iAt >= 0 && row[iAt] ? String(row[iAt]) : (placed ? new Date().toISOString() : null),
      promotion_score: iPromo >= 0 ? Number(row[iPromo]) || 0 : 0,
      promotion_shield_count: iShield >= 0 ? Number(row[iShield]) || 0 : 0,
      // Preserve existing promotion_test_status if already in Supabase; new rows start LOCKED
      // (ops can unlock AVAILABLE for score>=400 separately).
      updated_at: new Date().toISOString()
    };
    planned += 1;
    console.log((apply ? 'WRITE' : 'DRY') + ' ' + studentId + ' grade=' + payload.grade_level + ' score=' + payload.promotion_score);

    if (!apply) continue;

    const { data: existing } = await db
      .from('vocab_student_state')
      .select('student_id, promotion_test_status')
      .eq('tenant_id', tenantId)
      .eq('student_id', studentId)
      .maybeSingle();

    const rowOut = Object.assign({}, payload);
    if (existing && existing.promotion_test_status) {
      // keep existing gate status
    } else if (payload.promotion_score >= 400) {
      rowOut.promotion_test_status = 'AVAILABLE';
    } else {
      rowOut.promotion_test_status = 'LOCKED';
    }

    const { error } = await db
      .from('vocab_student_state')
      .upsert(rowOut, { onConflict: 'tenant_id,student_id' });
    if (error) throw new Error(error.message);
    written += 1;
  }

  console.log('Planned=' + planned + ' written=' + written + ' tenant=' + tenantId + (apply ? '' : ' (dry-run)'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
