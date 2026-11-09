import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {_test as radar} from '../api/signals.mjs';
import {
 normalizeBacktestCandles,replayHistory,simulatedFill,simulateOutcome,HOLD_BARS,
 FIVE_MINUTES,FIFTEEN_MINUTES
} from '../lib/strategy-backtest.mjs';
import {handleBacktest} from '../lib/backtest-route.mjs';

const NOW=Date.UTC(2026,10,8,17,0,0);
const candle=(time,open,high,low,close,volume=20)=>({
 time,closeTime:time+FIVE_MINUTES,open,high,low,close,volume
});
const c=(open,high,low,close)=>({open,high,low,close});
const future=(value)=>Array.from({length:HOLD_BARS},
 ()=>c(value,value+.1,value-.1,value));
test('cost model is symmetric for LONG/SHORT with worsening fills and fees',()=>{
 const long=simulatedFill('LONG',100,102,8,3,1);
 const short=simulatedFill('SHORT',100,98,8,3,1);
 assert.equal(long.grossR,2);
 assert.equal(short.grossR,2);
 assert.ok(long.netR<2);
 assert.ok(short.netR<2);
 assert.ok(long.netR>1.7);
 assert.ok(short.netR>1.7);
 const zero=simulatedFill('LONG',100,102,0,0,1);
 assert.equal(zero.netR,2);
 assert.throws(()=>simulatedFill('SHORT',100,98,-1,3,1));
});
test('first-candle TP/SL ordering is unknown, never count ambiguous as win',()=>{
 const both=future(100);
 both[0]=c(100,102.1,98.8,100.3);
 const row=simulateOutcome({direction:'LONG',entry:100,stop:99,take:102,future:both});
 assert.equal(row.status,'AMBIGUOUS');
 assert.equal(row.netR,null);
 const single=future(100);
 single[0]=c(100,102.2,99.1,101);
 const hit=simulateOutcome({direction:'LONG',entry:100,stop:99,take:102,future:single});
 assert.equal(hit.status,'TP');
 assert.ok(hit.netR<2);
 const stopped=future(100);
 stopped[0]=c(100,100.2,98.9,99.5);
 assert.equal(simulateOutcome({direction:'LONG',entry:100,stop:99,take:102,future:stopped}).status,'SL');
});
test('SHORT stop, gaps, and 60min timeout are modeled, no fake perfect stop fills',()=>{
 const short=future(100);
 short[1]=c(100,101.2,99.5,100.4);
 assert.equal(simulateOutcome({direction:'SHORT',entry:100,stop:101,take:98,future:short}).status,'SL');
 const gapped=future(100);
 gapped[0]=c(98,98.8,97.5,98);
 const result=simulateOutcome({direction:'LONG',entry:100,stop:99,take:102,future:gapped});
 assert.equal(result.status,'SL');
 assert.ok(result.netR < -1);
 const unchanged=simulateOutcome({direction:'LONG',entry:100,stop:99,take:102,future:future(100)});
 assert.equal(unchanged.status,'TIMEOUT');
 assert.ok(unchanged.netR < 0); // even a flat trade has costs
 assert.equal(simulateOutcome({direction:'LONG',entry:100,stop:99,take:102,future:[]}).status,'NO_DATA');
});
test('normalizer discards open future candle, duplicates and corrupt price rows',()=>{
 const rows=[
  [NOW-2*FIVE_MINUTES,'100','101','99','100.5','6'],
  [NOW-2*FIVE_MINUTES,100,101,99,100.5,6],
  [NOW-FIVE_MINUTES,102,103,101,102,6],
  [NOW,100,100,100,100,6],
  [NOW-3*FIVE_MINUTES,100,99,101,100,6],
  [NOW-4*FIVE_MINUTES,100,101,99,100,-1]
 ];
 const normalized=normalizeBacktestCandles(rows,'5m',NOW);
 assert.equal(normalized.length,1);
 assert.equal(normalized[0].time,NOW-2*FIVE_MINUTES);
 assert.throws(()=>normalizeBacktestCandles(rows,'4m',NOW));
});
test('closed 15m candles must not be borrowed from the future when replaying 5m',()=>{
 const t=NOW-110*FIFTEEN_MINUTES;
 const fifteen=Array.from({length:110},(_,i)=>{
  const open=100+i*0.14;
  return {time:t+i*FIFTEEN_MINUTES,
   closeTime:t+(i+1)*FIFTEEN_MINUTES,open,high:open+.3,
   low:open-.3,close:open+.1,volume:50};
 });
 const start=NOW-250*FIVE_MINUTES;
 let px=100;
 const five=Array.from({length:250},(_,i)=>{
  const open=px,delta=i%3===2?-.09:.12;
  px=Number((px+delta).toFixed(5));
  return candle(start+i*FIVE_MINUTES,open,
   Math.max(open,px)+.035,Math.min(open,px)-.035,px);
 });
 const v=replayHistory(five,fifteen,{feeBps:8,slippageBps:3});
 assert.equal(v.mode,'RESEARCH_SHADOW');
 assert.ok(v.evaluatedCandles>0);
 assert.ok(v.baseline.setups>=v.filtered.setups);
 assert.equal(typeof v.baseline.tpNetLoss,'number');
 assert.equal(typeof v.filtered.tpNetPositive,'number');
 assert.ok(v.rawCandidates>=v.filtered.setups);
 assert.equal(v.historicalEconomicStudy.total,v.filtered.setups);
 assert.equal(v.sensitivity.variants.CURRENT.minNetRR,1.5);
 assert.equal(v.sensitivity.variants.MODERATE.minNetRR,1.3);
 assert.equal(v.sensitivity.variants.MODERATE.takeAtr,3);
 assert.ok(v.sensitivity.variants.CURRENT.planEligible<=v.sensitivity.variants.CURRENT.netRRPass);
 assert.ok(v.sensitivity.variants.MODERATE.planEligible<=v.sensitivity.variants.MODERATE.netRRPass);
 assert.equal(v.sensitivity.variants.CURRENT.checked,v.rawCandidates-v.excludedEntryGap);
 assert.equal(v.historicalPullbackStudy.total,v.filtered.setups);
 assert.equal(v.historicalPullbackStudy.fillRate,null);
 assert.match(v.historicalEconomicStudy.disclaimer,/ZERO spread/);
 assert.equal(v.baseline.setups,v.directions.LONG.baseline.setups+v.directions.SHORT.baseline.setups);
 assert.match(v.assumptions.entry,/OPEN/);
});
test('historical mode does not change the production default active signal clock',()=>{
 assert.equal(radar.getAnalysis.length,2); // optional quote/time params are backwards compatible
 const source=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 assert.match(source,/referenceNow=Date\.now\(\)/);
 assert.match(source,/referenceNow<expiresAt/);
 assert.match(source,/mode==='backtest'/);
});
test('read-only route validates symbol and cost assumptions without external I/O',async()=>{
 const response={statusCode:0,payload:null,
  setHeader(){},status(code){this.statusCode=code;return this},
  json(value){this.payload=value;return this}};
 await handleBacktest({method:'POST',query:{},headers:{}},response,['BTCUSDT']);
 assert.equal(response.statusCode,405);
 await handleBacktest({method:'GET',query:{symbol:'ETHUSDT'},headers:{}},response,['BTCUSDT']);
 assert.equal(response.statusCode,400);
 await handleBacktest({method:'GET',query:{symbol:'BTCUSDT',feeBps:'999'},headers:{}},response,['BTCUSDT']);
 assert.equal(response.statusCode,400);
});
test('page and route never enable order execution, auto-training, or alters push code',()=>{
 const route=readFileSync(new URL('../lib/backtest-route.mjs',import.meta.url),'utf8');
 const core=readFileSync(new URL('../lib/strategy-backtest.mjs',import.meta.url),'utf8');
 const site=readFileSync(new URL('../backtest.html',import.meta.url),'utf8');
 const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(home,/href="\/backtest\.html"/);
 assert.match(site,/mode:'backtest'/);
 assert.doesNotMatch(route,/trade-prepare|trade-confirm|trade-release|NTFY_TOPIC|PUSH_CRON_KEY|TRADE_ENABLED/);
 assert.doesNotMatch(core,/trade-prepare|trade-confirm|trade-release|NTFY_TOPIC|PUSH_CRON_KEY|TRADE_ENABLED/);
 assert.match(site,/Историческая/); // informative research copy
 assert.doesNotThrow(()=>new Script(site.match(/<script>([\s\S]*?)<\/script>/)[1]));
});
