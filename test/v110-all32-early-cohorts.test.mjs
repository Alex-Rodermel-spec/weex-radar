import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileSymbols,marketForecastProfile} from '../lib/market-forecast-profiles.mjs';
import {summarizeV110All32EarlyCohorts as study,V110_ALL32_EARLY_COHORT_POLICY as P}
 from '../lib/v110-all32-early-cohorts.mjs';
import {runForecastNotifications} from '../lib/forecast-ntfy.mjs';

const MIN=60_000,FIVE=5*MIN;
const at=Date.UTC(2026,10,15,12,0,30);
const all=profileSymbols();
const frame=(symbol,one='LONG_BIAS',five='LONG_BIAS',ten='LONG_BIAS',now=at)=>({
 available:true,exchange:'WEEX',symbol,
 timeframes:[
  {intervalMinutes:1,direction:one,price:0.9,closedAt:Math.floor((now-1000)/MIN)*MIN,lastCandleBody:'UP'},
  {intervalMinutes:5,direction:five,closedAt:Math.floor((now-1000)/FIVE)*FIVE,lastCandleBody:'UP'},
  {intervalMinutes:10,direction:ten,closedAt:Math.floor((now-1000)/(2*FIVE))*(2*FIVE),lastCandleBody:'UP'}
 ]});
