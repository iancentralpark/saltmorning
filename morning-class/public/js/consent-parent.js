/* Parent Consents — list, bus fields, typed e-sign (+ optional draw) */
(function (global) {
  let api = null;
  let escapeHtml = null;
  let $ = null;
  let pending = [];
  let currentForm = null;
  let busRuns = [];
  let drawing = false;
  let lastPt = null;

  function t(key, fallback) {
    return (global.SaltI18n && SaltI18n.t) ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function canvas() {
    return $('ppConsentSig');
  }

  function clearSignature() {
    const c = canvas();
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function isBlankSignature() {
    const c = canvas();
    if (!c) return true;
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return false;
    }
    return true;
  }

  function pointerPos(c, ev) {
    const rect = c.getBoundingClientRect();
    const src = (ev.touches && ev.touches[0]) || ev;
    return {
      x: (src.clientX - rect.left) * (c.width / Math.max(rect.width, 1)),
      y: (src.clientY - rect.top) * (c.height / Math.max(rect.height, 1))
    };
  }

  function bindSignature() {
    const c = canvas();
    if (!c || c.dataset.bound === '1') return;
    c.dataset.bound = '1';
    clearSignature();

    function start(ev) {
      ev.preventDefault();
      drawing = true;
      lastPt = pointerPos(c, ev);
    }
    function move(ev) {
      if (!drawing) return;
      ev.preventDefault();
      const pt = pointerPos(c, ev);
      const ctx = c.getContext('2d');
      ctx.beginPath();
      ctx.moveTo(lastPt.x, lastPt.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      lastPt = pt;
    }
    function end(ev) {
      if (!drawing) return;
      ev.preventDefault();
      drawing = false;
      lastPt = null;
    }

    c.addEventListener('mousedown', start);
    c.addEventListener('mousemove', move);
    c.addEventListener('mouseup', end);
    c.addEventListener('mouseleave', end);
    c.addEventListener('touchstart', start, { passive: false });
    c.addEventListener('touchmove', move, { passive: false });
    c.addEventListener('touchend', end);
    c.addEventListener('touchcancel', end);

    const clearBtn = $('ppConsentSigClear');
    if (clearBtn) clearBtn.addEventListener('click', clearSignature);
  }

  function defaultSignerName() {
    try {
      const p = global.SaltApp && SaltApp.getProfile && SaltApp.getProfile('parent');
      return String((p && (p.name || p.parentName || p.displayName)) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function makeTypedSignature(name) {
    const c = document.createElement('canvas');
    c.width = 560;
    c.height = 140;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'italic 42px "Noto Serif KR", Merriweather, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(name || '').trim(), c.width / 2, c.height / 2 - 8);
    ctx.font = '12px Inter, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Electronic signature', c.width / 2, c.height / 2 + 36);
    return c.toDataURL('image/png');
  }

  function resolveSignature(requireSig) {
    if (requireSig === false) return { ok: true, dataUrl: '', signerName: '' };
    const name = (($('ppConsentSignerName') && $('ppConsentSignerName').value) || '').trim();
    const confirmed = !!( $('ppConsentEsignConfirm') && $('ppConsentEsignConfirm').checked );
    const drawn = !isBlankSignature();
    if (drawn) {
      return { ok: true, dataUrl: canvas().toDataURL('image/png'), signerName: name };
    }
    if (!name) {
      return { ok: false, error: t('parent.consents.nameRequired', '보호자 성명을 입력해 주세요.') };
    }
    if (!confirmed) {
      return { ok: false, error: t('parent.consents.confirmRequired', '전자서명 확인에 체크해 주세요.') };
    }
    return { ok: true, dataUrl: makeTypedSignature(name), signerName: name };
  }

  function showList() {
    const wrap = $('ppConsentListWrap');
    const detail = $('ppConsentDetail');
    if (wrap) wrap.classList.remove('hidden');
    if (detail) detail.classList.add('hidden');
    currentForm = null;
  }

  function showDetail() {
    const wrap = $('ppConsentListWrap');
    const detail = $('ppConsentDetail');
    if (wrap) wrap.classList.add('hidden');
    if (detail) detail.classList.remove('hidden');
  }

  function renderList() {
    const box = $('ppConsentList');
    if (!box) return;
    if (!pending.length) {
      box.innerHTML = '<p class="muted">' + escapeHtml(t('parent.consents.empty', '미제출 양식이 없습니다.')) + '</p>';
      return;
    }
    box.innerHTML = pending.map((f) =>
      '<button type="button" class="pp-consent-card" data-consent-open="' + escapeHtml(f.formId) + '">' +
      '<div class="pp-consent-card-title">' + escapeHtml(f.title) + '</div>' +
      '<div class="muted small">' +
      (f.dueDate ? escapeHtml(t('parent.consents.due', '마감') + ': ' + f.dueDate) : '') +
      '</div></button>'
    ).join('');
    box.querySelectorAll('[data-consent-open]').forEach((btn) => {
      btn.addEventListener('click', () => openForm(btn.dataset.consentOpen));
    });
  }

  function choiceIsNegative(val) {
    return val === 'N' || val === 'None';
  }

  function syncReasonVisibility() {
    const wrap = $('ppConsentReasonWrap');
    if (!wrap) return;
    const selected = document.querySelector('input[name="ppConsentChoice"]:checked');
    const neg = selected && choiceIsNegative(selected.value);
    wrap.classList.toggle('hidden', !neg);
  }

  function renderExtraFields(fields) {
    const host = $('ppConsentExtra');
    if (!host) return;
    const kind = (fields && fields.kind) || '';
    if (kind === 'bus_survey') {
      host.innerHTML =
        '<label><span>' + escapeHtml(t('parent.consents.apartment', '거주지 (아파트/동)')) + '</span>' +
        '<input id="ppConsentApartment" maxlength="120"></label>' +
        '<label><span>' + escapeHtml(t('parent.consents.desire', '이용 희망')) + '</span>' +
        '<select id="ppConsentDesire">' +
        '<option value="both">등하원</option>' +
        '<option value="pickup">등교만</option>' +
        '<option value="dismissal">하교만</option>' +
        '<option value="self">자가 (버스 이용 안 함)</option>' +
        '</select></label>' +
        '<label><span>' + escapeHtml(t('parent.consents.pickupPlace', '희망 승하차 장소')) + '</span>' +
        '<input id="ppConsentPickupPlace" maxlength="120"></label>';
      return;
    }
    if (kind === 'bus_app') {
      const pickup = busRuns.filter((r) => r.runType === 'pickup');
      const dismiss = busRuns.filter((r) => r.runType === 'dismissal');
      const opt = (r) =>
        '<option value="' + escapeHtml(r.runId) + '">' +
        escapeHtml((r.busName || '') + ' · ' + (r.label || r.runId) +
          (r.startTime ? ' (' + r.startTime + ')' : '')) +
        '</option>';
      host.innerHTML =
        '<label><span>' + escapeHtml(t('parent.consents.pickupRun', '등교 호차')) + '</span>' +
        '<select id="ppConsentPickupRun"><option value="">—</option>' +
        pickup.map(opt).join('') + '</select></label>' +
        '<label><span>' + escapeHtml(t('parent.consents.dismissalRun', '하교 호차')) + '</span>' +
        '<select id="ppConsentDismissalRun"><option value="">—</option>' +
        dismiss.map(opt).join('') + '</select></label>' +
        '<label><span>' + escapeHtml(t('parent.consents.stopLabel', '정류장 / 메모')) + '</span>' +
        '<input id="ppConsentStopLabel" maxlength="120"></label>' +
        '<label class="pp-consent-terms"><input type="checkbox" id="ppConsentTerms"> ' +
        escapeHtml(t('parent.consents.terms', '셔틀 이용 약관 및 시간표에 동의합니다.')) + '</label>';
      return;
    }
    host.innerHTML = '';
  }

  async function ensureBusRuns() {
    if (busRuns.length) return;
    try {
      const data = await api('/api/parent/consents/bus-options');
      busRuns = data.runs || [];
    } catch (_) {
      busRuns = [];
    }
  }

  async function openForm(formId) {
    const err = $('ppConsentError');
    const ok = $('ppConsentOk');
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
    try {
      const data = await api('/api/parent/consents/' + encodeURIComponent(formId));
      currentForm = data.form || data;
      if ((currentForm.fieldsJson || {}).kind === 'bus_app') await ensureBusRuns();
      showDetail();
      $('ppConsentDetailTitle').textContent = currentForm.title || '';
      $('ppConsentDetailBody').innerHTML = currentForm.contentHtml || '';
      const due = $('ppConsentDetailDue');
      if (due) {
        due.textContent = currentForm.dueDate
          ? (t('parent.consents.due', '마감') + ': ' + currentForm.dueDate)
          : '';
      }

      const fields = currentForm.fieldsJson || {};
      const choices = fields.choices || [
        { value: 'Y', label: t('parent.consents.agree', '동의함') },
        { value: 'N', label: t('parent.consents.disagree', '동의하지 않음') }
      ];
      const choiceHost = $('ppConsentChoices');
      choiceHost.innerHTML = choices.map((c, i) =>
        '<label class="pp-consent-choice">' +
        '<input type="radio" name="ppConsentChoice" value="' + escapeHtml(c.value) + '"' +
        (i === 0 ? ' checked' : '') + '>' +
        '<span class="pp-consent-choice-text">' + escapeHtml(c.label) + '</span>' +
        '</label>'
      ).join('');
      choiceHost.querySelectorAll('input').forEach((el) => {
        el.addEventListener('change', syncReasonVisibility);
      });
      syncReasonVisibility();
      renderExtraFields(fields);

      const nameEl = $('ppConsentSignerName');
      if (nameEl && !nameEl.value) nameEl.value = defaultSignerName();
      const confirmEl = $('ppConsentEsignConfirm');
      if (confirmEl) confirmEl.checked = false;
      const drawDetails = $('ppConsentDrawDetails');
      if (drawDetails) drawDetails.open = false;
      bindSignature();
      clearSignature();

      if (currentForm.submitted) {
        if (err) err.textContent = t('parent.consents.already', '이미 제출되었습니다.');
        $('ppConsentSubmitBtn').disabled = true;
      } else {
        $('ppConsentSubmitBtn').disabled = false;
      }

      if (location.hash.indexOf(formId) < 0) {
        location.hash = '#/consents/' + encodeURIComponent(formId);
      }
      if (global.SaltI18n) SaltI18n.apply($('ppConsentDetail') || document.body);
    } catch (e) {
      alert(e.message);
    }
  }

  function collectExtra(fields) {
    const kind = (fields && fields.kind) || '';
    if (kind === 'bus_survey') {
      return {
        apartment: ($('ppConsentApartment') && $('ppConsentApartment').value) || '',
        desire: ($('ppConsentDesire') && $('ppConsentDesire').value) || '',
        pickupPlace: ($('ppConsentPickupPlace') && $('ppConsentPickupPlace').value) || ''
      };
    }
    if (kind === 'bus_app') {
      return {
        pickupRunId: ($('ppConsentPickupRun') && $('ppConsentPickupRun').value) || '',
        dismissalRunId: ($('ppConsentDismissalRun') && $('ppConsentDismissalRun').value) || '',
        stopLabel: ($('ppConsentStopLabel') && $('ppConsentStopLabel').value) || '',
        termsAccepted: !!( $('ppConsentTerms') && $('ppConsentTerms').checked )
      };
    }
    return {};
  }

  async function submit() {
    const err = $('ppConsentError');
    const ok = $('ppConsentOk');
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
    if (!currentForm) return;

    const selected = document.querySelector('input[name="ppConsentChoice"]:checked');
    if (!selected) {
      if (err) err.textContent = t('parent.consents.pickChoice', '응답을 선택해 주세요.');
      return;
    }
    const agreed = selected.value;
    const reason = ($('ppConsentReason') && $('ppConsentReason').value) || '';
    if (choiceIsNegative(agreed) && !String(reason).trim()) {
      if (err) err.textContent = t('parent.consents.reasonRequired', '사유를 입력해 주세요.');
      return;
    }

    const fields = currentForm.fieldsJson || {};
    const extra = collectExtra(fields);
    if (fields.kind === 'bus_survey' && agreed === 'Apply' && !String(extra.apartment || '').trim()) {
      if (err) err.textContent = t('parent.consents.apartmentRequired', '거주지를 입력해 주세요.');
      return;
    }
    if (fields.kind === 'bus_app' && agreed === 'Apply') {
      if (!extra.pickupRunId && !extra.dismissalRunId) {
        if (err) err.textContent = t('parent.consents.runRequired', '등교 또는 하교 호차를 선택해 주세요.');
        return;
      }
      if (!extra.termsAccepted) {
        if (err) err.textContent = t('parent.consents.termsRequired', '약관에 동의해 주세요.');
        return;
      }
    }

    const sig = resolveSignature(fields.requireSignature);
    if (!sig.ok) {
      if (err) err.textContent = sig.error;
      return;
    }
    if (sig.signerName) extra.signerName = sig.signerName;

    try {
      $('ppConsentSubmitBtn').disabled = true;
      await api('/api/parent/consents/submit', {
        method: 'POST',
        body: {
          formId: currentForm.formId,
          studentId: currentForm.studentId,
          agreed,
          disagreedReason: reason,
          extraData: extra,
          signatureBase64: sig.dataUrl
        }
      });
      if (ok) ok.textContent = t('parent.consents.submitted', '제출되었습니다. 감사합니다.');
      await refreshPending();
      setTimeout(() => {
        showList();
        if (location.hash.indexOf('/consents') === 0 || location.hash.indexOf('#/consents') === 0) {
          location.hash = '#/consents';
        }
      }, 800);
    } catch (e) {
      if (err) err.textContent = e.message;
      $('ppConsentSubmitBtn').disabled = false;
    }
  }

  async function refreshPending() {
    const data = await api('/api/parent/consents/pending');
    pending = data.pending || [];
    renderList();
    return {
      count: data.count != null ? data.count : pending.length,
      items: pending.map((p) => ({ id: p.formId, title: p.title }))
    };
  }

  async function open(opts) {
    opts = opts || {};
    showList();
    const box = $('ppConsentList');
    if (box) box.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      const info = await refreshPending();
      if (opts.formId) {
        await openForm(opts.formId);
      }
      return info;
    } catch (e) {
      if (box) box.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      return { count: 0, items: [] };
    }
  }

  function init(opts) {
    const rawApi = opts.api;
    api = function (path, options) {
      return rawApi(path, options || {}, 'parent');
    };
    escapeHtml = opts.escapeHtml;
    $ = opts.$;
    const back = $('ppConsentBack');
    if (back) {
      back.addEventListener('click', () => {
        showList();
        location.hash = '#/consents';
      });
    }
    const submitBtn = $('ppConsentSubmitBtn');
    if (submitBtn) submitBtn.addEventListener('click', () => submit());
  }

  global.SaltConsentParent = { init, open, refreshPending };
})(window);
