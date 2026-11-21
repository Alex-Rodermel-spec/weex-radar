// Frozen independent V5-only cohort, sampled BEFORE future prices on the
// existing 20m OIDC writer. Reuses 4 existing WEEX 1m/5m snapshots and the
// existing 16-crypto minute data for later scoring. No extra market queries,
// notification, trade or auto-promotion. Old ntfy-only cohort is biased.
import {createHash} from 'node:crypto';
import {profileSymbols,marketForecastProfile} from './market-forecast-profiles.mjs';

const MIN=60_000,DAY=86_400_000,LOOKBACK=14*DAY,HORIZONS=[5,15];
const SYMBOLS=profileSymbols().filter(x=>marketForecastProfile(x)?.group.endsWith('CRYPTO'));
const ALLOWED=new Set(SYMBOLS),SIDES=new Set(['LONG_BIAS','SHORT_BIAS','MIXED']);
const goodPrice=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const goodMove=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000;
const clock=n=>Number.isSafeInteger(n)&&n>0;
const round=n=>Math.round(n*100)/100;
const pct=(n,d)=>d?round(n/d*100):null;
const day=n=>new Date(n).toISOString().slice(0,10);
const empty=()=>({status:'PENDING',moveBps:null});
export const V5_INDEPENDENT_LIMIT=2400;
export const V5_INDEPENDENT_POLICY=Object.freeze({
 version:'v110-v5-independent-crypto16-prospective-v1',
 source:'EXISTING_20M_OIDC_ROTATING_4_OF_16_WEEX_CRYPTO',
 samplesPerWriterRunMax:4,marketRequestsAdded:0,maxRows:V5_INDEPENDENT_LIMIT,
 horizonsMinutes:HORIZONS,archiveDays:14,
 minimumObservedPerSide:40,minimumDistinctUtcDays:3,
 minimumSharedComparisons:80,minimumSharedDays:5,
 minimumCoveragePct:85,requiresSeparateProspectiveForwardReview:true,
 noNewCron:true,noNewPush:true,ordersSent:0,
 liveV4Unchanged:true,live108Unchanged:true,autoPromotion:false
});
if(SYMBOLS.length!==16)throw Error('V5_UNIVERSE_NOT_16');

