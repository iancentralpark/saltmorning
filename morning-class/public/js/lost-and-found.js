/* Lost & Found — teacher post + parent claim feed */
(function (global) {
  function t(key, fallback) {
    return (global.SaltI18n && SaltI18n.t) ? SaltI18n.t(key, fallback) : (fallback || key);
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
        render(box, data.items || []);
      } catch (e) {
        box.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }

    function render(box, items) {
      if (!items.length) {
        box.innerHTML = '<p class="muted">' + escapeHtml(t('parent.laf.empty', '등록된 분실물이 없습니다.')) + '</p>';
        return;
      }
      box.innerHTML = '<div class="laf-feed">' + items.map((it) => {
        const statusLabel = it.status === 'ClaimRequested'
          ? (it.isMine
            ? t('parent.laf.requested', '확인 요청됨 — 교사 확인 대기')
            : t('parent.laf.otherClaim', '다른 가정 요청 중'))
          : t('parent.laf.unclaimed', '미수령');
        const can = it.status === 'Unclaimed' || (it.status === 'ClaimRequested' && it.isMine);
        return '<article class="laf-card">' +
          (it.imageUrl
            ? '<img src="' + escapeHtml(it.imageUrl) + '" alt="">'
            : '<div style="height:120px;background:var(--cream);display:flex;align-items:center;justify-content:center" class="muted">No photo</div>') +
          '<div class="laf-card-body">' +
          '<h4>' + escapeHtml(it.title) + '</h4>' +
          '<p class="muted small" style="margin:0 0 0.35rem">' + escapeHtml(it.foundLocation) +
          (it.category ? ' · ' + escapeHtml(it.category) : '') + '</p>' +
          '<p class="muted small" style="margin:0 0 0.5rem">' + escapeHtml(statusLabel) + '</p>' +
          (it.status === 'Unclaimed'
            ? '<button type="button" class="btn btn-primary" data-laf-claim="' + escapeHtml(it.itemId) + '">' +
              escapeHtml(t('parent.laf.claim', '저희 아이 물품입니다')) + '</button>'
            : '') +
          '</div></article>';
      }).join('') + '</div>';

      box.querySelectorAll('[data-laf-claim]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('parent.laf.confirm', '이 물품이 자녀의 것이 맞습니까?'))) return;
          try {
            btn.disabled = true;
            await api('/api/parent/lost-and-found/' + encodeURIComponent(btn.dataset.lafClaim) + '/claim', {
              method: 'POST',
              body: { claimNote: '저희 아이 물품입니다' }
            });
            open();
          } catch (e) {
            alert(e.message);
            btn.disabled = false;
          }
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
      bindForm();
      await refresh();
    }

    function bindForm() {
      const btn = $('tchLafPostBtn');
      if (!btn || btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', async () => {
        const err = $('tchLafErr');
        if (err) err.textContent = '';
        const fd = new FormData();
        fd.append('title', ($('tchLafTitle') && $('tchLafTitle').value) || '');
        fd.append('foundLocation', ($('tchLafLoc') && $('tchLafLoc').value) || '');
        fd.append('category', ($('tchLafCat') && $('tchLafCat').value) || 'Other');
        const file = $('tchLafPhoto') && $('tchLafPhoto').files && $('tchLafPhoto').files[0];
        if (file) fd.append('photo', file);
        try {
          btn.disabled = true;
          await api('/api/teacher/lost-and-found', { method: 'POST', body: fd });
          if ($('tchLafTitle')) $('tchLafTitle').value = '';
          if ($('tchLafLoc')) $('tchLafLoc').value = '';
          if ($('tchLafPhoto')) $('tchLafPhoto').value = '';
          if (err) {
            err.style.color = '#16a34a';
            err.textContent = t('teacher.laf.posted', '게시되었습니다.');
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
      const box = $('tchLafList');
      if (!box) return;
      box.innerHTML = '<p class="muted">…</p>';
      try {
        const data = await api('/api/teacher/lost-and-found');
        const items = data.items || [];
        if (!items.length) {
          box.innerHTML = '<p class="muted">' + escapeHtml(t('teacher.laf.empty', '게시물 없음')) + '</p>';
          return;
        }
        box.innerHTML = '<div class="laf-feed">' + items.map((it) =>
          '<article class="laf-card">' +
          (it.imageUrl ? '<img src="' + escapeHtml(it.imageUrl) + '" alt="">' : '') +
          '<div class="laf-card-body">' +
          '<h4>' + escapeHtml(it.title) + '</h4>' +
          '<p class="muted small">' + escapeHtml(it.foundLocation) + ' · ' + escapeHtml(it.status) + '</p>' +
          (it.status === 'ClaimRequested'
            ? '<p class="muted small">' + escapeHtml(t('teacher.laf.claimBy', '요청')) + ': ' +
              escapeHtml(it.claimedByStudentName || it.claimedByStudentId) +
              (it.claimNote ? ' — ' + escapeHtml(it.claimNote) : '') + '</p>' +
              '<button type="button" class="btn btn-primary" data-laf-done="' + escapeHtml(it.itemId) + '">' +
              escapeHtml(t('teacher.laf.complete', '수령 완료')) + '</button>'
            : '') +
          '</div></article>'
        ).join('') + '</div>';
        box.querySelectorAll('[data-laf-done]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            try {
              await api('/api/teacher/lost-and-found/' + encodeURIComponent(btn.dataset.lafDone) + '/complete', {
                method: 'POST'
              });
              refresh();
            } catch (e) { alert(e.message); }
          });
        });
      } catch (e) {
        box.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>';
      }
    }

    return { init, open };
  })();

  global.SaltLostFound = { Parent, Teacher };
})(window);
