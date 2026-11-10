import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {eligiblePhoneSignal} from '../lib/ntfy-alerts.mjs';
import {formatPhoneAlert} from '../lib/alert-presentation.mjs';
import {classifyMarketNtfyTitle} from '../lib/health-monitor.mjs';

const now=Date.now();
const sample={
 symbol:'XRPUSDT',exchange:'WEEX',direction:'LONG',level:'NORMAL',
 candleCloseTime:now-5000,expiresAt:now+90_000,
 livePrice:2.001,stop:1.98501234,take:2.04567891,
 entryQuality:{ok:true},
 costReview:{status:'PASS_ESTIMATE',netRR:1.5},
 advisor:{status:'REVIEW'}
};

test('only genuinely reviewed WEEX candidates are entry notifications',()=>{
 assert.equal(eligiblePhoneSignal(sample,'confirmed'),true);
 for(const bad of [
  {...sample,advisor:{status:'WAIT'}},
  {...sample,advisor:{status:'SKIP'}},
  {...sample,exchange:'Bybit'},
  {...sample,costReview:{status:'LOW_NET_RR'}},
  {...sample,entryQuality:{ok:false}},
  {...sample,expiresAt:now-1000}
 ]) assert.equal(eligiblePhoneSignal(bad,'confirmed'),false);
 const result=formatPhoneAlert(sample);
 assert.match(result.title,/^🟢 ВХОД LONG · XRPUSDT$/u);
 assert.match(result.message,/SL 1.98501234 · TP 2.04567891/);
 assert.match(result.message,/Подтверди лично|подтверди лично/);
 assert.equal(classifyMarketNtfyTitle(result.title),'confirmed');
});

test('1m early watches are predictions, never executable orders',()=>{
 const watch={...sample,level:'EARLY_WATCH',watchType:'PRE_BREAK',
  forecast:{mode:'PRE_BREAK_SCENARIO',direction:'LONG',horizonMinutes:5,
   rsi1:56,rsi5:61,volumeRatio:1.4,triggerPrice:2.02,invalidationPrice:1.98}};
 assert.equal(eligiblePhoneSignal(watch,'early'),true);
 const forecast=formatPhoneAlert(watch,{early:true});
 assert.match(forecast.title,/^🔮 ПРОГНОЗ РОСТА · XRPUSDT$/u);
 for(const tf of ['1М','5М','10М'])assert.ok(forecast.message.includes(tf));
 assert.doesNotMatch(forecast.message,/НЕ ВХОДИТЬ|ЖДАТЬ|ПРОБОЙ/);
 assert.doesNotMatch(forecast.message,/SL |TP /);
 assert.equal(classifyMarketNtfyTitle(forecast.title),'early');
 assert.equal(eligiblePhoneSignal({...watch,exchange:'Bybit'},'early'),false);
});

test('push never sends forecast-result notifications or auto orders',()=>{
 const d=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(d,/followupSentForecasts\(/);
 assert.match(d,/ntfySend\('confirmed',signals\)/);
 assert.doesNotMatch(d,/weex\.placeOrder|\/api\/trade-confirm/);
});

test('fingerprint control stays visible but order approval stays explicit',()=>{
 const html=readFileSync(new URL('../trade.html',import.meta.url),'utf8');
 assert.match(html,/\$\('finger-login'\)\.hidden=false/);
 assert.match(html,/\$\('finger-login'\)\.disabled=active/);
 assert.match(html,/verifyPhonePasskey\(begin\.options\)/);
 assert.match(html,/passkeyAssertion/);
 const m=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(m);assert.doesNotThrow(()=>new Script(m[1]));
});
