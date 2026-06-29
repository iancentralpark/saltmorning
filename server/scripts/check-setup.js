#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const saPath = path.join(root, 'service-account.json');

function ok(label) { console.log('  ✓', label); }
function miss(label, hint) { console.log('  ✗', label); if (hint) console.log('    →', hint); }

console.log('\nMr.Park Node API — setup check\n');

if (!fs.existsSync(envPath)) {
  miss('.env missing', 'cp .env.example .env');
} else {
  ok('.env exists');
}

if (fs.existsSync(saPath)) {
  ok('service-account.json exists');
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    process.env.GOOGLE_APPLICATION_CREDENTIALS !== './service-account.json' &&
    fs.existsSync(path.resolve(root, process.env.GOOGLE_APPLICATION_CREDENTIALS))) {
  ok('GOOGLE_APPLICATION_CREDENTIALS file exists');
} else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  ok('GOOGLE_SERVICE_ACCOUNT_JSON set');
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  miss('service-account.json missing', 'Download from Google Cloud → save as server/service-account.json');
} else {
  miss('Sheets credentials', 'Save JSON as server/service-account.json or set GOOGLE_SERVICE_ACCOUNT_JSON');
}

if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
  ok('OAuth client ID/secret');
} else {
  miss('OAuth client', 'Google Cloud → Credentials → OAuth Desktop client → paste in .env');
}

if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
  ok('OAuth refresh token');
} else {
  miss('OAuth refresh token', 'node scripts/oauth-setup.js');
}

console.log('');
const ready = fs.existsSync(envPath) &&
  (fs.existsSync(saPath) || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) &&
  process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

if (ready) {
  console.log('Ready for: npm run dev');
  console.log('Health: http://localhost:8787/api/health\n');
} else {
  console.log('See server/README.md for full steps.\n');
}
