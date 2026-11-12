import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {berlinHourDay,forecastHourlyStudy} from '../lib/forecast-hourly-study.mjs';
import {summarizeForecastArchive} from '../lib/forecast-journal.mjs';
const NOW=Date.UTC(2026,10,18,18,0);
const observed=bps=>({status:'OBSERVED',moveBps:bps});
const missing={status:'NO_DATA',moveBps:null},pending={status:'PENDING',moveBps:null};
function row(sentAt,{side='LONG',m5=12,m15=11,m20=10,strength='STANDARD',
 v2Timing='CLEAR',preMove15mBps=0}={}){
 return {sentAt,direction:side,strength,v2Timing,preMove15mBps,
  symbol:'BTCUSDT',windows:{5:observed(m5),15:observed(m15),20:observed(m20)}};
}
test('Berlin hour uses ntfy published timestamp, including DST double 02:00',()=>{
 const fall1=berlinHourDay(Date.UTC(2026,9,25,0,30)); // 02:30 CEST
 const fall2=berlinHourDay(Date.UTC(2026,9,25,1,30)); // 02:30 CET
 assert.deepEqual(fall1,fall2);
 assert.equal(fall1.hour,2);
 assert.equal(berlinHourDay(Date.UTC(2026,2,29,1,30)).hour,3);
 assert.equal(berlinHourDay(Date.UTC(2026,2,29,0,30)).hour,1);
 assert.equal(berlinHourDay(NaN),null);
 const dst=forecastHourlyStudy([
  row(Date.UTC(2026,9,25,0,30)),
  row(Date.UTC(2026,9,25,1,30),{side:'SHORT',m5:-10})
 ],NOW);
 assert.equal(dst.hours[2].total,2);
 assert.equal(dst.hours[2].distinctBerlinDays,1);
 assert.equal(dst.sessions[0].total,2);
 assert.equal(dst.hours[2].byDirection.SHORT.at5m.favorablePct,0);
});
test('24 local hours, six sessions and LONG/SHORT remain distinct',()=>{
 const rows=[
  row(Date.UTC(2026,10,12,9,0)), // 10 Berlin
  row(Date.UTC(2026,10,12,9,1),{side:'SHORT',m5:-20,m15:20}),
  row(Date.UTC(2026,10,12,16,50),{side:'SHORT',m5:14}), // 17 Berlin
  row(Date.UTC(2026,10,12,20,50),{m5:8}), // 21 Berlin
  row(Date.UTC(2026,10,12,10,0),{m5:null})
 ];
 rows[4].windows[5]=missing;
 const study=forecastHourlyStudy(rows,NOW);
 assert.equal(study.mode,'READ_ONLY_FORECAST_BERLIN_TIME_OF_DAY');
 assert.equal(study.timeZone,'Europe/Berlin');
 assert.equal(study.hours.length,24);
 assert.equal(study.sessions.length,6);
 assert.equal(study.hours.reduce((a,h)=>a+h.total,0),5);
 assert.equal(study.sessions.reduce((a,h)=>a+h.total,0),5);
 assert.equal(study.hours[10].total,2);
 assert.equal(study.hours[10].at5m.favorablePct,50);
 assert.equal(study.hours[10].byDirection.LONG.at5m.favorablePct,100);
 assert.equal(study.hours[10].byDirection.SHORT.at5m.favorablePct,0);
 assert.equal(study.hours[11].at5m.observed,0);
 assert.equal(study.hours[11].at5m.noData,1);
 assert.equal(study.hours[11].at5m.favorablePct,null);
 assert.equal(study.hours[10].reviewEligible,false);
 assert.deepEqual(study.reviewCandidates.hourly,[]);
});
test('sampling requirements exclude one lucky night and require five distinct days',()=>{
 const rows=Array.from({length:100},(_,i)=>row(
  Date.UTC(2026,10,12,9,i%60),{side:i%2?'LONG':'SHORT',m5:i<70?3:-4}
 ));
 const study=forecastHourlyStudy(rows,NOW);
 assert.equal(study.hours[10].at5m.observed,100);
 assert.equal(study.hours[10].distinctBerlinDays,1);
 assert.equal(study.hours[10].reviewEligible,false);
 assert.equal(study.sessions[2].reviewEligible,false);
});
test('time slots become candidates for further REVIEW only after volume, day and coverage minimums',()=>{
 const rows=[];
 for(let i=0;i<5;i++){
  for(let j=0;j<12;j++)rows.push(row(
   Date.UTC(2026,10,12+i,9,j),{m5:j%4===0?-8:12,m15:j%2===0?-7:8}));
 }
 const study=forecastHourlyStudy(rows,NOW);
 assert.equal(study.hours[10].total,60);
 assert.equal(study.hours[10].at5m.favorable,45);
 assert.equal(study.hours[10].at5m.favorablePct,75);
 assert.equal(study.hours[10].distinctBerlinDays,5);
 assert.equal(study.hours[10].reviewEligible,true);
 assert.equal(study.sessions[2].reviewEligible,true);
 assert.deepEqual(study.reviewCandidates.hourly,[10]);
 assert.deepEqual(study.reviewCandidates.sessions,[2]);
 assert.equal(study.protocol.independentOutOfSampleValidation,false);
 const noData=rows.map(x=>({...x,windows:{...x.windows,15:pending}}));
 assert.equal(forecastHourlyStudy(noData,NOW).hours[10].reviewEligible,false);
});
test('new V3 forward PASS/SKIP study does not relabel historical forecasts',()=>{
 const earlier=row(Date.UTC(2026,10,11,20,0));
 const pass=row(Date.UTC(2026,10,12,0,0));
 const skip=row(Date.UTC(2026,10,12,0,1),{strength:'CAUTION',v2Timing:null});
 const study=forecastHourlyStudy([earlier,pass,skip],NOW);
 assert.equal(study.sessions[0].v3ForwardOnly.PASS.total,1);
 assert.equal(study.sessions[0].v3ForwardOnly.SKIP.total,1);
 assert.equal(study.sessions[0].v3ForwardOnly.UNKNOWN.total,0);
 assert.equal(study.sessions[0].total,2);
 assert.equal(study.sessions[5].total,1);
});
test('existing archive summary includes hourly studies without touching persisted encrypted rows or notification routes',()=>{
 const noRaw=[];
 const summary=summarizeForecastArchive(noRaw,NOW);
 assert.equal(summary.windows[30].berlinTimeOfDay.hours.length,24);
 assert.equal(summary.windows[90].berlinTimeOfDay.sessions.length,6);
 const page=readFileSync(new URL('../history.html',import.meta.url),'utf8');
 const journal=readFileSync(new URL('../lib/forecast-journal.mjs',import.meta.url),'utf8');
 const hourly=readFileSync(new URL('../lib/forecast-hourly-study.mjs',import.meta.url),'utf8');
 assert.match(page,/id="forecastHours"/);
 assert.match(page,/id="forecastSessions"/);
 assert.match(page,/forecastHourStatus/);
 assert.match(journal,/berlinTimeOfDay:forecastHourlyStudy\(selected,now\)/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script);
 assert.doesNotThrow(()=>new Script(script[1]));
 for(const r of [/placeOrder/,/trade-confirm/,/ntfySend/,/push-dispatch/,/WEEX_API_SECRET/,/process\.env/])
  assert.doesNotMatch(hourly,r);
});
