import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 assessNetCosts,DEFAULT_TAKER_FEE_BPS,DEFAULT_SLIPPAGE_BPS
} from '../lib/net-costs.mjs';

const book={exchange:'WEEX',bid:99.99,ask:100.01,entryMid:100};
test('published WEEX VIP0 taker fee and cautious slippage default, no account assumptions',()=>{
 assert.equal(DEFAULT_TAKER_FEE_BPS,8);
 assert.equal(DEFAULT_SLIPPAGE_BPS,3);
 const c=assessNetCosts({...book,direction:'LONG',stop:99.5,take:103});
 assert.equal(c.mode,'SHADOW_COSTS');
 assert.equal(c.blocksSignal,false);
 assert.equal(c.feeBpsEachSide,8);
 assert.equal(c.slippageBpsEachSide,3);
 assert.equal(c.observedSpreadBps,2);
 assert.equal(c.status,'PASS_ESTIMATE');
 assert.ok(c.netRR>=1.5);
 assert.ok(c.per1000UsdtNotional.netAtTP>0);
 assert.ok(c.per1000UsdtNotional.netAtSL<0);
 assert.ok(c.minGrossMoveBpsForBreakeven>0);
});

test('LONG TP smaller than double taker fee, spread and slippage must warn',()=>{
 const c=assessNetCosts({...book,direction:'LONG',stop:99.95,take:100.1});
 assert.ok(c.grossTargetBps>0);
 assert.ok(c.grossRR>=1.5);
 assert.equal(c.status,'COSTS_EXCEED_TP');
 assert.ok(c.netTargetBps<0);
 assert.ok(c.per1000UsdtNotional.netAtTP<0);
 assert.equal(c.blocksSignal,false);
 assert.match(c.note,/TP/);
});

test('SHORT costs are symmetric, target and stop worsen both fills',()=>{
 const c=assessNetCosts({...book,direction:'SHORT',stop:100.05,take:99.9});
 assert.equal(c.status,'COSTS_EXCEED_TP');
 assert.ok(c.netTargetBps<0);
 assert.ok(c.netStopLossBps>c.grossStopBps);
 assert.ok(c.minGrossMoveBpsForBreakeven>0);
 const long=assessNetCosts({...book,direction:'LONG',stop:99.95,take:100.1});
 assert.ok(Math.abs(long.netTargetBps-c.netTargetBps)<0.5);
});

test('net R/R below 1.5 is warned even when TP exceeds estimated costs',()=>{
 const c=assessNetCosts({...book,direction:'LONG',stop:99.5,take:101});
 assert.ok(c.netTargetBps>0);
 assert.ok(c.grossRR>=1.5);
 assert.equal(c.status,'LOW_NET_RR');
 assert.ok(c.netRR<1.5);
});

test('no fabricated WEEX pricing for Bybit, stale/missing/invalid quotes',()=>{
 assert.equal(assessNetCosts({...book,exchange:'Bybit',direction:'LONG',stop:99,take:102}),null);
 assert.equal(assessNetCosts({...book,ask:99.9,direction:'LONG',stop:99,take:102}),null);
 assert.equal(assessNetCosts({...book,bid:null,direction:'LONG',stop:99,take:102}),null);
 assert.equal(assessNetCosts({...book,bid:99.4,direction:'LONG',stop:99,take:102}),null);
 assert.equal(assessNetCosts({...book,direction:'LONG',stop:101,take:102}),null);
 assert.equal(assessNetCosts({...book,direction:'WAIT',stop:99,take:102}),null);
 assert.equal(assessNetCosts({...book,direction:'LONG',stop:99,take:102,feeBpsEachSide:100}),null);
});

