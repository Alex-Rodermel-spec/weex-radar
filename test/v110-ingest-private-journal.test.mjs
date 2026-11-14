import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const cli=new URL('../scripts/v110-ingest-private-journal.mjs',import.meta.url).pathname;
const row={model:'V108',symbol:'XRPUSDT',alertId:'a',direction:'LONG',horizonMinutes:5,entryPrice:100,outcomePrice:101,observedAt:'2026-11-13T12:00:00Z',evaluatedAt:'2026-11-13T12:05:00Z',outcomeKnownAt:'2026-11-13T12:05:01Z',source:'independent-forward'};
test('offline ingest persists verified observations without replay duplication',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v110-ingest-'));
 try{
  const store=join(dir,'store.json'),batch=join(dir,'batch.json');
  writeFileSync(batch,JSON.stringify([row]));
  const run=()=>spawnSync(process.execPath,[cli,store,batch],{encoding:'utf8'});
  assert.equal(run().status,0);assert.equal(run().status,0);
  assert.equal(JSON.parse(readFileSync(store,'utf8')).length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('offline ingest rejects unverified input and creates no store',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v110-ingest-'));
 try{
  const store=join(dir,'store.json'),batch=join(dir,'batch.json');
  writeFileSync(batch,JSON.stringify([{...row,source:'backtest'}]));
  const result=spawnSync(process.execPath,[cli,store,batch],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/UNVERIFIED_OR_DUPLICATED_BATCH/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
