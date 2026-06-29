#!/usr/bin/env node
/** Print GOOGLE_SERVICE_ACCOUNT_JSON one-liner for Railway Variables */
const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '..', 'service-account.json');
if (!fs.existsSync(p)) {
  console.error('Missing server/service-account.json');
  process.exit(1);
}
const json = fs.readFileSync(p, 'utf8').trim();
console.log('\nCopy this into Railway → Variables → GOOGLE_SERVICE_ACCOUNT_JSON:\n');
console.log(json);
console.log('');
