import {summarizeForecastConfirmationStudy} from './forecast-confirmation-study.mjs';
// Private 90-day market-signal journal, encrypted at rest in a public GitHub
// data-only branch. No API credentials/owner data/ntfy topic are serialized.
// Public reports expose only aggregate simulated candle-touch outcomes.
// The current signal selection, cron, push and trading routes are unchanged.
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {summarizeEarlyArchive,MAX_EARLY_ROWS} from './early-journal.mjs';
import {summarizeForecastArchive,MAX_FORECAST_ROWS,berlinDayKey} from './forecast-journal.mjs';
import {summarizeConfirmedDirectionArchive,MAX_CONFIRMED_AUDIT_ROWS} from './confirmed-direction-journal.mjs';

export const JOURNAL_DAYS=90;
export const RESEARCH_GOAL_SIGNALS=100;
export const MAX_ARCHIVE_ROWS=10000;
const DAY=24*60*60*1000;
const statuses=new Set(['TP','SL','PENDING','TIMEOUT','AMBIGUOUS','INTRABAR','NO_DATA']);
const directions=new Set(['LONG','SHORT']);
const levels=new Set(['STRONG','NORMAL']);
const shadows=new Set(['SKIP','OBSERVE','LEGACY']);
const prioritization={PENDING:0,NO_DATA:1,TIMEOUT:2,INTRABAR:3,AMBIGUOUS:3,TP:4,SL:4};
// Keep the public encrypted envelope under the existing 2.2 MB fetch cap.
// Expand the UNCOMPRESSED internal research archive only, safely compressed
// BEFORE AES-GCM; legacy uncompressed v1 archives remain readable.
const MAX_CIPHER_BYTES=1_800_000;
const MAX_PLAIN_BYTES=8_000_000;
const ARCHIVE_COMPRESSION='deflate-raw';
const aad=Buffer.from('WEEX-RADAR-JOURNAL-v1');

function finite(n){return typeof n==='number'&&Number.isFinite(n)}
function round(n,digits=2){return Number(n.toFixed(digits))}
function allowedRow(s,now){
 return s&&typeof s.symbol==='string'&&/^[A-Z0-9]{2,24}$/.test(s.symbol)&&
  directions.has(s.direction)&&levels.has(s.level)&&
  finite(s.entry)&&s.entry>0&&finite(s.stop)&&s.stop>0&&
  finite(s.take)&&s.take>0&&finite(s.sentAt)&&
  s.sentAt>now-JOURNAL_DAYS*DAY&&s.sentAt<=now+5000&&
  statuses.has(s.status)&&shadows.has(s.shadow)&&
  (s.outcomeAt===null||s.outcomeAt===undefined||finite(s.outcomeAt))&&
  (s.direction==='LONG'?s.stop<s.entry&&s.entry<s.take:
   s.take<s.entry&&s.entry<s.stop);
}

export function normalizeJournalRow(row,now=Date.now()){
 if(!allowedRow(row,now))return null;
 const n={
  symbol:row.symbol,direction:row.direction,level:row.level,
  entry:round(row.entry,8),stop:round(row.stop,8),take:round(row.take,8),
  sentAt:row.sentAt,shadow:row.shadow,status:row.status,
  outcomeAt:row.outcomeAt??null
 };
 // No trade sizes, API tokens, push topics or personal account details.
 return n;
}
export function journalKey(row){
 return [row.symbol,row.direction,row.sentAt,row.entry].join('|');
}

export function mergeJournal(previous,current,now=Date.now()){
 if(!Array.isArray(previous)||!Array.isArray(current))
  throw Error('JOURNAL_INVALID_LIST');
 if(previous.length>MAX_ARCHIVE_ROWS||current.length>200)
  throw Error('JOURNAL_SIZE_LIMIT');
 const map=new Map();
 let dropped=0,added=0,updated=0;
 for(const x of previous){
  const row=normalizeJournalRow(x,now);
  if(!row){dropped++;continue}
  map.set(journalKey(row),row);
 }
 for(const x of current){
  const row=normalizeJournalRow(x,now);
  if(!row)continue;
  const key=journalKey(row),old=map.get(key);
  if(!old){map.set(key,row);added++;continue}
  // Never reverse a settled outcome into PENDING/NO_DATA just because short
  // WEEX minute feeds have rotated out. Preserve the first settled result.
  if(['TP','SL','TIMEOUT','AMBIGUOUS','INTRABAR'].includes(old.status))continue;
  if(prioritization[row.status]>prioritization[old.status]||
    (row.status==='NO_DATA'&&old.status==='PENDING')){
   map.set(key,row);updated++;
  }
 }
 if(map.size>MAX_ARCHIVE_ROWS)throw Error('JOURNAL_TOO_MANY_SIGNALS');
 const rows=[...map.values()].sort((a,b)=>b.sentAt-a.sentAt);
 return {rows,changed:added>0||updated>0||dropped>0,added,updated,dropped};
}

