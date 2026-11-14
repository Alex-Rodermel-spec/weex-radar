import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeOneToFiveConflicts,ONE_TO_FIVE_SHADOW_POLICY as POLICY}
 from '../lib/v110-one-to-five-shadow.mjs';
import {runForecastNotifications} from '../lib/forecast-ntfy.mjs';
const now=Date.UTC(2026,10,14,15,0,30);
function snapshot(symbol,oneBias,fiveBias,body){
 const t=[1,5,10].map((m,i)=>({
  intervalMinutes:m,direction:i===0?oneBias:fiveBias,
  lastCandleBody:i===0?body:'UP',closedAt:now-(i?300000:30000),
  rsi14:50,relativeVolume:1.2,atr14:1,price:100,voteAgreement:2
 }));
 return {available:true,exchange:'WEEX',symbol,
  mode:'STANDALONE_WEEX_FORECAST_1_5_10',notTrade:true,ordersSent:0,
  signalPermission:false,timeframes:t,alignment:'MIXED_OR_CONFLICT',
  combinedDirection:'MIXED'};
}
test('red minute inside bullish five and opposite indicator bias are different phenomena',()=>{
 const data=[
  snapshot('BTCUSDT','LONG_BIAS','LONG_BIAS','DOWN'), // red BODY, same bias
  snapshot('XRPUSDT','SHORT_BIAS','LONG_BIAS','DOWN'), // red BODY, opposite bias
  snapshot('ETHUSDT','LONG_BIAS','SHORT_BIAS','UP'),  // green BODY, opposite bias
  snapshot('DOGEUSDT','NEUTRAL','LONG_BIAS','UP'),
  snapshot('SOLUSDT','NEUTRAL','NEUTRAL','DOWN')
 ];
 const r=summarizeOneToFiveConflicts(data);
 assert.equal(r.scannedSnapshots,5);
 assert.equal(r.usable,4);
 assert.equal(r.redOneMinuteInsideFiveLong,2);
 assert.equal(r.greenOneMinuteInsideFiveShort,1);
 assert.equal(r.bodyOpposesFiveBias,3);
 assert.equal(r.biasOpposesFiveBias,2);
 assert.equal(r.oneBiasShortFiveLong,1);
 assert.equal(r.oneBiasLongFiveShort,1);
 assert.equal(r.unknownOrNeutralFive,1);
 assert.equal(r.outcomesMeasured,false);
 assert.equal(r.ordersSent,0);
 assert.equal(POLICY.noNewExchangeRequests,true);
});
test('missing body and malformed frames never count as a winning or conflicting candle',()=>{
 const missing=snapshot('BTCUSDT','LONG_BIAS','SHORT_BIAS',null);
 const r=summarizeOneToFiveConflicts([missing,null,
  {...missing,timeframes:[]},{...missing,exchange:'Bybit'}]);
 assert.equal(r.usable,1);
 assert.equal(r.closed1mBodyUnknown,1);
 assert.equal(r.bodyOpposesFiveBias,0);
 assert.equal(r.biasOpposesFiveBias,1);
 assert.equal(r.unknownOrNeutralFive,3);
 assert.equal(summarizeOneToFiveConflicts(null).usable,0);
});
test('existing ntfy scanner audits non-delivered conflicting 1m/5m while sending nothing',async()=>{
 const seen=[],symbols=['BTCUSDT','ETHUSDT','XRPUSDT'];
 const fixtures={
  BTCUSDT:snapshot('BTCUSDT','SHORT_BIAS','LONG_BIAS','DOWN'),
  ETHUSDT:snapshot('ETHUSDT','LONG_BIAS','SHORT_BIAS','UP'),
  XRPUSDT:snapshot('XRPUSDT','NEUTRAL','LONG_BIAS','DOWN')
 };
 const r=await runForecastNotifications({
  env:{NTFY_TOPIC:'wr-'+('z'.repeat(32))},now,
  symbols,reader:async s=>{seen.push(s);return fixtures[s]},
  fetchImpl:async()=>({ok:true,text:async()=>''}),
  publish:async()=>{throw Error('UNEXPECTED_ALERT')}
 });
 assert.equal(r.scanned,3);
 assert.equal(r.eligible,0);
 assert.equal(r.delivered,0);
 assert.equal(r.oneToFiveResearch.redOneMinuteInsideFiveLong,2);
 assert.equal(r.oneToFiveResearch.greenOneMinuteInsideFiveShort,1);
 assert.equal(r.oneToFiveResearch.biasOpposesFiveBias,2);
 assert.equal(seen.length,3);
});
test('no new polling endpoint, cron, trading, paid API or private alert topic leaks',()=>{
 const research=readFileSync(new URL('../lib/v110-one-to-five-shadow.mjs',import.meta.url),'utf8');
 const scan=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 const standalone=readFileSync(new URL('../lib/standalone-forecast.mjs',import.meta.url),'utf8');
 assert.match(scan,/researchObservations\.push\(d\)/);
 assert.match(scan,/summarizeOneToFiveConflicts\(researchObservations\)/);
 assert.match(standalone,/lastCandleBody:/);
 for(const term of ['fetch(', 'NTFY_TOPIC','process.env','placeOrder','trade-confirm',
  'crypto.exchange','WEEX_API_KEY','api-contract.weex.com','ntfy.sh']){
  assert.ok(!research.includes(term),term);
 }
});
