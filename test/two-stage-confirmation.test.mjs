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
  closedFiveMinuteMoveBps:18,price:99.4,livePrice:99.4,
  stop:100.4,take:97.4,
  entryQuality:{ok:true,nearestLevel:null},
  levelReview:{mode:'CLOSED_5M_OBSERVATION',interval:'5m',
    candleCloseTime:CLOSE,support:99.85,resistance:101,
    candleState:'BREAK_DOWN',breakoutDirection:'SHORT',
    closeQuality:'SUPPORTED',recentFakeouts:{LONG:null,SHORT:null}},
  advisor:{status:'REVIEW'},costReview:{status:'PASS_ESTIMATE'},
  retest:{SHORT:{status:'UNKNOWN'}},...patch};
}
function earlyNotice(s=signal(),when=CLOSE-3*MIN){
 const bucket=Math.floor(when/(10*MIN));
 return {event:'message',topic:TOPIC,time:Math.floor(when/1000),
  sequence_id:createHash('sha256').update('early|'+
   ['WEEX',s.symbol,s.direction,'PRE_BREAK',bucket].join('|')).digest('hex').slice(0,32),
  title:'🔮 ПРОГНОЗ · '+s.symbol+' '+s.direction+' · 🔵 ОБЫЧНЫЙ · 🟡 ЖДАТЬ',
  message:'👀 НАБЛЮДАЙ. НЕ ВХОДИТЬ.\n🔑 Подтверждение: '+(s.direction==='LONG'?'выше 100,15':'ниже 99,85')+'\n❌ Отмена сценария: '+(s.direction==='LONG'?'ниже 99,2':'выше 100,5')};
}
const sampleMinutes=()=>{
 const vals=[
  [100.1,100.13,99.96,100.0],
  [100,100.04,99.88,99.92],
  [99.92,99.95,99.78,99.85],
  [99.85,99.86,99.68,99.70],
  [99.70,99.73,99.35,99.40]];
 return vals.map(([open,high,low,close],i)=>({
  time:CLOSE-(5-i)*MIN,closeTime:CLOSE-(4-i)*MIN,
  open,high,low,close,volume:100}));
};
test('prior ordinary forecast and safe closed 5m confirm in same direction',()=>{
 const s=signal(),row=earlyNotice(s),res=classifyTwoStageConfirmation(s,[row],NOW,sampleMinutes());
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
  const result=classifyTwoStageConfirmation(s,history,NOW,sampleMinutes());
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
  const got=classifyTwoStageConfirmation(signal(changes),[row],NOW,sampleMinutes());
  assert.equal(got.level,'NORMAL',JSON.stringify(changes));
 }
 assert.equal(classifyTwoStageConfirmation(signal(),[row],CLOSE+91_000,sampleMinutes()).level,'NORMAL');
});
test('six separate groups have bounded evidence requirements',()=>{
 const names=['BTCUSDT','XRPUSDT','1000PEPEUSDT','XAUUSDT','EURUSDT','CSCOUSDT'];
 const groups=['MAJOR_CRYPTO','ALT_CRYPTO','MEME_CRYPTO','METALS','FX_DERIVED','EQUITY_DERIVED'];
 assert.equal(Object.keys(TWO_STAGE_POLICY.marketRules).length,6);
 for(let i=0;i<names.length;i++){
  const s=signal({symbol:names[i],indicators:{volumeRatio:5},
   closedFiveMinuteMoveBps:1});
  const result=classifyTwoStageConfirmation(s,[earlyNotice(s)],NOW,sampleMinutes());
  assert.equal(result.level,'STRONG');
  assert.equal(result.twoStage.group,groups[i]);
  const cap=TWO_STAGE_POLICY.marketRules[groups[i]].maxFiveMinuteMoveBps;
  assert.equal(classifyTwoStageConfirmation(
   {...s,closedFiveMinuteMoveBps:cap+0.1},[earlyNotice(s)],NOW,sampleMinutes()).level,'NORMAL');
 }
});
test('V110 refuses old matching early after a newer opposite forecast',()=>{
 const s=signal();
 const first=earlyNotice(s,CLOSE-4*MIN);
 const newer=earlyNotice({...s,direction:'LONG'},CLOSE-2*MIN);
 assert.equal(classifyTwoStageConfirmation(s,[first,newer],NOW,sampleMinutes()).twoStage.reason,
  'LATER_OPPOSITE_EARLY_FORECAST');
});
test('V110 refuses invalidated 1m path even with prior published ordinary alert',()=>{
 const s=signal(),rows=sampleMinutes();
 rows[3]={...rows[3],high:100.6};
 const result=classifyTwoStageConfirmation(s,[earlyNotice(s)],NOW,rows);
 assert.equal(result.level,'NORMAL');
 assert.equal(result.twoStage.reason,'EARLY_SCENARIO_INVALIDATED');
});
test('V110 does not claim STRONG without closed post-alert 1m evidence',()=>{
 const s=signal();
 const result=classifyTwoStageConfirmation(s,[earlyNotice(s)],NOW,null);
 assert.equal(result.level,'NORMAL');
 assert.equal(result.twoStage.reason,'MINUTE_EVIDENCE_MISSING');
});
test('109 + 110 integration: 5m levels and 1m continuation BOTH required',()=>{
 const s=signal(),notice=earlyNotice(s),minutes=sampleMinutes();
 assert.equal(STRONG_MIN_OPPOSING_ROOM_R,1.5);
 assert.equal(checkStrongLevelRoom(s).ok,true);
 const clear=classifyTwoStageConfirmation(s,[notice],NOW,minutes);
 assert.equal(clear.level,'STRONG');
 const slip={...s,livePrice:99.95};
 assert.equal(classifyTwoStageConfirmation(slip,[notice],NOW,minutes).twoStage.reason,
   'BROKEN_LEVEL_NOT_HELD');
 const blocked={...s,entryQuality:{ok:true,nearestLevel:98.9}};
 assert.equal(classifyTwoStageConfirmation(blocked,[notice],NOW,minutes).twoStage.reason,
   'OPPOSING_PIVOT_TOO_CLOSE');
 assert.equal(classifyTwoStageConfirmation({...s,levelReview:{...s.levelReview,
    closeQuality:'WEAK'}},[notice],NOW,minutes).twoStage.reason,
   'FIVE_MINUTE_BREAKOUT_NOT_SUPPORTED');
 const candleReversal=minutes.map(x=>({...x}));
 candleReversal[4]={...candleReversal[4],open:99.6,high:99.82,
   low:99.38,close:99.80};
 assert.equal(classifyTwoStageConfirmation({...s,price:99.80},
   [notice],NOW,candleReversal).twoStage.reason,
   'LAST_MINUTE_REVERSAL');
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
  {now:NOW,env:{NTFY_TOPIC:TOPIC},fetchImpl,
   minuteCandlesBySymbol:new Map([['XRPUSDT',sampleMinutes()]])});
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
