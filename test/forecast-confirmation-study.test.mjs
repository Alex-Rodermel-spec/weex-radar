import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {linkPriorForecasts,summarizeForecastConfirmationStudy,LINK_PROTOCOL}
 from '../lib/forecast-confirmation-study.mjs';

const MIN=60000;
const NOW=Date.UTC(2026,10,11,15);
const T=NOW-60*MIN;
const alert=(symbol,direction,sentAt,status='TP')=>({
 symbol,direction,sentAt,status,entry:100,stop:99,take:103
});
const forecast=(symbol,direction,sentAt)=>({symbol,direction,sentAt});

test('only a same-symbol forecast STRICTLY before the confirmed alert can match',()=>{
 const c=[alert('XRPUSDT','SHORT',T)];
 const f=[forecast('XRPUSDT','SHORT',T),
  forecast('XRPUSDT','SHORT',T+MIN),
  forecast('BTCUSDT','SHORT',T-2*MIN)];
 const x=linkPriorForecasts(c,f,NOW);
 assert.equal(x.length,1);
 assert.equal(x[0].relationship,'NO_PRIOR');
 assert.equal(x[0].leadMinutes,null);
});
test('most recent published forecast wins; an opposite forecast is not hidden',()=>{
 const c=[alert('XRPUSDT','LONG',T)];
 const f=[forecast('XRPUSDT','LONG',T-18*MIN),
  forecast('XRPUSDT','SHORT',T-3*MIN),
  forecast('XRPUSDT','LONG',T+MIN)];
 const x=linkPriorForecasts(c,f,NOW)[0];
 assert.equal(x.relationship,'CONFLICT');
 assert.equal(x.leadMinutes,3);
});
test('stale forecast and future forecast are not linked',()=>{
 const c=[alert('ETHUSDT','LONG',T),alert('SOLUSDT','SHORT',T)];
 const f=[forecast('ETHUSDT','LONG',T-31*MIN),
  forecast('SOLUSDT','SHORT',T+2*MIN)];
 assert.deepEqual(linkPriorForecasts(c,f,NOW).map(x=>x.relationship),
  ['NO_PRIOR','NO_PRIOR']);
 const edge=linkPriorForecasts([alert('ETHUSDT','LONG',T)],
  [forecast('ETHUSDT','LONG',T-30*MIN)],NOW);
 assert.equal(edge[0].relationship,'AGREED');
 assert.equal(edge[0].leadMinutes,30);
});
test('each cohort counts only resolved TP/SL and separates LONG from SHORT',()=>{
 const confirmed=[
  alert('HYPEUSDT','LONG',T,'SL'),
  alert('SUIUSDT','LONG',T+4*MIN,'SL'),
  alert('BTCUSDT','SHORT',T+5*MIN,'TP'),
  alert('ETHUSDT','SHORT',T+6*MIN,'INTRABAR'),
  alert('AVAXUSDT','LONG',T+8*MIN,'NO_DATA')
 ];
 const forecasts=[
  forecast('HYPEUSDT','LONG',T-4*MIN),
  forecast('SUIUSDT','SHORT',T-3*MIN),
  forecast('BTCUSDT','SHORT',T-2*MIN)
 ];
 const s=summarizeForecastConfirmationStudy(confirmed,forecasts,NOW);
 const w=s.windows[30];
 assert.equal(w.total,5);
 assert.equal(w.groups.AGREED.total,2);
 assert.equal(w.groups.AGREED.TP,1);
 assert.equal(w.groups.AGREED.SL,1);
 assert.equal(w.groups.AGREED.tpRatePct,50);
 assert.equal(w.groups.CONFLICT.total,1);
 assert.equal(w.groups.CONFLICT.SL,1);
 assert.equal(w.groups.NO_PRIOR.total,2);
 assert.equal(w.groups.NO_PRIOR.resolved,0);
 assert.equal(w.groups.NO_PRIOR.tpRatePct,null);
 assert.equal(w.byDirection.LONG.AGREED.SL,1);
 assert.equal(w.byDirection.SHORT.AGREED.TP,1);
 assert.equal(w.comparison.status,'COLLECTING');
 assert.equal(w.comparison.agreedMinusNoPriorTpRatePp,null);
});
test('pre-rollout or after-coverage confirmations are not mistaken for no forecast',()=>{
 const c=[alert('BTCUSDT','SHORT',T-10*MIN),
  alert('BTCUSDT','SHORT',T+40*MIN)];
 const f=[forecast('BTCUSDT','SHORT',T),
  forecast('ETHUSDT','LONG',T+2*MIN)];
 const links=linkPriorForecasts(c,f,NOW);
 assert.deepEqual(links.map(x=>x.relationship),
  ['OUT_OF_COVERAGE','OUT_OF_COVERAGE']);
 const s=summarizeForecastConfirmationStudy(c,f,NOW).windows[30];
 assert.equal(s.groups.OUT_OF_COVERAGE.total,2);
 assert.equal(s.groups.NO_PRIOR.total,0);
 assert.equal(s.comparison.readyForReview,false);
});
test('aggregates do not expose private alerts, topic, prices or individual times',()=>{
 const s=summarizeForecastConfirmationStudy([
  alert('XRPUSDT','SHORT',T,'TP')],
 [forecast('XRPUSDT','SHORT',T-MIN)],NOW);
 const json=JSON.stringify(s);
 assert.equal(s.protocol.lookbackMinutes,30);
 assert.equal(s.protocol.minimumResolvedPerGroup,50);
 for(const forbidden of [/"id"/,/"sentAt"/,/"entry"/,/"symbol"/,
  /"reference"/,/NTFY_TOPIC/,/PUSH_CRON_KEY/,/123456789/]){
  assert.doesNotMatch(json,forbidden);
 }
 const code=readFileSync(new URL('../lib/forecast-confirmation-study.mjs',import.meta.url),'utf8');
 for(const pattern of [/fetch\(/,/trade-confirm/,/ntfySend/,/publishNtfy/,/capi\/v3\/order/])
  assert.doesNotMatch(code,pattern);
});
