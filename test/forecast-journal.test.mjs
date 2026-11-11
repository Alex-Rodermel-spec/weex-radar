import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {
 parsePublishedForecast,normalizeForecastMinutes,evaluatePublishedForecast,
 mergeForecastArchive,summarizeForecastArchive,FORECAST_HORIZONS,
 recentForecastResearch,recoverArchivedForecasts
} from '../lib/forecast-journal.mjs';
import {encryptJournal,decryptJournalArchive,summarizeJournal} from '../lib/journal-core.mjs';
import {forecastTopic} from '../lib/forecast-ntfy.mjs';

const MIN=60000;
const now=Date.UTC(2026,10,10,18,45,40);
const env={NTFY_TOPIC:'p'.repeat(32),PUSH_CRON_KEY:'k'.repeat(40)};
const topic=forecastTopic(env);
const origin=now-45*MIN-40000;
const sentAt=Math.floor(origin/1000)*1000;
const notice={
 event:'message',topic,time:sentAt/1000,
 sequence_id:'a'.repeat(32),
 title:'🔮 🔵 ОБЫЧНЫЙ ПРОГНОЗ · BTCUSDT SHORT',
 message:'📉 СЦЕНАРИЙ SHORT · WEEX Futures\n1М / 5М / 10М: совпадение направления\nЦена 1М: 100.00 USDT · свеча 18:00\nRSI14: 41 / 40 / 40'
};
const emitted=parsePublishedForecast(notice,topic,now);
const start=Math.ceil((sentAt+1)/MIN)*MIN;
function futureRaw(){
 return Array.from({length:40},(_,i)=>{
  const close=i<8?100.01:i<9?99.99:i<10?99.8:i<14?99.78:99.7;
  return [start+i*MIN,100,Math.max(close,100)+.02,Math.min(close,100)-.02,close,500];
 });
}
test('parse only genuine sent private forecast notices (not trading alerts)',()=>{
 assert.equal(emitted.symbol,'BTCUSDT');
 assert.equal(emitted.direction,'SHORT');
 assert.equal(emitted.strength,'STANDARD');
 assert.equal(emitted.reference,100);
 assert.equal(parsePublishedForecast({...notice,topic:'wrong'},topic,now),null);
 assert.equal(parsePublishedForecast({...notice,title:'🟢 LONG BTCUSDT'},topic,now),null);
 assert.equal(parsePublishedForecast({...notice,message:'Trade @ 100'},topic,now),null);
 assert.equal(parsePublishedForecast({...notice,sequence_id:'wrong'},topic,now),null);
 const backfill=parsePublishedForecast({...notice,time:Math.floor((now-6*60*MIN)/1000)},topic,now);
 assert.ok(backfill,'genuine overnight notices remain recoverable');
 assert.equal(parsePublishedForecast({...notice,time:Math.floor((now-13*60*MIN)/1000)},topic,now),null);
});
test('later move begins on 10th closed 1m candle, not assumed immediately',()=>{
 const bars=normalizeForecastMinutes(futureRaw(),now);
 const outcome=evaluatePublishedForecast(emitted,bars,now);
 assert.equal(outcome.windows[1].status,'OBSERVED');
 assert.ok(outcome.windows[1].moveBps<0);
 assert.equal(outcome.windows[5].moveBps<0,true);
 assert.equal(outcome.windows[10].status,'OBSERVED');
 assert.ok(outcome.windows[10].moveBps>0);
 assert.equal(outcome.firstFavorable10bpsMinute,10);
 assert.equal(outcome.windows[15].status,'OBSERVED');
 assert.equal(outcome.windows[30].status,'OBSERVED');
 const report=summarizeForecastArchive([outcome],now).windows[30];
 assert.equal(report.at10m.favorablePct,100);
 assert.equal(report.at5m.favorablePct,0);
 assert.equal(report.firstFavorable10bps.from10to15,1);
 assert.equal(report.byStrength.STANDARD.at10m.favorablePct,100);
 assert.equal(report.byDirection.SHORT.total,1);
 assert.equal(report.byDirection.SHORT.at10m.favorablePct,100);
 assert.equal(report.byDirection.LONG.at10m.observed,0);
});
test('directional hypothesis never conflates LONG and SHORT or counts missing candles as losses',()=>{
 const bars=normalizeForecastMinutes(futureRaw(),now);
 const short=evaluatePublishedForecast(emitted,bars,now);
 const long=evaluatePublishedForecast({...emitted,id:'c'.repeat(32),direction:'LONG'},bars,now);
 const missing=evaluatePublishedForecast({...emitted,id:'d'.repeat(32),direction:'LONG'},[],now);
 const out=summarizeForecastArchive([short,long,missing],now).windows[30];
 assert.equal(out.byDirection.SHORT.total,1);
 assert.equal(out.byDirection.LONG.total,2);
 assert.equal(out.byDirection.SHORT.at10m.favorablePct,100);
 assert.equal(out.byDirection.LONG.at10m.favorablePct,0);
 assert.equal(out.byDirection.LONG.at10m.observed,1);
 assert.equal(out.byDirection.LONG.at10m.noData,1);
 assert.equal(out.byDirection.SHORT.at10m.observed+out.byDirection.LONG.at10m.observed,out.at10m.observed);
 assert.equal(out.byDirection.LONG.before15m.observed,0);
});

