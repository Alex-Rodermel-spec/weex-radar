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
 assert.equal(result.status,'DESCRIPTIVE_ONLY_UNPAIRED');
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
