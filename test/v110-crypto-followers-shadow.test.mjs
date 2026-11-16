import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileSymbols,marketForecastProfile} from '../lib/market-forecast-profiles.mjs';
import {V110_LEADER_FOLLOWER_POLICY as policy,
 summarizeV110CryptoFollowers as analyze,
 scoreV110CryptoFollower as score} from '../lib/v110-crypto-followers-shadow.mjs';
import {runForecastNotifications} from '../lib/forecast-ntfy.mjs';
const M=60000,F=5*M,NOW=Date.UTC(2026,10,16,1,40,30);
const crypto=profileSymbols().filter(s=>marketForecastProfile(s).group.endsWith('CRYPTO'));
const non=profileSymbols().filter(s=>!marketForecastProfile(s).group.endsWith('CRYPTO'));
const snap=(symbol,i,bps=0,now=NOW)=>({
 symbol,exchange:'WEEX',available:true,alignment:'MIXED_OR_CONFLICT',
 timeframes:[
  {intervalMinutes:1,closedAt:Math.floor((now-1000)/M)*M,
   price:1+i*.1,direction:'NEUTRAL'},
  {intervalMinutes:5,closedAt:Math.floor((now-1000)/F)*F,
   lastCandleBodyBps:bps,direction:'NEUTRAL'},
  {intervalMinutes:10,closedAt:Math.floor((now-1000)/(2*F))*(2*F),
   direction:'NEUTRAL'}]
});
const cohort=(six=6,side='LONG')=>crypto.map((s,i)=>snap(s,i,i<six?(side==='LONG'?18:-18):0));
test('16 genuine crypto, six leaders create only quiet FOLLOWER hypotheses',()=>{
 const data=[...cohort(),...non.map((s,i)=>snap(s,16+i,500))];
 const r=analyze(data,NOW);
 assert.equal(policy.cryptoUniverse,16);
 assert.equal(r.status,'HYPOTHESES_FROZEN');
 assert.equal(r.validCrypto,16);
 assert.equal(r.upLeaders,6);
 assert.equal(r.downLeaders,0);
 assert.equal(r.quietCount,10);
 assert.equal(r.candidateCount,10);
 assert.equal(r.candidates[0].leaderSymbols.length,6);
 assert.equal(r.candidates[0].direction,'LONG');
 assert.equal(r.candidates[0].futureHorizonsMinutes.join(','),'5,10,15');
 assert.equal(r.futureOutcomesMeasured,false);
 assert.equal(r.changesLive108,false);
 assert.equal(r.ordersSent,0);
});
test('SHORT leader cohort makes SHORT hypotheses; five leaders do NOT qualify',()=>{
 const short=analyze(cohort(6,'SHORT'),NOW);
 assert.equal(short.status,'HYPOTHESES_FROZEN');
 assert.equal(short.candidates.length,10);
 assert.ok(short.candidates.every(r=>r.direction==='SHORT'));
 const five=analyze(cohort(5),NOW);
 assert.equal(five.status,'NO_SIX_LEADERS');
 assert.equal(five.candidateCount,0);
});
test('mixed opposite leadership is explicitly ambiguous, not a directional signal',()=>{
 const d=crypto.map((s,i)=>snap(s,i,i<6?18:i<12?-18:0));
 const r=analyze(d,NOW);
 assert.equal(r.status,'OPPOSING_LEADER_COHORTS_NO_HYPOTHESIS');
 assert.equal(r.candidateCount,0);
});
test('incomplete same-close crypto, stale bars, duplicate symbols fail closed',()=>{
 const full=cohort();
 const noCoin=analyze(full.slice(1),NOW);
 assert.equal(noCoin.status,'INCOMPLETE_CRYPTO16_SAME_CLOSE');
 assert.equal(noCoin.candidateCount,0);
 const old=cohort();old[0].timeframes[1].closedAt-=F;
 assert.equal(analyze(old,NOW).candidateCount,0);
 const future=cohort();future[0].timeframes[0].closedAt=NOW+M;
 assert.equal(analyze(future,NOW).candidateCount,0);
 const dup=analyze([...cohort(),cohort()[0]],NOW);
 assert.equal(dup.duplicateCrypto,1);
 assert.equal(dup.candidateCount,0);
 const bad=cohort();bad[0].timeframes[1].lastCandleBodyBps=NaN;
 assert.equal(analyze(bad,NOW).candidateCount,0);
});
test('stable receipt IDs on retried scan, not independent new signals',()=>{
 const input=cohort();
 const first=analyze(input,NOW),retry=analyze(input,NOW+10_000);
 assert.equal(first.candidates.length,retry.candidates.length);
 assert.deepEqual(first.candidates.map(x=>x.id),retry.candidates.map(x=>x.id));
 assert.equal(first.candidates[0].fiveClosedAt,retry.candidates[0].fiveClosedAt);
});
test('offline forward score uses ONLY consecutive fully closed subsequent 1m bars',()=>{
 const receipt=analyze(cohort(),NOW).candidates[0],start=Math.ceil((NOW+1)/M)*M;
 const future=Array.from({length:15},(_,i)=>({
  time:start+i*M,closeTime:start+(i+1)*M,
  close:receipt.referencePrice*(i<5?1.002:i<10?0.998:1.004)
 }));
 const scored=score(receipt,future,start+16*M+1000);
 assert.equal(scored.status,'OBSERVED');
 assert.equal(scored.horizons[5].directionResult,'FAVORABLE');
 assert.equal(scored.horizons[10].directionResult,'ADVERSE');
 assert.equal(scored.horizons[15].directionResult,'FAVORABLE');
 assert.equal(scored.horizons[5].signedBps,20);
 assert.equal(scored.horizons[10].signedBps,-20);
 const missing=future.filter(x=>x.time!==start+2*M);
 assert.equal(score(receipt,missing,start+16*M+1000).horizons[15].status,'PENDING_OR_MISSING');
 const duplicate=[...future,future[2]];
 assert.equal(score(receipt,duplicate,start+16*M+1000).horizons[5].status,'PENDING_OR_MISSING');
 // At freeze time, no FUTURE complete candle is scored.
 assert.equal(score(receipt,future,NOW).horizons[5].status,'PENDING_OR_MISSING');
});
test('integration is research-only in already running 10m scan; no extra alerts',async()=>{
 const data=cohort(),bySymbol=new Map(data.map(x=>[x.symbol,x]));
 const r=await runForecastNotifications({
  now:NOW,env:{NTFY_TOPIC:'wr-'+('j'.repeat(32))},symbols:crypto,
  reader:async symbol=>bySymbol.get(symbol),
  fetchImpl:async()=>({ok:true,text:async()=>''}),
  publish:async()=>{throw Error('must not publish a hypothesis')}
 });
 assert.equal(r.scanned,16);
 assert.equal(r.leaderFollowerResearch.status,'HYPOTHESES_FROZEN');
 assert.equal(r.leaderFollowerResearch.candidateCount,10);
 assert.equal(r.delivered,0);
 assert.equal(r.ordersSent,0);
});
test('pure module does not access private archive, trade or exchange APIs',()=>{
 const src=readFileSync(new URL('../lib/v110-crypto-followers-shadow.mjs',import.meta.url),'utf8');
 const scan=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const dispatcher=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 for(const word of ['fetch(', 'process.env', '@vercel/blob','publishNtfy','placeOrder(',
   'trade-confirm','weex-order','NTFY_TOPIC','api-contract.weex.com'])
  assert.equal(src.includes(word),false,word);
 assert.equal(scan.includes('v110-crypto-followers-shadow'),false);
 assert.match(dispatcher,/leaderFollowerResearch=summarizeV110CryptoFollowers\(researchObservations,now\)/);
 assert.equal(policy.automaticFutureOutcomeScoring,false);
 assert.equal(policy.extraMarketRequests,0);
 assert.equal(policy.extraAlerts,0);
});
