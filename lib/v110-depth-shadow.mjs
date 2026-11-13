// V110 ORDER-BOOK DEPTH: research only, not a live signal filter.
// Paired book snapshots must be captured beside each emitted forecast.
// Reading the book LATER and attaching it to an OLD alert would introduce look-ahead.
export const V110_DEPTH_POLICY=Object.freeze({
 version:'v110-depth-research-v1',
 maxCaptureLagMs:10_000,perSymbolSpacingMinutes:30,
 embargoMinutes:30,minEligible:180,minTrain:120,minHoldout:50,
 minTrainDays:5,minHoldoutDays:2,
 directionalPressureThresholdPct:12,
 minTrainSelected:60,minHoldoutSelected:25,minCoverage:0.4,
 minTrainHitLiftPoints:3,minHoldoutHitLiftPoints:5,
 extraMarketRequests:0,enabledInProduction:false,
 changesLiveSignals:false,placesOrders:false,requiresOwnerApproval:true
});
const MIN=60_000,DAY=24*60*MIN;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const safeTime=n=>Number.isSafeInteger(n)&&n>0;
const round=(n,dp=1)=>Number(n.toFixed(dp));
const days=rows=>new Set(rows.map(r=>Math.floor(r.sentAt/DAY))).size;
const pct=(a,b)=>b?round(a/b*100):null;
const hex32=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);

/** Build a SMALL, non-identifying, timestamped research feature.
 * Snapshot is from the existing read-only WEEX /api/signals?mode=liquidity.
 * No exchange timestamp in REST data: fetchedAt is the response time only.
 */
