#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? path.resolve(root, process.env.GOOGLE_APPLICATION_CREDENTIALS)
  : path.join(root, 'service-account.json');

console.log('\nSalt Morning Class — setup check\n');
if (!fs.existsSync(envPath)) console.log('  ✗ .env missing (cp .env.example .env)');
else console.log('  ✓ .env exists');
if (fs.existsSync(saPath) || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) console.log('  ✓ Google credentials');
else console.log('  ✗ Google credentials missing');
if (process.env.SPREADSHEET_ID) console.log('  ✓ SPREADSHEET_ID set');
else console.log('  ✗ SPREADSHEET_ID missing');
console.log('');
