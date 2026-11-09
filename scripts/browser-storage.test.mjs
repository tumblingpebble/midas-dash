import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('../platform_app/', import.meta.url));
const requireFrontend = createRequire(join(frontend, 'package.json'));
// Use Vite's already-installed compiler; no additional test packages are needed.
const esbuild = requireFrontend('esbuild');
const tempRoot = resolve(tmpdir());
const fixtureDir = mkdtempSync(join(tempRoot, 'midas-storage-test-'));
const fixtureFile = join(fixtureDir, 'fixture.cjs');
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Storage tests must not make network requests'); };

after(async () => {
  globalThis.fetch = originalFetch;
  await esbuild.stop();
  // Only remove the unique directory created by this test, inside the OS temp root.
  if (dirname(resolve(fixtureDir)) !== tempRoot || !basename(fixtureDir).startsWith('midas-storage-test-')) {
    throw new Error('Refusing cleanup outside the storage-test temporary directory');
  }
  rmSync(fixtureDir, { recursive: true, force: true });
});

esbuild.buildSync({
  stdin: {
    resolveDir: frontend,
    sourcefile: 'storage-test-entry.tsx',
    contents: `
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { MemoryRouter } from 'react-router-dom';
      import { RunPage } from './src/pages/RunPage';
      import { HistoryPage } from './src/pages/HistoryPage';
      import { useRunHistory } from './src/hooks/useRunHistory';
      import { useSettings } from './src/hooks/useSettings';
      export { browserStorage, createBrowserStorage } from './src/lib/browserStorage';
      export function renderRunPage() {
        return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RunPage)));
      }
      export function renderHistoryPage() {
        return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HistoryPage)));
      }
      export function readSettings() {
        let value;
        function Probe() { value = useSettings().settings; return null; }
        renderToStaticMarkup(createElement(Probe));
        return value;
      }
      export function readHistory() {
        let value;
        function Probe() { value = useRunHistory().items; return null; }
        renderToStaticMarkup(createElement(Probe));
        return value;
      }
    `,
  },
  outfile: fixtureFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  jsx: 'automatic',
  define: { 'import.meta.env.VITE_API_BASE_URL': '""' },
  logLevel: 'silent',
});
const app = requireFrontend(fixtureFile);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
}

const blocked = () => Object.assign(new Error('Browser storage blocked'), { name: 'SecurityError' });
const full = () => Object.assign(new Error('Browser storage full'), { name: 'QuotaExceededError' });
const keys = ['midas_dash_last_ticker_v1', 'midas_dash_last_run_v1', 'midas_dash_history_v1', 'midas_dash_settings_v1'];

function withBrowserStorage(getStorage, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const clean = memoryStorage();
  function reset() {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => clean });
    for (const key of keys) app.browserStorage.removeItem(key);
  }
  try {
    reset();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: getStorage });
    return run();
  } finally {
    reset();
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
}

const run = {
  ticker: 'AAPL',
  features: {},
  recommendation: { class: 'DEBIT_CALL', confidence: 0.83 },
  one_liner: { text: 'Successful response retained despite failed persistence.' },
  ts_gateway: '2026-01-01T12:00:00Z',
};

test('successful persistence still observes external browser updates', () => {
  const disk = memoryStorage();
  const storage = app.createBrowserStorage(() => disk);
  storage.setItem('ticker', 'AAPL');
  assert.equal(disk.getItem('ticker'), 'AAPL');
  disk.values.set('ticker', 'MSFT');
  assert.equal(storage.getItem('ticker'), 'MSFT');
});

test('a throwing storage property uses memory for reads, writes and removals', () => {
  const storage = app.createBrowserStorage(() => { throw blocked(); });
  assert.equal(storage.getItem('ticker'), null);
  storage.setItem('ticker', 'AAPL');
  assert.equal(storage.getItem('ticker'), 'AAPL');
  storage.removeItem('ticker');
  assert.equal(storage.getItem('ticker'), null);
});

