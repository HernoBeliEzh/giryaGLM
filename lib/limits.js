'use strict';

const https = require('https');

const BALANCE_URL = 'https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=3.1.2';

/** Промис-обёртка над https.get. */
function getJson(url, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Некорректный JSON в ответе'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Таймаут запроса'));
    });
  });
}

/**
 * Декодировать payload JWT (без проверки подписи) → объект.
 * Возвращает null для некорректных токенов.
 */
function decodeJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    // base64url → base64
    let p = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // добиваем до кратности 4
    while (p.length % 4) p += '=';
    const json = Buffer.from(p, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Проверить, похожа ли строка на валидный JWT (3 части, раскодируется).
 */
function isValidJwt(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length < 2) return false;
  return decodeJwt(token) !== null;
}

/**
 * Получить лимиты аккаунта по JWT.
 * @param {string} apiKey JWT-токен
 * @returns {Promise<{balances: Array, expiresAt: number|null, serverTime: number|null}>}
 *   balances: [{ showName, totalUnits, usedUnits, remainingUnits }]
 */
async function fetchLimits(apiKey) {
  if (!isValidJwt(apiKey)) {
    throw new Error('Невалидный JWT');
  }
  const json = await getJson(BALANCE_URL, {
    Authorization: 'Bearer ' + apiKey,
    Accept: 'application/json',
  });

  // payload.data.balances[] — основная структура из логов ZCode.
  const data = (json && json.data) || {};
  const rawBalances = Array.isArray(data.balances) ? data.balances : [];

  const balances = rawBalances.map((b) => ({
    showName: b.show_name || '—',
    totalUnits: b.total_units || 0,
    usedUnits: b.used_units || 0,
    remainingUnits: b.remaining_units != null ? b.remaining_units : (b.total_units || 0) - (b.used_units || 0),
  }));

  return {
    balances,
    expiresAt: rawBalances[0] && rawBalances[0].expires_at ? rawBalances[0].expires_at : null,
    serverTime: data.server_time || null,
  };
}

module.exports = {
  fetchLimits,
  isValidJwt,
  decodeJwt,
};
