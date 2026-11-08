// Read-only quality gate for a confirmed signal at the *current* quote.
// Heuristic checks, not a win probability, liquidation protection or order advice.
export const MIN_REWARD_RISK=1.5;
export const MIN_STRUCTURAL_ROOM_R=1.0;

const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const round=(x,d=2)=>Math.round(x*10**d)/10**d;

// Only completed candles from the SAME exchange as the 5m signal.
// Pivot needs two candles on either side; the current signal candle is excluded.
export function closestOpposingPivot(candles,direction,entry,take){
 if(!Array.isArray(candles)||candles.length<6||
    !['LONG','SHORT'].includes(direction)||!positive(entry)||!positive(take))return null;
 const previous=candles.slice(0,-1).slice(-60),levels=[];
 for(let i=2;i<previous.length-2;i++){
  const c=previous[i],a=previous[i-2],b=previous[i-1],d=previous[i+1],e=previous[i+2];
  if(![c?.high,c?.low,a?.high,b?.high,d?.high,e?.high,
        a?.low,b?.low,d?.low,e?.low].every(positive))continue;
  const pivotHigh=c.high>a.high&&c.high>b.high&&c.high>=d.high&&c.high>=e.high;
  const pivotLow=c.low<a.low&&c.low<b.low&&c.low<=d.low&&c.low<=e.low;
  if(direction==='LONG'&&pivotHigh&&c.high>entry&&c.high<take)levels.push(c.high);
  if(direction==='SHORT'&&pivotLow&&c.low<entry&&c.low>take)levels.push(c.low);
 }
 if(!levels.length)return null;
 return direction==='LONG'?Math.min(...levels):Math.max(...levels);
}

export function checkEntryLevels({direction,entry,stop,take,nearestLevel=null}){
 if(!['LONG','SHORT'].includes(direction)||
    ![entry,stop,take].every(positive)||
    (nearestLevel!==null&&!positive(nearestLevel)))return {
    ok:false,rr:null,nearestLevel:null,roomR:null,reason:'Недостаточно данных для проверки точки входа'};
 if(direction==='LONG'&&!(stop<entry&&entry<take)||
    direction==='SHORT'&&!(take<entry&&entry<stop))return {
    ok:false,rr:null,nearestLevel:null,roomR:null,reason:'Стоп или цель уже не подходят для входа'};
 const risk=Math.abs(entry-stop),reward=Math.abs(take-entry);
 if(risk<=0)return {ok:false,rr:null,nearestLevel:null,roomR:null,reason:'Некорректный риск'};
 const rr=reward/risk;
 if(!Number.isFinite(rr))return {
  ok:false,rr:null,nearestLevel:null,roomR:null,reason:'Некорректный риск'};
 const levelOnPath=nearestLevel!==null&&
    (direction==='LONG'?entry<nearestLevel&&nearestLevel<take:take<nearestLevel&&nearestLevel<entry);
 const roomR=levelOnPath?Math.abs(nearestLevel-entry)/risk:null;
 const detail={rr:round(rr),nearestLevel:levelOnPath?nearestLevel:null,
  roomR:roomR===null?null:round(roomR)};
 if(rr<MIN_REWARD_RISK)return {...detail,ok:false,
   reason:'При текущей цене прибыль/риск ниже 1,5 — вход пропущен'};
 if(roomR!==null&&roomR<MIN_STRUCTURAL_ROOM_R)return {...detail,ok:false,
   reason:'Ближайший локальный уровень ближе 1R — вход пропущен'};
 return {...detail,ok:true,reason:'Проверены прибыль/риск и локальные уровни (без гарантии)'};
}

export function checkConfirmedEntry(direction,close,livePrice,atr,candles){
 if(![close,livePrice,atr].every(positive))return checkEntryLevels({
  direction,entry:livePrice,stop:NaN,take:NaN});
 const stop=direction==='LONG'?close-1.2*atr:close+1.2*atr;
 const take=direction==='LONG'?close+2.4*atr:close-2.4*atr;
 const nearestLevel=closestOpposingPivot(candles,direction,livePrice,take);
 return checkEntryLevels({direction,entry:livePrice,stop,take,nearestLevel});
}
