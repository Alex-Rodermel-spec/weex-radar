import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alertPresentation,formatPhoneAlert,priceText} from '../lib/alert-presentation.mjs';
import {COST_MIN_NET_RR} from '../lib/net-costs.mjs';
const base={symbol:'XAUTUSDT',exchange:'WEEX',direction:'SHORT',level:'STRONG',
 livePrice:4049.05,stop:4050.0042,take:4047.1116,expiresAt:Date.now()+180000};
const cost={mode:'SHADOW_COSTS',status:'PASS_ESTIMATE',netRR:1.8};
const retest={SHORT:{status:'CONFIRMED',trendAligned:true}};
test('V110 ordinary can warn but never greenlight an entry',()=>{
 const ordinary=alertPresentation({...base,level:'NORMAL',retest,costReview:cost});
 assert.equal(ordinary.status,'WAIT');
 assert.match(ordinary.title,/🟡 ЖДАТЬ/);
 assert.match(ordinary.reason,/Обычный прогноз/);
 const notice=formatPhoneAlert({...base,level:'NORMAL',retest,costReview:cost});
 assert.match(notice.message,/НЕ ВХОДИ/);
 assert.doesNotMatch(notice.title,/🟢 ПРОВЕРИТЬ/);
});
test('four independent signal/risk presentation variants',()=>{
 const green=alertPresentation({...base,retest,costReview:cost});
 assert.equal(green.status,'CHECK');
 assert.match(green.title,/🟢 ПРОВЕРИТЬ/);
 const purple=alertPresentation({...base,level:'STRONG',retest,costReview:cost});
 assert.equal(purple.status,'CHECK');
 assert.match(purple.title,/🟣 СИЛЬНЫЙ/);
 const amber=alertPresentation({...base,retest:{SHORT:{status:'PENDING'}},costReview:cost});
 assert.equal(amber.status,'CHECK');
 assert.match(amber.message||amber.reason,/ретест ещё не подтверждён/);
 assert.match(amber.title,/🟢 ПРОВЕРИТЬ/);
 const red=alertPresentation({...base,retest:{SHORT:{status:'FAILED'}},costReview:cost});
 assert.equal(red.status,'SKIP');
 assert.match(red.title,/🔴 ПРОПУСТИТЬ/);
 const strongRed=alertPresentation({...base,level:'STRONG',retest:{SHORT:{status:'FAILED'}},costReview:cost});
 assert.equal(strongRed.status,'SKIP');
 assert.match(strongRed.title,/🟣 СИЛЬНЫЙ/);
});
test('unknown costs cannot imply green; cost-negative target must be red',()=>{
 assert.equal(alertPresentation({...base,retest}).status,'WAIT');
 assert.equal(alertPresentation({...base,retest,costReview:{mode:'SHADOW_COSTS',status:'COSTS_EXCEED_TP'}}).status,'SKIP');
 assert.equal(alertPresentation({...base,retest,costReview:{mode:'SHADOW_COSTS',status:'LOW_NET_RR'}}).status,'SKIP');
 assert.equal(alertPresentation({...base,exchange:'Bybit',retest}).status,'WAIT');
});
test('phone warning references the active net R/R threshold, not an obsolete number',()=>{
 const s={...base,retest,costReview:{mode:'SHADOW_COSTS',status:'LOW_NET_RR',netRR:COST_MIN_NET_RR-0.01}};
 const x=formatPhoneAlert(s);
 assert.equal(x.status,'SKIP');
 assert.match(x.message,/^🔴 ПРОПУСТИ\. НЕ ВХОДИ\./u);
 assert.ok(x.message.includes('Чистый R/R ниже '+String(COST_MIN_NET_RR).replace('.',',')));
 assert.doesNotMatch(x.message,/Чистый R\/R ниже 1,5/u);
});
test('early watch is always amber and has no trade levels',()=>{
 const s={...base,level:'EARLY_WATCH',retest,costReview:cost};
 const x=formatPhoneAlert(s,{early:true,deadline:'17:58'});
 assert.equal(x.status,'WAIT');
 assert.match(x.title,/EARLY WATCH/);
 assert.match(x.message,/ЖДАТЬ подтверждения 5м/);
 assert.doesNotMatch(x.message,/Прибыль|Стоп|R\/R|SL |TP /);
});
test('phone format has clear entry, profit, stop, and raw exact levels',()=>{
 const x=formatPhoneAlert({...base,retest,costReview:cost},{deadline:'17:58'});
 assert.match(x.message,/📍 Вход/);
 assert.match(x.message,/🎯 Цель/);
 assert.match(x.message,/🛑 Стоп/);
 assert.match(x.message,/SL 4050.0042 · TP 4047.1116/);
 assert.match(x.message,/Чистый R\/R/);
 assert.match(x.message,/17:58/);
 assert.equal(priceText(0.000012345678),'0,00001235');
});
test('phone alerts give one simple action without changing calculation or title',()=>{
 const check=formatPhoneAlert({...base,retest,costReview:cost},{deadline:'17:58'});
 assert.match(check.title,/^🟢 ПРОВЕРИТЬ/);
 assert.match(check.message,/^🟢 ПРОВЕРЬ ВХОД ВРУЧНУЮ\. НЕ АВТОВХОД\./);
 assert.match(check.message,/Ретест удержан\. Проверь текущую цену/);
 assert.match(check.message,/SL 4050\.0042 · TP 4047\.1116/);
 const skip=formatPhoneAlert({...base,retest:{SHORT:{status:'FAILED'}},costReview:cost});
 assert.match(skip.title,/^🔴 ПРОПУСТИТЬ/);
 assert.match(skip.message,/^🔴 ПРОПУСТИ\. НЕ ВХОДИ\./);
 assert.doesNotMatch(skip.message,/^🟢 ПРОВЕРЬ/);
 const wait=formatPhoneAlert({...base,retest});
 assert.match(wait.title,/^🟡 ЖДАТЬ/);
 assert.match(wait.message,/^🟡 ПОДОЖДИ\. НЕ ВХОДИ\./);
 const early=formatPhoneAlert({...base,level:'EARLY_WATCH'},{early:true});
 assert.match(early.message,/^🟡 ЖДАТЬ подтверждения 5м\. НЕ ВХОДИТЬ\./);
 assert.doesNotMatch(early.message,/SL [0-9]|TP [0-9]/);
 const pre=formatPhoneAlert({...base,watchType:'PRE_BREAK',forecast:{
  mode:'PRE_BREAK_SCENARIO',direction:'SHORT',horizonMinutes:5,
  triggerPrice:4047,invalidationPrice:4053,rsi1:42,volumeRatio:1.5
 }},{early:true});
 assert.match(pre.message,/^👀 НАБЛЮДАЙ\. НЕ ВХОДИТЬ\./);
 assert.doesNotMatch(pre.message,/SL [0-9]|TP [0-9]/);
});

