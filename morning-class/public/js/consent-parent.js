/* Parent Consents — list, bus fields, canvas signature, submit */
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
      box.innerHTML = '<p class="muted">' + escapeHtml(t('parent.consents.empty', 'No pending forms.')) + '</p>';
      return;
    }
    box.innerHTML = pending.map((f) =>
      '<button type="button" class="pp-consent-card" data-consent-open="' + escapeHtml(f.formId) + '">' +
      '<div class="pp-consent-card-title">' + escapeHtml(f.title) + '</div>' +
      '<div class="muted small">' + escapeHtml(f.category || '') +
      (f.dueDate ? ' · due ' + escapeHtml(f.dueDate) : '') + '</div></button>'
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
        '<label><span>' + escapeHtml(t('parent.consents.apartment', 'Apartment / dong')) + '</span>' +
        '<input id="ppConsentApartment" maxlength="120" required></label>' +
        '<label><span>' + escapeHtml(t('parent.consents.desire', 'Desired use')) + '</span>' +
        '<select id="ppConsentDesire">' +
        '<option value="both">등하원 (AM+PM)</option>' +
        '<option value="pickup">등교 only</option>' +
        '<option value="dismissal">하교 only</option>' +
        '<option value="self">자가 (no bus)</option>' +
        '</select></label>' +
        '<label><span>' + escapeHtml(t('parent.consents.pickupPlace', 'Preferred pickup place')) + '</span>' +
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
        '<label><span>' + escapeHtml(t('parent.consents.pickupRun', 'Morning pickup (등교)')) + '</span>' +
        '<select id="ppConsentPickupRun"><option value="">—</option>' +
        pickup.map(opt).join('') + '</select></label>' +
        '<label><span>' + escapeHtml(t('parent.consents.dismissalRun', 'Dismissal (하교)')) + '</span>' +
        '<select id="ppConsentDismissalRun"><option value="">—</option>' +
        dismiss.map(opt).join('') + '</select></label>' +
        '<label><span>' + escapeHtml(t('parent.consents.stopLabel', 'Stop / note')) + '</span>' +
        '<input id="ppConsentStopLabel" maxlength="120"></label>' +
        '<label class="pp-consent-terms"><input type="checkbox" id="ppConsentTerms"> ' +
        escapeHtml(t('parent.consents.terms', 'I agree to the shuttle terms and schedule.')) + '</label>';
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
          ? (t('parent.consents.due', 'Due') + ': ' + currentForm.dueDate)
          : '';
      }

      const fields = currentForm.fieldsJson || {};
      const choices = fields.choices || [
        { value: 'Y', label: t('parent.consents.agree', 'Agree') },
        { value: 'N', label: t('parent.consents.disagree', 'Do not agree') }
      ];
      const choiceHost = $('ppConsentChoices');
      choiceHost.innerHTML = choices.map((c, i) =>
        '<label class="pp-consent-choice"><input type="radio" name="ppConsentChoice" value="' +
        escapeHtml(c.value) + '"' + (i === 0 ? ' checked' : '') + '> ' +
        escapeHtml(c.label) + '</label>'
      ).join('');
      choiceHost.querySelectorAll('input').forEach((el) => {
        el.addEventListener('change', syncReasonVisibility);
      });
      syncReasonVisibility();
      renderExtraFields(fields);
      bindSignature();
      clearSignature();

      if (currentForm.submitted) {
        if (err) err.textContent = t('parent.consents.already', 'Already submitted for this student.');
        $('ppConsentSubmitBtn').disabled = true;
      } else {
        $('ppConsentSubmitBtn').disabled = false;
      }

      if (location.hash.indexOf(formId) < 0) {
        location.hash = '#/consents/' + encodeURIComponent(formId);
      }
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
      if (err) err.textContent = t('parent.consents.pickChoice', 'Please select a response.');
      return;
    }
    const agreed = selected.value;
    const reason = ($('ppConsentReason') && $('ppConsentReason').value) || '';
    if (choiceIsNegative(agreed) && !String(reason).trim()) {
      if (err) err.textContent = t('parent.consents.reasonRequired', 'Please enter a reason.');
      return;
    }

    const fields = currentForm.fieldsJson || {};
    const extra = collectExtra(fields);
    if (fields.kind === 'bus_survey' && agreed === 'Apply' && !String(extra.apartment || '').trim()) {
      if (err) err.textContent = t('parent.consents.apartmentRequired', 'Apartment / area is required.');
      return;
    }
    if (fields.kind === 'bus_app' && agreed === 'Apply') {
      if (!extra.pickupRunId && !extra.dismissalRunId) {
        if (err) err.textContent = t('parent.consents.runRequired', 'Select at least one bus run.');
        return;
      }
      if (!extra.termsAccepted) {
        if (err) err.textContent = t('parent.consents.termsRequired', 'Please accept the shuttle terms.');
        return;
      }
    }

    if (fields.requireSignature !== false && isBlankSignature()) {
      if (err) err.textContent = t('parent.consents.sigRequired', 'Please sign in the box.');
      return;
    }

    const signatureBase64 = (fields.requireSignature === false)
      ? ''
      : canvas().toDataURL('image/png');

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
          signatureBase64
        }
      });
      if (ok) ok.textContent = t('parent.consents.submitted', 'Submitted. Thank you.');
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
    api = opts.api;
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
