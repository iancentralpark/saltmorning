const fs = require('fs');
const path = require('path');

/** Railway 등: GOOGLE_SERVICE_ACCOUNT_JSON env → 임시 key file */
function bootstrapCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return;

  const credPath = path.join(__dirname, '..', '.credentials', 'service-account.json');
  fs.mkdirSync(path.dirname(credPath), { recursive: true });
  fs.writeFileSync(credPath, raw, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
}

module.exports = { bootstrapCredentials };