test('future/unclosed or gapped candles never become wins',()=>{
 const raw=futureRaw();
 raw.splice(7,1);
 const data=normalizeForecastMinutes(raw,now);
 const missing=evaluatePublishedForecast(emitted,data,now);
 assert.equal(missing.windows[5].status,'OBSERVED');
 assert.equal(missing.windows[10].status,'NO_DATA');
 assert.equal(missing.firstFavorable10bpsMinute,null);
 const premature=evaluatePublishedForecast(emitted,normalizeForecastMinutes(futureRaw(),start+7*MIN),start+7*MIN);
 assert.equal(premature.windows[10].status,'PENDING');
 assert.equal(premature.windows[30].status,'PENDING');
});
test('merge preserves first measurement, adds 15/30m and encrypts whole archive',()=>{
 const first=evaluatePublishedForecast(emitted,normalizeForecastMinutes(futureRaw(),start+12*MIN+1000),start+12*MIN+1000);
 const complete=evaluatePublishedForecast(emitted,normalizeForecastMinutes(futureRaw(),now),now);
 const newArchive=mergeForecastArchive([], [first],now);
 assert.equal(newArchive.added,1);
 assert.equal(newArchive.rows[0].windows[30].status,'PENDING');
 const updated=mergeForecastArchive(newArchive.rows,[complete],now);
 assert.equal(updated.rows[0].windows[30].status,'OBSERVED');
 assert.equal(updated.rows[0].windows[10].moveBps,first.windows[10].moveBps);
 assert.equal(updated.updated,1);
 const emptyOld=mergeForecastArchive(updated.rows, [first],now);
 assert.equal(emptyOld.changed,false);
 const sealed=encryptJournal([],env,[],updated.rows);
 assert.ok(!JSON.stringify(sealed).includes('BTCUSDT'));
 const opened=decryptJournalArchive(sealed,env);
 assert.equal(opened.forecastRows[0].symbol,'BTCUSDT');
 assert.equal(summarizeJournal([],now,[],opened.forecastRows).forecastStudy.archivedForecasts,1);
 assert.deepEqual(decryptJournalArchive(encryptJournal([],env),env).forecastRows,[]);
});

