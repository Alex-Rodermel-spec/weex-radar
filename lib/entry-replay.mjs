// Research-only upper bound on whether a RESTING passive order could have
// been touched after a confirmed 5m signal. This is NOT the live 1m pullback
// model, and an OHLC touch does not confirm queue priority or maker execution.
export function studyFiveMinutePullback({direction,signalClose,stop,take,future,percent=0.1}={}){
 if(!['LONG','SHORT'].includes(direction)||![signalClose,stop,take,percent].every(x=>Number.isFinite(x)&&x>0)||
   percent>0.6||!Array.isArray(future)||future.length<3)return {status:'INVALID',limit:null};
 const side=direction==='LONG'?1:-1;
 const limit=signalClose*(1-side*percent/100);
 if(!(side===1?stop<limit&&limit<take:take<limit&&limit<stop))
  return {status:'INVALID',limit:null};
 // Only next three CLOSED 5m bars (15 minutes after signal), not same candle.
 for(const [i,bar] of future.slice(0,3).entries()){
  if(!bar||![bar.open,bar.low,bar.high,bar.close].every(x=>Number.isFinite(x)&&x>0)||
    bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close))
   return {status:'INVALID',limit:null};
  if(side===1?bar.open<=limit:bar.open>=limit)
   return {status:'GAP_OR_MARKETABLE',limit,bar:i+1};
  const touched=side===1?bar.low<=limit:bar.high>=limit;
  if(!touched)continue;
  // Same 5m bar may touch the TP or stop before reaching our limit.
  // Do not call this a realized fill, let alone a win.
  const hitOpposite=side===1?bar.high>=take:bar.low<=take;
  const hitStop=side===1?bar.low<=stop:bar.high>=stop;
  if(hitOpposite||hitStop)return {status:'AMBIGUOUS_TOUCH',limit,bar:i+1};
  return {status:'TOUCH_POSSIBLE',limit,bar:i+1};
 }
 return {status:'NO_TOUCH',limit,bar:null};
}
export function summarizePullbacks(rows){
 const counts={TOUCH_POSSIBLE:0,NO_TOUCH:0,AMBIGUOUS_TOUCH:0,
  GAP_OR_MARKETABLE:0,INVALID:0};
 for(const row of rows){
  if(row?.status in counts)counts[row.status]++;
  else counts.INVALID++;
 }
 return {total:rows.length,percent:0.1,windowMinutes:15,
  ...counts,fillRate:null,actualProfit:null,
  note:'5m OHLC touch for a fixed 0.1% retracement from the completed signal close, next 15 minutes. Differs from production 1m preview. Touch is not a confirmed fill or maker-fee execution.'};
}
