import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const cli=new URL('../scripts/v110-update-and-review.mjs',import.meta.url).pathname;
const base={symbol:'XRPUSDT',alertId:'a',direction:'LONG',horizonMinutes:5,entryPrice:100,outcomePrice:101,observedAt:'2026-11-13T12:00:00Z',evaluatedAt:'2026-11-13T12:05:00Z',outcomeKnownAt:'2026-11-13T12:05:01Z',source:'independent-forward'};
test('private pipeline accumulates and compares same-market observations without live approval',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v110-pipeline-'));
 try{
  const store=join(dir,'store.json'),batch=join(dir,'batch.json');
  writeFileSync(batch,JSON.stringify([{...base,model:'V108'},{...base,model:'V110'}]));
  const run=()=>spawnSync(process.execPath,[cli,store,batch],{encoding:'utf8'});
  const first=run();assert.equal(first.status,0,first.stderr);
  const report=JSON.parse(first.stdout);assert.equal(report.approvedForLive,false);
  assert.equal(report.priceAudit.consistent,1);
  assert.equal(run().status,0);
  assert.equal(JSON.parse(readFileSync(store,'utf8')).length,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('pipeline rejects conflicting paired market prices before writing journal',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v110-pipeline-'));
 try{
  const store=join(dir,'store.json'),batch=join(dir,'batch.json');
  writeFileSync(batch,JSON.stringify([{...base,model:'V108'},{...base,model:'V110',outcomePrice:110}]));
  const result=spawnSync(process.execPath,[cli,store,batch],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/CONFLICTING_PAIRED_MARKET_PRICES/);
  assert.equal(existsSync(store),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
