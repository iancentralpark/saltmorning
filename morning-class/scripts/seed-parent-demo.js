#!/usr/bin/env node
/**
 * Seed Test Parents (parent/parent) + mock report-card data for Test Students.
 * Usage: node scripts/seed-parent-demo.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
try {
  const { bootstrapCredentials } = require('../src/bootstrapCredentials');
  bootstrapCredentials();
} catch (e) { /* optional */ }

const { ensureParentDemoData } = require('../src/services/parentPortalService');

ensureParentDemoData()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
