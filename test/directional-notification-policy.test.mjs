import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {PHONE_POLICY,phoneGate,filterPhoneCandidates} from '../lib/directional-notification-policy.mjs';
import {fullForecastDiagnostics} from '../lib/full-forecast-diagnostics.mjs';

const now=Date.UTC(2026,10,10,5,30,0);
const signal=(overrides={})=>({
 symbol:'XRPUSDT',status:'ok',exchange:'WEEX',direction:'LONG',
 candleCloseTime:now-15_000,expiresAt:now+90_000,livePrice:2.1,
 entryQuality:{ok:true,rr:2},
 advisor:{status:'REVIEW',netRR:1.8},
 costReview:{mode:'SHADOW_COSTS',status:'PASS_ESTIMATE',netRR:1.8},
 filterDiagnostic:{stage:'ready'},indicators:{rsi:63,atr:.04,volumeRatio:1.4,trend15:'UP'},
 ...overrides
});
test('only fresh, cost-reviewed manually-reviewable WEEX LONG and SHORT can reach phone',()=>{
 assert.equal(PHONE_POLICY.mode,'CONFIRMED_LONG_SHORT_ONLY');
 assert.equal(PHONE_POLICY.earlyToPhone,false);
 assert.equal(PHONE_POLICY.forecastFollowupsToPhone,false);
 for(const side of ['LONG','SHORT'])
  assert.equal(phoneGate(signal({direction:side}),now),'PHONE_LONG_SHORT');
 const blocked=[
  [signal({direction:null}),'NOT_DIRECTIONAL'],
  [signal({direction:'WAIT'}),'NOT_DIRECTIONAL'],
  [signal({status:'error'}),'EXCHANGE_OR_DATA'],
  [signal({exchange:'Bybit'}),'EXCHANGE_OR_DATA'],
  [signal({candleCloseTime:now-95_000}),'STALE_CANDLE'],
  [signal({expiresAt:now+3000}),'EXPIRED'],
  [signal({livePrice:null}),'NO_FRESH_QUOTE'],
  [signal({entryQuality:{ok:false}}),'ENTRY_RISK'],
  [signal({advisor:{status:'WAIT'}}),'NOT_REVIEW_APPROVED'],
  [signal({costReview:null}),'COST_RISK'],
  [signal({costReview:{mode:'SHADOW_COSTS',status:'LOW_NET_RR',netRR:1}}),'COST_RISK'],
  [signal({retest:{LONG:{status:'FAILED'}}}),'FAILED_RETEST']
 ];
 for(const [s,expected] of blocked)
  assert.equal(phoneGate(s,now),expected,JSON.stringify(s));
});
test('all blocked stages remain visible in diagnostic tally but never become notification',()=>{
 const set=[signal(),signal({symbol:'ETHUSDT',direction:'SHORT'}),
  signal({symbol:'DOGEUSDT',advisor:{status:'SKIP'}}),
  signal({symbol:'SOLUSDT',costReview:null})];
 const result=filterPhoneCandidates(set,now);
 assert.deepEqual(result.accepted.map(s=>s.symbol),['XRPUSDT','ETHUSDT']);
 assert.equal(result.diagnostics.examined,4);
 assert.equal(result.diagnostics.allowed,2);
 assert.equal(result.diagnostics.blocked.NOT_REVIEW_APPROVED,1);
 assert.equal(result.diagnostics.blocked.COST_RISK,1);
 assert.equal(result.diagnostics.notATrade,true);
});
test('full scan explains each market without inventing LONG/SHORT on no-setup data',()=>{
 const m=[signal(),signal({symbol:'ADAUSDT',direction:null,score:null,
  filterDiagnostic:{stage:'trend_mismatch'},reason:'Тренд 5м и 15м не согласован',
  indicators:{rsi:51,volumeRatio:0.8,atr:.01,trend15:'DOWN'}})];
 const d=fullForecastDiagnostics(m,now);
 assert.equal(d.mode,'READ_ONLY_FULL_FORECAST_DIAGNOSTICS');
 assert.equal(d.observedMarkets,2);
 assert.equal(d.markets[0].direction,'LONG');
 assert.equal(d.markets[0].rsi5,63);
 assert.equal(d.markets[0].volumeRatio5,1.4);
 assert.equal(d.markets[1].direction,null);
 assert.equal(d.markets[1].stage,'trend_mismatch');
 assert.equal(d.markets[1].reason,'Тренд 5м и 15м не согласован');
 assert.equal(d.phonePolicy.earlyToPhone,false);
 assert.equal(d.ordersSent,0);
});
test('cron does not emit forecast or skip messages, but keeps silent diagnostics',()=>{
 const push=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-push.mjs',import.meta.url),'utf8');
 const health=readFileSync(new URL('../lib/health-route.mjs',import.meta.url),'utf8');
 const monitor=readFileSync(new URL('../lib/health-monitor.mjs',import.meta.url),'utf8');
 assert.match(push,/observeEarlyPush\(\)/);
 assert.doesNotMatch(push,/sendEarlyPush\(\)/);
 assert.doesNotMatch(push,/followupSentForecasts\(/);
 assert.match(push,/filterPhoneCandidates\(withFreshQuote,Date\.now\(\)\)/);
 assert.match(push,/ntfySend\('confirmed',signals\)/);
 assert.match(early,/export async function observeEarlyPush/);
 assert.match(early,/suppressedNotifications:detected.length/);
 assert.match(health,/fullForecastDiagnostics\(marketResult.value,now\)/);
 assert.match(monitor,/recorded-in-diagnostics-only/);
 assert.doesNotMatch(monitor,/await publishNtfy\(main/);
});
test('health page is valid browser JS and shows every 5m market diagnostic',()=>{
 const page=readFileSync(new URL('../health.html',import.meta.url),'utf8');
 const m=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(m);
 assert.doesNotThrow(()=>new Script(m[1]));
 assert.match(page,/id="market-diagnostics-body"/);
 assert.match(page,/READ_ONLY_FULL_FORECAST_DIAGNOSTICS/);
 assert.match(page,/full\.markets/);
 assert.match(page,/td\.textContent=val/);
});
