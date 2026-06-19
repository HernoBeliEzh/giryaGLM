'use strict';

const { exec, spawn } = require('child_process');
const path = require('path');

// Стандартный путь установки ZCode desktop на Windows.
const ZCODE_EXE = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
  'Programs', 'ZCode', 'ZCode.exe'
);

/**
 * Завершить все запущенные процессы ZCode.exe (Windows: taskkill).
 * @returns {Promise<{killed:number}>} сколько процессов было завершено
 */
function killZcode() {
  return new Promise((resolve) => {
    // /FI "IMAGENAME eq ZCode.exe" — фильтр по имени, /T — дерево процессов, /F — принудительно.
    exec('taskkill /F /T /FI "IMAGENAME eq ZCode.exe"', (err, stdout, stderr) => {
      // taskkill возвращает ненулевой код, если процессов нет — это не ошибка для нас.
      const out = (stdout || '').toLowerCase();
      const successMatch = out.match(/успешно завершено|successfully|terminated/i);
      const killed = successMatch ? 1 : 0;
      resolve({ killed });
    });
  });
}

/**
 * Проверить, запущен ли ZCode сейчас.
 * @returns {Promise<boolean>}
 */
function isRunning() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq ZCode.exe" /NH', (err, stdout) => {
      if (err) return resolve(false);
      resolve((stdout || '').toLowerCase().includes('zcode.exe'));
    });
  });
}

/**
 * Запустить ZCode.exe отсоединённо (detached), чтобы не быть дочерним процессом.
 * @returns {Promise<boolean>} true если запуск инициирован
 */
function launchZcode() {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(ZCODE_EXE, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.on('error', (e) => reject(new Error('Не удалось запустить ZCode.exe: ' + e.message)));
      child.unref();
      // Даём процессу мгновение на старт.
      setTimeout(() => resolve(true), 300);
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  ZCODE_EXE,
  killZcode,
  launchZcode,
  isRunning,
};
