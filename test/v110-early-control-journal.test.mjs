import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encryptJournal,decryptJournalArchive} from '../lib/journal-core.mjs';
import {
 collectV110EarlyControl,mergeV110EarlyControl,
 summarizeV110EarlyControl,sampledV110EarlySymbols,V110_EARLY_CONTROL_POLICY
} from '../lib/v110-early-control-journal.mjs';
import {profileSymbols,marketForecastProfile} from '../lib/market-forecast-profiles.mjs';
const M=60000,F=5*M,TEN=10*M;
const NOW=Date.UTC(2026,10,16,6,7,30),LATER=NOW+20*M;
const crypto=profileSymbols().filter(s=>marketForecastProfile(s)?.group.endsWith('CRYPTO'));
const time=dt=>Math.floor((NOW-1000)/dt)*dt;
const plan=[
 ['LONG_BIAS','NEUTRAL','SHORT_BIAS'],
 ['LONG_BIAS','SHORT_BIAS','SHORT_BIAS'],
 ['SHORT_BIAS','SHORT_BIAS','SHORT_BIAS'],
 ['SHORT_BIAS','SHORT_BIAS','LONG_BIAS']
];
function mockReader(counter){
 return async(symbol,{now})=>{
  counter.push(symbol);
  const i=sampledV110EarlySymbols(NOW).indexOf(symbol);
  if(i<0)throw Error('Unexpected crypto market');
  const dirs=plan[i];
  return {available:true,exchange:'WEEX',symbol,
   timeframes:[
    {intervalMinutes:1,closedAt:time(M),price:100,direction:dirs[0],
     rsi14:dirs[0]==='LONG_BIAS'?55:45,
     lastCandleBody:'UP',lastCandleBodyBps:7,relativeVolume:1.1},
    {intervalMinutes:5,closedAt:time(F),direction:dirs[1],
     rsi14:50,lastCandleBodyBps:8,price:100},
    {intervalMinutes:10,closedAt:time(TEN),direction:dirs[2],
     rsi14:45,lastCandleBodyBps:8,price:100}
   ]};
 };
}
function allBars(price=100.1){
 const start=Math.ceil(NOW/M)*M;
 return Array.from({length:28},(_,i)=>({
  time:start+i*M,closeTime:start+(i+1)*M,
  open:100,close:price,high:Math.max(100,price)+.001,
  low:Math.min(100,price)-.001
 }));
}
test('rotates four of the real 16 crypto markets, bounded to 8 public WEEX reads per OIDC run',()=>{
 const a=sampledV110EarlySymbols(NOW),b=sampledV110EarlySymbols(NOW+20*M);
 assert.equal(crypto.length,16);
 assert.equal(a.length,4);assert.equal(b.length,4);
 assert.deepEqual(a.map(x=>crypto.indexOf(x)).sort((a,b)=>a-b),
  [...new Set(a.map(x=>crypto.indexOf(x)))].sort((a,b)=>a-b));
 assert.equal(a.filter(s=>b.includes(s)).length,0);
 const fullCycle=Array.from({length:4},(_,slot)=>sampledV110EarlySymbols(NOW+slot*20*M)).flat();
 assert.equal(fullCycle.length,16);
 assert.equal(new Set(fullCycle).size,16,'each crypto must be sampled once per four scheduled 20m snapshots');
 assert.equal(V110_EARLY_CONTROL_POLICY.extraPublicWeexKlineRequestsPerRunMax,8);
 assert.equal(V110_EARLY_CONTROL_POLICY.noOrders,true);
 assert.equal(V110_EARLY_CONTROL_POLICY.automaticPromotion,false);
});
test('freeze genuine divergent 1m and aligned 1m/5m/10m control BEFORE future 1m bars',async()=>{
 const visited=[];
 const scan=await collectV110EarlyControl(NOW,{reader:mockReader(visited)});
 assert.equal(visited.length,4);
 assert.equal(scan.sampled,4);assert.equal(scan.valid,4);
 assert.equal(scan.early,3);assert.equal(scan.control,1);
 assert.equal(scan.fresh.length,4);
 assert.deepEqual(new Set(scan.fresh.map(x=>x.kind)),new Set([
  'ONE_MINUTE_LEADS_NEUTRAL_FIVE','ONE_MINUTE_OPPOSES_FIVE',
  'THREE_TIMEFRAME_ALIGNMENT_CONTROL','ONE_AND_FIVE_AHEAD_OF_TEN'
 ]));
 assert.ok(scan.fresh.every(x=>[5,10,15].every(h=>
  x.horizons[h].status==='PENDING'&&x.horizons[h].signedBps===null)));
 assert.ok(scan.fresh.every(x=>x.frozenAt===NOW&&x.source===
  'V110_OIDC_20M_SAMPLED_16_CRYPTO'));
 const first=mergeV110EarlyControl([],scan.fresh,new Map(),NOW);
 assert.equal(first.added,4);assert.equal(first.rows.length,4);
 assert.ok(first.rows.every(x=>x.horizons[15].status==='PENDING'));
});
test('20 minutes later score ONLY strictly future closed minute candles for early/control',async()=>{
 const scan=await collectV110EarlyControl(NOW,{reader:mockReader([])});
 const stored=mergeV110EarlyControl([],scan.fresh,null,NOW);
 const bars=new Map(scan.fresh.map(x=>[x.symbol,allBars(
  x.kind==='THREE_TIMEFRAME_ALIGNMENT_CONTROL'?100.1:
   x.direction==='LONG_BIAS'?100.1:99.9)]));
 const scored=mergeV110EarlyControl(stored.rows,[],bars,LATER);
 assert.equal(scored.rows.length,4);
 assert.equal(scored.added,0);assert.equal(scored.updated,12);
 for(const r of scored.rows){
  assert.ok([5,10,15].every(h=>r.horizons[h].status==='OBSERVED'));
  assert.ok([5,10,15].every(h=>r.horizons[h].signedBps===
   (r.kind==='THREE_TIMEFRAME_ALIGNMENT_CONTROL'?-10:10)));
 }
 const replay=mergeV110EarlyControl(scored.rows,scan.fresh,
  new Map(scan.fresh.map(x=>[x.symbol,allBars(98)])),LATER);
 assert.equal(replay.changed,false);
 assert.equal(replay.rows.find(x=>x.kind==='THREE_TIMEFRAME_ALIGNMENT_CONTROL')
  .horizons[15].signedBps,-10);
});
test('missing future candle remains unknown; after lookback expires cannot become a fabricated win',async()=>{
 const scan=await collectV110EarlyControl(NOW,{reader:mockReader([])});
 const rows=mergeV110EarlyControl([],scan.fresh,null,NOW).rows;
 const gap=allBars().filter(x=>x.time!==Math.ceil(NOW/M)*M+2*M);
 const changed=mergeV110EarlyControl(rows,[],new Map(scan.fresh.map(x=>[x.symbol,gap])),LATER);
 assert.ok(changed.rows.every(r=>r.horizons[15].status==='PENDING'));
 const expired=mergeV110EarlyControl(changed.rows,[],new Map(),NOW+126*M);
 assert.ok(expired.rows.every(r=>r.horizons[15].status==='NO_DATA'));
 const summary=summarizeV110EarlyControl(expired.rows,NOW+126*M);
 assert.equal(summary.full.early.horizons[15].observed,0);
 assert.equal(summary.full.early.horizons[15].noData,3);
 assert.equal(summary.accuracyImproved,false);
});
test('missing 5m close, broken market, future 1m, inconsistent symbols freeze no receipts',async()=>{
 const sample=sampledV110EarlySymbols(NOW);
 const broken=async(symbol,{now})=>{
  const d=await mockReader([])(symbol,{now});
  if(symbol===sample[0])d.timeframes[1].closedAt-=F;
  if(symbol===sample[1])d.timeframes[0].closedAt+=2*M;
  if(symbol===sample[2])d.symbol='WRONG';
  if(symbol===sample[3])throw Error('WEEX downtime');
  return d;
 };
 const s=await collectV110EarlyControl(NOW,{reader:broken});
 assert.equal(s.fresh.length,0);assert.equal(s.failed,4);
 assert.equal(s.status,'PARTIAL_SAMPLED_SCAN');
});
test('AES-GCM preserves frozen research only within existing encrypted archive; legacy remains readable',async()=>{
 const scan=await collectV110EarlyControl(NOW,{reader:mockReader([])});
 const rows=mergeV110EarlyControl([],scan.fresh,null,NOW).rows;
 const env={NTFY_TOPIC:'t'.repeat(32),PUSH_CRON_KEY:'s'.repeat(40)};
 const sealed=encryptJournal([],env,[],[],[],[],rows);
 assert.ok(!JSON.stringify(sealed).includes(rows[0].symbol));
 const decoded=decryptJournalArchive(sealed,env);
 assert.deepEqual(decoded.earlyControlRows,rows);
 const legacy=decryptJournalArchive(encryptJournal([],env),env);
 assert.deepEqual(legacy.earlyControlRows,[]);
 const x=summarizeV110EarlyControl(rows,NOW);
 assert.equal(x.archivedCandidates,4);
 assert.equal(x.full.early.horizons[15].favorablePctDescriptive,null);
 assert.equal(x.independentProspectiveProof,false);
 assert.equal(x.promoteLive,false);
 assert.equal(JSON.stringify(x).includes(rows[0].symbol),false);
});
test('isolated from ntfy/5m confirmed and from WEEX orders or API secret',()=>{
 const main=readFileSync(new URL('../lib/v110-early-control-journal.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../.github/workflows/signal-journal.yml',import.meta.url),'utf8');
 assert.match(route,/earlyControlForwardStudy:summarizeV110EarlyControl\(earlyControlRows,now\)/);
 assert.match(route,/collectV110EarlyControl\(now\)/);
 assert.match(route,/earlyControlMerged\.rows/);
 assert.match(worker,/cron: '7,27,47 \* \* \* \*'/);
 assert.doesNotMatch(main,/trade-confirm|trade-prepare|weex\.placeOrder|NTFY_TOPIC|PUSH_CRON_KEY|process\.env|ntfy\.sh|\/capi\/v3\/order/);
 assert.equal(V110_EARLY_CONTROL_POLICY.noNewNtfy,true);
});
