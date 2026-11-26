/**
 * Admin learning status: video watch progress + oral debrief results.
 */
(function (global) {
  'use strict';

  var deps = null;
  var loaded = null;

  function t(key, fallback) {
    if (deps && typeof deps.t === 'function') return deps.t(key, fallback);
    if (global.SaltI18n && SaltI18n.t) return SaltI18n.t(key, fallback);
    return fallback;
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function lessonSummary(lessons) {
    if (!lessons || !lessons.total) return t('admin.learning.none', 'None assigned');
    var pct = lessons.avgPercent == null ? '' : (' · ' + lessons.avgPercent + '%');
    return lessons.completed + '/' + lessons.total + pct;
  }

  function debriefSummary(debrief) {
    if (!debrief || !debrief.total) return t('admin.learning.none', 'None assigned');
    var score = debrief.avgScore == null ? '' : (' · ' + debrief.avgScore);
    return debrief.completed + '/' + debrief.total + score;
  }

  function statusLabel(status) {
    if (status === 'completed') return t('admin.learning.completed', 'Done');
    if (status === 'in_progress') return t('admin.learning.inProgress', 'In progress');
    return t('admin.learning.assigned', 'Assigned');
  }

  function detailHtml(st) {
    var esc = deps.escapeHtml;
    var lessons = ((st.lessons && st.lessons.items) || []).map(function (l) {
      return '<li>' + esc(l.title || '') + ' — ' + (l.percent || 0) + '% · ' + fmtDuration(l.watchedSeconds) +
        (l.completed ? ' · ' + esc(t('admin.learning.completed', 'Done')) : '') + '</li>';
    }).join('') || '<li class="muted">' + esc(t('admin.learning.none', 'None assigned')) + '</li>';
    var debriefs = ((st.debrief && st.debrief.items) || []).map(function (d) {
      var score = d.gradeTotal == null
        ? t('admin.learning.ungraded', 'Not graded')
        : (d.gradeTotal + (d.reportReleased ? '' : ''));
      return '<li>' + esc(d.title || '') + ' — ' + esc(statusLabel(d.status)) + ' · ' + esc(String(score)) + '</li>';
    }).join('') || '<li class="muted">' + esc(t('admin.learning.none', 'None assigned')) + '</li>';
    return '<div class="learn-detail">' +
      '<div><strong>' + esc(t('admin.learning.videos', 'Videos')) + '</strong><ul>' + lessons + '</ul></div>' +
      '<div><strong>' + esc(t('admin.learning.debrief', 'Debrief')) + '</strong><ul>' + debriefs + '</ul></div>' +
      '</div>';
  }

  function render(data) {
    var box = deps.$('learnBoard');
    if (!box) return;
    var esc = deps.escapeHtml;
    var students = (data && data.students) || [];
    if (!students.length) {
      box.innerHTML = '<p class="muted">' + esc(t('admin.learning.empty', 'No students in this view.')) + '</p>';
      return;
    }
    var rows = students.map(function (st, i) {
      return '<tr class="learn-row" data-learn-i="' + i + '" tabindex="0">' +
        '<td>' + esc(st.name || st.studentId) + '</td>' +
        '<td>' + esc(st.className || st.classId || '') + '</td>' +
        '<td>' + esc(lessonSummary(st.lessons)) + '</td>' +
        '<td>' + esc(debriefSummary(st.debrief)) + '</td>' +
        '</tr>' +
        '<tr class="learn-detail-row hidden" data-learn-detail="' + i + '"><td colspan="4">' +
        detailHtml(st) + '</td></tr>';
    }).join('');
    box.innerHTML =
      '<table class="grades-table"><thead><tr>' +
      '<th>' + esc(t('admin.learning.student', 'Student')) + '</th>' +
      '<th>' + esc(t('admin.learning.class', 'Class')) + '</th>' +
      '<th>' + esc(t('admin.learning.videos', 'Videos')) + '</th>' +
      '<th>' + esc(t('admin.learning.debrief', 'Debrief')) + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
    box.querySelectorAll('.learn-row').forEach(function (row) {
      function toggle() {
        var detail = box.querySelector('[data-learn-detail="' + row.getAttribute('data-learn-i') + '"]');
        if (detail) detail.classList.toggle('hidden');
      }
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });
  }

  function fillClasses(classes) {
    var sel = deps.$('learnClass');
    if (!sel) return;
    var current = sel.value;
    var all = t('admin.learning.allClasses', 'All classes');
    sel.innerHTML = '<option value="">' + deps.escapeHtml(all) + '</option>' +
      (classes || []).map(function (c) {
        return '<option value="' + deps.escapeHtml(c.classId) + '">' + deps.escapeHtml(c.name || c.classId) + '</option>';
      }).join('');
    if (current) sel.value = current;
  }

  async function open() {
    var box = deps.$('learnBoard');
    if (box) box.innerHTML = '<p class="muted">Loading…</p>';
    var classId = (deps.$('learnClass') && deps.$('learnClass').value) || '';
    var q = classId ? ('?classId=' + encodeURIComponent(classId)) : '';
    try {
      loaded = await deps.api('/api/admin/learning-status' + q, {}, deps.role);
      fillClasses(loaded.classes || []);
      if (classId && deps.$('learnClass')) deps.$('learnClass').value = classId;
      render(loaded);
    } catch (e) {
      if (box) box.innerHTML = '<p class="error">' + deps.escapeHtml(e.message || 'Failed to load') + '</p>';
    }
  }

  function init(options) {
    deps = options || {};
    var btn = deps.$('learnRefresh');
    var sel = deps.$('learnClass');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () { open(); });
    }
    if (sel && !sel.dataset.bound) {
      sel.dataset.bound = '1';
      sel.addEventListener('change', function () { open(); });
    }
  }

  global.SaltAdminLearning = { init: init, open: open, render: render };
})(window);
