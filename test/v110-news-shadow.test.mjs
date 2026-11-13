import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 parseV110NewsComment,summarizeV110NewsStudy,handleV110NewsStudy
} from '../lib/v110-news-shadow.mjs';
const event=o=>'NEWS_RADAR_V110_EVENT '+JSON.stringify({
 eventId:'FED_release_20261112',category:'FED',
 publishedAt:'2026-11-12T18:00:00Z',
 detectedAt:'2026-11-12T18:00:33Z',
 sourceUrl:'https://www.federalreserve.gov/newsevents/pressreleases/example.htm',
 primaryTimeVerified:true,planned:false,...o
});
const now=Date.UTC(2026,10,13,3);
test('only structured, source-bounded, well-timed observations are parsed',()=>{
 assert.equal(parseV110NewsComment(event()).length,1);
 assert.equal(parseV110NewsComment(event({sourceUrl:'https://evil.example/press'})).length,0);
 assert.equal(parseV110NewsComment(event({detectedAt:'2026-11-20T18:00:33Z'})).length,0);
 assert.equal(parseV110NewsComment(event({eventId:'bad id'})).length,0);
 assert.equal(parseV110NewsComment('Reuters article had no verified original post timestamp').length,0);
});
test('a report publication time alone is insufficient for an early primary-event claim',()=>{
 const comments=[{body:event({primaryTimeVerified:false})},{body:'legacy markdown observation'}];
 const d=summarizeV110NewsStudy(comments,now);
 assert.equal(d.structuredEvents,1);
 assert.equal(d.originalTimeVerified,0);
 assert.equal(d.earlyWithin60sCandidates,0);
 assert.equal(d.status,'INSUFFICIENT_VERIFIED_EARLY_NEWS');
 assert.equal(d.changesLiveSignals,false);
});
test('even a claimed verified timely primary event requires actual market replay',()=>{
 const d=summarizeV110NewsStudy([{body:event()}],now);
 assert.equal(d.originalTimeVerified,1);
 assert.equal(d.earlyWithin60sCandidates,1);
 assert.equal(d.status,'INSUFFICIENT_VERIFIED_EARLY_NEWS');
 assert.match(d.warning,/NOT prove/);
});
test('read-only route checks method and safely handles public issue API unavailability',async()=>{
 const res={statusCode:0,payload:null,setHeader(){},status(v){this.statusCode=v;return this},
  json(v){this.payload=v;return this}};
 await handleV110NewsStudy({method:'POST'},res,async()=>{throw Error('should not fetch')});
 assert.equal(res.statusCode,405);
 await handleV110NewsStudy({method:'GET'},res,async()=>({
  ok:true,text:async()=>JSON.stringify([{body:event()}])
 }));
 assert.equal(res.statusCode,200);
 assert.equal(res.payload.earlyWithin60sCandidates,1);
 await handleV110NewsStudy({method:'GET'},res,async()=>{throw Error('offline')});
 assert.equal(res.statusCode,503);
 assert.equal(res.payload.ordersSent,0);
});
test('NEWS research never enters live scan/ntfy or order placement',()=>{
 const api=readFileSync(new URL('../api/signals.mjs',import.meta.url),'utf8');
 const sender=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 const source=readFileSync(new URL('../lib/v110-news-shadow.mjs',import.meta.url),'utf8');
 assert.match(api,/mode==='v110-news'/);
 assert.doesNotMatch(sender,/v110-news-shadow|handleV110NewsStudy/);
 assert.doesNotMatch(source,/placeOrder|trade-confirm|NTFY_TOPIC|PUSH_CRON_KEY|privateKey/);
});

test('editorially annotated recent verified event can inform a separate research badge',()=>{
 const fresh=event({
  publishedAt:'2026-11-13T02:40:00Z',
  detectedAt:'2026-11-13T02:40:28Z',
  marketImpact:'NEGATIVE',impactAssets:['BTC','CRYPTO']
 });
 const result=summarizeV110NewsStudy([{body:fresh}],now);
 assert.equal(result.newsDisplay.status,'RESEARCH_CONTEXT');
 assert.deepEqual(result.newsDisplay.events[0].impactAssets,['BTC','CRYPTO']);
 assert.equal(result.newsDisplay.events[0].marketImpact,'NEGATIVE');
 assert.equal(result.newsDisplay.events[0].sourceHost,'www.federalreserve.gov');
 assert.equal(result.changesLiveSignals,false);
 assert.equal(result.ordersSent,0);
});
test('old, planned, unverified, late and unlabeled events never create fake news bias',()=>{
 const cases=[
  {publishedAt:'2026-11-12T23:58:00Z',detectedAt:'2026-11-12T23:58:30Z'},
  {publishedAt:'2026-11-13T02:40:00Z',detectedAt:'2026-11-13T02:40:20Z',planned:true},
  {publishedAt:'2026-11-13T02:40:00Z',detectedAt:'2026-11-13T02:40:20Z',primaryTimeVerified:false},
  {publishedAt:'2026-11-13T02:40:00Z',detectedAt:'2026-11-13T02:48:00Z'},
  {publishedAt:'2026-11-13T02:40:00Z',detectedAt:'2026-11-13T02:40:20Z',marketImpact:'UP_TO_90_PERCENT'},
  {publishedAt:'2026-11-13T02:40:00Z',detectedAt:'2026-11-13T02:40:20Z',impactAssets:['INVALID']}
 ];
 for(const change of cases){
  const ev=event({publishedAt:'2026-11-13T02:40:00Z',
   detectedAt:'2026-11-13T02:40:20Z',
   marketImpact:'POSITIVE',impactAssets:['BTC'],...change});
  const result=summarizeV110NewsStudy([{body:ev}],now);
  assert.equal(result.newsDisplay.status,'UNKNOWN',JSON.stringify(change));
  assert.deepEqual(result.newsDisplay.events,[]);
 }
});
test('dashboard news fetch starts strictly after forecast refresh, never modifies server signals',()=>{
 const html=readFileSync(new URL('../forecast.html',import.meta.url),'utf8');
 const sender=readFileSync(new URL('../lib/forecast-ntfy.mjs',import.meta.url),'utf8');
 const dispatcher=readFileSync(new URL('../api/push-dispatch.mjs',import.meta.url),'utf8');
 assert.match(html,/aria-label="Новостной фон без влияния на сигналы"/);
 assert.match(html,/refresh\(\)\.finally\(\(\)=>\{void loadNewsContext\(\)\}\)/);
 assert.match(html,/fetch\('\/api\/signals\?mode=v110-news'/);
 assert.match(html,/4500/);
 assert.match(html,/panel\.textContent=/);
 assert.doesNotMatch(sender,/v110-news-shadow|mode=v110-news|newsDisplay/);
 assert.doesNotMatch(dispatcher,/v110-news-shadow|mode=v110-news|newsDisplay/);
});
