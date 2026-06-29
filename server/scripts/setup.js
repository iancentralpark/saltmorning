#!/usr/bin/env node
/**
 * Interactive setup helper — opens Google Cloud pages and validates local files.
 * Run: npm run setup
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const saPath = path.join(root, 'service-account.json');

const LINKS = {
  apis: 'https://console.cloud.google.com/apis/library',
  classroom: 'https://console.cloud.google.com/apis/library/classroom.googleapis.com',
  sheets: 'https://console.cloud.google.com/apis/library/sheets.googleapis.com',
  calendar: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
  credentials: 'https://console.cloud.google.com/apis/credentials',
  consent: 'https://console.cloud.google.com/apis/credentials/consent',
  serviceAccounts: 'https://console.cloud.google.com/iam-admin/serviceaccounts',
  railway: 'https://railway.app/new'
};

console.log('\n=== Mr.Park Node API Setup ===\n');

console.log('Step 1 — Google Cloud (Sheets service account)');
console.log('  1. Enable: Sheets API + Calendar API');
console.log('  2. IAM → Service Accounts → Create → Download JSON');
console.log('  3. Save as: server/service-account.json');
console.log('  4. Share spreadsheet with service account email (Editor)\n');

if (fs.existsSync(saPath)) {
  try {
    const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    console.log('  ✓ service-account.json found:', sa.client_email || '(no email)');
  } catch (e) {
    console.log('  ✗ service-account.json invalid JSON');
  }
} else {
  console.log('  ✗ service-account.json not found yet');
}

console.log('\nStep 2 — OAuth (Classroom, teacher account)');
console.log('  1. OAuth consent screen → External → add your email as test user');
console.log('  2. Credentials → Create OAuth client → Desktop app');
console.log('  3. Add redirect URI: http://localhost:8788/oauth2callback');
console.log('  4. Paste Client ID + Secret into server/.env');
console.log('  5. Run: npm run oauth-setup\n');

const hasOAuth = process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const hasRefresh = !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
console.log('  OAuth client:', hasOAuth ? '✓' : '✗ (fill .env)');
console.log('  Refresh token:', hasRefresh ? '✓' : '✗ (npm run oauth-setup)');

console.log('\nStep 3 — Local test');
console.log('  npm run dev');
console.log('  curl http://localhost:8787/api/health\n');

console.log('Step 4 — Railway');
console.log('  1. railway.app → New Project → Deploy from GitHub (root: server)');
console.log('  2. Or: npx @railway/cli login && npx @railway/cli up');
console.log('  3. Set env vars (same as .env + GOOGLE_SERVICE_ACCOUNT_JSON as one line)');
console.log('  4. Public URL → Apps Script NODE_API_URL\n');

console.log('Quick links (open in browser):');
Object.entries(LINKS).forEach(([k, url]) => console.log(' ', k + ':', url));

console.log('\nOpening Google Cloud Credentials in default browser…');
try {
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execSync(openCmd + ' ' + JSON.stringify(LINKS.credentials), { stdio: 'ignore' });
  execSync(openCmd + ' ' + JSON.stringify(LINKS.classroom), { stdio: 'ignore' });
} catch (e) {
  console.log('(Could not auto-open browser — use links above)');
}

console.log('');
