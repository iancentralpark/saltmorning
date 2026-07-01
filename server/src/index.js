require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('./bootstrapCredentials');
bootstrapCredentials();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const apiRoutes = require('./routes');

const app = express();

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (origin === 'https://script.google.com') return true;
  if (/^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/i.test(origin)) return true;
  const corsOrigins = process.env.CORS_ORIGINS;
  if (corsOrigins) {
    return corsOrigins.split(',').map(s => s.trim()).includes(origin);
  }
  return true;
}

app.use(cors({
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, origin || true);
    } else {
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  }
}));
app.use(express.json({ limit: '1mb' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', apiRoutes);

app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'Student.html'));
});

app.get('/class', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'Class.html'));
});

app.get('/', (req, res) => {
  res.json({
    name: 'Mr.Park Class API',
    endpoints: ['/api/health', '/api/session', '/api/work', '/api/attendance', '/student', '/class']
  });
});

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.warn('Warning: set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_JSON');
}
if (process.env.CLASSROOM_ON_NODE === 'true' && !process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
  console.warn('CLASSROOM_ON_NODE=true but GOOGLE_OAUTH_REFRESH_TOKEN missing. Run: npm run oauth-setup');
}

app.listen(PORT, () => {
  console.log('Mr.Park Class API listening on http://localhost:' + PORT);
});

module.exports = app;
