import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('../platform_app/', import.meta.url));
const requireFrontend = createRequire(join(frontend, 'package.json'));
const esbuild = requireFrontend('esbuild');
const tempRoot = resolve(tmpdir());
const fixtureDir = mkdtempSync(join(tempRoot, 'midas-run-test-'));
const fixtureFile = join(fixtureDir, 'fixture.cjs');
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Run lifecycle tests must not make network requests'); };

after(async () => {
  globalThis.fetch = originalFetch;
  await esbuild.stop();
  if (dirname(resolve(fixtureDir)) !== tempRoot || !basename(fixtureDir).startsWith('midas-run-test-')) {
    throw new Error('Refusing cleanup outside the run-test temporary directory');
  }
  rmSync(fixtureDir, { recursive: true, force: true });
});

// Exercise the actual page handlers, storage adapter and fetch helper with controlled
// hook state/effect cleanup. This is not a DOM renderer or mounted-browser acceptance.
await esbuild.build({
  stdin: {
    resolveDir: frontend,
    sourcefile: 'run-lifecycle-test-entry.tsx',
    contents: `
      export { RunPage } from './src/pages/RunPage';
      export { HistoryPage } from './src/pages/HistoryPage';
      export { LoadingOverlay } from './src/components/LoadingOverlay';
      export { browserStorage, createBrowserStorage } from './src/lib/browserStorage';
      export { useRunHistory, toHistoryItem, mergeHistory } from './src/hooks/useRunHistory';
      export { useSettings } from './src/hooks/useSettings';
      export { setHarness } from 'lifecycle-test-hooks';
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
  plugins: [{
    name: 'controlled-hooks',
    setup(build) {
      build.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: 'router', namespace: 'history-test' }));
      build.onLoad({ filter: /.*/, namespace: 'history-test' }, () => ({ contents: `
        export function useNavigate() { return path => globalThis.historyTestNavigate(path); }
      ` }));
      build.onResolve({ filter: /^(react|lifecycle-test-hooks)$/ }, args => {
        if (args.path === 'lifecycle-test-hooks' || args.importer.startsWith(join(frontend, 'src'))) {
          return { path: 'hooks', namespace: 'lifecycle-test' };
        }
      });
      build.onLoad({ filter: /.*/, namespace: 'lifecycle-test' }, () => ({ contents: `
        let harness;
        export function setHarness(next) { harness = next; }
        export function useState(initial) { return harness.useState(initial); }
        export function useRef(initial) { return harness.useRef(initial); }
        export function useEffect(effect, deps) { return harness.useEffect(effect, deps); }
        export function useMemo(factory, deps) { return harness.useMemo(factory, deps); }
        export function useId() { return 'offline-test-id'; }
      ` }));
    },
  }],
});
const app = requireFrontend(fixtureFile);

class HookHarness {
  slots = [];
  cursor = 0;
  pendingEffects = [];
  mounted = true;

  useState(initial) {
    const index = this.cursor++;
    if (!(index in this.slots)) {
      this.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
    }
    return [this.slots[index].value, next => {
      if (!this.mounted) return;
      const slot = this.slots[index];
      slot.value = typeof next === 'function' ? next(slot.value) : next;
    }];
  }

  useRef(initial) {
    const index = this.cursor++;
    this.slots[index] ??= { current: initial };
    return this.slots[index];
  }

  useMemo(factory, deps) {
    const index = this.cursor++;
    const old = this.slots[index];
    if (!old || !sameDeps(old.deps, deps)) this.slots[index] = { value: factory(), deps };
    return this.slots[index].value;
  }

  useEffect(effect, deps) {
    const index = this.cursor++;
    const old = this.slots[index];
    if (!old || !sameDeps(old.deps, deps)) {
      this.pendingEffects.push(() => {
        old?.cleanup?.();
        this.slots[index] = { effect, deps, cleanup: effect() };
      });
    }
  }

  render(component = app.RunPage) {
    assert.equal(this.mounted, true);
    this.cursor = 0;
    app.setHarness(this);
    const tree = component();
    for (const effect of this.pendingEffects.splice(0)) effect();
    return tree;
  }

  replayEffects() {
    // Model development setup/cleanup/setup without claiming React scheduling coverage.
    for (const slot of this.slots) if (slot.effect) slot.cleanup?.();
    for (const slot of this.slots) if (slot.effect) slot.cleanup = slot.effect();
  }

  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    for (const slot of this.slots) slot.cleanup?.();
  }
}

function sameDeps(left, right) {
  return left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function find(tree, predicate) {
  if (tree == null || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) {
    for (const child of tree) { const match = find(child, predicate); if (match) return match; }
    return undefined;
  }
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}

const lastRunKey = 'midas_dash_last_run_v1';
const historyKey = 'midas_dash_history_v1';
const tickerKey = 'midas_dash_last_ticker_v1';
const settingsKey = 'midas_dash_settings_v1';
const snapshot = (ticker = 'AAPL') => ({ ticker, features: {}, recommendation: { class: 'NO_ACTION', confidence: 0.8 }, ts_gateway: '2026-01-01T12:00:00Z' });
const runButton = tree => find(tree, node => node.type === 'button' && ['Run', 'Running...'].includes(node.props.children));
const tickerInput = tree => find(tree, node => node.type === 'input');
const overlay = tree => find(tree, node => node.type === app.LoadingOverlay);

async function withPage(check, initial = {}) {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const blockedFetch = globalThis.fetch;
  const values = new Map(Object.entries(initial));
  const writes = [];
  const requests = [];
  const harnesses = [];
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes.push(['set', key, value]); values.set(key, value); },
    removeItem: key => { writes.push(['remove', key]); values.delete(key); },
  };
  const originalSetItem = storage.setItem;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setInterval: () => 1, clearInterval: () => {} } });
  // Reset the adapter's tab-local cache through successful reads of isolated data.
  for (const key of [lastRunKey, historyKey, tickerKey, settingsKey]) app.browserStorage.getItem(key);
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
    requests.push({ url, options, resolve, reject });
  });
  const mount = () => { const page = new HookHarness(); harnesses.push(page); return page; };
  try {
    await check({ page: mount(), mount, values, writes, requests, storage });
  } finally {
    for (const page of harnesses) page.unmount();
    storage.setItem = originalSetItem;
    for (const key of [lastRunKey, historyKey, tickerKey, settingsKey]) app.browserStorage.removeItem(key);
    globalThis.fetch = blockedFetch;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else delete globalThis.localStorage;
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else delete globalThis.window;
  }
}

function succeed(request, data = snapshot()) {
  // Deliberately ignore abort to prove stale callbacks cannot commit even if the
  // response body or a transport finishes after cancellation.
  request.resolve({ ok: true, json: async () => data });
}

test('repeated Enter while a run is pending does not start duplicate requests', async () => {
  await withPage(async ({ page, requests }) => {
    const tree = page.render();
    const pending = runButton(tree).props.onClick();
    tickerInput(tree).props.onKeyDown({ key: 'Enter' });
    tickerInput(tree).props.onKeyDown({ key: 'Enter' });
    assert.equal(requests.length, 1);
    succeed(requests[0]);
    await pending;
    assert.equal(runButton(page.render()).props.disabled, false);
  });
});

test('late success after navigation cannot replace a newly selected saved snapshot', async () => {
  await withPage(async ({ page, values, writes, requests }) => {
    const pending = runButton(page.render()).props.onClick();
    page.unmount();
    const selected = JSON.stringify(snapshot('MSFT'));
    values.set(lastRunKey, selected);
    const before = writes.length;
    succeed(requests[0]);
    await pending;
    assert.equal(values.get(lastRunKey), selected);
    assert.equal(writes.length, before);
  });
});

test('late failure after navigation cannot erase a newly selected saved snapshot', async () => {
  await withPage(async ({ page, values, writes, requests }) => {
    const pending = runButton(page.render()).props.onClick();
    page.unmount();
    const selected = JSON.stringify(snapshot('MSFT'));
    values.set(lastRunKey, selected);
    const before = writes.length;
    requests[0].reject(new Error('Old request failed'));
    await pending;
    assert.equal(values.get(lastRunKey), selected);
    assert.equal(writes.length, before);
  });
});

test('the active request receives a signal and navigation aborts it', async () => {
  await withPage(async ({ page, requests }) => {
    const pending = runButton(page.render()).props.onClick();
    const signal = requests[0].options?.signal;
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false);
    page.unmount();
    assert.equal(signal.aborted, true);
    requests[0].reject(new DOMException('Aborted', 'AbortError'));
    await pending;
  });
});

test('cancel keeps the previous result and history, removes loading, and tolerates an abort rejection', async () => {
  const saved = snapshot('MSFT');
  const previous = JSON.stringify(saved);
  const previousHistory = JSON.stringify([{
    id: 'saved-msft', ts: saved.ts_gateway, ticker: saved.ticker,
    recommendationClass: saved.recommendation.class, confidence: saved.recommendation.confidence,
    snapshot: saved,
  }]);
  await withPage(async ({ page, requests, values, writes }) => {
    const pending = runButton(page.render()).props.onClick();
    const loading = page.render();
    assert.equal(overlay(loading).props.show, true);
    assert.equal(tickerInput(loading).props.disabled, true);
    const before = writes.length;
    overlay(loading).props.onCancel();
    overlay(loading).props.onCancel();
    assert.equal(requests[0].options.signal.aborted, true);
    const ready = page.render();
    assert.equal(overlay(ready).props.show, false);
    assert.equal(runButton(ready).props.disabled, false);
    assert.equal(tickerInput(ready).props.disabled, false);
    assert.equal(values.get(lastRunKey), previous);
    assert.equal(values.get(historyKey), previousHistory);
    requests[0].reject(new DOMException('Aborted', 'AbortError'));
    await pending;
    page.render();
    assert.equal(values.get(lastRunKey), previous);
    assert.equal(values.get(historyKey), previousHistory);
    assert.equal(writes.length, before);
  }, { [lastRunKey]: previous, [historyKey]: previousHistory });
});

for (const outcome of ['success', 'failure']) {
  for (const finishNewFirst of [false, true]) {
    test(`cancelled ${outcome} cannot alter a ${finishNewFirst ? 'completed' : 'pending'} replacement run`, async () => {
      await withPage(async ({ page, requests, values, writes }) => {
        const oldPending = runButton(page.render()).props.onClick();
        overlay(page.render()).props.onCancel();
        tickerInput(page.render()).props.onChange({ target: { value: 'MSFT' } });
        const newPending = runButton(page.render()).props.onClick();
        assert.equal(requests.length, 2);
        const current = snapshot('MSFT');
        if (finishNewFirst) {
          succeed(requests[1], current);
          await newPending;
          page.render();
        }
        const before = writes.length;
        if (outcome === 'success') succeed(requests[0], snapshot('AAPL'));
        else requests[0].reject(new Error('Abandoned failure'));
        await oldPending;
        const currentTree = page.render();
        assert.equal(writes.length, before);
        assert.equal(overlay(currentTree).props.show, !finishNewFirst);
        assert.equal(runButton(currentTree).props.disabled, !finishNewFirst);
        assert.equal(requests[1].options.signal.aborted, false);
        if (!finishNewFirst) {
          succeed(requests[1], current);
          await newPending;
          page.render();
        }
        assert.deepEqual(JSON.parse(values.get(lastRunKey)), current);
        const history = JSON.parse(values.get(historyKey));
        assert.equal(history.length, 1);
        assert.deepEqual(history[0].snapshot, current);
      });
    });
  }
}

test('cancellation while a successful response body is still parsing ignores the late body', async () => {
  await withPage(async ({ page, requests, values, writes }) => {
    const pending = runButton(page.render()).props.onClick();
    let finishBody;
    let startedBody;
    const bodyStarted = new Promise(resolve => { startedBody = resolve; });
    requests[0].resolve({ ok: true, json: () => {
      startedBody();
      return new Promise(resolve => { finishBody = resolve; });
    } });
    await bodyStarted;
    overlay(page.render()).props.onCancel();
    const before = writes.length;
    finishBody(snapshot());
    await pending;
    assert.equal(overlay(page.render()).props.show, false);
    assert.equal(values.get(lastRunKey), undefined);
    assert.equal(values.get(historyKey), undefined);
    assert.equal(writes.length, before);
  });
});

test('cancellation while an error response body is still parsing ignores the late error', async () => {
  const previous = JSON.stringify(snapshot('MSFT'));
  await withPage(async ({ page, requests, values, writes }) => {
    const pending = runButton(page.render()).props.onClick();
    let finishBody;
    let startedBody;
    const bodyStarted = new Promise(resolve => { startedBody = resolve; });
    requests[0].resolve({ ok: false, status: 503, json: () => {
      startedBody();
      return new Promise(resolve => { finishBody = resolve; });
    } });
    await bodyStarted;
    overlay(page.render()).props.onCancel();
    const before = writes.length;
    finishBody({ detail: 'Delayed failure' });
    await pending;
    assert.equal(overlay(page.render()).props.show, false);
    assert.equal(values.get(lastRunKey), previous);
    assert.equal(writes.length, before);
  }, { [lastRunKey]: previous });
});

for (const jsonError of [false, true]) {
  test(`a ${jsonError ? 'non-JSON' : 'JSON'} HTTP error releases the request and a retry succeeds`, async () => {
    await withPage(async ({ page, requests, values }) => {
      const pending = runButton(page.render()).props.onClick();
      requests[0].resolve({ ok: false, status: 503, json: async () => {
        if (jsonError) throw new SyntaxError('Not JSON');
        return { detail: 'Mock gateway unavailable' };
      } });
      await pending;
      const failed = page.render();
      const error = jsonError ? 'Request failed with HTTP 503' : 'Mock gateway unavailable';
      assert.ok(find(failed, node => node.type === 'div' && node.props.children === error));
      assert.equal(overlay(failed).props.show, false);
      assert.equal(runButton(failed).props.disabled, false);
      assert.equal(values.get(lastRunKey), undefined);
      const retry = runButton(failed).props.onClick();
      const retryTree = page.render();
      assert.equal(find(retryTree, node => node.props.children === error), undefined);
      succeed(requests[1]);
      await retry;
      assert.equal(overlay(page.render()).props.show, false);
      assert.deepEqual(JSON.parse(values.get(lastRunKey)), snapshot());
      assert.equal(JSON.parse(values.get(historyKey)).length, 1);
    }, { [lastRunKey]: JSON.stringify(snapshot('MSFT')) });
  });
}

test('invalid ticker sends no request and a corrected ticker retains Explain and normalization', async () => {
  await withPage(async ({ page, requests, values }) => {
    tickerInput(page.render()).props.onChange({ target: { value: 'bad ticker!' } });
    await runButton(page.render()).props.onClick();
    const invalid = page.render();
    assert.equal(requests.length, 0);
    assert.equal(overlay(invalid).props.show, false);
    assert.ok(find(invalid, node => node.props.children === 'Ticker should look like AAPL, MSFT, BRK.B, etc.'));
    tickerInput(invalid).props.onChange({ target: { value: ' brk.b ' } });
    const pending = runButton(page.render()).props.onClick();
    assert.equal(requests[0].url, '/api/run?ticker=BRK.B&explain=1');
    assert.equal(values.get(tickerKey), 'BRK.B');
    succeed(requests[0], snapshot('BRK.B'));
    await pending;
    page.render();
    assert.equal(JSON.parse(values.get(lastRunKey)).ticker, 'BRK.B');
  }, { [settingsKey]: JSON.stringify({ enableExplain: true }) });
});

test('a fresh page remains authoritative when an older page request finishes', async () => {
  await withPage(async ({ page, mount, requests, values }) => {
    const oldPending = runButton(page.render()).props.onClick();
    page.unmount();
    values.set(tickerKey, 'MSFT');
    const next = mount();
    const currentPending = runButton(next.render()).props.onClick();
    succeed(requests[1], snapshot('MSFT'));
    await currentPending;
    next.render();
    requests[0].reject(new Error('Old page failure'));
    await oldPending;
    assert.equal(overlay(next.render()).props.show, false);
    assert.equal(JSON.parse(values.get(lastRunKey)).ticker, 'MSFT');
    assert.equal(JSON.parse(values.get(historyKey)).length, 1);
  });
});

test('effect cleanup/setup replay before a run leaves the page usable and later cleanup aborts it', async () => {
  await withPage(async ({ page, requests }) => {
    page.render();
    page.replayEffects();
    const pending = runButton(page.render()).props.onClick();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.signal.aborted, false);
    page.unmount();
    assert.equal(requests[0].options.signal.aborted, true);
    succeed(requests[0]);
    await pending;
  });
});

test('the loading overlay exposes its supplied cancel callback and remains compatible without it', async () => {
  await withPage(async ({ mount }) => {
    assert.equal(app.LoadingOverlay({ show: false, onCancel: () => {} }), null);
    let cancellations = 0;
    const cancel = () => { cancellations++; };
    const content = app.LoadingOverlay({ show: true, onCancel: cancel });
    const tree = mount().render(() => content.type(content.props));
    const button = find(tree, node => node.type === 'button' && node.props.children === 'Cancel run');
    assert.equal(button.props.type, 'button');
    button.props.onClick();
    assert.equal(cancellations, 1);
    const noCancel = app.LoadingOverlay({ show: true });
    const plain = mount().render(() => noCancel.type(noCancel.props));
    assert.equal(find(plain, node => node.type === 'button'), undefined);
  });
});

const invalidResponseMessage = 'The server returned an invalid run response. Please try again.';

for (const blocked of [false, true]) {
  test(`opening a History snapshot synchronizes the next request ticker with ${blocked ? 'blocked' : 'working'} storage`, async () => {
    const selected = snapshot('MSFT');
    const previousHistory = JSON.stringify([{
      id: 'saved-msft', ts: selected.ts_gateway, ticker: selected.ticker,
      recommendationClass: selected.recommendation.class, confidence: selected.recommendation.confidence,
      snapshot: selected,
    }]);
    await withPage(async ({ page, mount, values, requests, storage }) => {
      const historyTree = page.render(app.HistoryPage);
      if (blocked) storage.setItem = () => { throw new Error('Quota exceeded'); };
      const routes = [];
      const oldNavigate = globalThis.historyTestNavigate;
      globalThis.historyTestNavigate = path => routes.push(path);
      try {
        find(historyTree, node => node.type === 'button' && node.props.children === 'Open snapshot').props.onClick();
      } finally {
        if (oldNavigate) globalThis.historyTestNavigate = oldNavigate;
        else delete globalThis.historyTestNavigate;
      }
      assert.deepEqual(routes, ['/']);
      page.unmount();
      const run = mount();
      const tree = run.render();
      assert.equal(tickerInput(tree).props.value, 'MSFT');
      assert.deepEqual(JSON.parse(app.browserStorage.getItem(lastRunKey)), selected);
      assert.equal(values.get(historyKey), previousHistory);
      const pending = runButton(tree).props.onClick();
      assert.equal(requests[0].url, '/api/run?ticker=MSFT');
      succeed(requests[0], selected);
      await pending;
      run.render();
      assert.equal(overlay(run.render()).props.show, false);
    }, { [tickerKey]: 'AAPL', [historyKey]: previousHistory, [lastRunKey]: JSON.stringify(snapshot()) });
  });
}

test('ordinary Run remounts preserve an edited ticker rather than resetting it to the displayed snapshot', async () => {
  await withPage(async ({ page, mount }) => {
    tickerInput(page.render()).props.onChange({ target: { value: 'BRK.B' } });
    page.unmount();
    assert.equal(tickerInput(mount().render()).props.value, 'BRK.B');
  }, { [tickerKey]: 'AAPL', [lastRunKey]: JSON.stringify(snapshot()) });
});

for (const [label, body] of [
  ['different ticker', snapshot('MSFT')],
  ['empty ticker', snapshot('')],
  ['missing recommendation', {}],
  ['null body', null],
  ['invalid confidence', { ...snapshot(), recommendation: { class: 'NO_ACTION', confidence: '0.8' } }],
  ['malformed summary', { ...snapshot(), one_liner: { text: {} } }],
  ['malformed explanation', { ...snapshot(), explain: { top_importances: [null] } }],
  ['malformed watchouts', { ...snapshot(), trade_plan: { watchouts: 'wrong' } }],
  ['malformed quote', { ...snapshot(), quote: { quality: {} } }],
  ['non-JSON success', undefined],
]) {
  test(`invalid live response (${label}) is not saved and a retry succeeds`, async () => {
    const saved = snapshot('MSFT');
    const previousHistory = JSON.stringify([{
      id: 'saved-msft', ts: saved.ts_gateway, ticker: saved.ticker,
      recommendationClass: saved.recommendation.class, confidence: saved.recommendation.confidence,
      snapshot: saved,
    }]);
    await withPage(async ({ page, requests, values, writes }) => {
      const pending = runButton(page.render()).props.onClick();
      requests[0].resolve({ ok: true, json: async () => {
        if (body === undefined) throw new SyntaxError('Unexpected token < in JSON');
        return body;
      } });
      await pending;
      const failed = page.render();
      assert.ok(find(failed, node => node.props?.children === invalidResponseMessage));
      assert.equal(overlay(failed).props.show, false);
      assert.equal(runButton(failed).props.disabled, false);
      assert.equal(values.get(lastRunKey), undefined);
      assert.equal(values.get(historyKey), previousHistory);
      assert.equal(writes.some(([action, key]) => action === 'set' && key === lastRunKey), false);
      const retry = runButton(failed).props.onClick();
      succeed(requests[1]);
      await retry;
      const recovered = page.render();
      assert.equal(find(recovered, node => node.props?.children === invalidResponseMessage), undefined);
      assert.deepEqual(JSON.parse(values.get(lastRunKey)), snapshot());
      assert.equal(JSON.parse(values.get(historyKey)).length, 2);
    }, { [lastRunKey]: JSON.stringify(saved), [historyKey]: previousHistory });
  });
}

test('live validation preserves nullable fields, zeroes, false and unknown future fields', async () => {
  await withPage(async ({ page, requests, values }) => {
    const body = {
      ...snapshot(), recommendation: { class: 'NO_ACTION', confidence: 0 },
      company_name: null, refs: [null, { title: 'Synthetic headline' }],
      quote: { last: 0, bid: null }, explain: { top_importances: [] },
      trade_plan: { option_chain_plan: { available: false, candidates: [{ in_the_money: false, strike: 0 }] } },
      future_field: { retained: true },
    };
    const pending = runButton(page.render()).props.onClick();
    succeed(requests[0], body);
    await pending;
    page.render();
    assert.deepEqual(JSON.parse(values.get(lastRunKey)), body);
    assert.deepEqual(JSON.parse(values.get(historyKey))[0].snapshot, body);
  });
});

test('a delayed invalid response cannot erase a successful replacement after cancellation', async () => {
  await withPage(async ({ page, requests, values, writes }) => {
    const oldPending = runButton(page.render()).props.onClick();
    let finishBody;
    let startedBody;
    const bodyStarted = new Promise(resolve => { startedBody = resolve; });
    requests[0].resolve({ ok: true, json: () => {
      startedBody();
      return new Promise(resolve => { finishBody = resolve; });
    } });
    await bodyStarted;
    overlay(page.render()).props.onCancel();
    tickerInput(page.render()).props.onChange({ target: { value: 'MSFT' } });
    const nextPending = runButton(page.render()).props.onClick();
    succeed(requests[1], snapshot('MSFT'));
    await nextPending;
    page.render();
    const before = writes.length;
    finishBody({ one_liner: { text: {} } });
    await oldPending;
    const tree = page.render();
    assert.equal(find(tree, node => node.props?.children === invalidResponseMessage), undefined);
    assert.equal(writes.length, before);
    assert.equal(JSON.parse(values.get(lastRunKey)).ticker, 'MSFT');
    assert.equal(JSON.parse(values.get(historyKey)).length, 1);
  });
});

for (const [requested, returned] of [[' aapl ', 'aapl'], [' brk.b ', ' BRK.B '], ['brk-b', 'BRK-B']]) {
  test('response ticker comparison preserves equivalent formatting: ' + requested, async () => {
    await withPage(async ({ page, requests, values }) => {
      tickerInput(page.render()).props.onChange({ target: { value: requested } });
      const pending = runButton(page.render()).props.onClick();
      const body = snapshot(returned);
      succeed(requests[0], body);
      await pending;
      page.render();
      assert.deepEqual(JSON.parse(values.get(lastRunKey)), body);
      assert.deepEqual(JSON.parse(values.get(historyKey))[0].snapshot, body);
    });
  });
}

test('response ticker matching does not silently equate different symbol punctuation', async () => {
  await withPage(async ({ page, requests, values, writes }) => {
    tickerInput(page.render()).props.onChange({ target: { value: 'BRK.B' } });
    const pending = runButton(page.render()).props.onClick();
    succeed(requests[0], snapshot('BRK-B'));
    await pending;
    const failed = page.render();
    assert.ok(find(failed, node => node.props?.children === invalidResponseMessage));
    assert.equal(values.get(lastRunKey), undefined);
    assert.equal(values.get(historyKey), undefined);
    assert.equal(writes.some(([action, key]) => action === 'set' && key === lastRunKey), false);
  });
});


test('history add recovers a cold failed read without overwriting saved rows', async () => {
  await withPage(async ({ page, storage, values, writes }) => {
    const old = app.toHistoryItem(snapshot('AAPL'));
    values.set(historyKey, JSON.stringify([old]));
    const read = storage.getItem;
    storage.getItem = () => { throw new Error('blocked read'); };
    const history = page.render(app.useRunHistory);
    assert.deepEqual(history.items, []);
    assert.equal(writes.length, 0);
    storage.getItem = read;
    history.add(app.toHistoryItem(snapshot('MSFT')));
    assert.deepEqual(page.render(app.useRunHistory).items.map(row => row.ticker), ['MSFT', 'AAPL']);
    assert.deepEqual(JSON.parse(values.get(historyKey)).map(row => row.ticker), ['MSFT', 'AAPL']);
  });
});


for (const writesBlocked of [false, true]) {
  test('history defers unread rows and recovers multiple adds; writes blocked=' + writesBlocked, async () => {
    await withPage(async ({ page, mount, storage, values, writes }) => {
      const old = app.toHistoryItem(snapshot('AAPL'));
      values.set(historyKey, JSON.stringify([old]));
      const read = storage.getItem;
      const write = storage.setItem;
      storage.getItem = () => { throw new Error('read blocked'); };
      if (writesBlocked) storage.setItem = () => { throw new Error('write blocked'); };
      const history = page.render(app.useRunHistory);
      history.add(app.toHistoryItem(snapshot('MSFT')));
      history.add(app.toHistoryItem(snapshot('NVDA')));
      history.add(app.toHistoryItem(snapshot('MSFT')));
      assert.deepEqual(page.render(app.useRunHistory).items.map(row => row.ticker), ['MSFT', 'NVDA']);
      assert.equal(values.get(historyKey), JSON.stringify([old]));
      assert.equal(writes.length, 0);
      storage.getItem = read;
      storage.setItem = write;
      const recovered = mount().render(app.useRunHistory);
      assert.deepEqual(recovered.items.map(row => row.ticker), ['MSFT', 'NVDA', 'AAPL']);
      assert.deepEqual(JSON.parse(values.get(historyKey)), recovered.items);
      assert.equal(writes.length, 1);
      app.browserStorage.getItem(historyKey);
      assert.equal(writes.length, 1);
    });
  });
}

for (const writesBlocked of [false, true]) {
  test('history clear supersedes unread rows and queued adds; writes blocked=' + writesBlocked, async () => {
    await withPage(async ({ page, mount, storage, values }) => {
      values.set(historyKey, JSON.stringify([app.toHistoryItem(snapshot('AAPL'))]));
      const read = storage.getItem;
      const write = storage.setItem;
      storage.getItem = () => { throw new Error('read blocked'); };
      if (writesBlocked) storage.setItem = () => { throw new Error('write blocked'); };
      const history = page.render(app.useRunHistory);
      history.add(app.toHistoryItem(snapshot('MSFT')));
      history.clear();
      storage.getItem = read;
      storage.setItem = write;
      assert.deepEqual(mount().render(app.useRunHistory).items, []);
      history.add(app.toHistoryItem(snapshot('NVDA')));
      assert.deepEqual(page.render(app.useRunHistory).items.map(row => row.ticker), ['NVDA']);
      assert.deepEqual(JSON.parse(values.get(historyKey)).map(row => row.ticker), ['NVDA']);
      history.clear();
      assert.deepEqual(mount().render(app.useRunHistory).items, []);
      assert.deepEqual(JSON.parse(values.get(historyKey)), []);
    });
  });
}

test('history merge filters invalid rows, preserves future fields, deduplicates and caps at 25', async () => {
  await withPage(async ({ page, values }) => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ ...app.toHistoryItem(snapshot('T' + index)), future: index }));
    values.set(historyKey, JSON.stringify([{}, ...rows]));
    const history = page.render(app.useRunHistory);
    history.add(rows[4]);
    const result = page.render(app.useRunHistory).items;
    assert.equal(result.length, 25);
    assert.equal(result[0].id, rows[4].id);
    assert.equal(result.filter(row => row.id === rows[4].id).length, 1);
    assert.deepEqual(result.slice(1).map(row => row.id), rows.filter(row => row.id !== rows[4].id).slice(0, 24).map(row => row.id));
    assert.equal(result[3].future, 2);
    assert.deepEqual(JSON.parse(values.get(historyKey)), result);
  });
});

test('history recovered merge survives quota failure and a subsequent add persists it', async () => {
  await withPage(async ({ page, mount, storage, values }) => {
    values.set(historyKey, JSON.stringify([app.toHistoryItem(snapshot('AAPL'))]));
    const read = storage.getItem;
    const write = storage.setItem;
    storage.getItem = () => { throw new Error('read blocked'); };
    const history = page.render(app.useRunHistory);
    history.add(app.toHistoryItem(snapshot('MSFT')));
    storage.getItem = read;
    storage.setItem = () => { throw new Error('quota'); };
    const recovered = mount().render(app.useRunHistory);
    assert.deepEqual(recovered.items.map(row => row.ticker), ['MSFT', 'AAPL']);
    assert.deepEqual(JSON.parse(values.get(historyKey)).map(row => row.ticker), ['AAPL']);
    storage.setItem = write;
    recovered.add(app.toHistoryItem(snapshot('NVDA')));
    assert.deepEqual(JSON.parse(values.get(historyKey)).map(row => row.ticker), ['NVDA', 'MSFT', 'AAPL']);
  });
});


test('history clear then add while storage is still blocked never restores pre-clear rows', async () => {
  await withPage(async ({ page, mount, storage, values }) => {
    values.set(historyKey, JSON.stringify([app.toHistoryItem(snapshot('AAPL'))]));
    const read = storage.getItem;
    const write = storage.setItem;
    storage.getItem = () => { throw new Error('read blocked'); };
    storage.setItem = () => { throw new Error('write blocked'); };
    const history = page.render(app.useRunHistory);
    history.add(app.toHistoryItem(snapshot('MSFT')));
    history.clear();
    history.add(app.toHistoryItem(snapshot('NVDA')));
    assert.deepEqual(page.render(app.useRunHistory).items.map(row => row.ticker), ['NVDA']);
    storage.getItem = read;
    storage.setItem = write;
    const restored = mount().render(app.useRunHistory);
    assert.deepEqual(restored.items.map(row => row.ticker), ['NVDA']);
    restored.add(app.toHistoryItem(snapshot('GOOG')));
    assert.deepEqual(JSON.parse(values.get(historyKey)).map(row => row.ticker), ['GOOG', 'NVDA']);
  });
});


for (const distinct of [7, 40]) {
  test('sustained blocked history compacts repeated IDs and recovers durable rows; distinct=' + distinct, async () => {
    await withPage(async ({ page, mount, storage, values, writes }) => {
      const saved = Array.from({ length: 25 }, (_, index) => app.toHistoryItem(snapshot('S' + index)));
      values.set(historyKey, JSON.stringify(saved));
      const read = storage.getItem;
      storage.getItem = () => { throw new Error('read blocked'); };
      const history = page.render(app.useRunHistory);
      let expected = saved;
      for (let index = 0; index < 1000; index++) {
        const item = app.toHistoryItem({ ...snapshot('P' + index % distinct), features: { payload: 'x'.repeat(4096), version: index } });
        expected = [item, ...expected.filter(row => row.id !== item.id)].slice(0, 25);
        history.add(item);
      }
      assert.equal(writes.length, 0);
      assert.equal(values.get(historyKey), JSON.stringify(saved));
      assert.equal(page.render(app.useRunHistory).items.length, Math.min(distinct, 25));
      storage.getItem = read;
      assert.deepEqual(mount().render(app.useRunHistory).items, JSON.parse(JSON.stringify(expected)));
      assert.equal(writes.length, 1);
    });
  });
}

test('deferred history retains at most 25 snapshots per summary and recovers in one merge', () => {
  const NativeMap = globalThis.Map;
  const maps = [];
  let readsBlocked = true;
  let durable = JSON.stringify([app.toHistoryItem(snapshot('AAPL'))]);
  let writes = 0;
  let mergeCalls = 0;
  const merge = (newer, older) => { mergeCalls++; return app.mergeHistory(newer, older); };
  let adapter;
  try {
    globalThis.Map = class extends NativeMap { constructor(...args) { super(...args); maps.push(this); } };
    adapter = app.createBrowserStorage(() => ({
      getItem: () => { if (readsBlocked) throw new Error('blocked'); return durable; },
      setItem: (_, value) => { writes++; durable = value; },
      removeItem: () => { durable = null; },
    }));
  } finally { globalThis.Map = NativeMap; }
  const retained = () => {
    const records = maps.flatMap(map => [...map.values()]);
    assert.equal(records.length, 2); // Visible fallback and compact pending summary.
    let payloadChars = 0;
    for (const record of records) {
      const raw = typeof record === 'string' ? record : record.value;
      if (typeof record !== 'string') assert.equal(record.merge, merge);
      const rows = JSON.parse(raw);
      assert.ok(rows.length <= 25);
      payloadChars += rows.reduce((sum, row) => sum + row.snapshot.features.payload.length, 0);
    }
    assert.ok(payloadChars <= 2 * 25 * 4096);
  };
  for (let index = 0; index < 1000; index++) {
    const item = app.toHistoryItem({ ...snapshot('P' + index), features: { payload: 'x'.repeat(4096) } });
    adapter.mergeItem(historyKey, JSON.stringify([item]), merge);
    retained();
  }
  assert.equal(writes, 0);
  readsBlocked = false;
  mergeCalls = 0;
  assert.equal(JSON.parse(adapter.getItem(historyKey)).length, 25);
  assert.equal(mergeCalls, 1);
  assert.equal(writes, 1);
  assert.equal(maps.flatMap(map => [...map.values()]).length, 1);
  // Absolute set and remove barriers must discard summaries, not merely hide them.
  for (const remove of [false, true]) {
    readsBlocked = true;
    adapter.mergeItem(historyKey, JSON.stringify([app.toHistoryItem(snapshot('MSFT'))]), merge);
    if (remove) adapter.removeItem(historyKey);
    else adapter.setJson(historyKey, []);
    assert.equal(maps.flatMap(map => [...map.values()]).length, 1);
    readsBlocked = false;
    assert.equal(adapter.getItem(historyKey), remove ? null : '[]');
  }
});

test('malformed saved Explain flags cannot add explain=1 to a run request', async () => {
  for (const flag of ['false', 'true', 1, {}, []]) {
    const raw = JSON.stringify({ enableExplain: flag });
    await withPage(async ({ page, requests, values, writes }) => {
      const pending = runButton(page.render()).props.onClick();
      assert.equal(requests[0].url, '/api/run?ticker=AAPL', JSON.stringify(flag));
      succeed(requests[0]);
      await pending;
      assert.equal(values.get(settingsKey), raw);
      assert.equal(writes.filter(([, key]) => key === settingsKey).length, 0);
    }, { [settingsKey]: raw });
  }
});

test('explicit Explain changes replace malformed settings and survive Run remounts', async () => {
  await withPage(async ({ mount, values, requests }) => {
    const settings = mount();
    let current;
    const probe = () => { current = app.useSettings(); return null; };
    settings.render(probe);
    assert.equal(current.settings.enableExplain, false);
    for (const enabled of [true, false]) {
      current.setEnableExplain(enabled);
      settings.render(probe);
      assert.deepEqual(JSON.parse(values.get(settingsKey)), { enableExplain: enabled });
      const page = mount();
      const pending = runButton(page.render()).props.onClick();
      const request = requests.at(-1);
      assert.equal(request.url, `/api/run?ticker=AAPL${enabled ? '&explain=1' : ''}`);
      succeed(request);
      await pending;
      page.unmount();
    }
  }, { [settingsKey]: JSON.stringify({ enableExplain: 'false' }) });
});
