import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatNotice,classifyNotice} from '../lib/alert-format.mjs';
import {parseConfirmedNotification} from '../lib/signal-quality.mjs';

const stamp=Date.UTC(2026,10,8,18,40,20);
const example={
 exchange:'WEEX',symbol:'XAUTUSDT',direction:'SHORT',level:'NORMAL',
 livePrice:4049.05,price:4049.05,stop:4050.0042059281955,take:4047.111588143609,
 candleCloseTime:stamp-20000,expiresAt:stamp+160000,
 shadowFilter:{mode:'SHADOW',warning:false},
 costReview:{mode:'SHADOW_COSTS',status:'PASS_ESTIMATE',netRR:1.75}
};
const record=n=>parseConfirmedNotification({
 event:'message',title:n.title,message:n.body,time:Math.floor(stamp/1000),
 sequence_id:'b'.repeat(32)
});

test('GREEN = check, concise prices, valid expiry, compatible 90-day journal',()=>{
 const n=formatNotice('confirmed',example,{sentAt:stamp});
 assert.equal(n.risk,'REVIEW');
 assert.match(n.title,/^🟢 ПРОВЕРИТЬ · 🔔 ОБЫЧНЫЙ XAUTUSDT SHORT$/);
 assert.match(n.body,/✅ Прибыль \(TP\): 4047.11158814/);
 assert.match(n.body,/🛑 Стоп \(SL\): 4050.00420593/);
 assert.match(n.body,/свеча 19:40:00 · отправка 19:40:20 · задержка 20с · до 19:43:00/);
 const r=record(n);
 assert.equal(r?.symbol,'XAUTUSDT');
 assert.equal(r?.direction,'SHORT');
 assert.equal(r?.level,'NORMAL');
 assert.equal(r?.shadow,'OBSERVE');
 assert.equal(r?.entry,4049.05);
});

test('YELLOW early-watch has NO valid entry or TP/SL and cannot enter journal',()=>{
 const n=formatNotice('early',{...example,level:'EARLY_WATCH'},{sentAt:stamp});
 assert.equal(n.risk,'WAIT');
 assert.match(n.title,/^🟡 ЖДАТЬ · ⚡ EARLY WATCH/);
 assert.match(n.body,/ЖДАТЬ подтверждения 5м/);
 assert.match(n.body,/НЕ ВХОДИТЬ/);
 assert.doesNotMatch(n.body,/Прибыль \(TP\):|Стоп \(SL\):/);
 assert.equal(record(n),null);
});

test('RED warning and PURPLE strong coexist independently, no forced green',()=>{
 const n=formatNotice('confirmed',{
  ...example,level:'STRONG',
  costReview:{mode:'SHADOW_COSTS',status:'COSTS_EXCEED_TP',netRR:-0.1}
 },{sentAt:stamp});
 assert.equal(n.risk,'SKIP');
 assert.equal(n.strong,true);
 assert.match(n.title,/^🔴 ПРОПУСТИТЬ · 🟣 СИЛЬНЫЙ/);
 assert.match(n.body,/РАСХОДЫ: TP меньше/);
 assert.equal(record(n)?.level,'STRONG');
});

test('failed retest and shadow observations warn; missing Bybit costs are yellow caution',()=>{
 assert.equal(classifyNotice('confirmed',{
  ...example,retest:{SHORT:{status:'FAILED'}}}).risk,'SKIP');
 assert.equal(classifyNotice('confirmed',{
  ...example,shadowFilter:{mode:'SHADOW',warning:true}}).risk,'SKIP');
 const caution=formatNotice('confirmed',{...example,exchange:'Bybit',costReview:null},{sentAt:stamp});
 assert.equal(caution.risk,'CAUTION');
 assert.match(caution.title,/^🟡 ПРОВЕРИТЬ РАСХОДЫ/);
 assert.equal(record(caution),null); // Journal deliberately only WEEX
});

test('legacy journal alerts still parse, no scanner, cron or order execution changes',()=>{
 const old=parseConfirmedNotification({
  event:'message',title:'🔔 ОБЫЧНЫЙ XAUTUSDT SHORT',
  message:'WEEX · цена 4049.05 USDT · SL 4050.0042 · TP 4047.1115',
  time:Math.floor(stamp/1000)
 });
 assert.equal(old?.symbol,'XAUTUSDT');
 const presentation=readFileSync(new URL('../lib/alert-format.mjs',import.meta.url),'utf8');
 const dispatch=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const early=readFileSync(new URL('../lib/early-push.mjs',import.meta.url),'utf8');
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 const telegram=readFileSync(new URL('../lib/telegram-alerts.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(presentation,/fetch\(|process\.env|@vercel\/blob|trade-confirm/);
 assert.match(dispatch,/formatNotice\('confirmed',primary/);
 assert.match(early,/formatNotice\('early',first/);
 assert.match(ntfy,/formatNotice\(kind,s/);
 assert.match(telegram,/formatNotice\(kind,one/);
 assert.match(dispatch,/quality\.ok&&signal\.entryQuality\?\.ok===true&&entry\.ok/);
});
