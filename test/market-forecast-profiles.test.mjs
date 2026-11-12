import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {marketForecastProfile,profileSymbols,adaptiveForecastThresholds,
 MARKET_PROFILE_PROTOCOL} from '../lib/market-forecast-profiles.mjs';
import {forecastShortPreMove,forecastDeliveryDecision}
 from '../lib/forecast-arrival-safeguard.mjs';
import {_test as sourceMarkets} from '../api/signals.mjs';
import {buildStandaloneForecast,completedForecastBars}
 from '../lib/standalone-forecast.mjs';

const MIN=60000,NOW=Date.UTC(2026,10,12,13,10,30);
const CLOSE=Math.floor(NOW/MIN)*MIN;
function make1m(unitBps=3){
 let last=100;
 return Array.from({length:125},(_,i)=>{
  // Before the test move, the market alternates fairly around its level.
  if(i>0)last*=1+(i%2===0?1:-1)*unitBps/10000;
  return {closeTime:CLOSE-(124-i)*MIN,close:last};
 });
}
function indicator(bars,direction='LONG_BIAS'){
 return {combinedDirection:direction,timeframes:[{
  closedAt:CLOSE,price:Number(bars.at(-1).close.toFixed(8))}]};
}
test('all and only the 32 forecast markets get exactly one regime',()=>{
 const expected=[...sourceMarkets.FORECAST_SYMBOLS].sort();
 const actual=profileSymbols().sort();
 assert.deepEqual(actual,expected);
 assert.equal(new Set(actual).size,32);
 const groups=new Set(actual.map(x=>marketForecastProfile(x).group));
 assert.equal(groups.size,6);
 assert.equal(marketForecastProfile('BTCUSDT').group,'MAJOR_CRYPTO');
 assert.equal(marketForecastProfile('1000PEPEUSDT').group,'MEME_CRYPTO');
 assert.equal(marketForecastProfile('XAUUSDT').group,'METALS');
 assert.equal(marketForecastProfile('XAUTUSDT').group,'METALS');
 assert.equal(marketForecastProfile('EURUSDT').group,'FX_DERIVED');
 assert.equal(marketForecastProfile('NVDAUSDT').group,'EQUITY_DERIVED');
 assert.equal(marketForecastProfile('XRPUSDT').group,'ALT_CRYPTO');
 assert.equal(marketForecastProfile('FAKEUSDT'),null);
});
test('different market classes respond differently to the same 1m move',()=>{
 // 60 older minute closes fluctuate 3bps; latest candle jumps +8bps.
 const rows=make1m(3);
 rows[124]={...rows[124],close:rows[123].close*1.0008};
 const fx=forecastShortPreMove(indicator(rows),rows,'EURUSDT');
 const meme=forecastShortPreMove(indicator(rows),rows,'1000PEPEUSDT');
 assert.equal(fx.sampleReady,true);assert.equal(meme.sampleReady,true);
 assert.equal(fx.adaptiveReady,true);assert.equal(meme.adaptiveReady,true);
 assert.equal(fx.preMove1mBps,8);assert.equal(meme.preMove1mBps,8);
 assert.ok(fx.threshold1mBps<meme.threshold1mBps);
 assert.equal(fx.lateRisk,true);
 assert.equal(meme.lateRisk,false);
 assert.equal(fx.assetProfile.group,'FX_DERIVED');
 assert.equal(meme.assetProfile.group,'MEME_CRYPTO');
 assert.equal(fx.legacyLateRisk,false);
 assert.equal(meme.legacyLateRisk,false);
});
test('same crypto: dynamically higher 1m threshold during volatile regime',()=>{
 const quiet=make1m(1.5),volatile=make1m(9);
 const calm=adaptiveForecastThresholds('BTCUSDT',quiet,CLOSE);
 const storm=adaptiveForecastThresholds('BTCUSDT',volatile,CLOSE);
 assert.ok(calm&&storm);
 assert.ok(storm.threshold1mBps>calm.threshold1mBps);
 assert.ok(storm.threshold3mBps>calm.threshold3mBps);
 assert.equal(calm.returnsLookback,60);
 assert.ok(storm.referenceEndsAt<=CLOSE-4*MIN);
 assert.ok(storm.threshold1mBps<=25);
 assert.ok(storm.threshold3mBps<=40);
});
test('change in last 3m burst cannot change the 60m comparison baseline',()=>{
 const normal=make1m(4),jump=normal.map(x=>({...x}));
 for(let k=122;k<125;k++)jump[k].close*=1.03;
 const a=adaptiveForecastThresholds('XAUUSDT',normal,CLOSE);
 const b=adaptiveForecastThresholds('XAUUSDT',jump,CLOSE);
 assert.equal(a.threshold1mBps,b.threshold1mBps);
 assert.equal(a.threshold3mBps,b.threshold3mBps);
 assert.equal(a.median1mAbsReturnBps,b.median1mAbsReturnBps);
});
test('stale/gapped lookback never masquerades as successful adaptive check',()=>{
 const normal=make1m(4);
 assert.equal(adaptiveForecastThresholds('BTCUSDT',normal.slice(-50),CLOSE),null);
 const gap=normal.map(x=>({...x}));gap[75].closeTime+=2000;
 assert.equal(adaptiveForecastThresholds('BTCUSDT',gap,CLOSE),null);
 const future=normal.map(x=>({...x}));future[120].closeTime+=1000;
 assert.equal(adaptiveForecastThresholds('BTCUSDT',future,CLOSE),null);
 const fallback=forecastShortPreMove(indicator(gap),gap,'BTCUSDT');
 assert.equal(fallback.adaptiveReady,false);
 assert.equal(fallback.threshold1mBps,10);
 assert.equal(fallback.threshold3mBps,10);
 assert.equal(fallback.sampleReady,true); // latest four still complete
});
test('V2 late review still suppresses regardless of market profile',()=>{
 const rows=make1m(2);
 const m=forecastShortPreMove(indicator(rows),rows,'BTCUSDT');
 assert.equal(m.adaptiveReady,true);
 const payload={arrivalTiming:m,strengthRisk:{level:'STRONG'},
  strongV2Review:{sampleReady:true,status:'REVIEW_DOWNGRADE',
   baselineLevel:'STRONG',proposedLevel:'STANDARD'}};
 assert.equal(forecastDeliveryDecision(payload).status,'SUPPRESS_LATE');
});
test('live 125 closed candles produce profile-specific info with ZERO extra calls',()=>{
 const make=(duration,ratio)=>{
  const end=Math.floor(NOW/duration)*duration;
  return Array.from({length:125},(_,i)=>{
   const p=100+0.065*i*ratio;
   return [end-(125-i)*duration,p-0.01,p+0.05,p-0.06,p,100+i%9];
  });
 };
 const one=completedForecastBars(make(MIN,1),MIN,NOW);
 const five=completedForecastBars(make(300000,1),300000,NOW);
 const a=buildStandaloneForecast(one,five,NOW,'BTCUSDT');
 const b=buildStandaloneForecast(one,five,NOW,'1000PEPEUSDT');
 assert.equal(a.available,true);assert.equal(b.available,true);
 assert.equal(a.arrivalTiming.assetProfile.group,'MAJOR_CRYPTO');
 assert.equal(b.arrivalTiming.assetProfile.group,'MEME_CRYPTO');
 assert.equal(a.arrivalTiming.adaptiveReady,true);
 assert.equal(b.arrivalTiming.adaptiveReady,true);
 assert.equal(a.ordersSent,0);assert.equal(b.ordersSent,0);
 assert.equal(a.signalPermission,false);assert.equal(b.signalPermission,false);
});
test('adaptive profile module remains data-only, no orders, secrets, network or paid providers',()=>{
 const content=readFileSync(new URL('../lib/market-forecast-profiles.mjs',import.meta.url),'utf8');
 const safeguard=readFileSync(new URL('../lib/forecast-arrival-safeguard.mjs',import.meta.url),'utf8');
 for(const pattern of [/fetch\(/,/process\.env/,/placeOrder/,/ntfySend/,
  /trade-confirm/,/cron-job/,/API_SECRET/,/setTimeout\(/])
  assert.doesNotMatch(content+ '\n' +safeguard,pattern);
 assert.equal(MARKET_PROFILE_PROTOCOL.extraWEEXQueries,0);
 assert.equal(MARKET_PROFILE_PROTOCOL.noOrders,true);
});
