require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { bootstrapCredentials } = require('./bootstrapCredentials');
bootstrapCredentials();

const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const apiRoutes = require('./routes');
const { initRealtime } = require('./realtime');
const { ensureBellScheduleSheet } = require('./services/bellScheduleService');
const { ensureRequirementsSheet } = require('./services/timetableRequirementsService');
const { ensureTimetableSheet } = require('./services/timetableService');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Legacy signature URLs → durable API (old cards pointed at ephemeral /uploads/)
app.get('/uploads/signatures/:file', (req, res) => {
  const file = String(req.params.file || '');
  const id = file.replace(/\.[^.]+$/, '');
  if (!id) return res.status(404).end();
  res.redirect(302, '/api/signatures/' + encodeURIComponent(id));
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: '7d',
  etag: true,
  setHeaders(res, filePath) {
    if (/\.html$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use('/api', apiRoutes);

app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'student.html'));
});

app.get('/parent', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'parent.html'));
});

app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'teacher.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/tools/jeopardy', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'tools', 'jeopardy.html'));
});

app.get('/tools/item-bank', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'tools', 'item-bank.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const server = http.createServer(app);
initRealtime(server);

server.listen(PORT, () => {
  console.log('Salt Morning Class listening on http://localhost:' + PORT);
  Promise.all([
    ensureTimetableSheet(),
    ensureBellScheduleSheet(),
    ensureRequirementsSheet()
  ]).catch((e) => console.warn('Timetable sheet init:', e.message));

  // Seed Principal + Head Teacher accounts when Sheets credentials are available.
  try {
    const { ensureLeadershipAccounts } = require('./services/adminService');
    const {
      processDueScheduledShares
    } = require('./services/reportCardWorkflowService');
    const { shareReportCardWithParents } = require('./services/reportCardService');

    ensureLeadershipAccounts()
      .then((r) => console.log('Leadership accounts ready:', r.principalId, r.headId))
      .catch((e) => console.warn('Leadership account seed:', e.message));

    const runDueShares = async () => {
      try {
        await processDueScheduledShares(async (w) => {
          await shareReportCardWithParents('system', w.classId, w.studentId, w.term, {
            bypassAccess: true,
            scheduledShareAt: ''
          });
        });
      } catch (e) {
        console.warn('Scheduled report-card share tick:', e.message);
      }
    };
    setInterval(runDueShares, 5 * 60 * 1000);
    setTimeout(runDueShares, 15000);
  } catch (e) {
    console.warn('Report-card workflow boot:', e.message);
  }
});

module.exports = app;
