// One-off PUBLIC WEEX OHLC research endpoint on a PREVIEW branch only.
// Never merge into main: isolated from active scanner, notifications and orders.
const START=Date.UTC(2026,10,11,8,0);
const END=Date.UTC(2026,10,11,8,54);
const ENTRY=0.00525470;
const price=n=>Number.isFinite(n)&&n>0;
async function candles(type){
 const url='https://api-contract.weex.com/capi/v3/market/historyKlines?'+
 new URLSearchParams({symbol:'1000PEPEUSDT',interval:'1m',
  startTime:String(START),endTime:String(END),limit:'100',priceType:type});
 const r=await fetch(url,{signal:AbortSignal.timeout(9000),cache:'no-store',
  headers:{Accept:'application/json'}});
 if(!r.ok)throw Error('WEEX_HISTORY_'+type+'_'+r.status);
 const body=await r.text();
 if(body.length>200000)throw Error('HISTORY_TOO_LARGE');
 const raw=JSON.parse(body);const xs=Array.isArray(raw)?raw:raw?.data;
 if(!Array.isArray(xs))throw Error('HISTORY_BAD_SHAPE_'+type);
 return xs.map(c=>({t:Number(c[0]),o:Number(c[1]),h:Number(c[2]),
   l:Number(c[3]),c:Number(c[4])})).filter(c=>
  Number.isSafeInteger(c.t)&&c.t>=START&&c.t<=END&&
  price(c.o)&&price(c.h)&&price(c.l)&&price(c.c)&&
  c.h>=Math.max(c.o,c.c,c.l)&&c.l<=Math.min(c.o,c.c,c.h)
 ).sort((a,b)=>a.t-b.t);
}
const result=(xs,type)=>{
 const high=xs.reduce((a,b)=>!a||b.h>a.h?b:a,null);
 const low=xs.reduce((a,b)=>!a||b.l<a.l?b:a,null);
 const horizons=Object.fromEntries([5,10,15,30,54].map(minutes=>{
  const b=xs.find(x=>x.t===START+(minutes-1)*60000);
  return [minutes,b?{close:b.c,changePct:Number(((b.c-ENTRY)/ENTRY*100).toFixed(4))}:null];
 }));
 return {type,observedMinutes:xs.length,first:xs[0]||null,last:xs.at(-1)||null,
  high:high?{price:high.h,at:new Date(high.t).toISOString(),
   aboveEntryPct:Number(((high.h-ENTRY)/ENTRY*100).toFixed(4))}:null,
  low:low?{price:low.l,at:new Date(low.t).toISOString()}:null,
  priceAbove05pctMinutes:xs.filter(x=>x.h>=ENTRY*1.005).map(x=>new Date(x.t).toISOString()),
  horizons,rows:xs.map(x=>({...x,berlin:new Date(x.t).toLocaleTimeString('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'})}))};
};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const [last,mark]=await Promise.allSettled([candles('LAST'),candles('MARK')]);
  const extract=(v,type)=>v.status==='fulfilled'?result(v.value,type):
   {error:String(v.reason?.message||v.reason).slice(0,100)};
  return res.status(200).json({symbol:'1000PEPEUSDT',entry:ENTRY,entryIsForecastReferenceNotFill:true,
   startBerlin:'2026-11-11 09:00',endBerlin:'2026-11-11 09:54',
   last:extract(last,'LAST'),mark:extract(mark,'MARK'),
   note:'Historical public 1m candle OHLC. Max wick does not prove exact execution or liquidation.'});
 }catch(e){return res.status(503).json({error:String(e.message||e).slice(0,100)})}
}
