import assert from 'node:assert/strict';

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === '--base-url'),
    'Usage: node scripts/mock-smoke.mjs [--base-url http://127.0.0.1:5173]');
  const base = new URL(args[1] ?? 'http://127.0.0.1:5173');
  assert(['http:', 'https:'].includes(base.protocol), 'Base URL must use HTTP or HTTPS');
  assert(['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname), 'Base URL must target loopback');
  assert(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash,
    'Base URL must be a plain loopback origin without credentials, path, query, or fragment');

  async function request(path, json = true) {
    const response = await fetch(new URL(path, base), {
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    assert(response.ok, `${path}: HTTP ${response.status}`);
    if (!json) return response.text();
    try { return await response.json(); }
    catch { throw new Error(`${path}: response is not valid JSON`); }
  }

  const health = await request('/healthz');
  assert.equal(health.status, 'ok', '/healthz: status must be ok');
  const html = await request('/', false);
  assert(/<div\b[^>]*\bid\s*=\s*["']root["']/i.test(html), '/: frontend root mount is missing');
  const run = await request('/api/run?ticker=AAPL&explain=1');
  assert.equal(run.sentiment?.warning, 'live_providers_disabled', 'Response lacks the synthetic mock marker');
  assert.equal(run.quote?.last, 0, 'Mock quote.last must be zero');
  assert.equal(run.ticker, 'AAPL', 'Response ticker must be AAPL');
  const rec = run.recommendation;
  assert(rec && ['NO_ACTION', 'DEBIT_CALL', 'DEBIT_PUT', 'COVERED_CALL', 'IRON_CONDOR'].includes(rec.class),
    'Recommendation class is missing or unsupported');
  assert(typeof rec.version === 'string' && rec.version.trim(), 'Recommendation model version is missing');
  assert(Number.isFinite(rec.confidence) && rec.confidence >= 0 && rec.confidence <= 1,
    'Recommendation confidence must be a number in [0, 1]');
  const numeric = ['sent_mean', 'sent_std', 'r_1m', 'r_5m', 'mins_since_news', 'rv20'];
  const boolean = ['above_sma20', 'earnings_soon', 'liquidity_flag'];
  for (const key of numeric) assert(Number.isFinite(run.features?.[key]), `Feature ${key} must be numeric`);
  for (const key of boolean) assert.equal(typeof run.features?.[key], 'boolean', `Feature ${key} must be boolean`);
  assert(Number.isInteger(run.features.mins_since_news) && run.features.mins_since_news >= 0
    && run.features.mins_since_news <= 1440, 'mins_since_news must be an integer in [0, 1440]');
  const explain = run.explain;
  assert(explain && !explain.error, 'Explanation is missing or failed');
  assert.equal(explain.version, rec.version, 'Explanation model version mismatch');
  for (const key of ['class', 'confidence', 'version']) {
    assert.equal(explain.prediction?.[key], rec[key], `Explanation prediction ${key} mismatch`);
  }
  assert(Array.isArray(explain.top_importances), 'Explanation importances must be an array');
  for (const entry of explain.top_importances) {
    assert(typeof entry.feature === 'string' && Number.isFinite(entry.importance)
      && entry.importance >= 0 && entry.importance <= 1, 'Invalid explanation importance');
  }
  for (const key of [...numeric, ...boolean]) {
    assert.equal(explain.inputs?.[key], run.features[key], `Explanation input ${key} mismatch`);
  }
  console.log(`Mock smoke passed: ${base.origin}; AAPL ${rec.class}, model ${rec.version}`);
}

main().catch(error => {
  console.error(`Mock smoke failed: ${error.message}${error.cause?.message ? ` (${error.cause.message})` : ''}`);
  process.exitCode = 1;
});
