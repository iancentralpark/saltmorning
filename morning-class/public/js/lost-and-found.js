/* Lost & Found — office registers; teacher / student / parent browse photo gallery */
(function (global) {
  function t(key, fallback) {
    return (global.SaltI18n && SaltI18n.t) ? SaltI18n.t(key, fallback) : (fallback || key);
  }

  function statusLabel(it, mode) {
    if (it.status === 'Claimed') return t('laf.status.claimed', 'Picked up');
    if (it.status === 'ClaimRequested') {
      if (mode === 'parent' && it.isMine) return t('parent.laf.requested', 'Claim requested — waiting for the office');
      if (mode === 'parent') return t('parent.laf.otherClaim', 'Another family requested this');
      return t('laf.status.requested', 'Claim requested');
    }
    return t('parent.laf.unclaimed', 'Unclaimed');
  }

  function photoBlock(it, escapeHtml) {
    const img = it.imageUrl
      ? '<img src="' + escapeHtml(it.imageUrl) + '" alt="' + escapeHtml(it.title || '') + '">'
      : '<div class="laf-card-placeholder">' + escapeHtml(t('laf.noPhoto', 'No photo')) + '</div>';
    return '<div class="laf-card-photo">' + img +
      '<div class="laf-card-caption">' +
      '<h4>' + escapeHtml(it.title) + '</h4>' +
      '<p>' + escapeHtml(it.foundLocation || '') +
      (it.category ? ' · ' + escapeHtml(it.category) : '') + '</p>' +
      '</div></div>';
  }

  function renderGallery(box, items, opts) {
    const escapeHtml = opts.escapeHtml;
    const mode = opts.mode || 'browse';
    if (!items.length) {
      box.innerHTML = '<p class="muted">' + escapeHtml(t('parent.laf.empty', 'No lost items in the office right now.')) + '</p>';
      return;
    }
    box.innerHTML = '<div class="laf-feed">' + items.map((it) => {
      let actions = '';
      if (mode === 'parent' && it.status === 'Unclaimed') {
        actions = '<button type="button" class="btn btn-primary" data-laf-claim="' + escapeHtml(it.itemId) + '">' +
          escapeHtml(t('parent.laf.claim', 'This is my child’s')) + '</button>';
      }
      if (mode === 'parent' && it.canWithdraw) {
        actions += '<button type="button" class="btn btn-ghost" data-laf-withdraw="' + escapeHtml(it.itemId) + '">' +
          escapeHtml(t('parent.laf.withdraw', 'Withdraw request')) + '</button>';
      }
      if (mode === 'admin' && it.status === 'ClaimRequested') {
        actions =
          '<p class="muted small" style="margin:0 0 0.45rem">' +
          escapeHtml(t('teacher.laf.claimBy', 'Requested by')) + ': ' +
          escapeHtml(it.claimedByStudentName || it.claimedByStudentId) +
          (it.claimNote ? ' — ' + escapeHtml(it.claimNote) : '') + '</p>' +
          '<div class="laf-card-actions">' +
          '<button type="button" class="btn btn-primary" data-laf-done="' + escapeHtml(it.itemId) + '">' +
          escapeHtml(t('teacher.laf.complete', 'Confirm pickup')) + '</button>' +
          '<button type="button" class="btn btn-ghost" data-laf-reject="' + escapeHtml(it.itemId) + '">' +
          escapeHtml(t('teacher.laf.reject', 'Decline claim')) + '</button></div>';
      }
      if (mode === 'admin') {
        actions += '<button type="button" class="btn btn-ghost laf-delete-btn" data-laf-delete="' +
          escapeHtml(it.itemId) + '">' + escapeHtml(t('common.delete', 'Delete')) + '</button>';
      }
      return '<article class="laf-card">' +
        photoBlock(it, escapeHtml) +
        '<div class="laf-card-body">' +
        '<p class="muted small laf-card-status">' + escapeHtml(statusLabel(it, mode)) + '</p>' +
        actions +
        '</div></article>';
    }).join('') + '</div>';
  }

  const Parent = (function () {
    let api = null;
    let $ = null;
    let escapeHtml = null;

    function init(deps) {
      api = function (path, opts) { return deps.api(path, opts, 'parent'); };
      $ = deps.$;
      escapeHtml = deps.escapeHtml;
    }

    async function open() {
      const box = $('ppLafMount');
      if (!box) return;
      box.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
      try {
        const data = await api('/api/parent/lost-and-found');
        renderGallery(box, data.items || [], { escapeHtml, mode: 'parent' });
        bindParent(box);
      } catch (e) {
        box.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }

    function bindParent(box) {
      box.querySelectorAll('[data-laf-claim]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('parent.laf.confirm', 'Is this your child’s item?'))) return;
          try {
            btn.disabled = true;
            await api('/api/parent/lost-and-found/' + encodeURIComponent(btn.dataset.lafClaim) + '/claim', {
              method: 'POST',
              body: { claimNote: t('parent.laf.claim', 'This is my child’s') }
            });
            open();
          } catch (e) {
            alert(e.message);
            btn.disabled = false;
          }
        });
      });
      box.querySelectorAll('[data-laf-withdraw]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('parent.laf.withdrawConfirm', 'Withdraw this claim request?'))) return;
          try {
            await api('/api/parent/lost-and-found/' + encodeURIComponent(btn.dataset.lafWithdraw) + '/withdraw', {
              method: 'POST'
            });
            open();
          } catch (e) { alert(e.message); }
        });
      });
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
      const box = $('tchLafList');
      if (!box) return;
      box.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
      try {
        const data = await api('/api/teacher/lost-and-found');
        renderGallery(box, data.items || [], { escapeHtml, mode: 'browse' });
      } catch (e) {
        box.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }

    return { init, open };
  })();

  const Student = (function () {
    let api = null;
    let $ = null;
    let escapeHtml = null;

    function init(deps) {
      api = function (path, opts) { return deps.api(path, opts, 'student'); };
      $ = deps.$;
      escapeHtml = deps.escapeHtml;
    }

    async function open() {
      const box = $('stuLafList');
      if (!box) return;
      box.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
      try {
        const data = await api('/api/student/lost-and-found');
        renderGallery(box, data.items || [], { escapeHtml, mode: 'browse' });
      } catch (e) {
        box.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }

    return { init, open };
  })();

  const Admin = (function () {
    let api = null;
    let $ = null;
    let escapeHtml = null;
    let role = 'admin';

    function init(deps) {
      api = function (path, opts) { return deps.api(path, opts, role); };
      $ = deps.$;
      escapeHtml = deps.escapeHtml;
      role = deps.role || 'admin';
    }

    function bindForm() {
      const btn = $('adminLafPostBtn');
      if (!btn || btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', async () => {
        const err = $('adminLafErr');
        if (err) {
          err.style.color = '';
          err.textContent = '';
        }
        const fd = new FormData();
        fd.append('title', ($('adminLafTitle') && $('adminLafTitle').value) || '');
        fd.append('foundLocation', ($('adminLafLoc') && $('adminLafLoc').value) || '');
        fd.append('category', ($('adminLafCat') && $('adminLafCat').value) || 'Other');
        const file = $('adminLafPhoto') && $('adminLafPhoto').files && $('adminLafPhoto').files[0];
        if (file) fd.append('photo', file);
        try {
          btn.disabled = true;
          await api('/api/admin/lost-and-found', { method: 'POST', body: fd });
          if ($('adminLafTitle')) $('adminLafTitle').value = '';
          if ($('adminLafLoc')) $('adminLafLoc').value = '';
          if ($('adminLafPhoto')) $('adminLafPhoto').value = '';
          if (err) {
            err.style.color = '#16a34a';
            err.textContent = t('admin.laf.posted', 'Item registered.');
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
      const box = $('adminLafList');
      if (!box) return;
      box.innerHTML = '<p class="muted">' + escapeHtml(t('common.loading', 'Loading…')) + '</p>';
      try {
        const data = await api('/api/admin/lost-and-found');
        renderGallery(box, data.items || [], { escapeHtml, mode: 'admin' });
        box.querySelectorAll('[data-laf-done]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            try {
              await api('/api/admin/lost-and-found/' + encodeURIComponent(btn.dataset.lafDone) + '/complete', {
                method: 'POST'
              });
              refresh();
            } catch (e) { alert(e.message); }
          });
        });
        box.querySelectorAll('[data-laf-reject]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm(t('teacher.laf.rejectConfirm', 'Decline this claim and put the item back on the shelf?'))) return;
            try {
              await api('/api/admin/lost-and-found/' + encodeURIComponent(btn.dataset.lafReject) + '/reject', {
                method: 'POST',
                body: { reason: 'Claim declined by office' }
              });
              refresh();
            } catch (e) { alert(e.message); }
          });
        });
        box.querySelectorAll('[data-laf-delete]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm(t('admin.laf.deleteConfirm', 'Remove this item from Lost & Found?'))) return;
            try {
              await api('/api/admin/lost-and-found/' + encodeURIComponent(btn.dataset.lafDelete), {
                method: 'DELETE'
              });
              refresh();
            } catch (e) { alert(e.message); }
          });
        });
      } catch (e) {
        box.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }

    async function open() {
      bindForm();
      if (window.SaltI18n) SaltI18n.apply($('panelLostFound') || document);
      await refresh();
    }

    return { init, open };
  })();

  global.SaltLostFound = { Parent, Teacher, Student, Admin };
})(window);
