import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {evaluateTrapRisk} from '../lib/trap-risk.mjs';
import {formatPhoneAlert} from '../lib/alert-presentation.mjs';
import {parseConfirmedNotification} from '../lib/signal-quality.mjs';
const STEP=300000;
function bars(n=64){
 return Array.from({length:n},(_,i)=>({time:i*STEP,closeTime:(i+1)*STEP,
  open:100,close:100,high:100.2,low:99.8,volume:100}));
}
function sweep(dir){
 const rows=bars(),last=rows.at(-1);
 if(dir==='LONG')Object.assign(last,{high:100.65,low:99.7,close:99.79});
 else Object.assign(last,{high:100.3,low:99.35,close:100.21});
 return rows;
}
function failedBreak(dir){
 const rows=bars(),first=rows.at(-2),next=rows.at(-1);
 if(dir==='LONG'){
  Object.assign(first,{open:100.1,close:100.42,high:100.6,low:100.0});
  Object.assign(next,{open:100.1,close:99.9,high:100.2,low:99.75});
 }else{
  Object.assign(first,{open:99.9,close:99.55,high:100.0,low:99.45});
  Object.assign(next,{open:99.9,close:100.1,high:100.25,low:99.8});
 }
 return rows;
}
test('detect closed-candle sweeps above highs and below lows symmetrically',()=>{
 const top=evaluateTrapRisk(sweep('LONG'),0.3);
 const bottom=evaluateTrapRisk(sweep('SHORT'),0.3);
 assert.equal(top.mode,'SHADOW_TRAPS');
 assert.equal(top.byDirection.LONG.kind,'HIGH_SWEEP');
 assert.equal(top.byDirection.LONG.ageBars,0);
 assert.equal(bottom.byDirection.SHORT.kind,'LOW_SWEEP');
 assert.equal(bottom.byDirection.SHORT.ageBars,0);
 assert.equal(top.byDirection.SHORT,null);
 assert.equal(bottom.byDirection.LONG,null);
});
test('distinguish completed bull and bear traps using a later closed candle',()=>{
 const bull=evaluateTrapRisk(failedBreak('LONG'),0.3);
 const bear=evaluateTrapRisk(failedBreak('SHORT'),0.3);
 assert.equal(bull.byDirection.LONG.kind,'BULL_TRAP');
 assert.equal(bull.byDirection.LONG.failedWithinBars,1);
 assert.equal(bear.byDirection.SHORT.kind,'BEAR_TRAP');
 assert.equal(bear.byDirection.SHORT.failedWithinBars,1);
});
test('long wicks without a breached previous level are NOT labelled as hunts',()=>{
 const clean=bars();
 const c=clean.at(-1);
 Object.assign(c,{high:100.19,low:99.8,open:99.9,close:99.81});
 const result=evaluateTrapRisk(clean,0.3);
 assert.deepEqual(result.recent,[]);
 assert.equal(result.byDirection.LONG,null);
});
test('invalid, incomplete or insufficient candle history is unavailable, not safe',()=>{
 assert.equal(evaluateTrapRisk(bars(12),0.3).available,false);
 assert.equal(evaluateTrapRisk(bars(),0).available,false);
 const bad=bars();bad.at(-1).high=99;
 assert.equal(evaluateTrapRisk(bad,0.3).available,false);
});
test('warnings expire after two completed 5m bars',()=>{
 const c=sweep('LONG');
 const additional=Array.from({length:3},(_,i)=>({
  ...bars(1)[0],time:(64+i)*STEP,closeTime:(65+i)*STEP
 }));
 const result=evaluateTrapRisk([...c,...additional],0.3);
 assert.equal(result.byDirection.LONG,null);
});
test('ntfy adds explicit shadow caution without altering raw TP SL levels',()=>{
 const signal={symbol:'HYPEUSDT',exchange:'WEEX',direction:'LONG',
  level:'NORMAL',livePrice:100,stop:99,take:102,
  trapReview:{byDirection:{LONG:{kind:'BULL_TRAP',ageBars:1}}}};
 const preview=formatPhoneAlert(signal);
 assert.equal(preview.status,'FORECAST');
 assert.doesNotMatch(preview.message,/SL 99 · TP 102/);
 assert.equal(parseConfirmedNotification({event:'message',time:1794000000,
  title:preview.title,message:preview.message}),null);
 const msg=formatPhoneAlert({...signal,advisor:{status:'REVIEW'},
  entryQuality:{ok:true},costReview:{status:'PASS_ESTIMATE',netRR:1.6}});
 assert.equal(msg.status,'CHECK');
 assert.match(msg.message,/SL 99 · TP 102/);
 assert.doesNotMatch(msg.message,/ТЕСТ ЛОВУШКИ/);
 const parsed=parseConfirmedNotification({event:'message',time:1794000000,
  title:msg.title,message:msg.message});
 assert.ok(parsed);
 assert.equal(parsed.symbol,'HYPEUSDT');
 assert.equal(parsed.stop,99);
 assert.equal(parsed.take,102);
});
test('research module never places orders, blocks signal, or changes 1m watch',()=>{
 const radar=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-watch.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const traps=readFileSync(new URL('../lib/trap-risk.mjs',import.meta.url),'utf8');
 const web=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(radar,/const trapReview=evaluateTrapRisk\(five,volatility\)/);
 assert.match(radar,/sidewaysGate,retest,levelReview,shadowIndicators:contextOnly,trapReview/);
 assert.match(radar,/const tentative=candidate&&quality\.ok&&priceQuality\.ok&&entryQuality\?\.ok&&/);
 assert.doesNotMatch(traps,/fetch\(|placeOrder|WEEX_API_SECRET|trade-confirm|@vercel\/blob/);
 assert.doesNotMatch(early,/evaluateTrapRisk|trapReview/);
 assert.doesNotMatch(dispatch,/evaluateTrapRisk|trapReview/);
 assert.match(web,/ТЕСТ ЛОВУШКИ/);
 const script=web.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
});
