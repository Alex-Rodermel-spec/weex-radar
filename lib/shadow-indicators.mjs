// Additional 5-minute indicators for RESEARCH ONLY.
// No extra exchange requests, thresholds used for trading, order access,
// or implication that a strong ADX predicts a profitable trade.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const round=(n,p=2)=>Number(n.toFixed(p));
function validBars(bars){
 return Array.isArray(bars)&&bars.length>=35&&bars.length<=500&&
  bars.every((bar,i)=>bar&&[bar.high,bar.low,bar.close,bar.volume].every(finite)&&
   bar.high>0&&bar.low>0&&bar.close>0&&bar.volume>=0&&
   bar.high>=Math.max(bar.low,bar.close)&&bar.low<=bar.close&&
   (i===0||!finite(bar.time)||!finite(bars[i-1].time)||bar.time>bars[i-1].time));
}

// Wilder ADX(14), +DI and -DI, calculated from CLOSED bars only.
export function adx(bars,period=14){
 if(!Number.isInteger(period)||period<2||!validBars(bars)||
    bars.length<period*2)return null;
 let smoothTR=0,smoothPlus=0,smoothMinus=0,adxValue=0;
 let dxCount=0,plus=0,minus=0;
 for(let i=1;i<bars.length;i++){
  const bar=bars[i],prev=bars[i-1];
  const up=bar.high-prev.high,down=prev.low-bar.low;
  const plusDM=up>down&&up>0?up:0;
  const minusDM=down>up&&down>0?down:0;
  const tr=Math.max(bar.high-bar.low,Math.abs(bar.high-prev.close),Math.abs(bar.low-prev.close));
  if(i<=period){smoothTR+=tr;smoothPlus+=plusDM;smoothMinus+=minusDM}
  else{
   smoothTR=smoothTR-smoothTR/period+tr;
   smoothPlus=smoothPlus-smoothPlus/period+plusDM;
   smoothMinus=smoothMinus-smoothMinus/period+minusDM;
  }
  if(i<period)continue;
  plus=smoothTR>0?100*smoothPlus/smoothTR:0;
  minus=smoothTR>0?100*smoothMinus/smoothTR:0;
  const dx=plus+minus>0?100*Math.abs(plus-minus)/(plus+minus):0;
  if(dxCount<period){adxValue+=dx;dxCount++;if(dxCount===period)adxValue/=period}
  else adxValue=(adxValue*(period-1)+dx)/period;
 }
 if(dxCount<period)return null;
 return {adx:round(adxValue,2),plusDI:round(plus,2),minusDI:round(minus,2)};
}

// A *rolling*, not session/day VWAP: typical price weighted by observed
// volume of the latest 20 completed 5m bars. Never call this daily VWAP.
export function rollingVwap(bars,length=20){
 if(!Number.isInteger(length)||length<2||!validBars(bars)||bars.length<length)return null;
 const last=bars.slice(-length);
 let volume=0,weighted=0;
 for(const b of last){
  volume+=b.volume;
  weighted+=(b.high+b.low+b.close)/3*b.volume;
 }
 return volume>0?weighted/volume:null;
}
export function shadowIndicators(bars){
 const d=adx(bars),vwap=rollingVwap(bars);
 if(!d||vwap===null)return {mode:'SHADOW_INDICATORS',available:false,
  note:'Недостаточно валидных закрытых 5м свечей или объёма'};
 const last=bars.at(-1).close;
 return {mode:'SHADOW_INDICATORS',available:true,timeframe:'5m',
  adx14:d.adx,plusDI14:d.plusDI,minusDI14:d.minusDI,
  rollingVwap20:round(vwap,10),priceVsVwapPct:round((last/vwap-1)*100,3),
  trendStrength:d.adx<20?'WEAK':d.adx<25?'TRANSITION':'STRONG',
  note:'Только наблюдение: ADX запаздывает, rolling VWAP ≠ дневной VWAP. Входы и сигналы не меняются.'};
}
