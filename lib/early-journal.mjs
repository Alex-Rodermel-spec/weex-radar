// Long-term RESEARCH archive of notifications actually accepted by ntfy.
// Only encrypted in the pre-existing GitHub data-only journal. No trades,
// exchange keys, new storage service, signal filters or extra cron schedule.
export const MAX_EARLY_ROWS=2000;
export const EARLY_ARCHIVE_DAYS=90;
const DAY=86400000,MINUTE=60000;
const horizons=[5,15,30],statuses=new Set(['OBSERVED','PENDING','NO_DATA']);
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const positive=n=>finite(n)&&n>0;
const round=(x,d=2)=>Number(x.toFixed(d));
function windowRow(row){
 if(!row||!statuses.has(row.status))return null;
 if(row.status!=='OBSERVED')return {status:row.status,moveBps:null,favorableBps:null,adverseBps:null};
 if(!['moveBps','favorableBps','adverseBps'].every(key=>
  finite(row[key])&&Math.abs(row[key])<=1e6))return null;
 return {status:'OBSERVED',moveBps:round(row.moveBps),
  favorableBps:round(row.favorableBps),adverseBps:round(row.adverseBps)};
}
function confirmationRow(c){
 if(c===null||c===undefined)return null;
 if(!finite(c.delayMinutes)||c.delayMinutes<=0||c.delayMinutes>30||
    !finite(c.chaseBps)||Math.abs(c.chaseBps)>1e6)return null;
 return {delayMinutes:round(c.delayMinutes,1),chaseBps:round(c.chaseBps)};
}
export function normalizeEarlyArchiveRow(row,now=Date.now()){
 if(!row||!/^[A-Z0-9]{2,24}$/.test(row.symbol||'')||
    !['LONG','SHORT'].includes(row.direction)||
    !['PRE_BREAK','BREAKOUT'].includes(row.watchType)||
    !positive(row.entry)||!Number.isSafeInteger(row.sentAt)||
    row.sentAt<=now-EARLY_ARCHIVE_DAYS*DAY||row.sentAt>now+5000||
    !row.windows||typeof row.windows!=='object')return null;
 const windows={};
 for(const h of horizons){
  const x=windowRow(row.windows[h]);
  if(!x)return null;
  windows[h]=x;
 }
 const confirmation=confirmationRow(row.confirmation);
 return {symbol:row.symbol,direction:row.direction,watchType:row.watchType,
  entry:round(row.entry,10),sentAt:row.sentAt,windows,confirmation};
}
export const earlyArchiveKey=x=>[x.symbol,x.direction,x.watchType,x.sentAt,x.entry].join('|');
export function mergeEarlyArchive(previous,current,now=Date.now()){
 if(!Array.isArray(previous)||!Array.isArray(current)||
    previous.length>MAX_EARLY_ROWS||current.length>200)
  throw Error('EARLY_ARCHIVE_SIZE_LIMIT');
 const map=new Map();let dropped=0,added=0,updated=0;
 for(const old of previous){
  const row=normalizeEarlyArchiveRow(old,now);
  if(!row){dropped++;continue}
  map.set(earlyArchiveKey(row),row);
 }
 for(const x of current){
  const row=normalizeEarlyArchiveRow(x,now);
  if(!row)continue;
  const key=earlyArchiveKey(row),old=map.get(key);
  if(!old){map.set(key,row);added++;continue}
  const windows={...old.windows};let changed=false;
  for(const h of horizons){
   // NEVER replace a measured 5/15/30m result with missing data.
   if(old.windows[h].status==='OBSERVED')continue;
   if(row.windows[h].status==='OBSERVED'){
    windows[h]=row.windows[h];changed=true;
   }else if(old.windows[h].status==='PENDING'&&
      row.windows[h].status==='NO_DATA'){
    windows[h]=row.windows[h];changed=true;
   }
  }
  const confirmation=old.confirmation||row.confirmation;
  if(!old.confirmation&&confirmation)changed=true;
  if(changed){map.set(key,{...old,windows,confirmation});updated++}
 }
 const sorted=[...map.values()].sort((a,b)=>b.sentAt-a.sentAt);
 const overflow=Math.max(0,sorted.length-MAX_EARLY_ROWS);
 return {rows:sorted.slice(0,MAX_EARLY_ROWS),
  changed:added>0||updated>0||dropped>0||overflow>0,
  added,updated,dropped:dropped+overflow,truncated:overflow>0};
}
function windowStats(rows,h){
 const observed=rows.map(r=>r.windows[h]).filter(x=>x.status==='OBSERVED');
 const favorable=observed.filter(x=>x.moveBps>0).length;
 const adverse=observed.filter(x=>x.moveBps<0).length;
 const mean=observed.length?round(
  observed.reduce((sum,x)=>sum+x.moveBps,0)/observed.length):null;
 return {observed:observed.length,pending:rows.filter(r=>r.windows[h].status==='PENDING').length,
  noData:rows.filter(r=>r.windows[h].status==='NO_DATA').length,
  favorable,adverse,flat:observed.length-favorable-adverse,
  favorablePct:observed.length?round(100*favorable/observed.length,1):null,
  meanDirectionBps:mean};
}
export function summarizeEarlyArchive(rows,now=Date.now()){
 const periods={};
 for(const days of [30,90]){
  const selected=rows.filter(x=>x.sentAt>now-days*DAY&&x.sentAt<=now);
  const types={};
  for(const type of ['PRE_BREAK','BREAKOUT']){
   const group=selected.filter(x=>x.watchType===type);
   types[type]={total:group.length,at5m:windowStats(group,5),
    at15m:windowStats(group,15),at30m:windowStats(group,30)};
  }
  const pairs=selected.map(x=>x.confirmation).filter(Boolean);
  periods[days]={total:selected.length,at5m:windowStats(selected,5),
   at15m:windowStats(selected,15),at30m:windowStats(selected,30),
   types,pairs:{confirmedWithin30m:pairs.length,
    meanChaseBps:pairs.length?round(pairs.reduce((s,x)=>s+x.chaseBps,0)/pairs.length):null}};
 }
 return {archivedEarly:rows.length,archiveDays:EARLY_ARCHIVE_DAYS,
  maxArchivedEarly:MAX_EARLY_ROWS,windows:periods,
  source:'Real WEEX ntfy EARLY WATCH and PRE_BREAK alerts, not hypothetical candidates',
  caveat:'Closed 1m candle direction from rounded ntfy price, NOT executed trades, net profit or a calibrated forecast. Missing samples and scheduling gaps are not recovered.'};
}
