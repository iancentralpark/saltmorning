/* Shared change-password modal for student / parent / teacher / admin */
window.SaltChangePassword = (function() {
  const MODAL_ID = 'saltChangePwModal';

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;
    const wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.className = 'modal hidden';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'saltChangePwTitle');
    wrap.innerHTML =
      '<div class="modal-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;margin-bottom:0.75rem">' +
          '<h3 id="saltChangePwTitle" style="margin:0">Change password</h3>' +
          '<button type="button" class="btn btn-ghost" id="saltChangePwClose" aria-label="Close">×</button>' +
        '</div>' +
        '<p class="muted small" style="margin:0 0 0.75rem">Use a password only you know. Minimum 4 characters.</p>' +
        '<form id="saltChangePwForm" class="form-grid" style="max-width:none">' +
          '<label>Current password <input type="password" id="saltChangePwCurrent" autocomplete="current-password" required></label>' +
          '<label>New password <input type="password" id="saltChangePwNew" autocomplete="new-password" required minlength="4"></label>' +
          '<label>Confirm new password <input type="password" id="saltChangePwConfirm" autocomplete="new-password" required minlength="4"></label>' +
          '<div class="err small hidden" id="saltChangePwError"></div>' +
          '<div class="muted small hidden" id="saltChangePwSuccess" style="color:#3d7a4a;font-weight:600">Password updated.</div>' +
          '<button type="submit" class="btn btn-primary" id="saltChangePwSubmit">Save new password</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function(e) {
      if (e.target === wrap) close();
    });
    document.getElementById('saltChangePwClose').addEventListener('click', close);
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && !wrap.classList.contains('hidden')) close();
    });
  }

  function open() {
    ensureModal();
    const modal = document.getElementById(MODAL_ID);
    modal.classList.remove('hidden');
    document.getElementById('saltChangePwForm').reset();
    const err = document.getElementById('saltChangePwError');
    const ok = document.getElementById('saltChangePwSuccess');
    err.classList.add('hidden');
    err.textContent = '';
    ok.classList.add('hidden');
    document.getElementById('saltChangePwSubmit').disabled = false;
    setTimeout(function() {
      const input = document.getElementById('saltChangePwCurrent');
      if (input) input.focus();
    }, 0);
  }

  function close() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.classList.add('hidden');
  }

  function syncSavedLoginPassword(newPassword) {
    try {
      if (!window.SaltApp || !SaltApp.getSavedLogin || !SaltApp.setSavedLogin) return;
      const saved = SaltApp.getSavedLogin();
      if (!saved || !saved.savePassword) return;
      SaltApp.setSavedLogin({
        loginId: saved.loginId,
        password: newPassword,
        staySignedIn: saved.staySignedIn !== false,
        savePassword: true
      });
    } catch (e) { /* ignore */ }
  }

  function mount(options) {
    options = options || {};
    const role = options.role;
    const api = options.api || (window.SaltApp && SaltApp.api);
    if (!role || !api) {
      console.warn('SaltChangePassword.mount requires role and api');
      return;
    }
    ensureModal();

    const triggers = [];
    if (options.triggerId) {
      const el = document.getElementById(options.triggerId);
      if (el) triggers.push(el);
    }
    (options.triggerIds || []).forEach(function(id) {
      const el = document.getElementById(id);
      if (el) triggers.push(el);
    });
    document.querySelectorAll('[data-change-password]').forEach(function(el) {
      triggers.push(el);
    });
    triggers.forEach(function(el) {
      el.addEventListener('click', function(e) {
        e.preventDefault();
        open();
      });
    });

    const form = document.getElementById('saltChangePwForm');
    if (form.dataset.bound === '1') return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      const err = document.getElementById('saltChangePwError');
      const ok = document.getElementById('saltChangePwSuccess');
      const submit = document.getElementById('saltChangePwSubmit');
      err.classList.add('hidden');
      ok.classList.add('hidden');
      const currentPassword = document.getElementById('saltChangePwCurrent').value;
      const newPassword = document.getElementById('saltChangePwNew').value;
      const confirmPassword = document.getElementById('saltChangePwConfirm').value;
      submit.disabled = true;
      try {
        await api('/api/auth/change-password', {
          method: 'POST',
          body: { currentPassword, newPassword, confirmPassword }
        }, role);
        syncSavedLoginPassword(newPassword);
        ok.classList.remove('hidden');
        form.reset();
        setTimeout(close, 900);
      } catch (ex) {
        err.textContent = ex.message || 'Could not change password.';
        err.classList.remove('hidden');
      } finally {
        submit.disabled = false;
      }
    });
  }

  return { mount, open, close };
})();