test('a transient read failure retains the last successfully read value', () => {
  const disk = memoryStorage({ ticker: 'AAPL' });
  let denied = false;
  const storage = app.createBrowserStorage(() => ({
    ...disk,
    getItem: key => { if (denied) throw blocked(); return disk.getItem(key); },
  }));
  assert.equal(storage.getItem('ticker'), 'AAPL');
  denied = true;
  assert.equal(storage.getItem('ticker'), 'AAPL');
});

test('cold blocked reads recover saved values without persisting fallback defaults', () => {
  const saved = {
    history: JSON.stringify([{ id: 'saved', ticker: 'MSFT' }]),
    settings: JSON.stringify({ enableExplain: true }),
  };
  const disk = memoryStorage(saved);
  let denied = true;
  let writes = 0;
  const storage = app.createBrowserStorage(() => ({
    ...disk,
    getItem: key => { if (denied) throw blocked(); return disk.getItem(key); },
    setItem: (key, value) => { writes++; disk.setItem(key, value); },
  }));
  for (const key of Object.keys(saved)) assert.equal(storage.getItem(key), null);
  assert.equal(writes, 0);
  assert.deepEqual(Object.fromEntries(disk.values), saved);
  denied = false;
  for (const [key, value] of Object.entries(saved)) assert.equal(storage.getItem(key), value);
  assert.equal(writes, 0);
  assert.deepEqual(Object.fromEntries(disk.values), saved);
});

test('quota failure cannot replace a new value with stale persisted data', () => {
  const disk = memoryStorage({ ticker: 'OLD' });
  const storage = app.createBrowserStorage(() => ({ ...disk, setItem: () => { throw full(); } }));
  storage.setItem('ticker', 'NEW');
  assert.equal(disk.getItem('ticker'), 'OLD');
  assert.equal(storage.getItem('ticker'), 'NEW');
  disk.values.set('ticker', 'OTHER');
  assert.equal(storage.getItem('ticker'), 'NEW');
});

test('failed removal does not resurrect an older persisted snapshot', () => {
  const disk = memoryStorage({ snapshot: 'OLD' });
  const storage = app.createBrowserStorage(() => ({ ...disk, removeItem: () => { throw blocked(); } }));
  storage.removeItem('snapshot');
  assert.equal(disk.getItem('snapshot'), 'OLD');
  assert.equal(storage.getItem('snapshot'), null);
});

test('a later successful write resumes normal persistence behavior', () => {
  const disk = memoryStorage();
  let denied = true;
  const storage = app.createBrowserStorage(() => ({
    ...disk,
    setItem: (key, value) => { if (denied) throw full(); disk.setItem(key, value); },
  }));
  storage.setItem('ticker', 'AAPL');
  denied = false;
  storage.setItem('ticker', 'MSFT');
  assert.equal(disk.getItem('ticker'), 'MSFT');
  disk.values.set('ticker', 'TSLA');
  assert.equal(storage.getItem('ticker'), 'TSLA');
});

test('JSON writes preserve a response in memory when persistence is full', () => {
  const disk = memoryStorage();
  const storage = app.createBrowserStorage(() => ({ ...disk, setItem: () => { throw full(); } }));
  assert.doesNotThrow(() => storage.setJson('snapshot', run));
  assert.deepEqual(JSON.parse(storage.getItem('snapshot')), run);
});

test('serialization failure does not throw or overwrite the last valid value', () => {
  const disk = memoryStorage();
  const storage = app.createBrowserStorage(() => disk);
  storage.setJson('snapshot', run);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.doesNotThrow(() => storage.setJson('snapshot', cyclic));
  assert.deepEqual(JSON.parse(storage.getItem('snapshot')), run);
});

test('successful writes are cached if browser reads subsequently fail', () => {
  const disk = memoryStorage();
  const storage = app.createBrowserStorage(() => ({ ...disk, getItem: () => { throw blocked(); } }));
  storage.setItem('ticker', 'AAPL');
  assert.equal(storage.getItem('ticker'), 'AAPL');
  storage.removeItem('ticker');
  assert.equal(storage.getItem('ticker'), null);
});

test('actual pages and hooks initialize when the browser storage getter is blocked', () => {
  withBrowserStorage(() => { throw blocked(); }, () => {
    assert.match(app.renderRunPage(), /Ready\. Run a ticker/);
    assert.match(app.renderHistoryPage(), /No runs yet/);
    assert.deepEqual(app.readSettings(), { enableExplain: false });
    assert.deepEqual(app.readHistory(), []);
  });
});

