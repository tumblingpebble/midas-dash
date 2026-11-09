import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validate,validateReady,validateSentiment,validateContext } from './deploy-contract.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const workflow=fs.readFileSync(process.env.CONTRACT_WORKFLOW || path.join(here,'../.github/workflows/deploy-manual-cloud-run.yml'),'utf8');
const primary={engine:'finbert',model_version:'ProsusAI/finbert',warning:null};
const fallback={engine:'setfit_fallback',model_version:'setfit_hpc_full_v1',warning:'finbert_unavailable'};
const when='2026-11-09T12:00:00Z';
const context=()=>({ticker:'AAPL',features:{sent_mean:0.2,sent_std:0.1,r_1m:0,r_5m:0,mins_since_news:240,rv20:0.001,above_sma20:false,earnings_soon:false,liquidity_flag:true},quote:{last:100,bid:99,ask:101,quality:'real',spread_quality:'estimated',last_source:'tiingo_quote',ts:null},sentiment:{...primary,confidence:0.8},refs:[{title:'Quarterly results',publisher:'Example News',url:'https://example.test/news'},null,null],refs_sources:['Example News'],error:null,ts:when});
const sentiment=()=>({...primary,n:2,samples:[0.2,-0.2],mean:0,std:0.2,confidence:0.8,ts:when,sample_engines:['finbert','finbert'],sample_model_versions:['ProsusAI/finbert','ProsusAI/finbert']});
const options={ticker:'AAPL'};
const copy=x=>structuredClone(x);