test('zero fee, zero spread and no slippage reproduce gross R/R exactly',()=>{
 const c=assessNetCosts({
  exchange:'WEEX',bid:100,ask:100,entryMid:100,
  direction:'LONG',stop:99,take:102,feeBpsEachSide:0,slippageBpsEachSide:0
 });
 assert.equal(c.grossRR,2);
 assert.equal(c.netRR,2);
 assert.equal(c.minGrossMoveBpsForBreakeven,0);
});

test('optional cost warnings are read-only and production scan/dispatch still accept signals on existing gates',()=>{
 const signalSource=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const push=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const ntfy=readFileSync(new URL('../lib/ntfy-alerts.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(signalSource,/const costReview=final.direction\?assessNetCosts/);
 assert.match(push,/const costReview=assessNetCosts/);
 assert.match(push,/const refreshed=\{\.\.\.signal,livePrice:quote.price,entryQuality:entry,costReview\}/);
 assert.match(push,/refreshed\.advisor=adviseSymbol/);
 assert.match(ntfy,/const costText=/);
 assert.match(ntfy,/isEarly\|\|cost\?\.mode!=='SHADOW_COSTS'/);
 assert.match(ui,/function costHint\(s\)/);
 assert.match(ui,/\$\{costHint\(s\)\}/);
 assert.doesNotMatch(signalSource,/costReview\?\.status==='PASS_ESTIMATE'\?candidate/);
 assert.doesNotMatch(push,/costReview\.status==='PASS_ESTIMATE'\s*&&/);
 assert.doesNotMatch(push,/capi\/v3\/order|\/trade-confirm/);
 assert.doesNotMatch(ntfy,/capi\/v3\/order|\/trade-confirm/);
 const script=ui.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
});

test('Android ntfy confirmed signal embeds caution, only PRE_BREAK forecast can send an early push',async()=>{
 const {ntfySend}=await import('../lib/ntfy-alerts.mjs');
 const oldTopic=process.env.NTFY_TOPIC,originalFetch=globalThis.fetch;
 const topic='WR_Private_'+('c'.repeat(24)),posts=[];
 process.env.NTFY_TOPIC=topic;
 globalThis.fetch=async(url,options)=>{
  if(options.method==='GET')return {ok:true,status:200,text:async()=>''};
  assert.equal(options.method,'POST');
  posts.push(JSON.parse(options.body));
  return {ok:true,status:200};
 };
 try{
  const now=Date.now();
  const s={
   symbol:'XAUTUSDT',exchange:'WEEX',direction:'SHORT',
   level:'NORMAL',price:100,livePrice:100,stop:100.05,take:99.9,
   candleCloseTime:now-9000,expiresAt:now+90000,
   advisor:{status:'REVIEW'},entryQuality:{ok:true},
   costReview:assessNetCosts({...book,direction:'SHORT',stop:100.05,take:99.9})
  };
  // A cost-unfavourable candidate must NOT be announced as a trade entry.
  const rejected=await ntfySend('confirmed',[s]);
  assert.equal(rejected.delivered,0);
  const safe={...s,stop:102,take:95,
   costReview:assessNetCosts({...book,direction:'SHORT',stop:102,take:95})};
  assert.equal(safe.costReview.status,'PASS_ESTIMATE');
  const result=await ntfySend('confirmed',[safe]);
  assert.equal(result.delivered,1);
  assert.match(posts[0].message,/SL 102 · TP 95/);
  assert.match(posts[0].message,/Расчётный R\/R после расходов/);
  const early=await ntfySend('early',[{...s,level:'EARLY_WATCH'}]);
  assert.equal(early.delivered,1);
  assert.match(posts[1].message,/Только прогноз, не разрешение на сделку/);
  assert.doesNotMatch(posts[1].message,/РАСХОДЫ|NET R\/R/);
  assert.doesNotMatch(posts[0].message,/WR_Private/);
 }finally{
  globalThis.fetch=originalFetch;
  if(oldTopic===undefined)delete process.env.NTFY_TOPIC;
  else process.env.NTFY_TOPIC=oldTopic;
 }
});
