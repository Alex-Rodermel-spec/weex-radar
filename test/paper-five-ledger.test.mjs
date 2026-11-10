import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const page=readFileSync(new URL('../paper-five.html',import.meta.url),'utf8');
const match=page.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match,'Missing paper journal script');
function makeHarness(now=Date.UTC(2026,10,10,2,0,2)){
 const elements=new Map();
 const FakeDate=class extends Date{static now(){return now;}};
 const context=createContext({
  Date:FakeDate,
  document:{getElementById(id){
   if(!elements.has(id))elements.set(id,{onclick:null,disabled:false});
   return elements.get(id);
  }},
  localStorage:{getItem(){return null},setItem(){}},
  setTimeout(){return 1},clearTimeout(){},
  fetch(){throw Error('Unexpected network in unit test')},
  console
 });
 const code=match[1].replace(/load\(\);render\(\);\s*$/,'')+
  '\n;globalThis.__paperUnit={settle,accept,get:()=>trades,set:x=>{trades=x}};';
 new Script(code).runInContext(context);
 return context.__paperUnit;
}
const M=60_000;
test('paper trade cannot be labeled positive until 5 future COMPLETE minutes exist',()=>{
 const unit=makeHarness(),closed=Date.UTC(2026,10,10,2,0);
 const trades=[
  {symbol:'XRPUSDT',strategy:'BAND_BREAKOUT',direction:'LONG',closedAt:closed,status:'pending',entry:null},
  {symbol:'XRPUSDT',strategy:'BAND_REENTRY',direction:'SHORT',closedAt:closed,status:'pending',entry:null}
 ];
 unit.set(trades);
 const bars=Array.from({length:5},(_,i)=>({time:closed+i*M,open:i===0?100:100+i/10,close:100+(i+1)*0.1}));
 unit.settle('XRPUSDT',bars.slice(0,4),closed+4*M);
 assert.equal(trades[0].status,'pending');
 assert.equal(trades[1].status,'pending');
 unit.settle('XRPUSDT',bars,closed+5*M);
 assert.equal(trades[0].status,'win');
 assert.equal(trades[1].status,'loss');
 assert.ok(trades[0].netBps>0);
 assert.ok(trades[1].netBps<0);
 assert.equal(trades[0].entry,100);
 assert.equal(trades[0].exit,100.5);
 assert.equal(trades[0].netBps,28);
 assert.equal(trades[1].netBps,-72);
});
test('paper journal records only latest closed candle candidate, dedupes it and limits one symbol per 5 minutes',()=>{
 const unit=makeHarness(),closed=Date.UTC(2026,10,10,2,0);
 const event={strategy:'BAND_BREAKOUT',direction:'SHORT',
  closedAt:closed,observedClose:100,volumeRatio:2.2,notATrade:true};
 const snap={closedAt:closed,generatedAt:closed+2000,recent:[event]};
 unit.accept('SOLUSDT',snap);
 assert.equal(unit.get().length,1);
 unit.accept('SOLUSDT',snap);
 assert.equal(unit.get().length,1);
 unit.accept('SOLUSDT',{
  closedAt:closed+2*M,generatedAt:closed+2*M+2000,
  recent:[{...event,closedAt:closed+2*M}]
 });
 assert.equal(unit.get().length,1);
 unit.accept('BTCUSDT',snap);
 assert.equal(unit.get().length,2);
 unit.accept('ETHUSDT',{...snap,generatedAt:closed+2*M,
  recent:[event]});
 assert.equal(unit.get().length,2);
 assert.equal(unit.get()[0].status,'pending');
});

test('five paper wins are not permission or a stop: more hypothetical tests can be recorded',()=>{
 const closed=Date.UTC(2026,10,10,4,0),unit=makeHarness(closed+2000);
 const prior=['BTCUSDT','ETHUSDT','SOLUSDT','DOGEUSDT','BNBUSDT']
  .map((symbol,i)=>({symbol,strategy:'BAND_BREAKOUT',
   direction:'LONG',closedAt:closed-i*10*M,status:'win',netBps:5}));
 unit.set(prior);
 const snap={closedAt:closed,generatedAt:closed+1000,recent:[{
  strategy:'BAND_REENTRY',direction:'SHORT',closedAt:closed,
  observedClose:1.1,volumeRatio:1.3,notATrade:true
 }]};
 unit.accept('XRPUSDT',snap);
 assert.equal(unit.get().length,6);
 assert.equal(unit.get()[5].status,'pending');
 assert.equal(unit.get().filter(x=>x.status==='win').length,5);
});

test('a candidate seen after 25 seconds or from a delayed response is NOT a forward paper entry',()=>{
 const closed=Date.UTC(2026,10,10,2,0);
 const event={strategy:'BAND_BREAKOUT',direction:'LONG',closedAt:closed,
  observedClose:100,volumeRatio:2,notATrade:true};
 const late=makeHarness(closed+30000);
 late.accept('XRPUSDT',{closedAt:closed,generatedAt:closed+27000,recent:[event]});
 assert.equal(late.get().length,0);
 const delayed=makeHarness(closed+12000);
 delayed.accept('XRPUSDT',{closedAt:closed,generatedAt:closed-1000,recent:[event]});
 assert.equal(delayed.get().length,0);
 const timely=makeHarness(closed+12000);
 timely.accept('XRPUSDT',{closedAt:closed,generatedAt:closed+4000,recent:[event]});
 assert.equal(timely.get().length,1);
 assert.equal(timely.get()[0].detectionLagMs,12000);
 assert.equal(timely.get()[0].entryAssumption,'NEXT_1M_OPEN_PROXY_NOT_EXECUTABLE');
});
