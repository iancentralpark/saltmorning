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
app.use(express.static(path.join(__dirname, '..', 'public')));

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
});

module.exports = app;