export function makeV110DepthFeature(book,{forecastId,symbol,direction,sentAt}={}){
 const refuse=code=>({status:'REJECTED',reason:code,usable:false});
 if(!hex32(forecastId)||!(/^[A-Z0-9]{2,24}$/).test(symbol||'')||
   !['LONG','SHORT'].includes(direction)||!safeTime(sentAt))
  return refuse('INVALID_FORECAST_METADATA');
 if(!book||book.symbol!==symbol||book.exchange!=='WEEX'||
  book.mode!=='observation-only'||book.ordersEnabled!==false||
  book.alertsUnchanged!==true||!safeTime(book.fetchedAt))
  return refuse('NOT_VERIFIED_WEEX_READONLY_SNAPSHOT');
 const lag=book.fetchedAt-sentAt;
 if(lag<0||lag>V110_DEPTH_POLICY.maxCaptureLagMs)
  return refuse('NOT_CAPTURED_AT_FORECAST_TIME');
 const d=book.nearDepthUSDT||{};
 const nums=[d.bid025,d.ask025,d.bid050,d.ask050,book.spreadBps,book.bestBid,book.bestAsk];
 if(!nums.every(finite)||nums.some(n=>n<0)||
  d.bid025+d.ask025<=0||d.bid050+d.ask050<=0||
  book.bestBid<=0||book.bestAsk<=book.bestBid||
  book.spreadBps>100)
  return refuse('UNRELIABLE_DEPTH_VALUES');
 const fraction=(bid,ask)=>(bid-ask)/(bid+ask)*100;
 const bidVsAsk025=round(fraction(d.bid025,d.ask025));
 const bidVsAsk050=round(fraction(d.bid050,d.ask050));
 return {
  status:'FEATURE_ONLY',usable:true,version:V110_DEPTH_POLICY.version,
  forecastId,symbol,direction,sentAt,observedAt:book.fetchedAt,
  captureLagMs:lag,spreadBps:book.spreadBps,
  bidVsAsk025Pct:bidVsAsk025,bidVsAsk050Pct:bidVsAsk050,
  directionalPressurePct:direction==='LONG'?bidVsAsk025:-bidVsAsk025,
  timestampSource:'LOCAL_HTTP_RESPONSE_NOT_EXCHANGE_TIMESTAMP',
  sizeUnitsUnconfirmed:true,notProofOfRealLiquidity:true,
  affectsSignals:false
 };
}
function summary(rows){
 if(!rows.length)return {n:0,favorable15Pct:null,favorable30Pct:null,mean15Bps:null};
 return {n:rows.length,
  favorable15Pct:pct(rows.filter(r=>r.m15>0).length,rows.length),
  favorable30Pct:pct(rows.filter(r=>r.m30>0).length,rows.length),
  mean15Bps:round(rows.reduce((x,r)=>x+r.m15,0)/rows.length,2)};
}
export function evaluateV110DepthPairs(pairs,now=Date.now()){
 const base={mode:'V110_DEPTH_PAIRED_SHADOW',version:V110_DEPTH_POLICY.version,
  recommendationsApplyAutomatically:false,
  ownerApprovalRequired:true,changesLiveSignals:false,ordersSent:0,
  extraMarketRequests:0,realTradePerformanceMeasured:false,
  warning:'No order-book exchange timestamp; size unit unverified; spoofing and correlated markets possible.'};
 if(!Array.isArray(pairs)||pairs.length>5000||!safeTime(now))
  return {...base,status:'INVALID_INPUT',eligible:0,recommendation:'KEEP_108'};
 const uniq=new Map();
 for(const x of pairs){
  const f=x?.forecast,book=x?.bookFeature;
  if(!f||!book||book.usable!==true||book.status!=='FEATURE_ONLY'||
   book.version!==V110_DEPTH_POLICY.version||!hex32(f.id)||
   book.forecastId!==f.id||book.symbol!==f.symbol||
   book.direction!==f.direction||book.sentAt!==f.sentAt||
   !safeTime(book.observedAt)||!safeTime(f.sentAt)||
   book.observedAt<f.sentAt||
   book.observedAt-f.sentAt>V110_DEPTH_POLICY.maxCaptureLagMs||
   !finite(book.spreadBps)||book.spreadBps<0||book.spreadBps>100||
   !finite(book.directionalPressurePct)||Math.abs(book.directionalPressurePct)>100||
   f.sentAt>now-35*MIN||
   ![15,30].every(n=>f.windows?.[n]?.status==='OBSERVED'&&
     finite(f.windows[n]?.moveBps)&&Math.abs(f.windows[n].moveBps)<10000))
   continue;
  const v={id:f.id,symbol:f.symbol,sentAt:f.sentAt,
   pressure:book.directionalPressurePct,m15:f.windows[15].moveBps,
   m30:f.windows[30].moveBps};
  if(!uniq.has(f.id))uniq.set(f.id,v);
 }
 const lastBySymbol=new Map(),rows=[];
 for(const r of [...uniq.values()].sort((a,b)=>a.sentAt-b.sentAt||a.id.localeCompare(b.id))){
  if(r.sentAt-(lastBySymbol.get(r.symbol)??-Infinity)<V110_DEPTH_POLICY.perSymbolSpacingMinutes*MIN)continue;
  lastBySymbol.set(r.symbol,r.sentAt);
  rows.push(r);
 }
 const baseReport={...base,eligible:rows.length,
  dataSource:'ONLY_REAL_SAME-MOMENT_PAIRED_BOOK_AND_PUBLISHED_FORECAST_RECORDS'};
 if(rows.length<V110_DEPTH_POLICY.minEligible)
  return {...baseReport,status:'INSUFFICIENT_PAIRED_DEPTH',need:V110_DEPTH_POLICY.minEligible,
   recommendation:'KEEP_108'};
 const split=Math.floor(rows.length*0.7),train=rows.slice(0,split),
  holdout=rows.slice(split).filter(r=>r.sentAt>=train.at(-1).sentAt+
   V110_DEPTH_POLICY.embargoMinutes*MIN);
 if(train.length<V110_DEPTH_POLICY.minTrain||
    holdout.length<V110_DEPTH_POLICY.minHoldout||
    days(train)<V110_DEPTH_POLICY.minTrainDays||
    days(holdout)<V110_DEPTH_POLICY.minHoldoutDays)
  return {...baseReport,status:'INSUFFICIENT_INDEPENDENT_DAYS',
   trainN:train.length,holdoutN:holdout.length,
   trainDays:days(train),holdoutDays:days(holdout),recommendation:'KEEP_108'};
 const candidate=rows=>rows.filter(r=>
  r.pressure>=V110_DEPTH_POLICY.directionalPressureThresholdPct);
 const baselineTrain=summary(train),filteredTrain=summary(candidate(train));
 const baselineHoldout=summary(holdout),filteredHoldout=summary(candidate(holdout));
 const passTrain=filteredTrain.n>=V110_DEPTH_POLICY.minTrainSelected&&
  filteredTrain.n/train.length>=V110_DEPTH_POLICY.minCoverage&&
  filteredTrain.favorable15Pct>=baselineTrain.favorable15Pct+
    V110_DEPTH_POLICY.minTrainHitLiftPoints;
 const passHoldout=filteredHoldout.n>=V110_DEPTH_POLICY.minHoldoutSelected&&
  filteredHoldout.n/holdout.length>=V110_DEPTH_POLICY.minCoverage&&
  filteredHoldout.favorable15Pct>=baselineHoldout.favorable15Pct+
    V110_DEPTH_POLICY.minHoldoutHitLiftPoints&&
  filteredHoldout.favorable30Pct>=baselineHoldout.favorable30Pct;
 return {...baseReport,status:passTrain&&passHoldout?
  'RESEARCH_CANDIDATE_FOR_FURTHER_VALIDATION':'NO_VALIDATED_DEPTH_LIFT',
  trainN:train.length,holdoutN:holdout.length,trainDays:days(train),
  holdoutDays:days(holdout),baselineTrain,filteredTrain,
  baselineHoldout,filteredHoldout,
  recommendation:'KEEP_108',
  note:'Even a positive result does NOT authorize live filters: prospective forward tests, costs, WEEX units, anti-spoofing remain.'};
}
