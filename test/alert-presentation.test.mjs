import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alertPresentation,formatPhoneAlert,priceText} from '../lib/alert-presentation.mjs';
const base={symbol:'XAUTUSDT',exchange:'WEEX',direction:'SHORT',level:'NORMAL',
 livePrice:4049.05,stop:4050.0042,take:4047.1116,expiresAt:Date.now()+180000};
const cost={mode:'SHADOW_COSTS',status:'PASS_ESTIMATE',netRR:1.8};
const retest={SHORT:{status:'CONFIRMED',trendAligned:true}};
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
test('early watch delivers directional forecast, not a trading instruction',()=>{
 const s={...base,level:'EARLY_WATCH',retest,costReview:cost};
 const x=formatPhoneAlert(s,{early:true,deadline:'17:58'});
 assert.equal(x.status,'FORECAST');
 assert.match(x.title,/ПРОГНОЗ ПАДЕНИЯ/);
 assert.match(x.message,/1М:/);
 assert.match(x.message,/5М:/);
 assert.match(x.message,/15М:/);
 assert.doesNotMatch(x.message,/ЖДАТЬ|ПРОБОЙ|НЕ ВХОДИТЬ|SL |TP /);
});
test('phone format has clear entry, profit, stop, and raw exact levels',()=>{
 const x=formatPhoneAlert({...base,retest,costReview:cost,
  advisor:{status:'REVIEW'},entryQuality:{ok:true}},{deadline:'17:58'});
 assert.match(x.title,/🟢 ВХОД SHORT/);
 assert.match(x.message,/Цена для проверки входа/);
 assert.match(x.message,/SL 4050.0042 · TP 4047.1116/);
 assert.match(x.message,/Расчётный R\/R после расходов/);
 assert.match(x.message,/17:58/);
 assert.equal(priceText(0.000012345678),'0,00001235');
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
