// Shared VIP-status helper: turns a raw vip_expires_at timestamp into the
// public-facing boolean `is_vip`, without leaking the raw expiry date to
// other users' profile/card views.
function isVip(vipExpiresAt) {
  return !!vipExpiresAt && new Date(vipExpiresAt) > new Date();
}

// Replaces `vip_expires_at` with `is_vip` on a single profile-shaped object
// (e.g. a joined `customer`/`owner`/`author`/`executor` sub-object). No-op if
// the object is null/undefined (common for optional joins).
function withIsVip(profileLike) {
  if (!profileLike) return profileLike;
  const { vip_expires_at, ...rest } = profileLike;
  return { ...rest, is_vip: isVip(vip_expires_at) };
}

// Скидка на подписку по уровню (profiles.level, 1-10 — см. utils/reputation.js).
// Таблица настраивается: admin_settings.vip_level_discounts — 10 процентов через
// запятую, по одному на уровень. Значения по умолчанию сохраняют исходное
// правило (+10% за каждый уровень выше первого, на 10-м уровне 100%), поэтому
// без ключа в настройках поведение прежнее.
const DEFAULT_LEVEL_DISCOUNTS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 100];
const LEVELS = DEFAULT_LEVEL_DISCOUNTS.length;

// Мусор в настройке не должен ронять покупку или обнулять цену: при любом
// несоответствии формату возвращаем таблицу по умолчанию. Запись при этом
// валидируется отдельно (ADMIN_SETTING_VALIDATORS, routes/admin.js), так что
// сюда мусор попадёт только если ключ правили в базе руками.
function parseLevelDiscounts(raw) {
  if (raw == null || String(raw).trim() === '') return DEFAULT_LEVEL_DISCOUNTS;
  const parts = String(raw).split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== LEVELS) return DEFAULT_LEVEL_DISCOUNTS;
  if (parts.some(n => !Number.isFinite(n) || n < 0 || n > 100)) return DEFAULT_LEVEL_DISCOUNTS;
  return parts;
}

function vipDiscountPct(level, discounts) {
  const table = Array.isArray(discounts) && discounts.length === LEVELS
    ? discounts
    : DEFAULT_LEVEL_DISCOUNTS;
  const l = Math.min(LEVELS, Math.max(1, parseInt(level, 10) || 1));
  return table[l - 1];
}

// Rounded to kopecks — p_price goes straight into the transactions ledger.
function applyVipDiscount(price, level, discounts) {
  return Math.round(price * (100 - vipDiscountPct(level, discounts))) / 100;
}

module.exports = {
  isVip, withIsVip, vipDiscountPct, applyVipDiscount,
  parseLevelDiscounts, DEFAULT_LEVEL_DISCOUNTS, VIP_LEVELS: LEVELS,
};

// ponytail: smallest possible self-check, run with `node src/utils/vip.js`
if (require.main === module) {
  const assert = require('assert');

  // Поведение по умолчанию — то же, что было до настраиваемой таблицы.
  assert.strictEqual(vipDiscountPct(1), 0);
  assert.strictEqual(vipDiscountPct(5), 40);
  assert.strictEqual(vipDiscountPct(9), 80);
  assert.strictEqual(vipDiscountPct(10), 100);
  assert.strictEqual(vipDiscountPct(null), 0);
  assert.strictEqual(applyVipDiscount(300, 1), 300);
  assert.strictEqual(applyVipDiscount(300, 5), 180);
  assert.strictEqual(applyVipDiscount(1500, 10), 0);
  assert.strictEqual(isVip(null), false);

  // Таблица из настроек применяется целиком.
  const flat = parseLevelDiscounts('0,5,5,5,5,5,5,5,5,50');
  assert.deepStrictEqual(flat, [0, 5, 5, 5, 5, 5, 5, 5, 5, 50]);
  assert.strictEqual(vipDiscountPct(2, flat), 5);
  assert.strictEqual(vipDiscountPct(10, flat), 50);
  assert.strictEqual(applyVipDiscount(300, 10, flat), 150);
  // Уровень вне 1..10 прижимается к границам, а не выходит за таблицу.
  assert.strictEqual(vipDiscountPct(99, flat), 50);
  assert.strictEqual(vipDiscountPct(0, flat), 0);

  // Пробелы и дробные проценты допустимы.
  assert.deepStrictEqual(parseLevelDiscounts(' 0 , 2.5 ,5,5,5,5,5,5,5, 7.5 '),
    [0, 2.5, 5, 5, 5, 5, 5, 5, 5, 7.5]);

  // Любой мусор → таблица по умолчанию, а не нулевая цена.
  for (const bad of ['', null, undefined, 'abc', '0,10', '0,10,20,30,40,50,60,70,80,100,110',
                     '0,10,20,30,40,50,60,70,80,999', '0,10,20,30,40,50,60,70,80,-5']) {
    assert.deepStrictEqual(parseLevelDiscounts(bad), DEFAULT_LEVEL_DISCOUNTS, `мусор: ${bad}`);
  }
  assert.strictEqual(applyVipDiscount(300, 1, parseLevelDiscounts('мусор')), 300);

  console.log('vip.js self-check passed');
}
