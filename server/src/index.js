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
  if (/^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/i.test(origin)) return true;
  // Student portal + API on the same Railway host
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.up\.railway\.app$/i.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.railway\.app$/i.test(origin)) return true;
  if (/^https:\/\/(www\.)?mrpark\.online$/i.test(origin)) return true;
  const corsOrigins = process.env.CORS_ORIGINS;
  if (corsOrigins) {
    return corsOrigins.split(',').map(s => s.trim()).filter(Boolean).includes(origin);
  }
  return true;
}

app.use(cors({
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, origin || true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(null, false);
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
  res.sendFile(path.join(__dirname, '..', 'public', 'Home.html'));
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
