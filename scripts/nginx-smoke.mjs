import assert from 'node:assert/strict';

async function main() {
  const args = process.argv.slice(2);
  let baseValue = 'http://127.0.0.1:8081';
  let upstreamDown = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) baseValue = args[++i];
    else if (args[i] === '--upstream-down') upstreamDown = true;
    else throw new Error('Usage: node scripts/nginx-smoke.mjs [--base-url http://127.0.0.1:8081] [--upstream-down]');
  }
  const base = new URL(baseValue);
  assert(['http:', 'https:'].includes(base.protocol)
    && ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname), 'Base URL must use HTTP(S) loopback');
  assert(!base.username && !base.password && base.pathname === '/' && !base.search && !base.hash,
    'Base URL must be a plain origin without credentials, path, query, or fragment');

  async function request(path) {
    const url = new URL(path, base);
    assert.equal(url.origin, base.origin, 'Asset must remain on the local origin');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    return { status: response.status, type: response.headers.get('content-type') ?? '', text: await response.text() };
  }
  const isHtml = text => /<!doctype\s+html|<html\b|<div\b[^>]*\bid=["']root["']/i.test(text);
  function json(response, label) {
    assert(response.type.includes('application/json'), `${label}: expected JSON MIME type`);
    try { return JSON.parse(response.text); }
    catch { throw new Error(`${label}: invalid JSON`); }
  }
  if (upstreamDown) {
    for (const path of ['/healthz', '/api/run?ticker=AAPL&explain=1']) {
      const response = await request(path);
      assert([502, 504].includes(response.status), `${path}: upstream failure must return 502/504, got ${response.status}`);
      assert(!/\bid=["']root["']/i.test(response.text), `${path}: upstream failure served SPA`);
    }
    console.log(`Nginx upstream failure checks passed: ${base.origin}`);
    return;
  }
  const health = await request('/healthz');
  assert.equal(health.status, 200, '/healthz: expected 200');
  const healthJson = json(health, '/healthz');
  assert.equal(healthJson.status, 'ok');
  assert.equal(healthJson.service, 'gateway', '/healthz: expected proxied gateway health');

  let index;
  for (const path of ['/', '/history', '/settings']) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path}: expected 200`);
    assert(response.type.includes('text/html') && /<div\b[^>]*\bid=["']root["']/i.test(response.text), `${path}: missing SPA HTML root`);
    if (path === '/') index = response.text;
    else assert.equal(response.text, index, `${path}: deep link did not serve index HTML`);
  }
  const assetPaths = [...index.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)].map(match => match[1]);
  assert(assetPaths.some(path => /\.js(?:\?|$)/.test(path)), 'Index lacks built JavaScript');
  assert(assetPaths.some(path => /\.css(?:\?|$)/.test(path)), 'Index lacks built CSS');
  for (const path of new Set(assetPaths)) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path}: expected 200`);
    assert(response.text.trim() && !isHtml(response.text), `${path}: asset is empty or HTML`);
    const css = /\.css(?:\?|$)/.test(path);
    assert(css ? response.type.includes('text/css') : /(?:javascript|ecmascript)/.test(response.type), `${path}: incorrect asset MIME type`);
  }
  const absentAsset = await request('/assets/nginx-smoke-definitely-missing.js');
  assert.equal(absentAsset.status, 404, 'Missing asset must return 404');
  const absentApi = await request('/api/nginx-smoke-definitely-missing');
  assert.equal(absentApi.status, 404, 'Missing API route must return 404');
  assert.equal(json(absentApi, 'Missing API route').detail, 'Not Found');
  console.log(`Nginx routing and static asset checks passed: ${base.origin}`);
}

main().catch(error => {
  console.error(`Nginx smoke failed: ${error.message}${error.cause?.message ? ` (${error.cause.message})` : ''}`);
  process.exitCode = 1;
});
