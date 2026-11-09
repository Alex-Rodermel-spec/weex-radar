import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {adviseSymbol,summarizeAdvisor} from '../lib/advisor.mjs';

const NOW=Date.UTC(2026,10,9,12,0,0);
const signal=(direction='SHORT')=>({
 symbol:'XRPUSDT',exchange:'WEEX',status:'ok',
 direction,level:'STRONG',
 livePrice:1.1,stop:direction==='LONG'?1.09:1.11,
 take:direction==='LONG'?1.12:1.08,
 expiresAt:NOW+90_000,entryQuality:{ok:true,rr:2},
 costReview:{mode:'SHADOW_COSTS',status:'PASS_ESTIMATE',netRR:1.7},
 retest:{[direction]:{status:'CONFIRMED',trendAligned:true}},
 indicators:{trend15:direction==='LONG'?'UP':'DOWN'}
});

test('both LONG and SHORT may be reviewed; strength is NOT the decision',()=>{
 for(const direction of ['LONG','SHORT']){
  const s=signal(direction);
  assert.equal(adviseSymbol(s,NOW).status,'REVIEW');
  assert.equal(adviseSymbol({...s,level:'NORMAL'},NOW).status,'REVIEW');
  assert.equal(adviseSymbol({...s,level:'STRONG',costReview:{
   ...s.costReview,status:'LOW_NET_RR',netRR:1.03
  }},NOW).status,'SKIP');
 }
});

test('never green for expired, stale, missing quote or missing costs',()=>{
 const x=signal();
 assert.equal(adviseSymbol({...x,expiresAt:NOW+14000},NOW).status,'SKIP');
 assert.equal(adviseSymbol({...x,expiresAt:NOW-1},NOW).status,'SKIP');
 assert.equal(adviseSymbol({...x,livePrice:null},NOW).status,'SKIP');
 assert.equal(adviseSymbol({...x,entryQuality:{ok:false}},NOW).status,'SKIP');
 assert.equal(adviseSymbol({...x,costReview:null},NOW).status,'WAIT');
 assert.equal(adviseSymbol({...x,exchange:'Bybit'},NOW).status,'WAIT');
 assert.equal(adviseSymbol({...x,costReview:{...x.costReview,netRR:null}},NOW).status,'SKIP');
 assert.equal(adviseSymbol({...x,costReview:{...x.costReview,status:'COSTS_EXCEED_TP',netRR:-.3}},NOW).status,'SKIP');
});

test('retest is required, and failed retest never gets green',()=>{
 const x=signal('LONG');
 assert.equal(adviseSymbol({...x,retest:{}},NOW).status,'WAIT');
 assert.equal(adviseSymbol({...x,retest:{LONG:{status:'FAILED'}}},NOW).status,'SKIP');
 assert.equal(adviseSymbol({...x,retest:{LONG:{status:'CONFIRMED',trendAligned:false}}},NOW).status,'WAIT');
});

test('no technical setup or exchange data cannot claim an entry',()=>{
 const x=signal();
 assert.equal(adviseSymbol({...x,direction:null,filterDiagnostic:{stage:'trend_mismatch'}},NOW).status,'NO_SETUP');
 assert.equal(adviseSymbol({...x,direction:null,filterDiagnostic:{stage:'no_breakout'}},NOW).status,'NO_SETUP');
 assert.equal(adviseSymbol({...x,status:'error'},NOW).status,'UNAVAILABLE');
 const summary=summarizeAdvisor([
  x,{...x,direction:null},{...x,livePrice:null},{...x,status:'error'}
 ],NOW);
 assert.deepEqual(summary.counts,{REVIEW:1,WAIT:0,SKIP:1,NO_SETUP:1,UNAVAILABLE:1});
 assert.equal(summary.marketCount,4);
 assert.match(summary.notices.evidence,/not demonstrated/);
});

test('advisor uses existing signals endpoint and adds no trading/scheduler functions',()=>{
 const advisor=readFileSync(new URL('../lib/advisor.mjs',import.meta.url),'utf8');
 const scanner=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../advisor.html',import.meta.url),'utf8');
 const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(scanner,/advisorOverview:summarizeAdvisor|advisorOverview,symbols/);
 assert.match(scanner,/advisor:adviseSymbol/);
 assert.match(home,/href="\/advisor\.html"/);
 assert.match(page,/fetch\('\/api\/signals'/);
 assert.match(page,/id="count-review"/);
 assert.match(page,/Нет свежих данных/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'advisor.html'}));
 for(const text of [advisor,page])
  assert.doesNotMatch(text,/\/trade-confirm|\/trade-prepare|@vercel\/blob|\/capi\/v3\/order|PUSH_CRON_KEY|NTFY_TOPIC/);
});