test('the actual Run page renders the latest response after a quota failure', () => {
  const old = { ...run, recommendation: { class: 'OLD_RESULT', confidence: 0.1 } };
  const disk = memoryStorage({ midas_dash_last_run_v1: JSON.stringify(old) });
  withBrowserStorage(() => ({ ...disk, setItem: () => { throw full(); } }), () => {
    assert.doesNotThrow(() => app.browserStorage.setJson('midas_dash_last_run_v1', run));
    const html = app.renderRunPage();
    assert.match(html, /DEBIT_CALL/);
    assert.match(html, /Successful response retained despite failed persistence/);
    assert.doesNotMatch(html, /OLD_RESULT/);
  });
});

test('history and settings survive route remounts with storage blocked', () => {
  withBrowserStorage(() => { throw blocked(); }, () => {
    app.browserStorage.setJson('midas_dash_settings_v1', { enableExplain: true });
    const item = { id: 'one', ts: run.ts_gateway, ticker: run.ticker, recommendationClass: 'DEBIT_CALL', confidence: 0.83, snapshot: run };
    app.browserStorage.setJson('midas_dash_history_v1', [item]);
    assert.deepEqual(app.readSettings(), { enableExplain: true });
    assert.deepEqual(app.readHistory(), [item]);
    assert.match(app.renderHistoryPage(), /DEBIT_CALL/);
    app.browserStorage.setJson('midas_dash_history_v1', []);
    assert.deepEqual(app.readHistory(), []);
  });
});

test('cleared snapshots stay cleared when browser removal is blocked', () => {
  const disk = memoryStorage({ midas_dash_last_run_v1: JSON.stringify(run) });
  withBrowserStorage(() => ({ ...disk, removeItem: () => { throw blocked(); } }), () => {
    app.browserStorage.removeItem('midas_dash_last_run_v1');
    assert.match(app.renderRunPage(), /Ready\. Run a ticker/);
    assert.equal(disk.getItem('midas_dash_last_run_v1'), JSON.stringify(run));
  });
});

test('malformed saved JSON falls back to empty history, default settings and no result', () => {
  const disk = memoryStorage({ midas_dash_last_run_v1: '{', midas_dash_history_v1: '{', midas_dash_settings_v1: '{' });
  withBrowserStorage(() => disk, () => {
    assert.deepEqual(app.readHistory(), []);
    assert.deepEqual(app.readSettings(), { enableExplain: false });
    assert.match(app.renderRunPage(), /Ready\. Run a ticker/);
  });
});

test('valid JSON with invalid required snapshot fields cannot crash the Run page', () => {
  const invalid = [
    null, {}, [], 42, 'not a snapshot',
    { ...run, ticker: {} },
    { ...run, features: undefined },
    { ...run, features: null },
    { ...run, features: [] },
    { ...run, recommendation: null },
    { ...run, recommendation: { class: {}, confidence: 0.5 } },
    { ...run, recommendation: { class: 'DEBIT_CALL', confidence: '0.5' } },
    { ...run, recommendation: { class: 'DEBIT_CALL', confidence: null } },
  ];
  for (const value of invalid) {
    withBrowserStorage(() => memoryStorage({ midas_dash_last_run_v1: JSON.stringify(value) }), () => {
      assert.match(app.renderRunPage(), /Ready\. Run a ticker/, JSON.stringify(value));
    });
  }
});

