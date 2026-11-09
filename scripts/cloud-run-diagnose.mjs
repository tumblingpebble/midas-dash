import { spawnSync } from 'node:child_process';

// Only these pre-existing Dash resources are inspected. Never print raw command
// output: service descriptions and application logs can contain private values.
const project = process.env.PROJECT_ID;
const region = process.env.REGION;
if (!project || !region) throw new Error('PROJECT_ID and REGION are required');
const services = ['sentiment-api', 'context-api', 'recommender-api', 'gateway-api', 'midas-dash-web'];
const categories = [
  ['billing-disabled', /billing.{0,60}(disabled|closed|suspended)|BILLING_DISABLED/i],
  ['permission-denied', /PERMISSION_DENIED|permission.{0,30}denied|does not have permission/i],
  ['api-disabled', /SERVICE_DISABLED|API.{0,60}(disabled|not been used)/i],
  ['project-disabled', /SYSTEM_DISABLED|project.{0,60}(suspended|disabled)/i],
  ['no-available-instance', /no available instance/i],
  ['memory-limit', /memory limit|out of memory|OOMKilled/i],
  ['container-start-failed', /failed to start|failed to listen|ContainerMissing|ContainerFailed/i],
  ['upstream-connection', /connect\(\) failed|connection refused|upstream timed out/i],
  ['module-import', /ModuleNotFoundError|ImportError/i],
  ['artifact-missing', /image.{0,60}not found|artifact.{0,60}not found/i],
];
function classify(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return categories.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
function emit(kind, value) { console.log(JSON.stringify({ kind, ...value })); }
function read(args) {
  const result = spawnSync('gcloud', [...args, '--project', project, '--quiet', '--format=json'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000 });
  if (result.status !== 0) return { ok: false, categories: classify(result.stderr || ''), exitCode: result.status };
  try { return { ok: true, data: JSON.parse(result.stdout) }; }
  catch { return { ok: false, categories: ['invalid-json'] }; }
}
function conditions(items) {
  return (items || []).map(item => ({
    type: item.type, status: item.status, reason: item.reason,
    categories: classify(item.message || ''),
  }));
}
emit('scope', { mode: 'read-only', serviceCount: services.length, domain: 'midasdash.app' });
const billing = read(['billing', 'projects', 'describe', project]);
emit('billing', billing.ok ? { available: true, billingEnabled: billing.data.billingEnabled ?? null }
  : { available: false, categories: billing.categories });
for (const service of services) {
  const result = read(['run', 'services', 'describe', service, '--region', region]);
  if (!result.ok) { emit('service', { service, available: false, categories: result.categories }); continue; }
  const { data } = result;
  const container = data.spec?.template?.spec?.containers?.[0] || {};
  emit('service', {
    service, available: true, conditions: conditions(data.status?.conditions),
    latestCreatedRevision: data.status?.latestCreatedRevisionName,
    latestReadyRevision: data.status?.latestReadyRevisionName,
    traffic: (data.status?.traffic || []).map(t => ({ revision: t.revisionName, percent: t.percent })),
    resources: container.resources?.limits,
    liveProviders: container.env?.find(e => e.name === 'LIVE_PROVIDERS')?.value === '1' ? 'enabled' : 'not-enabled-or-unset',
  });
  // Health/schema endpoints only; no market provider requests or inference.
  if (data.status?.url) {
    for (const path of (service === 'midas-dash-web' ? ['/', '/history', '/settings'] : ['/healthz', '/openapi.json'])) {
      try {
        const response = await fetch(new URL(path, data.status.url), { redirect: 'error', signal: AbortSignal.timeout(15000) });
        await response.body?.cancel();
        emit('probe', { service, path, status: response.status });
      } catch { emit('probe', { service, path, status: 'unreachable' }); }
    }
  }
  const logs = read(['logging', 'read', `resource.type="cloud_run_revision" AND resource.labels.service_name="${service}" AND severity>=WARNING`, '--freshness=2h', '--limit=20']);
  emit('logs', logs.ok ? { service, available: true, entries: logs.data.map(entry => ({
    timestamp: entry.timestamp, severity: entry.severity,
    revision: entry.resource?.labels?.revision_name,
    status: entry.httpRequest?.status,
    categories: classify([entry.textPayload, entry.jsonPayload, entry.protoPayload?.status]),
  })) } : { service, available: false, categories: logs.categories });
}
const domain = read(['beta', 'run', 'domain-mappings', 'describe', '--domain', 'midasdash.app', '--region', region]);
emit('domain', domain.ok ? {
  available: true, conditions: conditions(domain.data.status?.conditions),
  mappedService: services.includes(domain.data.spec?.routeName) ? domain.data.spec.routeName : 'unexpected-target',
} : { available: false, categories: domain.categories });
