// Additional 5m structure gate for a STRONG label only.
// Uses levels from PREVIOUS closed WEEX 5m candles and the freshly rechecked
// quote/entry data. Cannot open orders, alter ordinary signals, or fetch data.
export const STRONG_LEVEL_POLICY=Object.freeze({
  version:'2026-11-12-strong-opposing-levels-v1',
  minRoomRisk:1.5,
  lookback5m:12,
  nearestPivotLookback5m:60,
  closedCandlesOnly:true,
  noOrders:true
});
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const reject=(reason,extra={})=>({ok:false,reason,...extra});
export function assessStrongLevelRoom(s){
  if(!s||!['LONG','SHORT'].includes(s.direction))
    return reject('LEVEL_INVALID_DIRECTION');
  const r=s.levelReview,entry=s.livePrice,stop=s.stop,take=s.take;
  if(r?.mode!=='CLOSED_5M_OBSERVATION'||r.interval!=='5m'||
    r.lookback!==STRONG_LEVEL_POLICY.lookback5m||
    r.candleCloseTime!==s.candleCloseTime||
    !positive(r.support)||!positive(r.resistance)||
    !(r.support<r.resistance))
    return reject('LEVEL_HISTORY_MISSING');
  if(r.breakoutDirection!==s.direction||
    r.candleState!==(s.direction==='LONG'?'BREAK_UP':'BREAK_DOWN')||
    r.closeQuality!=='SUPPORTED')
    return reject('LEVEL_BREAKOUT_NOT_SUPPORTED');
  const fake=r.recentFakeouts?.[s.direction];
  if(Number.isInteger(fake?.barsAgo)&&fake.barsAgo<=2)
    return reject('LEVEL_RECENT_FAKEOUT');
  if(![entry,stop,take].every(positive)||
    s.entryQuality?.ok!==true||
    (s.direction==='LONG'&&!(stop<entry&&entry<take))||
    (s.direction==='SHORT'&&!(take<entry&&entry<stop)))
    return reject('LEVEL_ENTRY_PRICE_INVALID');
  const risk=Math.abs(entry-stop);
  const reward=Math.abs(take-entry);
  if(!positive(risk)||reward/risk<STRONG_LEVEL_POLICY.minRoomRisk)
    return reject('LEVEL_REWARD_RISK_INSUFFICIENT');
  // Check 12-bar boundary AND independent mature 60-bar swing pivot.
  // Some broken-out 12-bar levels are BEHIND price; only forward barriers
  // between fresh entry and target are obstacles, never already-cleared ones.
  const named=[['12BAR',s.direction==='LONG'?r.resistance:r.support],
    ['60BAR_PIVOT',s.entryQuality.nearestLevel]];
  const obstacles=[];
  for(const [name,price] of named){
    if(price===null||price===undefined)continue;
    if(!positive(price))return reject('LEVEL_INVALID_OBSTACLE');
    const ahead=s.direction==='LONG'?
      entry<price&&price<take:take<price&&price<entry;
    if(!ahead)continue;
    obstacles.push({source:name,price,roomR:Math.abs(price-entry)/risk});
  }
  const closest=obstacles.sort((a,b)=>a.roomR-b.roomR)[0]??null;
  if(closest&&closest.roomR<STRONG_LEVEL_POLICY.minRoomRisk)
    return reject('LEVEL_NEAR_OPPOSING_OBSTACLE',{closest});
  return {ok:true,reason:'LEVEL_5M_CLOSED_AND_ROOM_CONFIRMED',
    closest,roomR:closest?.roomR??null};
}
