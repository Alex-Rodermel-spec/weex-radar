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
  '\n;globalThis.__paperUnit={settle,accept,stress50Paper,get:()=>trades,set:x=>{trades=x}};';
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
  closedAt:closed,observedClose:100,volumeRatio:2.2,notATrade:true,
  signalTrend:'DOWN',trendAligned:true,signalRsi14:42.5,signalAtr14Bps:17};
 const paperEntryQuote={source:'WEEX_PUBLIC_BOOKTICKER',notATrade:true,
  bid:99.99,ask:100.01,spreadBps:2,quotedAt:closed+1500};
 const snap={closedAt:closed,generatedAt:closed+2000,recent:[event],paperEntryQuote};
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
 assert.equal(unit.get()[0].signalTrend,'DOWN');
 assert.equal(unit.get()[0].trendAligned,true);
 assert.equal(unit.get()[0].signalRsi14,42.5);
 assert.equal(unit.get()[0].signalAtr14Bps,17);
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
 }],paperEntryQuote:{source:'WEEX_PUBLIC_BOOKTICKER',notATrade:true,
  bid:1.099,ask:1.101,spreadBps:18.18,quotedAt:closed+900}};
 unit.accept('XRPUSDT',snap);
 assert.equal(unit.get().length,6);
 assert.equal(unit.get()[5].status,'pending');
 assert.equal(unit.get().filter(x=>x.status==='win').length,5);
});

test('a candidate seen after 25 seconds or from a delayed response is NOT a forward paper entry',()=>{
 const closed=Date.UTC(2026,10,10,2,0);
 const event={strategy:'BAND_BREAKOUT',direction:'LONG',closedAt:closed,
  observedClose:100,volumeRatio:2,notATrade:true};
 const quote={source:'WEEX_PUBLIC_BOOKTICKER',notATrade:true,
  bid:99.99,ask:100.01,spreadBps:2,quotedAt:closed+10000};
 const late=makeHarness(closed+30000);
 late.accept('XRPUSDT',{closedAt:closed,generatedAt:closed+27000,recent:[event],
  paperEntryQuote:{...quote,quotedAt:closed+27000}});
 assert.equal(late.get().length,0);
 const delayed=makeHarness(closed+12000);
 delayed.accept('XRPUSDT',{closedAt:closed,generatedAt:closed-1000,recent:[event],
  paperEntryQuote:quote});
 assert.equal(delayed.get().length,0);
 const timely=makeHarness(closed+12000);
 timely.accept('XRPUSDT',{closedAt:closed,generatedAt:closed+4000,recent:[event],
  paperEntryQuote:quote});
 assert.equal(timely.get().length,1);
 assert.equal(timely.get()[0].detectionLagMs,12000);
 assert.equal(timely.get()[0].entryAssumption,'WEEX_PUBLIC_BOOKTICKER');
 assert.equal(timely.get()[0].entry,100.01);
 assert.equal(timely.get()[0].entrySpreadBps,2);
});

test('quoted bid/ask after discovery is used instead of already-past next-minute OPEN',()=>{
 const closed=Date.UTC(2026,10,10,4,0),unit=makeHarness(closed+5000);
 const quote={source:'WEEX_PUBLIC_BOOKTICKER',notATrade:true,
  bid:99.8,ask:100.2,spreadBps:39.92,quotedAt:closed+4000};
 unit.accept('XRPUSDT',{closedAt:closed,generatedAt:closed+4000,
  paperEntryQuote:quote,recent:[{strategy:'BAND_BREAKOUT',direction:'LONG',
  closedAt:closed,observedClose:100,volumeRatio:2,notATrade:true}]});
 assert.equal(unit.get().length,1);
 const bars=Array.from({length:5},(_,i)=>({
  time:closed+i*M,open:100,high:101.1,low:100.1,close:101
 }));
 unit.settle('XRPUSDT',bars,closed+5*M);
 const trade=unit.get()[0];
 assert.equal(trade.entry,100.2);
 assert.equal(trade.exit,101);
 assert.equal(trade.entryAssumption,'WEEX_PUBLIC_BOOKTICKER');
 assert.equal(trade.riskTouched50,false);
 const expected=((101-100.2)/100.2)*10000-22-39.92/2;
 assert.ok(Math.abs(trade.netBps-expected)<.02);
 assert.ok(Math.abs(trade.marginRoi50Pct-expected/2)<.02);
 const noBook=makeHarness(closed+5000);
 noBook.accept('XRPUSDT',{closedAt:closed,generatedAt:closed+4000,
  paperEntryQuote:null,recent:[{strategy:'BAND_BREAKOUT',direction:'LONG',
  closedAt:closed,observedClose:100,volumeRatio:2,notATrade:true}]});
 assert.equal(noBook.get().length,0);
});

