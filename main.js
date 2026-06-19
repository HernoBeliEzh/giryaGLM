'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Лог ошибок рендерера в файл (для диагностики «кнопки не работают»).
const RENDERER_LOG = path.join(app.getPath('userData'), 'renderer-errors.log');
function logRenderer(msg) {
  try {
    fs.appendFileSync(RENDERER_LOG, `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  } catch {}
}

const store = require('./lib/store');
const config = require('./lib/config');
const limits = require('./lib/limits');
const zcode = require('./lib/zcode');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 760,
    minWidth: 560,
    minHeight: 520,
    title: 'ГиряGLM',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Открываем DevTools в режиме dock при DEBUG, либо пишем ошибки в лог.
  if (process.env.ZS_DEBUG === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Перехват любых ошибок консоли рендерера → в файл.
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) logRenderer(`[console:${level}] ${message}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logRenderer(`[render-process-gone] ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on('preload-error', (_e, p, error) => {
    logRenderer(`[preload-error] ${p} ${error && error.message}`);
  });
}

// ---------- IPC-обработчики ----------

// Список аккаунтов + какой сейчас активен (совпадает с config.json).
ipcMain.handle('accounts:list', async () => {
  const accounts = store.listAccounts();
  const currentKey = config.getCurrentApiKey();
  const currentId = currentKey ? store.makeId(currentKey) : null;
  return {
    accounts,
    activeId: accounts.find((a) => a.id === currentId) ? currentId : null,
    zcodeRunning: await zcode.isRunning(),
  };
});

// Импорт текущего аккаунта прямо из config.json ZCode.
ipcMain.handle('accounts:importCurrent', async () => {
  const apiKey = config.getCurrentApiKey();
  if (!apiKey) {
    return { ok: false, error: 'В config.json ZCode нет активного apiKey' };
  }
  if (!limits.isValidJwt(apiKey)) {
    return { ok: false, error: 'Текущий apiKey не похож на валидный JWT' };
  }
  const payload = limits.decodeJwt(apiKey) || {};
  const account = store.addAccount({ apiKey, userId: payload.user_id || payload.sub || null });
  return { ok: true, account };
});

// Ручное добавление по вставленному JWT.
ipcMain.handle('accounts:addManual', async (_evt, { apiKey, label }) => {
  if (!apiKey || !limits.isValidJwt(apiKey)) {
    return { ok: false, error: 'Невалидный JWT' };
  }
  const payload = limits.decodeJwt(apiKey) || {};
  const account = store.addAccount({ apiKey, userId: payload.user_id || payload.sub || null, label });
  return { ok: true, account };
});

// Удаление аккаунта (config.json не трогаем).
ipcMain.handle('accounts:delete', async (evt, { id }) => {
  const accounts = store.listAccounts();
  const acc = accounts.find((a) => a.id === id);
  const confirmed = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Удалить', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    title: 'Удаление аккаунта',
    message: `Удалить «${acc ? acc.label : id}»?`,
    detail: 'JWT будет удалён только из этой программы. Текущий config.json ZCode не изменится.',
  });
  if (confirmed.response !== 0) return { ok: false, canceled: true };
  const removed = store.removeAccount(id);
  return { ok: removed };
});

// Переименование.
ipcMain.handle('accounts:rename', async (_evt, { id, label }) => {
  const acc = store.renameAccount(id, label);
  return { ok: !!acc, account: acc };
});

// Запрос лимитов для конкретного аккаунта.
ipcMain.handle('limits:fetch', async (_evt, { id }) => {
  const accounts = store.listAccounts();
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return { ok: false, error: 'Аккаунт не найден' };
  try {
    const result = await limits.fetchLimits(acc.apiKey);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// Главная операция: закрыть ZCode → подменить apiKey → запустить ZCode.
ipcMain.handle('account:switchAndLaunch', async (_evt, { id }) => {
  const accounts = store.listAccounts();
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return { ok: false, error: 'Аккаунт не найден' };
  if (!limits.isValidJwt(acc.apiKey)) {
    return { ok: false, error: 'JWT аккаунта невалиден' };
  }

  // 1. Закрываем запущенный ZCode.
  try {
    await zcode.killZcode();
    // Небольшая пауза, чтобы OS освободила файл config.json.
    await new Promise((r) => setTimeout(r, 600));
  } catch (e) {
    return { ok: false, error: 'Не удалось закрыть ZCode: ' + (e.message || e) };
  }

  // 2. Меняем apiKey в config.json (с автоматическим .bak).
  try {
    config.setCurrentApiKey(acc.apiKey);
  } catch (e) {
    return { ok: false, error: 'Не удалось записать config.json: ' + (e.message || e) };
  }

  // 3. Запускаем ZCode.exe.
  try {
    await zcode.launchZcode();
  } catch (e) {
    return { ok: false, error: 'Ключ применён, но ZCode не запустился: ' + (e.message || e) };
  }

  return { ok: true, activeId: acc.id };
});

app.whenReady().then(() => {
  store.init(app.getPath('userData'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
