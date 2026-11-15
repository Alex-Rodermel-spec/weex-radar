import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 V110_SCREENSHOT_STUDY_POLICY as P,
 inspectNtfyScreenshotMessage as inspect,
 freezeScreenshotHypothesis as freeze,
 evaluateFrozenScreenshotHypothesis as followup,
 summarizeScreenshotResearch as summarize
} from '../lib/v110-ntfy-screenshot-shadow.mjs';

const t=Date.UTC(2026,10,15,5,5,20),MIN=60000;
const topic='wr-'+'a'.repeat(32);
const msg={
 event:'message',topic,id:'abCD123456',time:Math.floor((t-30000)/1000),
 attachment:{url:'https://ntfy.sh/file/abCD123456.png',type:'image/png',size:843020,
 name:'Screenshot_xrp.png'}
};
test('accept owner-topic ntfy image metadata ONLY; do not falsely verify sender',()=>{
 const x=inspect(msg,topic,t);
 assert.equal(x.ok,true);
 assert.equal(x.ownershipVerified,false);
 assert.equal(x.requiresOwnerAuthentication,true);
 assert.equal(x.size,843020);
 assert.ok(!JSON.stringify(x).includes(topic));
 assert.equal(freeze({symbol:'XRPUSDT',timeframeMinutes:5,direction:'SHORT_BIAS'},x,{now:t}).ok,false);
 assert.equal(P.visionBillingDisabledByDefault,true);
});
test('strict no SSRF, stale, bad MIME, oversized or foreign-topic images',()=>{
 const altered=(field,value)=>inspect({...msg,[field]:value},topic,t);
 assert.equal(altered('topic','wr-'+'b'.repeat(32)).ok,false);
 assert.equal(altered('time',Math.floor((t-21*MIN)/1000)).ok,false);
 const changed=(url,extra={})=>inspect({...msg,attachment:{...msg.attachment,url,...extra}},topic,t);
 for(const url of [
  'http://ntfy.sh/file/abCD123456.png',
  'https://evil.test/file/abCD123456.png',
  'https://ntfy.sh.evil.test/file/abCD123456.png',
  'https://ntfy.sh@evil.test/file/abCD123456.png',
  'https://ntfy.sh/file/../../admin.png',
  'https://ntfy.sh/file/abCD123456.png?redirect=https://evil.test/',
  'https://ntfy.sh:1234/file/abCD123456.png',
  'https://ntfy.sh/file/abCD123456.svg'
 ])assert.equal(changed(url).ok,false,url);
 assert.equal(changed(msg.attachment.url,{size:4_000_000}).ok,false);
 assert.equal(changed(msg.attachment.url,{type:'application/pdf'}).ok,false);
 assert.equal(changed('https://ntfy.sh/file/abCD123456.jpg').ok,false);
});
const approved={...inspect(msg,topic,t),ownershipVerified:true};
const image={symbol:'XRPUSDT',direction:'SHORT_BIAS',timeframeMinutes:5,
 chartAsOf:t-10_000,referencePrice:1,uncertainty:'Image levels rounded'};
test('freeze only an approved, in-universe, fresh and unambiguous prediction',()=>{
 let x=freeze(image,approved,{now:t});
 assert.equal(x.ok,true);
 assert.equal(x.forecastAt,t);
 assert.equal(x.symbol,'XRPUSDT');
 assert.equal(x.noTrade,true);
 assert.equal(freeze({...image,symbol:'XPINUSDT'},approved,{now:t}).ok,false);
 assert.equal(freeze({...image,chartAsOf:t-21*MIN},approved,{now:t}).ok,false);
 assert.equal(freeze({...image,direction:'MIXED'},approved,{now:t}).ok,false);
 assert.equal(freeze({...image,timeframeMinutes:3},approved,{now:t}).ok,false);
});
test('future outcomes use ONLY completed consecutive future 1m candles',()=>{
 const frozen=freeze(image,approved,{now:t});
 const start=Math.ceil(t/MIN)*MIN; // 05:06:00 -> first NEW 1m candle
 const candles=Array.from({length:16},(_,i)=>({
  time:start+i*MIN,
  close:1-(i+1)*0.001
 }));
 const asOf=start+16*MIN+2000;
 const result=followup(frozen,candles,asOf);
 assert.equal(result.outcomes[5].status,'OBSERVED');
 assert.equal(result.outcomes[10].status,'OBSERVED');
 assert.equal(result.outcomes[15].status,'OBSERVED');
 assert.equal(result.outcomes[5].directionResult,'FAVORABLE');
 assert.equal(result.outcomes[15].directionResult,'FAVORABLE');
 assert.equal(result.outcomeWindowStartsAt,start);
 assert.equal(result.noTrade,true);
 const early=followup(frozen,candles,start+5*MIN);
 assert.equal(early.outcomes[5].status,'PENDING_OR_MISSING');
 assert.equal(early.outcomes[10].status,'PENDING_OR_MISSING');
 const hole=candles.filter((_,i)=>i!==3);
 assert.equal(followup(frozen,hole,asOf).outcomes[5].status,'PENDING_OR_MISSING');
});
test('screenshot observations are not auto-wins when missing and never auto-promoted',()=>{
 const snap=freeze(image,approved,{now:t});
 const no=followup(snap,[],t+15*MIN),all=summarize([no]);
 assert.equal(all.observations,1);
 assert.equal(all.byHorizon[5].observed,0);
 assert.equal(all.byHorizon[5].unknown,1);
 assert.equal(all.byHorizon[5].favorablePct,null);
 assert.equal(all.readyForPromotion,false);
});
test('research library is not imported into orders, cron or public market routes',()=>{
 const src=readFileSync(new URL('../lib/v110-ntfy-screenshot-shadow.mjs',import.meta.url),'utf8');
 for(const file of ['../api/push-dispatch.mjs','../api/signals.mjs',
  '../api/trade-confirm.mjs']){
  assert.doesNotMatch(readFileSync(new URL(file,import.meta.url),'utf8'),
   /v110-ntfy-screenshot-shadow/);
 }
 for(const keyword of ['fetch(', '@vercel/blob','process.env','AI_GATEWAY_API_KEY',
  'ntfy.sh/', 'placeOrder(', 'trade-confirm']){
  // Strict URL string is permitted, but not HTTP requests or sends.
  if(keyword==='ntfy.sh/')continue;
  assert.ok(!src.includes(keyword),keyword);
 }
});