test('green CHECK explains already moved 5m candle without altering original notification status',()=>{
 const fast=formatPhoneAlert({...base,retest,costReview:cost,closedFiveMinuteMoveBps:47.6});
 assert.match(fast.title,/^🟢 ПРОВЕРИТЬ/);
 assert.match(fast.message,/За 5М до сигнала: \+0,48% по направлению/);
 assert.match(fast.message,/Цена уже сдвинулась\. Не догоняй/);
 assert.match(fast.message,/SL 4050.0042 · TP 4047.1116/);
 const small=formatPhoneAlert({...base,retest,costReview:cost,closedFiveMinuteMoveBps:3});
 assert.match(small.message,/За 5М до сигнала: \+0,03%/);
 assert.doesNotMatch(small.message,/Цена уже сдвинулась/);
 const against=formatPhoneAlert({...base,retest,costReview:cost,closedFiveMinuteMoveBps:-17});
 assert.match(against.message,/За 5М до сигнала: -0,17% против направления/);
 assert.doesNotMatch(against.message,/Цена уже сдвинулась/);
 const original=formatPhoneAlert({...base,retest,costReview:cost});
 assert.doesNotMatch(original.message,/За 5М до сигнала/);
 const skip=formatPhoneAlert({...base,retest:{SHORT:{status:'FAILED'}},costReview:cost,
  closedFiveMinuteMoveBps:90});
 assert.equal(skip.status,'SKIP');
 assert.doesNotMatch(skip.message,/За 5М до сигнала/);
 const early=formatPhoneAlert({...base,level:'EARLY_WATCH',
  closedFiveMinuteMoveBps:90},{early:true});
 assert.doesNotMatch(early.message,/За 5М до сигнала/);
});

