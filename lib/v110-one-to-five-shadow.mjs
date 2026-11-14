// №110 read-only observation of CLOSED 1m candle body and 1m/5m indicator biases.
// It consumes ONLY the forecast scan already performed every 10 minutes.
// This is not a trade/forecast engine, reliability test, or forward outcome study.
const directional=x=>x==='LONG_BIAS'||x==='SHORT_BIAS';
const body=x=>x==='UP'||x==='DOWN'||x==='FLAT';
export const ONE_TO_FIVE_SHADOW_POLICY=Object.freeze({
 version:'v110-1m-5m-conflicts-observation-v1',
 input:'EXISTING_CLOSED_WEEX_1M_5M_FORECAST_SNAPSHOTS',
 cadenceMinutes:10, // only if a normal forecast scan runs
 noNewExchangeRequests:true,noNewCron:true,noAlerts:true,noOrders:true,
 noLiveChanges:true,noNewStorage:true,
 prospectiveOutcomesNotMeasured:true
});
export function summarizeOneToFiveConflicts(snapshots){
 const result={mode:'V110_1M_VS_5M_SHADOW',
  scannedSnapshots:Array.isArray(snapshots)?snapshots.length:0,
  usable:0,unknownOrNeutralFive:0,
  redOneMinuteInsideFiveLong:0,greenOneMinuteInsideFiveShort:0,
  bodyOpposesFiveBias:0,biasOpposesFiveBias:0,
  oneBiasShortFiveLong:0,oneBiasLongFiveShort:0,
  closed1mBodyUnknown:0,
  noTrade:true,ordersSent:0,liveChanges:0,
  outcomesMeasured:false,
  limitation:'Only completed 1m body and indicator bias vs closed 5m at sampled 10m scan times; NOT every 1m candle. No later 5m reversal outcomes, returns or unsampled candles.'};
 if(!Array.isArray(snapshots))return result;
 for(const d of snapshots){
  if(!d||d.available!==true||d.exchange!=='WEEX'||
   !Array.isArray(d.timeframes)||d.timeframes.length!==3||
   d.timeframes.map(f=>f?.intervalMinutes).join(',')!=='1,5,10'){
   result.unknownOrNeutralFive++;continue;
  }
  const [one,five]=d.timeframes;
  if(!directional(five.direction)){result.unknownOrNeutralFive++;continue}
  result.usable++;
  if(!body(one.lastCandleBody))result.closed1mBodyUnknown++;
  if(one.lastCandleBody==='DOWN'&&five.direction==='LONG_BIAS'){
   result.redOneMinuteInsideFiveLong++;result.bodyOpposesFiveBias++;
  }
  if(one.lastCandleBody==='UP'&&five.direction==='SHORT_BIAS'){
   result.greenOneMinuteInsideFiveShort++;result.bodyOpposesFiveBias++;
  }
  if(directional(one.direction)&&one.direction!==five.direction){
   result.biasOpposesFiveBias++;
   if(one.direction==='SHORT_BIAS')result.oneBiasShortFiveLong++;
   else result.oneBiasLongFiveShort++;
  }
 }
 return result;
}
