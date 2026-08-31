'use strict';

const { REPORT_CARD_PRINT_SETTINGS_SHEET } = require('../config');
const {
  getSheetRows,
  appendRows,
  updateRange,
  ensureSheet,
  invalidateSheetRowsCache
} = require('../sheets');

const HEADERS = ['SettingKey', 'Value', 'UpdatedAt'];
const KEY_SHOW_PRINCIPAL = 'showPrincipalSignature';

function truthy(val) {
  const v = String(val == null ? '' : val).trim().toLowerCase();
  return v === 'y' || v === 'yes' || v === 'true' || v === '1';
}

async function ensurePrintSettingsSheet() {
  await ensureSheet(REPORT_CARD_PRINT_SETTINGS_SHEET, HEADERS);
}

async function getReportCardPrintSettings() {
  await ensurePrintSettingsSheet();
  const rows = await getSheetRows(REPORT_CARD_PRINT_SETTINGS_SHEET);
  let showPrincipalSignature = true;
  rows.forEach((row) => {
    if (String(row[0] || '').trim() === KEY_SHOW_PRINCIPAL) {
      showPrincipalSignature = truthy(row[1]);
    }
  });
  return { showPrincipalSignature };
}

async function saveReportCardPrintSettings(payload) {
  payload = payload || {};
  await ensurePrintSettingsSheet();
  const rows = await getSheetRows(REPORT_CARD_PRINT_SETTINGS_SHEET, { skipCache: true });
  const now = new Date().toISOString();
  const value = payload.showPrincipalSignature === false ? 'N' : 'Y';
  let found = -1;
  rows.forEach((row, i) => {
    if (String(row[0] || '').trim() === KEY_SHOW_PRINCIPAL) found = i;
  });
  const row = [KEY_SHOW_PRINCIPAL, value, now];
  if (found >= 0) {
    await updateRange(
      REPORT_CARD_PRINT_SETTINGS_SHEET,
      `A${found + 1}:C${found + 1}`,
      [row]
    );
  } else {
    await appendRows(REPORT_CARD_PRINT_SETTINGS_SHEET, [row]);
  }
  invalidateSheetRowsCache(REPORT_CARD_PRINT_SETTINGS_SHEET);
  return getReportCardPrintSettings();
}

module.exports = {
  getReportCardPrintSettings,
  saveReportCardPrintSettings
};
