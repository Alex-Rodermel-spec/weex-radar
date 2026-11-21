// Independent simulated trading ledger. NEVER import WEEX trading keys/order APIs.
// 15 *virtual* EUR margin per coin, 5 distinct crypto positions, 10x *virtual*
// exposure. USDT market percentage returns are modeled as EUR percentage returns:
// actual EUR/USD conversion, slippage, liquidation and tick-by-tick fills differ.
import {createHash} from 'node:crypto';

export const PAPER_POLICY=Object.freeze({
 version:'paper-5-coins-15eur-v1', mode:'PAPER_ONLY', realOrders:false,
 currency:'EUR_SIMULATED', marginEur:15, maxPositions:5, leverage:10,
 virtualCapitalEur:75, maxModeledLossEur:3, maxRealizedDrawdownEur:15,
 maxHoldingMs:30*60_000, feeBpsEachSide:8, slippageBpsEachSide:3,
 allowedCrypto:Object.freeze([
  'BTCUSDT','ETHUSDT','XRPUSDT','SOLUSDT','ALGOUSDT','1000SHIBUSDT',
  'DOGEUSDT','ZECUSDT','1000PEPEUSDT','HYPEUSDT','BNBUSDT','ADAUSDT',
  'LINKUSDT','SUIUSDT','AVAXUSDT'
 ])
});
const allowed=new Set(PAPER_POLICY.allowedCrypto);
const round=n=>Number(n.toFixed(4));
const valid=n=>typeof n==='number'&&Number.isFinite(n);
const SLIP=PAPER_POLICY.slippageBpsEachSide/10000;
const FEE=PAPER_POLICY.feeBpsEachSide/10000;
const utcDay=now=>new Date(now).toISOString().slice(0,10);

