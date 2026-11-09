import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 alertExpiryFromText,studyRealAlertOneMinute,summarizeRealOneMinute
} from '../lib/real-ntfy-one-minute.mjs';
import {parseConfirmedNotification} from '../lib/signal-quality.mjs';

const MIN=60_000;
const at=Date.parse('2026-11-09T14:36:15.000Z'); // 15:36:15 Berlin
const expires=Date.parse('2026-11-09T14:38:00.000Z'); // 15:38:00 Berlin
const message='📈 РОСТ · WEEX\n📍 Вход: 100 USDT\n'+
 'SL 99 · TP 101.8\nЧистый R/R (модель): 1.04:1\n'+
 '⏰ До 15:38:00 · Проверь актуальную цену\n'+
 '🕒 Свеча 15:35:00 · отправка 15:36:15 · задержка 75с';
const msg={event:'message',time:Math.floor(at/1000),
 title:'🔴 ПРОПУСТИТЬ · BTCUSDT LONG · 🟣 СИЛЬНЫЙ',message};
const parsed=parseConfirmedNotification(msg);
const sample={...parsed,expiresAt:expires};
const c=(time,open,high,low,close)=>({time,closeTime:time+MIN,open,high,low,close});
const early=Date.parse('2026-11-09T14:37:00.000Z');
const later=early+MIN;
const now=later+3*MIN+20_000;
function study(...bars){return studyRealAlertOneMinute(sample,bars,now)}

test('deadline is reconstructed from original Berlin ntfy time, not 3 min after delivery',()=>{
 assert.equal(parsed.expiresAt,expires);
 assert.equal(alertExpiryFromText(message,at),expires);
 assert.equal(alertExpiryFromText(message.replace('15:38:00','15:50:00'),at),null);
 assert.equal(alertExpiryFromText(message.replace('15:38:00','25:38:00'),at),null);
 assert.equal(alertExpiryFromText('no deadline',at),null);
 const nearMidnight=Date.parse('2026-11-09T22:59:30Z'); // 23:59:30 Berlin
 assert.equal(alertExpiryFromText('⏰ До 00:01:00',nearMidnight),
  Date.parse('2026-11-09T23:01:00Z'));
 const summer=Date.parse('2026-07-01T21:59:30Z'); // 23:59:30 Berlin DST
 assert.equal(alertExpiryFromText('⏰ До 00:01:00',summer),
  Date.parse('2026-07-01T22:01:00Z'));
});

test('a real skip is not retrospectively promoted to trade, even if 1m touch and later TP',()=>{
 assert.equal(parsed.decisionAtAlert,'SKIP');
 const report=study(
  c(early,100,100.3,99.7,100.1),
  c(later,100.1,102,99.8,101.9)
 );
 assert.equal(report.status,'TOUCH_POSSIBLE');
 assert.equal(report.postTouchStatus,'TP_TOUCHED');
 assert.equal(report.tradeReady,false);
 assert.equal(report.filled,false);
 assert.ok(report.requiredBps>=2);
 assert.ok(report.requiredBps<=60);
 assert.ok(report.limit<100);
});

test('LONG and SHORT are symmetric without future-candle lookahead into eligibility',()=>{
 const long=study(c(early,100,100.2,99.7,100.02));
 assert.equal(long.status,'TOUCH_POSSIBLE');
 assert.equal(long.postTouchStatus,'NO_DATA'); // later bars missing, not free wins
 const short={...sample,direction:'SHORT',stop:101,take:98.2};
 const shortReport=studyRealAlertOneMinute(short,[c(early,100,100.3,99.8,100.1)],now);
 assert.equal(shortReport.status,'TOUCH_POSSIBLE');
 assert.ok(shortReport.limit>100);
 assert.equal(shortReport.postTouchStatus,'NO_DATA');
});

