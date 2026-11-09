// Routes through GET /api/signals?mode=journal / journal-export.
// Hobby serverless function quota stays unchanged.
// Only authenticated GitHub workflow may receive encrypted archive data.
import {jwtVerify,createRemoteJWKSet} from 'jose';
import {
 mergeJournal,encryptJournal,decryptJournalArchive,summarizeJournal
} from './journal-core.mjs';
import {mergeEarlyArchive} from './early-journal.mjs';
import {recentEarlyResearch} from './early-study-route.mjs';

const REPO='Alex-Rodermel-spec/weex-radar';
const WORKFLOW=REPO+'/.github/workflows/signal-journal.yml@refs/heads/main';
const ARCHIVE='https://raw.githubusercontent.com/'+REPO+
 '/journal-data/data/journal.enc.json';
const QUALITY='https://weex-radar.vercel.app/api/signals?mode=quality';
const JWKS=createRemoteJWKSet(new URL(
 'https://token.actions.githubusercontent.com/.well-known/jwks'
));
const JSON_LIMIT=2_200_000;
const headers=res=>{
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
};

async function authorizeJournal(req){
 const auth=req.headers?.authorization||'';
 if(!auth.startsWith('Bearer '))return false;
 try{
  const {payload}=await jwtVerify(auth.slice(7),JWKS,{
   issuer:'https://token.actions.githubusercontent.com',
   audience:'weex-radar-journal'
  });
  return payload.repository===REPO&&
   payload.ref==='refs/heads/main'&&
   payload.workflow_ref===WORKFLOW&&
   ['schedule','workflow_dispatch','push'].includes(payload.event_name);
 }catch{return false}
}

export async function readJournal(now=Date.now(),fetchImpl=fetch){
 // GitHub's raw CDN can cache a 404 from before the first write. Bust that
 // negative cache on each report instead of pretending the archive is empty.
 const url=ARCHIVE+'?v='+now;
 const response=await fetchImpl(url,{
  signal:AbortSignal.timeout(6500),cache:'no-store',
  headers:{Accept:'application/json'}
 });
 if(response.status===404)return {exists:false,rows:[],earlyRows:[]};
 if(!response.ok)throw Error('JOURNAL_ARCHIVE_UNAVAILABLE');
 const size=Number(response.headers?.get?.('content-length')||0);
 if(size>JSON_LIMIT)throw Error('JOURNAL_ARCHIVE_TOO_LARGE');
 const raw=await response.text();
 if(raw.length>JSON_LIMIT)throw Error('JOURNAL_ARCHIVE_TOO_LARGE');
 const envelope=JSON.parse(raw);
 return {exists:true,...decryptJournalArchive(envelope)};
}
async function recentQuality(fetchImpl=fetch){
 const r=await fetchImpl(QUALITY,{
  signal:AbortSignal.timeout(19000),cache:'no-store',
  headers:{Accept:'application/json'}
 });
 if(!r.ok)throw Error('JOURNAL_QUALITY_UNAVAILABLE');
 const result=await r.json();
 if(!Array.isArray(result.signals)||result.source!=='sent ntfy confirmed alerts (WEEX only)'||
   result.signals.length>200)throw Error('JOURNAL_QUALITY_INVALID');
 return result.signals;
}

export async function handleJournal(req,res,mode){
 headers(res);
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(mode==='journal-export'){
  if(!await authorizeJournal(req))return res.status(401).json({
   error:'Unauthorized journal writer'
  });
 }
 const now=Date.now();
 try{
  const {exists,rows,earlyRows}=await readJournal(now);
  if(mode==='journal'){
   return res.status(200).json({
    state:exists?'READY':'EMPTY',persistent:exists,
    encryptedAtRest:true,repositoryContentsArePublic:true,
    ...summarizeJournal(rows,now,earlyRows)
   });
  }
  if(mode!=='journal-export')return res.status(400).json({error:'Bad mode'});
  // Reuse the EXISTING OIDC-authorized 20-minute GitHub writer. No new job,
  // secrets, trading calls or storage service. The early collector is read-only.
  // A temporary ntfy or WEEX failure must not erase existing early history.
  const [current,research]=await Promise.all([
   recentQuality(),recentEarlyResearch(now).catch(()=>null)
  ]);
  const merged=mergeJournal(rows,current,now);
  const earlyMerged=mergeEarlyArchive(earlyRows,research?.study?.rows??[],now);
  if(!merged.changed&&!earlyMerged.changed)return res.status(200).json({
   ok:true,changed:false,existing:rows.length,received:current.length,
   existingEarly:earlyRows.length,receivedEarly:research?.study?.rows?.length??0
  });
  const envelope=encryptJournal(merged.rows,process.env,earlyMerged.rows);
  const contentBase64=Buffer.from(JSON.stringify(envelope)+'\n').toString('base64');
  return res.status(200).json({
   ok:true,changed:true,contentBase64,
   added:merged.added,updated:merged.updated,dropped:merged.dropped,
   total:merged.rows.length,
   earlyAdded:earlyMerged.added,earlyUpdated:earlyMerged.updated,
   earlyDropped:earlyMerged.dropped,earlyTotal:earlyMerged.rows.length
  });
 }catch(e){
  console.warn('WEEX_RADAR_JOURNAL_ERROR '+String(e?.message||e).slice(0,75));
  return res.status(503).json({
   error:'Журнал временно недоступен. Сканер и уведомления работают независимо.'
  });
 }
}
