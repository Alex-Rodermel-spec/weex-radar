import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cli=new URL('../scripts/v110-compare-forward.mjs',import.meta.url).pathname;
test('read-only CLI reports insufficient evidence and never approves live',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v110-'));
 try{
  const file=join(dir,'outcomes.json');
  const t='2026-11-13T12:00:00Z',end='2026-11-13T12:05:00Z';
  const row=model=>({model,alertId:'same',direction:'LONG',horizonMinutes:5,entryPrice:100,outcomePrice:101,observedAt:t,outcomeKnownAt:end,source:'independent-forward'});
  writeFileSync(file,JSON.stringify([row('V108'),row('V110')]));
  const p=spawnSync(process.execPath,[cli,file],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);
  const result=JSON.parse(p.stdout);
  assert.equal(result.acceptedRows,2);
  assert.equal(result.approvedForLive,false);
  assert.equal(result.status,'INSUFFICIENT_MATCHED_FORWARD_DATA');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('read-only CLI rejects malformed input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v110-'));
 try{
  const file=join(dir,'bad.json');writeFileSync(file,'{bad');
  const p=spawnSync(process.execPath,[cli,file],{encoding:'utf8'});
  assert.equal(p.status,1);
  assert.match(p.stderr,/V110_READ_ONLY_COMPARISON_FAILED/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
