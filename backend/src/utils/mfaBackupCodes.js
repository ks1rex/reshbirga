const crypto = require('crypto');

// Резервные коды админского 2FA. Алфавит без похожих друг на друга символов
// (нет 0/O, 1/I/L) — код диктуют по телефону и вводят руками один раз в жизни.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 16;   // 16 символов × log2(31) ≈ 79 бит
const CODE_COUNT = 10;

// ponytail: sha256 без соли и без растягивания. Это не пароль, а случайный
// секрет на 79 бит — перебор по украденной базе нереален, а bcrypt/scrypt тут
// только добавили бы зависимость и задержку. Если формат кода когда-нибудь
// станет короче — переходить на scrypt.
function hashCode(code) {
  return crypto.createHash('sha256').update(normalizeCode(code)).digest('hex');
}

// Пользователь вводит код как угодно: с дефисами, пробелами, в нижнем регистре.
function normalizeCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateCode() {
  // randomInt — равномерная выборка без остаточного смещения (в отличие от
  // randomBytes % alphabet.length).
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

// Отдаём коды в читаемом виде (группы по 4), а хеши — от нормализованного.
function formatCode(code) {
  return normalizeCode(code).replace(/(.{4})(?=.)/g, '$1-');
}

function generateCodes(count = CODE_COUNT) {
  const codes = Array.from({ length: count }, generateCode);
  return codes.map(c => ({ code: formatCode(c), hash: hashCode(c) }));
}

module.exports = { generateCodes, hashCode, normalizeCode, formatCode, CODE_COUNT };

// ponytail: минимальная проверка, запускается `node src/utils/mfaBackupCodes.js`
if (require.main === module) {
  const assert = require('assert');

  const codes = generateCodes();
  assert.strictEqual(codes.length, CODE_COUNT);
  assert.strictEqual(new Set(codes.map(c => c.hash)).size, CODE_COUNT, 'коды не должны повторяться');

  // Формат: 4 группы по 4 символа из разрешённого алфавита.
  for (const { code } of codes) assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);

  // Ввод «как получилось» должен сходиться с сохранённым хешем.
  const { code, hash } = codes[0];
  assert.strictEqual(hashCode(code), hash, 'код с дефисами');
  assert.strictEqual(hashCode(code.toLowerCase()), hash, 'нижний регистр');
  assert.strictEqual(hashCode(code.replace(/-/g, ' ')), hash, 'пробелы вместо дефисов');
  assert.notStrictEqual(hashCode('AAAA-AAAA-AAAA-AAAA'), hash, 'чужой код не должен совпасть');

  // Хеш, а не сам код: в базе не должно быть ничего, по чему код угадывается.
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(normalizeCode(code)));

  console.log('mfaBackupCodes.js self-check passed');
}
