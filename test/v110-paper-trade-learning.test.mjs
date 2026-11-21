import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV110PaperTrades as evaluate,
 V110_TRADE_LEARNING_POLICY as policy} from '../lib/v110-paper-trade-learning.mjs';

const start=Date.UTC(2026,10,10);
function trade(day,index,{pnl,coin='BTCUSDT',schema=true,exitDay=day}={}){
 const isProfit=pnl>0;
 return {
  id:'paper-'+day+'-'+index,
  symbol:coin,direction:'SHORT',reason:isProfit?'TAKE':'STOP',
  enteredAt:start+day*86400000+(index+60)*60000,
  exitedAt:start+exitDay*86400000+(index+61)*60000,
  netPnlEur:pnl,
  ...(schema?{entryFeatures:{
   schema:'v110-paper-entry-v1',riskPolicy:'RISK_CAP_3_EUR',
   preMove5mBps:4,modeledNetRR:1.9,retestStatus:'NOT_CONFIRMED'
  }}:{})
 };
}
function sample({badHoldout=false}={}){
 const rows=[];
 for(let day=0;day<5;day++)for(let i=0;i<30;i++){
  const meme=i%5===0||i%5===1;
  const p=meme?(badHoldout&&day>=3?2:-1):
   (badHoldout&&day>=3?-.8:1);
  rows.push(trade(day,i,{pnl:p,coin:meme?'DOGEUSDT':'BTCUSDT'}));
 }
 return rows;
}
test('early unfeatured PAPER trades stay in descriptive audit, never train model',()=>{
 const r=evaluate({closed:[trade(0,0,{pnl:-2,schema:false})]});
 assert.equal(r.all.n,1);
 assert.equal(r.priorUnfeatured,1);
 assert.equal(r.prospectiveFeatured,0);
 assert.equal(r.status,'COLLECTING_PROSPECTIVE_TRADE_DAYS');
 assert.equal(r.live108Changed,false);
 assert.equal(r.realOrders,false);
 assert.equal(r.automaticPromotion,false);
});
test('unseen post-training holdout is necessary before a paper idea is suggested',()=>{
 const rows=sample();
 const r=evaluate({closed:rows});
 assert.equal(r.prospectiveFeatured,150);
 assert.equal(r.split.train.n,90);
 assert.equal(r.split.holdout.n,60);
 assert.equal(r.status,'HOLDOUT_PROMISING_FORWARD_TEST_REQUIRED');
 assert.equal(r.candidate.filterId,'NO_MEME');
 assert.equal(r.recommendation,'PAPER_FORWARD_REVIEW_ONLY');
 assert.equal(r.candidate.independentProspectiveTestPassed,false);
 assert.equal(r.ordersSent,0);
});
test('a rule that wins in training but loses in holdout is rejected',()=>{
 const r=evaluate({closed:sample({badHoldout:true})});
 assert.equal(r.status,'HOLDOUT_REJECTED');
 assert.equal(r.recommendation,'KEEP_108');
 assert.ok(r.candidate.holdout.meanNetEur<0);
});
test('training must exclude position whose loss is learned only AFTER holdout starts',()=>{
 const rows=sample();
 // A trade entered on training day 2, but closed after holdout begins.
 rows[2*30+20]={...rows[2*30+20],
   exitedAt:start+4*86400000+45*60000};
 const r=evaluate({closed:rows});
 assert.equal(r.split.train.n,89);
 assert.equal(r.split.holdout.n,60);
});
test('duplicates and malformed trades never double-count or inflate a win',()=>{
 const one=trade(0,0,{pnl:-2,schema:false});
 const r=evaluate({closed:[one,one,{...one,id:'impossible',netPnlEur:Infinity},
  {...one,id:'backwards',exitedAt:one.enteredAt-1}]});
 assert.equal(r.all.n,1);
 assert.equal(r.all.realizedNetEur,-2);
});
test('no actual order access, no self-modifying live filter; entry feature vintage is required',()=>{
 const s=readFileSync(new URL('../lib/v110-paper-trade-learning.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(s,/from ['"]\.\/weex-order|WEEX_API_(KEY|SECRET)|weex\.placeOrder|fetch\(|createClient/);
 assert.match(s,/automaticPromotion:false/);
 assert.equal(policy.minimumTrain,80);
 assert.equal(policy.minimumHoldout,40);
 assert.equal(policy.newRiskEra,'RISK_CAP_3_EUR');
});
