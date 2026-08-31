/* Parent + Teacher conference scheduler UI */
(function (global) {
  function t(key, fallback) {
    return (global.SaltI18n && SaltI18n.t) ? SaltI18n.t(key, fallback) : (fallback || key);
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
          ' <span class="muted small">(' + escapeHtml(b.status || 'Booked') + ')</span>' +
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
            '<span class="muted small" style="display:block;font-weight:500">' +
            escapeHtml(s.type || '') + (s.location ? ' · ' + s.location : '') +
            '</span></button>';
        }).join('');
        return '<div class="card" style="margin:0 0 1rem;padding:0.85rem;border:1px solid var(--border-soft)">' +
          '<h4 style="margin:0 0 0.55rem">' + escapeHtml(tr.teacherName) + '</h4>' +
          '<div class="conf-slot-grid">' + slots + '</div></div>';
      }).join('');
      html +=
        '<div id="ppConfBookPanel" class="card hidden" style="padding:0.85rem;border:1px solid var(--border-soft)">' +
        '<h4 style="margin:0 0 0.5rem">' + escapeHtml(t('parent.conf.confirm', 'Confirm booking')) + '</h4>' +
        '<p class="muted small" id="ppConfSelectedLabel"></p>' +
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

    function init(deps) {
      api = function (path, opts) { return deps.api(path, opts, role); };
      $ = deps.$;
      escapeHtml = deps.escapeHtml;
      role = deps.role || 'teacher';
    }

    async function open() {
      await refresh();
      bindForm();
    }

    function bindForm() {
      const btn = $('tchConfOpenBtn');
      if (!btn || btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', async () => {
        const err = $('tchConfErr');
        if (err) err.textContent = '';
        try {
          btn.disabled = true;
          const body = {
            date: ($('tchConfDate') && $('tchConfDate').value) || '',
            startTime: ($('tchConfStart') && $('tchConfStart').value) || '09:00',
            endTime: ($('tchConfEnd') && $('tchConfEnd').value) || '12:00',
            slotMinutes: Number(($('tchConfMins') && $('tchConfMins').value) || 15),
            type: ($('tchConfType') && $('tchConfType').value) || 'InPerson',
            location: ($('tchConfLoc') && $('tchConfLoc').value) || '',
            targetGrade: ($('tchConfTarget') && $('tchConfTarget').value) || '*'
          };
          const res = await api('/api/teacher/conferences/schedules', { method: 'POST', body });
          if (err) {
            err.style.color = '#16a34a';
            err.textContent = t('teacher.conf.opened', 'Slots opened') + ': ' + (res.count || 0);
          }
          await refresh();
        } catch (e) {
          if (err) {
            err.style.color = '#dc2626';
            err.textContent = e.message;
          }
        } finally {
          btn.disabled = false;
        }
      });
    }

    async function refresh() {
      const openBox = $('tchConfOpenList');
      const bookBox = $('tchConfBookedList');
      if (openBox) openBox.innerHTML = '<p class="muted">…</p>';
      if (bookBox) bookBox.innerHTML = '<p class="muted">…</p>';
      try {
        const data = await api('/api/teacher/conferences');
        if (openBox) {
          const open = data.open || [];
          openBox.innerHTML = open.length
            ? '<table class="grades-table"><thead><tr><th>Date</th><th>Slot</th><th>Type</th><th></th></tr></thead><tbody>' +
              open.map((s) =>
                '<tr><td>' + escapeHtml(s.date) + '</td><td>' + escapeHtml(s.timeSlot) + '</td>' +
                '<td>' + escapeHtml(s.type) + (s.location ? ' · ' + escapeHtml(s.location) : '') + '</td>' +
                '<td><button type="button" class="btn btn-ghost" data-conf-close="' +
                escapeHtml(s.scheduleId) + '">Close</button></td></tr>'
              ).join('') + '</tbody></table>'
            : '<p class="muted">' + escapeHtml(t('teacher.conf.noOpen', 'No open slots')) + '</p>';
          openBox.querySelectorAll('[data-conf-close]').forEach((b) => {
            b.addEventListener('click', async () => {
              if (!confirm('Close this slot?')) return;
              try {
                await api('/api/teacher/conferences/schedules/' + encodeURIComponent(b.dataset.confClose) + '/close', {
                  method: 'POST'
                });
                refresh();
              } catch (e) { alert(e.message); }
            });
          });
        }
        if (bookBox) {
          const booked = data.booked || [];
          bookBox.innerHTML = booked.length
            ? booked.map((s) => {
                const b = s.booking || {};
                return '<div class="card" style="margin:0 0 0.75rem;padding:0.75rem;border:1px solid var(--border-soft)">' +
                  '<strong>' + escapeHtml(s.studentName || b.studentId || '') + '</strong> ' +
                  '<span class="muted small">' + escapeHtml(s.classId || '') + '</span>' +
                  '<div class="muted small">' + escapeHtml((s.date || '') + ' · ' + (s.timeSlot || '') +
                    ' · ' + (s.type || '')) + '</div>' +
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
      } catch (e) {
        if (openBox) openBox.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }

    return { init, open };
  })();

  global.SaltConferences = { Parent, Teacher };
})(window);