test('gap/marketable, ambiguous within-minute and pre-entry invalidation never count as touching',()=>{
 const marketable=study(c(early,99.7,100,99.65,99.9));
 assert.equal(marketable.status,'GAP_OR_MARKETABLE');
 const ambiguous=study(c(early,100,102,99.7,101));
 assert.equal(ambiguous.status,'AMBIGUOUS_1M');
 const invalid=study(c(early,100,102,99.99,101.9));
 assert.equal(invalid.status,'INVALIDATED_BEFORE_TOUCH');
 const no=study(c(early,100,100.05,99.99,100.01));
 assert.equal(no.status,'NO_TOUCH');
});

test('never count the minute containing ntfy send time or a candle after expiry',()=>{
 const before=c(early-MIN,100,100.1,98.9,99.2);
 const no=c(early,100,100.2,100,100.01);
 const after=c(later,100,100.2,99.5,99.8);
 const report=study(before,no,after);
 assert.equal(report.status,'NO_TOUCH');
 assert.equal(studyRealAlertOneMinute({...sample,sentAt:early+15_000},
  [before,no,after],now).status,'INSUFFICIENT_1M_RESOLUTION');
});

test('unknown deadlines, missing candles and pending should remain honest',()=>{
 assert.equal(studyRealAlertOneMinute({...sample,expiresAt:null},[],now).status,'UNKNOWN_DEADLINE');
 assert.equal(study().status,'NO_DATA');
 assert.equal(studyRealAlertOneMinute(sample,[],early+30_000).status,'PENDING');
 assert.equal(studyRealAlertOneMinute({...sample,stop:99.999,take:100.001},[],now).status,
  'NO_VIABLE_PRICE');
 assert.equal(studyRealAlertOneMinute({...sample,stop:100.1},[],now).status,'BAD_ALERT');
 const bad=c(early,100,99.9,99.7,100);
 assert.equal(study(bad).status,'NO_DATA');
});

test('post touch TP/SL both in one minute remains ambiguous',()=>{
 const both=study(c(early,100,100.3,99.7,100.1),
  c(later,100,102,98.8,100.8));
 assert.equal(both.status,'TOUCH_POSSIBLE');
 assert.equal(both.postTouchStatus,'AMBIGUOUS');
 const stopped=study(c(early,100,100.3,99.7,100.1),
  c(later,100,100.3,98.8,99));
 assert.equal(stopped.postTouchStatus,'SL_TOUCHED');
});

test('summary counts unknowns separately and never reports win rate or profit',()=>{
 const rows=[
  {oneMinuteResearch:study(c(early,100,100.3,99.7,100.1))},
  {oneMinuteResearch:study(c(early,100,100.2,99.99,100.01))},
  {oneMinuteResearch:study()},
  {oneMinuteResearch:study(c(early,100,102,99.7,100.8))}
 ];
 const x=summarizeRealOneMinute(rows);
 assert.equal(x.total,4);
 assert.equal(x.counts.TOUCH_POSSIBLE,1);
 assert.equal(x.counts.NO_TOUCH,1);
 assert.equal(x.counts.NO_DATA,1);
 assert.equal(x.counts.AMBIGUOUS_1M,1);
 assert.equal(x.postTouch.NO_DATA,1);
 assert.equal('profit' in x,false);
 assert.equal('winRatePct' in x,false);
});

test('route and UI only add read-only 1m quality observation; no live trade modification',()=>{
 const route=readFileSync(new URL('../lib/signal-quality-route.mjs',import.meta.url),'utf8');
 const quality=readFileSync(new URL('../quality.html',import.meta.url),'utf8');
 const source=readFileSync(new URL('../lib/real-ntfy-one-minute.mjs',import.meta.url),'utf8');
 const script=quality.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1],{filename:'quality.html'}));
 assert.match(route,/oneMinuteResearch:studyRealAlertOneMinute/);
 assert.match(route,/oneMinuteStudy:summarizeRealOneMinute/);
 assert.match(route,/unique\.set\(time,\{time,closeTime:time\+minute,open,high,low,close\}\)/);
 assert.match(quality,/id="minute-study"/);
 assert.match(quality,/id="one-touch"/);
 for(const s of [route,source,quality]){
  assert.doesNotMatch(s,/weex\.placeOrder|\/api\/trade-confirm|\/api\/trade-prepare|WEEX_API_SECRET/);
 }
});
