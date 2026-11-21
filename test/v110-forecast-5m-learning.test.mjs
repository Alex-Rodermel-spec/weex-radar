import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateV110FiveMinuteForecast as study,
 V110_FIVE_MINUTE_POLICY} from '../lib/v110-forecast-5m-learning.mjs';
const MIN=60_000,DAY=24*60*MIN,start=Date.UTC(2026,10,5,0,0,0);
function dataset({reversedHoldout=false,decoy=false}={}){
 const rows=[];let id=0;
 for(let day=0;day<10;day++)for(const direction of ['LONG','SHORT'])
  for(let coin=0;coin<16;coin++)for(let k=0;k<2;k++){
   const standard=coin%2===0;
   const good=direction==='LONG'&&standard&&(day<7||!reversedHoldout);
   const sym='TST'+(direction==='LONG'?'L':'S')+String(coin).padStart(2,'0')+'USDT';
   rows.push({id:(++id).toString(16).padStart(32,'0'),
    symbol:sym, direction,
    sentAt:start+day*DAY+(k+1)*60*MIN+coin*MIN,
    strength:standard?'STANDARD':'CAUTION',
    v2Timing:'CLEAR',
    preMove1mBps:0,preMove3mBps:0,
    preMove5mBps:standard?2:20,preMove15mBps:standard?2:35,
    windows:{
     5:{status:'OBSERVED',moveBps:direction==='LONG'?(good?8:-8):coin%2?3:-3},
     15:{status:'OBSERVED',moveBps:direction==='LONG'?(good?10:-10):0}
    }
   });
  }
 if(decoy){let r=rows[0];rows.push({...r,id:r.id,
  strength:'STANDARD',windows:{5:{status:'OBSERVED',moveBps:9999}}});}
 return rows;
}
const now=start+11*DAY;
test('5m learner trains LONG and SHORT separately with 30m de-dup and future days',()=>{
 const r=study(dataset(),now);
 assert.equal(r.eligible,640);
 assert.equal(r.baseline.n,640);
 assert.equal(r.byDirection.LONG.train.n,224);
 assert.equal(r.byDirection.LONG.holdout.n,96);
 assert.equal(r.byDirection.LONG.status,'HOLDOUT_PROMISING_FORWARD_REQUIRED');
 assert.equal(r.byDirection.SHORT.status,'NO_TRAINING_IMPROVEMENT');
 assert.equal(r.byDirection.LONG.recommendation,'SEPARATE_FORWARD_SHADOW_REQUIRED');
 assert.equal(r.byDirection.LONG.independentForwardValidated,false);
 assert.equal(r.ordersSent,0);assert.equal(r.liveChanges,0);
 assert.equal(r.automaticPromotion,false);
});
test('policy selected on train only gets rejected when unseen holdout reverses',()=>{
 const r=study(dataset({reversedHoldout:true}),now);
 assert.equal(r.byDirection.LONG.status,'HOLDOUT_REJECTED');
 assert.equal(r.byDirection.LONG.recommendation,'KEEP_108');
 assert.equal(r.byDirection.SHORT.status,'NO_TRAINING_IMPROVEMENT');
});
test('duplicate IDs, observed outcomes and future data cannot leak into training features',()=>{
 const original=dataset({decoy:true});
 const r=study(original,now);
 assert.equal(r.eligible,640);
 const future={...original[1],id:'f'.repeat(32),sentAt:now+MIN};
 const missing={...original[2],id:'e'.repeat(32),
  windows:{5:{status:'NO_DATA'},15:{status:'OBSERVED',moveBps:10}}};
 const rr=study([...original,future,missing],now);
 assert.equal(rr.eligible,640);
 assert.equal(rr.byDirection.LONG.chosenOnTrainingOnly,
  r.byDirection.LONG.chosenOnTrainingOnly);
});
test('cannot promote after statistical screen or use actual WEEX orders',()=>{
 const r=study([],now);
 assert.equal(r.status,'COLLECTING_DAYS');
 assert.equal(r.forwardValidated,false);
 assert.equal(V110_FIVE_MINUTE_POLICY.minHoldoutPerSide,40);
 assert.equal(V110_FIVE_MINUTE_POLICY.independentForwardRequired,true);
});
