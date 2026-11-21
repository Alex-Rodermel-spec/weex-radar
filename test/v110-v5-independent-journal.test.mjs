import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encryptJournal,decryptJournalArchive} from '../lib/journal-core.mjs';
import {freezeV5Independent,mergeV5Independent,
 summarizeV5Independent,V5_INDEPENDENT_POLICY as POLICY}
 from '../lib/v110-v5-independent-journal.mjs';
import {collectV110EarlyControl,sampledV110EarlySymbols}
 from '../lib/v110-early-control-journal.mjs';

const M=60_000,F=5*M,now=Date.UTC(2026,10,21,10,27,30);
const start=Math.ceil(now/M)*M,late=now+22*M;
const fiveClose=Math.floor((now-1000)/F)*F;
const source=POLICY.source;
const sample=sampledV110EarlySymbols(now);
function snapshot(symbol,legacy='MIXED',v5='SHORT_BIAS'){
 return {exchange:'WEEX',available:true,symbol,combinedDirection:legacy,
  timeframes:[{intervalMinutes:1,closedAt:start-M,
    price:100,direction:'NEUTRAL'},
   {intervalMinutes:5,closedAt:fiveClose,direction:'NEUTRAL'},
   {intervalMinutes:10,closedAt:fiveClose-5*M,direction:'NEUTRAL'}],
  forecastV5:{available:true,direction:v5,closedAt1m:start-M,
   closedAt5m:fiveClose}};
}
function after(price){
 return Array.from({length:20},(_,i)=>({
  time:start+i*M,closeTime:start+(i+1)*M,
  open:100,high:Math.max(100,price)+.1,low:Math.min(100,price)-.1,
  close:price
 }));
}
test('V5 independent cohort freezes unsent V5-only SHORT while legacy is MIXED',()=>{
 const a=freezeV5Independent(snapshot(sample[0]),now);
 assert.equal(a.source,source);
 assert.equal(a.v5Direction,'SHORT_BIAS');
 assert.equal(a.legacyDirection,'MIXED');
 assert.equal(a.referencePrice,100);
 assert.equal(a.horizons[5].status,'PENDING');
 const b=freezeV5Independent(snapshot(sample[0]),now);
 assert.equal(a.id,b.id);
 assert.equal(freezeV5Independent({...snapshot(sample[0]),
  forecastV5:{available:true,direction:'LONG_BIAS',closedAt1m:start}},now),null);
});
test('existing rotating 20m collector freezes V5 on ALL four WEEX markets without extra calls',async()=>{
 const visited=[];
 const r=await collectV110EarlyControl(now,{
  reader:async symbol=>{visited.push(symbol);return snapshot(symbol)}
 });
 assert.deepEqual(visited,sample);
 assert.equal(r.sampled,4);
 assert.equal(r.v5Fresh.length,4);
 assert.equal(r.fresh.length,0);
 assert.ok(r.v5Fresh.every(x=>x.legacyDirection==='MIXED'));
 assert.equal(r.extraRequestsMax,8);
 assert.equal(POLICY.marketRequestsAdded,0);
});
test('next 20m existing 1m candles score only AFTER frozen time (not pending current candles)',()=>{
 const frozen=freezeV5Independent(snapshot(sample[0]),now);
 const first=mergeV5Independent([],[frozen],null,now);
 assert.equal(first.added,1);
 assert.equal(first.rows[0].horizons[5].status,'PENDING');
 const future=new Map([[sample[0],after(99.9)]]);
 const scored=mergeV5Independent(first.rows,[],future,late);
 assert.equal(scored.rows[0].horizons[5].status,'OBSERVED');
 assert.equal(scored.rows[0].horizons[5].moveBps,-10);
 assert.equal(scored.rows[0].horizons[15].status,'OBSERVED');
 const repeated=mergeV5Independent(scored.rows,[frozen],
  new Map([[sample[0],after(105)]]),late);
 assert.equal(repeated.changed,false);
 assert.equal(repeated.rows[0].horizons[5].moveBps,-10);
 const agg=summarizeV5Independent(scored.rows,late);
 assert.equal(agg.v5FiveMinute.favorable,1);
 assert.equal(agg.legacyFiveMinute.observed,0);
 assert.equal(agg.v5Abstentions,0);
 assert.equal(agg.recommendation,'KEEP_V4');
 assert.equal(agg.accuracyImprovedNotProven,true);
});
test('gapped, duplicate, partial or premature candle outcomes are UNKNOWN not wins',()=>{
 const a=freezeV5Independent(snapshot(sample[1],'LONG_BIAS','LONG_BIAS'),now);
 const gap=after(102).filter((_,i)=>i!==2);
 assert.equal(mergeV5Independent([],[a],new Map([[sample[1],gap]]),late)
  .rows[0].horizons[5].status,'PENDING');
 const dupe=after(102);dupe.push(dupe[2]);
 assert.equal(mergeV5Independent([],[a],new Map([[sample[1],dupe]]),late)
  .rows[0].horizons[5].status,'PENDING');
 const early=mergeV5Independent([],[a],new Map([[sample[1],after(102)]]),now);
 assert.equal(early.rows[0].horizons[5].status,'PENDING');
 const expired=mergeV5Independent(early.rows,[],null,now+126*M);
 assert.equal(expired.rows[0].horizons[5].status,'NO_DATA');
 assert.equal(summarizeV5Independent(expired.rows,now+126*M).v5FiveMinute.observed,0);
});
test('append-only encrypted journal preserves independent samples, legacy archive defaults empty',()=>{
 const a=freezeV5Independent(snapshot(sample[2],'MIXED','LONG_BIAS'),now);
 const env={NTFY_TOPIC:'a'.repeat(32),PUSH_CRON_KEY:'b'.repeat(40)};
 const crypt=encryptJournal([],env,[],[],[],[],[],[a]);
 const d=decryptJournalArchive(crypt,env);
 assert.deepEqual(d.v5IndependentRows,[a]);
 assert.ok(!JSON.stringify(crypt).includes(a.symbol));
 assert.deepEqual(decryptJournalArchive(encryptJournal([],env),env).v5IndependentRows,[]);
});
test('V5-only cohort is isolated from trade orders, ntfy, new cron and live promotion',()=>{
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const own=readFileSync(new URL('../lib/v110-v5-independent-journal.mjs',import.meta.url),'utf8');
 assert.match(route,/forecastV5Independent:summarizeV5Independent/);
 assert.match(route,/mergeV5Independent\(v5IndependentRows/);
 assert.match(route,/v5IndependentMerged\.rows/);
 for(const forbidden of [/placeOrder/,/WEEX_API_SECRET/,/trade-confirm/,/ntfy\.sh/,/\/capi\/v3\/order/]){
  assert.doesNotMatch(own,forbidden);
 }
 assert.equal(POLICY.autoPromotion,false);
 assert.equal(POLICY.noNewCron,true);
 assert.equal(POLICY.noNewPush,true);
 assert.equal(POLICY.ordersSent,0);
});
