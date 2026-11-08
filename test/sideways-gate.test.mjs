import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkSidewaysEntry,MAX_WEAK_BREAKOUT_ATR,MIN_CONVINCING_VOLUME_RATIO}
 from '../lib/sideways-gate.mjs';
import {evaluateStructure} from '../lib/market-structure.mjs';

// 64 fully completed and direction-neutral candles, with a narrow prior range.
function sidewaysCandles(direction='LONG'){
 const a=Array.from({length:64},(_,i)=>{
  const close=100+((i%2)?0.01:-0.01);
  return {time:1_000_000+i*300_000,closeTime:1_000_000+(i+1)*300_000,
   open:close,high:close+.10,low:close-.10,volume:100};
 });
 const last=a.at(-1);
 // A genuinely closed break just beyond the historical 12-candle boundary.
 if(direction==='LONG'){
  last.open=100.05;last.low=100.04;last.high=100.20;last.close=100.135;
 }else{
  last.open=99.95;last.high=99.96;last.low=99.80;last.close=99.865;
 }
 last.volume=100;
 return a;
}
test('narrow flat with weak breakout and normal volume skips 5m entry for LONG and SHORT',()=>{
 for(const direction of ['LONG','SHORT']){
  const observed=evaluateStructure(sidewaysCandles(direction),0.25,direction);
  assert.equal(observed.flat,true);
  assert.ok(observed.breakoutAtr>0&&observed.breakoutAtr<MAX_WEAK_BREAKOUT_ATR);
  const result=checkSidewaysEntry(observed);
  assert.equal(result.evaluated,true);
  assert.equal(result.blocked,true);
  assert.match(result.reason,/Боковик.+вход пропущен/);
 }
});
test('strong volume confirms breakout and leaves otherwise identical flat breakout active',()=>{
 for(const direction of ['LONG','SHORT']){
  const candles=sidewaysCandles(direction);
  candles.at(-1).volume=200;
  const observed=evaluateStructure(candles,0.25,direction);
  assert.equal(observed.flat,true);
  assert.ok(observed.context.volumeRatio>MIN_CONVINCING_VOLUME_RATIO);
  assert.equal(checkSidewaysEntry(observed).blocked,false);
 }
});
test('wide directional market and strong close are not incorrectly blocked',()=>{
 const wide=Array.from({length:64},(_,i)=>{
  const close=98+i*.1;
  return {time:i*300_000,closeTime:(i+1)*300_000,
   open:close,close,high:close+.15,low:close-.15,volume:100};
 });
 const normal=evaluateStructure(wide,.25,'LONG');
 assert.equal(normal.flat,false);
 assert.equal(checkSidewaysEntry(normal).blocked,false);
 const largeBreak=evaluateStructure(sidewaysCandles('LONG'),.15,'LONG');
 assert.equal(checkSidewaysEntry({
  ...largeBreak,flat:true,breakoutAtr:0.7,context:{volumeRatio:1.0}
 }).blocked,false);
});
test('a valid retest exempts flat from suppression and unrelated shadow warning is independent',()=>{
 const obs={mode:'SHADOW',flat:true,retestConfirmed:true,
  breakoutAtr:0.12,context:{volumeRatio:0.8},warning:true,
  reasons:['Недавний ложный пробой этого направления']};
 assert.equal(checkSidewaysEntry(obs).blocked,false);
 assert.equal(checkSidewaysEntry({...obs,retestConfirmed:false}).blocked,true);
 assert.equal(checkSidewaysEntry({...obs,flat:false,retestConfirmed:false}).blocked,false);
});
test('ambiguous or absent structure does not fabricate a rejection',()=>{
 for(const item of [undefined,null,{}, {mode:'SHADOW'},{
  mode:'SHADOW',flat:true,breakoutAtr:NaN,context:{volumeRatio:1.0}
 }]){
  assert.equal(checkSidewaysEntry(item).blocked,false);
 }
});
test('ONLY confirmed 5m gates are modified; 1m EARLY WATCH, 15m trend, risk and ntfy unchanged',()=>{
 const main=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-watch.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 assert.match(main,/checkSidewaysEntry\(shadowFilter\)/);
 assert.match(main,/entryQuality\?\.ok&&\s*!sidewaysGate\?\.blocked\?candidate:null/);
 assert.match(main,/sidewaysGate\?\.blocked\?sidewaysGate\.reason/);
 assert.match(main,/checkConfirmedEntry\(candidate,last.close,livePrice,volatility,five\)/);
 assert.doesNotMatch(early,/checkSidewaysEntry|sidewaysGate/);
 assert.doesNotMatch(dispatch,/checkSidewaysEntry|sidewaysGate/);
 assert.doesNotMatch(ntfy,/checkSidewaysEntry|sidewaysGate/);
 assert.doesNotMatch(main,/\/capi\/v3\/order|trade-confirm/);
});
