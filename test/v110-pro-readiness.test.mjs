import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 freezeV5Independent,summarizeV5Independent,
 V5_INDEPENDENT_POLICY as P
} from '../lib/v110-v5-independent-journal.mjs';

const MIN=60_000,FIVE=5*MIN,now=Date.UTC(2026,10,21,10,27,30);
function snap(symbol,side='MIXED'){
 const oneClose=Math.ceil(now/MIN)*MIN-MIN;
 const fiveClose=Math.floor((now-1000)/FIVE)*FIVE;
 return {exchange:'WEEX',available:true,symbol,
  combinedDirection:'MIXED',
  timeframes:[{intervalMinutes:1,closedAt:oneClose,price:100},
   {intervalMinutes:5,closedAt:fiveClose},
   {intervalMinutes:10,closedAt:fiveClose-5*MIN}],
  forecastV5:{available:true,direction:side,closedAt1m:oneClose,
   closedAt5m:fiveClose}
 };
}
test('independent AI watchdog separates no samples, valid MIXED and stale samples',()=>{
 const none=summarizeV5Independent([],now);
 assert.equal(none.collectionDiagnostics.state,'NO_SAMPLES');
 assert.equal(none.collectionDiagnostics.totalSamples,0);
 assert.equal(none.collectionDiagnostics.directionalCoveragePct,null);
 const mixed=freezeV5Independent(snap('BTCUSDT'),now);
 const one=summarizeV5Independent([mixed],now+MIN);
 assert.equal(one.collectionDiagnostics.state,'RECENT_SAMPLES');
 assert.equal(one.collectionDiagnostics.v5MixedAbstentions,1);
 assert.equal(one.collectionDiagnostics.v5DirectionalCandidates,0);
 assert.equal(one.collectionDiagnostics.directionalCoveragePct,0);
 assert.equal(one.collectionDiagnostics.recentSamples,1);
 assert.equal(one.v5FiveMinute.observed,0);
 const stale=summarizeV5Independent([mixed],now+91*MIN);
 assert.equal(stale.collectionDiagnostics.state,'STALE_SAMPLES');
 assert.equal(stale.collectionDiagnostics.recentSamples,0);
 assert.equal(stale.collectionDiagnostics.ageMinutes,91);
 assert.equal(stale.recommendation,'KEEP_V4');
 assert.equal(stale.accuracyImprovedNotProven,true);
});
test('directional coverage is observed samples, never inflated by abstentions',()=>{
 const mixed=freezeV5Independent(snap('BTCUSDT'),now);
 const long=freezeV5Independent(snap('XRPUSDT','LONG_BIAS'),now);
 const short=freezeV5Independent(snap('ETHUSDT','SHORT_BIAS'),now);
 const out=summarizeV5Independent([mixed,long,short],now+MIN);
 assert.equal(out.collectionDiagnostics.totalSamples,3);
 assert.equal(out.collectionDiagnostics.v5DirectionalCandidates,2);
 assert.equal(out.collectionDiagnostics.v5MixedAbstentions,1);
 assert.equal(out.collectionDiagnostics.directionalCoveragePct,66.67);
 assert.equal(out.v5FiveMinute.observed,0);
 assert.equal(out.tradeOrders,0);
 assert.equal(out.liveForecastChanged,false);
 assert.equal(P.collectionStaleAfterMinutes,90);
});
test('PRO page is a user-visible safety dashboard, never trade execution',()=>{
 const html=readFileSync(new URL('../pro.html',import.meta.url),'utf8');
 const main=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(main,/href="\/pro\.html"/);
 for(const id of ['ready','scanner-num','v4-num','v5-num','ml-num',
  'paper-num','news-num','v5-state','paper-state','updated'])
  assert.match(html,new RegExp('id="'+id+'"'));
 for(const path of ['mode=health','mode=journal','/api/paper-trading',
  'mode=v110-news','mode=v110-news-forecast'])assert.ok(html.includes(path));
 const js=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);
 assert.doesNotThrow(()=>new Script(js));
 // All fetched backend values must be written as text, not HTML.
 assert.match(js,/textContent/);
 assert.doesNotMatch(js,/innerHTML|insertAdjacentHTML|document\.write/);
 assert.doesNotMatch(html,/\/api\/trade-(confirm|prepare|session|release)/);
 assert.doesNotMatch(html,/WEEX_API_SECRET|PUSH_CRON_KEY|NTFY_TOPIC/);
 assert.match(html,/НЕ ГОТОВ К РЕАЛЬНОЙ АВТОТОРГОВЛЕ/);
 assert.match(html,/нет гарантии|не равно доходности|не доказаны/i);
 assert.equal(P.autoPromotion,false);
});