test('50x paper simulation scales BOTH gains and costs, never opens a position',()=>{
 const unit=makeHarness();
 const up=Array.from({length:5},(_,i)=>({
  time:i*M,open:100,high:101.1,low:99.95,close:101
 }));
 const m=unit.stress50Paper(up,100,'LONG',2);
 assert.equal(m.riskTouched,false);
 assert.equal(m.netBps,76);
 assert.equal(m.marginRoi50Pct,38);
 assert.equal(m.horizonExit,101);
 assert.ok(m.adverseBps<=5.01);
 assert.equal(unit.get().length,0);
});
test('50x LONG adverse 1.5% intraminute wick suppresses later apparent winner',()=>{
 const unit=makeHarness(),closed=Date.UTC(2026,10,10,2,0);
 const rows=Array.from({length:5},(_,i)=>({
  time:closed+i*M,open:100,high:102,low:i===1?98.49:99.7,close:101
 }));
 const trades=[{symbol:'SOLUSDT',strategy:'BAND_BREAKOUT',
  direction:'LONG',closedAt:closed,status:'pending',entry:100,
  entrySpreadBps:4,entryAssumption:'WEEX_PUBLIC_BOOKTICKER'}];
 unit.set(trades);
 unit.settle('SOLUSDT',rows,closed+5*M);
 assert.equal(trades[0].status,'risk');
 assert.equal(trades[0].riskTouched50,true);
 assert.equal(trades[0].horizonExit,101);
 assert.equal(trades[0].netBps,-174);
 assert.equal(trades[0].marginRoi50Pct,-87);
 assert.ok(trades[0].maxAdverseBps>150);
});
test('50x SHORT stress checks HIGH not LOW and missing OHLC fails closed',()=>{
 const unit=makeHarness(),closed=Date.UTC(2026,10,10,2,0);
 const rows=Array.from({length:5},(_,i)=>({
  time:closed+i*M,open:100,high:i===2?101.6:100.3,low:98.8,close:99
 }));
 const trades=[{symbol:'XRPUSDT',strategy:'BAND_REENTRY',
  direction:'SHORT',closedAt:closed,status:'pending',entry:100,
  entrySpreadBps:2,entryAssumption:'WEEX_PUBLIC_BOOKTICKER'}];
 unit.set(trades);
 unit.settle('XRPUSDT',rows,closed+5*M);
 assert.equal(trades[0].status,'risk');
 assert.equal(trades[0].netBps,-173);
 assert.equal(trades[0].marginRoi50Pct,-86.5);
 const withoutHigh=rows.map(({high,...r})=>r);
 assert.equal(unit.stress50Paper(withoutHigh,100,'LONG',0),null);
});

test('paper scanner reports why a fresh LONG/SHORT was skipped, never invents a fill',()=>{
 const closed=Date.UTC(2026,10,10,2,0),now=closed+5000;
 const unit=makeHarness(now);
 const event={strategy:'BAND_BREAKOUT',direction:'LONG',closedAt:closed,
  observedClose:100,volumeRatio:2.0,notATrade:true};
 assert.equal(unit.accept('XRPUSDT',{closedAt:closed,generatedAt:now-1000,
  recent:[],paperEntryQuote:null}),'NO_CURRENT_CANDIDATE');
 assert.equal(unit.accept('XRPUSDT',{closedAt:closed,generatedAt:now-1000,
  recent:[event],paperEntryQuote:null}),'QUOTE_NOT_USABLE');
 assert.equal(unit.get().length,0);
 const quote={source:'WEEX_PUBLIC_BOOKTICKER',notATrade:true,
  bid:99.99,ask:100.01,spreadBps:2,quotedAt:closed+4000};
 assert.equal(unit.accept('XRPUSDT',{closedAt:closed,generatedAt:closed+4000,
  recent:[event],paperEntryQuote:quote}),'RECORDED');
 assert.equal(unit.accept('XRPUSDT',{closedAt:closed,generatedAt:closed+4000,
  recent:[event],paperEntryQuote:quote}),'DUPLICATE_OR_COOLDOWN');
 assert.equal(unit.get().length,1);
});
