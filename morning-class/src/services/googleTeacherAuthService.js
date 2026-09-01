const crypto = require('crypto');
const { google } = require('googleapis');
const { getSheetRows, appendRows, updateRange, ensureSheet, invalidateSheetRowsCache } = require('../sheets');
const { AUTH_SECRET } = require('../config');

const GOOGLE_SHEET = 'Teacher_Google';
const HEADERS = ['TeacherID', 'GoogleEmail', 'RefreshToken', 'Scopes', 'LinkedAt'];

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/forms.body'
];

function isGoogleOAuthConfigured() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
}

function oauthStateSecret() {
  return process.env.GOOGLE_OAUTH_STATE_SECRET ||
    process.env.AUTH_SECRET ||
    AUTH_SECRET ||
    'salt-google-oauth-state';
}

function tokenSecret() {
  return process.env.GOOGLE_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    AUTH_SECRET ||
    'salt-google-token-secret';
}

function encryptText(plain) {
  const key = crypto.createHash('sha256').update(tokenSecret()).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

function decryptText(encoded) {
  if (!encoded) return '';
  const buf = Buffer.from(String(encoded), 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = crypto.createHash('sha256').update(tokenSecret()).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function getRedirectUri(req) {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) {
    return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  }
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return proto + '://' + host + '/api/teacher/google/callback';
}

function createOAuthClient(redirectUri) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri
  );
}

function signOAuthState(teacherId, returnTo) {
  const payload = {
    tid: String(teacherId),
    n: crypto.randomBytes(8).toString('hex'),
    exp: Date.now() + 10 * 60 * 1000,
    returnTo: String(returnTo || '').slice(0, 120)
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', oauthStateSecret()).update(data).digest('base64url');
  return data + '.' + sig;
}

function verifyOAuthStateFull(state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 2) throw new Error('Invalid OAuth state.');
  const data = parts[0];
  const sig = parts[1];
  const expected = crypto.createHmac('sha256', oauthStateSecret()).update(data).digest('base64url');
  if (sig !== expected) throw new Error('Invalid OAuth state signature.');
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (!payload.tid || !payload.exp || Date.now() > payload.exp) {
    throw new Error('OAuth state expired. Try connecting again.');
  }
  return {
    teacherId: String(payload.tid),
    returnTo: String(payload.returnTo || '').trim()
  };
}

function verifyOAuthState(state) {
  return verifyOAuthStateFull(state).teacherId;
}

async function ensureGoogleSheet() {
  await ensureSheet(GOOGLE_SHEET, HEADERS);
}

async function loadGoogleRow(teacherId) {
  await ensureGoogleSheet();
  const rows = await getSheetRows(GOOGLE_SHEET);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(teacherId)) {
      return { rowIndex: i + 1, row: rows[i] };
    }
  }
  return { rowIndex: -1, row: null };
}

async function saveGoogleLink(teacherId, email, refreshToken) {
  teacherId = String(teacherId || '').trim();
  if (!teacherId || !refreshToken) throw new Error('Teacher and refresh token are required.');
  const hit = await loadGoogleRow(teacherId);
  const row = [
    teacherId,
    String(email || '').trim(),
    encryptText(refreshToken),
    SCOPES.join(' '),
    new Date().toISOString()
  ];
  if (hit.rowIndex > 0) {
    await updateRange(GOOGLE_SHEET, `A${hit.rowIndex}:E${hit.rowIndex}`, [row]);
  } else {
    await appendRows(GOOGLE_SHEET, [row]);
  }
  invalidateSheetRowsCache(GOOGLE_SHEET);
  return { teacherId, email: row[1], linkedAt: row[4] };
}

async function clearGoogleLink(teacherId) {
  const hit = await loadGoogleRow(teacherId);
  if (hit.rowIndex < 0) return { ok: true };
  await updateRange(GOOGLE_SHEET, `A${hit.rowIndex}:E${hit.rowIndex}`, [new Array(5).fill('')]);
  invalidateSheetRowsCache(GOOGLE_SHEET);
  return { ok: true };
}

async function getGoogleStatus(teacherId) {
  if (!isGoogleOAuthConfigured()) {
    return { configured: false, linked: false, email: '' };
  }
  const hit = await loadGoogleRow(teacherId);
  const tokenEnc = hit.row && String(hit.row[2] || '').trim();
  return {
    configured: true,
    linked: !!tokenEnc,
    email: hit.row ? String(hit.row[1] || '').trim() : '',
    linkedAt: hit.row ? String(hit.row[4] || '').trim() : '',
    scopes: SCOPES,
    hasApiKey: !!process.env.GOOGLE_API_KEY
  };
}

function getPublicClientConfig() {
  return {
    configured: isGoogleOAuthConfigured(),
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    apiKey: process.env.GOOGLE_API_KEY || '',
    scopes: SCOPES,
    appId: process.env.GOOGLE_APP_ID || ''
  };
}

