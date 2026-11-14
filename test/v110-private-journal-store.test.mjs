import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendV110VerifiedJournal} from '../lib/v110-private-journal-store.mjs';
const row={model:'V108',symbol:'XRPUSDT',alertId:'a',direction:'LONG',horizonMinutes:5,entryPrice:100,outcomePrice:101,observedAt:'2026-11-14T01:00:00Z',evaluatedAt:'2026-11-14T01:05:00Z',outcomeKnownAt:'2026-11-14T01:05:01Z',source:'independent-forward'};
test('private journal accumulates verified observations and ignores exact replay',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v110-journal-'));
 try{
  const file=join(dir,'private.json');
  assert.equal((await appendV110VerifiedJournal(file,[row])).added,1);
  assert.equal((await appendV110VerifiedJournal(file,[row])).duplicates,1);
  assert.equal((await appendV110VerifiedJournal(file,[{...row,model:'V110'}])).total,2);
  assert.equal(JSON.parse(await readFile(file,'utf8')).length,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('private journal refuses conflicting replay without altering original data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v110-journal-'));
 try{
  const file=join(dir,'private.json');
  await appendV110VerifiedJournal(file,[row]);
  await assert.rejects(appendV110VerifiedJournal(file,[{...row,outcomePrice:99}]),/CONFLICTING_FORWARD_ROW/);
  assert.equal(JSON.parse(await readFile(file,'utf8'))[0].outcomePrice,101);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('private journal refuses backtest rows',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v110-journal-'));
 try{await assert.rejects(appendV110VerifiedJournal(join(dir,'private.json'),[{...row,source:'backtest'}]),/UNVERIFIED_FORWARD_ROW/);}
 finally{await rm(dir,{recursive:true,force:true});}
});
