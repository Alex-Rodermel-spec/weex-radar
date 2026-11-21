// V110 trade-outcome intelligence: PAPER-ONLY, no network, order APIs,
// notifications, strategy or automated promotion. Honest closed-trade P&L
// after modeled fills/costs, not simply future candle direction.
// Historical positions without entry-time features remain in the descriptive
// audit, NEVER in the prospective feature-based training cohort.
const MIN=60_000,DAY=24*60*MIN;
const MEMES=new Set(['1000PEPEUSDT','1000SHIBUSDT','DOGEUSDT']);
const ROUND=n=>Math.round(n*10000)/10000;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const V110_TRADE_LEARNING_POLICY=Object.freeze({
 version:'v110-paper-trade-outcomes-v1',
 source:'CLOSED_PAPER_TRADES_ONLY',
 featureSchema:'v110-paper-entry-v1',
 newRiskEra:'RISK_CAP_3_EUR',
 minimumTrain:80,minimumHoldout:40,minimumTrainDays:3,
 minimumHoldoutDays:2,embargoMinutes:30,minimumSelected:20,
 minimumCoverage:0.4,minimumMeanLiftEur:0.1,
 requirePositiveHoldoutMean:true,ordersSent:0,changes108:false,
 automaticPromotion:false,realMoney:false
});
const FILTERS=Object.freeze([
 {id:'NO_MEME',test:r=>!MEMES.has(r.symbol)},
 {id:'SHORT_ONLY',test:r=>r.direction==='SHORT'},
 {id:'LONG_ONLY',test:r=>r.direction==='LONG'},
 {id:'SKIP_CHASED_5M',test:r=>finite(r.entryFeatures.preMove5mBps)&&r.entryFeatures.preMove5mBps<10},
 {id:'REQUIRE_NET_RR_1_6',test:r=>finite(r.entryFeatures.modeledNetRR)&&r.entryFeatures.modeledNetRR>=1.6},
 {id:'RETEST_CONFIRMED',test:r=>r.entryFeatures.retestStatus==='CONFIRMED'}
]);
const day=n=>new Date(n).toISOString().slice(0,10);
function dedupeTrades(trades){
 const seen=new Set(),rows=[];
 for(const r of Array.isArray(trades)?trades:[]){
  if(!r||typeof r.id!=='string'||!r.id||seen.has(r.id)||
   typeof r.symbol!=='string'||!['LONG','SHORT'].includes(r.direction)||
   !['TAKE','STOP','TIMEOUT'].includes(r.reason)||
   !finite(r.enteredAt)||!finite(r.exitedAt)||r.exitedAt<r.enteredAt||
   !finite(r.netPnlEur)||Math.abs(r.netPnlEur)>100)continue;
  seen.add(r.id);rows.push(r);
 }
 return rows.sort((a,b)=>a.enteredAt-b.enteredAt||a.exitedAt-b.exitedAt);
}
function metrics(rows){
 let grossWin=0,grossLoss=0,wins=0,lossCount=0,stops=0,takes=0,timeouts=0,pnl=0;
 for(const r of rows){
  const p=r.netPnlEur;pnl+=p;
  if(p>0){grossWin+=p;wins++}else if(p<0){grossLoss-=p;lossCount++;}
  if(r.reason==='STOP')stops++;
  else if(r.reason==='TAKE')takes++;
  else timeouts++;
 }
 return {n:rows.length,realizedNetEur:ROUND(pnl),
  meanNetEur:rows.length?ROUND(pnl/rows.length):null,
  profitablePct:rows.length?ROUND(100*wins/rows.length):null,
  takeCount:takes,stopCount:stops,timeoutCount:timeouts,lossCount,
  profitFactor:grossLoss>0?ROUND(grossWin/grossLoss):null,
  distinctDays:new Set(rows.map(r=>day(r.enteredAt))).size};
}
function group(rows,selector){
 const groups={};
 for(const r of rows){const k=selector(r);(groups[k]||=[]).push(r)}
 return Object.fromEntries(Object.entries(groups).sort(([a],[b])=>a.localeCompare(b))
  .map(([key,items])=>[key,metrics(items)]));
}
function candidateOn(train,filter){
 const selected=train.filter(filter.test),m=metrics(selected),base=metrics(train);
 const coverage=train.length?selected.length/train.length:0;
 return {filterId:filter.id,coveragePct:ROUND(coverage*100),
  baseline:base,candidate:m,trainPass:
   selected.length>=V110_TRADE_LEARNING_POLICY.minimumSelected&&
   coverage>=V110_TRADE_LEARNING_POLICY.minimumCoverage&&
   m.meanNetEur!==null&&m.meanNetEur>0&&
   m.meanNetEur>=base.meanNetEur+V110_TRADE_LEARNING_POLICY.minimumMeanLiftEur&&
   (m.profitFactor!==null&&m.profitFactor>=1.15||
    m.lossCount===0&&m.realizedNetEur>0)};
}
export function evaluateV110PaperTrades(portfolio){
 const p=V110_TRADE_LEARNING_POLICY;
 const rows=dedupeTrades(portfolio?.closed);
 const newRows=rows.filter(r=>r.entryFeatures?.schema===p.featureSchema&&
  r.entryFeatures.riskPolicy===p.newRiskEra);
 const base={mode:'READ_ONLY_TRADE_OUTCOME_SHADOW',policyVersion:p.version,
  realOrders:false,ordersSent:0,live108Changed:false,
  automaticPromotion:false,recommendation:'KEEP_108',
  source:'PAPER_EXECUTION_MODEL_NOT_WEEX_FILLS',
  all:metrics(rows),byDirection:group(rows,r=>r.direction),
  byExit:group(rows,r=>r.reason),
  byMarketGroup:group(rows,r=>MEMES.has(r.symbol)?'MEME':'OTHER_CRYPTO'),
  priorUnfeatured:rows.length-newRows.length,
  prospectiveFeatured:newRows.length,
  minRequired:{train:p.minimumTrain,holdout:p.minimumHoldout,
   trainDays:p.minimumTrainDays,holdoutDays:p.minimumHoldoutDays},
  caveat:'Paper fills are 1m sampled bid/ask, not actual WEEX execution, funding, EUR/USD, liquidation or risk-adjusted live profit. Historical unfeatured trades never masquerade as model training examples. A selected subset does NOT simulate freed capacity or missed alternate signals.'};
 const days=[...new Set(newRows.map(r=>day(r.enteredAt)))].sort();
 if(days.length<p.minimumTrainDays+p.minimumHoldoutDays)return {
  ...base,status:'COLLECTING_PROSPECTIVE_TRADE_DAYS',days:days.length};
 const boundaryDay=days[Math.max(p.minimumTrainDays,
  Math.min(days.length-p.minimumHoldoutDays,Math.floor(days.length*.7)))];
 const boundary=Date.parse(boundaryDay+'T00:00:00.000Z');
 const embargo=p.embargoMinutes*MIN;
 // Train only on closed trade outcomes known BEFORE the untouched future
 // period. Never select a candidate based on holdout results.
 const train=newRows.filter(r=>r.exitedAt<boundary-embargo);
 const holdout=newRows.filter(r=>r.enteredAt>=boundary+embargo);
 const counts={train:metrics(train),holdout:metrics(holdout),boundaryDay};
 if(train.length<p.minimumTrain||holdout.length<p.minimumHoldout||
  counts.train.distinctDays<p.minimumTrainDays||
  counts.holdout.distinctDays<p.minimumHoldoutDays)return {
  ...base,status:'COLLECTING_INDEPENDENT_TRADE_OUTCOMES',
  days:days.length,split:counts};
 const selected=FILTERS.map(f=>candidateOn(train,f)).filter(x=>x.trainPass)
  .sort((a,b)=>b.candidate.meanNetEur-a.candidate.meanNetEur||
   b.coveragePct-a.coveragePct||a.filterId.localeCompare(b.filterId))[0];
 if(!selected)return {...base,status:'NO_TRAINING_CANDIDATE',split:counts};
 const rule=FILTERS.find(f=>f.id===selected.filterId);
 const held=metrics(holdout.filter(rule.test));
 const heldBase=counts.holdout;
 const pass=held.n>=p.minimumSelected&&
  held.n/holdout.length>=p.minimumCoverage&&
  held.meanNetEur>0&&
  held.meanNetEur>=heldBase.meanNetEur+p.minimumMeanLiftEur&&
  (held.profitFactor!==null&&held.profitFactor>=1.15||
   held.lossCount===0&&held.realizedNetEur>0);
 return {...base,status:pass?'HOLDOUT_PROMISING_FORWARD_TEST_REQUIRED':
  'HOLDOUT_REJECTED',split:counts,
  candidate:{filterId:selected.filterId,train:selected.candidate,
   holdout:held,holdoutCoveragePct:ROUND(100*held.n/holdout.length),
   independentProspectiveTestPassed:false},
  recommendation:pass?'PAPER_FORWARD_REVIEW_ONLY':'KEEP_108'};
}
