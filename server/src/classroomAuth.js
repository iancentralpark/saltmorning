const { google } = require('googleapis');

let classroomApi = null;
let classroomAuthClient = null;

function isClassroomConfigured() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
}

function resetClassroomApi() {
  classroomApi = null;
  classroomAuthClient = null;
}

async function getClassroomApi() {
  if (!isClassroomConfigured()) return null;
  if (classroomApi) return classroomApi;

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
  );
  oauth2.setCredentials({
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  });

  classroomAuthClient = oauth2;
  classroomApi = google.classroom({ version: 'v1', auth: oauth2 });
  return classroomApi;
}

/** Lightweight probe so /api/health can tell when refresh token is dead. */
async function probeClassroomOAuth() {
  if (!isClassroomConfigured()) {
    return { configured: false, ok: false, error: 'not_configured' };
  }
  try {
    const classroom = await getClassroomApi();
    await classroom.courses.list({ pageSize: 1, courseStates: ['ACTIVE'] });
    return { configured: true, ok: true };
  } catch (e) {
    const msg = String((e && e.message) || e || '');
    resetClassroomApi();
    return {
      configured: true,
      ok: false,
      error: /invalid_grant/i.test(msg) ? 'invalid_grant' : msg.slice(0, 200)
    };
  }
}

module.exports = {
  isClassroomConfigured,
  getClassroomApi,
  resetClassroomApi,
  probeClassroomOAuth
};
