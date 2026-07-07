const { PARENT_ANNOUNCEMENTS_SHEET } = require('../config');
const { getSheetRows } = require('../sheets');

async function listParentAnnouncements() {
  const rows = await getSheetRows(PARENT_ANNOUNCEMENTS_SHEET);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][5] || '').trim().toLowerCase() === 'false') continue;
    out.push({
      announcementId: String(rows[i][0]),
      title: String(rows[i][1] || ''),
      body: String(rows[i][2] || ''),
      postedAt: String(rows[i][3] || ''),
      postedBy: String(rows[i][4] || '')
    });
  }
  out.sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
  return out;
}

module.exports = { listParentAnnouncements };
