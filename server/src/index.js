require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('./bootstrapCredentials');
bootstrapCredentials();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const apiRoutes = require('./routes');
const { verifyTeacherToken, readTeacherTokenFromRequest } = require('./teacherAuth');

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

function sendTeacherApp(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'Teacher.html'));
}

function redirectTeacherLogin(req, res) {
  const next = encodeURIComponent(req.originalUrl || '/class');
  res.redirect('/teacher-login?next=' + next);
}

function requireTeacherPage(req, res, next) {
  const token = readTeacherTokenFromRequest(req);
  if (verifyTeacherToken(token)) return next();
  return redirectTeacherLogin(req, res);
}

app.get('/teacher-login', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'TeacherLogin.html'));
});

app.get('/class', requireTeacherPage, sendTeacherApp);

app.get('/teacher', requireTeacherPage, sendTeacherApp);

const TOOL_PAGES = {
  timer: 'timer.html',
  dice: 'dice.html',
  roulette: 'roulette.html',
  luckydraw: 'luckydraw.html'
};

app.get('/tools/:tool', requireTeacherPage, (req, res) => {
  const file = TOOL_PAGES[String(req.params.tool || '').toLowerCase()];
  if (!file) return res.status(404).send('Tool not found');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'tools', file));
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

const http = require('http');
const { initRealtime } = require('./realtime');

const server = http.createServer(app);
initRealtime(server);

server.listen(PORT, () => {
  console.log('Mr.Park Class API listening on http://localhost:' + PORT);
  const { isSupabaseEnabled } = require('./supabaseClient');
  if (isSupabaseEnabled()) {
    setImmediate(function() {
      const { warmSheetPortalLoginCache, canReadSheetPortalLogins } = require('./studentPasswordSync');
      const { getSupabase } = require('./supabaseClient');
      const { queryStudents } = require('./supabaseStudentColumns');
      (async function() {
        try {
          const tasks = [queryStudents(getSupabase(), { orderBy: 'name' })];
          if (await canReadSheetPortalLogins()) {
            tasks.push(warmSheetPortalLoginCache());
          }
          await Promise.all(tasks);
          console.log('Portal caches warmed');
        } catch (e) {
          console.warn('Portal warmup:', e.message || e);
        }
      })();
    });
  }
});

module.exports = app;
