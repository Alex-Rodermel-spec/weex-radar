import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {evaluateLevelReview,LEVEL_MODE} from '../lib/level-review.mjs';
import {adviseSymbol} from '../lib/advisor.mjs';

const NOW=Date.UTC(2026,10,9,11,30,0);
function candles(n=28){
 return Array.from({length:n},(_,i)=>({
  time:NOW-(n-i)*300000,closeTime:NOW-(n-i-1)*300000,
  open:100,high:102,low:98,close:100,volume:100
 }));
}
function withLast(update){const rows=candles();Object.assign(rows.at(-1),update);return rows}
function signal(direction='LONG'){
 return {
  symbol:'XRPUSDT',status:'ok',exchange:'WEEX',direction,level:'STRONG',
  livePrice:100,expiresAt:NOW+90_000,stop:direction==='LONG'?98:102,
  take:direction==='LONG'?104:96,
  entryQuality:{ok:true,rr:2},
  costReview:{mode:'SHADOW_COSTS',status:'PASS_ESTIMATE',netRR:1.8},
  retest:{[direction]:{status:'CONFIRMED',trendAligned:true}}
 };
}

test('support and resistance use only 12 PREVIOUS closed 5m candles',()=>{
 const l=evaluateLevelReview(withLast({open:101,high:103.4,low:100.8,close:103.2,volume:180}),1);
 assert.equal(l.mode,LEVEL_MODE);
 assert.equal(l.resistance,102);assert.equal(l.support,98);
 assert.equal(l.candleState,'BREAK_UP');
 assert.equal(l.breakoutDirection,'LONG');
 assert.equal(l.closeQuality,'SUPPORTED');
 assert.equal(l.lookback,12);
 assert.equal(l.volumeRatio,1.8);
 assert.equal(l.candleCloseTime,NOW);
 const bearish=evaluateLevelReview(withLast({open:99,high:99.2,low:96.7,close:96.9,volume:180}),1);
 assert.equal(bearish.candleState,'BREAK_DOWN');
 assert.equal(bearish.breakoutDirection,'SHORT');
 assert.equal(bearish.closeQuality,'SUPPORTED');
});

test('wick through level with close back in range is NOT a breakout',()=>{
 const up=evaluateLevelReview(withLast({open:101,high:104,low:99,close:100,volume:160}),1);
 assert.equal(up.candleState,'FAKE_UP');
 assert.equal(up.breakoutDirection,null);
 const down=evaluateLevelReview(withLast({open:99,high:101,low:96,close:100,volume:180}),1);
 assert.equal(down.candleState,'FAKE_DOWN');
 assert.equal(down.breakoutDirection,null);
 const range=evaluateLevelReview(candles(),1);
 assert.equal(range.candleState,'INSIDE_RANGE');
 const weak=evaluateLevelReview(withLast({open:102.2,high:103,low:101.5,close:102.8,volume:50}),1);
 assert.equal(weak.candleState,'BREAK_UP');
 assert.equal(weak.closeQuality,'WEAK');
});

test('recent fakeouts are symmetric and never rely on future candles',()=>{
 const rows=candles();
 Object.assign(rows.at(-2),{open:101,high:104,low:99,close:100});
 Object.assign(rows.at(-1),{open:102,high:103.8,low:101,close:103.4,volume:170});
 const result=evaluateLevelReview(rows,1);
 assert.equal(result.recentFakeouts.LONG.barsAgo,1);
 assert.equal(result.recentFakeouts.LONG.level,102);
 assert.equal(result.recentFakeouts.SHORT,null);
 assert.equal(result.candleState,'BREAK_UP');
 const adviser=adviseSymbol({...signal('LONG'),levelReview:result},NOW);
 assert.equal(adviser.status,'WAIT');
 assert.match(adviser.reason,/ложный пробой/);
 assert.equal(adviseSymbol({...signal('SHORT'),levelReview:result},NOW).status,'REVIEW');
 const twoCandlesAgo=candles();
 Object.assign(twoCandlesAgo.at(-3),{open:99,high:101,low:96,close:100});
 assert.equal(evaluateLevelReview(twoCandlesAgo,1).recentFakeouts.SHORT.barsAgo,2);
});

test('invalid candles fail closed and never invent support/resistance',()=>{
 assert.equal(evaluateLevelReview([],1),null);
 assert.equal(evaluateLevelReview(candles(28),0),null);
 assert.equal(evaluateLevelReview(candles(28),NaN),null);
 const invalid=candles();invalid.at(-2).close=110;
 assert.equal(evaluateLevelReview(invalid,1),null);
 const unordered=candles();unordered.at(-1).time=unordered.at(-2).time;
 assert.equal(evaluateLevelReview(unordered,1),null);
});

test('no orders, extra endpoints or cron changes: all level analyses are read-only',()=>{
 const scanner=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const advisor=readFileSync(new URL('../lib/advisor.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../advisor.html',import.meta.url),'utf8');
 const module=readFileSync(new URL('../lib/level-review.mjs',import.meta.url),'utf8');
 assert.match(scanner,/const levelReview=evaluateLevelReview\(five,volatility\)/);
 assert.match(scanner,/sidewaysGate,retest,levelReview/);
 assert.match(advisor,/const recent=s\.levelReview\?\.recentFakeouts/);
 assert.match(page,/Уровни из предыдущих 12 закрытых свечей 5М/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);assert.doesNotThrow(()=>new Script(script[1],{filename:'advisor.html'}));
 for(const t of [advisor,module,page])assert.doesNotMatch(t,/\/trade-confirm|\/trade-prepare|@vercel\/blob|PUSH_CRON_KEY|NTFY_TOPIC/);
});