test('history rejects broken snapshots and unsafe display metadata without discarding valid entries', () => {
  const item = {
    id: 'valid', ts: run.ts_gateway, ticker: run.ticker,
    recommendationClass: 'DEBIT_CALL', confidence: 0.83,
    oneLiner: 'Valid retained history.', snapshot: run,
  };
  const invalid = [
    null, 42, 'not an item',
    { ...item, id: 'bad-snapshot', snapshot: {} },
    { ...item, id: {}, snapshot: run },
    { ...item, id: 'bad-timestamp', ts: {} },
    { ...item, id: 'bad-ticker', ticker: {} },
    { ...item, id: 'bad-class', recommendationClass: {} },
    { ...item, id: 'bad-confidence', confidence: '0.83' },
    { ...item, id: 'bad-summary', oneLiner: {} },
    { ...item, id: 'bad-refs', refsNumbers: {} },
    { ...item, id: 'bad-ref-entry', refsNumbers: [null] },
    { ...item, id: 'bad-ref-number', refsNumbers: [{ n: '1', url: 'https://example.invalid/' }] },
    { ...item, id: 'bad-ref-url', refsNumbers: [{ n: 1, url: {} }] },
    { ...item, id: 'bad-title', headlineTitle: {} },
    { ...item, id: 'bad-url', headlineUrl: {} },
  ];
  const saved = JSON.stringify([...invalid, item]);
  const disk = memoryStorage({ midas_dash_history_v1: saved });
  withBrowserStorage(() => disk, () => {
    assert.deepEqual(app.readHistory(), [item]);
    assert.match(app.renderHistoryPage(), /Valid retained history/);
    assert.equal(disk.getItem('midas_dash_history_v1'), saved);
  });
});

test('valid saved snapshots retain zero values, optional metadata and future fields', () => {
  const snapshot = { ...run, recommendation: { class: 'NO_TRADE', confidence: 0 }, future_field: { retained: true } };
  const item = {
    id: 'valid-zero', ts: run.ts_gateway, ticker: run.ticker,
    recommendationClass: 'NO_TRADE', confidence: 0, snapshot,
    headlineTitle: null, headlineUrl: null, oneLiner: null,
    refsNumbers: [{ n: 1, url: 'https://example.invalid/synthetic-reference' }],
  };
  const saved = {
    midas_dash_last_run_v1: JSON.stringify(snapshot),
    midas_dash_history_v1: JSON.stringify([item]),
  };
  const disk = memoryStorage(saved);
  withBrowserStorage(() => disk, () => {
    const html = app.renderRunPage();
    assert.match(html, /NO_TRADE/);
    assert.match(html, /0\.00%/);
    assert.match(html, /future_field/);
    assert.deepEqual(app.readHistory(), [item]);
    assert.match(app.renderHistoryPage(), /NO_TRADE/);
    assert.deepEqual(Object.fromEntries(disk.values), saved);
  });
});

function assertRejectedSavedSnapshot(snapshot) {
  const item = {
    id: 'invalid-optional', ts: run.ts_gateway, ticker: run.ticker,
    recommendationClass: 'DEBIT_CALL', confidence: 0.83, snapshot,
  };
  const saved = {
    midas_dash_last_run_v1: JSON.stringify(snapshot),
    midas_dash_history_v1: JSON.stringify([item]),
    midas_dash_settings_v1: JSON.stringify({ enableExplain: true }),
  };
  const disk = memoryStorage(saved);
  withBrowserStorage(() => disk, () => {
    assert.match(app.renderRunPage(), /Ready\. Run a ticker/, JSON.stringify(snapshot));
    assert.deepEqual(app.readHistory(), []);
    assert.match(app.renderHistoryPage(), /No runs yet/);
    assert.deepEqual(Object.fromEntries(disk.values), saved, 'validation must not rewrite saved data');
  });
}

test('saved summary and headline collections reject malformed optional values', () => {
  for (const patch of [
    { one_liner: { text: {} } },
    { one_liner: { refs_numbers: 'invalid' } },
    { one_liner: { refs_numbers: [null] } },
    { one_liner: { refs_numbers: [{ n: 1 }] } },
    { refs: {} },
    { refs: [{ title: {} }] },
    { top_headline: { title: {}, url: 'https://example.invalid/news' } },
  ]) assertRejectedSavedSnapshot({ ...run, ...patch });
});

test('saved explanations reject malformed importance arrays and displayed metadata', () => {
  for (const explain of [
    { top_importances: [null] },
    { top_importances: 'invalid' },
    { top_importances: [{ feature: {}, importance: 0.5 }] },
    { top_importances: [{ feature: 'sent_mean' }] },
    { error: {} }, { version: {} },
  ]) assertRejectedSavedSnapshot({ ...run, explain });
});