export function emptyPaperPortfolio(now=Date.now()){
 return {version:PAPER_POLICY.version,startedAt:now,lastCycleAt:null,
  active:[],closed:[],closedCount:0,seenIds:[],realizedNetEur:0,
  researchSession:{utcDay:utcDay(now),baselineRealizedEur:0,rollovers:0}};
}
export function validPaperPortfolio(p){
 return p&&p.version===PAPER_POLICY.version&&Array.isArray(p.active)&&
  p.active.length<=PAPER_POLICY.maxPositions&&Array.isArray(p.closed)&&
  Array.isArray(p.seenIds)&&valid(p.realizedNetEur)&&
  (p.researchSession===undefined||(
   /^\\d{4}-\\d{2}-\\d{2}$/.test(p.researchSession?.utcDay||'')&&
   valid(p.researchSession.baselineRealizedEur)&&
   Number.isSafeInteger(p.researchSession.rollovers)&&
   p.researchSession.rollovers>=0))&&
  new Set(p.active.map(x=>x.symbol)).size===p.active.length&&
  p.active.every(x=>allowed.has(x.symbol)&&['LONG','SHORT'].includes(x.direction)&&
   valid(x.entryPrice)&&x.entryPrice>0&&valid(x.quantity)&&x.quantity>0&&
   x.marginEur===PAPER_POLICY.marginEur&&valid(x.entryAt)&&
   valid(x.stopLoss)&&valid(x.takeProfit))&&
  Number.isSafeInteger(p.closedCount)&&p.closedCount>=p.closed.length;
}
function validQuote(q,now){
 return q&&valid(q.bid)&&valid(q.ask)&&q.bid>0&&q.ask>=q.bid&&
  valid(q.time)&&q.time<=now+5000&&now-q.time<=30000&&
  (q.ask-q.bid)/((q.ask+q.bid)/2)<=0.004;
}
function entryPrice(direction,q){
 return direction==='LONG'?q.ask*(1+SLIP):q.bid*(1-SLIP);
}
function exitPrice(direction,q){
 return direction==='LONG'?q.bid*(1-SLIP):q.ask*(1+SLIP);
}
function signalId(s){
 return createHash('sha256').update(
  s.symbol+'|'+s.direction+'|'+s.candleCloseTime+'|PAPER').digest('hex').slice(0,32);
}
function bracketValid(s,entry){
 return valid(s.stop)&&valid(s.take)&&s.stop>0&&s.take>0&&
  (s.direction==='LONG'?s.stop<entry&&entry<s.take:s.take<entry&&entry<s.stop);
}
// Capture only facts known when the paper trade is entered. Future candle
// outcomes must NEVER become model features, nor override a LIVE order gate.
function snapshotEntryFeatures(s){
 const num=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
 return {
  schema:'v110-paper-entry-v1',
  riskPolicy:'RISK_CAP_3_EUR',
  signalLevel:['STRONG','NORMAL','STANDARD'].includes(s.level)?s.level:'UNKNOWN',
  preMove5mBps:num(s.closedFiveMinuteMoveBps),
  rsi5m:num(s.indicators?.rsi),
  volumeRatio:num(s.indicators?.volumeRatio),
  trend15:['UP','DOWN'].includes(s.indicators?.trend15)?s.indicators.trend15:'UNKNOWN',
  atr5m:num(s.indicators?.atr),
  modeledNetRR:num(s.costReview?.netRR),
  modeledCostStatus:s.costReview?.status==='PASS_ESTIMATE'?'PASS_ESTIMATE':'UNKNOWN',
  retestStatus:s.retest?.[s.direction]?.status==='CONFIRMED'?'CONFIRMED':
   s.retest?.[s.direction]?.status==='FAILED'?'FAILED':'NOT_CONFIRMED',
  advisorReview:s.advisor?.status==='REVIEW',
  entryQualityOk:s.entryQuality?.ok===true
 };
}
function nextEntry(s,q,now){
 if(!s||!allowed.has(s.symbol)||s.status!=='ok'||s.exchange!=='WEEX'||
  !['LONG','SHORT'].includes(s.direction)||!valid(s.candleCloseTime)||
  s.candleCloseTime>now||now-s.candleCloseTime>90_000||
  !valid(s.expiresAt)||s.expiresAt<=now+15_000||
  !valid(s.price)||s.price<=0||!validQuote(q,now))return null;
 const mid=(q.bid+q.ask)/2;
 if(Math.abs(mid/s.price-1)>0.003)return null;
 const entry=entryPrice(s.direction,q);
 if(!bracketValid(s,entry))return null;
 const notional=PAPER_POLICY.marginEur*PAPER_POLICY.leverage;
 const qty=notional/entry,side=s.direction==='LONG'?1:-1;
 const stopExecution=s.direction==='LONG'?s.stop*(1-SLIP):s.stop*(1+SLIP);
 const netLoss=side*(entry-stopExecution)*qty+2*notional*FEE;
 const takeExecution=s.direction==='LONG'?s.take*(1-SLIP):s.take*(1+SLIP);
 const netReward=side*(takeExecution-entry)*qty-2*notional*FEE;
 if(!valid(netLoss)||netLoss<=0||netLoss>PAPER_POLICY.maxModeledLossEur||
  !valid(netReward)||netReward/netLoss<1.3)return null;
 return {id:signalId(s),symbol:s.symbol,direction:s.direction,
  marginEur:PAPER_POLICY.marginEur,leverage:PAPER_POLICY.leverage,
  notionalEur:notional,entryPrice:entry,markPrice:mid,quantity:qty,
  stopLoss:s.stop,takeProfit:s.take,entryFeeEur:round(notional*FEE),
  modeledStopLossEur:round(netLoss),enteredAt:now,entryAt:now,
  candleCloseTime:s.candleCloseTime,expiryAt:now+PAPER_POLICY.maxHoldingMs,
  entryFeatures:snapshotEntryFeatures(s)};
}
export function stepPaperPortfolio(previous,signals=[],quotes={},now=Date.now()){
 if(!Number.isFinite(now)||now<=0||!Array.isArray(signals)||!quotes||
  typeof quotes!=='object')throw Error('PAPER_BAD_INPUT');
 if(previous!==null&&previous!==undefined&&!validPaperPortfolio(previous))
  throw Error('PAPER_INVALID_SAVED_LEDGER');
 const p=previous?JSON.parse(JSON.stringify(previous)):emptyPaperPortfolio(now);
 let opened=0,closed=0,missingQuotes=0,skipped=0;
 // Close existing positions FIRST; never re-enter the same already-seen candle.
 const still=[];
 for(const position of p.active){
  const q=quotes[position.symbol];
  if(!validQuote(q,now)){still.push(position);missingQuotes++;continue;}
  const mid=(q.bid+q.ask)/2,side=position.direction==='LONG'?1:-1;
  const triggeredStop=side*(mid-position.stopLoss)<=0;
  const triggeredTake=side*(mid-position.takeProfit)>=0;
  const timedOut=now>=position.expiryAt;
  if(!triggeredStop&&!triggeredTake&&!timedOut){
   position.markPrice=mid;still.push(position);continue;
  }
  // If a quote has crossed both thresholds since the last poll, favor STOP.
  const why=triggeredStop?'STOP':triggeredTake?'TAKE':'TIMEOUT';
  const filled=exitPrice(position.direction,q);
  const exitFee=position.quantity*filled*FEE;
  const pnl=side*(filled-position.entryPrice)*position.quantity-
   position.entryFeeEur-exitFee;
  // Isolated *paper* stake has no simulated debit beyond its own margin.
  const net=round(Math.max(-position.marginEur,pnl));
  p.realizedNetEur=round(p.realizedNetEur+net);
  p.closed.push({...position,exitPrice:filled,exitedAt:now,
   reason:why,netPnlEur:net,exitFeeEur:round(exitFee)});
  p.closedCount++;closed++;
 }
 p.active=still;
 p.closed=p.closed.slice(-200);
 // Lifetime P&L is NEVER reset, including across software updates. However,
 // an ongoing PAPER-only study cannot collect new evidence once its lifetime
 // drawdown crosses -15 virtual EUR. Replenish a separate hypothetical
 // 75-EUR research stake each NEW UTC day, but ONLY with zero open positions.
 // On legacy migration, start a fresh transparent research session without
 // rewriting the historical -10.38 EUR or previous closed-trade records.
 const day=utcDay(now);
 if(!p.researchSession){
  p.researchSession={utcDay:day,
   baselineRealizedEur:p.realizedNetEur,rollovers:0};
 }else if(p.researchSession.utcDay!==day&&p.active.length===0){
  p.researchSession={utcDay:day,
   baselineRealizedEur:p.realizedNetEur,
   rollovers:p.researchSession.rollovers+1};
 }
 const sessionNetEur=round(p.realizedNetEur-
  p.researchSession.baselineRealizedEur);
 // A missing current quote on any owned position blocks ALL new paper entries.
 const haltedForStale=missingQuotes>0;
 const used=new Set(p.active.map(x=>x.symbol));
 const seen=new Set(p.seenIds);
 for(const s of signals){
  if(p.active.length>=PAPER_POLICY.maxPositions||
   sessionNetEur<=-PAPER_POLICY.maxRealizedDrawdownEur||
   haltedForStale)break;
  if(!s||used.has(s.symbol)||!allowed.has(s.symbol)){skipped++;continue;}
  const id=signalId(s);
  if(seen.has(id)){skipped++;continue;}
  const item=nextEntry(s,quotes[s.symbol],now);
  if(!item){skipped++;continue;}
  if(PAPER_POLICY.virtualCapitalEur+sessionNetEur<
    (p.active.length+1)*PAPER_POLICY.marginEur){skipped++;continue;}
  p.active.push(item);used.add(s.symbol);seen.add(id);opened++;
 }
 p.seenIds=[...seen].slice(-3000);
 p.lastCycleAt=now;
 return {portfolio:p,metrics:{mode:'PAPER_ONLY',realOrders:false,
  ordersSent:0,opened,closed,active:p.active.length,missingQuotes,
  skipped,haltedForStale,realizedNetEur:p.realizedNetEur,
  researchUtcDay:p.researchSession.utcDay,sessionNetEur,
  paperDayPaused:sessionNetEur<=-PAPER_POLICY.maxRealizedDrawdownEur,
  maxPositions:PAPER_POLICY.maxPositions,marginEur:PAPER_POLICY.marginEur,
  leverage:PAPER_POLICY.leverage}};
}
export function publicPaperStatus(state){
 const p=validPaperPortfolio(state)?state:emptyPaperPortfolio();
 return {mode:'PAPER_ONLY',realOrders:false,ordersSent:0,
  currency:PAPER_POLICY.currency,marginEur:PAPER_POLICY.marginEur,
  maxPositions:PAPER_POLICY.maxPositions,leverage:PAPER_POLICY.leverage,
  totalAllocatedMarginEur:PAPER_POLICY.virtualCapitalEur,
  openCount:p.active.length,closedCount:p.closedCount,
  realizedNetEur:p.realizedNetEur,lastCycleAt:p.lastCycleAt,
  positions:p.active.map(x=>({symbol:x.symbol,direction:x.direction,
   marginEur:x.marginEur,entryPrice:round(x.entryPrice),
   stopLoss:x.stopLoss,takeProfit:x.takeProfit,enteredAt:x.enteredAt})),
  recentClosed:p.closed.slice(-20).map(x=>({symbol:x.symbol,direction:x.direction,
   reason:x.reason,netPnlEur:x.netPnlEur,exitedAt:x.exitedAt})),
  modeledMaxLossEur:PAPER_POLICY.maxModeledLossEur,
  researchSession:p.researchSession?{
   utcDay:p.researchSession.utcDay,
   netEur:round(p.realizedNetEur-p.researchSession.baselineRealizedEur),
   dailyLossPauseEur:PAPER_POLICY.maxRealizedDrawdownEur,
   rollovers:p.researchSession.rollovers,
   virtualResearchOnly:true
  }:null,
  warning:'PAPER ONLY. New entries use a maximum modeled stop risk of 3 virtual EUR; older positions used a different cap. Research stake may reset each UTC day only while flat; lifetime losses are NEVER erased, and simulated top-ups do not exist in WEEX. EUR equivalent assumes unchanged FX; prices sampled once per cron. Intraminute stops, funding, outages, liquidity, gaps and actual liquidation are not simulated.'};
}