function keyFromEnvironment(env=process.env){
 const key=env.PUSH_CRON_KEY,topic=env.NTFY_TOPIC;
 if(typeof key!=='string'||key.length<20||
    typeof topic!=='string'||topic.length<16)
  throw Error('JOURNAL_KEY_NOT_CONFIGURED');
 // Domain separation: reuse existing secrets WITHOUT sharing them with
 // GitHub Actions or storing them in the repo.
 return createHash('sha256').update('weex:journal:v1\0').update(key)
  .update('\0').update(topic).digest();
}
export function encryptJournal(rows,env=process.env,earlyRows=[],forecastRows=[],confirmedAuditRows=[]){
 if(!Array.isArray(rows)||rows.length>MAX_ARCHIVE_ROWS||
    !Array.isArray(earlyRows)||earlyRows.length>MAX_EARLY_ROWS||
    !Array.isArray(forecastRows)||forecastRows.length>MAX_FORECAST_ROWS||
    !Array.isArray(confirmedAuditRows)||confirmedAuditRows.length>MAX_CONFIRMED_AUDIT_ROWS)
  throw Error('JOURNAL_SIZE_LIMIT');
 const plaintext=Buffer.from(JSON.stringify({version:1,days:JOURNAL_DAYS,rows,earlyRows,forecastRows,confirmedAuditRows}));
 if(plaintext.length>MAX_PLAIN_BYTES)throw Error('JOURNAL_TOO_LARGE');
 const compact=deflateRawSync(plaintext,{level:6});
 if(compact.length>MAX_CIPHER_BYTES)throw Error('JOURNAL_TOO_LARGE');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keyFromEnvironment(env),iv);
 cipher.setAAD(aad);
 const ciphertext=Buffer.concat([cipher.update(compact),cipher.final()]);
 return {version:1,algorithm:'aes-256-gcm',compression:ARCHIVE_COMPRESSION,
  iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),
  ciphertext:ciphertext.toString('base64url')};
}
export function decryptJournalArchive(envelope,env=process.env){
 if(!envelope||envelope.version!==1||envelope.algorithm!=='aes-256-gcm'||
    !['iv','tag','ciphertext'].every(k=>typeof envelope[k]==='string'))
  throw Error('JOURNAL_BAD_ENVELOPE');
 if(envelope.compression!==undefined&&envelope.compression!==ARCHIVE_COMPRESSION)
  throw Error('JOURNAL_BAD_COMPRESSION');
 if(envelope.ciphertext.length>Math.ceil(MAX_CIPHER_BYTES*4/3)+100)
  throw Error('JOURNAL_ARCHIVE_TOO_LARGE');
 const iv=Buffer.from(envelope.iv,'base64url'),
  tag=Buffer.from(envelope.tag,'base64url');
 if(iv.length!==12||tag.length!==16)throw Error('JOURNAL_BAD_CRYPTO');
 const decipher=createDecipheriv('aes-256-gcm',keyFromEnvironment(env),iv);
 decipher.setAAD(aad);decipher.setAuthTag(tag);
 const payload=Buffer.concat([
  decipher.update(Buffer.from(envelope.ciphertext,'base64url')),decipher.final()
 ]);
 // Authenticated, bounded decompression. A tampered archive or compression
 // marker cannot silently produce plausible historical research results.
 const raw=envelope.compression===ARCHIVE_COMPRESSION?
  inflateRawSync(payload,{maxOutputLength:MAX_PLAIN_BYTES}):payload;
 if(raw.length>(envelope.compression===ARCHIVE_COMPRESSION?
  MAX_PLAIN_BYTES:MAX_CIPHER_BYTES))throw Error('JOURNAL_ARCHIVE_TOO_LARGE');
 const doc=JSON.parse(raw.toString('utf8'));
 if(doc.version!==1||doc.days!==JOURNAL_DAYS||!Array.isArray(doc.rows)||
   doc.rows.length>MAX_ARCHIVE_ROWS||!Array.isArray(doc.earlyRows??[])||
   (doc.earlyRows??[]).length>MAX_EARLY_ROWS||
   !Array.isArray(doc.forecastRows??[])||
   (doc.forecastRows??[]).length>MAX_FORECAST_ROWS||
   !Array.isArray(doc.confirmedAuditRows??[])||
   (doc.confirmedAuditRows??[]).length>MAX_CONFIRMED_AUDIT_ROWS)
  throw Error('JOURNAL_INVALID_BODY');
 // Legacy encrypted v1 archives had only confirmed rows; preserve support.
 return {rows:doc.rows,earlyRows:doc.earlyRows??[],forecastRows:doc.forecastRows??[],
   confirmedAuditRows:doc.confirmedAuditRows??[]};
}
export function decryptJournal(envelope,env=process.env){
 return decryptJournalArchive(envelope,env).rows;
}

