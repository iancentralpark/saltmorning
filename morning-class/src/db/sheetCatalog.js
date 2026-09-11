'use strict';

/**
 * Sheet names that still need the generic Postgres sheet store.
 * Roster sheets use the typed roster bridge instead.
 */

const config = require('../config');
const { isRosterSheet } = require('./rosterBridge');

const EXTRA_SHEETS = [
  'Homework_Log',
  'Homework_Items',
  'Homework_Completion',
  'English_Buddy_History',
  'English_Buddy_Flags',
  'Account_Flags',
  'Teacher_Google',
  'Dollar_Balances',
  'Dollar_Transactions',
  'Audit_Log'
];

function allConfiguredSheetNames() {
  return Object.keys(config)
    .filter((k) => /_SHEET$/.test(k))
    .map((k) => config[k])
    .filter((name) => typeof name === 'string' && name.trim());
}

function sheetStoreTargets() {
  const names = new Set();
  allConfiguredSheetNames().forEach((n) => names.add(n));
  EXTRA_SHEETS.forEach((n) => names.add(n));
  return Array.from(names)
    .filter((n) => !isRosterSheet(n))
    .sort();
}

function isSheetStoreSheet(sheetName) {
  const name = String(sheetName || '');
  if (!name || isRosterSheet(name)) return false;
  // Once backfilled, ANY previously known tab (including extras) is store-backed.
  // Catalog is the allow-list used during backfill; runtime also accepts tabs
  // already present in sheet_tabs (checked by caller).
  return sheetStoreTargets().includes(name);
}

module.exports = {
  EXTRA_SHEETS,
  sheetStoreTargets,
  isSheetStoreSheet
};
