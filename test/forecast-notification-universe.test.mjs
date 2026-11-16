import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileSymbols,marketForecastProfile} from '../lib/market-forecast-profiles.mjs';
import {_test as marketSafety} from '../api/signals.mjs';
import {
 FORECAST_NOTIFICATION_UNIVERSE,PRIMARY_FORECAST_NOTIFICATION_SYMBOLS,
 RESEARCH_ONLY_FORECAST_NOTIFICATION_SYMBOLS,forecastNotificationAllowed
} from '../lib/forecast-notification-universe.mjs';
import {runForecastNotifications,forecastTopic}
 from '../lib/forecast-ntfy.mjs';

const MIN=60000;
const now=Date.UTC(2026,10,16,10,0,30);
const env={NTFY_TOPIC:'f'.repeat(32)};
const expectedKept=new Set([
 'BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','ALGOUSDT','ZECUSDT','HYPEUSDT',
 'BNBUSDT','ADAUSDT','LINKUSDT','SUIUSDT','AVAXUSDT','TRXUSDT',
 '1000SHIBUSDT','DOGEUSDT','1000PEPEUSDT','XAUTUSDT','XAUUSDT','XAGUSDT'
]);
const excluded=new Set([
 'AUDUSDT','CADUSDT','JPYUSDT','GBPUSDT','CHFUSDT','EURUSDT',
 'GOOGLUSDT','MRNAUSDT','NVDAUSDT','AMDUSDT','MSFTUSDT','CSCOUSDT','KOUSDT'
]);
const current5m=Math.floor((now-1000)/(5*MIN))*5*MIN;
const current10m=Math.floor((now-1000)/(10*MIN))*10*MIN;
function snapshot(symbol){
 return {mode:'STANDALONE_WEEX_FORECAST_1_5_10',
  available:true,exchange:'WEEX',symbol,notTrade:true,ordersSent:0,
  signalPermission:false,alignment:'THREE_TIMEFRAME_ALIGNMENT',
  combinedDirection:'LONG_BIAS',timeframes:[
   {intervalMinutes:1,closedAt:now-30000,direction:'LONG_BIAS',price:100,
    rsi14:61,atr14:0.5,relativeVolume:1.3,voteAgreement:3,trend:'UP',
    lastCandleBodyBps:2,lastCandleBody:'UP',
    bollinger20:{position:'UPPER_HALF'}},
   {intervalMinutes:5,closedAt:current5m,direction:'LONG_BIAS',price:100,
    rsi14:61,relativeVolume:1.2,voteAgreement:3,trend:'UP',
    lastCandleBodyBps:2},
   {intervalMinutes:10,closedAt:current10m,direction:'LONG_BIAS',price:100,
    rsi14:61,relativeVolume:1.2,voteAgreement:3,trend:'UP',
    lastCandleBodyBps:2}
  ],primaryContext:{structure:'HIGHER_HIGHS_LOW'}};
}
const history=async()=>({ok:true,text:async()=>''});
test('exact 19 crypto/metals and 13 FX/equity markets; original 32 and manual trade-16 unchanged',()=>{
 const all=profileSymbols(),kept=PRIMARY_FORECAST_NOTIFICATION_SYMBOLS,
  researchOnly=RESEARCH_ONLY_FORECAST_NOTIFICATION_SYMBOLS;
 assert.equal(all.length,32);
 assert.equal(marketSafety.FORECAST_SYMBOLS.length,32);
 assert.equal(marketSafety.TRADE_SYMBOLS.length,16);
 assert.equal(kept.length,19);
 assert.equal(researchOnly.length,13);
 assert.deepEqual(new Set(kept),expectedKept);
 assert.deepEqual(new Set(researchOnly),excluded);
 assert.deepEqual(new Set([...kept,...researchOnly]),new Set(all));
 assert.deepEqual(new Set(all),new Set(marketSafety.FORECAST_SYMBOLS));
 assert.ok(kept.every(s=>forecastNotificationAllowed(s)));
 assert.ok(researchOnly.every(s=>!forecastNotificationAllowed(s)));
 assert.equal(forecastNotificationAllowed('FAKEUSDT'),false);
 assert.equal(forecastNotificationAllowed(undefined),false);
 assert.ok(researchOnly.every(s=>['FX_DERIVED','EQUITY_DERIVED']
  .includes(marketForecastProfile(s).group)));
 assert.equal(FORECAST_NOTIFICATION_UNIVERSE.confirmed5mUnchanged,true);
});
test('same 32-market ntfy research scan; only 19 permitted to compete for 2 forecast slots',async()=>{
 const sent=[],visited=[];
 const result=await runForecastNotifications({
  env,now,clock:()=>now,fetchImpl:history,
  symbols:marketSafety.FORECAST_SYMBOLS,
  reader:async symbol=>{visited.push(symbol);return snapshot(symbol)},
  publish:async(topic,message)=>{sent.push({topic,...message})},
  depthCapture:async()=>null
 });
 assert.equal(result.due,true);
 assert.equal(result.scanned,32);
 assert.equal(result.available,32);
 assert.equal(result.aligned,32);
 assert.equal(result.eligible,32);
 assert.equal(result.researchUniverse,32);
 assert.equal(result.notificationUniverse,19);
 assert.equal(result.excludedFromForecastNtfy,13);
 assert.equal(result.delivered,2);
 assert.equal(result.failed,0);
 assert.deepEqual(new Set(visited),new Set(marketSafety.FORECAST_SYMBOLS));
 assert.equal(result.all32EarlyCohortResearch.submittedSnapshots,32);
 assert.equal(result.all32EarlyCohortResearch.validSameClose,32);
 assert.ok(result.cryptoBreadthResearch,
  'existing 16-crypto breadth research must still run during the 32-market scan');
 assert.ok(sent.every(e=>e.topic===forecastTopic(env)));
 assert.ok(sent.every(e=>[...expectedKept].some(s=>e.title.includes(s))));
 assert.ok(sent.every(e=>![...excluded].some(s=>e.title.includes(' · '+s+' '))));
});
test('if only FX/equity candidates align, keep 13 for research but send zero forecast notices',async()=>{
 const sent=[];
 const result=await runForecastNotifications({
  env,now,clock:()=>now,fetchImpl:history,
  symbols:RESEARCH_ONLY_FORECAST_NOTIFICATION_SYMBOLS,
  reader:async symbol=>snapshot(symbol),
  publish:async(topic,message)=>{sent.push({topic,message})},
  depthCapture:async()=>null
 });
 assert.equal(result.scanned,13);
 assert.equal(result.available,13);
 assert.equal(result.eligible,13);
 assert.equal(result.excludedFromForecastNtfy,13);
 assert.equal(result.delivered,0);
 assert.equal(sent.length,0);
 assert.equal(result.all32EarlyCohortResearch.submittedSnapshots,13);
});
test('scope is ntfy forecast routing only, no 108 confirmed gate or trade endpoint changes',()=>{
 const source=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 const push=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const policy=readFileSync(new URL('../lib/forecast-notification-universe.mjs',import.meta.url),'utf8');
 assert.match(source,/summarizeV110All32EarlyCohorts\(researchObservations,now\)/);
 assert.match(source,/const deliverySnapshots=snapshots\.filter\(d=>forecastNotificationAllowed\(d.symbol\)\)/);
 assert.match(source,/for\(const d of deliverySnapshots\)/);
 assert.match(push,/ntfySend\('confirmed',signals\)/);
 for(const code of [source,policy]){
  for(const forbidden of [/placeOrder\(/,/trade-prepare/,/trade-confirm/,/capi\/v3\/order/,/WEEX_API_SECRET/])
   assert.doesNotMatch(code,forbidden);
 }
});
