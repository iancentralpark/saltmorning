const fs = require('fs');

function getServiceAccountAuthOptions(scopes) {
  const opts = { scopes };

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    opts.credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return opts;
  }

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyFile && fs.existsSync(keyFile)) {
    opts.keyFile = keyFile;
    return opts;
  }

  return null;
}

module.exports = { getServiceAccountAuthOptions };
