import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {TWO_STAGE_POLICY,STRONG_MIN_OPPOSING_ROOM_R,checkStrongLevelRoom,expectedPrebreakIds,
 classifyTwoStageConfirmation,linkConfirmedForecasts}
 from '../lib/two-stage-confirmation.mjs';

const MIN=60_000;
const CLOSE=Date.UTC(2026,10,12,15,40,0);
const NOW=CLOSE+20_000;
const TOPIC='WR_Private_'+('a'.repeat(24));
function signal(patch={}){
 return {symbol:'XRPUSDT',exchange:'WEEX',status:'ok',
  level:'STRONG',direction:'SHORT',candleCloseTime:CLOSE,
  expiresAt:CLOSE+180_000,indicators:{volumeRatio:1.6},
  closedFiveMinuteMoveBps:18,livePrice:100,stop:101,take:97,
  levelReview:{mode:'CLOSED_5M_OBSERVATION',interval:'5m',
   candleCloseTime:CLOSE,support:100.5,resistance:104,
   candleState:'BREAK_DOWN',breakoutDirection:'SHORT',closeQuality:'SUPPORTED'},
  entryQuality:{ok:true,nearestLevel:98},
  advisor:{status:'REVIEW'},costReview:{status:'PASS_ESTIMATE'},
  retest:{SHORT:{status:'UNKNOWN'}},...patch};
}
function earlyNotice(s=signal(),when=CLOSE-3*MIN){
 const bucket=Math.floor(when/(10*MIN));
 return {event:'message',topic:TOPIC,time:Math.floor(when/1000),
  sequence_id:createHash('sha256').update('early|'+
   ['WEEX',s.symbol,s.direction,'PRE_BREAK',bucket].join('|')).digest('hex').slice(0,32),
  title:'🔮 ПРОГНОЗ · '+s.symbol+' '+s.direction+' · 🔵 ОБЫЧНЫЙ · 🟡 ЖДАТЬ',
  message:'👀 НАБЛЮДАЙ. НЕ ВХОДИТЬ.\n🔑 Подтверждение: ниже 1.02'};
}
test('prior ordinary forecast and safe closed 5m confirm in same direction',()=>{
 const s=signal(),row=earlyNotice(s),res=classifyTwoStageConfirmation(s,[row],NOW);
 assert.ok(expectedPrebreakIds(s).includes(row.sequence_id));
 assert.equal(res.level,'STRONG');
 assert.equal(res.twoStage.stage,'CONFIRMED_AFTER_EARLY');
 assert.equal(res.twoStage.earlySentAt,row.time*1000);
 assert.equal(res.twoStage.group,'ALT_CRYPTO');
 assert.equal(res.twoStage.noAutoTrade,true);
 assert.equal(TWO_STAGE_POLICY.ordersSent,0);
});
test('5m strong cannot invent an earlier ordinary notification',()=>{
 const s=signal();
 for(const history of [
  [],[earlyNotice({...s,symbol:'BTCUSDT'})],
  [earlyNotice({...s,direction:'LONG'})],
  [earlyNotice(s,CLOSE+MIN)],
  [earlyNotice(s,CLOSE-16*MIN)],
  [{...earlyNotice(s),title:'A fake forecast'}],
  [{...earlyNotice(s),message:'No breakout threshold'}],
  [{...earlyNotice(s),time:null}],
  [{...earlyNotice(s),sequence_id:'a'.repeat(32)}]
 ]){
  const result=classifyTwoStageConfirmation(s,history,NOW);
  assert.equal(result.level,'NORMAL');
  assert.equal(result.twoStage.stage,'ORDINARY_5M');
 }
});
test('strong needs fresh closed 5m, modelled costs, volume and no chase',()=>{
 const row=earlyNotice();
 const variants=[
  {candleCloseTime:CLOSE+MIN},
  {candleCloseTime:CLOSE-5*MIN},
  {exchange:'Bybit'},
  {status:'unavailable'},
  {entryQuality:{ok:false}},
  {advisor:{status:'WAIT'}},
  {costReview:{status:'LOW_NET_RR'}},
  {indicators:{volumeRatio:1.1}},
  {closedFiveMinuteMoveBps:46},
  {closedFiveMinuteMoveBps:-1},
  {retest:{SHORT:{status:'FAILED'}}}
 ];
 for(const changes of variants){
  const got=classifyTwoStageConfirmation(signal(changes),[row],NOW);
  assert.equal(got.level,'NORMAL',JSON.stringify(changes));
 }
 assert.equal(classifyTwoStageConfirmation(signal(),[row],CLOSE+91_000).level,'NORMAL');
});
test('six separate groups have bounded evidence requirements',()=>{
 const names=['BTCUSDT','XRPUSDT','1000PEPEUSDT','XAUUSDT','EURUSDT','CSCOUSDT'];
 const groups=['MAJOR_CRYPTO','ALT_CRYPTO','MEME_CRYPTO','METALS','FX_DERIVED','EQUITY_DERIVED'];
 assert.equal(Object.keys(TWO_STAGE_POLICY.marketRules).length,6);
 for(let i=0;i<names.length;i++){
  const s=signal({symbol:names[i],indicators:{volumeRatio:5},
   closedFiveMinuteMoveBps:1});
  const result=classifyTwoStageConfirmation(s,[earlyNotice(s)],NOW);
  assert.equal(result.level,'STRONG');
  assert.equal(result.twoStage.group,groups[i]);
  const cap=TWO_STAGE_POLICY.marketRules[groups[i]].maxFiveMinuteMoveBps;
  assert.equal(classifyTwoStageConfirmation(
   {...s,closedFiveMinuteMoveBps:cap+0.1},[earlyNotice(s)],NOW).level,'NORMAL');
 }
});
test('STRONG SHORT must hold broken support and leave 1.5R before next support',()=>{
 const s=signal(),notice=earlyNotice(s);
 assert.equal(STRONG_MIN_OPPOSING_ROOM_R,1.5);
 assert.equal(checkStrongLevelRoom(s).ok,true);
 const near=signal({entryQuality:{ok:true,nearestLevel:99.2}});
 assert.equal(checkStrongLevelRoom(near).reason,'OPPOSING_PIVOT_TOO_CLOSE');
 assert.equal(classifyTwoStageConfirmation(near,[notice],NOW).level,'NORMAL');
 const slipped=signal({livePrice:100.6});
 assert.equal(classifyTwoStageConfirmation(slipped,[notice],NOW).twoStage.reason,
  'BROKEN_LEVEL_NOT_HELD');
 const weak=signal({levelReview:{...s.levelReview,closeQuality:'WEAK'}});
 assert.equal(classifyTwoStageConfirmation(weak,[notice],NOW).level,'NORMAL');
 const missing=signal({levelReview:null});
 assert.equal(classifyTwoStageConfirmation(missing,[notice],NOW).level,'NORMAL');
});
test('STRONG LONG checks resistance above entry and holds broken 5m resistance',()=>{
 const levels={mode:'CLOSED_5M_OBSERVATION',interval:'5m',
  candleCloseTime:CLOSE,support:97,resistance:99.5,
  candleState:'BREAK_UP',breakoutDirection:'LONG',closeQuality:'SUPPORTED'};
 const s=signal({direction:'LONG',livePrice:100,stop:99,take:103,
  levelReview:levels,entryQuality:{ok:true,nearestLevel:102}});
 assert.equal(classifyTwoStageConfirmation(s,[earlyNotice(s)],NOW).level,'STRONG');
 const tooNear=signal({...s,entryQuality:{ok:true,nearestLevel:101.2}});
 assert.equal(classifyTwoStageConfirmation(tooNear,[earlyNotice(s)],NOW).level,'NORMAL');
 const underResistance=signal({...s,livePrice:99.4});
 assert.equal(checkStrongLevelRoom(underResistance).reason,'BROKEN_LEVEL_NOT_HELD');
 const invalidPivot=signal({...s,entryQuality:{ok:true,nearestLevel:97}});
 assert.equal(checkStrongLevelRoom(invalidPivot).ok,false);
 const noPivot=signal({...s,entryQuality:{ok:true,nearestLevel:null}});
 assert.equal(checkStrongLevelRoom(noPivot).reason,'NO_OPPOSING_PIVOT_FOUND');
 const missingPivotData=signal({...s,entryQuality:{ok:true}});
 assert.equal(checkStrongLevelRoom(missingPivotData).reason,'OPPOSING_LEVEL_DATA_MISSING');
});
test('ordinary historical signals are never promoted into strong',()=>{
 const s=signal({level:'NORMAL'});
 assert.equal(classifyTwoStageConfirmation(s,[earlyNotice(s)],NOW),s);
});
test('history link is checked only when strong candidate exists',async()=>{
 const s=signal(),row=earlyNotice(s);
 let calls=0;
 const fetchImpl=async(url,init)=>{
  calls++;assert.match(url,/since=20m$/);
  assert.equal(init.method,'GET');
  return {ok:true,text:async()=>JSON.stringify(row)+'\n'};
 };
 const a=await linkConfirmedForecasts([s,signal({level:'NORMAL'})],
  {now:NOW,env:{NTFY_TOPIC:TOPIC},fetchImpl});
 assert.equal(calls,1);
 assert.equal(a.linked,1);assert.equal(a.downgraded,0);
 assert.equal(a.historyAvailable,true);
 assert.equal(a.signals[0].level,'STRONG');
 assert.equal(a.signals[1].level,'NORMAL');
 await linkConfirmedForecasts([signal({level:'NORMAL'})],
  {now:NOW,env:{NTFY_TOPIC:TOPIC},fetchImpl});
 assert.equal(calls,1);
});
test('ntfy network or configuration failure safely downgrades strong',async()=>{
 const s=signal();
 const noTopic=await linkConfirmedForecasts([s],{now:NOW,env:{}});
 assert.equal(noTopic.signals[0].level,'NORMAL');
 assert.equal(noTopic.historyAvailable,false);
 const failed=await linkConfirmedForecasts([s],{
  now:NOW,env:{NTFY_TOPIC:TOPIC},
  fetchImpl:async()=>{throw Error('test temporary outage')}
 });
 assert.equal(failed.signals[0].level,'NORMAL');
 assert.equal(failed.historyAvailable,false);
 assert.equal(failed.ordersSent,0);
});
test('production hook sends ordinary pre-break and conservatively links strong',()=>{
 const early=readFileSync(new URL('../lib/early-push.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const alerts=readFileSync(new URL('../lib/alert-presentation.mjs',import.meta.url),'utf8');
 assert.match(early,/await ntfySend\('early',forecasts.slice\(0,2\)\)/);
 assert.match(dispatch,/await linkConfirmedForecasts\(review.accepted/);
 assert.match(dispatch,/ntfySend\('confirmed',signals\)/);
 assert.match(alerts,/🔵 ОБЫЧНЫЙ/);
 assert.match(alerts,/CONFIRMED_AFTER_EARLY/);
 assert.doesNotMatch(early+dispatch+alerts,/\/capi\/v3\/order/);
});
