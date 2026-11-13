import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeV110DepthFeature,evaluateV110DepthPairs,V110_DEPTH_POLICY}
 from '../lib/v110-depth-shadow.mjs';

const H=3600000,NOW=Date.UTC(2026,10,13,4,0,0);
const id=i=>i.toString(16).padStart(32,'0');
function book(sentAt,{bid=200,ask=100,offset=-1000,symbol='BTCUSDT'}={}){
 return {symbol,exchange:'WEEX',mode:'observation-only',
  ordersEnabled:false,alertsUnchanged:true,fetchedAt:sentAt+offset,
  bestBid:100,bestAsk:100.01,spreadBps:1,
  nearDepthUSDT:{bid025:bid,ask025:ask,bid050:bid*2,ask050:ask*2}};
}
function pairs(n,{reverseHoldout=false}={}){
 return Array.from({length:n},(_,i)=>{
  const sentAt=NOW-(n-i+2)*H,pressureHigh=i%2===0;
  const f={id:id(i),symbol:'BTCUSDT',direction:'LONG',sentAt,
   windows:{15:{status:'OBSERVED',moveBps:pressureHigh?16:-16},
    30:{status:'OBSERVED',moveBps:pressureHigh?12:-12}}};
  if(reverseHoldout&&i>=Math.floor(n*0.7)){
   f.windows[15].moveBps*=-1;
   f.windows[30].moveBps*=-1;
  }
  return {forecast:f,bookFeature:makeV110DepthFeature(
   book(sentAt,{bid:pressureHigh?200:100,ask:pressureHigh?100:200}),
   {forecastId:f.id,symbol:f.symbol,direction:f.direction,sentAt})};
 });
}
test('depth must be captured BEFORE original forecast publication and within 10 seconds',()=>{
 const sentAt=NOW-2*H,base={forecastId:id(1),symbol:'BTCUSDT',direction:'LONG',sentAt};
 const valid=makeV110DepthFeature(book(sentAt),base);
 assert.equal(valid.usable,true);
 assert.equal(valid.status,'FEATURE_ONLY');
 assert.equal(valid.directionalPressurePct,33.3);
 assert.equal(valid.timestampSource,'LOCAL_HTTP_RESPONSE_NOT_EXCHANGE_TIMESTAMP');
 assert.equal(makeV110DepthFeature(book(sentAt,{offset:20000}),base).reason,'NOT_CAPTURED_AT_FORECAST_TIME');
 assert.equal(makeV110DepthFeature(book(sentAt,{offset:-20000}),base).usable,false);
 assert.equal(makeV110DepthFeature(book(sentAt,{symbol:'ETHUSDT'}),base).usable,false);
});
test('pressure direction flips for SHORT, without trading action',()=>{
 const t=NOW-H;
 const x=makeV110DepthFeature(book(t),{forecastId:id(2),symbol:'BTCUSDT',direction:'SHORT',sentAt:t});
 assert.equal(x.directionalPressurePct,-33.3);
 assert.equal(x.affectsSignals,false);
});
test('no real paired observations means no learning, no invented results',()=>{
 const r=evaluateV110DepthPairs([],NOW);
 assert.equal(r.status,'INSUFFICIENT_PAIRED_DEPTH');
 assert.equal(r.eligible,0);
 assert.equal(r.recommendation,'KEEP_108');
 assert.equal(r.ordersSent,0);
});
test('prospective time-aligned research uses chronological holdout, never auto promotes',()=>{
 const r=evaluateV110DepthPairs(pairs(240),NOW);
 assert.equal(r.status,'RESEARCH_CANDIDATE_FOR_FURTHER_VALIDATION');
 assert.equal(r.baselineTrain.favorable15Pct,50);
 assert.equal(r.filteredTrain.favorable15Pct,100);
 assert.equal(r.baselineHoldout.favorable15Pct,50);
 assert.equal(r.filteredHoldout.favorable15Pct,100);
 assert.ok(r.trainDays>=5&&r.holdoutDays>=2);
 assert.equal(r.recommendation,'KEEP_108');
 assert.equal(r.changesLiveSignals,false);
});
test('regime reverses on unseen holdout; reject despite perfect training',()=>{
 const r=evaluateV110DepthPairs(pairs(240,{reverseHoldout:true}),NOW);
 assert.equal(r.status,'NO_VALIDATED_DEPTH_LIFT');
 assert.ok(r.filteredHoldout.favorable15Pct<r.baselineHoldout.favorable15Pct);
});
test('duplicates and mismatched IDs cannot inflate real sample',()=>{
 const sample=pairs(50);
 const fake={...sample[1],bookFeature:{...sample[1].bookFeature,forecastId:id(9999)}};
 const r=evaluateV110DepthPairs([...sample,...sample,fake],NOW);
 assert.equal(r.eligible,50);
 assert.equal(r.status,'INSUFFICIENT_PAIRED_DEPTH');
});
test('no WEEX requests, private keys, notifications, trading or archive modifications',()=>{
 const code=readFileSync(new URL('../lib/v110-depth-shadow.mjs',import.meta.url),'utf8');
 for(const banned of ['fetch(', 'PUSH_CRON_KEY','NTFY_TOPIC','publishNtfy',
  'placeOrder','trade-confirm','encryptJournal','decryptJournal','WEEX_KEY']){
  assert.ok(!code.includes(banned),'not allowed in offline depth research: '+banned);
 }
 assert.equal(V110_DEPTH_POLICY.extraMarketRequests,0);
 assert.equal(V110_DEPTH_POLICY.enabledInProduction,false);
 assert.equal(V110_DEPTH_POLICY.changesLiveSignals,false);
 assert.equal(V110_DEPTH_POLICY.requiresOwnerApproval,true);
});
