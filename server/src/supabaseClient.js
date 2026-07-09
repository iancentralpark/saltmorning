const { createClient } = require('@supabase/supabase-js');

let client = null;

function isSupabaseEnabled() {
  if (process.env.SUPABASE_ENABLED === 'false') return false;
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        },
        global: {
          fetch: function(url, options) {
            const opts = Object.assign({}, options || {});
            if (!opts.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
              opts.signal = AbortSignal.timeout(20000);
            }
            return fetch(url, opts);
          }
        }
      }
    );
  }
  return client;
}

function shouldSyncPasswordsToSheet() {
  if (process.env.SYNC_PASSWORDS_TO_SHEET === 'true') return true;
  if (process.env.SYNC_PASSWORDS_TO_SHEET === 'false') return false;
  return !isSupabaseEnabled();
}

module.exports = { isSupabaseEnabled, getSupabase, shouldSyncPasswordsToSheet };
