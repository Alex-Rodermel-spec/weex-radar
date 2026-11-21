import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateNewsForecastJoin,handleNewsForecastJoin,NEWS_FORECAST_JOIN_POLICY as P}
 from '../lib/v110-news-forecast-study.mjs';

const MIN=60000,now=Date.UTC(2026,10,21,7,30,0);
const pub=Date.UTC(2026,10,21,6,0,0);
const iso=t=>new Date(t).toISOString();
const annotation=(mods={})=>'NEWS_RADAR_V110_EVENT '+JSON.stringify({
 eventId:'FED_20261121_r01',category:'FED',
 publishedAt:iso(pub),detectedAt:iso(pub+MIN),
 sourceUrl:'https://www.federalreserve.gov/newsevents/pressreleases/example.htm',
 primaryTimeVerified:true,planned:false,
 marketImpact:'NEGATIVE',impactAssets:['BTC','XRP'],
 ...mods
});
const comment=(changes={},posted=pub+2*MIN)=>({
 created_at:iso(posted),body:annotation(changes)
});
function forecast(id,symbol='BTCUSDT',sentAt=pub+3*MIN,move=15){
 return {id:id.repeat(32),symbol,sentAt,direction:'SHORT',
  windows:{5:{status:'OBSERVED',moveBps:move},
   15:{status:'OBSERVED',moveBps:move}}};
}
test('verified, timely, PUBLIC comment before notification joins observed 5m forecasts only',()=>{
 const r=evaluateNewsForecastJoin([comment()],[
  forecast('a'),forecast('b','XRPUSDT',pub+4*MIN,-5),
  forecast('c','BTCUSDT',pub-50*MIN,12),
  forecast('d','XAUTUSDT',pub+5*MIN,200)
 ],now);
 assert.equal(r.structuredEligibleNewsEvents,1);
 assert.equal(r.newsEventsWithPostCommentForecast,1);
 assert.equal(r.eventLinkedForecasts,2);
 assert.equal(r.eventLinkedAt5m.observed,2);
 assert.equal(r.eventLinkedAt5m.favorable,1);
 assert.equal(r.eventLinkedAt5m.adverse,1);
 assert.equal(r.eventLinkedAt5m.favorablePct,null);
 assert.equal(r.byAsset.BTC.alerts,1);
 assert.equal(r.byAsset.XRP.alerts,1);
 assert.equal(r.byAsset.GOLD_PROXY.alerts,0);
 assert.equal(r.status,'INSUFFICIENT_PRE_EVENT_PROOF');
 assert.equal(r.newsChangesPrediction,false);
 assert.equal(r.ordersSent,0);
});
test('publication after forecast cannot be retroactively called known pre-notice news',()=>{
 const lateComment=comment({},pub+10*MIN);
 const r=evaluateNewsForecastJoin([lateComment],[forecast('a')],now);
 assert.equal(r.structuredEligibleNewsEvents,1);
 assert.equal(r.eventLinkedForecasts,0);
 assert.equal(r.newsEventsWithPostCommentForecast,0);
 assert.equal(r.eventLinkedAt5m.observed,0);
});
test('planned, late, unverified, untagged, invalid original-time and incomplete comments stay unassociated',()=>{
 const invalid=[
  comment({planned:true}),
  comment({primaryTimeVerified:false}),
  comment({detectedAt:iso(pub+9*MIN)}),
  comment({impactAssets:[]}),
  comment({marketImpact:'UNKNOWN'}),
  {body:annotation(),created_at:null},
  comment({sourceUrl:'https://phishing.example/scam'})
 ];
 const r=evaluateNewsForecastJoin(invalid,[forecast('a')],now);
 assert.equal(r.structuredEligibleNewsEvents,0);
 assert.equal(r.eventLinkedForecasts,0);
 assert.equal(r.status,'INSUFFICIENT_PRE_EVENT_PROOF');
});
test('missing WEEX outcome, duplicated notification and overlapping event do not count wins',()=>{
 const missing={...forecast('a'),
  windows:{5:{status:'PENDING',moveBps:null}}};
 const c1=comment(),c2=comment({eventId:'FED_20261121_r02'},pub+2*MIN);
 const r=evaluateNewsForecastJoin([c1,c2],[missing,missing],now);
 assert.equal(r.structuredEligibleNewsEvents,2);
 assert.equal(r.eventLinkedForecasts,1);
 assert.equal(r.eventLinkedAt5m.observed,0);
 assert.equal(r.eventLinkedAt5m.missing,1);
 assert.equal(r.byAsset.BTC.at5m.favorable,0);
});
test('gold context uses only XAUTUSDT proxy, never asserts spot XAUUSD',()=>{
 const r=evaluateNewsForecastJoin([
  comment({impactAssets:['GOLD']})
 ],[forecast('a','XAUTUSDT'),forecast('b','BTCUSDT',pub+4*MIN)],now);
 assert.equal(r.byAsset.GOLD_PROXY.alerts,1);
 assert.equal(r.byAsset.BTC.alerts,0);
 assert.match(r.warning,/NOT spot XAUUSD/);
});
test('read-only endpoint reports aggregate only and fails closed on source errors',async()=>{
 const res={statusCode:0,payload:null,header:{},setHeader(k,v){this.header[k]=v},
  status(n){this.statusCode=n;return this},
  json(body){this.payload=body;return this}};
 const opts={now,
  archiveReader:async()=>({forecastRows:[forecast('a')]}),
  fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify([comment()])})};
 await handleNewsForecastJoin({method:'POST'},res,opts);
 assert.equal(res.statusCode,405);
 await handleNewsForecastJoin({method:'GET'},res,opts);
 assert.equal(res.statusCode,200);
 assert.equal(res.payload.eventLinkedForecasts,1);
 assert.equal(JSON.stringify(res.payload).includes('FED_20261121_r01'),false);
 assert.equal(JSON.stringify(res.payload).includes('a'.repeat(32)),false);
 assert.equal(res.payload.recommendation,'KEEP_108_AND_KEEP_V4');
 await handleNewsForecastJoin({method:'GET'},res,{
  ...opts,archiveReader:async()=>{throw Error('secret access failure')}
 });
 assert.equal(res.statusCode,503);
 assert.equal(res.payload.ordersSent,0);
});
test('strictly isolated from live ntfy, WEEX trade, cron, billing, and predictor training',()=>{
 const api=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const impl=readFileSync(new URL('../lib/v110-news-forecast-study.mjs',import.meta.url),'utf8');
 const sender=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 const dispatcher=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.match(api,/mode==='v110-news-forecast'/);
 for(const forbidden of [/placeOrder/,/trade-confirm/,/WEEX_API_SECRET/,
  /@vercel\/blob/,/NTFY_TOPIC/,/ntfy\.sh/,/model\.fit\(/])
  assert.doesNotMatch(impl,forbidden);
 assert.doesNotMatch(sender,/v110-news-forecast-study/);
 assert.doesNotMatch(dispatcher,/v110-news-forecast-study/);
 assert.equal(P.noLive108Changes,true);
 assert.equal(P.noLiveForecastChanges,true);
 assert.equal(P.noNewCron,true);
 assert.equal(P.noTradingOrders,true);
 assert.equal(P.noAutomaticPromotion,true);
});
