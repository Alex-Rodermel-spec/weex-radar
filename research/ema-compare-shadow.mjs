// Independent paper-only A/B EMA study. GETs only public WEEX candles.
// No credentials, alerts, account data, orders, or live-strategy imports.
const MARKETS=['BTCUSDT','XRPUSDT','1000PEPEUSDT','HYPEUSDT','ZECUSDT'];
const MODES=['EMA20_50','EMA9_21_50'],FIVE=300000,FIFTEEN=900000;
const COST_BPS=22; // 8 bps fee + 3 bps slippage per side (zero spread, illustrative)
const round=(v,n=2)=>v==null?null:Number(v.toFixed(n));
async function get(symbol,interval,limit=1000){
 const url=new URL('https://api-contract.weex.com/capi/v3/market/klines');
 url.search=new URLSearchParams({symbol,interval,limit:String(limit)}).toString();
 const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'WEEX-RADAR-EMA-PAPER-RESEARCH/1.0'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(symbol+' '+interval+' HTTP '+response.status);
 const data=await response.json(),rows=Array.isArray(data)?data:data?.data;
 if(!Array.isArray(rows))throw Error('Not array: '+symbol+' '+interval);
 const period=interval==='5m'?FIVE:FIFTEEN,now=Date.now();
 const map=new Map();
 for(const r of rows){
  const [t,o,h,l,c,v]=r.slice(0,6).map(Number);
  if(![t,o,h,l,c,v].every(Number.isFinite)||t%period!==0||
      t+period>now-1000||o<=0||c<=0||l<=0||h<Math.max(o,c,l)||l>Math.min(o,c)||v<0)continue;
  map.set(t,{t,end:t+period,o,h,l,c,v});
 }
 const candles=[...map.values()].sort((a,b)=>a.t-b.t);
 if(candles.length<250||now-candles.at(-1).end>period*3)throw Error('Stale/short candles '+symbol+' '+interval);
 return candles;
}
function emaSeries(a,p){
 const e=Array(a.length).fill(null);if(a.length<p)return e;
 let s=0;for(let i=0;i<p;i++)s+=a[i];
 e[p-1]=s/p;const alpha=2/(p+1);
 for(let i=p;i<a.length;i++)e[i]=alpha*a[i]+(1-alpha)*e[i-1];
 return e;
}
function rsiSeries(a,p=14){
 const out=Array(a.length).fill(null);if(a.length<=p)return out;
 let gain=0,loss=0;
 for(let i=1;i<=p;i++){const d=a[i]-a[i-1];gain+=Math.max(0,d);loss+=Math.max(0,-d)}
 gain/=p;loss/=p;
 const score=()=>loss===0?(gain===0?50:100):100-100/(1+gain/loss);
 out[p]=score();
 for(let i=p+1;i<a.length;i++){
  const d=a[i]-a[i-1];
  gain=(gain*(p-1)+Math.max(0,d))/p;loss=(loss*(p-1)+Math.max(0,-d))/p;
  out[i]=score();
 }
 return out;
}
function summarize(rows){
 const n=rows.length;if(!n)return {n:0};
 const side=direction=>rows.filter(x=>x.dir===direction);
 const calc=(part,h)=>{
  const v=part.map(x=>x['bps'+h]);
  return {n:v.length,grossPositive:v.filter(x=>x>0).length,
    netPositive:v.filter(x=>x>COST_BPS).length,
    netPositivePct:v.length?round(v.filter(x=>x>COST_BPS).length/v.length*100,1):null,
    averageGrossBps:v.length?round(v.reduce((a,b)=>a+b,0)/v.length):null,
    averageNetBps:v.length?round(v.reduce((a,b)=>a+b,0)/v.length-COST_BPS):null};
 };
 return {n,after3:calc(rows,3),after5:calc(rows,5),
  LONG:{after3:calc(side('LONG'),3),after5:calc(side('LONG'),5)},
  SHORT:{after3:calc(side('SHORT'),3),after5:calc(side('SHORT'),5)}};
}
async function research(symbol){
 const [fifteen,five]=await Promise.all([get(symbol,'15m'),get(symbol,'5m')]);
 const p5=five.map(x=>x.c),p15=fifteen.map(x=>x.c);
 const e9=emaSeries(p5,9),e20=emaSeries(p5,20),e21=emaSeries(p5,21),e50=emaSeries(p5,50);
 const t20=emaSeries(p15,20),t50=emaSeries(p15,50),rsi=rsiSeries(p5);
 const chosen=Object.fromEntries(MODES.map(m=>[m,[]]));const all=Object.fromEntries(MODES.map(m=>[m,0]));
 const lastIndex={EMA20_50:-100,EMA9_21_50:-100};
 let h=0,evaluated=0;
 for(let i=150;i<five.length-5;i++){
  while(h+1<fifteen.length&&fifteen[h+1].end<=five[i].end)h++;
  if(fifteen[h].end>five[i].end||t20[h]==null||t50[h]==null)continue;
  if(i>0&&five[i-1].end!==five[i].t)continue;
  if(five.slice(i-59,i+1).some((x,j,a)=>j&&x.t!==a[j-1].end))continue;
  if(fifteen.slice(Math.max(0,h-60),h+1).some((x,j,a)=>j&&x.t!==a[j-1].end))continue;
  if(five.slice(i+1,i+6).some((x,j,a)=>x.t!==five[i].end+j*FIVE))continue;
  evaluated++;
  const prior=five.slice(i-12,i);
  const upper=Math.max(...prior.map(x=>x.h)),lower=Math.min(...prior.map(x=>x.l));
  const trend15=t20[h]>t50[h]&&fifteen[h].c>t20[h]?'LONG':
    t20[h]<t50[h]&&fifteen[h].c<t20[h]?'SHORT':null;
  if(!trend15)continue;
  const dir=trend15;
  const breakout=dir==='LONG'?five[i].c>upper&&rsi[i]>=55&&rsi[i]<=77:
    five[i].c<lower&&rsi[i]>=23&&rsi[i]<=45;
  if(!breakout)continue;
  const conditions={
   EMA20_50:dir==='LONG'?(e20[i]>e50[i]&&five[i].c>e20[i]):
     (e20[i]<e50[i]&&five[i].c<e20[i]),
   EMA9_21_50:dir==='LONG'?(e9[i]>e21[i]&&e21[i]>e50[i]&&five[i].c>e9[i]):
     (e9[i]<e21[i]&&e21[i]<e50[i]&&five[i].c<e9[i])
  };
  for(const mode of MODES){
   if(!conditions[mode])continue;
   all[mode]++;
   // Exactly one hypothetical position per symbol/model at a time, 5 bars apart.
   if(i-lastIndex[mode]<5)continue;lastIndex[mode]=i;
   const entry=five[i+1].o,sign=dir==='LONG'?1:-1;
   if(entry<=0)continue;
   const ret=bars=>sign*(five[i+bars].c-entry)/entry*10000;
   chosen[mode].push({t:five[i].end,dir,bps3:ret(3),bps5:ret(5)});
  }
 }
 return {symbol,evaluated,range:[new Date(five[0].t).toISOString(),new Date(five.at(-1).end).toISOString()],
  allCandidates:all,chosen,results:Object.fromEntries(MODES.map(m=>[m,summarize(chosen[m])]))};
}
const results=[];
for(const symbol of MARKETS){
 try{const r=await research(symbol);results.push(r);console.log('MARKET_RESULT '+JSON.stringify({symbol:r.symbol,evaluated:r.evaluated,range:r.range,allCandidates:r.allCandidates,results:r.results}));}
 catch(e){console.error('MARKET_ERROR '+symbol+' '+(e?.message||e))}
}
if(results.length<3)throw Error('Too few markets for comparison');
const aggregate=Object.fromEntries(MODES.map(mode=>[mode,summarize(results.flatMap(x=>x.chosen[mode]))]));
console.log('EMA_AB_FINAL '+JSON.stringify({date:new Date().toISOString(),source:'WEEX futures',tested:results.map(x=>x.symbol),comparison:'Same closed 5m 12-bar breakout and RSI, same closed 15m EMA20/50 trend. Only 5m EMA filter changes. Non-overlapping entries per market/variant; entry next 5m open.',horizons:'close after 3 and 5 completed 5m bars; no TP/SL in this independent check',costBpsRoundTrip:COST_BPS,assumptions:'Zero spread, no funding or execution/latency. Fixed-time hypothetical exits, NOT actual live alerts or user profit.',aggregate,markets:results.map(x=>({symbol:x.symbol,range:x.range,counts:x.allCandidates,results:x.results}))}));
