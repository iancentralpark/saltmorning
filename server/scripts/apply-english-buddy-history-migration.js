/**
 * Apply english_buddy_messages migration when SUPABASE_DB_URL or DATABASE_URL is set.
 * Usage: node scripts/apply-english-buddy-history-migration.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

async function main() {
  const conn = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!conn) {
    console.error('Set SUPABASE_DB_URL or DATABASE_URL (Supabase → Settings → Database → connection string).');
    process.exit(1);
  }
  let Client;
  try {
    Client = require('pg').Client;
  } catch (e) {
    console.error('Install pg: npm install pg');
    process.exit(1);
  }
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '007_english_buddy_history.sql'),
    'utf8'
  );
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log('english_buddy_messages migration applied.');
}

main().catch(function(err) {
  console.error(err.message || err);
  process.exit(1);
});