export function normalizeV5IndependentRow(row,now=Date.now()){
 if(!row||row.source!==V5_INDEPENDENT_POLICY.source||
  !/^[a-f0-9]{24}$/.test(row.id||'')||
  !ALLOWED.has(row.symbol)||!SIDES.has(row.legacyDirection)||
  !SIDES.has(row.v5Direction)||!goodPrice(row.referencePrice)||
  !clock(row.frozenAt)||row.frozenAt>now||row.frozenAt<=now-LOOKBACK||
  !clock(row.oneClosedAt)||row.oneClosedAt>row.frozenAt||
  !clock(row.fiveClosedAt)||row.fiveClosedAt>row.frozenAt||
  row.fiveClosedAt%(5*MIN)!==0||
  row.oneClosedAt<row.fiveClosedAt||
  row.oneClosedAt-row.fiveClosedAt>=5*MIN||!row.horizons)return null;
 const horizons={};
 for(const h of HORIZONS){
  const x=row.horizons[h];
  if(!x||!['PENDING','NO_DATA','OBSERVED'].includes(x.status)||
   (x.status==='OBSERVED'?!goodMove(x.moveBps):x.moveBps!==null))
   return null;
  horizons[h]={status:x.status,
   moveBps:x.status==='OBSERVED'?round(x.moveBps):null};
 }
 return {source:V5_INDEPENDENT_POLICY.source,
  id:row.id,symbol:row.symbol,
  legacyDirection:row.legacyDirection,v5Direction:row.v5Direction,
  referencePrice:row.referencePrice,frozenAt:row.frozenAt,
  oneClosedAt:row.oneClosedAt,fiveClosedAt:row.fiveClosedAt,
  horizons};
}
export function freezeV5Independent(d,now=Date.now()){
 if(!clock(now)||!d||d.exchange!=='WEEX'||d.available!==true||
  !ALLOWED.has(d.symbol)||!Array.isArray(d.timeframes)||
  d.timeframes.map(x=>x?.intervalMinutes).join(',')!=='1,5,10'||
  d.forecastV5?.available!==true)return null;
 const [one,five]=d.timeframes,v5=d.forecastV5;
 if(!SIDES.has(d.combinedDirection)||!SIDES.has(v5.direction)||
  !goodPrice(one?.price)||!clock(one.closedAt)||!clock(five?.closedAt)||
  v5.closedAt1m!==one.closedAt||v5.closedAt5m!==five.closedAt||
  now-one.closedAt>2*MIN||
  five.closedAt!==Math.floor((now-1000)/(5*MIN))*5*MIN)return null;
 const id=createHash('sha256').update([
  'v110-independent-v5-v1',d.symbol,one.closedAt,five.closedAt
 ].join('|')).digest('hex').slice(0,24);
 return normalizeV5IndependentRow({
  source:V5_INDEPENDENT_POLICY.source,
  id,symbol:d.symbol,
  legacyDirection:d.combinedDirection,v5Direction:v5.direction,
  referencePrice:one.price,frozenAt:now,
  oneClosedAt:one.closedAt,fiveClosedAt:five.closedAt,
  horizons:Object.fromEntries(HORIZONS.map(h=>[h,empty()]))
 },now);
}
function observedReturnBps(row,bars,h,now){
 if(!Array.isArray(bars)||bars.length>200)return null;
 const start=Math.ceil(row.frozenAt/MIN)*MIN,byTime=new Map();
 const duplicated=new Set();
 for(const b of bars){
  if(!clock(b?.time)||b.time%MIN!==0||!goodPrice(b.open)||
   !goodPrice(b.close)||b.closeTime!==b.time+MIN||
   b.time+MIN>now-1000)continue;
  if(byTime.has(b.time))duplicated.add(b.time);
  else byTime.set(b.time,b);
 }
 for(let i=0;i<h;i++){
  const stamp=start+i*MIN;
  if(duplicated.has(stamp)||!byTime.has(stamp))return null;
 }
 const last=byTime.get(start+(h-1)*MIN);
 return round((last.close/row.referencePrice-1)*10000);
}
export function mergeV5Independent(previous,fresh,candles,now=Date.now()){
 if(!Array.isArray(previous)||!Array.isArray(fresh)||
  previous.length>V5_INDEPENDENT_LIMIT||fresh.length>4||!clock(now))
  throw Error('V5_INDEPENDENT_INVALID_INPUT');
 const map=new Map();let added=0,updated=0,dropped=0;
 for(const x of previous){
  const r=normalizeV5IndependentRow(x,now);
  if(!r){dropped++;continue}
  if(!map.has(r.id))map.set(r.id,r);
 }
 for(const x of fresh){
  const r=normalizeV5IndependentRow(x,now);
  if(r&&!map.has(r.id)){map.set(r.id,r);added++}
 }
 for(const row of map.values()){
  const bars=candles instanceof Map?candles.get(row.symbol):null;
  for(const h of HORIZONS){
   if(row.horizons[h].status!=='PENDING')continue;
   const move=observedReturnBps(row,bars,h,now);
   if(move!==null){
    row.horizons[h]={status:'OBSERVED',moveBps:move};updated++;
   }else if(now-row.frozenAt>=125*MIN){
    row.horizons[h]={status:'NO_DATA',moveBps:null};updated++;
   }
  }
 }
 const rows=[...map.values()].sort((a,b)=>b.frozenAt-a.frozenAt||a.id.localeCompare(b.id));
 if(rows.length>V5_INDEPENDENT_LIMIT){
  dropped+=rows.length-V5_INDEPENDENT_LIMIT;
  rows.length=V5_INDEPENDENT_LIMIT;
 }
 return {rows,changed:added>0||updated>0||dropped>0,
  added,updated,dropped};
}
function signed(row,side,h){
 const state=row.horizons?.[h];
 if(state?.status!=='OBSERVED'||!goodMove(state.moveBps)||
  !['LONG_BIAS','SHORT_BIAS'].includes(side))return null;
 return (side==='LONG_BIAS'?1:-1)*state.moveBps;
}
export function summarizeV5Independent(rows,now=Date.now()){
 const p=V5_INDEPENDENT_POLICY,base={
  mode:'V110_INDEPENDENT_V5_5M_FORECAST_COHORT',
  status:'COLLECTING',policy:p,
  recommendation:'KEEP_V4',tradeOrders:0,liveForecastChanged:false,
  autoPromotion:false,accuracyImprovedNotProven:true,
  limitation:'Every 20 minutes, four of 16 crypto markets are sampled even when neither V4 nor V5 would notify. V5-only coverage is measured, not published. Same timestamp does not imply exchange execution. Forward outcomes are correlated and not a probability or profitable trade rate. No automatic switching.'};
 if(!Array.isArray(rows)||rows.length>p.maxRows||!clock(now))
  return {...base,status:'INVALID_INPUT'};
 const seen=new Set(),valid=[];
 for(const r of rows){const x=normalizeV5IndependentRow(r,now);if(x&&!seen.has(x.id)){
  seen.add(x.id);valid.push(x);
 }}
 // Explicit 'now' in every calculation; no wall-clock dependency.
 const panel=(sideKey,h,subset=valid)=>{
  const relevant=subset.filter(r=>['LONG_BIAS','SHORT_BIAS'].includes(r[sideKey]));
  const matured=relevant.filter(r=>r.frozenAt+(h+2)*MIN<=now);
  const seenRows=matured.map(r=>({r,move:signed(r,r[sideKey],h)}))
   .filter(x=>x.move!==null);
  const favorable=seenRows.filter(x=>x.move>0).length;
  const adverse=seenRows.filter(x=>x.move<0).length;
  return {candidates:relevant.length,matured:matured.length,
   observed:seenRows.length,coveragePct:pct(seenRows.length,matured.length),
   favorablePct:pct(favorable,seenRows.length),
   favorable,adverse,flat:seenRows.length-favorable-adverse,
   meanDirectionalBps:seenRows.length?
    round(seenRows.reduce((a,x)=>a+x.move,0)/seenRows.length):null,
   distinctUtcDays:new Set(seenRows.map(x=>day(x.r.frozenAt))).size};
 };
 const v5=panel('v5Direction',5),baseline=panel('legacyDirection',5);
 const paired=valid.filter(r=>['LONG_BIAS','SHORT_BIAS'].includes(r.v5Direction)&&
  ['LONG_BIAS','SHORT_BIAS'].includes(r.legacyDirection));
 const pairedV5=panel('v5Direction',5,paired),pairedLegacy=panel('legacyDirection',5,paired);
 const byV5Side=Object.fromEntries(['LONG_BIAS','SHORT_BIAS'].map(side=>[side,
  panel('v5Direction',5,valid.filter(r=>r.v5Direction===side))]));
 const caution=pairedV5.observed>=p.minimumSharedComparisons&&
  pairedV5.distinctUtcDays>=p.minimumSharedDays&&
  pairedV5.coveragePct>=p.minimumCoveragePct&&
  pairedLegacy.coveragePct>=p.minimumCoveragePct;
 return {...base,archiveCount:valid.length,
  distinctUtcDays:new Set(valid.map(r=>day(r.frozenAt))).size,
  v5Abstentions:valid.filter(r=>r.v5Direction==='MIXED').length,
  legacyAbstentions:valid.filter(r=>r.legacyDirection==='MIXED').length,
  v5FiveMinute:v5,legacyFiveMinute:baseline,
  v5FifteenMinute:panel('v5Direction',15),
  pairedFiveMinute:{v5:pairedV5,legacy:pairedLegacy,
   descriptiveDifferencePp:pairedV5.favorablePct===null||
    pairedLegacy.favorablePct===null?null:
    round(pairedV5.favorablePct-pairedLegacy.favorablePct)},
  byV5Side,status:caution?'DESCRIPTIVE_ONLY_REVIEW_FORWARD_REQUIRED':'COLLECTING',
  enoughIndependentSample:false,recommendation:'KEEP_V4'};
}
