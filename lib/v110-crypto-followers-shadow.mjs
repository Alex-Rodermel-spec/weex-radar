// №110: read-only 16-crypto leader / possible follower hypothesis.
// From public, already-fetched WEEX closed 1m/5m/10m snapshots only.
// Neither a confirmed predictive relationship nor a manual entry signal.
import {createHash} from 'node:crypto';
import {profileSymbols,marketForecastProfile} from './market-forecast-profiles.mjs';
const MIN=60000,FIVE=5*MIN;
const CRYPTO_GROUPS=new Set(['MAJOR_CRYPTO','ALT_CRYPTO','MEME_CRYPTO']);
const CRYPTO=profileSymbols().filter(s=>CRYPTO_GROUPS.has(marketForecastProfile(s)?.group));
const UNIVERSE=new Set(CRYPTO),LEADERS=6,LEADER_BODY_BPS=10,QUIET_BPS=4;
const HORIZONS=[5,10,15];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=x=>Math.round(x*100)/100;
if(CRYPTO.length!==16||new Set(CRYPTO).size!==16)throw Error('V110_LEAD_LAG_CRYPTO16');
export const V110_LEADER_FOLLOWER_POLICY=Object.freeze({
 version:'v110-crypto16-leader-follower-frozen-hypotheses-v1',
 cryptoUniverse:16,scannedUniverse:32,
 minLeaderCoins:LEADERS,minLeaderCandleBodyBps:LEADER_BODY_BPS,
 maxQuietFollowerAbs5mBodyBps:QUIET_BPS,
 candleDurationMinutes:5,forwardHorizonMinutes:HORIZONS,
 onlyMostRecentCompleted5m:true,alignedSameClose:true,
 originalScanOnly:true,extraMarketRequests:0,extraAlerts:0,
 extraStorage:false,live108Changes:false,ordersSent:0,
 paidApiCalls:0,trainingWeightsChanged:false,
 automaticFutureOutcomeScoring:false,readyForLivePromotion:false
});
const clock=x=>Number.isSafeInteger(x)&&x>0;
function validSnapshot(d,now,expectedClose){
 if(!d||d.available!==true||d.exchange!=='WEEX'||!UNIVERSE.has(d.symbol)||
  !Array.isArray(d.timeframes)||d.timeframes.map(x=>x?.intervalMinutes).join(',')!=='1,5,10')
  return false;
 const [one,five,ten]=d.timeframes;
 if(![one,five,ten].every(x=>clock(x.closedAt)&&x.closedAt<=now)||
   now-one.closedAt>2*MIN||now-ten.closedAt>11*MIN||
   five.closedAt!==expectedClose||one.closedAt<five.closedAt||
   !finite(one.price)||one.price<=0||
   !finite(five.lastCandleBodyBps)||Math.abs(five.lastCandleBodyBps)>1000)
  return false;
 return true;
}
function stableId(symbol,side,close){
 return createHash('sha256').update('v110-lead-lag-v1|'+symbol+'|'+side+'|'+close)
  .digest('hex').slice(0,24);
}
// A same-candle market breadth snapshot generates *hypotheses*, not temporal
// proof that leaders moved before the target or that the target later follows.
export function summarizeV110CryptoFollowers(snapshots,now=Date.now()){
 const latestClose=clock(now)?Math.floor((now-1000)/FIVE)*FIVE:null;
 const out={mode:'V110_16_CRYPTO_POTENTIAL_FOLLOWERS',status:'INVALID_INPUT',
  policy:V110_LEADER_FOLLOWER_POLICY,observedAt:now,
  expectedClosed5mAt:latestClose,validCrypto:0,missingCrypto:16,
  duplicateCrypto:0,upLeaders:0,downLeaders:0,quietCount:0,
  candidateCount:0,candidates:[],
  hypothesesFrozenBeforeFuture:true,futureOutcomesMeasured:false,
  warning:'Six assets moving during the SAME completed 5m candle does not prove that they lead or predict a seventh. Candidates must be followed on later fully closed candles, compared to an untouched baseline, different days, and BTC/ETH market-wide moves. 10bps and 4bps are fixed RESEARCH thresholds, not entry rules.',
  noTrade:true,ordersSent:0,changesLive108:false};
 if(!Array.isArray(snapshots)||!clock(now)||!latestClose||snapshots.length>64)return out;
 const cryptoSnapshots=snapshots.filter(d=>UNIVERSE.has(d?.symbol)),bySymbol=new Map();
 for(const d of cryptoSnapshots){
  if(bySymbol.has(d.symbol)){out.duplicateCrypto++;continue;}
  bySymbol.set(d.symbol,d);
 }
 const valid=[...bySymbol.values()].filter(d=>validSnapshot(d,now,latestClose));
 out.validCrypto=valid.length;out.missingCrypto=16-valid.length;
 if(out.duplicateCrypto||valid.length!==16)
  return {...out,status:'INCOMPLETE_CRYPTO16_SAME_CLOSE'};
 const up=valid.filter(d=>d.timeframes[1].lastCandleBodyBps>=LEADER_BODY_BPS);
 const down=valid.filter(d=>d.timeframes[1].lastCandleBodyBps<=-LEADER_BODY_BPS);
 const quiet=valid.filter(d=>Math.abs(d.timeframes[1].lastCandleBodyBps)<=QUIET_BPS);
 out.upLeaders=up.length;out.downLeaders=down.length;out.quietCount=quiet.length;
 if(up.length>=LEADERS&&down.length>=LEADERS)
  return {...out,status:'OPPOSING_LEADER_COHORTS_NO_HYPOTHESIS'};
 const direction=up.length>=LEADERS?'LONG':down.length>=LEADERS?'SHORT':null;
 if(!direction)return {...out,status:'NO_SIX_LEADERS'};
 const leaderSet=(direction==='LONG'?up:down).map(d=>d.symbol).sort();
 out.candidates=quiet.map(d=>({
  id:stableId(d.symbol,direction,latestClose),
  kind:'POSSIBLE_LAGGING_CRYPTO_NOT_VERIFIED',
  symbol:d.symbol,direction,referencePrice:d.timeframes[0].price,
  frozenAt:now,oneClosedAt:d.timeframes[0].closedAt,
  fiveClosedAt:latestClose,leaderSymbols:leaderSet,leaderCount:leaderSet.length,
  local5mBodyBps:d.timeframes[1].lastCandleBodyBps,
  futureHorizonsMinutes:HORIZONS,publicationStatus:'RESEARCH_NOT_SENT',
  outcomesAvailable:false,ordersSent:0
 })).sort((a,b)=>a.symbol.localeCompare(b.symbol));
 out.candidateCount=out.candidates.length;
 return {...out,status:out.candidateCount?'HYPOTHESES_FROZEN':'NO_QUIET_FOLLOWERS'};
}
// Pure offline scorer; NOT invoked automatically by the 10m scan.
// Consecutive, actually future closed 1m candles are required. Never use a
// candle from the candidate's publication minute or infer a missed level.
export function scoreV110CryptoFollower(receipt,minuteBars,now=Date.now()){
 const base={mode:'V110_CRYPTO_FOLLOWER_OFFLINE_FORWARD',
  status:'INVALID_INPUT',horizons:{},noTrade:true,ordersSent:0,
  note:'Research-only signed future close vs frozen quote, not a fill or realized P&L. No live entry permission.'};
 if(!receipt||receipt.kind!=='POSSIBLE_LAGGING_CRYPTO_NOT_VERIFIED'||
  !UNIVERSE.has(receipt.symbol)||!['LONG','SHORT'].includes(receipt.direction)||
  !/^[a-f0-9]{24}$/.test(receipt.id||'')||
  !clock(receipt.frozenAt)||!clock(receipt.fiveClosedAt)||
  !finite(receipt.referencePrice)||receipt.referencePrice<=0||
  !Array.isArray(minuteBars)||minuteBars.length>500||!clock(now)||
  now<receipt.frozenAt)return base;
 const first=Math.ceil((receipt.frozenAt+1)/MIN)*MIN;
 const seen=new Map(),duplicates=new Set();
 for(const b of minuteBars){
  if(!clock(b?.time)||b.time%MIN!==0||b.time<first||
   b.time+MIN>now-1000||!finite(b.close)||b.close<=0||
   (b.closeTime!==undefined&&b.closeTime!==b.time+MIN))continue;
  if(seen.has(b.time))duplicates.add(b.time);else seen.set(b.time,b.close);
 }
 for(const t of duplicates)seen.delete(t);
 const side=receipt.direction==='LONG'?1:-1;
 const horizons={};
 for(const h of HORIZONS){
  let contiguous=true;
  for(let i=0;i<h;i++)if(!seen.has(first+i*MIN)){contiguous=false;break;}
  if(!contiguous){horizons[h]={status:'PENDING_OR_MISSING',signedBps:null};continue;}
  const signedBps=round(side*(seen.get(first+(h-1)*MIN)/receipt.referencePrice-1)*10000);
  horizons[h]={status:'OBSERVED',signedBps,
   directionResult:signedBps>0?'FAVORABLE':signedBps<0?'ADVERSE':'FLAT',
   lastClosedAt:first+h*MIN};
 }
 return {...base,status:HORIZONS.every(h=>horizons[h].status==='OBSERVED')?
  'OBSERVED':'PENDING_OR_MISSING',id:receipt.id,direction:receipt.direction,
  firstFutureCandleAt:first,horizons};
}