test('saved trade plans reject malformed nested text and contract lists', () => {
  for (const trade_plan of [
    { watchouts: 'invalid' },
    { watchouts: [{}] },
    { watch_trigger: { examples: [null] } },
    { option_chain_plan: { available: true, candidates: [null] } },
    { option_chain_plan: { available: true, candidates: 'invalid' } },
    { option_chain_plan: { available: true, candidates: [{ strike: {} }] } },
    { entry_plan: { plain_english: {} } },
    { exit_rules: { risk_exit: {} } },
  ]) assertRejectedSavedSnapshot({ ...run, trade_plan });
});

test('saved quote and sentiment metadata cannot reach React as objects', () => {
  for (const patch of [
    { quote: { quality: {} } },
    { sentiment: { warning: {} } },
    { features_note: {} },
  ]) assertRejectedSavedSnapshot({ ...run, ...patch });
});

const detailedRun = {
  ...run,
  company_name: 'Synthetic Company',
  recommendation: { ...run.recommendation, version: 'synthetic-model' },
  one_liner: { text: 'Synthetic detailed snapshot.', refs_numbers: [{ n: 1, url: 'https://example.invalid/ref' }] },
  quote: { last: 0, bid: 0, ask: 0, quality: 'unknown', spread_quality: 'unknown', last_source: 'synthetic', ts: run.ts_gateway },
  top_headline: { title: 'Synthetic headline', publisher: 'Fixture', ts: run.ts_gateway, url: 'https://example.invalid/news' },
  refs: [{ title: 'Synthetic reference', publisher: 'Fixture', url: 'https://example.invalid/ref' }],
  refs_sources: ['Fixture'],
  sentiment: { engine: 'synthetic', warning: 'No live data', confidence: 0, model_version: 'fixture' },
  ts_ctx: run.ts_gateway, cache_age_seconds: 0, features_note: 'Offline fixture only.',
  explain: {
    version: 'synthetic-model',
    prediction: { class: 'DEBIT_CALL', confidence: 0, version: 'synthetic-model' },
    inputs: { sent_mean: 0, future_input: { nested: true } },
    top_importances: [{ feature: 'sent_mean', importance: 0 }], error: '',
  },
  trade_plan: {
    ticker: 'AAPL', strategy_family: 'DEBIT_CALL', confidence_bucket: 'low',
    instrument: 'options', instrument_label: 'Synthetic plan', summary: 'Not a trade recommendation.',
    entry_plan: { plain_english: 'Synthetic entry.', timing_note: 'Fixture timing.' },
    option_template: { dte_target: '14-30', dte_label: 'Synthetic expiration', strike_style: 'ATM', strike_label: 'Synthetic strike' },
    watch_trigger: { plain_english: 'Synthetic trigger.', examples: ['Synthetic example.'] },
    range_view: { lower_bound: 0, upper_bound: 1, plain_english: 'Synthetic range.', derived_from: 'fixture' },
    target_zone: { lower_bound: 0, upper_bound: 1, plain_english: 'Synthetic zone.', derived_from: 'fixture' },
    upside_cap: { upper_bound: 1, plain_english: 'Synthetic cap.', derived_from: 'fixture' },
    hold_plan: { window: 'Synthetic window', plain_english: 'Synthetic hold.' },
    exit_rules: { take_profit: 'Synthetic target.', risk_exit: 'Synthetic risk.', time_exit: 'Synthetic time.' },
    watchouts: ['Synthetic watchout.'], education: { terms: { DTE: 'Days to expiration' } },
    option_chain_plan: {
      provider: 'synthetic', available: true, reason: '', expirations: ['2026-01-30'], selected_expiration: '2026-01-30',
      candidates: [{
        contract_symbol: 'SYNTHETIC', side: 'call', expiration: '2026-01-30', dte: 0,
        strike: 0, last_price: 0, bid: 0, ask: 0, volume: 0, open_interest: 0,
        implied_volatility: 0, in_the_money: false, moneyness_label: 'ATM', role: 'long',
      }],
    },
  },
};

