import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const source = readFileSync(new URL('./cloud-run-diagnose.mjs', import.meta.url), 'utf8');
function exercise(fail, errorText = 'PERMISSION_DENIED secret-sentinel https://private.invalid/') {
  const prefix = `
    const commands = [];
    const probes = [];
    const spawnSync = (exe, args) => {
      commands.push([exe, ...args]);
      if (${fail}) return {status:1, stderr:${JSON.stringify(errorText)}};
      const data = args[0] === 'billing' ? {billingEnabled:false, billingAccountName:'secret-sentinel'}
        : args[0] === 'logging' ? [{timestamp:'2026-11-09T07:00:00Z',severity:'ERROR',textPayload:'Memory limit exceeded secret-sentinel https://private.invalid/',resource:{labels:{revision_name:'web-00001'}}}]
        : args[0] === 'beta' ? {spec:{routeName:'midas-dash-web'},status:{conditions:[{type:'Ready',status:'True',message:'secret-sentinel'}]}}
        : {spec:{template:{spec:{containers:[{env:[{name:'TOKEN',value:'secret-sentinel'}]}]}}},status:{url:'https://private.invalid/',conditions:[{type:'Ready',status:'False',reason:'ContainerFailed',message:'failed to start secret-sentinel'}]}};
      return {status:0,stdout:JSON.stringify(data)};
    };
    const fetch = async url => {
      probes.push(new URL(url).pathname);
      return {status:503,body:{cancel:async()=>{}}};
    };
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
    prefix + source.replace("import { spawnSync } from 'node:child_process';", '')
      + '\nconsole.log(JSON.stringify({commands,probes}));'], {
    encoding: 'utf8', env: {...process.env, PROJECT_ID:'test-project', REGION:'us-central1'},
  });
  assert.equal(result.status, 0, result.stderr);
  assert(!result.stdout.includes('secret-sentinel'));
  assert(!result.stdout.includes('https://private.invalid'));
  const rows = result.stdout.trim().split('\n').map(row => JSON.parse(row));
  return {rows:rows.slice(0,-1), ...rows.at(-1)};
}
test('diagnostics only read the five services and never print secrets, URLs or raw logs', () => {
  const result = exercise(false);
  assert.equal(result.rows.filter(row => row.kind === 'service').length, 5);
  assert.equal(result.rows.find(row => row.kind === 'billing').billingEnabled, false);
  assert(result.rows.filter(row => row.kind === 'logs').every(row => row.entries[0].categories.includes('memory-limit')));
  assert.equal(result.commands.length, 12);
  assert(result.commands.every(([exe, ...args]) => exe === 'gcloud'
    && !args.some(arg => ['deploy','update','enable','disable','add-iam-policy-binding','access'].includes(arg))));
  assert(result.probes.every(path => ['/', '/history', '/settings', '/healthz', '/openapi.json'].includes(path)));
  assert.equal(result.probes.length, 11);
});
test('command failures disclose only recognized categories and skip service probes', () => {
  const result = exercise(true);
  assert.equal(result.probes.length, 0);
  assert(result.rows.filter(row => row.available === false).every(row => row.categories.includes('permission-denied')));
});
test('a disabled billing API does not imply the project or billing account is disabled', () => {
  const result = exercise(true, 'Cloud Billing API has not been used in project 123 before or it is disabled');
  const billing = result.rows.find(row => row.kind === 'billing');
  assert.equal(billing.available, false);
  assert.deepEqual(billing.categories, ['api-disabled']);
  assert.equal(billing.billingEnabled, undefined);
});
test('the observed Cloud Run billing-disabled message is classified precisely', () => {
  const result = exercise(true, 'The request failed because billing is disabled for this project.');
  assert.deepEqual(result.rows.find(row => row.kind === 'billing').categories, ['billing-disabled']);
});
