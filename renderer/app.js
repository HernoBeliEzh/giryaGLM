'use strict';

// Вся логика в IIFE: 'api' уже объявлен глобально через contextBridge,
// поэтому 'const api' на верхнем уровне вызывал SyntaxError и ломал все кнопки.
(() => {
  const api = window.api;

  // Кеш id аккаунтов, для которых лимиты уже грузятся (защита от дублей запроса).
  const loadingSet = new Set();

  // ---------- Утилиты ----------

  const $ = (sel) => document.querySelector(sel);

  function showToast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      el.className = 'toast';
    }, 2800);
  }

  const fmtNum = (n) => (n == null ? '—' : n.toLocaleString('ru-RU'));

  const fmtPct = (used, total) => (total ? Math.round((used / total) * 100) : 0);

  function fmtReset(expiresAt) {
    if (!expiresAt) return '';
    const diff = expiresAt * 1000 - Date.now();
    if (diff <= 0) return '↻ сброс скоро';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `↻ сброс через ${h > 0 ? h + 'ч ' : ''}${m}м`;
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  // ---------- Рендер ----------

  async function refresh() {
    try {
      const data = await api.accounts.list();
      renderStatus(data.zcodeRunning);
      renderList(data.accounts, data.activeId);
    } catch (e) {
      showToast('Не удалось загрузить список: ' + (e.message || e), 'error');
    }
  }

  function renderStatus(running) {
    const pill = $('#zcodeStatus');
    pill.className = 'status-pill' + (running ? ' running' : '');
    $('#statusText').textContent = running ? 'ZCode запущен' : 'ZCode не запущен';
  }

  function renderList(accounts, activeId) {
    const list = $('#accountsList');
    const empty = $('#emptyState');
    list.innerHTML = '';

    if (!accounts.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    accounts.forEach((acc, i) => {
      const card = buildCard(acc, activeId);
      // Лёгкая staggered-задержка для каскадного появления.
      card.style.animationDelay = (i * 60) + 'ms';
      list.appendChild(card);
    });
  }

  function buildCard(acc, activeId) {
    const isActive = acc.id === activeId;
    const card = document.createElement('div');
    card.className = 'card' + (isActive ? ' active' : '');
    card.dataset.id = acc.id;

    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">
          <span class="name" title="${escapeHtml(acc.label)}">${escapeHtml(acc.label)}</span>
          ${isActive ? '<span class="badge active">активен</span>' : '<span class="badge id">' + escapeHtml(acc.userId || acc.id) + '</span>'}
        </div>
        <div class="card-actions">
          <button class="mini-btn act-rename" title="Переименовать">✎</button>
          <button class="mini-btn danger act-delete" title="Удалить">✕</button>
        </div>
      </div>
      <button class="btn btn-primary launch-btn act-launch">
        <span class="launch-label">▶ Запустить</span>
      </button>
      <div class="limits-area"></div>
    `;

    card.querySelector('.act-launch').addEventListener('click', () => onLaunch(card, acc.id));
    card.querySelector('.act-rename').addEventListener('click', () => onRename(acc));
    card.querySelector('.act-delete').addEventListener('click', () => onDelete(acc));

    // Лимиты подгружаем автоматически для всех карточек сразу.
    onLoadLimits(card, acc.id);

    return card;
  }

  // ---------- Обработчики ----------

  function setLaunchLoading(card, loading) {
    const btn = card.querySelector('.launch-btn');
    if (!btn) return;
    if (loading) {
      btn.classList.add('loading');
      btn.innerHTML = '<span class="spinner"></span><span class="launch-label">Переключение…</span>';
    } else {
      btn.classList.remove('loading');
      btn.innerHTML = '<span class="launch-label">▶ Запустить</span>';
    }
  }

  async function onLaunch(card, id) {
    setLaunchLoading(card, true);
    showToast('Закрываю ZCode, меняю аккаунт…', '');
    const res = await api.switchAndLaunch(id);
    setLaunchLoading(card, false);
    if (res.ok) {
      showToast('✓ Аккаунт применён, ZCode запущен', 'success');
      await refresh();
    } else {
      showToast('Ошибка: ' + (res.error || 'не удалось'), 'error');
    }
  }

  async function onLoadLimits(card, id) {
    const area = card.querySelector('.limits-area');
    if (loadingSet.has(id)) return;
    loadingSet.add(id);
    area.innerHTML = `<div class="loading-text">Загрузка лимитов…</div>`;

    const res = await api.limits.fetch(id);
    loadingSet.delete(id);

    if (!res.ok) {
      area.innerHTML = `<div class="error-text">⚠ ${escapeHtml(res.error || 'ошибка')}</div>`;
      return;
    }
    if (!res.balances || !res.balances.length) {
      area.innerHTML = `<div class="loading-text">Лимиты не найдены (нет активного плана).</div>`;
      return;
    }

    let html = '<div class="limits">';
    res.balances.forEach((b) => {
      const pct = fmtPct(b.usedUnits, b.totalUnits);
      let cls = 'fill-ok';
      if (pct >= 90) cls = 'fill-danger';
      else if (pct >= 70) cls = 'fill-warn';
      html += `
        <div class="limit-row">
          <div class="limit-meta">
            <span class="model">${escapeHtml(b.showName)}</span>
            <span class="nums">${fmtNum(b.usedUnits)} / ${fmtNum(b.totalUnits)} · ${pct}%</span>
          </div>
          <div class="bar"><span class="${cls}" data-width="${pct}"></span></div>
        </div>`;
    });
    html += `<div class="limit-hint">${escapeHtml(fmtReset(res.expiresAt))}</div>`;
    html += '</div>';
    area.innerHTML = html;

    // Анимируем заполнение полос после отрисовки.
    requestAnimationFrame(() => {
      area.querySelectorAll('.bar > span').forEach((s) => {
        s.style.width = s.dataset.width + '%';
      });
    });
  }

  async function onRename(acc) {
    const name = window.prompt('Новое имя аккаунта:', acc.label);
    if (name == null) return;
    const res = await api.accounts.rename(acc.id, name);
    if (res.ok) {
      showToast('✓ Переименовано', 'success');
      await refresh();
    } else {
      showToast('Не удалось переименовать', 'error');
    }
  }

  async function onDelete(acc) {
    const res = await api.accounts.delete(acc.id);
    if (res.canceled) return;
    if (res.ok) {
      showToast('✓ Аккаунт удалён', 'success');
      await refresh();
    } else {
      showToast('Не удалось удалить', 'error');
    }
  }

  async function onImportCurrent() {
    const btn = $('#importBtn');
    btn.disabled = true;
    const res = await api.accounts.importCurrent();
    btn.disabled = false;
    if (res.ok) {
      showToast(`✓ Добавлен: ${res.account.label}`, 'success');
      await refresh();
    } else {
      showToast(res.error || 'Не удалось импортировать', 'error');
    }
  }

  async function onAddManual() {
    const jwtEl = $('#jwtInput');
    const labelEl = $('#labelInput');
    const jwt = jwtEl.value.trim();
    const label = labelEl.value.trim();
    if (!jwt) {
      showToast('Вставьте JWT', 'error');
      jwtEl.focus();
      return;
    }
    const res = await api.accounts.addManual(jwt, label);
    if (res.ok) {
      showToast(`✓ Добавлен: ${res.account.label}`, 'success');
      jwtEl.value = '';
      labelEl.value = '';
      $('#manualForm').classList.remove('expanded');
      await refresh();
    } else {
      showToast(res.error || 'Невалидный JWT', 'error');
    }
  }

  // ---------- Привязка событий ----------

  $('#importBtn').addEventListener('click', onImportCurrent);
  $('#refreshBtn').addEventListener('click', refresh);
  $('#addManualBtn').addEventListener('click', onAddManual);

  $('#toggleManualBtn').addEventListener('click', () => {
    const form = $('#manualForm');
    const expanded = form.classList.toggle('expanded');
    if (expanded) setTimeout(() => $('#jwtInput').focus(), 300);
  });

  $('#jwtInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onAddManual();
  });
  $('#labelInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onAddManual();
  });

  // Старт.
  refresh();
})();
