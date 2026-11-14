import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearseV110Release as rehearse} from '../lib/v110-vercel-release-simulator.mjs';
const a='dpl_AAAAAAAAAAAA',b='dpl_BBBBBBBBBBBB';
const fixture=()=>({
 plan:{status:'PLAN_ONLY',productionChanged:false,requiresExternalController:true,
 operations:[{kind:'VERIFY_ROLLBACK_TARGET',deploymentId:a},{kind:'VERIFY_STAGED_PRODUCTION_BUILD',deploymentId:b}]},
 baseline:{id:a,target:'production',state:'READY'},
 candidate:{id:b,target:'production',state:'READY',staged:true,domainsAssigned:false},
 observations:[{fresh:true,healthy:true,qualityNonRegressing:true}]
});
test('rehearses promotion without touching production',()=>{
 const r=rehearse(fixture());assert.equal(r.status,'PROMOTION_REHEARSED');
 assert.equal(r.productionChanged,false);assert.equal(r.canTrade,false);
});
test('regression and missing monitoring rehearse rollback to pinned baseline',()=>{
 for(const observations of [[],[{fresh:false,healthy:true,qualityNonRegressing:true}],
  [{fresh:true,healthy:false,qualityNonRegressing:true}]]){
  const r=rehearse({...fixture(),observations});
  assert.equal(r.status,'ROLLBACK_REHEARSED');
  assert.deepEqual(r.events.at(-1),{action:'SIMULATE_ROLLBACK',deploymentId:a});
  assert.equal(r.productionChanged,false);
 }
});
test('preview or unpinned candidates cannot be promoted',()=>{
 for(const candidate of [{...fixture().candidate,target:null},
  {...fixture().candidate,domainsAssigned:true},{...fixture().candidate,id:'dpl_CCCCCCCCCCCC'}]){
  const r=rehearse({...fixture(),candidate});
  assert.equal(r.status,'BLOCKED');assert.deepEqual(r.events,[]);
 }
});
