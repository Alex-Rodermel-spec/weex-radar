import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freezeV110DirectionForensics,compareV110AlignmentDirectionFailures,
 V110_DIRECTION_FORENSIC_POLICY as POLICY} from '../lib/v110-direction-failure-forensics.mjs';
import {freezeV110ForwardReceipt,scoreV110FrozenForwardReceipt}
 from '../lib/v110-forward-receipts.mjs';
import {summarizeV110All32EarlyCohorts} from '../lib/v110-all32-early-cohorts.mjs';

const MIN=60000,FIVE=5*MIN;
const at=Date.UTC(2026,10,15,11,40,30);
function market(symbol='BNBUSDT',dir='LONG_BIAS'){
 const short=dir==='SHORT_BIAS';
 const price=short?94.26:598.61;
 const fiveBody=short?12:-9; // synthetic CLOSED prior 5m; NOT screenshot 12:40 bar
 return {symbol,available:true,exchange:'WEEX',
  combinedDirection:dir,alignment:'THREE_TIMEFRAME_ALIGNMENT',
  timeframes:[
   {intervalMinutes:1,direction:dir,closedAt:at-30000,price,
    lastCandleBody:short?'DOWN':'UP',rsi14:short?42:61,
    atr14:1.2,relativeVolume:1.13,
    bollinger20:{position:'UPPER_HALF'}},
   {intervalMinutes:5,direction:dir,closedAt:Math.floor((at-1000)/FIVE)*FIVE,
    lastCandleBody:short?'UP':'DOWN',
    lastCandleBodyBps:fiveBody,rsi14:short?44:68},
   {intervalMinutes:10,direction:dir,closedAt:Math.floor((at-1000)/(2*FIVE))*(2*FIVE),
    lastCandleBody:'UP',rsi14:short?45:62}
  ],
  primaryContext:{structure:'RANGE_OR_MIXED',
   observedResistance:599.25,observedSupport:93.92,recentBreakout:'NONE'},
  reversalRisk:{sampleReady:true,risk:'CLEAR',highRisk:false,reasons:[]},
  arrivalTiming:{sampleReady:true,lateRisk:false},
  strengthRisk:{level:'STANDARD',reasons:[]}
 };
}
const futureBars=(price=598.61,step=-0.05)=>Array.from({length:20},(_,i)=>{
 const start=Math.ceil(at/MIN)*MIN+i*MIN;
 return {time:start,closeTime:start+MIN,open:price+i*step,
  close:price+(i+1)*step};
});
test('freeze 12:40 BNB-like pre-event danger, independent of unknown future',()=>{
 const d=market(),snap=freezeV110DirectionForensics(d,at);
 assert.equal(snap.observedAt,at);
 assert.equal(snap.closedAt.five,Date.UTC(2026,10,15,11,40));
 assert.equal(snap.priorClosed5mAgainst,true);
 assert.equal(snap.priorClosed1mAgainst,false);
 assert.equal(snap.strengthLevel,'STANDARD');
 assert.equal(snap.lateStatus,'NOT_LATE');
 assert.equal(snap.reversalRisk,'CLEAR');
 assert.equal(snap.nearPriorObstacle,true);
 assert.ok(snap.priorObstacleDistanceBps>10);
 assert.equal(snap.hasPostEventEvidence,false);
 assert.equal(snap.noTrade,true);
 assert.equal(POLICY.noLiveFilters,true);
 // Freeze not changed by seeing adverse future bars from AFTER the time.
 const frozen=freezeV110ForwardReceipt(d,'THREE_TIMEFRAME_ALIGNMENT_CONTROL',at);
 assert.deepEqual(frozen.preEventDirectionRisk,snap);
 assert.equal(frozen.publicationStatus,'UNKNOWN_NOT_VERIFIED');
 const scored=scoreV110FrozenForwardReceipt(frozen,futureBars(),at+22*MIN);
 assert.equal(scored.status,'OBSERVED');
 assert.equal(scored.horizons[15].directionResult,'ADVERSE');
 assert.deepEqual(scored.preEventDirectionRisk,snap);
 const result=compareV110AlignmentDirectionFailures([scored]);
 assert.equal(result.fullyPaired,1);
 assert.equal(result.byDirection.LONG.ALL.observed,1);
 assert.equal(result.byDirection.LONG.ALL.adverse,1);
 assert.equal(result.byDirection.LONG.NEAR_PRIOR_OBSTACLE.observed,1);
 assert.equal(result.byDirection.LONG.V2_NOT_LATE.observed,1);
 assert.equal(result.byDirection.LONG.ALL.favorablePct,null);
 assert.equal(result.readyForPromotion,false);
});
test('SHORT uses prior SUPPORT rather than resistance and flags last five minute against',()=>{
 const d=market('CSCOUSDT','SHORT_BIAS');
 const x=freezeV110DirectionForensics(d,at);
 assert.equal(x.priorClosed5mAgainst,true);
 assert.equal(x.nearPriorObstacle,true);
 assert.ok(x.priorObstacleDistanceAtr>0);
 assert.equal(x.rsi.five,44);
});
test('all missing pre-event context stays UNKNOWN, not clear or far from resistance',()=>{
 const d=market();
 delete d.primaryContext;
 delete d.reversalRisk;
 delete d.strengthRisk;
 delete d.arrivalTiming;
 delete d.timeframes[1].lastCandleBody;
 delete d.timeframes[0].atr14;
 const x=freezeV110DirectionForensics(d,at);
 assert.equal(x.nearPriorObstacle,null);
 assert.equal(x.priorObstacleDistanceBps,null);
 assert.equal(x.priorClosed5mAgainst,null);
 assert.equal(x.reversalRisk,'UNKNOWN');
 assert.equal(x.lateStatus,'UNKNOWN');
 assert.equal(x.strengthLevel,'UNAVAILABLE');
 assert.equal(x.noTrade,true);
});
test('bad timeframe, future timestamp, missing one-minute price rejected',()=>{
 const d=market();
 assert.equal(freezeV110DirectionForensics({...d,exchange:'Bybit'},at),null);
 const f=market();f.timeframes[0].closedAt=at+MIN;
 assert.equal(freezeV110DirectionForensics(f,at),null);
 const g=market();g.timeframes[0].price=0;
 assert.equal(freezeV110DirectionForensics(g,at),null);
});
test('research only: no new requests, storage, trade, ntfy or live filter',()=>{
 const risk=readFileSync(new URL('../lib/v110-direction-failure-forensics.mjs',import.meta.url),'utf8');
 const receipt=readFileSync(new URL('../lib/v110-forward-receipts.mjs',import.meta.url),'utf8');
 for(const forbidden of ['fetch(', '@vercel/blob','process.env','publishNtfy',
  'NTFY_TOPIC','placeOrder','api-contract.weex.com']){
  assert.equal(risk.includes(forbidden),false,forbidden);
 }
 assert.match(receipt,/preEventDirectionRisk:freezeV110DirectionForensics\(observation,now\)/);
 assert.equal(POLICY.noNewExchangeCalls,true);
 assert.equal(POLICY.noNewStorage,true);
 assert.equal(POLICY.bnbSelectedScreenshotNotTrainingEvidence,true);
});
