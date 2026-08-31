/* Admin Consents — publish formal letters + submission tracker */
(function (global) {
  let api = null;
  let escapeHtml = null;
  let role = 'admin';
  let $ = null;
  let classes = [];
  let templates = [];
  let forms = [];
  let activeFormId = '';
  let editorState = {
    templateId: '',
    category: 'General',
    title: '',
    contentHtml: '',
    fieldsJson: {},
    targetGrades: '*',
    dueDate: ''
  };

  function t(key, fallback) {
    return (global.SaltI18n && SaltI18n.t) ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function agreedLabel(v) {
    const map = {
      Y: '동의',
      N: '부동의',
      Apply: '신청',
      None: '미신청'
    };
    return map[v] || v || '—';
  }

  function setEditorFromTemplate(tpl) {
    editorState.templateId = tpl.templateId || '';
    editorState.category = tpl.category || 'General';
    editorState.title = tpl.title || '';
    editorState.contentHtml = tpl.contentHtml || '';
    editorState.fieldsJson = Object.assign({}, tpl.fieldsJson || {});
    const titleEl = $('consentTitle');
    const bodyEl = $('consentBody');
    if (titleEl) titleEl.value = editorState.title;
    if (bodyEl) bodyEl.innerHTML = editorState.contentHtml;
    syncEventFieldsUI();
  }

  function syncEventFieldsUI() {
    const box = $('consentEventFields');
    const isEvent = editorState.category === 'Event' ||
      (editorState.fieldsJson && editorState.fieldsJson.kind === 'event');
    if (box) box.classList.toggle('hidden', !isEvent);
    if (!isEvent) return;
    const f = editorState.fieldsJson || {};
    if ($('consentCapacity')) $('consentCapacity').value = f.capacity != null ? f.capacity : 20;
    if ($('consentEventDate')) $('consentEventDate').value = f.eventDate || '';
    if ($('consentEventLocation')) $('consentEventLocation').value = f.location || '';
    if ($('consentEventFee')) $('consentEventFee').value = f.fee || '';
    if ($('consentEventSupplies')) $('consentEventSupplies').value = f.supplies || '';
  }

  function readEventFieldsIntoState() {
    const isEvent = editorState.category === 'Event' ||
      (editorState.fieldsJson && editorState.fieldsJson.kind === 'event');
    if (!isEvent) return;
    editorState.fieldsJson = Object.assign({}, editorState.fieldsJson || {}, {
      kind: 'event',
      capacity: Number(($('consentCapacity') && $('consentCapacity').value) || 0) || 0,
      eventDate: (($('consentEventDate') && $('consentEventDate').value) || '').trim(),
      location: (($('consentEventLocation') && $('consentEventLocation').value) || '').trim(),
      fee: (($('consentEventFee') && $('consentEventFee').value) || '').trim(),
      supplies: (($('consentEventSupplies') && $('consentEventSupplies').value) || '').trim(),
      firstCome: true
    });
  }

  function readEditor() {
    editorState.title = ($('consentTitle') && $('consentTitle').value) || '';
    editorState.contentHtml = ($('consentBody') && $('consentBody').innerHTML) || '';
    editorState.targetGrades = ($('consentTargets') && $('consentTargets').value) || '*';
    editorState.dueDate = ($('consentDue') && $('consentDue').value) || '';
    readEventFieldsIntoState();
    return editorState;
  }

  function showCompose(show) {
    const box = $('consentComposeCard');
    const btn = $('consentNewBtn');
    if (box) box.classList.toggle('hidden', !show);
    if (btn) btn.textContent = show
      ? t('common.close', 'Close')
      : t('admin.consents.new', 'New form');
    if (btn) btn.dataset.open = show ? '1' : '0';
  }

  async function loadTemplates() {
    const data = await api('/api/admin/consent-templates', {}, role);
    templates = data.templates || [];
    const sel = $('consentTemplateSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">' + escapeHtml(t('consent.pickTemplate', '양식 선택…')) + '</option>' +
      templates.map((tpl) =>
        '<option value="' + escapeHtml(tpl.templateId) + '">' +
        escapeHtml(tpl.title) + (tpl.isCustomSaved ? ' ★' : '') +
        '</option>'
      ).join('');
  }

  async function loadForms() {
    const box = $('consentFormsList');
    if (!box) return;
    box.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      const data = await api('/api/admin/consents', {}, role);
      forms = data.forms || [];
      if (!forms.length) {
        box.innerHTML = '<p class="muted">' +
          escapeHtml(t('consent.noForms', '발행된 공문이 없습니다. 위에서 양식을 선택해 발행하세요.')) +
          '</p>';
        return;
      }
      box.innerHTML = '<table class="grades-table"><thead><tr>' +
        '<th>제목</th><th>마감</th><th>상태</th><th>제출</th><th></th></tr></thead><tbody>' +
        forms.map((f) => {
          const total = f.total != null ? f.total : '—';
          const submitted = f.submittedCount != null ? f.submittedCount : '—';
          const rate = f.rate != null ? f.rate + '%' : '';
          return '<tr>' +
            '<td>' + escapeHtml(f.title) + '</td>' +
            '<td>' + escapeHtml(f.dueDate || '—') + '</td>' +
            '<td>' + escapeHtml(f.status === 'Active' ? '진행중' : '마감') + '</td>' +
            '<td><strong>' + submitted + '</strong> / ' + total +
            (rate ? ' <span class="muted small">(' + rate + ')</span>' : '') + '</td>' +
            '<td style="white-space:nowrap">' +
            '<button type="button" class="btn btn-primary" data-consent-analytics="' +
            escapeHtml(f.formId) + '">제출 현황</button> ' +
            (f.status === 'Active'
              ? '<button type="button" class="btn btn-ghost" data-consent-close="' +
                escapeHtml(f.formId) + '">마감</button>'
              : '') +
            '<button type="button" class="btn btn-ghost" data-consent-edit="' +
            escapeHtml(f.formId) + '" data-title="' + escapeHtml(f.title) +
            '" data-due="' + escapeHtml(f.dueDate || '') + '">수정</button> ' +
            '<button type="button" class="btn btn-ghost" data-consent-delete="' +
            escapeHtml(f.formId) + '">삭제</button>' +
            '</td></tr>';
        }).join('') +
        '</tbody></table>';

      box.querySelectorAll('[data-consent-analytics]').forEach((btn) => {
        btn.addEventListener('click', () => openAnalytics(btn.dataset.consentAnalytics));
      });
      box.querySelectorAll('[data-consent-close]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('이 공문을 마감할까요? 학부모는 더 이상 제출할 수 없습니다.')) return;
          try {
            await api('/api/admin/consents/' + encodeURIComponent(btn.dataset.consentClose) + '/close', {
              method: 'POST'
            }, role);
            await loadForms();
          } catch (e) {
            alert(e.message);
          }
        });
      });
      box.querySelectorAll('[data-consent-edit]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const formId = btn.dataset.consentEdit;
          const newTitle = window.prompt('제목', btn.dataset.title || '');
          if (newTitle == null) return;
          const newDue = window.prompt('마감일 (YYYY-MM-DD, 비우면 없음)', btn.dataset.due || '');
          if (newDue == null) return;
          try {
            await api('/api/admin/consents/' + encodeURIComponent(formId), {
              method: 'PATCH',
              body: { title: newTitle, dueDate: newDue }
            }, role);
            await loadForms();
          } catch (e) {
            alert(e.message);
          }
        });
      });
      box.querySelectorAll('[data-consent-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('이 공문을 완전히 삭제할까요? 제출 데이터도 함께 삭제됩니다.')) return;
          try {
            await api('/api/admin/consents/' + encodeURIComponent(btn.dataset.consentDelete), {
              method: 'DELETE'
            }, role);
            await loadForms();
          } catch (e) {
            alert(e.message);
          }
        });
      });
    } catch (e) {
      box.innerHTML = '<p class="error">' + escapeHtml(e.message || '목록을 불러오지 못했습니다.') + '</p>';
    }
  }

  async function openAnalytics(formId) {
    activeFormId = formId;
    const panel = $('consentAnalytics');
    if (!panel) return;
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      const data = await api('/api/admin/consents/' + encodeURIComponent(formId) + '/analytics', {}, role);
      const filter = { q: '', only: 'all' };

      function renderTables() {
        const q = String(filter.q || '').trim().toLowerCase();
        const match = (row) => {
          if (!q) return true;
          return String(row.name || '').toLowerCase().indexOf(q) >= 0 ||
            String(row.className || row.classId || '').toLowerCase().indexOf(q) >= 0;
        };
        let pending = (data.pending || []).filter(match);
        let submitted = (data.submitted || []).filter(match);
        if (filter.only === 'pending') submitted = [];
        if (filter.only === 'submitted') pending = [];
        if (filter.only === 'agreed') {
          pending = [];
          submitted = submitted.filter((s) => s.agreed === 'Y' || s.agreed === 'Apply');
        }
        if (filter.only === 'declined') {
          pending = [];
          submitted = submitted.filter((s) => s.agreed === 'N' || s.agreed === 'None');
        }

        const submittedRows = submitted.length
          ? '<table class="grades-table"><thead><tr>' +
            '<th>학생</th><th>반</th><th>응답</th><th>사유</th><th>제출시각</th><th>서명</th><th></th></tr></thead><tbody>' +
            submitted.map((s) => {
              const isWaiting = (s.extraData && s.extraData.registrationStatus) === 'Waiting';
              return '<tr>' +
              '<td>' + escapeHtml(s.name) + '</td>' +
              '<td>' + escapeHtml(s.className || s.classId) + '</td>' +
              '<td><strong>' + escapeHtml(agreedLabel(s.agreed)) +
              (s.extraData && s.extraData.registrationStatus
                ? ' · ' + escapeHtml(isWaiting
                  ? ('대기 #' + (s.extraData.waitNumber || ''))
                  : '확정')
                : '') +
              '</strong></td>' +
              '<td class="muted small">' + escapeHtml(s.disagreedReason || (s.extraData && s.extraData.eventNotes) || '—') + '</td>' +
              '<td>' + escapeHtml(String(s.submittedAt || '').slice(0, 16).replace('T', ' ')) + '</td>' +
              '<td>' + (s.hasSignature ? '✓' : '—') + '</td>' +
              '<td style="white-space:nowrap">' +
              (isWaiting
                ? '<button type="button" class="btn btn-ghost consent-promote-btn" data-sub="' +
                  escapeHtml(s.submissionId || '') + '">확정 전환</button> ' +
                  '<button type="button" class="btn btn-ghost consent-cancel-reg-btn" data-sub="' +
                  escapeHtml(s.submissionId || '') + '">취소</button>'
                : (s.extraData && s.extraData.registrationStatus === 'Confirmed'
                  ? '<button type="button" class="btn btn-ghost consent-cancel-reg-btn" data-sub="' +
                    escapeHtml(s.submissionId || '') + '">취소</button>'
                  : '')) +
              '</td>' +
              '</tr>';
            }).join('') + '</tbody></table>'
          : '<p class="muted">해당 조건의 제출 없음</p>';

        const pendingRows = pending.length
          ? '<table class="grades-table"><thead><tr><th>학생</th><th>반</th><th>상태</th></tr></thead><tbody>' +
            pending.map((p) =>
              '<tr>' +
              '<td>' + escapeHtml(p.name) + '</td>' +
              '<td>' + escapeHtml(p.className || p.classId) + '</td>' +
              '<td><span class="error">미제출</span></td>' +
              '</tr>'
            ).join('') + '</tbody></table>'
          : '<p class="muted">미제출자 없음</p>';

        const clusters = (data.clusters || []).map((c) =>
          '<tr><td>' + escapeHtml(c.apartment) + '</td><td>' + c.count + '</td>' +
          '<td class="muted small">' + escapeHtml((c.students || []).map((s) => s.name).join(', ')) + '</td></tr>'
        ).join('');

        $('consentAnalyticsBody').innerHTML =
          '<div class="consent-stat-row">' +
          '<div class="consent-stat"><div class="muted small">대상</div><strong>' + data.total + '</strong></div>' +
          '<div class="consent-stat"><div class="muted small">제출</div><strong>' + data.submittedCount + '</strong></div>' +
          '<div class="consent-stat"><div class="muted small">미제출</div><strong>' + data.pendingCount + '</strong></div>' +
          '<div class="consent-stat"><div class="muted small">제출률</div><strong>' + data.rate + '%</strong></div>' +
          (data.eventStats
            ? '<div class="consent-stat"><div class="muted small">확정</div><strong>' + data.eventStats.confirmed +
              (data.eventStats.capacity ? ' / ' + data.eventStats.capacity : '') + '</strong></div>' +
              '<div class="consent-stat"><div class="muted small">대기</div><strong>' + data.eventStats.waiting + '</strong></div>'
            : '') +
          '</div>' +
          '<div class="table-wrap" style="margin-top:1rem"><h4>제출 완료</h4>' + submittedRows + '</div>' +
          '<div class="table-wrap" style="margin-top:1rem"><h4>미제출</h4>' + pendingRows + '</div>' +
          ((data.form.category === 'BusSurvey' || (data.clusters || []).length)
            ? '<div class="table-wrap" style="margin-top:1rem"><h4>수요 클러스터 (아파트/지역)</h4>' +
              '<table class="grades-table"><thead><tr><th>단지/지역</th><th>인원</th><th>학생</th></tr></thead><tbody>' +
              (clusters || '<tr><td colspan="3" class="muted">데이터 없음</td></tr>') +
              '</tbody></table></div>'
            : '');

        $('consentAnalyticsBody').querySelectorAll('.consent-promote-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('이 대기 신청을 확정으로 전환할까요?')) return;
            try {
              await api('/api/admin/consents/' + encodeURIComponent(formId) + '/promote', {
                method: 'POST',
                body: { submissionId: btn.dataset.sub }
              }, role);
              openAnalytics(formId);
            } catch (e) {
              alert(e.message);
            }
          });
        });
        $('consentAnalyticsBody').querySelectorAll('.consent-cancel-reg-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('이 신청/등록을 취소할까요?')) return;
            try {
              await api('/api/admin/consents/' + encodeURIComponent(formId) + '/cancel-registration', {
                method: 'POST',
                body: { submissionId: btn.dataset.sub }
              }, role);
              openAnalytics(formId);
            } catch (e) {
              alert(e.message);
            }
          });
        });
      }

      // Enrich signature flag for display (analytics already has extraData; signature itself not listed for size)
      (data.submitted || []).forEach((s) => {
        if (!s.extraData) s.extraData = {};
      });

      panel.innerHTML =
        '<div class="teacher-panel-head"><div>' +
        '<h3 style="margin:0">' + escapeHtml(data.form.title) + '</h3>' +
        '<p class="muted small" style="margin:0.35rem 0 0">발행 ' +
        escapeHtml(String(data.form.publishedAt || '').slice(0, 10)) +
        (data.form.dueDate ? ' · 마감 ' + escapeHtml(data.form.dueDate) : '') +
        '</p></div>' +
        '<div style="display:flex;gap:0.5rem;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-primary" id="consentRemindBtn">미제출 독촉</button>' +
        '<a class="btn btn-ghost" href="/api/admin/consents/' + encodeURIComponent(formId) + '/print">인쇄/PDF 명부</a>' +
        '<a class="btn btn-ghost" href="/api/admin/consents/' + encodeURIComponent(formId) + '/clusters.csv">클러스터 CSV</a>' +
        '<button type="button" class="btn btn-ghost" id="consentAnalyticsClose">닫기</button>' +
        '</div></div>' +
        '<div class="admin-toolbar" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">' +
        '<input type="search" id="consentFilterQ" placeholder="학생/반 검색" style="min-width:160px">' +
        '<select id="consentFilterOnly">' +
        '<option value="all">전체</option>' +
        '<option value="pending">미제출만</option>' +
        '<option value="submitted">제출만</option>' +
        '<option value="agreed">동의/신청만</option>' +
        '<option value="declined">부동의/미신청만</option>' +
        '</select></div>' +
        '<div id="consentAnalyticsBody"></div>';

      renderTables();

      const qEl = $('consentFilterQ');
      const onlyEl = $('consentFilterOnly');
      if (qEl) qEl.addEventListener('input', () => { filter.q = qEl.value; renderTables(); });
      if (onlyEl) onlyEl.addEventListener('change', () => { filter.only = onlyEl.value; renderTables(); });

      const remind = $('consentRemindBtn');
      if (remind) {
        remind.addEventListener('click', async () => {
          try {
            const res = await api('/api/admin/consents/' + encodeURIComponent(formId) + '/remind', {
              method: 'POST'
            }, role);
            alert('독촉 알림 발송: ' + (res.sent || 0) +
              (res.reason ? ' (' + res.reason + ')' : ''));
          } catch (e) {
            alert(e.message);
          }
        });
      }
      const closeBtn = $('consentAnalyticsClose');
      if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

      panel.querySelectorAll('a[href*="/api/admin/consents/"]').forEach((a) => {
        a.addEventListener('click', async (e) => {
          e.preventDefault();
          const path = a.getAttribute('href');
          try {
            const token = global.SaltApp.getToken(role);
            const res = await fetch((global.SaltApp.API || '') + path, {
              headers: { Authorization: token ? ('Bearer ' + token) : '' }
            });
            if (!res.ok) throw new Error('다운로드 실패');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            if (path.indexOf('print') >= 0) window.open(url, '_blank');
            else {
              const link = document.createElement('a');
              link.href = url;
              link.download = 'clusters.csv';
              link.click();
            }
          } catch (err) {
            alert(err.message);
          }
        });
      });
    } catch (e) {
      panel.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
    }
  }

  function bindEditor() {
    const tplSel = $('consentTemplateSelect');
    if (tplSel) {
      tplSel.addEventListener('change', () => {
        const tpl = templates.find((x) => x.templateId === tplSel.value);
        if (tpl) setEditorFromTemplate(tpl);
      });
    }
    const deleteTpl = $('consentDeleteTemplateBtn');
    if (deleteTpl) {
      deleteTpl.addEventListener('click', async () => {
        const sel = $('consentTemplateSelect');
        const templateId = sel && sel.value;
        if (!templateId) {
          alert('삭제할 양식을 먼저 선택하세요.');
          return;
        }
        if (!confirm('이 양식을 삭제할까요? 이미 발행된 공문에는 영향이 없습니다.')) return;
        try {
          await api('/api/admin/consent-templates/' + encodeURIComponent(templateId), { method: 'DELETE' }, role);
          await loadTemplates();
        } catch (e) {
          alert(e.message);
        }
      });
    }
    const saveTpl = $('consentSaveTemplateBtn');
    if (saveTpl) {
      saveTpl.addEventListener('click', async () => {
        const ed = readEditor();
        try {
          await api('/api/admin/consent-templates', {
            method: 'POST',
            body: {
              title: ed.title + ' (저장본)',
              category: ed.category,
              contentHtml: ed.contentHtml,
              fieldsJson: ed.fieldsJson,
              isCustomSaved: true
            }
          }, role);
          await loadTemplates();
          alert('커스텀 양식으로 저장했습니다. 다음에 목록에서 불러올 수 있습니다.');
        } catch (e) {
          alert(e.message);
        }
      });
    }
    const publish = $('consentPublishBtn');
    if (publish) {
      publish.addEventListener('click', async () => {
        const ed = readEditor();
        const err = $('consentEditorError');
        if (err) err.textContent = '';
        if (!ed.title || !ed.contentHtml) {
          if (err) {
            err.style.color = '#dc2626';
            err.textContent = '양식을 선택한 뒤 제목/본문을 확인하세요.';
          }
          return;
        }
        try {
          const res = await api('/api/admin/consents/publish', {
            method: 'POST',
            body: {
              templateId: ed.templateId,
              category: ed.category,
              title: ed.title,
              contentHtml: ed.contentHtml,
              fieldsJson: ed.fieldsJson,
              targetGrades: ed.targetGrades,
              dueDate: ed.dueDate
            }
          }, role);
          await loadForms();
          showCompose(false);
          if (err) {
            err.style.color = '#16a34a';
            err.textContent = '발행 완료. 학부모 Consents 탭에 표시됩니다.';
          }
          if (res && res.form && res.form.formId) {
            openAnalytics(res.form.formId);
          }
        } catch (e) {
          if (err) {
            err.style.color = '#dc2626';
            err.textContent = e.message;
          } else alert(e.message);
        }
      });
    }
    document.querySelectorAll('[data-consent-cmd]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        document.execCommand(btn.dataset.consentCmd, false, null);
        const body = $('consentBody');
        if (body) body.focus();
      });
    });
    document.querySelectorAll('[data-consent-var]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const body = $('consentBody');
        if (!body) return;
        body.focus();
        document.execCommand('insertText', false, btn.dataset.consentVar || '');
      });
    });
    const refresh = $('consentRefreshBtn');
    if (refresh) refresh.addEventListener('click', () => open());
    const newBtn = $('consentNewBtn');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        const openNow = newBtn.dataset.open === '1';
        showCompose(!openNow);
      });
    }
  }

  function syncClassTargets() {
    const sel = $('consentTargets');
    if (!sel) return;
    const cur = sel.value || '*';
    sel.innerHTML = '<option value="*">전체 재학생</option>' +
      (classes || []).map((c) =>
        '<option value="' + escapeHtml(c.classId) + '">' + escapeHtml(c.name || c.classId) + '</option>'
      ).join('');
    sel.value = cur;
  }

  async function open() {
    syncClassTargets();
    showCompose(false);
    const listErr = [];
    await Promise.all([
      loadTemplates().catch((e) => { listErr.push(e.message); }),
      loadForms().catch((e) => { listErr.push(e.message); })
    ]);
    if (listErr.length) {
      const box = $('consentFormsList');
      if (box && /Loading|불러/.test(box.textContent || '')) {
        box.innerHTML = '<p class="error">' + escapeHtml(listErr.join(' · ')) + '</p>';
      }
    }
  }

  function init(opts) {
    api = opts.api;
    escapeHtml = opts.escapeHtml;
    role = opts.role || 'admin';
    $ = opts.$;
    classes = opts.classes || [];
    bindEditor();
  }

  function setClasses(list) {
    classes = list || [];
    syncClassTargets();
  }

  global.SaltConsentAdmin = { init, open, setClasses };
})(window);
