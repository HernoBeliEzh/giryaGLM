'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// ZCode хранит OAuth-сессию (логин через chat.z.ai) в этом файле,
// в формате enc:v1. Это и есть «настоящее» место активного аккаунта —
// config.json ZCode перезаписывает из credentials.json при старте.
const ZCODE_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.zcode', 'v2');
const CREDENTIALS_PATH = path.join(ZCODE_DIR, 'credentials.json');

// Имена полей внутри credentials.json (привязаны к аккаунту).
const FIELD_JWT = 'zcodejwttoken';
const FIELD_ACCESS_TOKEN = 'oauth:zai:access_token';
const FIELD_USER_INFO = 'oauth:zai:user_info';
const FIELD_ACTIVE_PROVIDER = 'oauth:active_provider';

// Схема шифрования ZCode (расшифрована из out/main/index.js):
//   алгоритм  aes-256-gcm
//   ключ      sha256(secret)
//   secret    env.ZCODE_CREDENTIAL_SECRET
//             ИЛИ "zcode-credential-fallback:{platform}:{homedir}:{username}"
//   формат    "enc:v1:" + base64url(iv12) + "." + base64url(authTag16) + "." + base64url(ciphertext)
const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const ENV_SECRET = 'ZCODE_CREDENTIAL_SECRET';

const b64u2b = (s) => Buffer.from(s, 'base64url');
const b2b64u = (b) => b.toString('base64url');

/** Секретная строка-источник ключа (как в ZCode). */
function credentialSecret(env = process.env) {
  if (env[ENV_SECRET]) return env[ENV_SECRET];
  let username = 'unknown';
  try { username = os.userInfo().username; } catch {}
  return `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${username}`;
}

/** 32-байтовый ключ AES-256 из секрета. */
function deriveCipherKey(env = process.env) {
  return crypto.createHash('sha256').update(credentialSecret(env)).digest();
}

/** Зашифровать строку → "enc:v1:iv.tag.ct". */
function encrypt(plain, env = process.env) {
  const key = deriveCipherKey(env);
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return [PREFIX, b2b64u(iv), '.', b2b64u(tag), '.', b2b64u(ct)].join('');
}

/**
 * Расшифровать "enc:v1:..." → исходная строка.
 * Обычные (незашифрованные) строки возвращает как есть.
 */
function decrypt(enc, env = process.env) {
  if (typeof enc !== 'string' || !enc.startsWith(PREFIX)) return enc;
  const parts = enc.slice(PREFIX.length).split('.');
  if (parts.length !== 3) throw new Error('Некорректный формат шифр-текста');
  const iv = b64u2b(parts[0]);
  const tag = b64u2b(parts[1]);
  const ct = b64u2b(parts[2]);
  if (iv.length !== IV_LEN) throw new Error('Некорректная длина IV');
  if (tag.length !== TAG_LEN) throw new Error('Некорректная длина authTag');
  const d = crypto.createDecipheriv(ALGO, deriveCipherKey(env), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

/** Прочитать credentials.json как объект (расшифровка не выполняется). */
function readCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) return {};
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
}

/** Безопасно сохранить credentials.json с резервной копией .bak. */
function writeCredentials(obj) {
  if (fs.existsSync(CREDENTIALS_PATH)) {
    fs.copyFileSync(CREDENTIALS_PATH, CREDENTIALS_PATH + '.bak');
  }
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

/** Расшифровать весь credentials.json → {field: plaintext}. Для отладки/импорта. */
function readDecrypted() {
  const raw = readCredentials();
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    try { out[k] = decrypt(v); } catch { out[k] = v; }
  }
  return out;
}

/**
 * Получить текущий JWT из credentials.json (расшифрованный).
 * Это «каноничный» активный аккаунт — именно его показывает ZCode при старте.
 * @returns {string|null}
 */
function getCurrentJwt() {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    const dec = readDecrypted();
    const jwt = dec[FIELD_JWT];
    return typeof jwt === 'string' && jwt.length > 0 ? jwt : null;
  } catch {
    return null;
  }
}

/**
 * Заменить активный аккаунт в credentials.json.
 * Меняет поле zcodejwttoken (JWT apiKey). При наличии user_info/access_token
 * от того же аккаунта они подменяются тоже — иначе ZCode покажет несогласованное
 * состояние. Принимает предварительно расшифрованные значения.
 *
 * @param {object} opts
 * @param {string} opts.jwt        новый JWT (apiKey) — обязательно
 * @param {string} [opts.userInfo] распарсенный объект user_info (опционально)
 * @param {string} [opts.accessToken] OAuth access token (опционально)
 */
function setActiveAccount({ jwt, userInfo, accessToken }) {
  if (!jwt || typeof jwt !== 'string') throw new Error('Пустой JWT');
  const raw = readCredentials();
  raw[FIELD_JWT] = encrypt(jwt);
  if (typeof userInfo === 'string') raw[FIELD_USER_INFO] = encrypt(userInfo);
  else if (userInfo && typeof userInfo === 'object') {
    raw[FIELD_USER_INFO] = encrypt(JSON.stringify(userInfo));
  }
  if (typeof accessToken === 'string' && accessToken.length) {
    raw[FIELD_ACCESS_TOKEN] = encrypt(accessToken);
  }
  // active_provider всегда zai (это аккаунты Z.ai Start-плана).
  if (!(FIELD_ACTIVE_PROVIDER in raw)) raw[FIELD_ACTIVE_PROVIDER] = encrypt('zai');
  writeCredentials(raw);
}

module.exports = {
  CREDENTIALS_PATH,
  FIELD_JWT,
  FIELD_ACCESS_TOKEN,
  FIELD_USER_INFO,
  FIELD_ACTIVE_PROVIDER,
  encrypt,
  decrypt,
  readCredentials,
  writeCredentials,
  readDecrypted,
  getCurrentJwt,
  setActiveAccount,
};
