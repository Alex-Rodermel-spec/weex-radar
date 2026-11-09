// Read-only fee and retracement comparisons for real sent WEEX ntfy alerts.
// Never infer real maker execution, order fill, funding, actual fee tier,
// spread, net profitability or current authorization from this model.
import {COST_MIN_NET_RR} from './net-costs.mjs';
const POS=n=>Number.isFinite(n)&&n>0;
const rounded=(n,d=3)=>Number(n.toFixed(d));
const MARKET={entryFeeBps:8,exitFeeBps:8,entrySlippageBps:3,exitSlippageBps:3};
const PASSIVE={entryFeeBps:2,exitFeeBps:8,entrySlippageBps:0,exitSlippageBps:3};
export const STUDY_ASSUMPTIONS=Object.freeze({
 feeTier:'Published WEEX VIP0 reference; not account-specific',
 market:'Taker 0.08% entry + 0.08% exit, slippage 0.03% each side',
 passive:'Hypothetical maker-only 0.02% entry, taker 0.08% exit, exit slippage 0.03%',
 spread:'ZERO assumed for this optimistic cost comparison; actual spread makes results worse',
 maxImprovementPercent:0.6,
 limitNotes:'No passive limit order is placed. Fill probability, queue, partial fills, cancellation and post-fill TP/SL are NOT simulated.',
 readiness:'R/R at alert time is separate from current WEEX trading eligibility, and not proof an order could have been placed.'
});
export function theoreticalNetRR({direction,entry,stop,take,...rates}={}){
 if(!['LONG','SHORT'].includes(direction)||![entry,stop,take].every(POS)||
  (direction==='LONG'?!(stop<entry&&entry<take):!(take<entry&&entry<stop)))return null;
 const args={...MARKET,...rates},keys=['entryFeeBps','exitFeeBps','entrySlippageBps','exitSlippageBps'];
 if(!keys.every(k=>Number.isFinite(args[k])&&args[k]>=0&&args[k]<=25))return null;
 const side=direction==='LONG'?1:-1;
 const slipIn=args.entrySlippageBps/10000,slipOut=args.exitSlippageBps/10000;
 const feeIn=args.entryFeeBps/10000,feeOut=args.exitFeeBps/10000;
 const paidEntry=entry*(1+side*slipIn);
 const netPrice=(target)=>{
  const paidExit=target*(1-side*slipOut);
  return side*(paidExit-paidEntry)-feeIn*paidEntry-feeOut*paidExit;
 };
 const profit=netPrice(take),loss=-netPrice(stop);
 if(!Number.isFinite(profit)||!Number.isFinite(loss)||loss<=0)return null;
 return {netRR:rounded(profit/loss),netProfitBps:rounded(profit/entry*10000),
  netStopBps:rounded(loss/entry*10000),
  estimatedCommissionUsdtAt500:rounded(500*(feeIn+feeOut),3)};
}
export function requiredPassiveImprovement(row,maxBps=60){
 if(!row||!Number.isFinite(maxBps)||maxBps<0||maxBps>60)return null;
 const current=theoreticalNetRR({...row,...PASSIVE});
 if(!current)return null;
 if(current.netRR>=1.5)return {bps:0,percent:0,netRR:current.netRR};
 const direction=row.direction,side=direction==='LONG'?1:-1;
 const risk=Math.abs(row.entry-row.stop);
 const boundary=(risk/row.entry)*10000*0.95;
 const upper=Math.min(maxBps,boundary);
 if(!(upper>0))return null;
 const at=(bps)=>theoreticalNetRR({...row,...PASSIVE,
  entry:row.entry*(1-side*bps/10000)});
 const last=at(upper);
 if(!last||last.netRR<1.5)return null;
 let low=0,hi=upper;
 for(let i=0;i<36;i++){
  const middle=(low+hi)/2,trial=at(middle);
  if(!trial)return null;
  if(trial.netRR>=1.5)hi=middle;else low=middle;
 }
 const bps=Math.ceil((hi+1e-9)*100)/100;
 const verified=at(bps);
 if(!verified||verified.netRR<1.5)return null;
 return {bps,percent:rounded(bps/100,4),netRR:verified.netRR};
}
export function studyOneAlert(row){
 const market=theoreticalNetRR({...row,...MARKET});
 const passive=theoreticalNetRR({...row,...PASSIVE});
 const required=requiredPassiveImprovement(row);
 return {
  decisionAtAlert:['CHECK','WAIT','SKIP','LEGACY'].includes(row?.decisionAtAlert)?
   row.decisionAtAlert:'UNKNOWN',
  netRRAtAlert:Number.isFinite(row?.netRRAtAlert)?row.netRRAtAlert:null,
  netCostPassedAtAlert:Number.isFinite(row?.netRRAtAlert)?row.netRRAtAlert>=COST_MIN_NET_RR:null,
  marketZeroSpreadNetRR:market?.netRR??null,
  passiveZeroSpreadNetRR:passive?.netRR??null,
  passiveRequiredImprovementBps:required?.bps??null,
  passiveRequiredImprovementPercent:required?.percent??null,
  passiveStatus:!passive?'UNKNOWN':required?
   (required.bps===0?'PASS_ASSUMED':'PRICE_IMPROVEMENT_NEEDED'):'OUTSIDE_0_6_PERCENT_OR_INVALID',
  // Neither market nor passive scenario authorizes any trade.
  tradeReady:false,filled:false
 };
}
export function summarizeEconomicAlerts(rows){
 if(!Array.isArray(rows))throw Error('Missing WEEX confirmed alert history');
 const result={total:rows.length,atAlert:{CHECK:0,WAIT:0,SKIP:0,LEGACY:0,UNKNOWN:0},
  reportedNetRR:0,reportedPass:0,reportedFail:0,missingCost:0,
  optimisticMarketPass:0,optimisticPassivePass:0,
  passivePossibleWithin06pct:0,passiveRequiresImprovement:0};
 for(const row of rows){
  const s=row.economics||studyOneAlert(row);
  result.atAlert[s.decisionAtAlert]++;
  if(s.netCostPassedAtAlert===null)result.missingCost++;
  else {
   result.reportedNetRR++;
   if(s.netCostPassedAtAlert)result.reportedPass++;
   else result.reportedFail++;
  }
  if(s.marketZeroSpreadNetRR!==null&&s.marketZeroSpreadNetRR>=1.5)result.optimisticMarketPass++;
  if(s.passiveZeroSpreadNetRR!==null&&s.passiveZeroSpreadNetRR>=1.5)result.optimisticPassivePass++;
  if(s.passiveRequiredImprovementBps!==null){
   result.passivePossibleWithin06pct++;
   if(s.passiveRequiredImprovementBps>0)result.passiveRequiresImprovement++;
  }
 }
 return result;
}
