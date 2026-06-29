#!/usr/bin/env node
/**
 * One-time OAuth setup for Google Classroom on Node.
 *
 * 1. Google Cloud Console → APIs → OAuth client (Desktop app)
 * 2. Enable Google Classroom API
 * 3. Add redirect URI: http://localhost:8788/oauth2callback
 * 4. Run: GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... node scripts/oauth-setup.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const { URL } = require('url');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:8788/oauth2callback';
const PORT = Number(process.env.OAUTH_SETUP_PORT) || 8788;

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students'
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in server/.env first.');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: SCOPES
});

console.log('\nOpen this URL in your browser (log in as the Classroom teacher):\n');
console.log(authUrl);
console.log('\nWaiting for callback on ' + REDIRECT_URI + ' ...\n');
console.log('※ 터미널이 "Waiting" 상태일 때 브라우저에서 허용해야 .env에 저장됩니다.\n');

try {
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execSync(openCmd + ' ' + JSON.stringify(authUrl), { stdio: 'ignore' });
} catch (e) { /* ignore */ }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('Missing code');
    return;
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>Success</h1><p>You can close this tab and copy the refresh token from the terminal.</p>');

    console.log('Add these to server/.env (and Railway variables):\n');
    console.log('GOOGLE_OAUTH_CLIENT_ID=' + CLIENT_ID);
    console.log('GOOGLE_OAUTH_CLIENT_SECRET=' + CLIENT_SECRET);
    console.log('GOOGLE_OAUTH_REFRESH_TOKEN=' + (tokens.refresh_token || '(none — revoke app access and retry with prompt=consent)'));
    if (tokens.refresh_token) {
      const { execFileSync } = require('child_process');
      execFileSync(process.execPath, [
        require('path').join(__dirname, 'patch-env.js'),
        'GOOGLE_OAUTH_CLIENT_ID=' + CLIENT_ID,
        'GOOGLE_OAUTH_CLIENT_SECRET=' + CLIENT_SECRET,
        'GOOGLE_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token
      ], { stdio: 'inherit' });
    }
  } catch (e) {
    res.writeHead(500);
    res.end('Token exchange failed: ' + e.message);
    console.error(e);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT, () => {
  console.log('Local callback server on port ' + PORT);
});
