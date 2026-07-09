/* Salt Morning Class — Quickschools-style gradebook */
window.SaltGrades = (function() {
  let deps = {};
  let gradebook = null;
  let weightDraft = [];
  let categoryPresets = [];
  let syncTimer = null;
  let highlightColumnId = null;

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function todayISO() { return deps.todayISO(); }
  function getClass() { return deps.getClass ? deps.getClass() : null; }
  function api(path, opts) { return deps.api(path, opts, 'teacher'); }

  function term() { return $('gradeTerm').value.trim(); }
  function subject() { return $('gradeSubject').value.trim(); }

  function letterGrade(pct) {
    if (pct == null || pct === '' || Number.isNaN(Number(pct))) return '';
    const p = Number(pct);
    if (p >= 93) return 'A';
    if (p >= 90) return 'A-';
    if (p >= 87) return 'B+';
    if (p >= 83) return 'B';
    if (p >= 80) return 'B-';
    if (p >= 77) return 'C+';
    if (p >= 73) return 'C';
    if (p >= 70) return 'C-';
    if (p >= 67) return 'D+';
    if (p >= 60) return 'D';
    return 'F';
  }

  function init(options) {
    deps = options;
    $('gradeWeightsBtn').addEventListener('click', openWeightsModal);
    $('gradeWeightsClose').addEventListener('click', () => deps.hide($('gradeWeightsModal')));
    $('gradeWeightsSave').addEventListener('click', saveWeights);
    $('gradeWeightAdd').addEventListener('click', addWeightRow);
    $('gradeAddColumnBtn').addEventListener('click', openColumnModal);
    $('gradeColumnClose').addEventListener('click', () => deps.hide($('gradeColumnModal')));
    $('gradeColumnForm').addEventListener('submit', submitColumn);
  }

  async function onClassOpen() {
    const cls = getClass();
    if (cls && cls.subjects && cls.subjects !== 'All subjects') {
      $('gradeSubject').value = cls.subjects.split(',')[0].trim();
    } else {
      $('gradeSubject').value = 'English';
    }
    await loadActiveTerm();
    await loadGradebook();
    await loadLessonWeights();
  }

  async function loadActiveTerm() {
    const cls = getClass();
    if (!cls) return;
    $('gradeContextLabel').textContent = 'Loading term…';
    try {
      const data = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/grades/active-term');
      if (!data.term) {
        $('gradeTerm').value = '';
        $('gradeContextLabel').textContent = data.message || 'No term set — contact admin.';
        return;
      }
      $('gradeTerm').value = data.term.label;
      $('reportTerm').value = data.term.label;
      $('gradeContextLabel').textContent =
        subject() + ' · ' + data.term.label + ' (' + data.term.startDate + ' – ' + data.term.endDate + ')';
    } catch (e) {
      $('gradeContextLabel').textContent = e.message || 'Could not load term.';
    }
  }

  function aggregateCategoryPercent(entries, aggregation) {
    if (!entries.length) return null;
    const sorted = entries.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const percents = sorted.map((e) => {
      const max = Number(e.maxScore) || 100;
      return Math.round((Number(e.score) / max) * 1000) / 10;
    });
    if (aggregation === 'single' || aggregation === 'latest') return percents[0];
    if (aggregation === 'best') return Math.max(...percents);
    return Math.round((percents.reduce((a, b) => a + b, 0) / percents.length) * 10) / 10;
  }

  function computeStudentFinal(studentId, weights, entriesByCategory) {
    let weightedTotal = 0;
    for (const w of weights) {
      const catEntries = (entriesByCategory[w.categoryKey] || []).filter((e) => e.studentId === studentId);
      const categoryPercent = aggregateCategoryPercent(catEntries, w.aggregation);
      if (categoryPercent != null) {
        weightedTotal += Math.round(categoryPercent * w.weightPercent) / 100;
      }
    }
    return weights.length ? Math.round(weightedTotal * 10) / 10 : null;
  }

  function buildEntriesFromGradebook() {
    const entriesByCategory = {};
    const cols = gridMeta.cols || [];
    (gradebook.students || []).forEach((st) => {
      cols.forEach((col) => {
        const cell = st.cells && st.cells[col.assessmentId];
        if (!cell || cell.score == null || cell.score === '') return;
        const entry = {
          studentId: st.studentId,
          score: cell.score,
          maxScore: cell.maxScore != null ? cell.maxScore : col.maxScore,
          categoryKey: col.categoryKey,
          date: col.date
        };
        if (!entriesByCategory[col.categoryKey]) entriesByCategory[col.categoryKey] = [];
        entriesByCategory[col.categoryKey].push(entry);
      });
    });
    return entriesByCategory;
  }

  function recomputeFinalGradesLocally() {
    if (!gradebook) return;
    const weights = gradebook.weights || [];
    const entriesByCategory = buildEntriesFromGradebook();
    (gradebook.students || []).forEach((st) => {
      st.finalGrade = computeStudentFinal(st.studentId, weights, entriesByCategory);
    });
    updateFinalGradesInDom(gradebook.students);
  }

  function sortColumnsByDate(cols) {
    return cols.slice().sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || '')) ||
      String(a.assessmentId || '').localeCompare(String(b.assessmentId || ''))
    );
  }

  async function loadGradebook(scrollToEnd) {
    const cls = getClass();
    const subj = subject();
    const t = term();
    if (!cls || !subj) return;
    if (!t) {
      $('gradebookMount').innerHTML = '<p class="muted">Term not configured. Contact admin.</p>';
      return;
    }
    $('gradesError').textContent = '';
    try {
      gradebook = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/grades/gradebook?term=' + encodeURIComponent(t) + '&subject=' + encodeURIComponent(subj));
      renderWeightSummary();
      const focusColId = highlightColumnId;
      renderGradebook();
      if (gridApi && (focusColId || scrollToEnd)) {
        const sorted = sortColumnsByDate((gradebook && gradebook.columns) || []);
        const target = focusColId ||
          (scrollToEnd && sorted.length ? sorted[sorted.length - 1].assessmentId : null);
        if (target) {
          setTimeout(() => gridApi.ensureColumnVisible(target), 0);
        }
      }
    } catch (e) {
      $('gradebookMount').innerHTML = '<p class="err">' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderWeightSummary() {
    const box = $('gradeWeightSummary');
    const weights = (gradebook && gradebook.weights) || [];
    if (!weights.length) {
      box.innerHTML = '<p class="muted">Set up <strong>Grade weights</strong> first (must total 100%).</p>';
      return;
    }
    const total = gradebook.weightTotal || 0;
    box.innerHTML = '<div class="gw-chips">' + weights.map((w) =>
      '<span class="gw-chip">' + escapeHtml(w.label) + ' <strong>' + w.weightPercent + '%</strong></span>'
    ).join('') + '</div>';
    if (total !== 100) {
      box.innerHTML += '<p class="muted small err">Weights total ' + total + '% (should be 100%)</p>';
    }
  }

  function formatColDate(dateStr) {
    const p = dateStr.split('-');
    if (p.length !== 3) return dateStr;
    return Number(p[1]) + '/' + Number(p[2]) + '/' + p[0].slice(2);
  }

  const COL_WIDTH = 108;
  let gridApi = null;
  let gridMeta = { cols: [] };

  function destroyGrid() {
    if (gridApi) {
      try { gridApi.destroy(); } catch (e) { /* ignore */ }
      gridApi = null;
    }
  }

  function scoreMetaKey(field) {
    return '_meta_' + field;
  }

  function buildAgRows(students, cols) {
    return students.map((st) => {
      const row = {
        studentId: st.studentId,
        name: st.name,
        finalGrade: st.finalGrade != null ? st.finalGrade : null
      };
      cols.forEach((col) => {
        const cell = st.cells && st.cells[col.assessmentId];
        const score = cell && cell.score != null ? Number(cell.score) : null;
        row[col.assessmentId] = score;
        row[scoreMetaKey(col.assessmentId)] = {
          maxScore: col.maxScore,
          percent: cell && cell.percent != null ? cell.percent : null,
          saved: score
        };
      });
      return row;
    });
  }

  function assessmentHeaderHtml(col) {
    const title = col.title || col.categoryLabel;
    const showCategory = col.categoryLabel && col.categoryLabel !== title;
    return (
      '<button type="button" class="gb-col-delete" data-aid="' + escapeHtml(col.assessmentId) +
      '" data-title="' + escapeHtml(title) + '" title="Delete column" aria-label="Delete column">×</button>' +
      '<div class="gb-col-title">' + escapeHtml(title) + '</div>' +
      '<div class="gb-col-meta">' + formatColDate(col.date) + ' · /' + col.maxScore + '</div>' +
      (showCategory ? '<div class="gb-col-meta gb-col-cat">' + escapeHtml(col.categoryLabel) + '</div>' : '')
    );
  }

  function AssessmentHeaderComponent() {}
  AssessmentHeaderComponent.prototype.init = function(params) {
    const col = params.column.getColDef().context.col;
    this.eGui = document.createElement('div');
    this.eGui.className = 'gb-ag-col-head';
    this.eGui.innerHTML = assessmentHeaderHtml(col);
    const btn = this.eGui.querySelector('.gb-col-delete');
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteColumn(col.assessmentId, col.title || col.categoryLabel);
      });
    }
  };
  AssessmentHeaderComponent.prototype.getGui = function() { return this.eGui; };

  function ScoreCellRenderer() {}
  ScoreCellRenderer.prototype.init = function(params) {
    this.params = params;
    this.eGui = document.createElement('div');
    this.eGui.className = 'gb-ag-score-cell';
    this.render();
  };
  ScoreCellRenderer.prototype.render = function() {
    const field = this.params.colDef.field;
    const val = this.params.value;
    const meta = this.params.data[scoreMetaKey(field)] || {};
    const pct = meta.percent != null ? meta.percent :
      (val != null && val !== '' ? Math.round(Number(val) / Number(meta.maxScore || 100) * 1000) / 10 : null);
    const letter = letterGrade(pct);
    const display = val == null || val === '' ? '—' : String(val);
    this.eGui.innerHTML =
      '<span class="gb-ag-score">' + escapeHtml(display) + '</span>' +
      (letter ? '<span class="gb-letter">' + escapeHtml(letter) + '</span>' : '');
  };
  ScoreCellRenderer.prototype.refresh = function(params) {
    this.params = params;
    this.render();
    return true;
  };
  ScoreCellRenderer.prototype.getGui = function() { return this.eGui; };

  function FinalCellRenderer() {}
  FinalCellRenderer.prototype.init = function(params) {
    this.params = params;
    this.eGui = document.createElement('div');
    this.eGui.className = 'gb-ag-final-cell';
    this.render();
  };
  FinalCellRenderer.prototype.render = function() {
    const val = this.params.value;
    const fg = val != null && val !== '' ? val : '—';
    const fgLetter = val != null && val !== '' ? letterGrade(val) : '';
    this.eGui.innerHTML =
      '<strong>' + escapeHtml(String(fg)) + '</strong>' +
      (fgLetter ? '<span class="gb-letter">' + escapeHtml(fgLetter) + '</span>' : '');
  };
  FinalCellRenderer.prototype.refresh = function(params) {
    this.params = params;
    this.render();
    return true;
  };
  FinalCellRenderer.prototype.getGui = function() { return this.eGui; };

  function buildAgColumnDefs(cols) {
    const defs = [{
      field: 'name',
      headerName: 'Students',
      pinned: 'left',
      width: 152,
      minWidth: 120,
      editable: false,
      suppressMovable: true,
      headerClass: 'gb-ag-name-header',
      cellClass: 'gb-ag-name-cell'
    }];

    cols.forEach((col) => {
      const isNew = col.assessmentId === highlightColumnId;
      defs.push({
        field: col.assessmentId,
        headerName: col.title || col.categoryLabel,
        width: COL_WIDTH,
        minWidth: COL_WIDTH,
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0, max: col.maxScore, precision: 1 },
        cellRenderer: ScoreCellRenderer,
        headerComponent: AssessmentHeaderComponent,
        headerClass: 'gb-ag-score-header' + (isNew ? ' gb-col-new' : ''),
        cellClass: 'gb-ag-score-cell-wrap' + (isNew ? ' gb-col-new' : ''),
        context: { col },
        tooltipValueGetter: function() {
          const title = col.title || col.categoryLabel;
          return title + ' · ' + formatColDate(col.date) + ' · /' + col.maxScore;
        },
        valueParser: function(params) {
          if (params.newValue === '' || params.newValue == null) return null;
          const n = Number(params.newValue);
          return Number.isNaN(n) ? params.oldValue : n;
        }
      });
    });

    defs.push({
      field: 'finalGrade',
      headerName: 'Final Grade',
      pinned: 'right',
      width: 92,
      minWidth: 92,
      editable: false,
      cellRenderer: FinalCellRenderer,
      headerClass: 'gb-ag-final-header',
      cellClass: 'gb-ag-final-cell-wrap'
    });
    return defs;
  }

  function renderGradebook() {
    if (typeof agGrid !== 'undefined' && agGrid.createGrid) {
      renderGradebookAg();
    } else {
      renderGradebookLegacy();
    }
  }

  function renderGradebookAg() {
    const mount = $('gradebookMount');
    if (!gradebook) {
      mount.innerHTML = '<p class="muted">Loading…</p>';
      return;
    }
    const weights = gradebook.weights || [];
    const cols = sortColumnsByDate(gradebook.columns || []);
    const students = gradebook.students || [];
    gridMeta.cols = cols;

    if (!students.length) {
      destroyGrid();
      mount.innerHTML = '<p class="muted">No students in this class.</p>';
      return;
    }

    const emptyHint = weights.length
      ? 'No columns yet — click + Add column'
      : 'Set up Grade weights, then click + Add column';

    if (!cols.length) {
      destroyGrid();
      mount.innerHTML = '<p class="muted">' + emptyHint + '</p>';
      highlightColumnId = null;
      return;
    }

    mount.innerHTML = '<div id="gradebookAgGrid" class="ag-theme-quartz ag-theme-salt gb-ag-wrap"></div>';
    destroyGrid();

    const gridOptions = {
      columnDefs: buildAgColumnDefs(cols),
      rowData: buildAgRows(students, cols),
      domLayout: 'autoHeight',
      defaultColDef: {
        sortable: false,
        filter: false,
        resizable: false,
        suppressHeaderMenuButton: true,
        wrapHeaderText: true,
        autoHeaderHeight: true
      },
      headerHeight: 64,
      rowHeight: 52,
      singleClickEdit: true,
      stopEditingWhenCellsLoseFocus: true,
      enableCellTextSelection: true,
      suppressMovableColumns: true,
      undoRedoCellEditing: true,
      enterNavigatesVertically: true,
      enterNavigatesVerticallyAfterEdit: true,
      onCellValueChanged: onAgCellChanged
    };

    gridApi = agGrid.createGrid(document.getElementById('gradebookAgGrid'), gridOptions);
    highlightColumnId = null;
  }

  async function onAgCellChanged(event) {
    const field = event.colDef.field;
    if (!field || field === 'name' || field === 'finalGrade') return;
    const col = gridMeta.cols.find((c) => c.assessmentId === field);
    if (!col) return;

    const row = event.data;
    const val = event.newValue;
    const meta = row[scoreMetaKey(field)] || { maxScore: col.maxScore };
    if (String(meta.saved) === String(val == null ? '' : val)) return;

    const cls = getClass();
    $('gradesError').textContent = '';

    try {
      const res = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/grades/gradebook/cell', {
        method: 'POST',
        body: {
          assessmentId: field,
          studentId: row.studentId,
          score: val == null ? '' : val,
          subject: subject(),
          term: term()
        }
      });
      const pct = res.percent != null ? res.percent :
        (val != null ? Math.round(Number(val) / Number(col.maxScore) * 1000) / 10 : null);
      row[scoreMetaKey(field)] = { maxScore: col.maxScore, percent: pct, saved: val };
      const st = (gradebook.students || []).find((s) => s.studentId === row.studentId);
      if (st) {
        if (!st.cells) st.cells = {};
        st.cells[field] = { score: val, percent: pct, maxScore: col.maxScore };
      }
      event.api.refreshCells({ rowNodes: [event.node], columns: [field], force: true });
      scheduleSyncReport();
      recomputeFinalGradesLocally();
    } catch (e) {
      event.node.setDataValue(field, event.oldValue);
      $('gradesError').textContent = e.message;
    }
  }

  function renderGradebookLegacy() {
    const mount = $('gradebookMount');
    if (!gradebook) {
      mount.innerHTML = '<p class="muted">Loading…</p>';
      return;
    }
    const weights = gradebook.weights || [];
    const cols = sortColumnsByDate(gradebook.columns || []);
    const students = gradebook.students || [];

    if (!students.length) {
      mount.innerHTML = '<p class="muted">No students in this class.</p>';
      return;
    }

    const emptyHint = weights.length
      ? 'No columns yet — click + Add column'
      : 'Set up Grade weights, then click + Add column';

    let midHead = '';
    let colgroup = '';
    const midTableWidth = cols.length ? cols.length * COL_WIDTH : 220;
    if (!cols.length) {
      midHead = '<th class="gb-col-head gb-col-empty"><div class="gb-col-title muted">' + emptyHint + '</div></th>';
      colgroup = '<colgroup><col style="width:220px"></colgroup>';
    } else {
      colgroup = '<colgroup>' + cols.map(() => '<col style="width:' + COL_WIDTH + 'px">').join('') + '</colgroup>';
      cols.forEach((col) => {
        const hl = col.assessmentId === highlightColumnId ? ' gb-col-new' : '';
        const title = col.title || col.categoryLabel;
        const showCategory = col.categoryLabel && col.categoryLabel !== title;
        const tooltip = title +
          (showCategory ? ' · ' + col.categoryLabel : '') +
          ' · ' + formatColDate(col.date) + ' · /' + col.maxScore;
        midHead += '<th class="gb-col-head' + hl + '" title="' + escapeHtml(tooltip) + '">' +
          '<button type="button" class="gb-col-delete" data-aid="' + escapeHtml(col.assessmentId) +
          '" data-title="' + escapeHtml(title) + '" title="Delete column" aria-label="Delete column">×</button>' +
          '<div class="gb-col-title">' + escapeHtml(title) + '</div>' +
          '<div class="gb-col-meta muted small">' + formatColDate(col.date) + ' · /' + col.maxScore + '</div>' +
          (showCategory ? '<div class="gb-col-meta muted small gb-col-cat">' + escapeHtml(col.categoryLabel) + '</div>' : '') +
        '</th>';
      });
    }

    let leftBody = '';
    let midBody = '';
    let rightBody = '';
    students.forEach((st) => {
      leftBody += '<tr><td class="gb-name">' + escapeHtml(st.name) + '</td></tr>';

      let midCells = '';
      if (!cols.length) {
        midCells = '<td class="gb-score-cell gb-col-empty muted">—</td>';
      } else {
        cols.forEach((col) => {
          const cell = st.cells && st.cells[col.assessmentId];
          const val = cell && cell.score != null ? cell.score : '';
          const pct = cell && cell.percent != null ? cell.percent : null;
          const letter = letterGrade(pct);
          const hl = col.assessmentId === highlightColumnId ? ' gb-col-new' : '';
          midCells += '<td class="gb-score-cell' + hl + '">' +
            '<input type="number" class="gb-cell-input" min="0" max="' + col.maxScore + '" ' +
            'data-aid="' + escapeHtml(col.assessmentId) + '" data-sid="' + escapeHtml(st.studentId) + '" ' +
            'data-max="' + col.maxScore + '" value="' + val + '" placeholder="—">' +
            (letter ? '<span class="gb-letter">' + letter + '</span>' : '') +
          '</td>';
        });
      }
      midBody += '<tr>' + midCells + '</tr>';

      const fg = st.finalGrade != null ? st.finalGrade : '—';
      const fgLetter = st.finalGrade != null ? letterGrade(st.finalGrade) : '';
      rightBody += '<tr><td class="gb-final"><strong>' + fg + '</strong>' +
        (fgLetter ? '<div class="gb-letter">' + fgLetter + '</div>' : '') + '</td></tr>';
    });

    mount.innerHTML =
      '<div class="gb-shell">' +
        '<div class="gb-pane gb-pane-left">' +
          '<table class="gb-table gb-table-side"><thead><tr><th class="gb-head-student">Students</th></tr></thead>' +
          '<tbody>' + leftBody + '</tbody></table>' +
        '</div>' +
        '<div class="gb-pane gb-pane-mid" id="gradebookMidScroll">' +
          '<table class="gb-table gb-table-mid" style="width:' + midTableWidth + 'px">' + colgroup +
          '<thead><tr>' + midHead + '</tr></thead>' +
          '<tbody>' + midBody + '</tbody></table>' +
        '</div>' +
        '<div class="gb-pane gb-pane-right">' +
          '<table class="gb-table gb-table-side"><thead><tr><th class="gb-head-final">Final Grade</th></tr></thead>' +
          '<tbody>' + rightBody + '</tbody></table>' +
        '</div>' +
      '</div>';

    mount.querySelectorAll('.gb-cell-input').forEach((inp) => {
      inp.dataset.lastSaved = inp.value;
      inp.addEventListener('change', () => onCellChange(inp));
    });

    mount.querySelectorAll('.gb-col-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteColumn(btn.dataset.aid, btn.dataset.title);
      });
    });

    bindGradebookKeyboard(mount);
    syncGradebookRowHeights(mount);
    highlightColumnId = null;
  }

  function bindGradebookKeyboard(mount) {
    const inputs = Array.from(mount.querySelectorAll('.gb-cell-input'));
    if (!inputs.length) return;
    const colCount = mount.querySelectorAll('.gb-pane-mid tbody tr:first-child .gb-score-cell').length || 1;

    inputs.forEach((inp, idx) => {
      inp.addEventListener('keydown', (e) => {
        const col = idx % colCount;
        const row = Math.floor(idx / colCount);
        let target = idx;

        if (e.key === 'ArrowRight') target = row * colCount + Math.min(col + 1, colCount - 1);
        else if (e.key === 'ArrowLeft') target = row * colCount + Math.max(col - 1, 0);
        else if (e.key === 'ArrowDown') target = Math.min((row + 1) * colCount + col, inputs.length - 1);
        else if (e.key === 'ArrowUp') target = Math.max((row - 1) * colCount + col, 0);
        else if (e.key === 'Enter') target = Math.min((row + 1) * colCount + col, inputs.length - 1);
        else return;

        if (target !== idx && inputs[target]) {
          e.preventDefault();
          inputs[target].focus();
          inputs[target].select();
        }
      });
    });
  }

  function updateFinalGradesInDom(students) {
    if (gridApi) {
      gridApi.forEachNode((node) => {
        const st = students.find((s) => s.studentId === node.data.studentId);
        if (st) {
          node.setDataValue('finalGrade', st.finalGrade != null ? st.finalGrade : null);
        }
      });
      return;
    }
    const mount = $('gradebookMount');
    if (!mount) return;
    const rows = mount.querySelectorAll('.gb-pane-right tbody tr');
    students.forEach((st, i) => {
      if (!rows[i]) return;
      const fg = st.finalGrade != null ? st.finalGrade : '—';
      const fgLetter = st.finalGrade != null ? letterGrade(st.finalGrade) : '';
      rows[i].querySelector('td').innerHTML = '<strong>' + escapeHtml(String(fg)) + '</strong>' +
        (fgLetter ? '<div class="gb-letter">' + fgLetter + '</div>' : '');
    });
  }

  async function deleteColumn(assessmentId, title) {
    const cls = getClass();
    if (!cls || !assessmentId) return;
    const label = title || 'this column';
    if (!window.confirm('Delete "' + label + '"?\nAll scores in this column will be removed.')) return;
    $('gradesError').textContent = '';
    try {
      await api('/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/grades/gradebook/column/' + encodeURIComponent(assessmentId) +
        '?term=' + encodeURIComponent(term()) + '&subject=' + encodeURIComponent(subject()),
        { method: 'DELETE' });
      await loadGradebook(false);
    } catch (e) {
      $('gradesError').textContent = e.message;
    }
  }

  function syncGradebookRowHeights(mount) {
    const HEADER_H = 56;
    const panes = ['.gb-pane-left', '.gb-pane-mid', '.gb-pane-right'];
    const headRows = panes.map((sel) => mount.querySelector(sel + ' thead tr'));
    const bodyRows = panes.map((sel) => Array.from(mount.querySelectorAll(sel + ' tbody tr')));

    headRows.forEach((r) => { if (r) r.style.height = HEADER_H + 'px'; });
    bodyRows.forEach((rows) => rows.forEach((r) => { r.style.height = ''; }));

    const count = bodyRows[0].length;
    for (let i = 0; i < count; i++) {
      const h = Math.max(
        bodyRows[0][i] ? bodyRows[0][i].offsetHeight : 0,
        bodyRows[1][i] ? bodyRows[1][i].offsetHeight : 0,
        bodyRows[2][i] ? bodyRows[2][i].offsetHeight : 0
      );
      bodyRows.forEach((rows) => {
        if (rows[i]) rows[i].style.height = h + 'px';
      });
    }
  }

  async function scheduleSyncReport() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      const cls = getClass();
      if (!cls || !term()) return;
      try {
        await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/grades/sync-report', {
          method: 'POST',
          body: { term: term(), subject: subject() }
        });
      } catch (e) { /* optional */ }
    }, 5000);
  }

  async function onCellChange(inp) {
    if (inp.dataset.lastSaved === inp.value) return;
    const cls = getClass();
    $('gradesError').textContent = '';
    inp.classList.add('gb-saving');
    try {
      const res = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/grades/gradebook/cell', {
        method: 'POST',
        body: {
          assessmentId: inp.dataset.aid,
          studentId: inp.dataset.sid,
          score: inp.value,
          subject: subject(),
          term: term()
        }
      });
      const letterEl = inp.parentElement.querySelector('.gb-letter');
      const pct = res.percent != null ? res.percent : (inp.value ? Math.round(Number(inp.value) / Number(inp.dataset.max) * 1000) / 10 : null);
      if (letterEl) {
        letterEl.textContent = letterGrade(pct);
      } else if (letterGrade(pct)) {
        const span = document.createElement('span');
        span.className = 'gb-letter';
        span.textContent = letterGrade(pct);
        inp.parentElement.appendChild(span);
      }
      const st = (gradebook.students || []).find((s) => s.studentId === inp.dataset.sid);
      if (st) {
        if (!st.cells) st.cells = {};
        st.cells[inp.dataset.aid] = {
          score: inp.value === '' ? null : Number(inp.value),
          percent: pct,
          maxScore: Number(inp.dataset.max)
        };
      }
      inp.classList.remove('gb-saving');
      inp.classList.add('gb-saved');
      inp.dataset.lastSaved = inp.value;
      setTimeout(() => inp.classList.remove('gb-saved'), 600);
      scheduleSyncReport();
      recomputeFinalGradesLocally();
    } catch (e) {
      inp.classList.remove('gb-saving');
      $('gradesError').textContent = e.message;
    }
  }

  function openColumnModal() {
    const weights = (gradebook && gradebook.weights) || [];
    if (!weights.length) {
      $('gradesError').textContent = 'Set up grade weights first.';
      openWeightsModal();
      return;
    }
    $('colError').textContent = '';
    $('colDate').value = todayISO();
    $('colTitle').value = '';
    $('colCategory').innerHTML = weights.map((w) =>
      '<option value="' + escapeHtml(w.categoryKey) + '" data-max="' + w.defaultMaxScore + '">' +
      escapeHtml(w.label) + ' (' + w.weightPercent + '%)</option>'
    ).join('');
    const sel = $('colCategory');
    $('colMaxScore').value = sel.options[sel.selectedIndex].dataset.max || 100;
    sel.onchange = () => {
      $('colMaxScore').value = sel.options[sel.selectedIndex].dataset.max || 100;
    };
    deps.show($('gradeColumnModal'));
  }

  async function submitColumn(e) {
    e.preventDefault();
    const cls = getClass();
    $('colError').textContent = '';
    try {
      const res = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/grades/gradebook/column', {
        method: 'POST',
        body: {
          term: term(),
          subject: subject(),
          categoryKey: $('colCategory').value,
          title: $('colTitle').value,
          date: $('colDate').value,
          maxScore: $('colMaxScore').value
        }
      });
      highlightColumnId = res.column.assessmentId;
      deps.hide($('gradeColumnModal'));
      await loadGradebook(true);
    } catch (err) {
      $('colError').textContent = err.message;
    }
  }

  async function openWeightsModal() {
    const cls = getClass();
    if (!term()) {
      $('gradeWeightsError').textContent = 'No active term. Contact admin.';
      deps.show($('gradeWeightsModal'));
      return;
    }
    $('gradeWeightsTitle').textContent = subject() + ' · ' + term();
    deps.show($('gradeWeightsModal'));
    $('gradeWeightsError').textContent = '';
    try {
      const data = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/grades/weights?term=' + encodeURIComponent(term()) + '&subject=' + encodeURIComponent(subject()));
      weightDraft = (data.weights || []).map((w) => ({ ...w }));
      categoryPresets = data.presets || [];
      if (!weightDraft.length) {
        weightDraft = [
          { categoryKey: 'daily_quiz', label: 'Daily Quiz', weightPercent: 30, aggregation: 'average', defaultMaxScore: 100 },
          { categoryKey: 'assignment', label: 'Assignment', weightPercent: 20, aggregation: 'average', defaultMaxScore: 100 },
          { categoryKey: 'midterm', label: 'Midterm Exam', weightPercent: 20, aggregation: 'single', defaultMaxScore: 100 },
          { categoryKey: 'final', label: 'Final Exam', weightPercent: 30, aggregation: 'single', defaultMaxScore: 100 }
        ];
      }
      renderWeightEditor();
    } catch (e) {
      $('gradeWeightsError').textContent = e.message;
    }
  }

  function weightTotal() {
    return weightDraft.reduce((s, w) => s + (Number(w.weightPercent) || 0), 0);
  }

  function renderWeightEditor() {
    const presets = categoryPresets;
    $('gradeWeightPresetSelect').innerHTML = presets.map((p) =>
      '<option value="' + escapeHtml(p.categoryKey) + '">' + escapeHtml(p.label) + '</option>'
    ).join('');
    $('gradeWeightRows').innerHTML = weightDraft.map((w, i) => {
      const opts = presets.map((p) =>
        '<option value="' + escapeHtml(p.categoryKey) + '"' + (p.categoryKey === w.categoryKey ? ' selected' : '') + '>' +
        escapeHtml(p.label) + '</option>'
      ).join('');
      return '<div class="gw-row" data-idx="' + i + '">' +
        '<select class="gw-key">' + opts + '</select>' +
        '<input type="number" class="gw-pct" min="1" max="100" value="' + w.weightPercent + '" style="width:4.5rem"> %' +
        '<span class="muted small gw-agg">' + (w.aggregation === 'single' ? 'one score' : 'average') + '</span>' +
        '<button type="button" class="btn btn-ghost gw-remove">×</button></div>';
    }).join('');
    $('gradeWeightTotal').textContent = 'Total: ' + Math.round(weightTotal() * 10) / 10 + '%';
    $('gradeWeightRows').querySelectorAll('.gw-pct').forEach((inp, i) => {
      inp.addEventListener('input', () => {
        weightDraft[i].weightPercent = Number(inp.value);
        $('gradeWeightTotal').textContent = 'Total: ' + Math.round(weightTotal() * 10) / 10 + '%';
      });
    });
    $('gradeWeightRows').querySelectorAll('.gw-key').forEach((sel, i) => {
      sel.addEventListener('change', () => {
        const p = presets.find((x) => x.categoryKey === sel.value);
        if (p) {
          weightDraft[i] = Object.assign({}, weightDraft[i], {
            categoryKey: p.categoryKey,
            label: p.label,
            aggregation: p.aggregation,
            defaultMaxScore: p.defaultMaxScore
          });
          sel.closest('.gw-row').querySelector('.gw-agg').textContent =
            p.aggregation === 'single' ? 'one score' : 'average';
        }
      });
    });
    $('gradeWeightRows').querySelectorAll('.gw-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        weightDraft.splice(Number(btn.closest('.gw-row').dataset.idx), 1);
        renderWeightEditor();
      });
    });
  }

  function addWeightRow() {
    const p = categoryPresets.find((x) => x.categoryKey === $('gradeWeightPresetSelect').value);
    if (!p || weightDraft.some((w) => w.categoryKey === p.categoryKey)) return;
    weightDraft.push({
      categoryKey: p.categoryKey,
      label: p.label,
      weightPercent: 10,
      aggregation: p.aggregation,
      defaultMaxScore: p.defaultMaxScore
    });
    renderWeightEditor();
  }

  async function saveWeights() {
    const cls = getClass();
    $('gradeWeightsError').textContent = '';
    const rows = $('gradeWeightRows').querySelectorAll('.gw-row');
    const weights = [];
    rows.forEach((row, i) => {
      const key = row.querySelector('.gw-key').value;
      const draft = weightDraft[i] || {};
      const preset = categoryPresets.find((p) => p.categoryKey === key);
      weights.push({
        categoryKey: key,
        label: preset ? preset.label : draft.label || key,
        weightPercent: Number(row.querySelector('.gw-pct').value),
        aggregation: draft.aggregation || (preset && preset.aggregation) || 'average',
        defaultMaxScore: draft.defaultMaxScore || (preset && preset.defaultMaxScore) || 100,
        sortOrder: i + 1
      });
    });
    try {
      await api('/api/teacher/class/' + encodeURIComponent(cls.classId) + '/grades/weights', {
        method: 'POST',
        body: { term: term(), subject: subject(), weights }
      });
      deps.hide($('gradeWeightsModal'));
      loadGradebook();
    } catch (e) {
      $('gradeWeightsError').textContent = e.message;
    }
  }

  async function loadLessonWeights() {
    const cls = getClass();
    const box = $('lpGradeWeights');
    if (!box || !cls) return;
    const subj = subject();
    if (!subj || !term()) {
      box.innerHTML = '<p class="muted">Enter a subject to view grade weights.</p>';
      return;
    }
    try {
      const data = await api('/api/teacher/class/' + encodeURIComponent(cls.classId) +
        '/grades/weights?term=' + encodeURIComponent(term()) + '&subject=' + encodeURIComponent(subj));
      const weights = data.weights || [];
      if (!weights.length) {
        box.innerHTML = '<p class="muted">No weights for <strong>' + escapeHtml(subj) + '</strong>. ' +
          '<button type="button" class="btn btn-ghost" id="lpOpenWeights">Set grade weights</button></p>';
        const btn = $('lpOpenWeights');
        if (btn) btn.addEventListener('click', () => {
          $('gradeSubject').value = subj;
          if (typeof deps.switchTab === 'function') deps.switchTab('grades');
          openWeightsModal();
        });
        return;
      }
      box.innerHTML = '<p class="small"><strong>Grade weights</strong> (' + escapeHtml(subj) + ', ' + escapeHtml(term()) + ')</p>' +
        '<div class="gw-chips">' + weights.map((w) =>
          '<span class="gw-chip">' + escapeHtml(w.label) + ' ' + w.weightPercent + '%</span>'
        ).join('') + '</div>' +
        '<button type="button" class="btn btn-ghost" id="lpOpenWeights" style="margin-top:0.35rem">Edit weights</button>';
      $('lpOpenWeights').addEventListener('click', () => {
        $('gradeSubject').value = subj;
        if (typeof deps.switchTab === 'function') deps.switchTab('grades');
        openWeightsModal();
      });
    } catch (e) {
      box.innerHTML = '<p class="muted">Could not load weights.</p>';
    }
  }

  return {
    init,
    onClassOpen,
    loadGradebook,
    loadDashboard: loadGradebook,
    openWeightsModal,
    loadLessonWeights,
    loadActiveTerm
  };
})();
