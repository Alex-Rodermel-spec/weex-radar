import test from 'node:test';
import assert from 'node:assert/strict';
import {runV110SwitchLab as run} from '../lib/v110-isolated-switch-lab.mjs';
const baseline={id:'dpl_AAAAAAAAAAAA',environment:'preview',ready:true,project:'weex-radar'};
const candidate={id:'dpl_BBBBBBBBBBBB',environment:'preview',ready:true,project:'weex-radar'};
const input=()=>({baseline,candidate,checks:[{fresh:true,healthy:true,qualityNonRegressing:true}]});
test('switch rehearsal never touches production',()=>{
 const r=run(input());assert.equal(r.status,'SWITCH_REHEARSED');
 assert.equal(r.productionChanged,false);assert.equal(r.canTrade,false);
});
test('monitoring regression restores pinned preview baseline',()=>{
 const r=run({...input(),checks:[{fresh:false,healthy:true,qualityNonRegressing:true}]});
 assert.equal(r.status,'RESTORE_REHEARSED');
 assert.deepEqual(r.events.at(-1),{action:'SIMULATE_RESTORE',to:baseline.id});
});
test('production, missing monitoring, and same deployment fail closed',()=>{
 for(const p of [{candidate:{...candidate,environment:'production'}},
  {candidate:baseline},{checks:[]}]){
  const r=run({...input(),...p});assert.equal(r.status,'BLOCKED');
  assert.deepEqual(r.events,[]);
 }
});
