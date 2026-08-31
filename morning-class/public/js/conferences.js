/* Parent + Teacher conference scheduler UI */
(function (global) {
  function t(key, fallback) {
    return (global.SaltI18n && SaltI18n.t) ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function meetingTypeLabel(type) {
    const map = {
      InPerson: t('conf.type.inPerson', 'In person'),
      Phone: t('conf.type.phone', 'Phone'),
      Zoom: t('conf.type.zoom', 'Zoom'),
      Any: t('conf.type.any', 'Parent chooses')
    };
    return map[type] || type || '';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function isoDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = x.getDay();
    x.setDate(x.getDate() + (day === 0 ? -6 : 1 - day));
    return x;
  }

  function parseHm(raw) {
    const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function formatHm(totalMin) {
    const h = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    return pad2(h) + ':' + pad2(min);
  }

  const Parent = (function () {
    let api = null;
    let $ = null;
    let escapeHtml = null;
    let selectedScheduleId = '';

    function init(deps) {
      api = function (path, opts) { return deps.api(path, opts, 'parent'); };
      $ = deps.$;
      escapeHtml = deps.escapeHtml;
    }

    async function open() {
      selectedScheduleId = '';
      const box = $('ppConfMount');
      if (!box) return;
      box.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
      try {
        const data = await api('/api/parent/conferences/available');
        render(box, data);
      } catch (e) {
        box.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }

    function render(box, data) {
      const teachers = data.teachers || [];
      const mine = data.myBookings || [];
      let html = '';
      if (mine.length) {
        html += '<h4 style="margin:0 0 0.5rem">' + escapeHtml(t('parent.conf.myBookings', 'My bookings')) + '</h4>';
        html += mine.map((b) =>
          '<div class="card" style="margin:0 0 0.65rem;padding:0.75rem;border:1px solid var(--border-soft)">' +
          '<strong>' + escapeHtml(b.teacherName || b.teacherId) + '</strong> · ' +
          escapeHtml((b.date || '') + ' ' + (b.timeSlot || '')) +
          ' <span class="muted small">(' + escapeHtml(meetingTypeLabel(b.type) || b.status || 'Booked') + ')</span>' +
          (b.parentNote ? '<div class="muted small">' + escapeHtml(t('parent.conf.note', 'Questions for the teacher')) +
            ': ' + escapeHtml(b.parentNote) + '</div>' : '') +
          (b.teacherNote ? '<div style="margin-top:0.35rem">' + escapeHtml(t('parent.conf.teacherNote', 'Teacher note')) +
            ': ' + escapeHtml(b.teacherNote) + '</div>' : '') +
          (b.status === 'Booked'
            ? '<button type="button" class="btn btn-ghost" style="margin-top:0.4rem" data-conf-cancel="' +
              escapeHtml(b.bookingId) + '">' + escapeHtml(t('parent.conf.cancel', 'Cancel booking')) + '</button>'
            : '') +
          '</div>'
        ).join('');
      }
      if (!teachers.length) {
        html += '<p class="muted">' + escapeHtml(t('parent.conf.empty', 'No conference slots are open right now.')) + '</p>';
        box.innerHTML = html;
        return;
      }
      html += teachers.map((tr) => {
        const slots = (tr.slots || []).map((s) => {
          const taken = !s.available;
          return '<button type="button" class="conf-slot' + (taken ? ' is-taken' : '') + '"' +
            (taken ? ' disabled' : '') +
            ' data-schedule="' + escapeHtml(s.scheduleId) + '"' +
            ' data-label="' + escapeHtml((s.date || '') + ' ' + (s.timeSlot || '')) + '">' +
            escapeHtml((s.date || '') + ' · ' + (s.timeSlot || '')) +
            (taken ? ' [' + escapeHtml(t('parent.conf.full', 'Full')) + ']' : '') +
            '</button>';
        }).join('');
        return '<div class="card" style="margin:0 0 1rem;padding:0.85rem;border:1px solid var(--border-soft)">' +
          '<h4 style="margin:0 0 0.55rem">' + escapeHtml(tr.teacherName) + '</h4>' +
          '<div class="conf-slot-grid">' + slots + '</div></div>';
      }).join('');
      html +=
        '<div id="ppConfBookPanel" class="card hidden" style="padding:0.85rem;border:1px solid var(--border-soft)">' +
        '<h4 style="margin:0 0 0.5rem">' + escapeHtml(t('parent.conf.confirm', 'Confirm booking')) + '</h4>' +
        '<p class="muted small" id="ppConfSelectedLabel"></p>' +
        '<div class="conf-type-row" role="radiogroup" aria-label="' +
        escapeHtml(t('parent.conf.meetingType', 'How would you like to meet?')) + '">' +
        '<label><input type="radio" name="ppConfType" value="InPerson" checked> ' +
        escapeHtml(t('conf.type.inPerson', 'In person')) + '</label>' +
        '<label><input type="radio" name="ppConfType" value="Phone"> ' +
        escapeHtml(t('conf.type.phone', 'Phone')) + '</label>' +
        '<label><input type="radio" name="ppConfType" value="Zoom"> ' +
        escapeHtml(t('conf.type.zoom', 'Zoom')) + '</label>' +
        '</div>' +
        '<label style="display:block;margin:0.5rem 0">' +
        '<span class="muted small">' + escapeHtml(t('parent.conf.note', 'Questions for the teacher')) + '</span>' +
        '<textarea id="ppConfNote" rows="3" maxlength="500" style="width:100%"></textarea></label>' +
        '<button type="button" class="btn btn-primary" id="ppConfBookBtn">' +
        escapeHtml(t('parent.conf.book', 'Book this slot')) + '</button>' +
        '<p class="error" id="ppConfErr" style="margin:0.5rem 0 0"></p>' +
        '<p class="ok" id="ppConfOk" style="margin:0.5rem 0 0"></p></div>';
      box.innerHTML = html;

      box.querySelectorAll('[data-conf-cancel]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('parent.conf.cancelConfirm', 'Cancel this booking?'))) return;
          try {
            await api('/api/parent/conferences/' + encodeURIComponent(btn.dataset.confCancel) + '/cancel', {
              method: 'POST'
            });
            open();
          } catch (e) { alert(e.message); }
        });
      });

      box.querySelectorAll('.conf-slot:not([disabled])').forEach((btn) => {
        btn.addEventListener('click', () => {
          box.querySelectorAll('.conf-slot').forEach((b) => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          selectedScheduleId = btn.dataset.schedule;
          const panel = $('ppConfBookPanel');
          if (panel) panel.classList.remove('hidden');
          if ($('ppConfSelectedLabel')) {
            $('ppConfSelectedLabel').textContent = btn.dataset.label || '';
          }
          if ($('ppConfErr')) $('ppConfErr').textContent = '';
          if ($('ppConfOk')) $('ppConfOk').textContent = '';
        });
      });
      if ($('ppConfBookBtn')) {
        $('ppConfBookBtn').addEventListener('click', book);
      }
    }

    function selectedMeetingType() {
      const el = document.querySelector('input[name="ppConfType"]:checked');
      return (el && el.value) || 'InPerson';
    }

    async function book() {
      const err = $('ppConfErr');
      const ok = $('ppConfOk');
      if (err) err.textContent = '';
      if (ok) ok.textContent = '';
      if (!selectedScheduleId) {
        if (err) err.textContent = t('parent.conf.pickSlot', 'Please pick a time.');
        return;
      }
      try {
        $('ppConfBookBtn').disabled = true;
        await api('/api/parent/conferences/book', {
          method: 'POST',
          body: {
            scheduleId: selectedScheduleId,
            meetingType: selectedMeetingType(),
            parentNote: ($('ppConfNote') && $('ppConfNote').value) || ''
          }
        });
        if (ok) ok.textContent = t('parent.conf.booked', 'Booked.');
        setTimeout(open, 700);
      } catch (e) {
        if (err) err.textContent = e.message;
        $('ppConfBookBtn').disabled = false;
      }
    }

    return { init, open };
  })();

  const Teacher = (function () {
    let api = null;
    let $ = null;
    let escapeHtml = null;
    let role = 'teacher';
    let weekMonday = mondayOf(new Date());
    let slotMinutes = 15;
    let locationText = '';
    let cachedTt = null;
    const cellQueue = {};

    function init(deps) {
      api = function (path, opts) { return deps.api(path, opts, role); };
      $ = deps.$;
      escapeHtml = deps.escapeHtml;
      role = deps.role || 'teacher';
    }

    async function open() {
      await refresh();
    }

    function dayDates() {
      const out = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(weekMonday.getFullYear(), weekMonday.getMonth(), weekMonday.getDate() + i);
        out.push({ dayOfWeek: i + 1, date: isoDate(d), label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i], d: d });
      }
      return out;
    }

    function buildRows(tt) {
      const lessons = (tt && tt.lessonPeriods) || [];
      const step = slotMinutes;
      const rows = [];
      lessons.forEach((p, idx) => {
        const start = parseHm(p.startTime);
        const end = parseHm(p.endTime);
        if (start == null || end == null || end <= start) return;
        rows.push({
          kind: 'period',
          label: p.label || ('P' + (idx + 1)),
          startMin: start,
          endMin: end,
          startTime: formatHm(start),
          endTime: formatHm(end)
        });
      });
      let afterStart = rows.length ? rows[rows.length - 1].endMin : parseHm('15:00');
      const afterEnd = parseHm('19:00');
      if (afterStart == null) afterStart = 15 * 60;
      if (afterEnd != null && afterEnd > afterStart) {
        for (let tMin = afterStart; tMin + step <= afterEnd; tMin += step) {
          rows.push({
            kind: 'after',
            label: t('teacher.conf.afterSchool', 'After school'),
            startMin: tMin,
            endMin: tMin + step,
            startTime: formatHm(tMin),
            endTime: formatHm(tMin + step)
          });
        }
      }
      return rows;
    }

    function slotForCell(schedules, date, startTime, endTime) {
      const want = startTime + '-' + endTime;
      const exact = (schedules || []).filter((s) => s.date === date && s.timeSlot === want && s.status !== 'Closed');
      if (exact.length) return exact[0];
      const a = parseHm(startTime);
      const b = parseHm(endTime);
      return (schedules || []).find((s) => {
        if (s.date !== date || s.status === 'Closed') return false;
        const m = String(s.timeSlot || '').match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
        if (!m) return false;
        const s0 = parseHm(m[1]);
        const s1 = parseHm(m[2]);
        return s0 != null && s1 != null && s0 < b && a < s1;
      }) || null;
    }

    function busyEntry(byDay, dayOfWeek, startMin, endMin) {
      const list = (byDay && (byDay[dayOfWeek] || byDay[String(dayOfWeek)])) || [];
      return list.find((e) => {
        if (!e || e.isBreak) return false;
        const a = parseHm(e.startTime);
        const b = parseHm(e.endTime);
        if (a == null || b == null) return false;
        return a < endMin && startMin < b;
      }) || null;
    }

    async function refresh(opts) {
      opts = opts || {};
      const board = $('tchConfBoard');
      const bookBox = $('tchConfBookedList');
      const hasGrid = !!(board && board.querySelector('.conf-grid'));
      if (board && !hasGrid) board.innerHTML = '<p class="muted">…</p>';
      if (bookBox && !opts.keepBooked) bookBox.innerHTML = '<p class="muted">…</p>';
      try {
        const ttPromise = (cachedTt && !opts.reloadTt)
          ? Promise.resolve({ timetable: cachedTt })
          : api('/api/teacher/timetable');
        const [ttRes, dash] = await Promise.all([
          ttPromise,
          api('/api/teacher/conferences')
        ]);
        const tt = ttRes.timetable || ttRes;
        cachedTt = tt;
        renderBoard(board, tt, dash);
        if (!opts.keepBooked) renderBooked(bookBox, dash);
      } catch (e) {
        if (board && !hasGrid) board.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
        else {
          const err = $('tchConfErr');
          if (err) err.textContent = e.message;
        }
      }
    }

    function paintCell(btn, open) {
      if (!btn) return;
      btn.classList.toggle('is-open', !!open);
      btn.textContent = open
        ? t('teacher.conf.openSlot', 'Open')
        : '+';
    }

    function cellKey(btn) {
      return [btn.dataset.date, btn.dataset.start, btn.dataset.end].join('|');
    }

    function enqueueCell(btn, desiredOpen) {
      const key = cellKey(btn);
      if (!cellQueue[key]) cellQueue[key] = { running: false, desired: null, btn: btn };
      const q = cellQueue[key];
      q.btn = btn;
      q.desired = desiredOpen ? 'open' : 'close';
      paintCell(btn, desiredOpen);
      drainCell(key);
    }

    async function drainCell(key) {
      const q = cellQueue[key];
      if (!q || q.running) return;
      q.running = true;
      const err = $('tchConfErr');
      while (q.desired) {
        const want = q.desired;
        q.desired = null;
        try {
          await api('/api/teacher/conferences/toggle', {
            method: 'POST',
            body: {
              date: q.btn.dataset.date,
              startTime: q.btn.dataset.start,
              endTime: q.btn.dataset.end,
              slotMinutes: slotMinutes,
              location: ($('tchConfLoc') && $('tchConfLoc').value) || locationText,
              desired: want
            }
          });
          if (err) err.textContent = '';
        } catch (e) {
          paintCell(q.btn, want !== 'open');
          if (err) err.textContent = e.message;
          break;
        }
      }
      q.running = false;
      if (q.desired) drainCell(key);
    }

    function renderBoard(board, tt, dash) {
      if (!board) return;
      const days = dayDates();
      const rows = buildRows(tt);
      const schedules = (dash && dash.schedules) || [];
      const weekLabel = days[0].label + ' ' + days[0].date.slice(5) + ' – ' + days[4].label + ' ' + days[4].date.slice(5);

      let html = '<div class="conf-board-toolbar">' +
        '<label>' + escapeHtml(t('teacher.conf.duration', 'Slot length')) +
        '<select id="tchConfMins">' +
        [15, 20, 30].map((n) =>
          '<option value="' + n + '"' + (n === slotMinutes ? ' selected' : '') + '>' + n + ' min</option>'
        ).join('') +
        '</select></label>' +
        '<label>' + escapeHtml(t('teacher.conf.location', 'Room / notes')) +
        '<input id="tchConfLoc" maxlength="120" value="' + escapeHtml(locationText) +
        '" placeholder="' + escapeHtml(t('teacher.conf.locationPh', 'Room number')) + '"></label>' +
        '</div>' +
        '<p class="muted small">' + escapeHtml(t('teacher.conf.boardHelp',
          'Click an empty cell to open or close that conference slot. Parents choose in person, phone, or Zoom.')) +
        '</p>' +
        '<p class="error" id="tchConfErr" style="margin:0 0 0.5rem"></p>' +
        '<div class="conf-weekbar">' +
        '<button type="button" class="btn btn-ghost" id="tchConfPrevWeek" aria-label="Previous week">‹</button>' +
        '<strong>' + escapeHtml(weekLabel) + '</strong>' +
        '<button type="button" class="btn btn-ghost" id="tchConfNextWeek" aria-label="Next week">›</button>' +
        '<button type="button" class="btn btn-ghost" id="tchConfThisWeek">' +
        escapeHtml(t('teacher.conf.thisWeek', 'This week')) + '</button>' +
        '</div>' +
        '<div class="conf-grid-wrap"><table class="conf-grid"><thead><tr>' +
        '<th>' + escapeHtml(t('teacher.conf.time', 'Time')) + '</th>' +
        days.map((d) => '<th>' + escapeHtml(d.label) + '<div class="muted small">' + escapeHtml(d.date.slice(5)) + '</div></th>').join('') +
        '</tr></thead><tbody>';

      rows.forEach((row) => {
        html += '<tr><th>' + escapeHtml(row.kind === 'period' ? row.label : '') +
          '<div class="muted small">' + escapeHtml(row.startTime + '–' + row.endTime) + '</div></th>';
        days.forEach((d) => {
          const busy = busyEntry(tt.byDay, d.dayOfWeek, row.startMin, row.endMin);
          if (busy) {
            const title = (busy.className || busy.classId || '') +
              (busy.subject ? ' · ' + busy.subject : '');
            html += '<td class="conf-cell-busy">' + escapeHtml(title || t('teacher.conf.busy', 'Class')) + '</td>';
            return;
          }
          const slot = slotForCell(schedules, d.date, row.startTime, row.endTime);
          const booked = slot && slot.status === 'Booked';
          const open = slot && slot.status === 'Open';
          const cls = booked ? ' is-booked' : (open ? ' is-open' : '');
          const label = booked
            ? escapeHtml(t('teacher.conf.booked', 'Booked'))
            : (open ? escapeHtml(t('teacher.conf.openSlot', 'Open')) : '+');
          html += '<td><button type="button" class="conf-cell-btn' + cls + '"' +
            (booked ? ' disabled' : '') +
            ' data-date="' + escapeHtml(d.date) + '"' +
            ' data-start="' + escapeHtml(row.startTime) + '"' +
            ' data-end="' + escapeHtml(row.endTime) + '">' + label + '</button></td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      board.innerHTML = html;

      const mins = $('tchConfMins');
      if (mins) {
        mins.addEventListener('change', () => {
          slotMinutes = Number(mins.value) || 15;
          refresh();
        });
      }
      const loc = $('tchConfLoc');
      if (loc) loc.addEventListener('change', () => { locationText = loc.value || ''; });

      if ($('tchConfPrevWeek')) {
        $('tchConfPrevWeek').addEventListener('click', () => {
          weekMonday = new Date(weekMonday.getFullYear(), weekMonday.getMonth(), weekMonday.getDate() - 7);
          refresh();
        });
      }
      if ($('tchConfNextWeek')) {
        $('tchConfNextWeek').addEventListener('click', () => {
          weekMonday = new Date(weekMonday.getFullYear(), weekMonday.getMonth(), weekMonday.getDate() + 7);
          refresh();
        });
      }
      if ($('tchConfThisWeek')) {
        $('tchConfThisWeek').addEventListener('click', () => {
          weekMonday = mondayOf(new Date());
          refresh();
        });
      }

      board.querySelectorAll('.conf-cell-btn:not([disabled])').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (btn.classList.contains('is-booked')) return;
          enqueueCell(btn, !btn.classList.contains('is-open'));
        });
      });
    }

    function renderBooked(bookBox, data) {
      if (!bookBox) return;
      const booked = (data && data.booked) || [];
      bookBox.innerHTML = booked.length
        ? booked.map((s) => {
            const b = s.booking || {};
            return '<div class="card" style="margin:0 0 0.75rem;padding:0.75rem;border:1px solid var(--border-soft)">' +
              '<strong>' + escapeHtml(s.studentName || b.studentId || '') + '</strong> ' +
              '<span class="muted small">' + escapeHtml(s.classId || '') + '</span>' +
              '<div class="muted small">' + escapeHtml((s.date || '') + ' · ' + (s.timeSlot || '') +
                ' · ' + meetingTypeLabel(s.type)) + '</div>' +
              '<p style="margin:0.4rem 0">' + escapeHtml(t('teacher.conf.parentNote', 'Parent note')) +
              ': ' + escapeHtml(b.parentNote || '—') + '</p>' +
              '<label class="muted small">' + escapeHtml(t('teacher.conf.note', 'Conference note')) +
              '<textarea data-note-for="' + escapeHtml(b.bookingId || '') + '" rows="2" style="width:100%">' +
              escapeHtml(b.teacherNote || '') + '</textarea></label>' +
              '<div style="margin-top:0.4rem;display:flex;gap:0.4rem;flex-wrap:wrap">' +
              '<button type="button" class="btn btn-primary" data-save-note="' +
              escapeHtml(b.bookingId || '') + '">' +
              escapeHtml(t('teacher.conf.saveNote', 'Save note')) + '</button>' +
              '<button type="button" class="btn btn-ghost" data-complete-note="' +
              escapeHtml(b.bookingId || '') + '">' +
              escapeHtml(t('teacher.conf.complete', 'Mark complete')) + '</button></div></div>';
          }).join('')
        : '<p class="muted">' + escapeHtml(t('teacher.conf.noBooked', 'No bookings')) + '</p>';
      bookBox.querySelectorAll('[data-save-note], [data-complete-note]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.saveNote || btn.dataset.completeNote;
          const ta = bookBox.querySelector('[data-note-for="' + id + '"]');
          try {
            await api('/api/teacher/conferences/notes', {
              method: 'POST',
              body: {
                bookingId: id,
                teacherNote: ta ? ta.value : '',
                markCompleted: !!btn.dataset.completeNote
              }
            });
            refresh();
          } catch (e) { alert(e.message); }
        });
      });
    }

    return { init, open };
  })();

  global.SaltConferences = { Parent, Teacher };
})(window);
