// OBSERVATION ONLY: estimated round-trip costs of a hypothetical WEEX
// futures taker position at a *fresh* WEEX bid/ask quote.
// Published reference WEEX VIP0 futures taker commission: 0.08% each way
// (https://www.weex.com/help/articles/50717160193561).
// Not the user's account-specific rate. Slippage is an assumption (3bps
// each way), and exit spread is assumed equal to the observed entry spread.
// No orders, account API calls, blocking filters or background jobs.
export const DEFAULT_TAKER_FEE_BPS=8;
export const DEFAULT_SLIPPAGE_BPS=3;
export const COST_MIN_NET_RR=1.5;
const round=(n,d=3)=>Number(n.toFixed(d));
const finitePositive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const DIRS=['LONG','SHORT'];
const bps=x=>x*10000;

export function assessNetCosts({
 exchange='WEEX',direction,entryMid,stop,take,bid,ask,
 feeBpsEachSide=DEFAULT_TAKER_FEE_BPS,
 slippageBpsEachSide=DEFAULT_SLIPPAGE_BPS
}={}){
 if(exchange!=='WEEX')return null; // WEEX tariff never applied to Bybit.
 if(!DIRS.includes(direction)||![entryMid,stop,take,bid,ask].every(finitePositive)||
   ask<bid||entryMid<bid-0.000001*entryMid||
   entryMid>ask+0.000001*entryMid||
   !Number.isFinite(feeBpsEachSide)||feeBpsEachSide<0||feeBpsEachSide>25||
   !Number.isFinite(slippageBpsEachSide)||slippageBpsEachSide<0||
   slippageBpsEachSide>50||
   ((ask-bid)/entryMid)>.004||
   (direction==='LONG'&&!(stop<entryMid&&entryMid<take))||
   (direction==='SHORT'&&!(take<entryMid&&entryMid<stop)))
  return null;
 const side=direction==='LONG'?1:-1;
 const slip=slippageBpsEachSide/10000,fee=feeBpsEachSide/10000;
 const halfSpread=(ask-bid)/(2*entryMid);
 // Entry is explicitly quoted at the crossing side of the *current* book.
 const entryFill=(side===1?ask:bid)*(1+side*slip);
 // At future TP/SL, the book is unknown: model the same half-spread,
 // adverse for the exit. This is a what-if, not an execution estimate.
 function exitAt(price){
  const fill=price*(1-side*halfSpread)*(1-side*slip);
  const grossPriceMove=side*(price-entryMid);
  const netPriceMove=side*(fill-entryFill)-fee*(entryFill+fill);
  return {fill,grossPriceMove,netPriceMove};
 }
 const reward=exitAt(take),loss=exitAt(stop);
 const netTargetBps=bps(reward.netPriceMove/entryMid);
 const netStopLossBps=bps(-loss.netPriceMove/entryMid);
 if(!Number.isFinite(netTargetBps)||!Number.isFinite(netStopLossBps)||
  netStopLossBps<=0)return null;
 const grossTargetBps=bps(reward.grossPriceMove/entryMid);
 const grossStopBps=bps(-loss.grossPriceMove/entryMid);
 const grossRR=grossTargetBps/grossStopBps;
 const netRR=reward.netPriceMove/(-loss.netPriceMove);
 const status=netTargetBps<=0?'COSTS_EXCEED_TP':
  netRR<COST_MIN_NET_RR?'LOW_NET_RR':'PASS_ESTIMATE';
 const observedSpreadBps=bps((ask-bid)/entryMid);
 // Model break-even future MID price, with the modeled exit crossing
 // spread and slippage and fees paid at both ends:
 // side*(exitMid*(1-side*halfSpread)*(1-side*slip)-entryFill)
 //     - fee*(entryFill+exitMid*(1-side*halfSpread)*(1-side*slip))=0
 const factor=(1-side*halfSpread)*(1-side*slip);
 const denominator=(side-fee)*factor;
 const breakevenMid=denominator===0?NaN:
  (side+fee)*entryFill/denominator;
 const minMoveBps=Number.isFinite(breakevenMid)?
  bps(side*(breakevenMid-entryMid)/entryMid):null;
 const notes={
  COSTS_EXCEED_TP:'⚠️ TP меньше предполагаемых расходов — вход может быть убыточным даже при достижении цели',
  LOW_NET_RR:'⚠️ После расходов соотношение потенциальной прибыли к риску ниже 1,5',
  PASS_ESTIMATE:'🔎 Расчётный R/R после расходов ≥ 1,5; это не гарантия исполнения или прибыли'
 };
 return {
  mode:'SHADOW_COSTS',status,blocksSignal:false,
  feeBpsEachSide,slippageBpsEachSide,
  observedSpreadBps:round(observedSpreadBps,3),
  grossTargetBps:round(grossTargetBps,3),
  grossStopBps:round(grossStopBps,3),
  grossRR:round(grossRR,3),
  netTargetBps:round(netTargetBps,3),
  netStopLossBps:round(netStopLossBps,3),
  netRR:round(netRR,3),
  minGrossMoveBpsForBreakeven:minMoveBps===null?null:round(minMoveBps,3),
  per1000UsdtNotional:{
   netAtTP:round(1000*reward.netPriceMove/entryMid,2),
   netAtSL:round(1000*loss.netPriceMove/entryMid,2)
  },
  note:notes[status],
  assumptions:'WEEX VIP0 taker 0.08% each side; slippage 0.03% each side; exit spread assumed same as fresh entry bid/ask. Funding, spread changes, latency, liquidation and market impact NOT included. Check actual account fees.'
 };
}
