/* Salt Morning — Teaching material purchase requests */
window.SaltMaterialRequests = (function () {
  let deps = {};
  let teacherClasses = [];

  function $(id) { return deps.$(id); }
  function escapeHtml(s) { return deps.escapeHtml(s); }
  function api(path, opts) { return deps.api(path, opts || {}, deps.role); }
  function t(key, fallback) {
    if (window.SaltI18n && SaltI18n.t) return SaltI18n.t(key, fallback);
    return fallback || key;
  }

  function money(n) {
    const v = Number(n) || 0;
    try {
      return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    } catch (_) {
      return String(Math.round(v));
    }
  }

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString([], {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  }

  function statusLabel(status) {
    if (status === 'purchased') return t('materials.status.purchased', 'Purchased');
    if (status === 'cancelled') return t('materials.status.cancelled', 'Cancelled');
    return t('materials.status.requested', 'Requested');
  }

  function statusClass(status) {
    if (status === 'purchased') return 'mat-status-purchased';
    if (status === 'cancelled') return 'mat-status-cancelled';
    return 'mat-status-requested';
  }

  function init(options) {
    deps = options || {};
  }

  function setClasses(list) {
    teacherClasses = list || [];
  }

  function fillClassSelect(sel) {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">' + escapeHtml(t('materials.classOptional', 'Class (optional)')) + '</option>' +
      teacherClasses.map((c) =>
        '<option value="' + escapeHtml(c.classId) + '">' + escapeHtml(c.className || c.name || c.classId) + '</option>'
      ).join('');
    if (cur) sel.value = cur;
  }

  function syncTotal() {
    const qty = Number(($('matQty') && $('matQty').value) || 0);
    const unit = Number(($('matUnitPrice') && $('matUnitPrice').value) || 0);
    if ($('matTotal')) $('matTotal').value = String(Math.round(qty * unit * 100) / 100);
  }

  function editingId() {
    return ($('matEditId') && $('matEditId').value) || '';
  }

  function setEditing(request) {
    if (!$('matEditId')) return;
    $('matEditId').value = request ? request.requestId : '';
    const submit = $('matRequestForm') && $('matRequestForm').querySelector('[type="submit"]');
    const cancelEdit = $('matCancelEditBtn');
    if (submit) {
      submit.setAttribute('data-i18n', request ? 'materials.saveChanges' : 'materials.submit');
      submit.textContent = t(request ? 'materials.saveChanges' : 'materials.submit',
        request ? 'Save changes' : 'Request purchase');
    }
    if (cancelEdit) cancelEdit.classList.toggle('hidden', !request);
    if (!request) return;
    if ($('matSubject')) $('matSubject').value = request.subject || '';
    if ($('matContent')) $('matContent').value = request.content || '';
    if ($('matItemName')) $('matItemName').value = request.itemName || '';
    if ($('matQty')) $('matQty').value = request.quantity || 1;
    if ($('matUnitPrice')) $('matUnitPrice').value = request.unitPrice || 0;
    if ($('matTotal')) $('matTotal').value = request.totalPrice || 0;
    if ($('matLink')) $('matLink').value = request.purchaseLink || '';
    if ($('matClass')) $('matClass').value = request.classId || '';
    if ($('matRequestForm')) $('matRequestForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function bindTeacherForm() {
    if (!$('matRequestForm') || $('matRequestForm').dataset.bound) return;
    $('matRequestForm').dataset.bound = '1';
    fillClassSelect($('matClass'));
    ['matQty', 'matUnitPrice'].forEach((id) => {
      if ($(id)) $(id).addEventListener('input', syncTotal);
    });
    if ($('matCancelEditBtn')) {
      $('matCancelEditBtn').addEventListener('click', () => {
        $('matRequestForm').reset();
        if ($('matQty')) $('matQty').value = '1';
        setEditing(null);
        syncTotal();
      });
    }
    $('matRequestForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('matFormError');
      const msg = $('matFormMsg');
      if (err) err.textContent = '';
      if (msg) msg.textContent = '';
      const classId = ($('matClass') && $('matClass').value) || '';
      const cls = teacherClasses.find((c) => String(c.classId) === String(classId));
      const payload = {
        classId,
        className: cls ? (cls.className || cls.name || '') : '',
        subject: $('matSubject').value,
        content: $('matContent').value,
        itemName: $('matItemName').value,
        quantity: $('matQty').value,
        unitPrice: $('matUnitPrice').value,
        totalPrice: $('matTotal').value,
        purchaseLink: $('matLink').value
      };
      const id = editingId();
      try {
        if (id) {
          await api('/api/teacher/material-requests/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: payload
          });
        } else {
          await api('/api/teacher/material-requests', {
            method: 'POST',
            body: payload
          });
        }
        $('matRequestForm').reset();
        if ($('matQty')) $('matQty').value = '1';
        setEditing(null);
        syncTotal();
        if (msg) {
          msg.style.color = '#16a34a';
          msg.textContent = id
            ? t('materials.updated', 'Request updated.')
            : t('materials.submitted', 'Purchase request submitted.');
        }
        await loadTeacherList();
      } catch (ex) {
        if (err) err.textContent = ex.message || 'Failed';
      }
    });
  }

  function renderTeacherRows(requests) {
    if (!requests.length) {
      return '<p class="muted small">' + escapeHtml(t('materials.emptyTeacher', 'No purchase requests yet.')) + '</p>';
    }
    return '<div class="mat-list">' + requests.map((r) =>
      '<article class="mat-card">' +
      '<div class="mat-card-head">' +
      '<strong>' + escapeHtml(r.itemName) + '</strong>' +
      '<span class="mat-status ' + statusClass(r.status) + '">' + escapeHtml(statusLabel(r.status)) + '</span>' +
      '</div>' +
      '<p class="muted small mat-card-meta">' +
      escapeHtml(r.subject) +
      (r.className ? ' · ' + escapeHtml(r.className) : '') +
      ' · ' + escapeHtml(formatWhen(r.createdAt)) +
      '</p>' +
      '<p class="mat-card-body">' + escapeHtml(r.content) + '</p>' +
      '<p class="mat-card-price">' +
      escapeHtml(String(r.quantity)) + ' × ' + escapeHtml(money(r.unitPrice)) +
      ' = <strong>' + escapeHtml(money(r.totalPrice)) + '</strong>' +
      '</p>' +
      (r.purchaseLink
        ? '<p class="mat-card-link"><a href="' + escapeHtml(r.purchaseLink) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(t('materials.openLink', 'Open purchase link')) + '</a></p>'
        : '') +
      (r.status === 'purchased' && r.purchasedAt
        ? '<p class="muted small">' + escapeHtml(t('materials.purchasedAt', 'Purchased')) +
          ': ' + escapeHtml(formatWhen(r.purchasedAt)) + '</p>'
        : '') +
      (r.status === 'requested'
        ? '<div class="mat-admin-actions">' +
          '<button type="button" class="btn btn-ghost mat-edit-btn" data-id="' + escapeHtml(r.requestId) + '">' +
          escapeHtml(t('materials.edit', 'Edit')) + '</button>' +
          '<button type="button" class="btn btn-ghost mat-cancel-btn" data-id="' + escapeHtml(r.requestId) + '">' +
          escapeHtml(t('materials.cancel', 'Cancel request')) + '</button>' +
          '</div>'
        : '') +
      '</article>'
    ).join('') + '</div>';
  }

  async function loadTeacherList() {
    const mount = $('matTeacherList');
    if (!mount) return;
    mount.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    try {
      const data = await api('/api/teacher/material-requests');
      const teacherRequests = data.requests || [];
      mount.innerHTML = renderTeacherRows(teacherRequests);
      mount.querySelectorAll('.mat-edit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = teacherRequests.find((r) => String(r.requestId) === String(btn.dataset.id));
          if (row) setEditing(row);
        });
      });
      mount.querySelectorAll('.mat-cancel-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('materials.cancelConfirm', 'Cancel this purchase request?'))) return;
          try {
            await api('/api/teacher/material-requests/' + encodeURIComponent(btn.dataset.id) + '/cancel', {
              method: 'POST'
            });
            if (editingId() === btn.dataset.id) {
              $('matRequestForm').reset();
              setEditing(null);
            }
            await loadTeacherList();
          } catch (e) {
            alert(e.message || 'Could not cancel.');
          }
        });
      });
    } catch (e) {
      mount.innerHTML = '<p class="error">' + escapeHtml(e.message || 'Failed') + '</p>';
    }
  }

  async function openTeacher() {
    bindTeacherForm();
    fillClassSelect($('matClass'));
    syncTotal();
    if (window.SaltI18n) SaltI18n.apply($('materialsView') || document);
    await loadTeacherList();
  }

  function renderAdminRows(requests) {
    if (!requests.length) {
      return '<p class="muted small">' + escapeHtml(t('materials.emptyAdmin', 'No material requests.')) + '</p>';
    }
    return '<div class="mat-list">' + requests.map((r) =>
      '<article class="mat-card">' +
      '<div class="mat-card-head">' +
      '<strong>' + escapeHtml(r.itemName) + '</strong>' +
      '<span class="mat-status ' + statusClass(r.status) + '">' + escapeHtml(statusLabel(r.status)) + '</span>' +
      '</div>' +
      '<p class="muted small mat-card-meta">' +
      escapeHtml(r.teacherName || r.teacherId) +
      ' · ' + escapeHtml(r.subject) +
      (r.className ? ' · ' + escapeHtml(r.className) : '') +
      ' · ' + escapeHtml(formatWhen(r.createdAt)) +
      '</p>' +
      '<p class="mat-card-body">' + escapeHtml(r.content) + '</p>' +
      '<p class="mat-card-price">' +
      escapeHtml(String(r.quantity)) + ' × ' + escapeHtml(money(r.unitPrice)) +
      ' = <strong>' + escapeHtml(money(r.totalPrice)) + '</strong>' +
      '</p>' +
      (r.purchaseLink
        ? '<p class="mat-card-link"><a href="' + escapeHtml(r.purchaseLink) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(r.purchaseLink) + '</a></p>'
        : '') +
      (r.status === 'requested'
        ? '<div class="mat-admin-actions">' +
          '<button type="button" class="btn btn-primary mat-purchase-btn" data-id="' + escapeHtml(r.requestId) + '">' +
          escapeHtml(t('materials.markPurchased', 'Mark purchased')) + '</button>' +
          '<button type="button" class="btn btn-ghost mat-admin-cancel-btn" data-id="' + escapeHtml(r.requestId) + '">' +
          escapeHtml(t('common.cancel', 'Cancel')) + '</button>' +
          '</div>'
        : '') +
      (r.status === 'purchased'
        ? '<p class="muted small">' + escapeHtml(t('materials.purchasedAt', 'Purchased')) +
          ': ' + escapeHtml(formatWhen(r.purchasedAt)) +
          (r.purchasedBy ? ' · ' + escapeHtml(r.purchasedBy) : '') + '</p>'
        : '') +
      '<div class="mat-admin-actions">' +
      (r.status === 'purchased'
        ? '<button type="button" class="btn btn-ghost mat-unpurchase-btn" data-id="' + escapeHtml(r.requestId) + '">' +
          escapeHtml(t('materials.unpurchase', 'Undo purchased')) + '</button>'
        : '') +
      '<button type="button" class="btn btn-ghost mat-delete-btn" data-id="' + escapeHtml(r.requestId) + '">' +
      escapeHtml(t('common.delete', 'Delete')) + '</button>' +
      '</div>' +
      '</article>'
    ).join('') + '</div>';
  }

  async function loadAdminList() {
    const mount = $('matAdminList');
    if (!mount) return;
    mount.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
    const status = ($('matAdminStatusFilter') && $('matAdminStatusFilter').value) || '';
    try {
      const q = status ? ('?status=' + encodeURIComponent(status)) : '';
      const data = await api('/api/admin/material-requests' + q);
      mount.innerHTML = renderAdminRows(data.requests || []);
      mount.querySelectorAll('.mat-purchase-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('materials.purchaseConfirm', 'Mark this item as purchased?'))) return;
          try {
            await api('/api/admin/material-requests/' + encodeURIComponent(btn.dataset.id) + '/purchase', {
              method: 'POST',
              body: {}
            });
            await loadAdminList();
          } catch (e) {
            alert(e.message || 'Could not update.');
          }
        });
      });
      mount.querySelectorAll('.mat-admin-cancel-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('materials.cancelConfirm', 'Cancel this purchase request?'))) return;
          try {
            await api('/api/admin/material-requests/' + encodeURIComponent(btn.dataset.id) + '/cancel', {
              method: 'POST'
            });
            await loadAdminList();
          } catch (e) {
            alert(e.message || 'Could not cancel.');
          }
        });
      });
      mount.querySelectorAll('.mat-unpurchase-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('materials.unpurchaseConfirm', 'Mark this as not purchased so it can be handled again?'))) return;
          try {
            await api('/api/admin/material-requests/' + encodeURIComponent(btn.dataset.id) + '/unpurchase', {
              method: 'POST'
            });
            await loadAdminList();
          } catch (e) {
            alert(e.message || 'Could not update.');
          }
        });
      });
      mount.querySelectorAll('.mat-delete-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('materials.deleteConfirm', 'Delete this request permanently?'))) return;
          try {
            await api('/api/admin/material-requests/' + encodeURIComponent(btn.dataset.id), {
              method: 'DELETE'
            });
            await loadAdminList();
          } catch (e) {
            if (e.needsConfirm) {
              if (!confirm((e.message || '') + '\n\n' + t('materials.deleteConfirmForce', 'Delete anyway?'))) return;
              try {
                await api('/api/admin/material-requests/' + encodeURIComponent(btn.dataset.id) + '?force=1', {
                  method: 'DELETE'
                });
                await loadAdminList();
              } catch (e2) {
                alert(e2.message || 'Could not delete.');
              }
              return;
            }
            alert(e.message || 'Could not delete.');
          }
        });
      });
      if (window.SaltI18n) SaltI18n.apply($('panelMaterials') || document);
    } catch (e) {
      mount.innerHTML = '<p class="error">' + escapeHtml(e.message || 'Failed') + '</p>';
    }
  }

  function openAdmin() {
    if ($('matAdminRefresh') && !$('matAdminRefresh').dataset.bound) {
      $('matAdminRefresh').dataset.bound = '1';
      $('matAdminRefresh').addEventListener('click', loadAdminList);
    }
    if ($('matAdminStatusFilter') && !$('matAdminStatusFilter').dataset.bound) {
      $('matAdminStatusFilter').dataset.bound = '1';
      $('matAdminStatusFilter').addEventListener('change', loadAdminList);
    }
    loadAdminList();
  }

  return { init, setClasses, openTeacher, openAdmin, loadTeacherList, loadAdminList };
})();
