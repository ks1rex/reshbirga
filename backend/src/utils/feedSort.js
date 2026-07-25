// Marketplace feed ordering for GET /orders and GET /listings.
//
// Sorted in Node, not SQL: the sort key (VIP status + rating) lives on the
// *joined* profiles row, and PostgREST can't order a parent table by an
// embedded column. Feeds are capped at 100/200 rows, so this is a sort over an
// already-small array.
// ponytail: sorting after the DB limit means the cap is still applied by
// created_at desc — with more than 200 active listings, a VIP with an old
// listing could fall outside the window. Move to a SQL view/RPC with a
// denormalised sort key if the feed ever needs real pagination.

const { isVip } = require('./vip');

const SORTS = ['rating', 'new'];

function normalizeSort(sort) {
  return SORTS.includes(sort) ? sort : 'rating';
}

// getProfile: row -> the joined profile object (customer/owner)
// ratingKey:  which rating column on that profile to sort by
function sortFeed(rows, sort, getProfile, ratingKey) {
  const vip    = r => (isVip(getProfile(r)?.vip_expires_at) ? 1 : 0);
  const rating = r => {
    const v = parseFloat(getProfile(r)?.[ratingKey]);
    return Number.isFinite(v) ? v : -Infinity; // NULLS LAST
  };
  const time = r => new Date(r.created_at).getTime();

  return [...rows].sort((a, b) =>
    vip(b) - vip(a) ||
    (normalizeSort(sort) === 'rating'
      ? rating(b) - rating(a) || time(a) - time(b)
      : time(b) - time(a) || rating(b) - rating(a))
  );
}

module.exports = { normalizeSort, sortFeed };

// ponytail: smallest possible self-check, run with `node src/utils/feedSort.js`
if (require.main === module) {
  const assert = require('assert');
  const future = new Date(Date.now() + 8.64e7).toISOString();
  const past   = new Date(Date.now() - 8.64e7).toISOString();
  const p = r => r.owner;
  const rows = [
    { id: 'a', created_at: '2026-01-01', owner: { rating_as_executor: 5, vip_expires_at: null } },
    { id: 'b', created_at: '2026-01-02', owner: { rating_as_executor: 1, vip_expires_at: future } },
    { id: 'c', created_at: '2026-01-03', owner: { rating_as_executor: null, vip_expires_at: past } },
    { id: 'd', created_at: '2026-01-04', owner: { rating_as_executor: 4, vip_expires_at: null } },
  ];
  // VIP first regardless of rating; then rating desc; nulls last; oldest first on ties.
  assert.deepStrictEqual(sortFeed(rows, 'rating', p, 'rating_as_executor').map(r => r.id), ['b', 'a', 'd', 'c']);
  assert.deepStrictEqual(sortFeed(rows, 'new', p, 'rating_as_executor').map(r => r.id), ['b', 'd', 'c', 'a']);
  assert.strictEqual(normalizeSort('bogus'), 'rating');
  assert.strictEqual(normalizeSort('new'), 'new');
  console.log('feedSort.js self-check passed');
}
