// #110 only: bounded, prospective 16-crypto follower journal on EXISTING OIDC writer.
// First freeze candidates from already CLOSED public 1m bars. Next 20m writer
// uses only strictly subsequent bars. No 108 filter, orders, notifications,
// external storage, extra cron, paid API or re-labeling of historic alerts.
import {profileSymbols,marketForecastProfile} from './market-forecast-profiles.mjs';
import {summarizeV110CryptoFollowers,scoreV110CryptoFollower} from './v110-crypto-followers-shadow.mjs';
const MIN=60000,FIVE=5*MIN,TEN=10*MIN,DAY=24*60*MIN;
const HOURS=[5,10,15],SOURCE='OIDC_JOURNAL_PROSPECTIVE_16_CRYPTO';
const SYMBOLS=profileSymbols().filter(s=>marketForecastProfile(s)?.group.endsWith('CRYPTO'));
const ALLOWED=new Set(SYMBOLS);
export const FOLLOWER_JOURNAL_LIMIT=2000,FOLLOWER_DAYS=14;
const PRICE=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const num=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<10000;
const clock=x=>Number.isSafeInteger(x)&&x>0;
const round=x=>Math.round(x*100)/100;
const empty=()=>({status:'PENDING',signedBps:null});
const rate=(n,d)=>d?Math.round(1000*n/d)/10:null;
const BERLIN=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
const dateKey=t=>{
 const p=Object.fromEntries(BERLIN.formatToParts(new Date(t)).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
};
if(SYMBOLS.length!==16)throw Error('V110_FOLLOWER_JOURNAL_UNIVERSE_NOT_16');

export function normalizeV110FollowerJournalRow(row,now=Date.now()){
 if(!row||row.source!==SOURCE||!/^[a-f0-9]{24}$/.test(row.id||'')||
  row.kind!=='POSSIBLE_LAGGING_CRYPTO_NOT_VERIFIED'||
  !ALLOWED.has(row.symbol)||!['LONG','SHORT'].includes(row.direction)||
  !PRICE(row.referencePrice)||!clock(row.frozenAt)||
  row.frozenAt>now||row.frozenAt<=now-FOLLOWER_DAYS*DAY||
  !clock(row.fiveClosedAt)||row.fiveClosedAt%FIVE!==0||
  row.fiveClosedAt>row.frozenAt||
  !clock(row.oneClosedAt)||row.oneClosedAt>row.frozenAt||
  !Array.isArray(row.leaderSymbols)||row.leaderSymbols.length<6||
  row.leaderSymbols.length>15||
  new Set(row.leaderSymbols).size!==row.leaderSymbols.length||
  row.leaderSymbols.some(s=>!ALLOWED.has(s)||s===row.symbol)||
  row.leaderCount!==row.leaderSymbols.length||
  !num(row.local5mBodyBps)||Math.abs(row.local5mBodyBps)>4||
  !row.horizons||typeof row.horizons!=='object')return null;
 const horizons={};
 for(const h of HOURS){
  const x=row.horizons[h];
  if(!x||!['PENDING','NO_DATA','OBSERVED'].includes(x.status)||
   (x.status==='OBSERVED'?!num(x.signedBps):x.signedBps!==null))
   return null;
  horizons[h]={status:x.status,signedBps:x.status==='OBSERVED'?round(x.signedBps):null};
 }
 return {source:SOURCE,id:row.id,kind:row.kind,symbol:row.symbol,
  direction:row.direction,referencePrice:row.referencePrice,
  frozenAt:row.frozenAt,fiveClosedAt:row.fiveClosedAt,
  oneClosedAt:row.oneClosedAt,leaderSymbols:row.leaderSymbols.slice().sort(),
  leaderCount:row.leaderCount,local5mBodyBps:round(row.local5mBodyBps),
  horizons};
}
function newRow(candidate,now){
 return normalizeV110FollowerJournalRow({...candidate,source:SOURCE,
  horizons:Object.fromEntries(HOURS.map(h=>[h,empty()]))},now);
}
// WEEX closed 1m only. Reject malformed, duplicate, gapped bars. Never score
// a candle until 1s after close; no future/formation look-ahead.
export function normalizeFollowerMinutes(raw,now){
 if(!Array.isArray(raw)||raw.length>200)return [];
 const unique=new Map(),bad=new Set();
 for(const x of raw){
  if(!Array.isArray(x)||x.length<6)continue;
  const [time,open,high,low,close,vol]=x.slice(0,6).map(Number);
  if(!clock(time)||time%MIN||time+MIN>now-1000||time<now-125*MIN||
   ![open,high,low,close].every(PRICE)||!num(vol)||vol<0||
   high<Math.max(open,close,low)||low>Math.min(open,close))continue;
  if(unique.has(time))bad.add(time);
  else unique.set(time,{time,closeTime:time+MIN,open,high,low,close});
 }
 for(const t of bad)unique.delete(t);
 return [...unique.values()].sort((a,b)=>a.time-b.time);
}
function snapshot(symbol,bars,now){
 const fiveClose=Math.floor((now-1000)/FIVE)*FIVE;
 const tenClose=Math.floor((now-1000)/TEN)*TEN;
 const byTime=new Map(bars.map(b=>[b.time,b]));
 const five=Array.from({length:5},(_,i)=>byTime.get(fiveClose-FIVE+i*MIN));
 const ten=Array.from({length:10},(_,i)=>byTime.get(tenClose-TEN+i*MIN));
 const one=bars.at(-1);
 if(five.some(x=>!x)||ten.some(x=>!x)||!one||now-one.closeTime>2*MIN||
  one.closeTime<fiveClose)return null;
 return {available:true,exchange:'WEEX',symbol,timeframes:[
  {intervalMinutes:1,closedAt:one.closeTime,price:one.close,direction:'NEUTRAL'},
  {intervalMinutes:5,closedAt:fiveClose,
   lastCandleBodyBps:round(10000*(five.at(-1).close/five[0].open-1)),
   direction:'NEUTRAL'},
  {intervalMinutes:10,closedAt:tenClose,direction:'NEUTRAL'}
 ]};
}
async function getSymbol(symbol,now,fetchImpl){
 const url='https://api-contract.weex.com/capi/v3/market/klines?symbol='+
  encodeURIComponent(symbol)+'&interval=1m&limit=125';
 const response=await fetchImpl(url,{cache:'no-store',
  signal:AbortSignal.timeout(4800),
  headers:{Accept:'application/json','User-Agent':'WEEX-V110-PROSPECTIVE/1.0'}});
 if(!response.ok)throw Error('WEEX_FOLLOWER_HTTP_'+response.status);
 const str=await response.text();
 if(str.length>220000)throw Error('WEEX_FOLLOWER_TOO_LARGE');
 const value=JSON.parse(str);
 return normalizeFollowerMinutes(Array.isArray(value)?value:value?.data,now);
}
export async function collectV110FollowerJournal(now=Date.now(),{fetchImpl=fetch}={}){
 const result={status:'UNAVAILABLE',sampledAt:now,validMarkets:0,
  fresh:[],candles:new Map(),frozen:0,ordersSent:0};
 if(!clock(now))return result;
 const bars=new Map();let next=0;
 async function worker(){
  while(next<SYMBOLS.length){
   const symbol=SYMBOLS[next++];
   try{bars.set(symbol,await getSymbol(symbol,now,fetchImpl))}
   catch{bars.set(symbol,[])}
  }
 }
 await Promise.all(Array.from({length:6},()=>worker()));
 const snapshots=[];
 for(const symbol of SYMBOLS){
  const x=snapshot(symbol,bars.get(symbol)||[],now);
  if(x)snapshots.push(x);
 }
 result.validMarkets=snapshots.length;
 result.candles=bars;
 if(snapshots.length!==16)
  return {...result,status:'INCOMPLETE_CRYPTO16_NO_NEW_COHORT'};
 const found=summarizeV110CryptoFollowers(snapshots,now);
 result.fresh=found.candidates.map(x=>newRow(x,now)).filter(Boolean);
 result.frozen=result.fresh.length;
 return {...result,status:found.status};
}
export function mergeV110FollowerJournal(previous,newReceipts,candles,now=Date.now()){
 if(!Array.isArray(previous)||!Array.isArray(newReceipts)||
  previous.length>FOLLOWER_JOURNAL_LIMIT||newReceipts.length>16||!clock(now))
  throw Error('V110_FOLLOWER_JOURNAL_BAD_INPUT');
 const map=new Map();let dropped=0,added=0,updated=0;
 for(const x of previous){
  const r=normalizeV110FollowerJournalRow(x,now);
  if(!r){dropped++;continue;}
  if(!map.has(r.id))map.set(r.id,r);
 }
 for(const x of newReceipts){
  const r=normalizeV110FollowerJournalRow(x,now);
  if(!r)continue;
  if(!map.has(r.id)){map.set(r.id,r);added++;}
  // A replay or retry never overwrites the FIRST frozen evidence.
 }
 // Score each frozen candidate only from 1m closes that did not exist at
 // candidate creation. Missing bars are not losses, and OBSERVED is immutable.
 for(const r of map.values()){
  const bars=candles instanceof Map?candles.get(r.symbol):null;
  const scored=Array.isArray(bars)?scoreV110CryptoFollower(r,bars,now):null;
  for(const h of HOURS){
   if(r.horizons[h].status==='OBSERVED')continue;
   const w=scored?.horizons?.[h];
   if(w?.status==='OBSERVED'&&num(w.signedBps)){
    r.horizons[h]={status:'OBSERVED',signedBps:round(w.signedBps)};
    updated++;
   }else if(r.horizons[h].status==='PENDING'&&now-r.frozenAt>125*MIN){
    r.horizons[h]={status:'NO_DATA',signedBps:null};updated++;
   }
  }
 }
 const ordered=[...map.values()].sort((a,b)=>b.frozenAt-a.frozenAt||a.id.localeCompare(b.id));
 if(ordered.length>FOLLOWER_JOURNAL_LIMIT){dropped+=ordered.length-FOLLOWER_JOURNAL_LIMIT;ordered.length=FOLLOWER_JOURNAL_LIMIT;}
 return {rows:ordered,changed:added>0||updated>0||dropped>0,added,updated,dropped};
}
export function summarizeV110FollowerJournal(rows,now=Date.now()){
 const base={mode:'V110_PROSPECTIVE_FOLLOWER_16_CRYPTO',source:SOURCE,
  status:'RESEARCH_ONLY',notTrade:true,ordersSent:0,live108Changed:false,
  automaticallyScoredByExisting20mWriter:true,archiveDays:FOLLOWER_DAYS,
  threshold:'6 leaders 5m body >=10bps, follower 5m body <=4bps',
  publication:'NOT_SENT_AS_NTFY',
  interpretation:'Signed future 1m closes, not fills, net P&L, proof of causality or real temporal leadership. Existing 10m scanner and this 20m protected prospective collector sample different timestamps. No live filter promotion without a control cohort and untouched holdout.',
  recommendation:'KEEP_108'};
 if(!Array.isArray(rows)||rows.length>FOLLOWER_JOURNAL_LIMIT||!clock(now))
  return {...base,status:'INVALID_INPUT'};
 const unique=new Map();let invalid=0;
 for(const x of rows){
  const r=normalizeV110FollowerJournalRow(x,now);
  if(!r){invalid++;continue;}
  if(!unique.has(r.id))unique.set(r.id,r);
 }
 const values=[...unique.values()],bySide={};
 for(const side of ['LONG','SHORT']){
  const cohort=values.filter(r=>r.direction===side);
  const horizons={};
  for(const h of HOURS){
   const eligible=cohort.filter(x=>x.frozenAt+(h+2)*MIN<=now);
   const observed=eligible.filter(x=>x.horizons[h].status==='OBSERVED');
   const days=new Set(observed.map(x=>dateKey(x.frozenAt)));
   const favorable=observed.filter(x=>x.horizons[h].signedBps>0).length;
   const adverse=observed.filter(x=>x.horizons[h].signedBps<0).length;
   horizons[h]={matured:eligible.length,observed:observed.length,
    noData:eligible.filter(x=>x.horizons[h].status==='NO_DATA').length,
    pending:eligible.filter(x=>x.horizons[h].status==='PENDING').length,
    favorable,adverse,flat:observed.length-favorable-adverse,
    distinctBerlinDays:days.size,coveragePct:rate(observed.length,eligible.length),
    favorablePctDescriptive:observed.length>=30&&days.size>=5?
     rate(favorable,observed.length):null};
  }
  bySide[side]={candidates:cohort.length,horizons};
 }
 return {...base,invalid,archivedCandidates:values.length,byDirection:bySide,
  minimumReportingSample:30,minimumBerlinDays:5,
  independentHoldoutProven:false,accuracyImproved:false};
}
