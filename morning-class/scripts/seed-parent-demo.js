#!/usr/bin/env node
/**
 * Seed Test Parents + full Fall 2025 report-card mock data for Test Students.
 * Usage: node scripts/seed-parent-demo.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
try {
  const { bootstrapCredentials } = require('../src/bootstrapCredentials');
  bootstrapCredentials();
} catch (e) { /* optional */ }

const { ensureParentDemoData } = require('../src/services/parentPortalService');
const { seedLastSemesterReportCard } = require('../src/services/reportCardDemoSeed');

Promise.all([ensureParentDemoData(), seedLastSemesterReportCard()])
  .then(([parent, report]) => {
    console.log(JSON.stringify({ parent, lastSemester: report }, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