test('compare 5m manual chart forecast quality: already moved BEFORE alert vs subsequent aligned 5m closes',()=>{
 const boundary=Math.floor(sentAt/MIN)*MIN;
 // 16 complete 1m bars preceding the timestamp: decline already in progress.
 const prior=Array.from({length:16},(_,n)=>{
  const distance=15-n;
  const close=distance>5?101-(15-distance)*.08:100.2-(5-distance)*.04;
  return [boundary-(distance+1)*MIN,close,close+.02,close-.02,close,100];
 });
 const bars=normalizeForecastMinutes([...prior,...futureRaw()],now);
 const result=evaluatePublishedForecast(emitted,bars,now);
 // SHORT was already down 20bps/99bps in the preceding 5m/15m.
 assert.ok(result.preMove5mBps>=19&&result.preMove5mBps<=21);
 assert.ok(result.preMove15mBps>=98&&result.preMove15mBps<=100);
 assert.equal(result.aligned5m[1].status,'OBSERVED');
 assert.ok(result.aligned5m[1].moveBps<0);
 assert.ok(result.aligned5m[2].moveBps>0);
 assert.ok(result.aligned5m[3].moveBps>0);
 const report=summarizeForecastArchive([result],now).windows[30].byStrength.STANDARD;
 assert.equal(report.before15m.already10bpsPct,100);
 assert.equal(report.alignedFirst5m.favorablePct,0);
 assert.equal(report.alignedSecond5m.favorablePct,100);
 assert.equal(report.alignedThird5m.favorablePct,100);
 const sealed=encryptJournal([],env,[],[result]);
 const decoded=decryptJournalArchive(sealed,env).forecastRows[0];
 assert.equal(decoded.preMove15mBps,result.preMove15mBps);
 assert.equal(decoded.aligned5m[2].moveBps,result.aligned5m[2].moveBps);
});
test('overnight notices survive a failed writer but never become invented wins',()=>{
 const older=parsePublishedForecast({...notice,sequence_id:'b'.repeat(32),
  time:Math.floor((now-6*60*MIN)/1000)},topic,now);
 assert.ok(older);
 const audited=evaluatePublishedForecast(older,normalizeForecastMinutes(futureRaw(),now),now);
 for(const h of FORECAST_HORIZONS)assert.equal(audited.windows[h].status,'NO_DATA');
 const merged=mergeForecastArchive([], [audited],now);
 assert.equal(merged.added,1);
 const summary=summarizeForecastArchive(merged.rows,now).windows[30];
 assert.equal(summary.total,1);
 assert.equal(summary.at5m.noData,1);
 assert.equal(summary.at5m.observed,0);
});
test('missing pre-alert 1m data yields unknown prior momentum, not an invented early forecast',()=>{
 const result=evaluatePublishedForecast(emitted,normalizeForecastMinutes(futureRaw(),now),now);
 assert.equal(result.preMove5mBps,null);
 assert.equal(result.preMove15mBps,null);
 const outdated=mergeForecastArchive([], [result],now);
 assert.equal(outdated.rows[0].preMove15mBps,null);
 assert.equal(outdated.rows[0].aligned5m[2].status,'OBSERVED');
 const fromTooEarly=evaluatePublishedForecast(emitted,normalizeForecastMinutes(futureRaw(),start+2*MIN),start+2*MIN);
 assert.equal(fromTooEarly.aligned5m[1].status,'PENDING');
});

