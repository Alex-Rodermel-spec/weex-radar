// №110 pure forensic snapshot: record why an apparently aligned 1m/5m/10m
// forecast might fail DIRECTION despite having no late/chase warning.
// All features must predate the observed event; no post-alert bar, API,
// persistence, ntfy or trade decision. One BNB screenshot is a hypothesis,
// not evidence for a new cutoff or filter.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const round=x=>Math.round(x*100)/100;
const BODIES=new Set(['UP','DOWN','FLAT']);
const TRENDS=new Set(['LONG_BIAS','SHORT_BIAS']);
const STRUCTURES=new Set(['HIGHER_HIGHS_LOW','LOWER_HIGHS_LOW','RANGE_OR_MIXED']);
const RISKS=new Set(['HIGH','ELEVATED','CLEAR','UNKNOWN']);
const LEVELS=new Set(['STRONG','STANDARD','CAUTION','UNAVAILABLE']);
const DIRECTION=x=>x==='LONG_BIAS'?'UP':'DOWN';
const opposing=(body,direction)=>BODIES.has(body)?
 (body==='FLAT'?false:body!==DIRECTION(direction)):null;
export const V110_DIRECTION_FORENSIC_POLICY=Object.freeze({
 version:'v110-alignment-direction-risk-pre-event-shadow-v1',
 source:'ALREADY_FETCHED_PUBLIC_WEEX_CLOSED_1M_5M_10M_FORECAST',
 compareTrueEarlyToAlignedControl:true,
 noNewExchangeCalls:true,noNewAlerts:true,noNewStorage:true,
 noPaidAi:true,noTrades:true,noLiveFilters:true,
 bnbSelectedScreenshotNotTrainingEvidence:true,
 noAutomaticForwardScoring:true
});
export function freezeV110DirectionForensics(d,at){
 if(!d?.available||d.exchange!=='WEEX'||!Number.isSafeInteger(at)||
  !Array.isArray(d.timeframes)||
  d.timeframes.map(x=>x?.intervalMinutes).join(',')!=='1,5,10')
  return null;
 const [m1,m5,m10]=d.timeframes;
 if(!TRENDS.has(m1.direction)||!
  [m1,m5,m10].every(x=>Number.isSafeInteger(x.closedAt)&&
   x.closedAt>0&&x.closedAt<=at)||!positive(m1.price))return null;
 // These are observations already computed by the regular forecast reader,
 // never reconstructed using later chart screenshots or future bars.
 const dir=m1.direction,ctx=d.primaryContext||{};
 const resistance=dir==='LONG_BIAS'?ctx.observedResistance:ctx.observedSupport;
 const distanceBps=positive(resistance)?
  round((dir==='LONG_BIAS'?resistance-m1.price:m1.price-resistance)/
   m1.price*10000):null;
 const distanceAtr=distanceBps!==null&&positive(m1.atr14)?
  round(distanceBps*m1.price/(10000*m1.atr14)):null;
 const obstacleNear=distanceAtr===null?null:
  distanceAtr>=0&&distanceAtr<=0.6;
 const fiveSignedBodyBps=finite(m5.lastCandleBodyBps)?
  round((dir==='LONG_BIAS'?1:-1)*m5.lastCandleBodyBps):null;
 const rsi=x=>finite(x?.rsi14)&&x.rsi14>=0&&x.rsi14<=100?x.rsi14:null;
 const volume=finite(m1.relativeVolume)&&m1.relativeVolume>=0?
  m1.relativeVolume:null;
 const risk=d.reversalRisk?.sampleReady===true&&
  RISKS.has(d.reversalRisk?.risk)?d.reversalRisk.risk:'UNKNOWN';
 const level=LEVELS.has(d.strengthRisk?.level)?d.strengthRisk.level:'UNAVAILABLE';
 const late=d.arrivalTiming?.sampleReady===true?
  (d.arrivalTiming.lateRisk===true?'LATE':
   d.arrivalTiming.lateRisk===false?'NOT_LATE':'UNKNOWN'):'UNKNOWN';
 const structure=STRUCTURES.has(ctx.structure)?ctx.structure:'UNKNOWN';
 // All derived flags are diagnostics, NOT rules: close to a resistance
 // does NOT imply the next candle will fall, nor does V2 NOT_LATE
 // guarantee correct direction. Missing inputs are UNKNOWN, not CLEAR.
 return {version:V110_DIRECTION_FORENSIC_POLICY.version,
  observedAt:at,
  closedAt:{one:m1.closedAt,five:m5.closedAt,ten:m10.closedAt},
  strengthLevel:level,
  lateStatus:late,
  reversalRisk:risk,
  priorClosed1mAgainst:opposing(m1.lastCandleBody,dir),
  priorClosed5mAgainst:opposing(m5.lastCandleBody,dir),
  priorClosed5mSignedBodyBps:fiveSignedBodyBps,
  structure,nearPriorObstacle:obstacleNear,
  priorObstacleDistanceBps:distanceBps,
  priorObstacleDistanceAtr:distanceAtr,
  rsi:{one:rsi(m1),five:rsi(m5),ten:rsi(m10)},
  oneMinuteRelativeVolume:volume,
  // Full width of the BB position is already computed from CLOSED 1m bars.
  oneMinuteBollingerPosition:['ABOVE_UPPER','BELOW_LOWER','UPPER_HALF','LOWER_HALF']
   .includes(m1.bollinger20?.position)?m1.bollinger20.position:'UNKNOWN',
  hasPostEventEvidence:false,noTrade:true};
}