test('workflow derives checked-out revision, not dispatch revision',()=>{
  const block=workflow.match(/      - name: Set deploy metadata[\s\S]*?        run: \|\r?\n([\s\S]*?)(?=\r?\n      - name:)/)[1].split(/\r?\n/).map(x=>x.replace(/^          /,'')).join('\n');
  const dir=fs.mkdtempSync(path.join(process.env.CONTRACT_TEST_TMP_DIR || os.tmpdir(),'midas-contract-'));
  try {
    const out=path.join(dir,'output').replaceAll('\\','/');
    const sha='a'.repeat(40);
    // Execute ONLY this metadata block with fixture git output, never a deploy block.
    const script='git() { [ "$*" = "rev-parse --verify HEAD^{commit}" ] || return 1; printf "%s\\n" "$CHECKED_OUT_SHA"; }\n'+block;
    const run=spawnSync(process.env.CONTRACT_BASH || (process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash'),['--noprofile','--norc','-eo','pipefail','-c',script],{encoding:'utf8',env:{...process.env,GITHUB_ENV:out,GITHUB_SHA:'b'.repeat(40),CHECKED_OUT_SHA:sha,AR_HOST:'registry.example',PROJECT_ID:'fixture',AR_REPO:'fixture'}});
    assert.equal(run.status,0,run.stderr);
    assert.match(fs.readFileSync(out,'utf8'),new RegExp(`^SOURCE_SHA=${sha}$`,'m'));
    assert.doesNotMatch(workflow,/\$\{SHORT_SHA\}/);
    assert.match(workflow,/sentiment-api:\$\{SOURCE_SHA\}/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('workflow preserves unrelated existing environment overrides',()=>{
  const flags=[...workflow.matchAll(/--(set|update)-env-vars "([^"]+)"/g)];
  assert.equal(flags.length,3);
  for(const [,mode,list] of flags) {
    // Offline model of documented gcloud set vs update semantics, no CLI/cloud call.
    const old={UNRELATED_OVERRIDE:'retain-me'};
    const owned=Object.fromEntries(list.split(',').map(x=>x.split('=')));
    const after=mode==='set'?owned:{...old,...owned};
    assert.equal(after.UNRELATED_OVERRIDE,'retain-me');
  }
  assert.equal((workflow.match(/--update-secrets/g)||[]).length,1);
  assert.match(workflow,/--update-secrets "FINNHUB_TOKEN=FINNHUB_TOKEN:1,TIINGO_TOKEN=TIINGO_TOKEN:1"/);
});
test('workflow gates readiness and structured sentiment/context/gateway output',()=>{
  assert.equal((workflow.match(/\/readyz" \| node scripts\/deploy-contract\.mjs ready/g)||[]).length,2);
  assert.doesNotMatch(workflow,/grep -q/);
  const deploySection=workflow.slice(workflow.indexOf('  deploy:'));
  assert.ok(deploySection.indexOf('run: node --test scripts/deploy-contract.test.mjs') > 0);
  assert.ok(deploySection.indexOf('run: node --test scripts/deploy-contract.test.mjs') < deploySection.indexOf('name: Authenticate to Google Cloud'));
  assert.match(workflow,/allow_degraded_sentiment:[\s\S]*?default: false/);
  assert.match(workflow,/defaults:\s+run:\s+shell: bash/);
  for(const kind of ['sentiment 2','sentiment 3','context AAPL','context BAC','gateway AAPL','gateway BAC']) assert.ok(workflow.includes('node scripts/deploy-contract.mjs '+kind));
});
test('primary readiness accepted unchanged',()=>assert.deepEqual(validateReady({...primary,status:'ready'}),{state:'primary'}));
test('learned fallback explicitly labeled and opt-in',()=>{
  const data={...fallback,status:'degraded'};
  assert.throws(()=>validateReady(data),/not_approved/);
  assert.deepEqual(validateReady(data,{allowDegraded:true}),{state:'degraded'});
  assert.throws(()=>validateReady({...data,status:'ready'},{allowDegraded:true}),/status_mismatch/);
  assert.throws(()=>validateReady({...data,warning:null},{allowDegraded:true}),/not_labeled/);
});
test('lexicon, unavailable, rule gate and malformed readiness rejected',()=>{
  for(const data of [null,{}, {engine:'lexicon',status:'unavailable',model_version:null,warning:'none'}, {...primary,status:'unavailable'}, {...primary,status:'ready',model_version:'unknown'}, {...primary,engine:'setfit_rule_gate',status:'degraded'}]) assert.throws(()=>validateReady(data,{allowDegraded:true}));
});
test('finite aligned primary batch accepted and malformed outputs rejected',()=>{
  assert.deepEqual(validateSentiment(sentiment(),{expectedCount:2}),{state:'primary'});
  for(const mutate of [x=>x.samples[0]=Infinity,x=>x.samples[0]='0.2',x=>x.n=3,x=>x.mean=0.5,x=>x.std=-1,x=>x.confidence=NaN,x=>x.sample_engines.pop(),x=>x.sample_model_versions[0]='wrong',x=>x.engine='mixed',x=>x.ts='invalid']) {
    const data=sentiment();mutate(data);assert.throws(()=>validateSentiment(data,{expectedCount:2}));
  }
});
test('fallback and mixed learned batches remain degraded, never lexicon',()=>{
  const data={...sentiment(),...fallback,sample_engines:['setfit_fallback','setfit_fallback'],sample_model_versions:[fallback.model_version,fallback.model_version]};
  assert.throws(()=>validateSentiment(data,{expectedCount:2}),/not_approved/);
  assert.deepEqual(validateSentiment(data,{expectedCount:2,allowDegraded:true}),{state:'degraded'});
  data.sample_engines[0]='finbert';data.sample_model_versions[0]=primary.model_version;data.engine='mixed';data.model_version=null;
  assert.deepEqual(validateSentiment(data,{expectedCount:2,allowDegraded:true}),{state:'degraded'});
  data.sample_engines[1]='lexicon_fallback';data.sample_model_versions[1]=null;
  assert.throws(()=>validateSentiment(data,{expectedCount:2,allowDegraded:true}),/not_learned/);
});
test('old grep accepts explicit stub/error and lexicon; validator rejects',()=>{
  const stubs=[{features:context().features,error:'provider failed'}, {...context(),quote:{last:0,quality:'unknown',last_source:'unknown'},sentiment:{engine:'none',warning:'live_providers_disabled',confidence:null,model_version:null}}, {...context(),sentiment:{engine:'unavailable',warning:'sentiment_request_failed',confidence:null,model_version:null}}];
  for(const stub of stubs) {assert.ok(JSON.stringify(stub).includes('"features"'));assert.throws(()=>validateContext(stub,{...options,allowDegraded:true}));}
  const lex={...sentiment(),engine:'lexicon'};
  assert.ok(JSON.stringify(lex).includes('"engine"'));
  assert.throws(()=>validateSentiment(lex,{expectedCount:2,allowDegraded:true}));
});
test('documented provider provenance accepted without freshness/trading thresholds',()=>{
  for(const [source,quality] of [['tiingo_quote','real'],['tiingo_candle','derived'],['finnhub_quote','derived']]) {
    const data=context();data.quote.last_source=source;data.quote.quality=quality;
    data.ts='2020-01-01T00:00:00Z';data.error='tiingo quote: fixture failure; rv20 used quote-ring fallback because candles were unavailable';
    assert.deepEqual(validateContext(data,options),{state:'primary',providerWarnings:true,quoteSource:source,quoteQuality:quality});
  }
});
test('learned fallback context is explicitly degraded',()=>{
  const data=context();data.sentiment={...fallback,confidence:0.8};data.error='sentiment_meta: finbert_unavailable';
  assert.throws(()=>validateContext(data,options),/not_approved/);
  assert.equal(validateContext(data,{...options,allowDegraded:true}).state,'degraded');
});
test('context missing, unknown or inconsistent provenance fails',()=>{
  for(const mutate of [x=>x.quote.last=Infinity,x=>x.quote.last_source='unknown',x=>x.quote.last_source=['tiingo_quote'],x=>x.refs[0].url=['https://example.test/news'],x=>x.sentiment.warning='unexpected_primary_warning',x=>x.quote.quality='derived',x=>x.refs=[],x=>x.refs_sources=['Wrong'],x=>x.refs[0].url='bad',x=>x.error='indicators: failure',x=>x.features.rv20=NaN,x=>x.features.liquidity_flag='true',x=>x.sentiment.engine='mixed',x=>x.ticker='BAC']) {
    const data=context();mutate(data);assert.throws(()=>validateContext(data,{...options,allowDegraded:true}));
  }
});
test('gateway validates forwarded context and actual recommendation shape',()=>{
  const data={...context(),ts_ctx:when,ts_gateway:when,recommendation:{class:'NO_ACTION',confidence:0.1,version:'fixture-v1'}};
  assert.equal(validate('gateway',data,options).state,'primary');
  for(const rec of [{},{class:'NO_ACTION',confidence:Infinity,version:'v1'},{class:'NO_ACTION',confidence:0.1}]) assert.throws(()=>validate('gateway',{...data,recommendation:rec},options));
  assert.throws(()=>validate('gateway',{...data,features_note:'indicators: failed'},options));
});
test('OpenAPI is structurally parsed rather than grepped',()=>{
  assert.deepEqual(validate('openapi',{info:{title:'MIDAS Sentiment API'},paths:{}},{title:'MIDAS Sentiment API'}),{state:'schema'});
  assert.throws(()=>validate('openapi',{title:'MIDAS Sentiment API'},{title:'MIDAS Sentiment API'}));
});
test('CLI never leaks token-bearing bodies, malformed JSON or provider notes',()=>{
  const marker='NEVER_LOG_FIXTURE_TOKEN';
  for(const body of [`{"error":"https://example.test/?token=${marker}"}`,`{"broken":"${marker}`,JSON.stringify({...context(),error:`tiingo quote: https://example.test/?token=${marker}`})]) {
    const run=spawnSync(process.execPath,[path.join(here,'deploy-contract.mjs'),'context','AAPL'],{input:body,encoding:'utf8',env:{...process.env,ALLOW_DEGRADED_SENTIMENT:'false'}});
    assert.ok([0,1].includes(run.status));
    assert.ok(!(run.stdout+run.stderr).includes(marker));
    assert.ok(!(run.stdout+run.stderr).includes('https://'));
  }
});

test('web HEAD gate preserves success and rejects fixture HTTP errors',()=>{
  const line=workflow.split(/\r?\n/).find(x=>/^\s*curl .*\$\{WEB_URL\}/.test(x));
  assert.ok(line,'web HEAD gate is required');
  // Offline curl stand-in models documented --fail exit 22 on HTTP >=400.
  // Execute only the extracted HEAD command, never Final verification/deploy blocks.
  const fixture=`curl() {
    fail=0; head=0
    for arg in "$@"; do
      case "$arg" in --fail|-f) fail=1 ;; -I|--head) head=1 ;; esac
    done
    [ "$head" = 1 ] || return 98
    if [ "$FIXTURE_HTTP_STATUS" -ge 400 ] && [ "$fail" = 1 ]; then return 22; fi
    return 0
  }\n${line.trim()}\n`;
  for(const status of ['200','204','404','500','503']) {
    const run=spawnSync(process.env.CONTRACT_BASH || (process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash'),['--noprofile','--norc','-eo','pipefail','-c',fixture],{encoding:'utf8',env:{...process.env,FIXTURE_HTTP_STATUS:status,WEB_URL:'https://example.test'}});
    assert.equal(run.status,Number(status)>=400?22:0,`HTTP ${status}`);
  }
});
