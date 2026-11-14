import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptV110ForecastJournal} from '../lib/v110-journal-adapter.mjs';
import {compareV110ForwardOutcomes} from '../lib/v110-forward-comparison.mjs';
const now=Date.parse('2026-11-14T05:00:00Z');
const row=(model,id,direction,horizonMinutes,outcomePrice)=>({
 model,alertId:id,direction,horizonMinutes,entryPrice:100,outcomePrice,
 observedAt:'2026-11-14T03:45:00Z',outcomeKnownAt:'2026-11-14T04:20:00Z',source:'independent-forward'
});
test('reports all ten horizon/direction slices without inventing model lift',()=>{
 const records=[row('V108','a','LONG',5,101),row('V110','b','LONG',5,99),
 row('V108','c','SHORT',15,99),row('V110','d','SHORT',15,99)];
 const adapted=adaptV110ForecastJournal(records,{now});
 const result=compareV110ForwardOutcomes(adapted);
 assert.equal(result.groups.length,10);
 assert.equal(result.status,'INSUFFICIENT_MATCHED_FORWARD_DATA');
 assert.equal(result.ready,false);
 assert.equal(result.approvedForLive,false);
 const long5=result.groups.find(g=>g.horizonMinutes===5&&g.direction==='LONG');
 assert.equal(long5.baseline.favorablePct,100);
 assert.equal(long5.candidate.favorablePct,0);
 const short15=result.groups.find(g=>g.horizonMinutes===15&&g.direction==='SHORT');
 assert.equal(short15.candidate.favorablePct,100);
 assert.equal(result.groups.find(g=>g.horizonMinutes===30&&g.direction==='LONG').baseline.favorablePct,null);
});
test('empty and malformed data fail closed',()=>{
 assert.equal(compareV110ForwardOutcomes(null).status,'INVALID_INPUT');
 assert.equal(compareV110ForwardOutcomes({status:'ADAPTED',baseline:[],candidate:[]}).approvedForLive,false);
 assert.equal(compareV110ForwardOutcomes({status:'ADAPTED',baseline:[],candidate:[]},{minPaired:0}).status,'INVALID_INPUT');
});

test('only identical independent alert IDs and observation timestamps count as paired',()=>{
 const records=[
  row('V108','same','LONG',5,101),row('V110','same','LONG',5,102),
  row('V108','unmatched','LONG',5,99),row('V110','other','LONG',5,101)
 ];
 const adapted=adaptV110ForecastJournal(records,{now});
 const result=compareV110ForwardOutcomes(adapted,{minPaired:1,minDays:1});
 const g=result.groups.find(x=>x.horizonMinutes===5&&x.direction==='LONG');
 assert.equal(g.paired.n,1);
 assert.equal(g.paired.days,1);
 assert.equal(g.paired.deltaFavorablePct,0);
 assert.equal(result.status,'MATCHED_RESEARCH_ONLY');
 assert.equal(result.approvedForLive,false);
});
test('matched observations below threshold never produce lift or live approval',()=>{
 const adapted=adaptV110ForecastJournal([
  row('V108','same','SHORT',10,99),row('V110','same','SHORT',10,98)
 ],{now});
 const result=compareV110ForwardOutcomes(adapted,{minPaired:2,minDays:2});
 const g=result.groups.find(x=>x.horizonMinutes===10&&x.direction==='SHORT');
 assert.equal(g.paired.n,1);
 assert.equal(g.paired.deltaFavorablePct,null);
 assert.equal(result.ready,false);
 assert.equal(result.approvedForLive,false);
});

test('same alert and observation but different outcome timestamps must not be paired',()=>{
 const baseline=row('V108','same','LONG',5,101);
 const candidate={...row('V110','same','LONG',5,102),outcomeKnownAt:'2026-11-14T04:21:00Z'};
 const adapted=adaptV110ForecastJournal([baseline,candidate],{now});
 const result=compareV110ForwardOutcomes(adapted,{minPaired:1,minDays:1});
 const g=result.groups.find(x=>x.horizonMinutes===5&&x.direction==='LONG');
 assert.equal(g.paired.n,0);
 assert.equal(g.paired.deltaFavorablePct,null);
 assert.equal(result.ready,false);
 assert.equal(result.approvedForLive,false);
});

test('matched coverage reports excluded unmatched observations rather than hiding them',()=>{
 const adapted=adaptV110ForecastJournal([
  row('V108','same','LONG',5,101),row('V110','same','LONG',5,102),
  row('V108','baseline-only','LONG',5,99),
  row('V110','candidate-only','LONG',5,103)
 ],{now});
 const result=compareV110ForwardOutcomes(adapted,{minPaired:1,minDays:1});
 const g=result.groups.find(x=>x.horizonMinutes===5&&x.direction==='LONG');
 assert.equal(g.paired.n,1);
 assert.equal(g.paired.baselineCoveragePct,50);
 assert.equal(g.paired.candidateCoveragePct,50);
 assert.equal(result.approvedForLive,false);
});

test('research verdict rejects a worse candidate even with sufficient matched records',()=>{
 const adapted=adaptV110ForecastJournal([
  row('V108','same','LONG',5,102),row('V110','same','LONG',5,99)
 ],{now});
 const result=compareV110ForwardOutcomes(adapted,{minPaired:1,minDays:1});
 const g=result.groups.find(x=>x.horizonMinutes===5&&x.direction==='LONG');
 assert.equal(g.paired.researchVerdict,'KEEP_108');
 assert.equal(result.approvedForLive,false);
});
test('a better matched research candidate is never approved for live deployment',()=>{
 const adapted=adaptV110ForecastJournal([
  row('V108','same','LONG',5,99),row('V110','same','LONG',5,102)
 ],{now});
 const result=compareV110ForwardOutcomes(adapted,{minPaired:1,minDays:1});
 const g=result.groups.find(x=>x.horizonMinutes===5&&x.direction==='LONG');
 assert.equal(g.paired.researchVerdict,'PROMISING_RESEARCH_ONLY');
 assert.equal(result.approvedForLive,false);
});
