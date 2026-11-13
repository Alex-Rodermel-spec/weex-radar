// Research-only execution-cost and late-entry risk sensitivity.
// The next completed 5m OPEN is a historical PROXY, not a quote available
// at the candle-close decision. No actual fills or timestamps are inferred.
const round=(n,d=2)=>Number(n.toFixed(d));
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const side=d=>d==='LONG'?1:d==='SHORT'?-1:0;
export const V110_EXECUTION_POLICY=Object.freeze({
 version:'v110-entry-cost-shadow-v1',
 lateProxyBps:10,extraAdverseSlippageBpsEachSide:5,
 forwardMinutes:[5,10,15],noLiveGates:true,ordersSent:0
});
export function estimateV110ExecutionContext({
 direction,signalClose,nextOpen,forward,
 feeBps=8,slippageBps=3
}={}){
 const s=side(direction);
 if(!s||![signalClose,nextOpen,feeBps,slippageBps].every(finite)||
   signalClose<=0||nextOpen<=0||feeBps<0||feeBps>25||
   slippageBps<0||slippageBps>50||
   !forward||![5,10,15].every(h=>finite(forward[h]?.grossBps)))
  return null;
 const priceGapBps=round(s*(nextOpen-signalClose)/signalClose*10000);
 const stressSlippage=slippageBps+V110_EXECUTION_POLICY.extraAdverseSlippageBpsEachSide;
 const series=Object.fromEntries([5,10,15].map(h=>[h,{
  normalModeledNetBps:round(forward[h].grossBps-2*(feeBps+slippageBps)),
  stressModeledNetBps:round(forward[h].grossBps-2*(feeBps+stressSlippage))
 }]));
 return {direction,priceGapBps,
  chaseProxy:priceGapBps>=V110_EXECUTION_POLICY.lateProxyBps,
  series,noOrders:true};
}
export function summarizeV110ExecutionContext(records){
 if(!Array.isArray(records))throw Error('V110_ENTRY_ROWS_INVALID');
 const rows=records.filter(r=>r&&finite(r.priceGapBps)&&
  [5,10,15].every(h=>finite(r.series?.[h]?.normalModeledNetBps)&&
   finite(r.series?.[h]?.stressModeledNetBps)));
 const p=n=>rows.length?round(100*n/rows.length,1):null;
 const mean=values=>values.length?round(values.reduce((a,b)=>a+b,0)/values.length):null;
 const result={count:rows.length,
  chaseProxyCount:rows.filter(r=>r.chaseProxy).length,
  chaseProxyPct:p(rows.filter(r=>r.chaseProxy).length),
  meanNextOpenGapBps:mean(rows.map(r=>r.priceGapBps))};
 for(const h of [5,10,15]){
  const n=rows.filter(r=>r.series[h].normalModeledNetBps>0).length;
  const stressed=rows.filter(r=>r.series[h].stressModeledNetBps>0).length;
  result['at'+h+'m']={n:rows.length,
   normalNetPositivePct:p(n),stressNetPositivePct:p(stressed),
   stressFlipsFromPositive:rows.filter(r=>r.series[h].normalModeledNetBps>0&&
    r.series[h].stressModeledNetBps<=0).length,
   meanNormalNetBps:mean(rows.map(r=>r.series[h].normalModeledNetBps)),
   meanStressNetBps:mean(rows.map(r=>r.series[h].stressModeledNetBps))};
 }
 return result;
}