test('compact texts keep ntfy precision, outcome journal and independent forecast markers',async()=>{
 const {parseConfirmedNotification}=await import('../lib/signal-quality.mjs');
 const sample={...base,closedFiveMinuteMoveBps:27,level:'STRONG',
  costReview:cost,retest};
 const notification=formatPhoneAlert(sample,{deadline:'18:23:00'});
 assert.ok(notification.message.split('\n').length<=10,'short phone message');
 assert.match(notification.message,/^🟢 ПРОВЕРЬ ВХОД ВРУЧНУЮ/);
 assert.doesNotMatch(notification.message,/R\/R до расходов|ЧТО ДЕЛАТЬ|Сравни цену с входом/);
 const arrived=parseConfirmedNotification({
  event:'message',time:Math.floor(Date.UTC(2026,10,11,17,20,29)/1000),
  title:notification.title,
  message:notification.message+'\n🕒 Свеча 18:20:00 · отправка 18:20:29 · задержка 29с',
  sequence_id:'a'.repeat(32)
 });
 assert.ok(arrived,'compact notifications must still be collected');
 assert.equal(arrived.symbol,base.symbol);
 assert.equal(arrived.direction,'SHORT');
 assert.equal(arrived.stop,base.stop);
 assert.equal(arrived.take,base.take);
 assert.equal(arrived.netRRAtAlert,cost.netRR);
 assert.equal(arrived.decisionAtAlert,'CHECK');
 assert.equal(arrived.candleCloseAt,Date.UTC(2026,10,11,17,20));
 const uncertain=formatPhoneAlert({...base,costReview:undefined,retest});
 assert.equal(uncertain.status,'WAIT');
 assert.match(uncertain.message,/НЕ ВХОДИ/);
 const blocked=formatPhoneAlert({...base,costReview:cost,retest:{SHORT:{status:'FAILED'}}});
 assert.equal(blocked.status,'SKIP');
 assert.match(blocked.message,/НЕ ВХОДИ/);
 const pre=formatPhoneAlert({...base,watchType:'PRE_BREAK',
  forecast:{mode:'PRE_BREAK_SCENARIO',direction:'SHORT',horizonMinutes:5,
   triggerPrice:4047,invalidationPrice:4053}
 },{early:true,deadline:'17:58'});
 assert.match(pre.message,/WEEX · 📍 Сейчас:/);
 assert.match(pre.message,/❌ Отмена сценария:/);
 assert.ok(pre.message.split('\n').length<=7);
});

test('presentation does not modify live scanner, notification dedup, or cron',()=>{
 const f=readFileSync(new URL('../lib/alert-presentation.mjs',import.meta.url),'utf8');
 const n=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 const p=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(f,/fetch\(|trade-confirm|trade-prepare|PUSH_CRON_KEY|NTFY_TOPIC/);
 assert.match(n,/sequenceForSignal\(kind,s\)/);
 assert.match(n,/formatPhoneAlert\(s,\{early:isEarly,deadline\}\)/);
 assert.match(p,/ntfySend\('confirmed',signals\)/);
 assert.doesNotMatch(p,/webpush|telegramSend|telegramPoll/);
});
