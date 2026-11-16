import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileSymbols,marketForecastProfile} from '../lib/market-forecast-profiles.mjs';
import {encryptJournal,decryptJournalArchive} from '../lib/journal-core.mjs';
import {collectV110FollowerJournal as collect,mergeV110FollowerJournal as merge,
 summarizeV110FollowerJournal as summary,normalizeFollowerMinutes,FOLLOWER_JOURNAL_LIMIT}
 from '../lib/v110-follower-journal.mjs';
const M=60000,F=5*M,NOW=Date.UTC(2026,10,16,6,7,30),LATER=NOW+20*M;
const cryptos=profileSymbols().filter(s=>marketForecastProfile(s).group.endsWith('CRYPTO'));
const basePrice=cryptos.map((s,i)=>[s,i]).reduce((a,[s,i])=>(a[s]=1+i*.1,a),{});
const mkBars=(symbol,at,followerFuture=0)=>{
 const end=Math.floor((at-1000)/M)*M,items=[];
 const index=cryptos.indexOf(symbol),base=basePrice[symbol];
 const newest5Close=Math.floor((NOW-1000)/F)*F;
 for(let k=125;k>0;k--){
  const time=end-k*M,leader=index>=0&&index<6;
  // At first FREEZE, exactly six genuine CLOSED 5m bodies > 10bps.
  const isPrior=(time>=newest5Close-F&&time<newest5Close);
  const after=time>=Math.ceil((NOW+1)/M)*M;
  const open=base;
  const close=after&&index>=6?base*(1+followerFuture):
   isPrior&&leader?base*1.002:base;
  const high=Math.max(open,close)*1.001;
  const low=Math.min(open,close)*0.999;
  items.push([time,open,high,low,close,125000]);
 }
 return items;
};
const fetcher=(at,change=0)=>async url=>{
 const symbol=new URL(url).searchParams.get('symbol');
 assert.ok(cryptos.includes(symbol));
 return {ok:true,text:async()=>JSON.stringify({data:mkBars(symbol,at,change)})};
};
test('one protected 20m scan freezes 6 leader -> 10 quiet followers BEFORE future bars',async()=>{
 const x=await collect(NOW,{fetchImpl:fetcher(NOW)});
 assert.equal(cryptos.length,16);
 assert.equal(x.validMarkets,16);
 assert.equal(x.status,'HYPOTHESES_FROZEN');
 assert.equal(x.fresh.length,10);
 assert.ok(x.fresh.every(r=>r.leaderCount===6&&r.direction==='LONG'));
 assert.ok(x.fresh.every(r=>r.horizons[5].status==='PENDING'));
 assert.ok(x.fresh.every(r=>r.source==='OIDC_JOURNAL_PROSPECTIVE_16_CRYPTO'));
 const result=merge([],x.fresh,x.candles,NOW);
 assert.equal(result.added,10);
 assert.equal(result.rows[0].horizons[5].status,'PENDING');
});
test('next 20m writer scores exact future 5/10/15m closed candles, then preserves them',async()=>{
 const first=await collect(NOW,{fetchImpl:fetcher(NOW)});
 const archived=merge([],first.fresh,first.candles,NOW);
 const newData=await collect(LATER,{fetchImpl:fetcher(LATER,.001)});
 const next=merge(archived.rows,[],newData.candles,LATER);
 assert.equal(next.rows.length,10);
 assert.ok(next.rows.every(r=>[5,10,15].every(h=>
   r.horizons[h].status==='OBSERVED'&&r.horizons[h].signedBps===10)));
 const replay=merge(next.rows,first.fresh,newData.candles,LATER);
 assert.equal(replay.added,0);
 assert.equal(replay.updated,0);
 assert.equal(replay.changed,false);
 const badData=new Map(cryptos.map(s=>[s,[]]));
 const untouched=merge(next.rows,[],badData,LATER+M);
 assert.equal(untouched.updated,0);
 assert.equal(untouched.rows[0].horizons[5].status,'OBSERVED');
});
test('missing 1m and duplicate market bars are UNKNOWN rather than invented wins',async()=>{
 const first=await collect(NOW,{fetchImpl:fetcher(NOW)});
 const archived=merge([],first.fresh,first.candles,NOW);
 const missing=await collect(LATER,{fetchImpl:async url=>{
  const s=new URL(url).searchParams.get('symbol');
  let bars=mkBars(s,LATER,.001);
  bars=bars.filter(b=>b[0]!==Math.ceil((NOW+1)/M)*M+2*M);
  return {ok:true,text:async()=>JSON.stringify({data:bars})};
 }});
 const after=merge(archived.rows,[],missing.candles,LATER);
 assert.ok(after.rows.every(x=>x.horizons[5].status==='PENDING'));
 const stale=merge(after.rows,[],new Map(),NOW+126*M);
 assert.ok(stale.rows.every(x=>x.horizons[5].status==='NO_DATA'));
 assert.equal(summary(stale.rows,NOW+126*M).byDirection.LONG.horizons[5].favorable,0);
 const dup=mkBars(cryptos[0],LATER);
 dup.push(dup[100]);
 assert.equal(normalizeFollowerMinutes(dup,LATER).length,124);
});
test('missing crypto market, non-WEEX malformed or remote errors never freeze cherry-picked candidates',async()=>{
 let requests=0;
 const partial=await collect(NOW,{fetchImpl:async url=>{
  requests++;
  const symbol=new URL(url).searchParams.get('symbol');
  if(symbol===cryptos[2])throw Error('offline');
  return {ok:true,text:async()=>JSON.stringify({data:mkBars(symbol,NOW)})};
 }});
 assert.equal(requests,16);
 assert.equal(partial.validMarkets,15);
 assert.equal(partial.fresh.length,0);
 assert.equal(partial.status,'INCOMPLETE_CRYPTO16_NO_NEW_COHORT');
});
test('encrypt and recover prospective follower rows while legacy v1 is supported',async()=>{
 const f=await collect(NOW,{fetchImpl:fetcher(NOW)});
 const rows=merge([],f.fresh,f.candles,NOW).rows;
 const env={PUSH_CRON_KEY:'e'.repeat(40),NTFY_TOPIC:'v'.repeat(32)};
 const a=encryptJournal([],env,[],[],[],rows);
 const data=decryptJournalArchive(a,env);
 assert.equal(data.leadLagRows.length,10);
 assert.deepEqual(data.leadLagRows,rows);
 assert.ok(!JSON.stringify(a).includes('XRPUSDT'));
 const legacy=decryptJournalArchive(encryptJournal([],env),env);
 assert.deepEqual(legacy.leadLagRows,[]);
});
test('only aggregate counts leave private journal, small samples never claim accuracy',async()=>{
 const f=await collect(NOW,{fetchImpl:fetcher(NOW)});
 const saved=merge([],f.fresh,f.candles,NOW).rows;
 const a=summary(saved,NOW);
 assert.equal(a.status,'RESEARCH_ONLY');
 assert.equal(a.archivedCandidates,10);
 assert.equal(a.byDirection.LONG.horizons[5].observed,0);
 assert.equal(a.byDirection.LONG.horizons[5].favorablePctDescriptive,null);
 assert.equal(a.recommendation,'KEEP_108');
 assert.equal(JSON.stringify(a).includes('XRPUSDT'),false);
 assert.equal(summary(null,NOW).status,'INVALID_INPUT');
 assert.equal(summary(Array(FOLLOWER_JOURNAL_LIMIT+1).fill(saved[0]),NOW).status,'INVALID_INPUT');
});
test('isolation: no order API, push, extra cron, plaintext archive, or live 108 changes',()=>{
 const follower=readFileSync(new URL('../lib/v110-follower-journal.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const engine=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 const writer=readFileSync(new URL('../.github/workflows/signal-journal.yml',import.meta.url),'utf8');
 assert.match(route,/collectV110FollowerJournal\(now\)/);
 assert.match(route,/leadLagForwardStudy:summarizeV110FollowerJournal\(leadLagRows,now\)/);
 assert.match(route,/leadLagMerged.rows\)/);
 assert.match(writer,/7,27,47/);
 assert.equal(engine.includes('v110-follower-journal'),false);
 for(const forbidden of ['process.env','publishNtfy','trade-confirm','placeOrder',
  '@vercel/blob','NTFY_TOPIC','push-dispatch','/order/place'])
  assert.equal(follower.includes(forbidden),false,forbidden);
});