function assertRestoredSavedSnapshot(snapshot) {
  const valid = {
    id: 'valid-optional', ts: run.ts_gateway, ticker: run.ticker,
    recommendationClass: snapshot.recommendation.class,
    confidence: snapshot.recommendation.confidence, snapshot,
  };
  const invalid = { ...valid, id: 'broken-optional', snapshot: { ...run, refs: {} } };
  const saved = {
    midas_dash_last_run_v1: JSON.stringify(snapshot),
    midas_dash_history_v1: JSON.stringify([invalid, valid]),
    midas_dash_settings_v1: JSON.stringify({ enableExplain: true }),
  };
  const disk = memoryStorage(saved);
  withBrowserStorage(() => disk, () => {
    const html = app.renderRunPage();
    assert.match(html, /DEBIT_CALL/);
    assert.doesNotMatch(html, /Ready\. Run a ticker/);
    assert.deepEqual(app.readHistory(), [valid]);
    assert.match(app.renderHistoryPage(), /DEBIT_CALL/);
    assert.deepEqual(Object.fromEntries(disk.values), saved);
  });
}

test('complete optional snapshots preserve known fields, zeroes, false and unknown future data', () => {
  const snapshot = structuredClone(detailedRun);
  snapshot.future_field = { retained: true };
  snapshot.trade_plan.future_plan_field = ['retained'];
  snapshot.trade_plan.option_chain_plan.candidates[0].future_candidate_field = {};
  snapshot.explain.future_explanation_field = { retained: true };
  snapshot.refs.push(null);
  assertRestoredSavedSnapshot(snapshot);
});

test('nullable and absent optional fields remain compatible with saved snapshots', () => {
  const nullable = structuredClone(detailedRun);
  for (const key of Object.keys(nullable)) {
    if (!['ticker', 'features', 'recommendation'].includes(key)) nullable[key] = null;
  }
  nullable.recommendation.version = null;
  assertRestoredSavedSnapshot(nullable);

  const nested = structuredClone(detailedRun);
  for (const key of ['one_liner', 'quote', 'top_headline', 'sentiment', 'explain']) {
    for (const field of Object.keys(nested[key])) nested[key][field] = null;
  }
  for (const [key, value] of Object.entries(nested.trade_plan)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const field of Object.keys(value)) value[field] = null;
    } else nested.trade_plan[key] = null;
  }
  nested.refs = [null, {}];
  assertRestoredSavedSnapshot(nested);
  assertRestoredSavedSnapshot({ ticker: 'AAPL', features: {}, recommendation: run.recommendation });

  const partial = { ...run, trade_plan: { option_chain_plan: { available: true, candidates: [{ contract_symbol: 'EMPTY', strike: null, in_the_money: null }] } } };
  assertRestoredSavedSnapshot(partial);
});

function malformedOptionalVariants(value, path = []) {
  const variants = [];
  for (const [key, field] of Object.entries(value)) {
    const fieldPath = [...path, key];
    const name = fieldPath.join('.');
    // Arbitrary feature/input dictionaries deliberately remain outside this guard.
    if (['ticker', 'features', 'explain.inputs'].includes(name) ||
        name === 'recommendation.class' || name === 'recommendation.confidence') continue;
    variants.push({ path: fieldPath, invalid: Array.isArray(field) ? {} : typeof field === 'object' ? [] : {} });
    if (Array.isArray(field)) {
      if (field.length) {
        variants.push({ path: [...fieldPath, '0'], invalid: {} });
        if (field[0] && typeof field[0] === 'object') {
          variants.pop(); // An empty object can be a valid partial headline/candidate.
          variants.push({ path: [...fieldPath, '0'], invalid: 42 });
          variants.push(...malformedOptionalVariants(field[0], [...fieldPath, '0']));
        }
      }
    } else if (field && typeof field === 'object') {
      variants.push(...malformedOptionalVariants(field, fieldPath));
    }
  }
  return variants;
}

test('each modeled optional field rejects incompatible JSON shapes without mutating storage', () => {
  const variants = malformedOptionalVariants(detailedRun);
  assert.ok(variants.length > 100, 'keep broad coverage of the modeled optional fields');
  for (const { path, invalid } of variants) {
    const snapshot = structuredClone(detailedRun);
    const target = path.slice(0, -1).reduce((parent, key) => parent[key], snapshot);
    target[path.at(-1)] = invalid;
    assertRejectedSavedSnapshot(snapshot);
  }
});

