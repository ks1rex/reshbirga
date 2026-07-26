// PostgREST caps every response at `db-max-rows` (1000 on Supabase by default),
// and silently — you get 1000 rows and no error. Any "sum/count everything"
// query therefore has to page. This walks the pages for you.
//
// buildQuery() must return a *fresh* PostgREST builder each call (they're
// single-use once awaited).

const PAGE = 1000;
// ponytail: hard stop so a runaway table can't spin forever. 500 pages = 500k
// rows; raise it (or move the aggregate into a SQL RPC) if a table outgrows it.
const MAX_PAGES = 500;

async function fetchAll(buildQuery) {
  const out = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const from = p * PAGE;
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) return { data: out, error, truncated: true };
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return { data: out, error: null, truncated: false };
  }
  return { data: out, error: null, truncated: true };
}

// Sum a numeric column across every matching row.
async function sumAll(buildQuery, column) {
  const { data, error } = await fetchAll(buildQuery);
  const total = (data ?? []).reduce((s, r) => s + (parseFloat(r[column]) || 0), 0);
  return { total: Math.round(total * 100) / 100, error };
}

module.exports = { fetchAll, sumAll, PAGE };

// ponytail: smallest possible self-check, run with `node src/utils/pagedFetch.js`
if (require.main === module) {
  const assert = require('assert');

  // Fake PostgREST builder over a fixed array, honouring .range(from, to).
  const fake = rows => () => ({
    range: async (from, to) => ({ data: rows.slice(from, to + 1), error: null }),
  });

  (async () => {
    // Exactly one short page
    let r = await fetchAll(fake([{ n: 1 }, { n: 2 }]));
    assert.strictEqual(r.data.length, 2);
    assert.strictEqual(r.truncated, false);

    // Empty table
    r = await fetchAll(fake([]));
    assert.deepStrictEqual(r.data, []);
    assert.strictEqual(r.truncated, false);

    // Crosses the page boundary — this is the case a plain select silently
    // truncated to PAGE rows.
    const many = Array.from({ length: PAGE + 7 }, (_, i) => ({ n: i }));
    r = await fetchAll(fake(many));
    assert.strictEqual(r.data.length, PAGE + 7);

    // Exact multiple of PAGE: needs the extra empty page to know it's done.
    r = await fetchAll(fake(Array.from({ length: PAGE * 2 }, (_, i) => ({ n: i }))));
    assert.strictEqual(r.data.length, PAGE * 2);

    // Sum over the boundary, and non-numeric/null values counted as 0.
    const s = await sumAll(fake([{ a: '1.5' }, { a: null }, { a: 2 }, { a: 'nope' }]), 'a');
    assert.strictEqual(s.total, 3.5);

    // Error mid-walk returns what it had, flagged truncated — callers must not
    // treat a partial sum as complete.
    const boom = () => ({ range: async () => ({ data: null, error: { message: 'boom' } }) });
    r = await fetchAll(boom);
    assert.strictEqual(r.truncated, true);
    assert.ok(r.error);

    console.log('pagedFetch.js self-check passed');
  })();
}
