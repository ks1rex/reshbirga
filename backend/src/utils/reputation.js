// Level thresholds + reputation/achievement helpers shared across routes.

const LEVEL_THRESHOLDS = [0, 200, 500, 1000, 2000, 3500, 5500, 8500, 12500, 18000];

// Репутация за полученный отзыв. Плохие оценки её отнимают: 1★ — минус 30,
// 2★ — минус 15, 3★ не двигает. Начисляется только исполнителю (см.
// routes/orders.js): +50 за выполненный заказ получает тоже он, поэтому минус
// у него есть чем компенсировать, а у заказчика такого источника нет.
const REVIEW_REPUTATION = { 5: 30, 4: 15, 3: 0, 2: -15, 1: -30 };

function reviewReputation(rating) {
  return REVIEW_REPUTATION[parseInt(rating, 10)] ?? 0;
}

function calculateLevel(reputation) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (reputation >= LEVEL_THRESHOLDS[i]) return i + 1;
  }
  return 1;
}

function nextLevelReputation(reputation) {
  const next = LEVEL_THRESHOLDS.find(t => t > reputation);
  return next ?? null; // null = max level reached
}

// Репутация не уходит в минус: ниже нуля обрезается до нуля. Иначе новый
// исполнитель с одной единицей ушёл бы в отрицательные значения, из которых
// невозможно выбраться, а уровень всё равно считается от неотрицательного числа.
//
// В reputation_log пишется фактически применённое изменение, а не запрошенное:
// иначе журнал утверждал бы «-30» там, где реально списалось 10.
//
// ponytail: read-then-write, not atomic — fine for reputation (cosmetic, not
// money); switch to a SQL increment RPC if concurrent grants start under-counting.
async function addReputation(supabase, userId, amount) {
  if (!amount) return null; // 3★ и прочие нулевые изменения не пишем в журнал

  const { data: prof } = await supabase.from('profiles').select('reputation').eq('id', userId).single();
  const before = prof?.reputation ?? 0;
  const reputation = Math.max(0, before + amount);
  const applied = reputation - before;
  if (applied === 0) return before; // уже на нуле, списывать нечего

  await supabase.from('profiles').update({ reputation, level: calculateLevel(reputation) }).eq('id', userId);
  await supabase.from('reputation_log').insert({ user_id: userId, amount: applied });
  return reputation;
}

// INSERT ... ON CONFLICT DO NOTHING via upsert with ignoreDuplicates.
async function grantAchievement(supabase, userId, type) {
  await supabase.from('achievements').upsert(
    { user_id: userId, type },
    { onConflict: 'user_id,type', ignoreDuplicates: true }
  );
}

module.exports = {
  LEVEL_THRESHOLDS, REVIEW_REPUTATION,
  calculateLevel, nextLevelReputation, reviewReputation, addReputation, grantAchievement,
};

// ponytail: smallest possible self-check, run with `node src/utils/reputation.js`
if (require.main === module) {
  const assert = require('assert');

  assert.strictEqual(calculateLevel(0), 1);
  assert.strictEqual(calculateLevel(199), 1);
  assert.strictEqual(calculateLevel(200), 2);
  assert.strictEqual(calculateLevel(17999), 9);
  assert.strictEqual(calculateLevel(18000), 10);
  assert.strictEqual(calculateLevel(999999), 10);
  assert.strictEqual(nextLevelReputation(0), 200);
  assert.strictEqual(nextLevelReputation(18000), null);

  // Очки за отзыв: пятёрка и четвёрка добавляют, двойка и единица отнимают.
  assert.strictEqual(reviewReputation(5), 30);
  assert.strictEqual(reviewReputation(4), 15);
  assert.strictEqual(reviewReputation(3), 0);
  assert.strictEqual(reviewReputation(2), -15);
  assert.strictEqual(reviewReputation(1), -30);
  assert.strictEqual(reviewReputation('1'), -30, 'рейтинг может прийти строкой');
  assert.strictEqual(reviewReputation(undefined), 0);

  // Понижение уровня при списании — обратная сторона того же порога.
  assert.strictEqual(calculateLevel(200 + reviewReputation(1)), 1);

  // Проверка обрезки на нуле и записи фактического изменения в журнал.
  (async () => {
    let stored = 0;
    const log = [];
    const fakeDb = {
      from(table) {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { reputation: stored } }) }) }),
          update: patch => ({ eq: async () => { stored = patch.reputation; } }),
          insert: async row => { log.push(row.amount); },
        };
      },
    };

    assert.strictEqual(await addReputation(fakeDb, 'u', 50), 50);
    assert.strictEqual(await addReputation(fakeDb, 'u', -15), 35);
    // Списание больше остатка обрезается до нуля, а не уводит в минус.
    assert.strictEqual(await addReputation(fakeDb, 'u', -100), 0);
    assert.deepStrictEqual(log, [50, -15, -35], 'в журнал пишется применённое изменение');
    // На нуле повторное списание не создаёт записи вовсе.
    assert.strictEqual(await addReputation(fakeDb, 'u', -30), 0);
    assert.strictEqual(log.length, 3);
    // Нулевое изменение (3★) не трогает ни профиль, ни журнал.
    assert.strictEqual(await addReputation(fakeDb, 'u', 0), null);
    assert.strictEqual(log.length, 3);

    console.log('reputation.js self-check passed');
  })();
}
