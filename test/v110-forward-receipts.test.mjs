import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {profileSymbols} from '../lib/market-forecast-profiles.mjs';
import {summarizeV110All32EarlyCohorts} from '../lib/v110-all32-early-cohorts.mjs';
import {V110_FROZEN_FORWARD_RECEIPT_POLICY as POLICY,
 freezeV110ForwardReceipt,scoreV110FrozenForwardReceipt,
 summarizeV110FrozenForwardScores} from '../lib/v110-forward-receipts.mjs';
const MIN=60_000,FIVE=5*MIN;
const at=Date.UTC(2026,10,15,12,0,30),evalAt=at+17*MIN;
const doc=(symbol='XRPUSDT',one='LONG_BIAS',five='NEUTRAL',ten='SHORT_BIAS')=>({
 available:true,symbol,exchange:'WEEX',timeframes:[
  {intervalMinutes:1,direction:one,price:0.9,closedAt:at-30_000},
  {intervalMinutes:5,direction:five,closedAt:Math.floor((at-1000)/FIVE)*FIVE},
  {intervalMinutes:10,direction:ten,closedAt:Math.floor((at-1000)/(2*FIVE))*(2*FIVE)}
 ]});
const goodBars=()=>Array.from({length:16},(_,i)=>({
 time:Math.ceil(at/MIN)*MIN+i*MIN,
 open:0.9+i*0.0001,close:0.9+(i+1)*0.0001,
 closeTime:Math.ceil(at/MIN)*MIN+(i+1)*MIN
}));
test('freeze early and aligned control BEFORE future data, no paid requests or trade',()=>{
 const x=freezeV110ForwardReceipt(doc(),'ONE_MINUTE_LEADS_NEUTRAL_FIVE',at);
 assert.equal(x.kind,'ONE_MINUTE_LEADS_NEUTRAL_FIVE');
 assert.equal(x.direction,'LONG_BIAS');
 assert.equal(x.referencePrice,0.9);
 assert.equal(x.frozenAt,at);
 assert.equal(x.publicationStatus,'UNKNOWN_NOT_VERIFIED');
 assert.equal(Object.hasOwn(x,'notPublishedSignal'),false);
 assert.equal(x.noTrade,true);
 const same=freezeV110ForwardReceipt(doc(),'ONE_MINUTE_LEADS_NEUTRAL_FIVE',at+5000);
 assert.equal(x.id,same.id);
 const aligned=freezeV110ForwardReceipt(doc('BTCUSDT','SHORT_BIAS','SHORT_BIAS','SHORT_BIAS'),
  'THREE_TIMEFRAME_ALIGNMENT_CONTROL',at);
 assert.equal(aligned.kind,'THREE_TIMEFRAME_ALIGNMENT_CONTROL');
 assert.equal(aligned.direction,'SHORT_BIAS');
 // A fully aligned control could be published; receipt must not lie.
 assert.equal(aligned.publicationStatus,'UNKNOWN_NOT_VERIFIED');
 assert.equal(Object.hasOwn(aligned,'notPublishedSignal'),false);
 assert.equal(POLICY.noNewStorage,true);
 assert.equal(POLICY.noNewPaidServices,true);
 assert.equal(POLICY.forwardResultsNotYetAutomatic,true);
});
test('cannot forge direction class, accept unaligned controls, or stale 5m',()=>{
 assert.equal(freezeV110ForwardReceipt(doc(),'THREE_TIMEFRAME_ALIGNMENT_CONTROL',at),null);
 assert.equal(freezeV110ForwardReceipt(doc(),'ONE_MINUTE_OPPOSES_FIVE',at),null);
 const d=doc();d.timeframes[1].closedAt-=FIVE;
 assert.equal(freezeV110ForwardReceipt(d,'ONE_MINUTE_LEADS_NEUTRAL_FIVE',at),null);
 const d2=doc();d2.timeframes[0].price=-10;
 assert.equal(freezeV110ForwardReceipt(d2,'ONE_MINUTE_LEADS_NEUTRAL_FIVE',at),null);
});
test('strict future closed candles, 5/10/15min and 2 full future 5m',()=>{
 const receipt=freezeV110ForwardReceipt(doc(),'ONE_MINUTE_LEADS_NEUTRAL_FIVE',at);
 const completed=scoreV110FrozenForwardReceipt(receipt,goodBars(),evalAt);
 assert.equal(completed.status,'OBSERVED');
 assert.equal(completed.outcomeWindowStartsAt,Math.ceil(at/MIN)*MIN);
 for(const m of [5,10,15]){
  assert.equal(completed.horizons[m].status,'OBSERVED');
  assert.equal(completed.horizons[m].directionResult,'FAVORABLE');
 }
 assert.equal(completed.twoFull5m.status,'OBSERVED');
 assert.equal(completed.twoFull5m.twoCandleConfirmation,true);
 assert.equal(completed.twoFull5m.firstCompleteFiveMinuteCandleStartAt,
  Date.UTC(2026,10,15,12,5));
 assert.equal(completed.ordersSent,0);
 const pending=scoreV110FrozenForwardReceipt(receipt,goodBars(),at+8*MIN);
 assert.equal(pending.status,'PENDING_OR_MISSING');
 assert.equal(pending.horizons[15].status,'PENDING_OR_MISSING');
 assert.equal(pending.twoFull5m.twoCandleConfirmation,null);
});
test('missing or duplicated candles do NOT become favorable; exact future data not used',()=>{
 const receipt=freezeV110ForwardReceipt(doc(),'ONE_MINUTE_LEADS_NEUTRAL_FIVE',at);
 const b=goodBars();
 const missing=scoreV110FrozenForwardReceipt(receipt,b.filter(x=>x.time!==b[4].time),evalAt);
 assert.equal(missing.horizons[5].status,'PENDING_OR_MISSING');
 assert.equal(missing.horizons[15].status,'PENDING_OR_MISSING');
 const repeated=scoreV110FrozenForwardReceipt(receipt,[...b,b[3]],evalAt);
 assert.equal(repeated.horizons[5].status,'PENDING_OR_MISSING');
 const future=scoreV110FrozenForwardReceipt(receipt,b,at);
 assert.equal(future.horizons[5].status,'PENDING_OR_MISSING');
 const corrupt=scoreV110FrozenForwardReceipt(receipt,
  b.map((x,i)=>i===3?{...x,closeTime:x.closeTime+MIN}:x),evalAt);
 assert.equal(corrupt.horizons[5].status,'PENDING_OR_MISSING');
});
test('SHORT favorable only when price falls; WRONG direction remains adverse',()=>{
 const x=freezeV110ForwardReceipt(doc('ETHUSDT','SHORT_BIAS','NEUTRAL','LONG_BIAS'),
  'ONE_MINUTE_LEADS_NEUTRAL_FIVE',at);
 const falling=goodBars().map((b,i)=>({...b,open:0.9-i*0.0001,
  close:0.9-(i+1)*0.0001}));
 const win=scoreV110FrozenForwardReceipt(x,falling,evalAt);
 assert.equal(win.horizons[15].directionResult,'FAVORABLE');
 const loss=scoreV110FrozenForwardReceipt(x,goodBars(),evalAt);
 assert.equal(loss.horizons[15].directionResult,'ADVERSE');
 assert.equal(loss.twoFull5m.twoCandleConfirmation,false);
});
test('all 32 snapshots freeze both early candidates AND fully aligned comparison baselines',()=>{
 const all=profileSymbols();
 const snaps=all.map(s=>doc(s,'SHORT_BIAS','SHORT_BIAS','SHORT_BIAS'));
 const xrp=snaps.find(x=>x.symbol==='XRPUSDT');
 xrp.timeframes[0].direction='LONG_BIAS';
 xrp.timeframes[1].direction='NEUTRAL';
 const y=summarizeV110All32EarlyCohorts(snaps,at);
 assert.equal(y.validSameClose,32);
 assert.equal(y.receiptsFrozenCount,32);
 assert.equal(y.frozenForwardReceipts.length,32);
 assert.equal(y.frozenForwardReceipts.filter(r=>r.kind==='ONE_MINUTE_LEADS_NEUTRAL_FIVE').length,1);
 assert.equal(y.frozenForwardReceipts.filter(r=>r.kind==='THREE_TIMEFRAME_ALIGNMENT_CONTROL').length,31);
 assert.equal(new Set(y.frozenForwardReceipts.map(r=>r.id)).size,32);
});
test('future outcome aggregation hides rates under 20 and never recommends a live promotion',()=>{
 const receipt=freezeV110ForwardReceipt(doc(),'ONE_MINUTE_LEADS_NEUTRAL_FIVE',at);
 const r=scoreV110FrozenForwardReceipt(receipt,goodBars(),evalAt);
 const s=summarizeV110FrozenForwardScores([r,r]);
 assert.equal(s.fullyObservedReceipts,1);
 assert.equal(s.byKind.ONE_MINUTE_LEADS_NEUTRAL_FIVE.byHorizon[15].observed,1);
 assert.equal(s.byKind.ONE_MINUTE_LEADS_NEUTRAL_FIVE.byHorizon[15].favorablePct,null);
 assert.equal(s.readyForLivePromotion,false);
 assert.equal(s.independentHoldoutVerified,false);
});
test('current production only logs bounded receipts, no new HTTP, blobs, AI or notification',()=>{
 const module=readFileSync(new URL('../lib/v110-forward-receipts.mjs',import.meta.url),'utf8');
 const scan=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 for(const forbidden of ['fetch(', '@vercel/blob','process.env','NTFY_TOPIC',
  'publishNtfy','placeOrder','api-contract.weex.com','AI_GATEWAY']){
  assert.equal(module.includes(forbidden),false,forbidden);
 }
 assert.match(scan,/WEEX_RADAR_V110_EARLY_FROZEN/);
 assert.match(scan,/frozen\.slice\(i,i\+8\)/);
 assert.match(scan,/const \{frozenForwardReceipts:ignoredFrozen,\.\.\.safeCensus\}/);
 assert.doesNotMatch(dispatch,/WEEX_RADAR_V110_EARLY_FROZEN/);
 assert.equal(POLICY.maxReceiptsPerNormalScan,32);
});