function getConnectUrl(teacherId, redirectUri, returnTo) {
  if (!isGoogleOAuthConfigured()) throw new Error('Google OAuth is not configured on the server.');
  const client = createOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: signOAuthState(teacherId, returnTo)
  });
}

async function handleOAuthCallback(code, state, redirectUri) {
  const parsed = verifyOAuthStateFull(state);
  const teacherId = parsed.teacherId;
  const client = createOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens || !tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Disconnect the app in your Google account and try again.');
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const me = await oauth2.userinfo.get();
  const email = (me.data && me.data.email) || '';
  await saveGoogleLink(teacherId, email, tokens.refresh_token);
  return { teacherId, email, returnTo: parsed.returnTo };
}

async function getTeacherOAuthClient(teacherId) {
  if (!isGoogleOAuthConfigured()) {
    throw new Error('Google OAuth is not configured. Ask admin to set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.');
  }
  const hit = await loadGoogleRow(teacherId);
  const tokenEnc = hit.row && String(hit.row[2] || '').trim();
  if (!tokenEnc) {
    throw new Error('Connect your Google account first (Drive & Forms).');
  }
  const refreshToken = decryptText(tokenEnc);
  if (!refreshToken) throw new Error('Google token is invalid. Please reconnect your account.');
  const client = createOAuthClient(process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:8790/api/teacher/google/callback');
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function getAccessToken(teacherId) {
  const client = await getTeacherOAuthClient(teacherId);
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse && tokenResponse.token;
  if (!token) throw new Error('Could not refresh Google access token. Reconnect your account.');
  return { accessToken: token, expiresIn: 3600 };
}

async function shareDriveFile(teacherId, fileId) {
  fileId = String(fileId || '').trim();
  if (!fileId) throw new Error('Drive file ID is required.');
  const auth = await getTeacherOAuthClient(teacherId);
  const drive = google.drive({ version: 'v3', auth });
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' }
    });
  } catch (e) {
  /* may already be shared */
  }
  const meta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,webViewLink,iconLink'
  });
  const data = meta.data || {};
  return {
    fileId: data.id || fileId,
    name: data.name || 'Google Drive file',
    mimeType: data.mimeType || '',
    webViewLink: data.webViewLink || ('https://drive.google.com/file/d/' + fileId + '/view'),
    isForm: data.mimeType === 'application/vnd.google-apps.form'
  };
}

async function resolveGoogleForm(teacherId, formId) {
  formId = String(formId || '').trim();
  if (!formId) throw new Error('Form ID is required.');
  const auth = await getTeacherOAuthClient(teacherId);
  const forms = google.forms({ version: 'v1', auth });
  const res = await forms.forms.get({ formId });
  const form = res.data || {};
  return {
    formId,
    title: (form.info && form.info.title) || 'Google Form',
    responderUri: form.responderUri || ('https://docs.google.com/forms/d/' + formId + '/viewform'),
    editUri: 'https://docs.google.com/forms/d/' + formId + '/edit'
  };
}

async function createGoogleForm(teacherId, payload) {
  const title = String((payload && payload.title) || 'Homework').trim() || 'Homework';
  const description = String((payload && payload.description) || '').trim();
  const isQuiz = payload && (payload.isQuiz === true || payload.isQuiz === 'true');
  const auth = await getTeacherOAuthClient(teacherId);
  const forms = google.forms({ version: 'v1', auth });
  const createBody = {
    info: { title, documentTitle: title }
  };
  if (isQuiz) createBody.info.isQuiz = true;
  const created = await forms.forms.create({ requestBody: createBody });
  const form = created.data || {};
  const formId = form.formId;
  if (!formId) throw new Error('Google Form was not created.');

  if (description) {
    await forms.forms.batchUpdate({
      formId,
      requestBody: {
        requests: [{
          updateFormInfo: {
            info: { description },
            updateMask: 'description'
          }
        }]
      }
    });
  }

  const fresh = await forms.forms.get({ formId });
  const info = (fresh.data && fresh.data.info) || form.info || {};
  return {
    formId,
    title: info.title || title,
    responderUri: fresh.data.responderUri || form.responderUri || ('https://docs.google.com/forms/d/' + formId + '/viewform'),
    editUri: 'https://docs.google.com/forms/d/' + formId + '/edit',
    isQuiz: !!info.isQuiz
  };
}

module.exports = {
  isGoogleOAuthConfigured,
  getPublicClientConfig,
  getRedirectUri,
  getConnectUrl,
  handleOAuthCallback,
  getGoogleStatus,
  clearGoogleLink,
  getAccessToken,
  shareDriveFile,
  resolveGoogleForm,
  createGoogleForm
};
