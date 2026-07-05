function truncate(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

async function sendStudentMessageTelegram({ studentName, classLabel, body }) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return { sent: false, reason: 'not_configured' };

  const text =
    '📩 새 학생 메시지\n' +
    truncate(studentName || 'Student', 40) +
    ' (' + truncate(classLabel || 'Class', 40) + ')\n"' +
    truncate(body, 220) +
    '"';

  const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    console.error('Telegram notify failed', data);
    return { sent: false, reason: 'api_error' };
  }
  return { sent: true };
}

module.exports = { sendStudentMessageTelegram };
