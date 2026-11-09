/** Offline JSON release contracts. Never log response bodies, warnings or URLs. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

class ContractError extends Error {}
const requireThat = (ok, code) => { if (!ok) throw new ContractError(code); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' && x.trim().length > 0;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const unit = x => finite(x) && x >= 0 && x <= 1;
const timestamp = x => text(x) && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x));
const warning = x => x === null || text(x);
const version = (engine, value) => engine === 'finbert' ? value === 'ProsusAI/finbert' : text(value);

function learned(meta, allowDegraded) {
  requireThat(object(meta), 'sentiment_metadata_missing');
  requireThat(['finbert', 'setfit_fallback'].includes(meta.engine), 'sentiment_not_learned');
  requireThat(version(meta.engine, meta.model_version), 'sentiment_version_invalid');
  requireThat(warning(meta.warning), 'sentiment_warning_invalid');
  requireThat(meta.engine !== 'finbert' || meta.warning === null, 'primary_sentiment_warning');
  if (meta.engine === 'setfit_fallback') {
    requireThat(allowDegraded, 'degraded_sentiment_not_approved');
    requireThat(text(meta.warning), 'degraded_sentiment_not_labeled');
  }
  return meta.engine === 'finbert' ? 'primary' : 'degraded';
}

export function validateReady(data, { allowDegraded = false } = {}) {
  const state = learned(data, allowDegraded);
  requireThat(data.status === (state === 'primary' ? 'ready' : 'degraded'), 'readiness_status_mismatch');
  requireThat(state !== 'primary' || data.warning === null, 'primary_readiness_warning');
  return { state };
}

export function validateSentiment(data, { allowDegraded = false, expectedCount } = {}) {
  requireThat(object(data) && Number.isInteger(expectedCount) && expectedCount > 0, 'sentiment_count_required');
  requireThat(data.n === expectedCount && Array.isArray(data.samples) && data.samples.length === expectedCount, 'sentiment_count_mismatch');
  requireThat(data.samples.every(x => finite(x) && x >= -1 && x <= 1), 'sentiment_samples_invalid');
  requireThat(finite(data.mean) && finite(data.std) && data.std >= 0 && unit(data.confidence), 'sentiment_numbers_invalid');
  const mean = data.samples.reduce((a,b)=>a+b,0)/expectedCount;
  const std = Math.sqrt(data.samples.reduce((a,b)=>a+(b-mean)**2,0)/expectedCount);
  requireThat(Math.abs(mean-data.mean)<1e-9 && Math.abs(std-data.std)<1e-9, 'sentiment_statistics_mismatch');
  requireThat(timestamp(data.ts), 'sentiment_timestamp_invalid');
  requireThat(Array.isArray(data.sample_engines) && data.sample_engines.length === expectedCount && Array.isArray(data.sample_model_versions) && data.sample_model_versions.length === expectedCount, 'sample_metadata_missing');
  for(let i=0;i<expectedCount;i++) {
    requireThat(['finbert','setfit_fallback'].includes(data.sample_engines[i]), 'sample_not_learned');
    requireThat(version(data.sample_engines[i],data.sample_model_versions[i]), 'sample_version_invalid');
  }
  const engines = new Set(data.sample_engines);
  let state;
  if(engines.size > 1) {
    requireThat(allowDegraded, 'degraded_sentiment_not_approved');
    requireThat(data.engine === 'mixed' && data.model_version === null && text(data.warning), 'mixed_sentiment_not_labeled');
    state = 'degraded';
  } else {
    state = learned(data, allowDegraded);
    requireThat(data.sample_engines.every(e=>e === data.engine) && data.sample_model_versions.every(v=>v===data.model_version), 'sample_aggregate_mismatch');
  }
  return { state };
}

export function validateContext(data, { allowDegraded = false, ticker, gateway = false } = {}) {
  requireThat(object(data) && text(ticker) && data.ticker === ticker, 'context_ticker_mismatch');
  const f=data.features, q=data.quote;
  requireThat(object(f) && object(q), 'context_provenance_missing');
  for(const k of ['sent_mean','sent_std','r_1m','r_5m','mins_since_news','rv20']) requireThat(finite(f[k]), 'context_features_invalid');
  for(const k of ['above_sma20','earnings_soon','liquidity_flag']) requireThat(typeof f[k] === 'boolean', 'context_features_invalid');
  requireThat(f.sent_std >= 0, 'context_features_invalid');
  const qualities={tiingo_quote:'real',tiingo_candle:'derived',finnhub_quote:'derived'};
  requireThat(typeof q.last_source === 'string' && Object.hasOwn(qualities,q.last_source) && q.quality === qualities[q.last_source] && finite(q.last) && q.last > 0, 'quote_provenance_invalid');
  requireThat(['real','estimated','unknown'].includes(q.spread_quality), 'quote_spread_invalid');
  requireThat([q.bid,q.ask].every(x=>x===null || finite(x)), 'quote_spread_invalid');
  const state=learned(data.sentiment,allowDegraded);
  requireThat(unit(data.sentiment.confidence), 'sentiment_confidence_invalid');
  requireThat(Array.isArray(data.refs) && data.refs.length===3 && Array.isArray(data.refs_sources), 'headline_provenance_missing');
  const refs=data.refs.filter(x=>x!==null);
  requireThat(refs.length>0 && refs.length===data.refs_sources.length, 'headline_provenance_missing');
  refs.forEach((r,i)=> {
    requireThat(object(r) && text(r.url) && text(r.title) && text(r.publisher) && r.publisher===data.refs_sources[i], 'headline_provenance_invalid');
    let u; try { u=new URL(r.url); } catch { /* No raw response diagnostics. */ }
    requireThat(u && ['https:','http:'].includes(u.protocol), 'headline_url_invalid');
  });
  const note=gateway ? data.features_note : data.error;
  requireThat(note===undefined || note===null || typeof note==='string', 'context_note_invalid');
  // features.py's indicator exception replaces values with synthetic features.
  requireThat(!note || !/(?:^|;\s*)indicators:/.test(note), 'synthetic_indicators');
  requireThat(timestamp(gateway ? data.ts_ctx : data.ts), 'context_timestamp_invalid');
  if(gateway) {
    const rec=data.recommendation;
    requireThat(object(rec) && text(rec.class) && unit(rec.confidence) && text(rec.version), 'recommendation_invalid');
    requireThat(timestamp(data.ts_gateway), 'gateway_timestamp_invalid');
  }
  return { state, providerWarnings: Boolean(note), quoteSource:q.last_source, quoteQuality:q.quality };
}