// Descriptive stratification when (and ONLY when) frozen receipts have been
// paired with a later valid future-candle score by a separate researcher.
export function compareV110AlignmentDirectionFailures(scoredRows){
 const accepted=Array.isArray(scoredRows)?scoredRows.filter(s=>
  s?.mode==='V110_UNSENT_1M_FORWARD_SCORE'&&s.status==='OBSERVED'&&
  s.kind==='THREE_TIMEFRAME_ALIGNMENT_CONTROL'&&
  typeof s.id==='string'&&s.preEventDirectionRisk?.version===
   V110_DIRECTION_FORENSIC_POLICY.version&&
  Number.isSafeInteger(s.frozenAt)&&s.horizons?.[15]?.status==='OBSERVED'):[];
 const byId=new Map();
 for(const r of accepted)if(!byId.has(r.id))byId.set(r.id,r);
 const rows=[...byId.values()];
 const split=r=>r.direction==='LONG_BIAS'?'LONG':r.direction==='SHORT_BIAS'?'SHORT':null;
 const report={mode:'V110_PRE_EVENT_DIRECTION_FAILURE_SHADOW',
  fullyPaired:rows.length,readyForPromotion:false,
  independentHoldoutPassed:false,tradePnLMeasured:false,
  noLiveChanges:true,byDirection:{}};
 for(const side of ['LONG','SHORT']){
  const group=rows.filter(r=>split(r)===side);
  const slices={
   ALL:group,
   NEAR_PRIOR_OBSTACLE:group.filter(x=>x.preEventDirectionRisk.nearPriorObstacle===true),
   NOT_NEAR_PRIOR_OBSTACLE:group.filter(x=>x.preEventDirectionRisk.nearPriorObstacle===false),
   OPPOSITE_CLOSED_5M:group.filter(x=>x.preEventDirectionRisk.priorClosed5mAgainst===true),
   PRIOR_CLOSED_5M_AGREES:group.filter(x=>x.preEventDirectionRisk.priorClosed5mAgainst===false),
   V2_NOT_LATE:group.filter(x=>x.preEventDirectionRisk.lateStatus==='NOT_LATE')
  };
  report.byDirection[side]=Object.fromEntries(Object.entries(slices).map(([name,all])=>{
   const known=all.filter(x=>finite(x.horizons[15].signedBps));
   const n=known.length,favorable=known.filter(x=>x.horizons[15].signedBps>0).length;
   return [name,{observed:n,favorable,adverse:known.filter(x=>x.horizons[15].signedBps<0).length,
    flat:n-favorable-known.filter(x=>x.horizons[15].signedBps<0).length,
    favorablePct:n>=20?round(100*favorable/n):null}];
  }));
 }
 return {...report,note:'Fixed pre-event research strata only. Owner-selected BNB screenshot excluded from validation. 15m directional movement is NOT executable fills, calibrated probability or permission to alter #108.'};
}
