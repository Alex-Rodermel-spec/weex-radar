// Preregistered READ-ONLY forecast quality audit. Classifies only evidence
// already available when a forecast was PUBLISHED; future candles score it
// later and can never influence classification or real notifications.
export const QUALITY_GATE_PROTOCOL=Object.freeze({
 version:'2026-11-11-quality-shadow-v1',
 forwardFrom:'2026-11-11T23:00:00.000Z', // 12 Nov Berlin midnight
 primaryHorizonMinutes:5,secondaryHorizonMinutes:15,
 priorMoveLateThresholdBps:10,
 minimumObservedPerGroup:50,minimumCoveragePct:80,
 minimumSharedSymbols:3,minimumPerSymbolPerGroup:5,
 descriptiveDifferencePp:10
});
const MIN=60000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=n=>Math.round(n*10)/10;
export function classifyForecastQualityShadow(r){
 if(!r||!['LONG','SHORT'].includes(r.direction)||
   !['STRONG','STANDARD','CAUTION'].includes(r.strength))
  return 'UNKNOWN';
 // The risk label existed in the original message. A late result can be
 // detected independently from already-completed pre-publication candles.
 if(r.strength==='CAUTION'||r.v2Timing==='LATE'||
  finite(r.preMove15mBps)&&
  r.preMove15mBps>=QUALITY_GATE_PROTOCOL.priorMoveLateThresholdBps)
  return 'SKIP';
 if(!finite(r.preMove15mBps)||r.v2Timing!=='CLEAR')
  return 'UNKNOWN';
 return 'PASS';
}
function matured(r,h,now){
 const t=r?.sentAt;
 if(!Number.isSafeInteger(t)||t<=0||t>now)return false;
 return Math.ceil((t+1)/MIN)*MIN+h*MIN<=now-1000;
}
function measure(rows,h,now){
 let seen=0,favorable=0,adverse=0,flat=0,missing=0;
 for(const row of rows){
  if(!matured(row,h,now))continue;
  seen++;
  const w=row.windows?.[h];
  if(w?.status!=='OBSERVED'||!finite(w.moveBps)){
   missing++;continue;
  }
  if(w.moveBps>0)favorable++;
  else if(w.moveBps<0)adverse++;
  else flat++;
 }
 const observed=favorable+adverse+flat;
 return {total:rows.length,matured:seen,observed,missing,
  favorable,adverse,flat,
  favorablePct:observed?round(100*favorable/observed):null,
  coveragePct:seen?round(100*observed/seen):null};
}
function stratified(rows,now){
 const pass=rows.filter(r=>classifyForecastQualityShadow(r)==='PASS');
 const skip=rows.filter(r=>classifyForecastQualityShadow(r)==='SKIP');
 const common=[...new Set(pass.map(r=>r.symbol))].filter(x=>
  skip.some(r=>r.symbol===x));
 const valid=common.map(symbol=>{
  const a=measure(pass.filter(r=>r.symbol===symbol),5,now);
  const b=measure(skip.filter(r=>r.symbol===symbol),5,now);
  return {a,b};
 }).filter(x=>x.a.observed>=QUALITY_GATE_PROTOCOL.minimumPerSymbolPerGroup&&
  x.b.observed>=QUALITY_GATE_PROTOCOL.minimumPerSymbolPerGroup);
 return {sharedSymbols:valid.length,
  differencePp:valid.length?round(valid.reduce((s,x)=>
   s+x.a.favorablePct-x.b.favorablePct,0)/valid.length):null};
}
function cohort(rows,now){
 const byName={BASELINE:rows,
  PASS:rows.filter(r=>classifyForecastQualityShadow(r)==='PASS'),
  SKIP:rows.filter(r=>classifyForecastQualityShadow(r)==='SKIP'),
  UNKNOWN:rows.filter(r=>classifyForecastQualityShadow(r)==='UNKNOWN')};
 const groups=Object.fromEntries(Object.entries(byName).map(([name,subset])=>[
  name,{total:subset.length,at5m:measure(subset,5,now),
   at15m:measure(subset,15,now),
   byDirection:Object.fromEntries(['LONG','SHORT'].map(direction=>[
    direction,{at5m:measure(subset.filter(r=>r.direction===direction),5,now),
     at15m:measure(subset.filter(r=>r.direction===direction),15,now)}
   ]))}
 ]));
 const pass=groups.PASS.at5m,skip=groups.SKIP.at5m,shared=stratified(rows,now);
 const enough=pass.observed>=QUALITY_GATE_PROTOCOL.minimumObservedPerGroup&&
  skip.observed>=QUALITY_GATE_PROTOCOL.minimumObservedPerGroup&&
  pass.coveragePct>=QUALITY_GATE_PROTOCOL.minimumCoveragePct&&
  skip.coveragePct>=QUALITY_GATE_PROTOCOL.minimumCoveragePct&&
  shared.sharedSymbols>=QUALITY_GATE_PROTOCOL.minimumSharedSymbols;
 const delta=pass.favorablePct===null||skip.favorablePct===null?null:
  round(pass.favorablePct-skip.favorablePct);
 return {total:rows.length,groups,comparison:{
  status:enough?'REVIEW_ONLY':'COLLECTING',
  readyForReview:enough,sharedSymbols:shared.sharedSymbols,
  differencePp:delta,stratifiedDifferencePp:shared.differencePp,
  passesDescriptiveThreshold:enough&&delta!==null&&
   delta>=QUALITY_GATE_PROTOCOL.descriptiveDifferencePp
 }};
}
export function forecastQualityShadowAudit(rows,now=Date.now()){
 if(!Array.isArray(rows))throw Error('QUALITY_GATE_INVALID_ROWS');
 const eligible=rows.filter(r=>r&&Number.isSafeInteger(r.sentAt)&&r.sentAt<=now);
 const cut=Date.parse(QUALITY_GATE_PROTOCOL.forwardFrom);
 return {mode:'READ_ONLY_FORECAST_QUALITY_SHADOW',protocol:QUALITY_GATE_PROTOCOL,
  exploratory:cohort(eligible.filter(r=>r.sentAt<cut),now),
  forward:cohort(eligible.filter(r=>r.sentAt>=cut),now),
  tradeReady:false,liveForecastsUnchanged:true,
  caveat:'Exploratory outcomes cannot validate a proposed filter. PASS only if a published STRONG/STANDARD forecast had a recorded CLEAR V2 warning and less than 0.10% completed pre-alert directional move. SKIP includes CAUTION, LATE and already extended moves. UNKNOWN is never silently reclassified as success. Primary evaluation is direction after 5m, separately by LONG/SHORT and coin; no fills, fees, profit, or causal claim. Only the forward cohort from 12 Nov is eligible for future review.'};
}