export function validate(kind, data, options={}) {
  if(kind==='ready') return validateReady(data, options);
  if(kind==='sentiment') return validateSentiment(data, options);
  if(kind==='context' || kind==='gateway') return validateContext(data,{...options,gateway:kind==='gateway'});
  if(kind==='openapi') {
    requireThat(object(data) && object(data.info) && data.info.title===options.title && object(data.paths), 'openapi_invalid');
    return { state:'schema' };
  }
  throw new ContractError('unknown_contract');
}

export function main(args=process.argv.slice(2), env=process.env) {
  try {
    const [kind, detail]=args;
    requireThat(args.length>=1 && args.length<=2, 'invalid_arguments');
    requireThat(['true','false'].includes(env.ALLOW_DEGRADED_SENTIMENT ?? 'false'), 'invalid_degraded_policy');
    const options={allowDegraded:env.ALLOW_DEGRADED_SENTIMENT==='true',expectedCount:Number(detail),ticker:detail,title:detail};
    let data;
    try { data=JSON.parse(readFileSync(0,'utf8')); } catch { throw new ContractError('invalid_json'); }
    const result=validate(kind,data,options);
    console.log(JSON.stringify({contract:kind,...result}));
    return 0;
  } catch(error) {
    // All validation failures are fixed local codes, never user/provider strings.
    console.error(`Release contract failed: ${error instanceof ContractError ? error.message : 'contract_validation_error'}`);
    return 1;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) process.exitCode=main();
