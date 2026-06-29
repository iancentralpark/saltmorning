const { google } = require('googleapis');

let classroomApi = null;

function isClassroomConfigured() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
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

  classroomApi = google.classroom({ version: 'v1', auth: oauth2 });
  return classroomApi;
}

module.exports = { isClassroomConfigured, getClassroomApi };
