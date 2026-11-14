// Research-only append-only forward journal store on a private local filesystem.
// No network calls, secrets, live trading or automatic deployments.
import {readFile,writeFile,rename,mkdir,open} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const identity=r=>[r.model,r.symbol,r.alertId,r.horizonMinutes,r.observedAt].join('|');
export async function appendV110VerifiedJournal(path,rows){
 if(typeof path!=='string'||!path||!Array.isArray(rows)||rows.length===0)
  throw Error('INVALID_JOURNAL_INPUT');
 for(const r of rows){
  if(!r||!['V108','V110'].includes(r.model)||!r.symbol||!r.alertId||
   ![1,5,10,15,30].includes(r.horizonMinutes)||!['LONG','SHORT'].includes(r.direction)||
   r.source!=='independent-forward'||![r.entryPrice,r.outcomePrice].every(x=>Number.isFinite(x)&&x>0)||
   ![r.observedAt,r.evaluatedAt,r.outcomeKnownAt].every(x=>typeof x==='string'&&Number.isFinite(Date.parse(x)))||
   Math.abs(Date.parse(r.evaluatedAt)-Date.parse(r.observedAt)-r.horizonMinutes*60000)>5000||
   Date.parse(r.outcomeKnownAt)<Date.parse(r.evaluatedAt))throw Error('UNVERIFIED_FORWARD_ROW');
 }
 let existing=[];
 try{existing=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!Array.isArray(existing))throw Error('INVALID_EXISTING_JOURNAL');
 const seen=new Map();
 for(const r of existing){const k=identity(r),v=JSON.stringify(r);if(seen.has(k))throw Error('DUPLICATED_EXISTING_JOURNAL');seen.set(k,v);}
 const batchSeen=new Set();
 for(const r of rows){const k=identity(r);if(batchSeen.has(k))throw Error('DUPLICATED_BATCH_ROW');batchSeen.add(k);}
 let added=0,duplicates=0;
 for(const r of rows){
  const k=identity(r),v=JSON.stringify(r);
  if(seen.has(k)){
   if(seen.get(k)!==v)throw Error('CONFLICTING_FORWARD_ROW');
   duplicates++;continue;
  }
  seen.set(k,v);existing.push(r);added++;
 }
 if(!added)return {added,duplicates,total:existing.length};
 await mkdir(dirname(path),{recursive:true,mode:0o700});
 const temp=path+'.'+randomUUID()+'.tmp';
 try{
  const handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(existing)+'\n');await handle.sync();}finally{await handle.close();}
  await rename(temp,path);
 }catch(e){throw e;}
 return {added,duplicates,total:existing.length};
}