test('representative 32/32 observation includes early 1m vs neutral 5m LONG and SHORT separately',()=>{
 const snaps=all.map(s=>frame(s));
 const xrp=snaps.find(x=>x.symbol==='XRPUSDT');
 xrp.timeframes[1].direction='NEUTRAL';
 xrp.timeframes[2].direction='SHORT_BIAS';
 const eth=snaps.find(x=>x.symbol==='ETHUSDT');
 eth.timeframes[0].direction='SHORT_BIAS';
 const stock=snaps.find(x=>x.symbol==='MRNAUSDT');
 stock.timeframes[0].direction='SHORT_BIAS';
 stock.timeframes[1].direction='NEUTRAL';
 const r=study(snaps,at);
 assert.equal(r.status,'COMPLETE_32_CLOSED_5M');
 assert.equal(r.validSameClose,32);
 assert.equal(r.missingOrStale,0);
 assert.equal(r.totalEarlyCandidates,3);
 assert.equal(r.candidateKinds.ONE_MINUTE_LEADS_NEUTRAL_FIVE.total,2);
 assert.equal(r.candidateKinds.ONE_MINUTE_LEADS_NEUTRAL_FIVE.LONG,1);
 assert.equal(r.candidateKinds.ONE_MINUTE_LEADS_NEUTRAL_FIVE.SHORT,1);
 assert.equal(r.candidateKinds.ONE_MINUTE_OPPOSES_FIVE.total,1);
 assert.equal(r.candidateKinds.ONE_MINUTE_OPPOSES_FIVE.SHORT,1);
 assert.equal(r.byGroup.ALT_CRYPTO.leadsNeutralFive,1);
 assert.equal(r.byGroup.EQUITY_DERIVED.leadsNeutralFive,1);
 assert.equal(r.byGroup.MAJOR_CRYPTO.opposesFive,1);
 assert.equal(r.fullThreeTimeframeAlignment,29);
 assert.equal(r.prospectiveOutcomesMeasured,false);
 assert.equal(r.ordersSent,0);
 assert.equal(P.trainingWeightsChanged,false);
});
test('two indicator biases can agree but 10m lag; neutral 1m not counted as early success',()=>{
 const [btc,eth,xrp,ada]=['BTCUSDT','ETHUSDT','XRPUSDT','ADAUSDT'];
 const d=[frame(btc,'LONG_BIAS','LONG_BIAS','SHORT_BIAS'),
  frame(eth,'NEUTRAL','SHORT_BIAS','SHORT_BIAS'),
  frame(xrp,'NEUTRAL','NEUTRAL','LONG_BIAS'),
  frame(ada,'SHORT_BIAS','SHORT_BIAS','NEUTRAL')];
 const r=study(d,at);
 assert.equal(r.status,'INCOMPLETE_32_CLOSED_5M');
 assert.equal(r.totalEarlyCandidates,2);
 assert.equal(r.candidateKinds.ONE_AND_FIVE_AHEAD_OF_TEN.LONG,1);
 assert.equal(r.candidateKinds.ONE_AND_FIVE_AHEAD_OF_TEN.SHORT,1);
 assert.equal(r.oneMinuteNeutral,2);
 assert.equal(r.missingOrStale,28);
});
test('fully consistent 32 stale 5m snapshots are UNKNOWN rather than false early signals',()=>{
 const allRows=all.map(s=>frame(s,'SHORT_BIAS','NEUTRAL','LONG_BIAS'));
 for(const d of allRows)d.timeframes[1].closedAt-=FIVE;
 const r=study(allRows,at);
 assert.equal(r.status,'INCOMPLETE_32_CLOSED_5M');
 assert.equal(r.validSameClose,0);
 assert.equal(r.totalEarlyCandidates,0);
 assert.equal(r.missingOrStale,32);
 assert.equal(r.expected5mCloseAt,Math.floor((at-1000)/FIVE)*FIVE);
});
test('duplicate symbols, Bybit, future timestamps and wrong frame ordering cannot count',()=>{
 const good=frame('BTCUSDT','LONG_BIAS','NEUTRAL','SHORT_BIAS');
 const wrong=frame('XRPUSDT','LONG_BIAS','NEUTRAL','SHORT_BIAS');
 wrong.exchange='Bybit';
 const future=frame('ETHUSDT','SHORT_BIAS','NEUTRAL','LONG_BIAS');
 future.timeframes[0].closedAt=at+5*MIN;
 const malformed=frame('AVAXUSDT','SHORT_BIAS','NEUTRAL','LONG_BIAS');
 malformed.timeframes.reverse();
 const x=study([good,good,wrong,future,malformed],at);
 assert.equal(x.validSameClose,0);
 assert.equal(x.duplicateSymbols,1);
 assert.equal(x.totalEarlyCandidates,0);
});
test('all six market classes add up to exactly 32',()=>{
 assert.equal(all.length,32);
 const expected=Object.entries(P.groupSizes);
 for(const [kind,count] of expected)
  assert.equal(all.filter(s=>marketForecastProfile(s)?.group===kind).length,count);
 assert.equal(expected.reduce((sum,x)=>sum+x[1],0),32);
});
test('integration: existing 10m ntfy scan records all32 early shadow, no new ntfy sends',async()=>{
 const seen=[];
 const fixture=all.map(s=>frame(s));
 fixture.find(d=>d.symbol==='XRPUSDT').timeframes[1].direction='NEUTRAL';
 const lookup=new Map(fixture.map(d=>[d.symbol,d]));
 const r=await runForecastNotifications({
  env:{NTFY_TOPIC:'wr-'+('z'.repeat(32))},
  now:at,symbols:all,
  reader:async symbol=>{seen.push(symbol);return lookup.get(symbol)},
  fetchImpl:async()=>({ok:true,text:async()=>''}),
  publish:async()=>{throw Error('should not send a real alert')}
 });
 assert.equal(r.scanned,32);
 assert.equal(r.available,32);
 assert.equal(r.all32EarlyCohortResearch.status,'COMPLETE_32_CLOSED_5M');
 assert.equal(r.all32EarlyCohortResearch.candidateKinds.ONE_MINUTE_LEADS_NEUTRAL_FIVE.LONG,1);
 assert.equal(r.all32EarlyCohortResearch.prospectiveOutcomesMeasured,false);
 assert.equal(r.delivered,0);
 assert.equal(r.failed,0);
 assert.equal(seen.length,32);
});
test('research has no paid model, market fetch, secret, user data, order API, or new storage',()=>{
 const m=readFileSync(new URL('../lib/v110-all32-early-cohorts.mjs',import.meta.url),'utf8');
 const n=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 for(const word of ['fetch(', 'process.env','@vercel/blob','placeOrder(', 'trade-confirm',
  'publishNtfy', 'AI_GATEWAY','NTFY_TOPIC','api-contract.weex.com'])
  assert.equal(m.includes(word),false,word);
 assert.match(n,/const earlyCensus=summarizeV110All32EarlyCohorts\(researchObservations,now\)/);
 assert.match(n,/result\.all32EarlyCohortResearch=\{\.\.\.safeCensus/);
 assert.doesNotMatch(m,/if\(early\.kind='[^=]/);
 assert.equal(P.noNewNetworkRequests,true);
 assert.equal(P.noNewAlerts,true);
 assert.equal(P.noLiveSignalsChanged,true);
});