test('collector reads separate private topic plus WEEX public klines only',async()=>{
 const seen=[];
 const fake=async url=>{
  seen.push(String(url));
  if(String(url).includes('ntfy.sh/'))return {ok:true,text:async()=>JSON.stringify(notice)};
  return {ok:true,text:async()=>JSON.stringify(futureRaw())};
 };
 const v=await recentForecastResearch(now,{fetchImpl:fake,env});
 assert.equal(v.seen,1);
 assert.equal(v.rows.length,1);
 assert.equal(v.rows[0].firstFavorable10bpsMinute,10);
 assert.equal(seen.length,2);
 assert.ok(seen.some(x=>x.includes('interval=1m&limit=125')));
 assert.ok(seen.some(x=>x.includes('since=12h')));
 assert.ok(seen.every(x=>!x.includes('/order')));
});
test('forecast audit is isolated from trading, cron and phone push',()=>{
 const route=readFileSync(new URL('../lib/journal-route.mjs',import.meta.url),'utf8');
 const script=readFileSync(new URL('../history.html',import.meta.url),'utf8').match(/<script>([\s\S]*?)<\/script>/);
 const source=readFileSync(new URL('../lib/forecast-journal.mjs',import.meta.url),'utf8');
 assert.deepEqual(FORECAST_HORIZONS,[1,5,10,15,30]);
 assert.match(route,/recentForecastResearch/);
 assert.match(route,/encryptJournal\(merged.rows,process.env,earlyMerged.rows,forecastMerged.rows,confirmedMerged.rows\)/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 for(const pattern of [/placeOrder/,/trade-confirm/,/trade-prepare/,/capi\/v3\/order/,/NTFY_TOPIC\s*=/]){
  assert.doesNotMatch(source,pattern);
 }
});


test('historical repair obtains only closed WEEX candles for archived NO_DATA forecasts',async()=>{
 const oldSentAt=now-6*60*MIN-40000;
 const old={...emitted,id:'b'.repeat(32),sentAt:oldSentAt};
 const stale=evaluatePublishedForecast(old,[],now);
 assert.equal(stale.windows[5].status,'NO_DATA');
 const bound=Math.floor(oldSentAt/MIN)*MIN;
 const first=Math.ceil((oldSentAt+1)/MIN)*MIN;
 const historic=[
  ...Array.from({length:16},(_,i)=>{
   const close=i<15?100.3:100.02;
   return [bound-(16-i)*MIN,100.2,100.4,99.9,close,500];
  }),
  ...Array.from({length:34},(_,i)=>
   [first+i*MIN,100,100.1,99.7,99.8,500])
 ];
 assert.equal(normalizeForecastMinutes(historic,now).length,0,
  'normal collector still rejects stale candles');
 const urls=[];
 const fake=async url=>{
  urls.push(String(url));
  return {ok:true,text:async()=>JSON.stringify(historic)};
 };
 const recovery=await recoverArchivedForecasts([stale],now,{fetchImpl:fake});
 assert.equal(recovery.attempted,1);
 assert.equal(recovery.failed,0);
 assert.equal(recovery.rows.length,1);
 assert.equal(recovery.rows[0].windows[5].status,'OBSERVED');
 assert.equal(recovery.rows[0].windows[15].status,'OBSERVED');
 assert.equal(recovery.rows[0].windows[30].status,'OBSERVED');
 assert.ok(recovery.rows[0].windows[15].moveBps>0);
 assert.equal(recovery.rows[0].preMove15mBps!==null,true);
 assert.match(urls[0],/\\/market\\/historyKlines\\?/);
 assert.match(urls[0],/priceType=LAST/);
 assert.ok(urls[0].includes('startTime='+(bound-17*MIN)));
 assert.ok(urls[0].includes('endTime='));
 const merged=mergeForecastArchive([stale],recovery.rows,now);
 assert.equal(merged.updated,1);
 assert.equal(merged.rows[0].windows[15].status,'OBSERVED');
 assert.equal(merged.rows[0].direction,'SHORT');
 assert.equal(merged.rows[0].reference,100);
 assert.equal(summarizeForecastArchive(merged.rows,now).windows[30].at5m.observed,1);
});
test('historical repair has a six-request budget and safely ignores wrong-time or missing candles',async()=>{
 const old=now-8*60*MIN;
 const archive=Array.from({length:18},(_,i)=>evaluatePublishedForecast(
  {...emitted,id:i.toString(16).padStart(32,'0'),sentAt:old-i*MIN},[],now));
 let requests=0;
 const mock=async()=>{
  requests++;
  // Exchange returned current candles even though historic time was requested:
  // those must not be counted as matching old forecasts.
  return {ok:true,text:async()=>JSON.stringify(futureRaw())};
 };
 const first=await recoverArchivedForecasts(archive,now,{fetchImpl:mock});
 assert.equal(first.attempted,6);
 assert.equal(requests,6);
 assert.equal(first.failed,0);
 assert.equal(first.rows.length,0);
 const failed=await recoverArchivedForecasts([archive[0]],now,{
  fetchImpl:async()=>{throw Error('network outage')}
 });
 assert.equal(failed.attempted,1);
 assert.equal(failed.failed,1);
 assert.equal(failed.rows.length,0);
 const unchanged=mergeForecastArchive(archive,[],now);
 assert.equal(unchanged.rows.length,archive.length);
 assert.equal(unchanged.rows.every(r=>r.windows[5].status==='NO_DATA'),true);
});
