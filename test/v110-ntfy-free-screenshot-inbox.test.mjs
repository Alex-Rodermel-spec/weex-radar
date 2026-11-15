import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 FREE_SCREENSHOT_POLICY,parseScreenshotCaption,formatFreeScreenshotNotice,
 freeSnapshot,screenshotInboxDue,pollNtfyScreenshotMessages,
 runFreeScreenshotInbox
} from '../lib/v110-ntfy-free-screenshot-inbox.mjs';
const MIN=60000;
const topic='wr-'+'a'.repeat(32);
const tick=()=>Date.now();
const receipt=(now,caption='XRPUSDT 5M')=>({
 event:'message',topic,id:'myPhoto0012',time:Math.floor((now-15000)/1000),
 message:caption,attachment:{url:'https://ntfy.sh/file/abCD123456.png',
  type:'image/png',size:190000,name:'screenshot.png'}
});
const forecast=(now,symbol='XRPUSDT',direction='SHORT_BIAS')=>({
 available:true,exchange:'WEEX',symbol,combinedDirection:direction,
 reversalRisk:{risk:'HIGH'},
 timeframes:[{intervalMinutes:1,direction,closedAt:now-60000,price:1},
  {intervalMinutes:5,direction,closedAt:now-300000,price:1},
  {intervalMinutes:10,direction,closedAt:now-600000,price:1}]
});
test('free mode never calls vision or tries to decode image',()=>{
 assert.equal(FREE_SCREENSHOT_POLICY.paidModelCalls,0);
 assert.equal(FREE_SCREENSHOT_POLICY.visionModel,false);
 assert.equal(FREE_SCREENSHOT_POLICY.rawImageDownloads,0);
 const file=readFileSync(new URL('../lib/v110-ntfy-free-screenshot-inbox.mjs',import.meta.url),'utf8');
 for(const term of ['ai-gateway','AI_GATEWAY_API_KEY','openai','anthropic','tesseract',
  'get(attachmentUrl)', 'trade-confirm','trade-prepare']){
  assert.ok(!file.toLowerCase().includes(term.toLowerCase()),term)
 }
});
test('caption must name exactly one supported market plus timeframe',()=>{
 assert.deepEqual(parseScreenshotCaption({message:'XRPUSDT 5M'}),{
  ok:true,symbol:'XRPUSDT',timeframeMinutes:5});
 assert.deepEqual(parseScreenshotCaption({message:'1000SHIBUSDT 15m'}),{
  ok:true,symbol:'1000SHIBUSDT',timeframeMinutes:15});
 assert.equal(parseScreenshotCaption({message:'XPINUSDT 5M'}).ok,false);
 assert.equal(parseScreenshotCaption({message:'ADAUSDT 5M XRPUSDT 5M'}).ok,false);
 assert.equal(parseScreenshotCaption({message:'XRPUSDT'}).ok,false);
 assert.equal(parseScreenshotCaption({message:'XRPUSDT 1M 5M'}).ok,false);
 assert.equal(parseScreenshotCaption({message:'XRPUSDT 5M',attachment:{name:'XPINUSDT_5M.jpg'}}).ok,false);
});
test('freeze uses WEEX closed bars, does not claim to have read screenshot',()=>{
 const now=tick(),a=parseScreenshotCaption({message:'XRPUSDT 5M'});
 const f=freeSnapshot(a,forecast(now),'a123456789',now);
 assert.equal(f.ok,true);assert.equal(f.scorable,true);
 assert.equal(f.screenshotDecoded,false);
 assert.equal(f.ownerIdentityVerified,false);
 assert.match(f.source,/NOT_IMAGE_VISION/);
 assert.equal(f.referencePrice,1);
 assert.equal(f.noTrade,true);
 assert.equal(freeSnapshot(a,forecast(now,'ADAUSDT'),'b123456789',now),null);
 assert.equal(freeSnapshot(a,forecast(now-10*MIN),'b123456789',now),null);
 const mixed=freeSnapshot(a,forecast(now,'XRPUSDT','MIXED'),'c123456789',now);
 assert.equal(mixed.scorable,false);
 assert.equal(mixed.direction,'MIXED');
});
test('notice openly explains screenshot is NOT interpreted and no live signal',()=>{
 const now=tick(),a=parseScreenshotCaption({message:'XRPUSDT 5M'});
 const n=formatFreeScreenshotNotice({caption:a,forecast:forecast(now)});
 assert.match(n.message,/Снимок НЕ распознан/);
 assert.match(n.message,/Не вход в сделку/);
 assert.match(formatFreeScreenshotNotice({status:'CAPTION_REQUIRED'}).message,/XRPUSDT 5M/);
});
test('ntfy poll is bounded and parses only its exact topic',async()=>{
 const now=tick();
 const items=[receipt(now),{...receipt(now),topic:'other'}];
 let urls=[];
 const fetchImpl=async url=>{urls.push(url);return {ok:true,text:async()=>items.map(x=>JSON.stringify(x)).join('\n')}};
 const found=await pollNtfyScreenshotMessages(topic,{now,fetchImpl});
 assert.equal(found.length,1);
 assert.equal(found[0].id,'myPhoto0012');
 assert.match(urls[0],/poll=1/);
 await assert.rejects(()=>pollNtfyScreenshotMessages('unknown',{fetchImpl}),/Invalid/);
});
test('due only one minute slot every 5 minutes',()=>{
 assert.equal(screenshotInboxDue(2*MIN),true);
 assert.equal(screenshotInboxDue(3*MIN),false);
 assert.equal(screenshotInboxDue(7*MIN),true);
});
test('free ntfy intake captures ONE metadata observation and replies without fetching image',async()=>{
 const now=tick();const x=receipt(now);
 const memory=new Map(),sent=[];
 const store={
  get:async path=>memory.get(path)||null,
  put:async(path,obj)=>{if(memory.has(path))throw Error('exists');memory.set(path,obj)},
  list:async({prefix})=>({blobs:[...memory.keys()].filter(s=>s.startsWith(prefix)).map(pathname=>({pathname}))}),
  del:async path=>memory.delete(path)
 };
 const fetchImpl=async url=>{
  assert.match(url,/^https:\/\/ntfy\.sh\/wr-/);return {ok:true,text:async()=>JSON.stringify(x)}
 };
 const result=await runFreeScreenshotInbox({
  env:{NTFY_SCREENSHOT_TOPIC:topic},now,fetchImpl,
  due:()=>true,store,
  reader:async()=>forecast(Date.now()),barsReader:async()=>[],
  publisher:async(tp,notice)=>{sent.push({tp,notice})}
 });
 assert.equal(result.paidModelCalls,0);
 assert.equal(result.imagesDownloaded,0);
 assert.equal(result.accepted,1);
 assert.equal(result.studiesFrozen,1);
 assert.equal(result.replied,1);
 assert.match(sent[0].notice.message,/Снимок НЕ распознан/);
 assert.ok([...memory.keys()].some(s=>s.includes('/pending/')));
 const snap=[...memory.values()].find(v=>v.mode==='V110_SCREENSHOT_SHADOW_FROZEN');
 assert.equal(snap.ownerIdentityVerified,false);
 // No screenshot bytes, ntfy message or binary URL ever persisted.
 assert.doesNotMatch(JSON.stringify([...memory.values()]),/https:\/\/ntfy\.sh\/file|screenshot.png/);
});