test('valid JSON number overflow in optional numeric fields is not restored', () => {
  for (const patch of [
    { cache_age_seconds: 'OVERFLOW' },
    { quote: { last: 'OVERFLOW' } },
    { explain: { top_importances: [{ feature: 'sent_mean', importance: 'OVERFLOW' }] } },
    { trade_plan: { option_chain_plan: { candidates: [{ strike: 'OVERFLOW' }] } } },
  ]) {
    const raw = JSON.stringify({ ...run, ...patch }).replace('"OVERFLOW"', '1e400');
    const disk = memoryStorage({ midas_dash_last_run_v1: raw });
    withBrowserStorage(() => disk, () => {
      assert.match(app.renderRunPage(), /Ready\. Run a ticker/);
      assert.equal(disk.getItem('midas_dash_last_run_v1'), raw);
    });
  }
});

test('saved Explain flags require a boolean and never rewrite invalid stored preferences', () => {
  for (const flag of ['false', 'true', 1, -1, {}, [], [false], null, false]) {
    const raw = JSON.stringify({ enableExplain: flag, futurePreference: 'preserved' });
    const disk = memoryStorage({ midas_dash_settings_v1: raw });
    withBrowserStorage(() => disk, () => {
      assert.deepEqual(app.readSettings(), { enableExplain: false }, JSON.stringify(flag));
      assert.equal(disk.values.get('midas_dash_settings_v1'), raw);
    });
  }
});

test('saved settings accept true and default malformed containers without rewriting them', () => {
  for (const value of [null, [], true, 'true', 1, {}, { enableExplain: true, futurePreference: 17 }]) {
    const raw = JSON.stringify(value);
    const disk = memoryStorage({ midas_dash_settings_v1: raw });
    withBrowserStorage(() => disk, () => {
      assert.deepEqual(app.readSettings(), { enableExplain: value?.enableExplain === true });
      assert.equal(disk.values.get('midas_dash_settings_v1'), raw);
    });
  }
});

test('accepted nested Explain inputs render without invoking object coercion', () => {
  const inputs = JSON.parse('{"future_input":{"toString":null,"valueOf":null,"nested":[0,false,null]},"future_array":[{"toString":"provider data"}]}');
  const snapshot = { ...run, explain: { inputs } };
  const disk = memoryStorage({
    midas_dash_last_run_v1: JSON.stringify(snapshot),
    midas_dash_settings_v1: JSON.stringify({ enableExplain: true }),
  });
  withBrowserStorage(() => disk, () => {
    const html = app.renderRunPage();
    assert.match(html, /Inputs used for prediction/);
    assert.match(html, /future_input/);
    assert.match(html, /provider data/);
    assert.match(html, /nested/);
    assert.equal(disk.getItem('midas_dash_last_run_v1'), JSON.stringify(snapshot));
  });
});

test('Explain input display preserves scalars and renders accepted JSON structures as text', () => {
  const cases = [
    [0, '0'], [false, 'false'], [null, 'null'], ['', ''], ['plain text', 'plain text'],
    [{ nested: [0, false, null] }, '{"nested":[0,false,null]}'],
    [[{ toString: 'provider data' }], '[{"toString":"provider data"}]'],
    [{ toJSON: 'ordinary provider field' }, '{"toJSON":"ordinary provider field"}'],
    ['<script>synthetic</script>', '<script>synthetic</script>'],
  ];
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
  for (const [value, expected] of cases) {
    const snapshot = { ...run, explain: { inputs: { future_input: value } } };
    const disk = memoryStorage({
      midas_dash_last_run_v1: JSON.stringify(snapshot),
      midas_dash_settings_v1: JSON.stringify({ enableExplain: true }),
    });
    withBrowserStorage(() => disk, () => {
      const html = app.renderRunPage();
      assert.ok(html.includes(`<span class="min-w-0 break-all text-slate-200">${escape(expected)}</span>`), JSON.stringify(value));
      assert.equal(disk.getItem('midas_dash_last_run_v1'), JSON.stringify(snapshot));
    });
  }
});
