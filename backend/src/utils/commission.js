// Комиссия биржи: отображаемая цена одна и та же для покупателя и продавца,
// но покупатель платит цену + pct%, а продавец получает цену целиком.
// Разница — доход платформы, признаётся при завершении сделки
// (transactions.platform_profit на выплате исполнителю).
const DEFAULT_MARKETPLACE_COMMISSION_PCT = 11;

const round2 = n => Math.round(n * 100) / 100;

async function marketplaceCommissionPct() {
  // require внутри функции: чистая арифметика ниже должна считаться и без
  // ключей Supabase — иначе самопроверка в конце файла не запустится.
  const supabase = require('../supabase_client');
  const { data } = await supabase
    .from('admin_settings')
    .select('value')
    .eq('key', 'marketplace_commission_pct')
    .maybeSingle();
  const pct = parseFloat(data?.value);
  return Number.isFinite(pct) ? pct : DEFAULT_MARKETPLACE_COMMISSION_PCT;
}

// Сколько списать с покупателя за цену price.
const chargeWithCommission = (price, pct) => round2(price * (1 + pct / 100));

// Комиссия считается как разница, а не отдельным округлением — иначе
// цена + комиссия могут не сойтись с суммой списания на копейку.
const commissionOn = (price, pct) => round2(chargeWithCommission(price, pct) - round2(price));

// Обратная операция: сколько получит исполнитель, если charge — это то, что
// уже целиком списывается с заказчика (комиссия сидит внутри charge, не сверху).
const payoutFromCharge = (charge, pct) => round2(charge / (1 + pct / 100));

module.exports = {
  DEFAULT_MARKETPLACE_COMMISSION_PCT,
  marketplaceCommissionPct,
  chargeWithCommission,
  commissionOn,
  payoutFromCharge,
  round2,
};

// ponytail: самопроверка вместо тест-фреймворка (его в репозитории нет) —
// `node src/utils/commission.js`. Ловит главное: цена + комиссия обязана
// сходиться со списанием до копейки, иначе резерв заказа не закроется.
if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(chargeWithCommission(500, 10), 550);
  assert.strictEqual(commissionOn(500, 10), 50);
  assert.strictEqual(chargeWithCommission(0, 10), 0);
  assert.strictEqual(commissionOn(0, 10), 0);
  assert.strictEqual(commissionOn(500, 0), 0);
  for (const price of [0.01, 33.33, 99.99, 1234.56, 1000000]) {
    for (const pct of [0, 5, 10, 17.5, 100]) {
      const charge = chargeWithCommission(price, pct);
      assert.strictEqual(round2(price + commissionOn(price, pct)), charge,
        `price=${price} pct=${pct}: цена + комиссия ≠ списание`);
      assert.ok(charge >= round2(price), `price=${price} pct=${pct}: списание меньше цены`);
      const payout = payoutFromCharge(charge, pct);
      assert.ok(Math.abs(payout - price) < 0.02, `price=${price} pct=${pct}: payoutFromCharge не обращает chargeWithCommission`);
    }
  }
  console.log('commission.js: ok');
}
