import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewStrongV2} from '../lib/strong-v2-review.mjs';
const now=Date.UTC(2026,10,11,10,0,0);
function bars(change=0){
 return Array.from({length:35},(_,i)=>({
  closeTime:now-(34-i)*60000,
  close:100+(i===34?change:0)
 }));
}
function forecast({side='LONG_BIAS',atr=1,ema20=100,volume=1.5,price=100,
 baseline='STRONG'}={}){
 return {combinedDirection:side,generatedAt:now,
  strengthRisk:{level:baseline},timeframes:[{
   closedAt:now,price,atr14:atr,ema20,relativeVolume:volume
  }]};
}
test('shadow review preserves strong candidates before extended moves',()=>{
 const v=reviewStrongV2(forecast(),bars());
 assert.equal(v.status,'REVIEW_KEEP_STRONG');
 assert.equal(v.proposedLevel,'STRONG');
 assert.equal(v.observations.preMove15mBps,0);
 assert.equal(v.notATrade,true);
 assert.equal(v.notificationsUnchanged,true);
 assert.equal(v.calibratedProbability,false);
});
test('extended move, away from EMA and abnormal volume are diagnostics only',()=>{
 const v=reviewStrongV2(forecast({atr:1,price:105,volume:4}),bars(5));
 assert.equal(v.status,'REVIEW_DOWNGRADE');
 assert.equal(v.proposedLevel,'STANDARD');
 assert.ok(v.reasons.includes('PRE_ALERT_MOVE_EXTENDED'));
 assert.ok(v.reasons.includes('AWAY_FROM_EMA20'));
 assert.ok(v.reasons.includes('VOLUME_SPIKE'));
 assert.equal(v.baselineLevel,'STRONG');
});
test('strong-only comparison, unknown bars never counted as good',()=>{
 assert.equal(reviewStrongV2(forecast({baseline:'STANDARD'}),bars()).status,
  'NOT_BASELINE_STRONG');
 assert.equal(reviewStrongV2(forecast(),bars().slice(-12)).sampleReady,false);
 const gapped=bars();gapped[32].closeTime-=500;
 assert.equal(reviewStrongV2(forecast(),gapped).status,'UNAVAILABLE');
});
test('forecast API exposes shadow data without changing trade or alert modules',()=>{
 const source=readFileSync(new URL('../lib/standalone-forecast.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../forecast.html',import.meta.url),'utf8');
 const shadow=readFileSync(new URL('../lib/strong-v2-review.mjs',import.meta.url),'utf8');
 assert.match(source,/strongV2Review:reviewStrongV2\(result,one\)/);
 assert.match(page,/strongV2Review:d\.strongV2Review/);
 for(const forbidden of [/placeOrder/,/ntfy\.sh/,/process\.env/,/fetch\(/]){
  assert.doesNotMatch(shadow,forbidden);
 }
});