export function summarizeWindow(rows,days,now=Date.now()){
 const selected=rows.filter(x=>x.sentAt>now-days*DAY&&x.sentAt<=now);
 const counts={TP:0,SL:0,PENDING:0,TIMEOUT:0,AMBIGUOUS:0,INTRABAR:0,NO_DATA:0};
 const byMarket=new Map(),byDirection=new Map(),byShadow=new Map();
 let sumR=0;
 const inc=(map,key,row)=>{
  if(!map.has(key))map.set(key,{name:key,total:0,TP:0,SL:0,resolved:0});
  const target=map.get(key);target.total++;
  if(row.status==='TP'||row.status==='SL'){
   target[row.status]++;target.resolved++;
  }
 };
 for(const row of selected){
  if(!statuses.has(row.status))continue;
  counts[row.status]++;
  inc(byMarket,row.symbol,row);
  inc(byDirection,row.direction,row);
  inc(byShadow,row.shadow,row);
  if(row.status==='TP')
   sumR+=(row.direction==='LONG'?
    (row.take-row.entry)/(row.entry-row.stop):
    (row.entry-row.take)/(row.stop-row.entry));
  if(row.status==='SL')sumR-=1;
 }
 const resolved=counts.TP+counts.SL;
 const expose=map=>[...map.values()].map(x=>({
  ...x,hitRatePct:x.resolved?round(x.TP/x.resolved*100,1):null
 })).sort((a,b)=>b.resolved-a.resolved||b.total-a.total||a.name.localeCompare(b.name));
 return {
  days,total:selected.length,resolved,...counts,
  hitRatePct:resolved?round(counts.TP/resolved*100,1):null,
  illustrativeAverageR:resolved?round(sumR/resolved,3):null,
  byMarket:expose(byMarket),byDirection:expose(byDirection),
  byShadow:expose(byShadow)
 };
}
export function summarizeJournal(rows,now=Date.now(),earlyRows=[],forecastRows=[],confirmedAuditRows=[]){
 const window30=summarizeWindow(rows,30,now),window90=summarizeWindow(rows,90,now);
 const collected=window90.total;
 const berlinDate=berlinDayKey(now);
 const confirmedToday=rows.filter(r=>r.sentAt<=now&&berlinDayKey(r.sentAt)===berlinDate).length;
 return {generatedAt:now,archiveDays:JOURNAL_DAYS,archivedSignals:rows.length,
  today:{dateBerlin:berlinDate,timeZone:'Europe/Berlin',
   confirmedAlertsArchived:confirmedToday,forecastAlertsArchived:forecastRows.filter(r=>
    r.sentAt<=now&&berlinDayKey(r.sentAt)===berlinDate).length,
   note:'Only archived actual ntfy alerts in Berlin local calendar day; not scans, preliminary models, or verified phone delivery.'},
  researchGoal:{
   target:RESEARCH_GOAL_SIGNALS,collected,remaining:Math.max(0,RESEARCH_GOAL_SIGNALS-collected),
   reached:collected>=RESEARCH_GOAL_SIGNALS,resolved:window90.resolved,
   basis:'Rolling 90-day archive of confirmed ntfy alerts; candle-only outcomes, not live trades',
   note:'100 alerts is a study checkpoint, NOT proof of profitability or a safe win rate.'
  },
  earlyStudy:summarizeEarlyArchive(earlyRows,now),
  forecastStudy:summarizeForecastArchive(forecastRows,now),
  confirmedDirectionStudy:summarizeConfirmedDirectionArchive(confirmedAuditRows,now),
  forecastConfirmationStudy:summarizeForecastConfirmationStudy(rows,forecastRows,now),
  firstSignalAt:rows.length?rows.at(-1).sentAt:null,
  lastSignalAt:rows.length?rows[0].sentAt:null,
  windows:{30:window30,90:window90},
  description:'Only confirmed WEEX ntfy alerts, theoretical 1m candle TP/SL touch within 60 minutes.',
  limitations:'No actual order fills, fees, funding, spread, slippage or realized P&L. Missing minutes and ambiguous outcomes excluded from TP/SL rate.',
  privacy:'Individual signals encrypted in GitHub; only aggregate statistics returned here.'
 };
}
