/**
 * Shared messenger UI (dayjs + autosize).
 * Used by teacher (Index.html) and student (Student.html) portals.
 */
(function(global) {
  var THEMES = {
    teacher: {
      mineSender: 'teacher',
      row: 'messenger-msg-row',
      bubble: 'messenger-msg-bubble',
      bubbleMine: 'from-teacher',
      bubbleTheirs: 'from-student',
      meta: 'messenger-msg-meta',
      time: 'messenger-msg-time',
      readMark: 'messenger-read-mark',
      dateSep: 'messenger-date-sep',
      emptyHtml: '<div class="messenger-chat-empty"><i class="fa-solid fa-comments"></i><div>No messages yet.<br>Say hello!</div></div>'
    },
    student: {
      mineSender: 'student',
      row: 'msg-row',
      bubble: 'msg-bubble',
      bubbleMine: 'msg-bubble-student',
      bubbleTheirs: 'msg-bubble-teacher',
      meta: 'msg-meta',
      time: 'msg-time',
      readMark: 'msg-read-mark',
      dateSep: 'msg-date-sep',
      emptyHtml: '<div class="msg-empty">No messages yet.</div>'
    }
  };

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function msgTimeParts(createdAt) {
    var d = createdAt ? new Date(createdAt) : null;
    if (!d || isNaN(d.getTime())) return { time: '', dayKey: '', dayLabel: '' };
    var time = '';
    if (global.dayjs) {
      time = global.dayjs(d).format('h:mm A');
    } else {
      var hh = d.getHours();
      var mm = d.getMinutes();
      var ampm = hh < 12 ? 'AM' : 'PM';
      var h12 = hh % 12;
      if (h12 === 0) h12 = 12;
      time = h12 + ':' + (mm < 10 ? '0' + mm : mm) + ' ' + ampm;
    }
    var dayKey = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var dayLabel = days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    return { time: time, dayKey: dayKey, dayLabel: dayLabel };
  }

  function fingerprint(messages) {
    return (messages || []).map(function(m) {
      return (m.messageId || '') + ':' + (m.read ? '1' : '0') + ':' + (m.body || '');
    }).join('|');
  }

  function autoGrow(textarea, maxPx) {
    if (!textarea) return;
    maxPx = maxPx || 120;
    if (global.autosize) {
      try {
        global.autosize(textarea);
        textarea.style.maxHeight = maxPx + 'px';
        return;
      } catch (e) { /* fallback */ }
    }
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, maxPx) + 'px';
  }

  function destroyAutoGrow(textarea) {
    if (textarea && global.autosize) {
      try { global.autosize.destroy(textarea); } catch (e) { /* ignore */ }
    }
  }

  function buildRow(m, index, messages, theme) {
    var t = THEMES[theme] || THEMES.teacher;
    var parts = msgTimeParts(m.createdAt);
    var mine = m.sender === t.mineSender;
    var next = messages[index + 1];
    var showTime = true;
    if (next && next.sender === m.sender) {
      var np = msgTimeParts(next.createdAt);
      if (np.time === parts.time && np.dayKey === parts.dayKey) showTime = false;
    }

    var rowEl = document.createElement('div');
    rowEl.className = t.row + ' ' + (mine ? 'mine' : 'theirs');
    if (m.messageId) rowEl.setAttribute('data-message-id', m.messageId);

    var bubble = document.createElement('div');
    bubble.className = t.bubble + ' ' + (mine ? t.bubbleMine : t.bubbleTheirs);
    bubble.textContent = m.body || '';

    var meta = document.createElement('span');
    meta.className = t.meta;
    if (mine && !m.read) {
      var rm = document.createElement('span');
      rm.className = t.readMark;
      rm.textContent = '1';
      meta.appendChild(rm);
    }
    if (showTime && parts.time) {
      var ts = document.createElement('span');
      ts.className = t.time;
      ts.textContent = parts.time;
      meta.appendChild(ts);
    }

    if (mine) {
      rowEl.appendChild(meta);
      rowEl.appendChild(bubble);
    } else {
      rowEl.appendChild(bubble);
      rowEl.appendChild(meta);
    }
    return rowEl;
  }

  function renderThread(container, messages, options) {
    if (!container) return false;
    options = options || {};
    var theme = options.theme || 'teacher';
    var t = THEMES[theme] || THEMES.teacher;
    var fp = fingerprint(messages);
    if (!options.force && container.dataset.msgFp === fp) return false;
    container.dataset.msgFp = fp;
    container.innerHTML = '';

    if (!messages || !messages.length) {
      container.innerHTML = t.emptyHtml;
      return true;
    }

    var lastDayKey = '';
    messages.forEach(function(m, i) {
      var parts = msgTimeParts(m.createdAt);
      if (parts.dayKey && parts.dayKey !== lastDayKey) {
        lastDayKey = parts.dayKey;
        var sep = document.createElement('div');
        sep.className = t.dateSep;
        sep.innerHTML = '<span>' + escapeHtml(parts.dayLabel) + '</span>';
        container.appendChild(sep);
      }
      container.appendChild(buildRow(m, i, messages, theme));
    });

    if (options.scroll !== false) {
      container.scrollTop = container.scrollHeight;
    }
    return true;
  }

  function patchReadMarks(container, theme) {
    if (!container) return;
    var t = THEMES[theme] || THEMES.teacher;
    container.querySelectorAll('.' + t.row + '.mine .' + t.readMark).forEach(function(el) {
      el.remove();
    });
  }

  global.MrParkMessengerUI = {
    THEMES: THEMES,
    escapeHtml: escapeHtml,
    msgTimeParts: msgTimeParts,
    fingerprint: fingerprint,
    autoGrow: autoGrow,
    destroyAutoGrow: destroyAutoGrow,
    buildRow: buildRow,
    renderThread: renderThread,
    patchReadMarks: patchReadMarks
  };
})(window);
