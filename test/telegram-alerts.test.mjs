import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {_test,telegramConfigured} from '../lib/telegram-alerts.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('telegram safely stays disabled without BotFather token',()=>{
 assert.equal(telegramConfigured(),false);
 assert.equal(_test.matchSecret('hello','hello'),true);
 assert.equal(_test.matchSecret('hello','other'),false);
 assert.equal(_test.matchSecret('hello','hell'),false);
});
test('early WATCH message never says to enter a trade',()=>{
 const msg=_test.messageText('early',[{exchange:'WEEX',symbol:'XRPUSDT',direction:'LONG',livePrice:0.9123}]);
 assert.match(msg,/WATCH/);assert.match(msg,/НЕ ВХОДИТЬ/);assert.match(msg,/XRPUSDT/);assert.match(msg,/1м/);
});
test('confirmed messages distinguish Bybit from WEEX',()=>{
 const msg=_test.messageText('confirmed',[{exchange:'Bybit',symbol:'BTCUSDT',direction:'SHORT',level:'STRONG',livePrice:72000}]);
 assert.match(msg,/Bybit/);assert.match(msg,/SHORT/);assert.match(msg,/5м/);
});
test('Telegram uses existing signed cron and safe optional integration',()=>{
 const dispatch=read('../api/push-dispatch.mjs'),early=read('../lib/early-push.mjs'),mod=read('../lib/telegram-alerts.mjs');
 assert.match(dispatch,/const source=await authorized\(req\)/);
 assert.match(dispatch,/telegramPoll\(\)/);
 assert.match(dispatch,/telegramSend\('confirmed',signals\)/);
 assert.match(early,/telegramSend\('early',signals\)/);
 assert.match(mod,/getUpdates/);
 assert.match(mod,/allowOverwrite:false/);
 assert.doesNotMatch(mod,/WEEX_API_SECRET|capi\/v3\/order/);
});