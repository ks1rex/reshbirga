// Level thresholds + reputation/achievement helpers shared across routes.

const LEVEL_THRESHOLDS = [0, 200, 500, 1000, 2000, 3500, 5500, 8500, 12500, 18000];

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

// ponytail: read-then-write, not atomic — fine for reputation (cosmetic, not
// money); switch to a SQL increment RPC if concurrent grants start under-counting.
async function addReputation(supabase, userId, amount) {
  const { data: prof } = await supabase.from('profiles').select('reputation').eq('id', userId).single();
  const reputation = (prof?.reputation ?? 0) + amount;
  await supabase.from('profiles').update({ reputation, level: calculateLevel(reputation) }).eq('id', userId);
  await supabase.from('reputation_log').insert({ user_id: userId, amount });
  return reputation;
}

// INSERT ... ON CONFLICT DO NOTHING via upsert with ignoreDuplicates.
async function grantAchievement(supabase, userId, type) {
  await supabase.from('achievements').upsert(
    { user_id: userId, type },
    { onConflict: 'user_id,type', ignoreDuplicates: true }
  );
}

module.exports = { LEVEL_THRESHOLDS, calculateLevel, nextLevelReputation, addReputation, grantAchievement };

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
  console.log('reputation.js self-check passed');
}
