import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeV110DepthSnapshot,captureV110Depth,attachV110DepthClick,
 readV110DepthClick,validateV110Depth,V110_DEPTH_CAPTURE_POLICY}
 from '../lib/v110-depth-capture.mjs';
import {evaluateV110DepthStudy} from '../lib/v110-depth-study.mjs';
import {forecastTopic,runForecastNotifications} from '../lib/forecast-ntfy.mjs';
import {parsePublishedForecast,normalizeForecastArchiveRow,
 mergeForecastArchive} from '../lib/forecast-journal.mjs';

const NOW=Date.UTC(2026,10,13,3,40,30);
const env={NTFY_TOPIC:'wr-'+('a'.repeat(32))};
const id=i=>i.toString(16).padStart(32,'0');
const book={
 data:{bids:[['99.99','3'],['99.95','7']],
  asks:[['100.01','2'],['100.05','3']]}
};
function fixture(symbol='BTCUSDT'){
 return {symbol,exchange:'WEEX',available:true,
  mode:'STANDALONE_WEEX_FORECAST_1_5_10',
  notTrade:true,ordersSent:0,signalPermission:false,
  alignment:'THREE_TIMEFRAME_ALIGNMENT',combinedDirection:'LONG_BIAS',
  timeframes:[1,5,10].map((min,i)=>({
   intervalMinutes:min,closedAt:NOW-(i?300000:30000),
   direction:'LONG_BIAS',rsi14:60,relativeVolume:1.4,
   atr14:1.0,price:100,voteAgreement:3
  }))}
}
function archiveForecast(i,stamp,depth){
 return {id:id(i),symbol:'BTCUSDT',direction:'LONG',strength:'STANDARD',
  reference:100,sentAt:stamp,depthShadow:depth,
  windows:Object.fromEntries([1,5,10,15,20,30].map(h=>[h,{
   status:'OBSERVED',moveBps:i%2?20:-20}])),
  aligned5m:Object.fromEntries([1,2,3].map(x=>[x,{
   status:'OBSERVED',moveBps:10}]))};
}
test('depth from 200-level WEEX book only, cap inputs, no fake fills',()=>{
 const d=makeV110DepthSnapshot(book,'BTCUSDT',NOW-500);
 assert.equal(d.v,1);
 assert.ok(d.p>0&&d.p<=100);
 assert.ok(d.q>0);
 assert.ok(d.s>=0);
 assert.equal(makeV110DepthSnapshot(book,'../BTCUSDT',NOW-500),null);
 assert.equal(makeV110DepthSnapshot({data:{bids:[],asks:[]}},'BTCUSDT',NOW-500),null);
});
test('signed ntfy click survives roundtrip but after-publication and forged depth do not',()=>{
 const d=makeV110DepthSnapshot(book,'BTCUSDT',NOW-500);
 const click=attachV110DepthClick('https://weex-radar.vercel.app/forecast.html',d,{id:id(5),env});
 assert.match(click,/#v110d=/);
 assert.deepEqual(readV110DepthClick(click,{id:id(5),sentAt:NOW,env}),d);
 assert.equal(readV110DepthClick(click,{id:id(6),sentAt:NOW,env}),null);
 assert.equal(readV110DepthClick(click.replace(/.$/,'A'),{id:id(5),sentAt:NOW,env}),null);
 assert.equal(readV110DepthClick(click,{id:id(5),sentAt:NOW+11_000,env}),null);
 assert.equal(readV110DepthClick(click,{id:id(5),sentAt:NOW-2500,env}),null);
 assert.equal(readV110DepthClick('https://evil.example/#v110d=garbage',
  {id:id(5),sentAt:NOW,env}),null);
 assert.equal(validateV110Depth({v:1,t:NOW+5000,p:20,q:30,s:1},NOW),null);
});
test('bounded capture fetch is market-only, failed WEEX stays nullable',async()=>{
 const captured=[];
 const ok=await captureV110Depth('BTCUSDT',{
  clock:()=>NOW-350,
  fetchImpl:async(url,options)=>{
   captured.push({url,method:options.method,signal:options.signal});
   return {ok:true,headers:{get:()=>null},
    text:async()=>JSON.stringify(book)};
  }});
 assert.equal(captured.length,1);
 assert.match(captured[0].url,/market\/depth\?symbol=BTCUSDT&limit=200/);
 assert.ok(ok&&ok.t===NOW-350);
 const failed=await captureV110Depth('BTCUSDT',{fetchImpl:async()=>{throw Error('timeout')}});
 assert.equal(failed,null);
 assert.equal(V110_DEPTH_CAPTURE_POLICY.maxSnapshotsPerBucket,2);
 assert.equal(V110_DEPTH_CAPTURE_POLICY.liveSignalChanges,false);
});
test('only two actually sent forecasts get pre-send depth; no user-text changes',async()=>{
 const notices=[],seen=[];
 const captured=makeV110DepthSnapshot(book,'BTCUSDT',NOW-250);
 const result=await runForecastNotifications({
  env,now:NOW,clock:()=>NOW,
  symbols:['BTCUSDT','XRPUSDT','ETHUSDT'],
  reader:async symbol=>fixture(symbol),
  fetchImpl:async()=>({ok:true,text:async()=>''}),
  depthCapture:async symbol=>{seen.push(symbol);return captured},
  publish:async(topic,item)=>{notices.push({topic,...item});return true}
 });
 assert.equal(result.delivered,2);
 assert.equal(result.depthCaptured,2);
 assert.equal(seen.length,2);
 assert.equal(notices.length,2);
 assert.ok(notices.every(n=>n.topic===forecastTopic(env)&&
  n.message.includes('НЕ сигнал входа')&&
  n.click.startsWith('https://weex-radar.vercel.app/forecast.html#v110d=')));
 const row=notices[0],sentAt=NOW;
 const parsed=parsePublishedForecast({event:'message',topic:row.topic,
  sequence_id:row.sequenceId,time:Math.floor(sentAt/1000),
  title:row.title,message:row.message,click:row.click},
  forecastTopic(env),NOW+10000,env);
 assert.ok(parsed);
 assert.equal(parsed.depthShadow.p,captured.p);
 assert.equal(parsed.direction,'LONG');
});
test('journal keeps real sent-time depth when later WEEX candle recovery has none',()=>{
 const original=archiveForecast(4,NOW-2*3600000,
  makeV110DepthSnapshot(book,'BTCUSDT',NOW-2*3600000-450));
 const first=mergeForecastArchive([], [original], NOW);
 assert.equal(first.added,1);
 assert.deepEqual(first.rows[0].depthShadow,original.depthShadow);
 const later={...original,depthShadow:null};
 const second=mergeForecastArchive(first.rows,[later],NOW);
 assert.deepEqual(second.rows[0].depthShadow,original.depthShadow);
 assert.equal(second.changed,false);
 const normalized=normalizeForecastArchiveRow(first.rows[0],NOW);
 assert.deepEqual(normalized.depthShadow,original.depthShadow);
});
test('NO old forecast is retroactively stamped with current order book',()=>{
 const valid=makeV110DepthSnapshot(book,'BTCUSDT',NOW-500);
 const old=archiveForecast(8,NOW-3*3600000,valid);
 assert.equal(normalizeForecastArchiveRow(old,NOW).depthShadow,null);
 const report=evaluateV110DepthStudy([old],NOW);
 assert.equal(report.status,'INSUFFICIENT_PAIRED_DEPTH');
 assert.equal(report.eligible,0);
 assert.equal(report.recommendation,'KEEP_108');
 assert.equal(report.ordersSent,0);
});
test('new depth study waits for actual 3+2-day paired data, never auto-tunes trading',()=>{
 const single=archiveForecast(1,NOW-2*3600000,
  makeV110DepthSnapshot(book,'BTCUSDT',NOW-2*3600000-450));
 const r=evaluateV110DepthStudy([single],NOW);
 assert.equal(r.status,'INSUFFICIENT_PAIRED_DEPTH');
 assert.equal(r.paired,1);
 assert.equal(r.eligible,1);
 assert.equal(r.liveChanges,0);
 const src=readFileSync(new URL('../lib/v110-depth-study.mjs',import.meta.url),'utf8');
 for(const forbidden of ['placeOrder(', 'fetch(', 'publishNtfy(',
  'trade-confirm','PUSH_CRON_KEY','NTFY_TOPIC']){
  assert.ok(!src.includes(forbidden),'must not appear: '+forbidden);
 }
 const api=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(api,/mode==='journal'/);
});
